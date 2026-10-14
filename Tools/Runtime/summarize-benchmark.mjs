import {readFile,readdir,writeFile,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const run=await realpath(process.argv[2]);
const count=Number(process.argv[3]);
const allowed=await realpath(fileURLToPath(new URL('../../Local/.temp/SieveProbe/',import.meta.url)));
if(!run.startsWith(allowed+path.sep)||!Number.isInteger(count)||count<5||count>20)throw Error('Generated benchmark fixture and at least five samples required');
const definition=JSON.parse(await readFile(path.join(run,'run.json'),'utf8'));
if(!definition.runtimeFixture)throw Error('Runtime fixture marker missing');
const directory=path.join(run,'Reports');
const names=await readdir(directory);
const samples={};
for(const variant of ['Baseline','Filtered']){
  const selected=names.filter(name=>name.endsWith(`-${variant}-startup.json`)).sort().slice(-count);
  if(selected.length!==count)throw Error('Missing comparable samples');
  samples[variant]=[];
  for(const name of selected){
    const report=JSON.parse(await readFile(path.join(directory,name),'utf8'));
    const metrics=JSON.parse(await readFile(path.join(directory,name.replace('-startup.json','-process-metrics.json')),'utf8'));
    if(!report.observedStartup||report.pluginStatus?.status!=='applied'||report.pluginStatus.pendingReload||report.version!==definition.identity.version||report.technicalIo===null||report.rendererLayoutMs===null)throw Error('Incomplete or mismatched benchmark evidence');
    const scan=report.trace.events.filter(event=>event.kind==='io'&&event.phase!=='prepare');
    samples[variant].push({report:name,index:report.index.length,metadata:report.metadata.length,technicalIo:report.technicalIo,io:Object.fromEntries(['readFile','readdir','lstat','stat','realpath'].map(method=>[method,scan.filter(event=>event.method===method).length])),vaultLoadMs:report.vaultLoadDurationMs,rendererLayoutMs:report.rendererLayoutMs,cpuSeconds:metrics.cpuSeconds,workingSetMiB:metrics.workingSetBytes/1048576,aggregateProcessPeakMiB:metrics.aggregateProcessPeakWorkingSetBytes/1048576});
  }
}
const median=values=>{const a=[...values].sort((x,y)=>x-y);const i=Math.floor(a.length/2);return a.length%2?a[i]:(a[i-1]+a[i])/2;};
const medians=Object.fromEntries(Object.entries(samples).map(([variant,rows])=>[variant,Object.fromEntries(['technicalIo','vaultLoadMs','rendererLayoutMs','cpuSeconds','workingSetMiB','aggregateProcessPeakMiB'].map(key=>[key,median(rows.map(row=>row[key]))]))]));
const output={runtimeFixture:true,mode:'full app restart; warm OS and per-profile metadata caches; alternating baseline/filtered',identity:definition.identity,samples,medians,limitations:['Not an OS-cold measurement','rendererLayoutMs starts at renderer performance.timeOrigin, not process launch','CPU and memory measured after layout/400ms settle; aggregate per-process peaks are not simultaneous whole-app peak','Reading files UI timer and isolated rules compile timer are not observed','Synthetic documents only; no original user vault']};
const target=path.join(directory,`benchmark-${new Date().toISOString().replaceAll(/[:.]/g,'-')}.json`);
await writeFile(target,JSON.stringify(output,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({report:target,medians,limitations:output.limitations},null,2));
