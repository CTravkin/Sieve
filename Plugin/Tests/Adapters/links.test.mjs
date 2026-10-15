// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import {loadRuntime} from '../Fixtures/load-runtime.mjs';
import {fakeHost} from '../Fixtures/host-adapter.mjs';
import {attachLinkManager} from '../Fixtures/link-manager.mjs';
const {compileRules}=await loadRuntime('core/matcher');
const {installFilter}=await loadRuntime('platform/lifecycle');
async function start(mobile,paths=['visible/Target.md','notes/Source.md']){
  const host=fakeHost(mobile,[...paths,'Technical/initial.md']);const links=attachLinkManager(host);
  const compiled=await compileRules('Technical',{platform:'linux'});host.hook=installFilter(host.app,compiled.matcher,mobile?'android':'linux');
  assert.equal(host.hook.status,'ready');await host.app.vault.load();host.layout();await host.metadataCache.drain();return {...host,...links};
}
test('native rename denial remains a user error, and disposal leaves deferred callbacks inert',async()=>{
  const host=await start(false,['visible/Target.md','visible/Existing.md','notes/Source.md']);
  const target=host.app.vault.getFileByPath('visible/Target.md'),source=host.app.vault.getFileByPath('notes/Source.md');
  await assert.rejects(host.manager.renameFile(target,'visible/Existing.md'),/already exists/);assert.equal(host.hook.phase,'applied');
  const ref=host.addRef(source,'visible/Target');await host.manager.renameFile(target,'Technical/Hidden.md');
  let release;host.manager.pending=new Promise(resolve=>{release=resolve;});const deferred=host.manager.renameFile(target,'visible/Returned.md');
  const nativeResolver=host.metadataCache.getLinkpathDest;
  host.hook.dispose();host.metadataCache.getLinkpathDest=function(...args){assert.equal(this,host.metadataCache,'disposed supplemental resolver must not run');return nativeResolver.apply(this,args);};
  release();await deferred;assert.equal(ref.link,'Technical/Hidden');assert.equal(host.hook.phase,'disposed');
});
test('hidden references use native ambiguity and never capture a visible name collision',async()=>{
  const host=await start(false,['visible/Target.md','other/Hidden.md','notes/Source.md']);
  const target=host.app.vault.getFileByPath('visible/Target.md'),source=host.app.vault.getFileByPath('notes/Source.md');
  await host.manager.renameFile(target,'Technical/Hidden.md');
  const visible=host.addRef(source,'Hidden'),exact=host.addRef(source,'/Technical/Hidden');
  await host.manager.renameFile(target,'visible/Returned.md');assert.equal(visible.link,'Hidden');assert.equal(exact.link,'visible/Returned');assert.equal(host.updates.length,1);
});
test('FileExplorer grouped renames use the native shared snapshot',async()=>{
  const host=await start(false,['one/Target.md','two/Second.md','notes/Source.md']);
  const first=host.app.vault.getFileByPath('one/Target.md'),second=host.app.vault.getFileByPath('two/Second.md'),source=host.app.vault.getFileByPath('notes/Source.md');
  const a=host.addRef(source,'one/Target'),b=host.addRef(source,'two/Second');
  await host.manager.renameFile(first,'Technical/First.md');await host.manager.renameFile(second,'Technical/Second.md');
  await host.manager.runAsyncLinkUpdate(async()=>{await host.app.vault.rename(first,'one/Returned.md');await host.app.vault.rename(second,'two/Returned.md');});
  assert.equal(a.link,'one/Returned');assert.equal(b.link,'two/Returned');
});
test('unrelated native operations never retain unchanged hidden targets in their snapshot',async()=>{
  const host=await start(false),target=host.app.vault.getFileByPath('visible/Target.md'),source=host.app.vault.getFileByPath('notes/Source.md');
  const ref=host.addRef(source,'visible/Target');await host.manager.renameFile(target,'Technical/Hidden.md');let observed;
  await host.manager.runAsyncLinkUpdate(snapshot=>{observed=snapshot;});assert.deepEqual(observed,[]);assert.equal(ref.link,'Technical/Hidden');
});
test('nested native callbacks share one snapshot through repeated hidden moves',async()=>{
  const host=await start(false),target=host.app.vault.getFileByPath('visible/Target.md'),source=host.app.vault.getFileByPath('notes/Source.md');
  const ref=host.addRef(source,'visible/Target');await host.manager.renameFile(target,'Technical/Hidden.md');
  await host.manager.runAsyncLinkUpdate(async()=>{await host.manager.renameFile(target,'Technical/Second.md');await host.manager.renameFile(target,'visible/Returned.md');});
  assert.equal(ref.link,'visible/Returned');assert.equal(host.updates.filter(item=>item.reference===ref).length,2,'one update per outer transaction');
});
test('foreign retained link wrapper remains native after filter disposal',async()=>{
  const host=await start(false),retained=host.manager.runAsyncLinkUpdate;
  const foreign=function(...args){return retained.apply(this,args);};host.manager.runAsyncLinkUpdate=foreign;
  host.hook.dispose();assert.equal(host.manager.runAsyncLinkUpdate,foreign);let called=0;await foreign.call(host.manager,()=>{called++;});assert.equal(called,1);assert.equal(host.hook.phase,'disposed');
});
test('concurrent Vault rename follows native FileManager held-target snapshot semantics',async()=>{
  const host=await start(false),target=host.app.vault.getFileByPath('visible/Target.md'),source=host.app.vault.getFileByPath('notes/Source.md');
  const ref=host.addRef(source,'visible/Target');await host.manager.renameFile(target,'Technical/Hidden.md');
  let entered,release;const gate=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{entered=resolve;});
  const operation=host.manager.runAsyncLinkUpdate(async()=>{entered();await gate;});await ready;
  await host.app.vault.rename(target,'visible/Returned.md');release();await operation;assert.equal(ref.link,'visible/Returned');
});
test('new private link seams are checked before any filter hook is installed',async()=>{
  const compiled=await compileRules('Technical',{platform:'linux'});
  for(const key of ['runAsyncLinkUpdate']){
    const host=fakeHost();const before=host.adapter.trigger;Object.defineProperty(host.app.fileManager,key,{value:host.app.fileManager[key],configurable:false});
    assert.equal(installFilter(host.app,compiled.matcher,'linux').status,'unsupported');assert.equal(host.adapter.trigger,before);
  }
});
test('large hidden snapshots preserve every fresh reference and prune unchanged targets',async()=>{
  const host=await start(false),target=host.app.vault.getFileByPath('visible/Target.md'),source=host.app.vault.getFileByPath('notes/Source.md');
  const refs=Array.from({length:1000},(_,offset)=>host.addRef(source,'visible/Target#Heading',{position:{start:{offset}}}));
  await host.manager.renameFile(target,'Technical/Hidden.md');
  let snapshot;await host.manager.runAsyncLinkUpdate(value=>{snapshot=value;});assert.equal(snapshot.length,0);
  await host.manager.renameFile(target,'visible/Returned.md');assert.equal(refs.filter(ref=>ref.link==='visible/Returned#Heading').length,1000);
});

test('references already captured by FileManager are resolved only by its native snapshot',async()=>{
  const host=await start(false),target=host.app.vault.getFileByPath('visible/Target.md'),source=host.app.vault.getFileByPath('notes/Source.md');
  await host.manager.renameFile(target,'Technical/Hidden.md');
  const hidden=host.addRef(source,'Technical/Hidden');
  const visible=host.addRef(source,'notes/Source');
  const calls=[];const resolve=host.metadataCache.getLinkpathDest;
  host.metadataCache.getLinkpathDest=function(link,...args){calls.push(link);return resolve.call(this,link,...args);};
  await host.manager.renameFile(target,'visible/Returned.md');
  assert.equal(calls.filter(link=>link==='notes/Source').length,1,'Sieve must skip a source/reference pair already present in the native snapshot');
  assert.equal(hidden.link,'visible/Returned');assert.equal(visible.link,'notes/Source');assert.equal(host.hook.phase,'applied');host.hook.dispose();
});
test('equal-content sources sharing reference objects remain distinct native update rows',async()=>{
  const host=await start(false,['visible/Target.md','notes/Source.md','notes/Other.md']),target=host.app.vault.getFileByPath('visible/Target.md');
  const first=host.app.vault.getFileByPath('notes/Source.md'),second=host.app.vault.getFileByPath('notes/Other.md');
  const shared=host.addRef(first,'visible/Target');host.refs.push({source:second,reference:shared});
  await host.manager.renameFile(target,'Technical/Hidden.md');await host.manager.renameFile(target,'visible/Returned.md');
  assert.equal(host.updates.filter(row=>row.sourceFile===first).length,2);assert.equal(host.updates.filter(row=>row.sourceFile===second).length,2);
});
test('supplement cleanup failure deactivates filtering and preserves the native callback',async()=>{
  const host=await start(false),target=host.app.vault.getFileByPath('visible/Target.md');host.addRef(host.app.vault.getFileByPath('notes/Source.md'),'visible/Target');await host.manager.renameFile(target,'Technical/Hidden.md');
  let called=false;await assert.rejects(host.manager.runAsyncLinkUpdate(snapshot=>{called=true;Object.freeze(snapshot);}));assert.equal(called,true);assert.equal(host.hook.phase,'error');
});
for(const mobile of [false,true]){
  test(`${mobile?'mobile':'desktop'} FileManager updates a fresh source reference across visible-hidden-hidden-visible`,async()=>{
    const host=await start(mobile),target=host.app.vault.getFileByPath('visible/Target.md'),source=host.app.vault.getFileByPath('notes/Source.md');
    const old=host.addRef(source,'visible/Target#Heading',{displayText:'Alias'});
    await host.manager.renameFile(target,'Technical/Hidden.md');assert.equal(old.link,'Technical/Hidden#Heading');
    // User edits the source while target is hidden; never reuse old offsets.
    host.refs.length=0;const current=host.addRef(source,'../Technical/Hidden#Heading',{position:{start:{offset:31}},displayText:'New alias'});
    await host.manager.renameFile(target,'Technical/Second.md');assert.equal(current.link,'Technical/Second#Heading');
    await host.manager.renameFile(target,'visible/Returned.md');assert.equal(current.link,'visible/Returned#Heading');
    assert.equal(host.app.vault.getFileByPath(target.path),target);assert.equal(host.updates.at(-1).reference,current);assert.equal(current.displayText,'New alias');assert.equal(host.hook.phase,'applied');
  });
  test(`${mobile?'mobile':'desktop'} folder return updates each retained child without exposing hidden targets during snapshot`,async()=>{
    const host=await start(mobile,['visible/deep/One.md','visible/Two.md','notes/Source.md']),folder=host.app.vault.getAbstractFileByPath('visible'),source=host.app.vault.getFileByPath('notes/Source.md');
    const one=host.addRef(source,'visible/deep/One'),two=host.addRef(source,'visible/Two');
    await host.manager.renameFile(folder,'Technical/folder');
    const iterate=host.metadataCache.iterateAllRefs;host.metadataCache.iterateAllRefs=function(callback){assert.equal(host.app.vault.getAbstractFileByPath('Technical/folder/deep/One.md'),null);assert.equal(host.metadataCache.getLinkpathDest('Technical/folder/deep/One',source.path).length,0);return iterate(callback);};
    await host.manager.renameFile(folder,'returned');assert.equal(one.link,'returned/deep/One');assert.equal(two.link,'returned/Two');
  });
}
