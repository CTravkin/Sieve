import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {quitOwnedHost} from '../../Tools/Runtime/benchmark-native.mjs';

const run=path.resolve(fileURLToPath(new URL('../../Local/.temp/SieveProbe/Runtime-unit',import.meta.url)));
const binding={schemaVersion:1,phaseId:'Benchmark-unit',launchId:'7a6e90a1-c54c-4198-8f80-3391bdbf5566',run,vault:path.join(run,'Filtered'),profile:path.join(run,'Profiles/Filtered'),physicalProfile:path.join(run,'Profiles/Filtered'),configDir:'.obsidian',pid:42,port:9229,executablePath:path.resolve('/apps/Obsidian.exe'),startFileTimeUtc:'133700000000000000',startedUtc:'2026-10-14T08:00:00.000Z'};
const os=()=>({pid:42,startFileTimeUtc:binding.startFileTimeUtc,executablePath:binding.executablePath,commandLine:`Obsidian.exe --user-data-dir="${binding.profile}" --sieve-benchmark-launch=${binding.launchId}`,portOwners:[42],processes:[{pid:42,parentPid:1},{pid:43,parentPid:42}]});
function client({profile=binding.profile,rendererPid=43,files=new Map()}={}) {
  const calls=[];
  return {calls,closed:false,close(){this.closed=true;},async evaluate(body){
    return vm.runInNewContext(`(async()=>{${body}})()`,{require:name=>{
      if(name==='process')return {pid:rendererPid,platform:'win32'};
      if(name==='@electron/remote')return {app:{getPath:()=>profile,quit:()=>calls.push('quit')}};
      throw new Error(`Unexpected fixture/source access: ${name}; mutated file count ${files.size}`);
    },setTimeout:callback=>callback()});
  }};
}
test('immutable launch binding still quits when marker/run/registry/source/evidence change and vault never becomes ready',async()=>{
  const captured=JSON.parse(JSON.stringify(binding));
  const files=new Map([['run.json','original marker'],['obsidian.json','original vault'],['community-plugins.json','enabled'],['preparation.json','original evidence'],['source.md','original bytes']]);
  // The launch binding was captured before every independently mutable input.
  for(const name of files.keys())files.set(name,`corrupted after launch: ${name}`);
  const native=client({files});let probes=0;
  const result=await quitOwnedHost(captured,{readOs:async()=>{probes++;return os();},connect:async()=>native});
  assert.equal(result.quitting,true);assert.equal(result.launchPid,42);assert.equal(probes,2);
  assert.deepEqual(native.calls,['quit']);assert.equal(native.closed,true);
});
test('wrong launch PID, creation time, nonce, port owner or renderer ancestry preserve the process',async()=>{
  for(const mutate of [value=>value.pid=44,value=>value.startFileTimeUtc='1',value=>value.commandLine='Obsidian.exe',value=>value.portOwners=[999],value=>value.processes[1].parentPid=999]){
    const state=os();mutate(state);const native=client();
    await assert.rejects(quitOwnedHost(binding,{readOs:async()=>state,connect:async()=>native}),/binding|owner|nonce|ancestry/i);
    assert.deepEqual(native.calls,[]);
  }
});
test('foreign actual userData profile and ownership drift between connection and quit refuse action',async()=>{
  const foreign=client({profile:path.resolve('/personal/Obsidian')});
  await assert.rejects(quitOwnedHost(binding,{readOs:async()=>os(),connect:async()=>foreign}),/profile/i);assert.deepEqual(foreign.calls,[]);
  const native=client();let probes=0;
  await assert.rejects(quitOwnedHost(binding,{readOs:async()=>{const state=os();if(++probes===2)state.portOwners=[999];return state;},connect:async()=>native}),/owner/i);
  assert.deepEqual(native.calls,[]);assert.equal(native.closed,true);
});
test('quit-only binding cannot target an arbitrary profile outside the generated fixture',async()=>{
  let connected=false;
  await assert.rejects(quitOwnedHost({...binding,profile:path.resolve('/personal/Obsidian')},{readOs:async()=>os(),connect:async()=>{connected=true;return client();}}),/binding|fixture|profile/i);
  assert.equal(connected,false);
});
