// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import {loadRuntime} from '../Fixtures/load-runtime.mjs';

test('timeouts cancel through the window that scheduled them even after the active window changes',async()=>{
  const runtime=await loadRuntime('platform/timer');
  const calls=[];
  globalThis.window={setTimeout(callback,delay){calls.push(['start',delay]);return 37;},clearTimeout(id){calls.push(['cancel',id]);}};
  try{const cancel=runtime.scheduleTimeout(()=>{},123);globalThis.window={clearTimeout(){throw Error('Wrong owner');}};cancel();assert.deepEqual(calls,[['start',123],['cancel',37]]);}
  finally{delete globalThis.window;}
});

test('portable timeout fallback still fires and can be cancelled without a DOM',async()=>{
  const {scheduleTimeout}=await loadRuntime('platform/timer');
  await new Promise(resolve=>scheduleTimeout(resolve,0));let fired=false;const cancel=scheduleTimeout(()=>{fired=true;},0);cancel();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(fired,false);
});

test('portable cancellation retains its timer provider after the global timer functions change',async()=>{
  const {scheduleTimeout}=await loadRuntime('platform/timer');
  const originalStart=globalThis.setTimeout,originalCancel=globalThis.clearTimeout,calls=[];
  globalThis.setTimeout=(_callback,delay)=>{calls.push(['start',delay]);return 41;};
  globalThis.clearTimeout=id=>calls.push(['cancel',id]);
  try{
    const cancel=scheduleTimeout(()=>{},125);
    globalThis.clearTimeout=()=>{throw Error('Wrong portable timer provider');};
    cancel();
    assert.deepEqual(calls,[['start',125],['cancel',41]]);
  }finally{globalThis.setTimeout=originalStart;globalThis.clearTimeout=originalCancel;}
});
