import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {loadRuntime} from '../Fixtures/load-runtime.mjs';
const {desktopIncludeReader}=await loadRuntime('platform/desktop');
const {mobileIncludeReader}=await loadRuntime('platform/mobile');

test('desktop include access uses the existing provider and losslessly copies cross-realm bytes',async()=>{
  const bytes=vm.runInNewContext('new Uint8Array([47,47,255,10,65])');const calls=[];
  const reader=desktopIncludeReader({getFullRealPath:p=>'/own-vault/'+p,fsPromises:{async readFile(p){calls.push(p);return bytes;}}});
  const result=await reader('../common');assert.deepEqual([...result],[47,47,255,10,65]);bytes[0]=0;assert.equal(result[0],47);assert.deepEqual(calls,['/own-vault/../common']);
});
test('mobile include reads keep lexical relative paths and provider sandbox failures remain safe errors',async()=>{
  const calls=[];const bytes=vm.runInNewContext('new Uint8Array([0,255,128]).buffer');const reader=mobileIncludeReader({async readBinary(p){calls.push(p);if(p==='../denied')throw Error('neighbor-sensitive-content');return bytes;}});
  assert.deepEqual([...await reader('../common')],[0,255,128]);await assert.rejects(reader('../denied'),error=>error.message==='Include read failed');assert.deepEqual(calls,['../common','../denied']);
});
test('an unsupported binary provider result cannot silently become an empty include',async()=>{
  const reader=mobileIncludeReader({async readBinary(){return {[Symbol.toStringTag]:'ArrayBuffer'};}});await assert.rejects(reader('common'),/Include read failed/);
});
