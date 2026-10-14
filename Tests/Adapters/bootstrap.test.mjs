import assert from 'node:assert/strict';
import test from 'node:test';
import {loadRuntime} from '../Fixtures/load-runtime.mjs';
import {fakeHost} from '../Fixtures/host-adapter.mjs';
import {uiSdk as sdk} from '../Fixtures/ui-host.mjs';
const {default:SievePlugin}=await loadRuntime('main',sdk);
function configured(rules='Technical'){
  const host=fakeHost();const path='.custom/plugins/sieve/data.json';const data=new Map([[path,JSON.stringify({schemaVersion:1,rules,displayName:'Demo'})]]);const writes=[];
  Object.assign(host.adapter,{async exists(p){return data.has(p);},async read(p){return data.get(p);},async write(p,value){writes.push(p);data.set(p,value);}});return{...host,data,writes,path};
}
test('bootstrap compiles and installs before returning; observed status and saved settings are serializable',async()=>{
  const host=configured();const plugin=new SievePlugin(host.app);await plugin.onload();assert.equal(plugin.getStatus().status,'pending');assert.equal(plugin.savedSettings.rules,'Technical');
  await host.app.vault.load();host.layout();assert.equal(plugin.getStatus().status,'applied');assert.equal(plugin.getStatus().initial.completed,true);assert.ok(!JSON.stringify(plugin.getStatus()).includes('adapter'));
  assert.equal((await plugin.saveSettings({schemaVersion:1,rules:'Other',displayName:'Renamed'})).ok,true);assert.equal(plugin.getStatus().pendingReload,true);assert.equal(plugin.getStatus().status,'applied');assert.equal(plugin.activeSettings.rules,'Technical');assert.equal(plugin.savedSettings.rules,'Other');plugin.onunload();assert.equal(plugin.getStatus().status,'disposed');
});
test('unsupported host shows exact Russian incompatibility text without touching native methods',async()=>{
  const host=configured();const original=host.adapter.listRecursiveChild;Object.defineProperty(host.adapter,'trigger',{value:host.adapter.trigger,configurable:false});globalThis.__sieveTestLanguage='ru';globalThis.__sieveTestNotices=[];
  const plugin=new SievePlugin(host.app);await plugin.onload();assert.equal(plugin.getStatus().status,'unsupported');assert.equal(host.adapter.listRecursiveChild,original);assert.ok(globalThis.__sieveTestNotices.includes('Эта версия Obsidian не поддерживает фильтрацию Sieve'));plugin.onunload();globalThis.__sieveTestLanguage='en';
});
test('unload during configuration IO prevents late hook activation and notices',async()=>{
  const host=configured();let release;const delayed=new Promise(r=>{release=r;});host.adapter.read=async()=>delayed;const original=host.adapter.listRecursiveChild;globalThis.__sieveTestNotices=[];
  const plugin=new SievePlugin(host.app);const pending=plugin.onload();await new Promise(r=>setTimeout(r,0));plugin.onunload();release(host.data.get(host.path));await pending;
  assert.equal(host.adapter.listRecursiveChild,original);assert.equal(plugin.getStatus().status,'disposed');assert.deepEqual(globalThis.__sieveTestNotices,[]);
});
