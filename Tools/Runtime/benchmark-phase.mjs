import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,readdir,realpath,lstat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {assertBoundPath,assertRelative,assertIdentity,digest,hash,startupDigest,validateSample,validateRestoration,summarizeSamples} from './benchmark-evidence.mjs';

export const repository=fileURLToPath(new URL('../../',import.meta.url));
const fixtureRoot=path.join(repository,'Local/.temp/SieveProbe');
export const readJson=async file=>JSON.parse(await readFile(file,'utf8'));
export const writeJson=async (file,value)=>writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
export function assertHostClosed() {
  assert.equal(process.platform,'win32','Native orchestration requires Windows');
  const script="$ErrorActionPreference='Stop'; if (@(Get-CimInstance Win32_Process -Filter \"Name = 'Obsidian.exe'\").Count -ne 0) { throw 'Preserve preexisting Obsidian processes' }; if (Get-NetTCPConnection -LocalPort 9229 -State Listen -ErrorAction SilentlyContinue) { throw 'Debugger port 9229 is in use' }; Write-Output 'PASS'";
  assert.equal(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',timeout:10000,windowsHide:true}).trim(),'PASS','Closed app required before offline phase changes');
}
export async function guardedRead(target,parent) {await assertBoundPath(target,parent);return readFile(target);}
const samePath=(a,b)=>path.relative(a,b)==='';
export async function loadFixture(runDirectory) {
  await assertBoundPath(fixtureRoot,repository);
  const run=await assertBoundPath(runDirectory,fixtureRoot);
  assert.match(path.basename(run),/^Runtime-/,'Runtime fixture path required');
  const definition=JSON.parse(await guardedRead(path.join(run,'run.json'),run));
  assert.equal(definition.runtimeFixture,true,'Runtime fixture marker required');
  const selected=definition.vaults.filter(vault=>vault.name==='Filtered');
  assert.equal(selected.length,1,'Exactly one Filtered fixture required');
  const vault=await assertBoundPath(selected[0].vault,run),profile=await assertBoundPath(selected[0].profile,run);
  assert.ok(samePath(vault,path.join(run,'Filtered'))&&samePath(profile,path.join(run,'Profiles/Filtered')),'Exact generated vault/profile required');
  const configDir=selected[0].configDir??'.obsidian';
  assert.match(configDir,/^\.[a-zA-Z0-9_-]+$/,'Invalid fixture configDir');
  const plugin=await assertBoundPath(path.join(vault,configDir,'plugins/sieve'),vault);
  const registry=JSON.parse(await guardedRead(path.join(profile,'obsidian.json'),profile));
  const entries=Object.values(registry.vaults??{});
  assert.equal(entries.length,1,'Profile must contain exactly the selected fixture vault');
  assert.equal(entries[0].open,true,'Selected fixture must be open in its own profile');
  assert.ok(samePath(await assertBoundPath(entries[0].path,run),vault),'Profile registry points to a different vault');
  const enabled=JSON.parse(await guardedRead(path.join(vault,configDir,'community-plugins.json'),vault));
  assert.deepEqual(enabled,['sieve-fixture-observer','sieve'],'Only observer then Sieve may be enabled for comparable evidence');
  const observer=path.join(vault,configDir,'plugins/sieve-fixture-observer');
  assert.equal(JSON.parse(await guardedRead(path.join(observer,'data.json'),vault)).fixtureOnly,true,'Owned observer marker missing');
  return {run,vault,profile,configDir,plugin,observer,definition};
}
export async function verifyPackage(context,expected) {
  assertIdentity(expected);
  const installed=JSON.parse(await guardedRead(path.join(context.plugin,'identity.json'),context.vault));
  assert.equal(digest(installed),digest(expected),'Installed identity differs from explicit expected current identity');
  const artifact=path.join(repository,'dist/sieve');
  const candidate=JSON.parse(await guardedRead(path.join(artifact,'identity.json'),repository));
  assert.equal(digest(candidate),digest(expected),'Expected identity is not the latest local runtime package');
  const manifest=JSON.parse(await guardedRead(path.join(context.plugin,'manifest.json'),context.vault));
  assert.equal(manifest.id,'sieve');assert.equal(manifest.version,expected.version,'Installed manifest mismatch');
  const files={};
  for(const name of ['main.js','manifest.json',...(expected.files['styles.css']?['styles.css']:[])]) {
    files[name]=hash(await guardedRead(path.join(context.plugin,name),context.vault));
    assert.equal(files[name],expected.files[name],`Installed file SHA mismatch: ${name}`);
  }
  for(const [name,sha] of Object.entries(expected.files))assert.equal(hash(await guardedRead(path.join(artifact,assertRelative(name)),repository)),sha,`Latest package file SHA mismatch: ${name}`);
  return {identity:installed,files};
}
export async function snapshotTree(root,{exclude=[]}={}) {
  const result={};
  async function walk(relative='') {
    const directory=relative?path.join(root,relative):root;
    if(relative){await assertBoundPath(directory,root);assert.equal((await lstat(directory)).isSymbolicLink(),false,'No corpus directory aliases allowed');}
    for(const entry of await readdir(directory,{withFileTypes:true})){
      const name=relative?`${relative}/${entry.name}`:entry.name;
      if(exclude.some(prefix=>name===prefix||name.startsWith(prefix+'/')))continue;
      assertRelative(name);const target=path.join(root,name);
      await assertBoundPath(target,root);assert.equal((await lstat(target)).isSymbolicLink(),false,'No corpus file aliases allowed');
      if(entry.isDirectory())await walk(name);
      else {assert.ok(entry.isFile(),'Only regular source files allowed');result[name]=hash(await readFile(target));}
    }
  }
  await walk();return Object.fromEntries(Object.entries(result).sort(([a],[b])=>a.localeCompare(b)));
}
async function sourceSnapshot() {
  const result={};
  for(const [name,sha] of Object.entries(await snapshotTree(path.join(repository,'src'))))result[`src/${name}`]=sha;
  for(const name of ['package.json','package-lock.json','manifest.json','styles.css','tsconfig.json','Tools/build-plugin.mjs','Docs/Syntax.en.md','Docs/Syntax.ru.md']){
    try{result[name]=hash(await guardedRead(path.join(repository,name),repository));}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return result;
}
async function toolSnapshot() {
  const result={};
  for(const name of ['benchmark-same-vault.ps1','benchmark-phase.mjs','benchmark-native.mjs','benchmark-evidence.mjs','../Probe/native-client.mjs'])result[name]=hash(await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)),name)));
  return result;
}
export async function openPhase(directory) {
  const phaseDirectory=await assertBoundPath(directory,fixtureRoot);
  const preparation=JSON.parse(await guardedRead(path.join(phaseDirectory,'preparation.json'),phaseDirectory));
  const context=await loadFixture(preparation.run);
  await assertBoundPath(phaseDirectory,path.join(context.run,'Reports'));
  assert.equal(path.basename(phaseDirectory),preparation.phaseId,'Phase directory mismatch');
  assert.ok(samePath(context.vault,preparation.vault)&&samePath(context.profile,preparation.profile),'Phase fixture mismatch');
  assert.equal(digest(context.definition),preparation.historicalRunDigest,'Historical run.json changed');
  assert.equal(hash(await guardedRead(path.join(context.run,'inventory.json'),context.run)),preparation.historicalInventorySha,'Historical inventory changed');
  assert.equal(digest(await toolSnapshot()),preparation.toolDigest,'Benchmark instrumentation changed during phase');
  await verifyPackage(context,preparation.identity);
  assert.equal(digest(await sourceSnapshot()),preparation.sourceDigest,'Repository source/config changed during phase');
  assert.equal(hash(await guardedRead(path.join(context.observer,'main.js'),context.vault)),preparation.observerSha,'Fixture observer instrumentation changed during phase');
  for(const [name,expected] of [['expected-identity.json',preparation.identityDigest],['historical-run.json',preparation.historicalRunDigest],['source-hashes.json',preparation.sourceDigest],['instrumentation-hashes.json',preparation.toolDigest],['pair-rules.json',digest(preparation.rules)],['original-corpus.json',preparation.originalCorpusDigest]])assert.equal(digest(JSON.parse(await guardedRead(path.join(directory,name),directory))),expected,`Evidence snapshot changed: ${name}`);
  assert.equal(hash(await guardedRead(path.join(directory,'original-data.json'),directory)),preparation.originalSettingsSha,'Original configuration snapshot changed');
  if(preparation.originalPreviousSettingsSha)assert.equal(hash(await guardedRead(path.join(directory,'original-data.previous.json'),directory)),preparation.originalPreviousSettingsSha,'Previous working snapshot evidence changed');
  assert.equal(hash(await guardedRead(path.join(directory,'observer-main.js'),directory)),preparation.observerSha,'Observer evidence snapshot changed');
  assert.equal(hash(await guardedRead(path.join(directory,'historical-inventory.json'),directory)),preparation.historicalInventorySha,'Historical inventory snapshot changed');
  let phase=preparation;
  try{phase=JSON.parse(await guardedRead(path.join(phaseDirectory,'phase.json'),phaseDirectory));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(phase!==preparation){
    for(const key of Object.keys(preparation))assert.equal(digest(phase[key]),digest(preparation[key]),`Phase preparation mismatch: ${key}`);
    const added=JSON.parse(await guardedRead(path.join(directory,'added-inventory.json'),directory));
    assert.equal(digest(phase.corpus),digest({...preparation.originalCorpus,...added}),'Phase inventory mismatch');
    assert.equal(digest(phase.corpus),phase.corpusDigest,'Phase corpus digest mismatch');
    assert.equal(digest(JSON.parse(await guardedRead(path.join(directory,'phase-inventory.json'),directory))),phase.corpusDigest,'Phase inventory snapshot changed');
  }
  return {...context,phaseDirectory,phase,preparation};
}
export async function verifyCorpus(context,expected=context.phase.corpus) {
  const actual=await snapshotTree(context.vault,{exclude:[context.configDir]});
  assert.equal(digest(actual),digest(expected),'Source corpus content or file set changed');
  return {status:'PASS',count:Object.keys(actual).length,digest:digest(actual)};
}
export async function initialize(run,expectedPath,samples,count) {
  assertHostClosed();assert.ok(Number.isSafeInteger(samples)&&samples>=5&&samples<=20,'At least five pairs required');
  assert.ok(Number.isSafeInteger(count)&&count>=1000&&count<=20000,'Synthetic count must be 1000..20000');
  const context=await loadFixture(run);
  const candidatePath=path.join(repository,'dist/sieve/identity.json'),installedPath=path.join(context.plugin,'identity.json');
  assert.ok(samePath(path.resolve(expectedPath),candidatePath)||samePath(path.resolve(expectedPath),installedPath),'Expected identity must explicitly select the current artifact or owned installation');
  const identity=JSON.parse(await guardedRead(expectedPath,repository));await verifyPackage(context,identity);
  const inventoryBytes=await guardedRead(path.join(context.run,'inventory.json'),context.run),historical=JSON.parse(inventoryBytes);
  const corpus=await snapshotTree(context.vault,{exclude:[context.configDir]});
  for(const [name,sha] of Object.entries(historical)){assertRelative(name);assert.equal(corpus[name],sha,`Original source hash changed: ${name}`);}
  assert.ok(Object.keys(corpus).length+count<=20000,'Total synthetic source file count must stay <=20000');
  const raw=await guardedRead(path.join(context.plugin,'data.json'),context.vault),originalSettings=JSON.parse(raw);
  assert.deepEqual(Object.keys(originalSettings).sort(),['displayName','rules','schemaVersion']);
  assert.equal(originalSettings.schemaVersion,1);assert.equal(typeof originalSettings.rules,'string');assert.equal(typeof originalSettings.displayName,'string');
  // Restoration must never introduce an include outside this owned fixture.
  async function ownIncludes(text,seen=new Set()) {
    for(const line of text.split(/\r?\n/))if(line.trim().startsWith('#include')){
      const include=assertRelative(line.trim().slice(8).trim());
      if(seen.has(include))continue;seen.add(include);
      await assertBoundPath(path.join(context.vault,include),context.vault);
      assert.equal((await lstat(path.join(context.vault,include))).isSymbolicLink(),false,'No include aliases allowed');
      await ownIncludes((await guardedRead(path.join(context.vault,include),context.vault)).toString('utf8'),seen);
    }
  }
  await ownIncludes(originalSettings.rules);
  const phaseId=`Benchmark-${new Date().toISOString().replaceAll(/[:.]/g,'-')}`,phaseDirectory=path.join(context.run,'Reports',phaseId);
  await assertBoundPath(path.dirname(phaseDirectory),context.run);await mkdir(phaseDirectory);await mkdir(path.join(phaseDirectory,'Measurements'));
  const source=await sourceSnapshot(),tools=await toolSnapshot();
  let previousRaw;
  try{previousRaw=await guardedRead(path.join(context.plugin,'data.previous.json'),context.vault);}catch(error){if(error.code!=='ENOENT')throw error;}
  const preparation={schemaVersion:1,phaseId,run:context.run,vault:context.vault,profile:context.profile,configDir:context.configDir,samples,newFileCount:count,maxResourceSnapshotDelayMs:5000,identity,identityDigest:digest(identity),historicalIdentity:context.definition.identity,historicalRunDigest:digest(context.definition),historicalInventorySha:hash(inventoryBytes),originalSettings,originalSettingsSha:hash(raw),originalPreviousSettingsSha:previousRaw?hash(previousRaw):null,originalCorpus:corpus,originalCorpusDigest:digest(corpus),sourceDigest:digest(source),toolDigest:digest(tools),observerSha:hash(await guardedRead(path.join(context.observer,'main.js'),context.vault)),rules:{Baseline:{schemaVersion:1,rules:'',displayName:''},Filtered:{schemaVersion:1,rules:'Technical',displayName:''}}};
  await writeFile(path.join(phaseDirectory,'original-data.json'),raw,{flag:'wx'});
  if(previousRaw)await writeFile(path.join(phaseDirectory,'original-data.previous.json'),previousRaw,{flag:'wx'});
  await writeFile(path.join(phaseDirectory,'observer-main.js'),await guardedRead(path.join(context.observer,'main.js'),context.vault),{flag:'wx'});
  await writeJson(path.join(phaseDirectory,'expected-identity.json'),identity);
  await writeJson(path.join(phaseDirectory,'historical-run.json'),context.definition);
  await writeFile(path.join(phaseDirectory,'historical-inventory.json'),inventoryBytes,{flag:'wx'});
  await writeJson(path.join(phaseDirectory,'source-hashes.json'),source);
  await writeJson(path.join(phaseDirectory,'instrumentation-hashes.json'),tools);
  await writeJson(path.join(phaseDirectory,'pair-rules.json'),preparation.rules);
  await writeJson(path.join(phaseDirectory,'original-corpus.json'),corpus);
  await writeJson(path.join(phaseDirectory,'preparation.json'),preparation);
  return phaseDirectory;
}
export async function extend(directory) {
  assertHostClosed();const context=await openPhase(directory),p=context.preparation;
  const proof=JSON.parse(await guardedRead(path.join(directory,'preflight.json'),directory));
  assert.equal(proof.trusted,true,'Successful native trusted preflight required before extending source');
  assert.equal(proof.identityDigest,p.identityDigest);assert.equal(proof.originalCorpusDigest,p.originalCorpusDigest);
  await verifyCorpus(context,p.originalCorpus);
  const prefix=`Technical/Bench-${p.phaseId.slice('Benchmark-'.length)}`,technical=path.join(context.vault,'Technical');
  await assertBoundPath(technical,context.vault);
  const added={};
  for(let i=0;i<p.newFileCount;i++)added[`${prefix}/group-${Math.floor(i/100)}/hidden-${i}.md`]=hash(Buffer.from(`# Synthetic benchmark ${i}\n\n[[note-0]]\n`));
  await writeJson(path.join(directory,'extension-plan.json'),{prefix,newFileCount:p.newFileCount,files:added});
  const target=path.join(context.vault,prefix);await mkdir(target);
  for(let i=0;i<p.newFileCount;i++){
    const directoryName=`${prefix}/group-${Math.floor(i/100)}`;
    if(i%100===0){await assertBoundPath(path.dirname(path.join(context.vault,directoryName)),context.vault);await mkdir(path.join(context.vault,directoryName));}
    const name=`${directoryName}/hidden-${i}.md`,bytes=Buffer.from(`# Synthetic benchmark ${i}\n\n[[note-0]]\n`);
    await assertBoundPath(path.dirname(path.join(context.vault,name)),context.vault);await writeFile(path.join(context.vault,name),bytes,{flag:'wx'});
  }
  const corpus={...p.originalCorpus,...added};await verifyCorpus(context,corpus);
  const technicalCount=Object.keys(corpus).filter(name=>name.startsWith('Technical/')).length;
  assert.ok(technicalCount/Object.keys(corpus).length>=0.95,'Large synthetic corpus must be at least 95% Technical files');
  assert.equal(typeof proof.apiVersion,'string','Native API version missing from preflight');
  const phase={...p,corpus,corpusDigest:digest(corpus),addedPrefix:prefix,technicalCount,hostApiVersion:proof.apiVersion};
  await writeJson(path.join(directory,'added-inventory.json'),added);
  await writeJson(path.join(directory,'phase-inventory.json'),corpus);
  await writeJson(path.join(directory,'phase.json'),phase);
  return {phaseId:p.phaseId,files:Object.keys(corpus).length,newFiles:p.newFileCount,corpusDigest:phase.corpusDigest};
}
export async function completeSample(directory,stem) {
  assertHostClosed();assert.match(stem,/^\d{2}-(Baseline|Filtered)$/,'Exact measured sample stem required');
  const context=await openPhase(directory),base=path.join(directory,'Measurements',stem);
  const report=JSON.parse(await guardedRead(`${base}-startup.json`,directory));
  assert.equal(stem,`${String(report.pair).padStart(2,'0')}-${report.mode}`,'Sample filename binding mismatch');
  assert.equal(report.reportIdentity,startupDigest(report),'Startup identity changed before post-quit census');
  report.processMetrics=JSON.parse(await guardedRead(`${base}-process-metrics.json`,directory));
  validateSample(context.phase,report,{corpusVerification:false});
  const startedUtc=new Date().toISOString(),startedMonotonicNs=process.hrtime.bigint().toString();
  const verified=await verifyCorpus(context);
  const proof={...verified,phaseId:report.phaseId,pair:report.pair,mode:report.mode,sampleKind:report.sampleKind,reportIdentity:report.reportIdentity,afterAppQuit:true,startedUtc,startedMonotonicNs,finishedUtc:new Date().toISOString(),finishedMonotonicNs:process.hrtime.bigint().toString()};
  await writeJson(`${base}-corpus-verification.json`,proof);return proof;
}
export async function finalize(directory) {
  assertHostClosed();const context=await openPhase(directory);assert.ok(context.phase.corpus,'Prepared benchmark corpus required');
  const verification=await verifyCorpus(context),reports=[];
  for(let pair=1;pair<=context.phase.samples;pair++)for(const mode of ['Baseline','Filtered']){
    const stem=`${String(pair).padStart(2,'0')}-${mode}`;
    const report=JSON.parse(await guardedRead(path.join(directory,'Measurements',`${stem}-startup.json`),directory));
    report.processMetrics=JSON.parse(await guardedRead(path.join(directory,'Measurements',`${stem}-process-metrics.json`),directory));
    report.corpusVerification=JSON.parse(await guardedRead(path.join(directory,'Measurements',`${stem}-corpus-verification.json`),directory));reports.push(report);
  }
  const settingsRaw=await guardedRead(path.join(context.plugin,'data.json'),context.vault);
  assert.deepEqual(JSON.parse(settingsRaw),context.phase.originalSettings,'Original working settings not restored');
  const confirmation=JSON.parse(await guardedRead(path.join(directory,'restore-confirmation.json'),directory));
  validateRestoration(context.phase,confirmation,reports);
  let previousAfterSha=null;
  try{previousAfterSha=hash(await guardedRead(path.join(context.plugin,'data.previous.json'),context.vault));}catch(error){if(error.code!=='ENOENT')throw error;}
  const result={...summarizeSamples(context.phase,reports),finalCorpusVerification:verification,configRestoration:{semanticRestored:true,activeConfirmedAfterFullReopen:true,confirmationLaunchId:confirmation.launchBinding.launchId,beforeSha:context.phase.originalSettingsSha,afterSha:hash(settingsRaw),byteIdentical:hash(settingsRaw)===context.phase.originalSettingsSha,previousWorkingSnapshot:{beforeSha:context.phase.originalPreviousSettingsSha,afterSha:previousAfterSha,mechanism:'Product API retains one previous working config; snapshot bytes are preserved as phase evidence, not overwritten offline'}}};
  await writeJson(path.join(directory,'summary.json'),result);return {report:path.join(directory,'summary.json'),medians:result.medians,configRestoration:result.configRestoration};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [action,...args]=process.argv.slice(2);
  if(action==='init')console.log(await initialize(args[0],args[1],Number(args[2]),Number(args[3])));
  else if(action==='extend')console.log(JSON.stringify(await extend(args[0])));
  else if(action==='verify'){assertHostClosed();const context=await openPhase(args[0]);console.log(JSON.stringify(await verifyCorpus(context)));}
  else if(action==='launch-context'){assertHostClosed();const context=await openPhase(args[0]);const executablePath=await realpath(args[1]);assert.equal(path.basename(executablePath).toLowerCase(),'obsidian.exe','Native Obsidian executable required');console.log(JSON.stringify({phaseId:context.phase.phaseId,run:context.run,vault:context.vault,profile:context.profile,physicalProfile:await realpath(context.profile),configDir:context.configDir,executablePath}));}
  else if(action==='complete-sample')console.log(JSON.stringify(await completeSample(args[0],args[1])));
  else if(action==='finalize')console.log(JSON.stringify(await finalize(args[0])));
  else throw new Error('Expected init, extend, verify, launch-context, complete-sample or finalize');
}
