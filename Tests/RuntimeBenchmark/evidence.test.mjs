import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {assertBoundPath, assertOutputPath, validateSample, validateRestoration, summarizeSamples, digest, startupDigest, expectedIndex, expectedMetadata} from '../../Tools/Runtime/benchmark-evidence.mjs';

const identity={privateCandidate:true,version:'0.5.3',build:13,sourceFingerprint:'a'.repeat(64),files:{'main.js':'b'.repeat(64),'manifest.json':'c'.repeat(64)}};
const corpus={'Docs/a.md':'1'.repeat(64),'Technical/Bench-1/hidden.md':'2'.repeat(64),'Board.canvas':'3'.repeat(64)};
const phase={schemaVersion:1,phaseId:'Benchmark-test',vault:'/repo/Local/.temp/SieveProbe/Runtime-test/Filtered',profile:'/repo/Local/.temp/SieveProbe/Runtime-test/Profiles/Filtered',configDir:'.obsidian',identity,identityDigest:digest(identity),corpusDigest:digest(corpus),corpus,sourceDigest:'d'.repeat(64),samples:5,hostApiVersion:'1.14.4'};
function sign(report){report.reportIdentity=startupDigest(report);report.processMetrics.reportIdentity=report.reportIdentity;report.corpusVerification.reportIdentity=report.reportIdentity;return report;}
function sample(mode='Baseline',pair=1) {
  const events=[{kind:'lifecycle',method:'vault-load-start',at:10},{kind:'io',method:'readdir',path:'',at:11,phase:'scan'},...(mode==='Baseline'?[{kind:'io',method:'readFile',path:'Technical/Bench-1/hidden.md',at:12,phase:'scan'}]:[]),{kind:'lifecycle',method:'vault-load-end',at:20,durationMs:10},{kind:'lifecycle',method:'layout-ready',at:25}];
  const report={phaseId:phase.phaseId,sampleKind:'measurement',pair,mode,identity,identityDigest:phase.identityDigest,sourceDigest:phase.sourceDigest,corpusDigest:phase.corpusDigest,vault:phase.vault,profile:phase.profile,configDir:phase.configDir,pluginsEnabled:true,version:identity.version,apiVersion:phase.hostApiVersion,settings:{schemaVersion:1,rules:mode==='Baseline'?'':'Technical',displayName:''},pluginStatus:{status:'applied',fallback:false,pendingReload:false,initial:{started:true,completed:true,layoutReady:true}},index:expectedIndex(corpus,mode),metadata:expectedMetadata(corpus,mode),metadataCompletion:{clean:true,timedOut:false,at:30,utc:'2026-10-14T08:00:00.000Z',monotonicNs:'1000000000'},trace:{fixtureOnly:true,base:phase.vault,profile:phase.profile,dropped:0,events},observedStartup:true,technicalIo:mode==='Baseline'?1:0,vaultLoadDurationMs:10,rendererLayoutMs:25,rendererPid:2,launchBinding:{phaseId:phase.phaseId,profile:phase.profile,pid:1,launchId:`launch-${pair}-${mode}`,startFileTimeUtc:'133700000000000000'}};
  const bound={phaseId:phase.phaseId,pair,mode,sampleKind:'measurement'};
  report.processMetrics={...bound,identityDigest:phase.identityDigest,launchPid:1,launchId:report.launchBinding.launchId,metadataCompletionUtc:report.metadataCompletion.utc,metadataCompletionMonotonicNs:report.metadataCompletion.monotonicNs,measuredAfterMetadata:true,snapshotStartedUtc:'2026-10-14T08:00:00.100Z',snapshotFinishedUtc:'2026-10-14T08:00:00.200Z',snapshotStartedMonotonicNs:'1100000000',snapshotFinishedMonotonicNs:'1200000000',deltaFromMetadataMs:100,snapshotDurationMs:100,processes:[{pid:1,parentPid:999,startFileTimeUtc:report.launchBinding.startFileTimeUtc,cpuSeconds:0.2,workingSetBytes:100,peakWorkingSetBytes:150},{pid:2,parentPid:1,startFileTimeUtc:'133700000000000001',cpuSeconds:0.1,workingSetBytes:50,peakWorkingSetBytes:75}],cpuSeconds:0.3,workingSetBytes:150,aggregateProcessPeakWorkingSetBytes:225};
  report.corpusVerification={...bound,status:'PASS',digest:phase.corpusDigest,afterAppQuit:true,startedUtc:'2026-10-14T08:00:00.300Z',startedMonotonicNs:'1300000000'};
  return sign(report);
}
function rows(){return Array.from({length:5},(_,i)=>[sample('Baseline',i+1),sample('Filtered',i+1)]).flat();}

test('five ordered pairs in one profile validate and preserve honest timing/memory labels',()=>{
  const result=summarizeSamples(phase,rows());
  assert.equal(result.samples.Baseline.length,5);
  assert.equal(result.medians.Filtered.technicalIo,0);
  assert.equal(result.medians.Baseline.metadataCompletionMs,30);
  assert.equal(result.readingFilesMs,null);
  assert.equal(result.rulesCompileMs,null);
  assert.equal(result.osIoTrace,null);
  assert.match(result.limitations.join(' '),/not simultaneous/i);
});

test('missing/incomplete startup and dropped traces never become zero technical I/O',()=>{
  for(const mutate of [r=>r.observedStartup=false,r=>r.trace.dropped=1,r=>r.trace.events.pop(),r=>r.trace.events.push({kind:'lifecycle',method:'vault-load-error'}),r=>r.trace.events.push({kind:'lifecycle',method:'vault-load-start'})]){
    const r=sample('Filtered');mutate(r);assert.throws(()=>validateSample(phase,r),/startup|trace/i);
  }
});

test('metadata timeout, disabled plugin, fallback and pending reload fail evidence',()=>{
  for(const mutate of [r=>r.metadataCompletion.timedOut=true,r=>r.metadataCompletion.clean=false,r=>r.pluginsEnabled=false,r=>r.pluginStatus.pendingReload=true,r=>r.pluginStatus.fallback=true,r=>r.pluginStatus.status='error',r=>r.pluginStatus.initial.completed=false]){
    const r=sample();mutate(r);assert.throws(()=>validateSample(phase,r));
  }
});

test('version, fingerprint, actual file SHA, corpus and source drift are fatal',()=>{
  for(const mutate of [r=>r.version='0.5.0',r=>r.apiVersion='1.14.5',r=>r.trace.base+='/Other',r=>r.identity={...r.identity,sourceFingerprint:'e'.repeat(64)},r=>r.identity={...r.identity,files:{...r.identity.files,'main.js':'e'.repeat(64)}},r=>r.corpusDigest='e'.repeat(64),r=>r.sourceDigest='e'.repeat(64),r=>r.corpusVerification.status='FAIL',r=>r.profile+='/Other',r=>r.settings.rules='Technical\nDocs',r=>r.settings.displayName='Alias']){
    const r=sample();mutate(r);assert.throws(()=>validateSample(phase,r));
  }
});

test('index must equal source projection and metadata must include every allowed markdown file',()=>{
  for(const mutate of [r=>r.index.push('Injected.md'),r=>r.index.pop(),r=>r.metadata.push('Technical/Bench-1/hidden.md'),r=>r.metadata=[],r=>r.index.push(r.index[0])]){
    const r=sample('Filtered');mutate(r);assert.throws(()=>validateSample(phase,r),/index|metadata/i);
  }
  const r=sample();r.metadata.push('Board.canvas');sign(r);assert.doesNotThrow(()=>validateSample(phase,r));
});

test('nonfinite/null values and forged I/O aggregates cannot pass',()=>{
  for(const mutate of [r=>r.technicalIo=null,r=>r.technicalIo=NaN,r=>r.technicalIo=Infinity,r=>r.vaultLoadDurationMs=null,r=>r.rendererLayoutMs=NaN,r=>r.processMetrics.cpuSeconds=Infinity,r=>r.processMetrics.processes[0].workingSetBytes=null,r=>r.technicalIo=0,r=>r.processMetrics.workingSetBytes=99]){
    const r=sample();mutate(r);assert.throws(()=>validateSample(phase,r));
  }
});

test('minimum five samples, unique pairs, exact order and repeated index/cache consistency required',()=>{
  assert.throws(()=>summarizeSamples(phase,rows().slice(0,8)),/samples|pairs/i);
  const duplicate=rows();duplicate[2].pair=1;assert.throws(()=>summarizeSamples(phase,duplicate),/pair|order/i);
  const reorder=rows();[reorder[0],reorder[1]]=[reorder[1],reorder[0]];assert.throws(()=>summarizeSamples(phase,reorder),/order/i);
  const different=rows();different[2].metadata.push('Board.canvas');sign(different[2]);assert.throws(()=>summarizeSamples(phase,different),/consistent|metadata/i);
  const warmup=rows();warmup[0].sampleKind='warmup';assert.throws(()=>summarizeSamples(phase,warmup),/warm-up/i);
});

test('resource evidence from another phase/pair/mode/report/launch cannot be joined by filename',()=>{
  for(const mutate of [m=>m.phaseId='Other',m=>m.pair=2,m=>m.mode='Filtered',m=>m.sampleKind='warmup',m=>m.reportIdentity='a'.repeat(64),m=>m.identityDigest='a'.repeat(64),m=>m.launchPid=99,m=>m.launchId='Other',m=>m.processes[0].startFileTimeUtc='1',m=>m.processes[1].parentPid=999,m=>m.processes.pop()]){
    const r=sample();mutate(r.processMetrics);assert.throws(()=>validateSample(phase,r),/metrics|binding|PID|renderer/i);
  }
});
test('metadata must precede a bounded UTC/monotonic resource snapshot and census must follow quit',()=>{
  for(const mutate of [r=>r.processMetrics.snapshotStartedUtc='2026-10-14T07:59:59.999Z',r=>r.processMetrics.snapshotStartedMonotonicNs='900000000',r=>r.processMetrics.snapshotFinishedMonotonicNs='1000000000',r=>r.processMetrics.deltaFromMetadataMs=999,r=>r.processMetrics.metadataCompletionUtc='2026-10-14T08:00:00.001Z',r=>r.processMetrics.snapshotFinishedMonotonicNs='8000000000',r=>r.corpusVerification.startedUtc='2026-10-14T07:59:59.999Z',r=>r.corpusVerification.startedMonotonicNs='900000000',r=>r.corpusVerification.afterAppQuit=false]){
    const r=sample();mutate(r);assert.throws(()=>validateSample(phase,r),/snapshot|metadata|delta|census|window/i);
  }
  const r=sample();r.processMetrics.snapshotFinishedUtc='2026-10-14T08:00:06.100Z';r.processMetrics.snapshotFinishedMonotonicNs='7100000000';r.processMetrics.snapshotDurationMs=6000;
  assert.throws(()=>validateSample(phase,r),/window/);
});
test('restoration requires original active settings in a fresh fully reopened working run',()=>{
  const original={schemaVersion:1,rules:'Technical',displayName:'Original'},definition={...phase,originalSettings:original};
  const confirmation=()=>({activeConfirmed:true,reopened:true,phaseId:phase.phaseId,identityDigest:phase.identityDigest,settings:{...original},savedSettings:{...original},status:{status:'applied',pendingReload:false,fallback:false,initial:{started:true,completed:true,layoutReady:true}},metadataCompletion:{clean:true,timedOut:false,utc:'2026-10-14T08:00:01.000Z',monotonicNs:'2000000000'},launchBinding:{phaseId:phase.phaseId,profile:phase.profile,launchId:'fresh-restored-launch'}});
  const reports=rows();assert.doesNotThrow(()=>validateRestoration(definition,confirmation(),reports));
  for(const mutate of [value=>value.activeConfirmed=false,value=>value.reopened=false,value=>value.settings.rules='',value=>value.savedSettings.displayName='',value=>value.status.pendingReload=true,value=>value.status.initial.completed=false,value=>value.launchBinding.launchId=reports.at(-1).launchBinding.launchId,value=>value.metadataCompletion.clean=false,value=>value.metadataCompletion.monotonicNs='900000000']){
    const value=confirmation();mutate(value);assert.throws(()=>validateRestoration(definition,value,reports),/restore|restored|working|reopen|active|fresh/i);
  }
});

test('scope guard rejects sibling prefixes, traversal and lexical escape before resolving',async()=>{
  for(const target of ['/repo/vault-evil/file','/repo/vault/../other/file','/repo/vault']){
    let called=false;await assert.rejects(assertBoundPath(target,'/repo/vault',{realpathFn:async p=>{called=true;return p;}}),/boundary/i);assert.equal(called,false);
  }
});

test('physical path guard rejects escaping aliases even if their lexical path is inside',async()=>{
  const physical=async p=>p.replaceAll('\\','/').endsWith('linked/file')?path.resolve('/private/file'):p;
  await assert.rejects(assertBoundPath('/repo/vault/linked/file','/repo/vault',{realpathFn:physical}),/physical/i);
  assert.equal(await assertBoundPath('/repo/vault/Docs/a.md','/repo/vault',{realpathFn:async p=>p}),path.resolve('/repo/vault/Docs/a.md'));
});

test('new output directly under phase is allowed, but escaped output parent is refused',async()=>{
  const identity=async p=>p;
  assert.equal(await assertOutputPath('/repo/phase/report.json','/repo/phase',{realpathFn:identity}),path.resolve('/repo/phase/report.json'));
  await assert.rejects(assertOutputPath('/repo/other/report.json','/repo/phase',{realpathFn:identity}),/boundary/i);
  await assert.rejects(assertOutputPath('/repo/phase/link/report.json','/repo/phase',{realpathFn:async p=>p.replaceAll('\\','/').endsWith('/link')?path.resolve('/private'):p}),/physical/i);
});
