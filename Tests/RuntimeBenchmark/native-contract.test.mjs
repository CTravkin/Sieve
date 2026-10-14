import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {exactContextBody,metadataCompletionBody} from '../../Tools/Runtime/benchmark-native.mjs';

const phase={vault:'/fixture/Filtered',profile:'/fixture/Profiles/Filtered',configDir:'.obsidian'};
function evaluate(body,overrides={}) {
  return vm.runInNewContext(`(async()=>{${body}})()`,{vaultPath:phase.vault,profile:phase.profile,app:{vault:{configDir:phase.configDir}},require:name=>name==='process'?{platform:'linux',hrtime:{bigint:()=>1000000000n}}:{promises:{realpath:async p=>p}},...overrides});
}
test('native actions bind the exact selected vault/profile/configDir before side effects',async()=>{
  assert.equal(await evaluate(exactContextBody(phase,'return true;')),true);
  for(const overrides of [{vaultPath:'/fixture/Baseline'},{profile:'/fixture/Profiles/Baseline'},{app:{vault:{configDir:'.other'}}},{require:name=>name==='process'?{platform:'linux'}:{promises:{realpath:async p=>p===phase.vault?'/outside/vault':p===phase.profile?'/outside/profile':p}}}]){
    if(overrides.require){
      // Distinct spelling resolves a lexical match to another physical target.
      overrides.vaultPath=phase.vault;let seen=0;
      overrides.require=name=>name==='process'?{platform:'linux'}:{promises:{realpath:async p=>p===phase.vault&&seen++===0?'/outside/vault':p}};
    }
    await assert.rejects(evaluate(exactContextBody(phase,'throw new Error("SIDE EFFECT REACHED");'),overrides),/mismatch/);
  }
});
test('metadata completion waits on actual cache clean state and uses renderer performance time',async()=>{
  let polls=0,time=123,waits=0;
  const result=await evaluate(`${metadataCompletionBody(10000)}return metadataCompletion;`,{app:{metadataCache:{isCacheClean:()=>++polls>=3}},performance:{now:()=>time},setTimeout:resolve=>{time+=50;waits++;resolve();}});
  assert.equal(polls,3);assert.equal(waits,2);assert.equal(result.at,223);assert.equal(result.clean,true);
});
test('metadata timeout and missing native API reject instead of accepting fixed settle',async()=>{
  await assert.rejects(evaluate(metadataCompletionBody(10000),{app:{metadataCache:{}},performance:{now:()=>0}}),/API unavailable/);
  let time=0;
  await assert.rejects(evaluate(metadataCompletionBody(10000),{app:{metadataCache:{isCacheClean:()=>false}},performance:{now:()=>time},setTimeout:resolve=>{time+=5000;resolve();}}),/timed out/);
});
