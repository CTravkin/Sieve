import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {realpath} from 'node:fs/promises';
import path from 'node:path';

export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const digest=value=>hash(JSON.stringify(canonical(value)));
export function startupDigest(report) {
  const {reportIdentity,processMetrics,corpusVerification,...startup}=report;
  return digest(startup);
}
const inside=(target,parent)=>{const relative=path.relative(parent,target);return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
export async function assertBoundPath(target,parent,{realpathFn=realpath}={}) {
  const absolute=path.resolve(target),base=path.resolve(parent);
  assert.ok(inside(absolute,base),'Lexical boundary violation');
  const [physical,physicalBase]=await Promise.all([realpathFn(absolute),realpathFn(base)]);
  assert.ok(inside(physical,physicalBase),'Physical boundary violation');
  return absolute;
}
export async function assertOutputPath(target,parent,{realpathFn=realpath}={}) {
  const absolute=path.resolve(target);
  return assertBoundPath(absolute,parent,{realpathFn:async value=>value===absolute?path.join(await realpathFn(path.dirname(value)),path.basename(value)):realpathFn(value)});
}
export function assertRelative(name) {
  assert.ok(typeof name==='string'&&name!==''&&!name.includes('\\')&&!name.startsWith('/')&&!/^[a-z]:/i.test(name)&&name.split('/').every(part=>part!==''&&part!=='.'&&part!=='..'),'Invalid relative inventory path');
  return name;
}
export function assertIdentity(identity) {
  assert.equal(identity?.privateCandidate,true,'Actual runtime identity required');
  assert.match(identity.version,/^0\.\d+\.\d+$/);
  assert.ok(Number.isSafeInteger(identity.build)&&identity.build>0,'Build identity required');
  assert.match(identity.sourceFingerprint,/^[a-f0-9]{64}$/);
  for(const name of ['main.js','manifest.json'])assert.match(identity.files?.[name]??'',/^[a-f0-9]{64}$/,'Package file SHA required');
  for(const [name,sha] of Object.entries(identity.files)){assertRelative(name);assert.match(sha,/^[a-f0-9]{64}$/);}
}
const technical=name=>name==='Technical'||name.startsWith('Technical/');
const visible=(name,mode)=>mode==='Baseline'||!technical(name);
export function expectedIndex(corpus,mode) {
  const names=new Set();
  for(const name of Object.keys(corpus).filter(name=>visible(name,mode))){
    assertRelative(name);names.add(name);
    let directory=path.posix.dirname(name);
    while(directory!=='.'){names.add(directory);directory=path.posix.dirname(directory);}
  }
  return [...names].sort();
}
export const expectedMetadata=(corpus,mode)=>Object.keys(corpus).filter(name=>visible(name,mode)&&name.toLowerCase().endsWith('.md')).sort();
const finite=(value,label)=>assert.ok(typeof value==='number'&&Number.isFinite(value)&&value>=0,`${label} must be a finite nonnegative number`);
const normalizeIndex=names=>names.filter(name=>name!==''&&name!=='/').sort();
const utc=(value,label)=>{assert.ok(typeof value==='string'&&value.endsWith('Z')&&Number.isFinite(Date.parse(value)),`${label} UTC timestamp required`);return Date.parse(value);};
const ns=(value,label)=>{assert.ok(typeof value==='string'&&/^\d+$/.test(value),`${label} monotonic timestamp required`);return BigInt(value);};
export function validateResourceBinding(phase,report,metrics) {
  for(const key of ['phaseId','pair','mode','sampleKind','reportIdentity','identityDigest'])assert.equal(metrics[key],report[key],`Metrics ${key} binding mismatch`);
  assert.equal(metrics.launchPid,report.launchBinding.pid,'Metrics launch PID binding mismatch');
  assert.equal(metrics.launchId,report.launchBinding.launchId,'Metrics launch nonce binding mismatch');
  assert.equal(metrics.metadataCompletionUtc,report.metadataCompletion.utc,'Metrics metadata UTC binding mismatch');
  assert.equal(metrics.metadataCompletionMonotonicNs,report.metadataCompletion.monotonicNs,'Metrics metadata monotonic binding mismatch');
  const metadataUtc=utc(report.metadataCompletion.utc,'Metadata'),startUtc=utc(metrics.snapshotStartedUtc,'Snapshot start'),endUtc=utc(metrics.snapshotFinishedUtc,'Snapshot end');
  const metadataNs=ns(report.metadataCompletion.monotonicNs,'Metadata'),startNs=ns(metrics.snapshotStartedMonotonicNs,'Snapshot start'),endNs=ns(metrics.snapshotFinishedMonotonicNs,'Snapshot end');
  assert.ok(metadataUtc<=startUtc&&startUtc<=endUtc&&metadataNs<=startNs&&startNs<=endNs,'Resource snapshot precedes metadata or has invalid order');
  const delta=Number(startNs-metadataNs)/1e6,duration=Number(endNs-startNs)/1e6;
  finite(metrics.deltaFromMetadataMs,'Resource snapshot delta');finite(metrics.snapshotDurationMs,'Resource snapshot duration');
  assert.ok(Math.abs(metrics.deltaFromMetadataMs-delta)<0.001&&Math.abs(metrics.snapshotDurationMs-duration)<0.001,'Resource monotonic delta mismatch');
  assert.ok(Math.abs(startUtc-metadataUtc-delta)<=100,'Resource UTC/monotonic clocks disagree');
  assert.ok(delta+duration<=(phase.maxResourceSnapshotDelayMs??5000),'Resource snapshot exceeded bounded observation window');
  const rows=metrics.processes;
  assert.ok(Array.isArray(rows)&&rows.length>0,'Process metrics missing');
  assert.equal(new Set(rows.map(row=>row.pid)).size,rows.length,'Duplicate process metrics');
  const root=rows.find(row=>row.pid===report.launchBinding.pid);assert.ok(root,'Launched PID absent from metrics');
  assert.equal(root.startFileTimeUtc,report.launchBinding.startFileTimeUtc,'Metrics PID creation binding mismatch');
  const owned=new Set([report.launchBinding.pid]);let count;
  do {count=owned.size;for(const row of rows)if(owned.has(row.parentPid))owned.add(row.pid);}while(owned.size!==count);
  assert.ok(rows.every(row=>owned.has(row.pid)),'Metrics PID outside launched process tree');
  assert.ok(owned.has(report.rendererPid),'Reported renderer PID missing from owned process tree');
  return {resourceSnapshotDeltaMs:delta,resourceSnapshotDurationMs:duration};
}
export function validateRestoration(phase,confirmation,reports) {
  assert.equal(confirmation?.activeConfirmed,true,'Original working configuration has no active confirmation');
  assert.equal(confirmation.reopened,true,'Original configuration must be confirmed after full reopen');
  assert.equal(confirmation.phaseId,phase.phaseId,'Restore phase mismatch');
  assert.equal(confirmation.identityDigest,phase.identityDigest,'Restore identity mismatch');
  assert.deepEqual(confirmation.settings,phase.originalSettings,'Restored active settings mismatch');
  assert.deepEqual(confirmation.savedSettings,phase.originalSettings,'Restored saved settings mismatch');
  assert.equal(confirmation.status?.status,'applied','Restored runtime not applied');
  assert.equal(confirmation.status.pendingReload,false,'Restored runtime still pending');
  assert.equal(confirmation.status.fallback,false,'Restored runtime used fallback');
  assert.deepEqual(confirmation.status.initial,{started:true,completed:true,layoutReady:true},'Restore initial traversal incomplete');
  assert.equal(confirmation.metadataCompletion?.clean,true,'Restored metadata incomplete');
  assert.equal(confirmation.metadataCompletion.timedOut,false,'Restored metadata timeout');
  assert.equal(confirmation.launchBinding?.phaseId,phase.phaseId,'Restore launch phase mismatch');
  assert.equal(confirmation.launchBinding.profile,phase.profile,'Restore launch profile mismatch');
  assert.ok(!reports.some(report=>report.launchBinding.launchId===confirmation.launchBinding.launchId),'Restore confirmation requires a fresh launch');
  const final=reports.at(-1);
  assert.ok(utc(confirmation.metadataCompletion.utc,'Restore')>=utc(final.metadataCompletion.utc,'Final sample'),'Restore observation precedes final sample');
  assert.ok(ns(confirmation.metadataCompletion.monotonicNs,'Restore')>=ns(final.metadataCompletion.monotonicNs,'Final sample'),'Restore monotonic observation precedes final sample');
}
export function validateSample(phase,report,{processMetrics=true,corpusVerification=true}={}) {
  assertIdentity(phase.identity);
  assert.equal(report.phaseId,phase.phaseId,'Phase mismatch');
  assert.equal(report.vault.replaceAll('\\','/').toLowerCase(),phase.vault.replaceAll('\\','/').toLowerCase(),'Vault mismatch');
  assert.equal(report.profile.replaceAll('\\','/').toLowerCase(),phase.profile.replaceAll('\\','/').toLowerCase(),'Profile mismatch');
  assert.equal(report.configDir,phase.configDir,'Config directory mismatch');
  assert.equal(digest(report.identity),phase.identityDigest,'Package identity/fingerprint/file SHA mismatch');
  assert.equal(report.identityDigest,phase.identityDigest,'Identity digest mismatch');
  assert.equal(report.version,phase.identity.version,'Version mismatch');
  assert.equal(report.apiVersion,phase.hostApiVersion,'Native host API version mismatch');
  assert.equal(report.sourceDigest,phase.sourceDigest,'Source snapshot mismatch');
  assert.equal(report.corpusDigest,phase.corpusDigest,'Corpus mismatch');
  if(corpusVerification){
    assert.equal(report.corpusVerification?.status,'PASS','Corpus verification failed');
    assert.equal(report.corpusVerification.digest,phase.corpusDigest,'Corpus verification mismatch');
    for(const key of ['phaseId','pair','mode','sampleKind','reportIdentity'])assert.equal(report.corpusVerification[key],report[key],`Corpus ${key} binding mismatch`);
    assert.equal(report.corpusVerification.afterAppQuit,true,'Corpus census must be outside app observation window');
  }
  assert.ok(['Baseline','Filtered'].includes(report.mode),'Unknown sample mode');
  assert.deepEqual(report.settings,{schemaVersion:1,rules:report.mode==='Baseline'?'':'Technical',displayName:''},'Rules/alias mismatch');
  assert.equal(report.pluginsEnabled,true,'Plugins not trusted/enabled');
  assert.equal(report.pluginStatus?.status,'applied','Plugin not applied');
  assert.equal(report.pluginStatus.pendingReload,false,'Pending reload');
  assert.equal(report.pluginStatus.fallback,false,'Fallback configuration is not a comparable sample');
  assert.deepEqual(report.pluginStatus.initial,{started:true,completed:true,layoutReady:true},'Initial traversal incomplete');
  assert.equal(report.observedStartup,true,'Startup incomplete');
  assert.equal(report.trace?.fixtureOnly,true,'Fixture trace required');
  assert.equal(report.trace.base.replaceAll('\\','/').toLowerCase(),phase.vault.replaceAll('\\','/').toLowerCase(),'Observer vault mismatch');
  assert.equal(report.trace.profile.replaceAll('\\','/').toLowerCase(),phase.profile.replaceAll('\\','/').toLowerCase(),'Observer profile mismatch');
  assert.equal(report.trace.dropped,0,'Dropped startup trace');
  assert.ok(Array.isArray(report.trace.events),'Startup trace missing');
  const events=report.trace.events;
  for(const method of ['vault-load-start','vault-load-end','layout-ready'])assert.equal(events.filter(event=>event.method===method).length,1,`Startup trace ${method} count`);
  assert.ok(!events.some(event=>event.method==='vault-load-error'),'Startup trace error');
  const start=events.find(event=>event.method==='vault-load-start'),end=events.find(event=>event.method==='vault-load-end'),layout=events.find(event=>event.method==='layout-ready');
  for(const event of events){finite(event.at,'Trace timestamp');if(event.kind==='io'){assert.ok(['readFile','readdir','lstat','stat','realpath'].includes(event.method),'Unknown I/O method');assert.equal(typeof event.path,'string','I/O path missing');}}
  assert.ok(start.at<=end.at&&end.at<=layout.at,'Invalid startup trace order');
  finite(report.technicalIo,'Technical I/O');finite(report.vaultLoadDurationMs,'Vault load time');finite(report.rendererLayoutMs,'Renderer layout time');
  assert.equal(report.vaultLoadDurationMs,end.durationMs,'Vault timing mismatch');
  assert.equal(report.rendererLayoutMs,layout.at,'Layout timing mismatch');
  const scan=events.filter(event=>event.kind==='io'&&event.phase!=='prepare');
  assert.ok(scan.length>0,'No scanner I/O evidence');
  assert.equal(report.technicalIo,scan.filter(event=>technical(event.path)).length,'Technical I/O aggregate mismatch');
  assert.equal(report.metadataCompletion?.clean,true,'Metadata cache incomplete');
  assert.equal(report.metadataCompletion.timedOut,false,'Metadata cache timeout');
  finite(report.metadataCompletion.at,'Metadata completion time');
  assert.ok(report.metadataCompletion.at>=layout.at,'Metadata time predates layout');
  utc(report.metadataCompletion.utc,'Metadata');ns(report.metadataCompletion.monotonicNs,'Metadata');
  assert.ok(Number.isSafeInteger(report.launchBinding?.pid)&&report.launchBinding.pid>0,'Launch PID binding missing');
  assert.equal(report.launchBinding.profile,phase.profile,'Launch profile binding mismatch');
  assert.ok(Array.isArray(report.index)&&Array.isArray(report.metadata),'Index/metadata missing');
  assert.equal(new Set(report.index).size,report.index.length,'Duplicate index entry');
  assert.equal(new Set(report.metadata).size,report.metadata.length,'Duplicate metadata entry');
  assert.deepEqual(normalizeIndex(report.index),expectedIndex(phase.corpus,report.mode),'Index does not match corpus projection');
  const required=expectedMetadata(phase.corpus,report.mode),actual=new Set(report.metadata);
  assert.ok(required.every(name=>actual.has(name)),'Allowed markdown metadata missing');
  assert.ok(report.metadata.every(name=>Object.hasOwn(phase.corpus,name)&&visible(name,report.mode)),'Metadata outside allowed corpus');
  assert.equal(report.reportIdentity,startupDigest(report),'Startup report identity mismatch');
  const row={pair:report.pair,mode:report.mode,index:report.index.length,metadata:report.metadata.length,technicalIo:report.technicalIo,io:Object.fromEntries(['readFile','readdir','lstat','stat','realpath'].map(method=>[method,scan.filter(event=>event.method===method).length])),vaultLoadMs:report.vaultLoadDurationMs,rendererLayoutMs:report.rendererLayoutMs,metadataCompletionMs:report.metadataCompletion.at};
  if(!processMetrics)return row;
  const metrics=report.processMetrics;
  assert.equal(metrics?.measuredAfterMetadata,true,'Process metrics must follow metadata completion');
  const resource=validateResourceBinding(phase,report,metrics);
  if(corpusVerification){
    assert.ok(utc(report.corpusVerification.startedUtc,'Corpus census')>=utc(metrics.snapshotFinishedUtc,'Snapshot end'),'Corpus census precedes resource snapshot');
    assert.ok(ns(report.corpusVerification.startedMonotonicNs,'Corpus census')>=ns(metrics.snapshotFinishedMonotonicNs,'Snapshot end'),'Corpus census precedes resource snapshot on monotonic clock');
  }
  for(const row of metrics.processes){assert.ok(Number.isSafeInteger(row.pid)&&row.pid>0,'Invalid process PID');for(const key of ['cpuSeconds','workingSetBytes','peakWorkingSetBytes'])finite(row[key],key);assert.ok(row.peakWorkingSetBytes>=row.workingSetBytes,'Invalid process peak');}
  for(const [aggregate,field] of [['cpuSeconds','cpuSeconds'],['workingSetBytes','workingSetBytes'],['aggregateProcessPeakWorkingSetBytes','peakWorkingSetBytes']]){
    finite(metrics[aggregate],aggregate);const sum=metrics.processes.reduce((value,row)=>value+row[field],0);assert.ok(Math.abs(sum-metrics[aggregate])<=Math.max(1e-9,sum*1e-12),'Process aggregate mismatch');
  }
  return {...row,...resource,cpuSeconds:metrics.cpuSeconds,workingSetMiB:metrics.workingSetBytes/1048576,aggregateProcessPeakMiB:metrics.aggregateProcessPeakWorkingSetBytes/1048576};
}
const median=values=>{const sorted=[...values].sort((a,b)=>a-b),i=Math.floor(sorted.length/2);return sorted.length%2?sorted[i]:(sorted[i-1]+sorted[i])/2;};
export function summarizeSamples(phase,reports) {
  assert.ok(Number.isSafeInteger(phase.samples)&&phase.samples>=5&&phase.samples<=20,'At least five samples per mode required');
  assert.equal(reports.length,phase.samples*2,'Missing pairs/samples');
  const samples={Baseline:[],Filtered:[]},reference={};
  reports.forEach((report,i)=>{
    assert.equal(report.sampleKind,'measurement','Warm-up must not count as a measured sample');
    assert.equal(report.pair,Math.floor(i/2)+1,'Invalid pair order/duplicate');
    assert.equal(report.mode,i%2?'Filtered':'Baseline','Invalid alternating sample order');
    const row=validateSample(phase,report),key=report.mode;
    const projection=digest({index:normalizeIndex(report.index),metadata:[...report.metadata].sort()});
    if(reference[key])assert.equal(projection,reference[key],'Inconsistent repeated index/metadata');else reference[key]=projection;
    samples[key].push(row);
  });
  const keys=['technicalIo','vaultLoadMs','rendererLayoutMs','metadataCompletionMs','resourceSnapshotDeltaMs','resourceSnapshotDurationMs','cpuSeconds','workingSetMiB','aggregateProcessPeakMiB'];
  const medians=Object.fromEntries(Object.entries(samples).map(([mode,rows])=>[mode,Object.fromEntries(keys.map(key=>[key,median(rows.map(row=>row[key]))]))]));
  const reduction=key=>medians.Baseline[key]>0?(1-medians.Filtered[key]/medians.Baseline[key])*100:null;
  return {schemaVersion:1,status:'PASS',statusMeaning:'comparable evidence validation only; does not close all Task 6 platform/performance gates',phaseId:phase.phaseId,identity:phase.identity,identityDigest:phase.identityDigest,sourceDigest:phase.sourceDigest,corpusDigest:phase.corpusDigest,mode:'full app restart; same trusted profile; warm OS and retained profile metadata caches; enabled Sieve empty/Technical rules',samples,medians,reductionPercent:Object.fromEntries(keys.filter(key=>!key.startsWith('resourceSnapshot')).map(key=>[key,reduction(key)])),readingFilesMs:null,rulesCompileMs:null,osIoTrace:null,limitations:['Not an OS-cold measurement; source census warms filesystem cache before each launch and repeats only after normal quit','Adapter I/O after fixture observer loads; no system OS I/O trace','Renderer timing uses performance.now from renderer time origin, not OS process launch','Metadata completion timestamp is first clean-state observation after layout; polling resolution 50 ms, connection/setup delay may add time','CPU and working-set snapshots follow native report; UTC/monotonic delta and snapshot duration are recorded, total window capped at 5000 ms','Snapshot delay/duration are instrument diagnostics, not application performance gains','Sum of individual process peaks is not simultaneous whole-app peak','Reading files UI and isolated rules compile timers are not observed','Baseline retains enabled Sieve with empty rules; does not measure plugin-disabled startup','Synthetic owned fixture only; no original user vault']};
}
