import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {connectNative} from '../Probe/native-client.mjs';
import {openPhase,writeJson,verifyCorpus,guardedRead} from './benchmark-phase.mjs';
import {digest,hash,startupDigest,validateSample,assertOutputPath} from './benchmark-evidence.mjs';

const canonicalPath=value=>path.resolve(value).replaceAll('\\','/').toLowerCase();
export function assertLaunchBinding(binding) {
  assert.equal(binding?.schemaVersion,1,'Owned launch binding required');
  assert.match(binding.launchId,/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,'Launch nonce required');
  assert.ok(Number.isSafeInteger(binding.pid)&&binding.pid>0,'Launch PID binding required');
  assert.equal(binding.port,9229,'Owned debugger port required');
  assert.match(binding.startFileTimeUtc,/^\d+$/,'Process creation binding required');
  const root=fileURLToPath(new URL('../../Local/.temp/SieveProbe',import.meta.url));
  const relative=path.relative(root,path.resolve(binding.run));
  assert.ok(/^Runtime-[^/\\]+$/.test(relative),'Generated runtime fixture binding required');
  assert.equal(canonicalPath(binding.vault),canonicalPath(path.join(binding.run,'Filtered')),'Exact fixture vault binding required');
  assert.equal(canonicalPath(binding.profile),canonicalPath(path.join(binding.run,'Profiles/Filtered')),'Exact fixture profile binding required');
  assert.equal(path.basename(binding.executablePath).toLowerCase(),'obsidian.exe','Obsidian executable binding required');
}
export function validateOsBinding(binding,state,rendererPid) {
  assertLaunchBinding(binding);
  assert.equal(state.pid,binding.pid,'Launch PID binding mismatch');
  assert.equal(state.startFileTimeUtc,binding.startFileTimeUtc,'Process creation binding mismatch');
  assert.equal(canonicalPath(state.executablePath),canonicalPath(binding.executablePath),'Executable binding mismatch');
  assert.ok(state.commandLine.includes(`--sieve-benchmark-launch=${binding.launchId}`),'Launch nonce binding mismatch');
  const profile=state.commandLine.match(/--user-data-dir=(?:"([^"]+)"|(\S+))/);
  assert.ok(profile&&canonicalPath(profile[1]??profile[2])===canonicalPath(binding.profile),'Launch profile binding mismatch');
  assert.ok(Array.isArray(state.portOwners)&&state.portOwners.length>0,'Debugger port owner missing');
  const owned=new Set([binding.pid]);let count;
  do {count=owned.size;for(const row of state.processes??[])if(owned.has(row.parentPid))owned.add(row.pid);}while(owned.size!==count);
  assert.ok(state.portOwners.every(pid=>owned.has(pid)),'Debugger port owner outside launched PID tree');
  if(rendererPid!==undefined)assert.ok(owned.has(rendererPid),'Renderer ancestry outside launched PID tree');
  return owned;
}
export async function readOsBinding(binding) {
  assertLaunchBinding(binding);assert.equal(process.platform,'win32','Windows process binding required');
  const script=`$ErrorActionPreference='Stop'; $sieveQuitPid=${binding.pid}; $sieveQuitProcess=Get-Process -Id $sieveQuitPid; $sieveQuitCim=Get-CimInstance Win32_Process -Filter "ProcessId = $sieveQuitPid"; $sieveQuitRows=@(Get-CimInstance Win32_Process -Filter "Name = 'Obsidian.exe'" | ForEach-Object {[pscustomobject]@{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId}}); $sieveQuitOwners=@(Get-NetTCPConnection -LocalPort ${binding.port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique); [pscustomobject]@{pid=$sieveQuitPid;startFileTimeUtc=$sieveQuitProcess.StartTime.ToUniversalTime().ToFileTimeUtc().ToString();executablePath=$sieveQuitCim.ExecutablePath;commandLine=$sieveQuitCim.CommandLine;processes=$sieveQuitRows;portOwners=$sieveQuitOwners} | ConvertTo-Json -Depth 5 -Compress`;
  return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',timeout:10000,windowsHide:true}));
}
// Minimal CDP transport for quit only. It never waits for app/vault/plugins,
// reads fixture state, or enables trust. OS ownership is checked by its caller.
export async function connectQuit(port) {
  const deadline=Date.now()+10000;let target;
  while(!target){
    try{const response=await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(1500)});if(response.ok){const targets=await response.json();target=targets.find(tab=>tab.type==='page'&&/app\.html|index\.html/.test(tab.url))??targets.find(tab=>tab.type==='page');}}catch{/* Await only the owned debugger, not vault readiness. */}
    if(!target){if(Date.now()>=deadline)throw new Error('Owned quit renderer unavailable before timeout');await new Promise(resolve=>setTimeout(resolve,100));}
  }
  const url=new URL(target.webSocketDebuggerUrl);
  assert.ok(url.protocol==='ws:'&&['127.0.0.1','localhost'].includes(url.hostname)&&Number(url.port)===port,'Owned local debugger URL required');
  const socket=new WebSocket(url);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.close();reject(new Error('Owned quit connection timeout'));},5000);socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});socket.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('Owned quit connection failed'));},{once:true});});
  let sequence=0;const pending=new Map();
  socket.addEventListener('message',event=>{const result=JSON.parse(event.data),request=pending.get(result.id);if(!request)return;pending.delete(result.id);clearTimeout(request.timer);if(result.error||result.result?.exceptionDetails)request.reject(new Error('Owned quit evaluation failed'));else request.resolve(result.result.result.value);});
  socket.addEventListener('close',()=>{for(const request of pending.values()){clearTimeout(request.timer);request.reject(new Error('Owned quit debugger closed'));}pending.clear();});
  return {evaluate(body){return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Owned quit evaluation timeout'));},5000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression:`(async()=>{${body}})()`,returnByValue:true,awaitPromise:true}}));});},close(){socket.close();}};
}
export async function quitOwnedHost(binding,{readOs=readOsBinding,connect=connectQuit}={}) {
  // Capture a detached immutable value before any await. No file-backed state.
  const captured=Object.freeze(JSON.parse(JSON.stringify(binding)));assertLaunchBinding(captured);
  validateOsBinding(captured,await readOs(captured));
  const client=await connect(captured.port);
  const identityBody=`const profile=require('@electron/remote').app.getPath('userData');const rendererPid=require('process').pid;const canonical=value=>value.replaceAll('\\\\','/').toLowerCase();if(canonical(profile)!==canonical(${JSON.stringify(captured.profile)}))throw new Error('Owned quit profile mismatch');`;
  try {
    const actual=await client.evaluate(`${identityBody}return {profile,rendererPid};`);
    validateOsBinding(captured,await readOs(captured),actual.rendererPid);
    return await client.evaluate(`${identityBody}if(rendererPid!==${actual.rendererPid})throw new Error('Owned renderer PID binding changed');setTimeout(()=>require('@electron/remote').app.quit(),100);return {quitting:true,profile,rendererPid,launchPid:${captured.pid},launchId:${JSON.stringify(captured.launchId)}};`);
  } finally {client.close();}
}

// Fixture instrumentation only. No activation, trust handoff, reload, or host patches.
export function exactContextBody(phase,body) {
  return `
    const expectedVault=${JSON.stringify(phase.vault)},expectedProfile=${JSON.stringify(phase.profile)};
    const canonical=value=>require('process').platform==='win32'?value.replaceAll('\\\\','/').toLowerCase():value.replaceAll('\\\\','/');
    if(canonical(vaultPath)!==canonical(expectedVault)||canonical(profile)!==canonical(expectedProfile))throw new Error('Exact benchmark vault/profile mismatch');
    const fs=require('fs').promises;
    if(canonical(await fs.realpath(vaultPath))!==canonical(await fs.realpath(expectedVault))||canonical(await fs.realpath(profile))!==canonical(await fs.realpath(expectedProfile)))throw new Error('Physical benchmark vault/profile mismatch');
    if(app.vault.configDir!==${JSON.stringify(phase.configDir)})throw new Error('Benchmark configDir mismatch');
    ${body}
  `;
}
export function metadataCompletionBody(timeoutMs) {
  assert.ok(Number.isSafeInteger(timeoutMs)&&timeoutMs>=10000&&timeoutMs<=180000,'Invalid metadata timeout');
  return `
    if(typeof app.metadataCache.isCacheClean!=='function')throw new Error('Actual metadata completion API unavailable; no fixed settle substitute');
    const deadline=performance.now()+${timeoutMs};
    while(!app.metadataCache.isCacheClean()){
      if(performance.now()>=deadline)throw new Error('Actual metadata cache completion timed out');
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    const metadataCompletion={clean:true,timedOut:false,at:performance.now(),utc:new Date().toISOString(),monotonicNs:require('process').hrtime.bigint().toString(),monotonicClock:'Windows QPC via Node hrtime',source:'first isCacheClean() observation after layout'};
  `;
}
const trustedBody=`
  const plugin=app.plugins.plugins.sieve,observer=app.plugins.plugins['sieve-fixture-observer'];
  if(!app.plugins.isEnabled()||!plugin||typeof plugin.saveSettings!=='function'||typeof plugin.getStatus!=='function'||typeof observer?.report!=='function')throw new Error('This owned fixture must already be trusted with Sieve and observer enabled. Enable it manually, then rerun; benchmark does not automate trust');
  if(plugin.manifest.version!==expectedVersion)throw new Error('Loaded Sieve version mismatch');
`;
export async function runNative(directory,action,{mode,pair,timeoutMs=90000,port=9229,output,binding}={}) {
  const context=await openPhase(directory),phase=context.phase;
  const launchBinding=Object.freeze(JSON.parse(JSON.stringify(binding)));assertLaunchBinding(launchBinding);
  assert.equal(launchBinding.phaseId,phase.phaseId,'Launch phase binding mismatch');
  assert.equal(canonicalPath(launchBinding.profile),canonicalPath(phase.profile),'Launch profile differs from phase');
  const owned=validateOsBinding(launchBinding,await readOsBinding(launchBinding));
  assert.ok(['preflight','save','report','restore','confirm-restore'].includes(action),'Unknown benchmark action');
  if(mode!==undefined)assert.ok(['Baseline','Filtered'].includes(mode),'Unknown benchmark mode');
  assert.ok(Number.isSafeInteger(timeoutMs)&&timeoutMs>=10000&&timeoutMs<=180000,'Invalid metadata timeout');
  if(output)await assertOutputPath(output,directory);
  const client=await connectNative(port);
  try {
    const common=`const expectedVersion=${JSON.stringify(phase.identity.version)};${trustedBody}`;
    if(action==='confirm-restore'){
      const confirmation=await client.evaluate(exactContextBody(phase,`${common}${metadataCompletionBody(timeoutMs)}
        const status=plugin.getStatus();
        if(status.status!=='applied'||status.pendingReload||status.fallback||!status.initial.completed)throw new Error('Original working configuration not active after reopen');
        return {activeConfirmed:true,reopened:true,settings:plugin.activeSettings,savedSettings:plugin.savedSettings,status,metadataCompletion,vault:vaultPath,profile,rendererPid:require('process').pid};
      `),{timeout:timeoutMs+15000});
      assert.ok(owned.has(confirmation.rendererPid),'Restored renderer outside owned PID tree');
      assert.deepEqual(confirmation.settings,phase.originalSettings,'Original active settings mismatch after reopen');
      assert.deepEqual(confirmation.savedSettings,phase.originalSettings,'Original saved settings mismatch after reopen');
      const evidence={...confirmation,phaseId:phase.phaseId,identityDigest:phase.identityDigest,launchBinding};
      if(output)await writeJson(output,evidence);return evidence;
    }
    if(action==='preflight') {
      await verifyCorpus(context,phase.originalCorpus);
      const result=await client.evaluate(exactContextBody(phase,`${common}
        const status=plugin.getStatus();
        if(status.status!=='applied'||status.pendingReload||status.fallback)throw new Error('Preflight requires applied original working settings without pending reload/fallback');
        if(JSON.stringify(plugin.savedSettings)!==JSON.stringify(plugin.activeSettings))throw new Error('Saved/active settings differ before benchmark');
        return {trusted:true,version:plugin.manifest.version,apiVersion:observer.report().apiVersion,vault:vaultPath,profile,settings:plugin.savedSettings,status};
      `));
      assert.equal(digest(result.settings),digest(phase.originalSettings),'Loaded original settings mismatch');
      const proof={...result,identityDigest:phase.identityDigest,originalCorpusDigest:phase.originalCorpusDigest};
      await writeJson(path.join(directory,'preflight.json'),proof);return proof;
    }
    if(action==='save'||action==='restore') {
      const candidate=action==='restore'?phase.originalSettings:phase.rules[mode];
      assert.ok(candidate,'Save target mode required');
      const before=await guardedRead(path.join(context.plugin,'data.json'),context.vault);
      const result=await client.evaluate(exactContextBody(phase,`${common}
        const candidate=${JSON.stringify(candidate)};
        const saved=await plugin.saveSettings(candidate);
        if(!saved.ok)throw new Error('Product settings save failed: '+saved.error?.code);
        if(JSON.stringify(plugin.savedSettings)!==JSON.stringify(candidate))throw new Error('Product save result does not match target settings');
        return {action:${JSON.stringify(action)},candidate,saved,status:plugin.getStatus(),vault:vaultPath,profile};
      `));
      const after=await guardedRead(path.join(context.plugin,'data.json'),context.vault);
      assert.deepEqual(JSON.parse(after),candidate,'Persisted product settings do not match target');
      const evidence={...result,phaseId:phase.phaseId,beforeSha:hash(before),afterSha:hash(after),mechanism:'plugin.saveSettings; no reload until normal quit/full restart'};
      if(output)await writeJson(output,evidence);return evidence;
    }
    assert.ok(phase.corpus,'Extend source phase before measured startup');
    assert.ok(Number.isSafeInteger(pair)&&pair>=1&&pair<=phase.samples,'Invalid measured pair');
    const observed=await client.evaluate(exactContextBody(phase,`${common}
      ${metadataCompletionBody(timeoutMs)}
      return {runtimeFixture:true,version:plugin.manifest.version,vault:vaultPath,profile,rendererPid:require('process').pid,configDir:app.vault.configDir,pluginsEnabled:app.plugins.isEnabled(),settings:plugin.activeSettings,pluginStatus:plugin.getStatus(),index:app.vault.getAllLoadedFiles().map(file=>file.path).sort(),metadata:app.metadataCache.getCachedFiles().sort(),metadataCompletion,trace:observer.report()};
    `),{timeout:timeoutMs+15000});
    const events=observed.trace?.events;
    const complete=Boolean(events&&observed.trace.dropped===0&&['vault-load-start','vault-load-end','layout-ready'].every(method=>events.filter(event=>event.method===method).length===1)&&!events.some(event=>event.method==='vault-load-error'));
    assert.ok(owned.has(observed.rendererPid),'Measured renderer outside owned PID tree');
    const report={...observed,launchBinding,sampleKind:output&&path.basename(output).startsWith('warmup-')?'warmup':'measurement',apiVersion:observed.trace?.apiVersion,phaseId:phase.phaseId,pair,mode,identity:phase.identity,identityDigest:phase.identityDigest,sourceDigest:phase.sourceDigest,corpusDigest:phase.corpusDigest,observedStartup:complete,technicalIo:complete?events.filter(event=>event.kind==='io'&&event.phase!=='prepare'&&(event.path==='Technical'||event.path?.startsWith('Technical/'))).length:null,vaultLoadDurationMs:complete?events.find(event=>event.method==='vault-load-end').durationMs:null,rendererLayoutMs:complete?events.find(event=>event.method==='layout-ready').at:null};
    report.reportIdentity=startupDigest(report);
    if(output)await writeJson(output,report);
    // Save incomplete evidence, but never let it advance to another measured run.
    assert.ok(complete,'Incomplete/dropped startup trace; preserve raw evidence, no benchmark PASS');
    validateSample(phase,report,{processMetrics:false,corpusVerification:false});
    return {phaseId:phase.phaseId,pair,mode,sampleKind:report.sampleKind,reportIdentity:report.reportIdentity,identityDigest:phase.identityDigest,launchBinding,index:report.index.length,metadata:report.metadata.length,technicalIo:report.technicalIo,metadataCompletion:report.metadataCompletion};
  } finally {client.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv[2]==='quit-owned'){console.log(JSON.stringify(await quitOwnedHost(JSON.parse(Buffer.from(process.argv[3],'base64').toString('utf8')))));}
  else {
  const [directory,action,output,mode,pair,timeoutMs,bindingJson]=process.argv.slice(2);
  console.log(JSON.stringify(await runNative(directory,action,{output,binding:JSON.parse(Buffer.from(bindingJson,'base64').toString('utf8')),mode:mode&&mode!=='-'?mode:undefined,pair:pair?Number(pair):undefined,timeoutMs:timeoutMs?Number(timeoutMs):90000})));
  }
}
