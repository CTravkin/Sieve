// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import {loadRuntime} from '../Fixtures/load-runtime.mjs';
import {fakeHost} from '../Fixtures/host-adapter.mjs';
const {compileRules}=await loadRuntime('core/matcher');
const {installFilter}=await loadRuntime('platform/lifecycle');
const bytes=text=>new TextEncoder().encode(text);
async function start(mobile=false,paths=['visible/file.md']){
  const host=fakeHost(mobile,[...paths,'Technical/initial-hidden.md']);const compiled=await compileRules('Technical',{platform:'linux'});host.hook=installFilter(host.app,compiled.matcher,mobile?'android':'linux');assert.equal(host.hook.status,'ready');await host.app.vault.load();host.layout();await host.metadataCache.drain();return host;
}
const isHidden=path=>path==='Technical'||path.startsWith('Technical/');
function snapshot(host,file,old){return {file,old,path:file.path,deleted:file.deleted,index:Object.keys(host.app.vault.fileMap).filter(isHidden),roots:host.app.vault.fileMap['/'].children.filter(file=>isHidden(file.path)),lookup:[...host.lookup.values()].flatMap(set=>[...set]).filter(file=>isHidden(file.path)),metadata:Object.keys(host.metadataCache.fileCache).filter(isHidden),links:Object.keys(host.metadataCache.resolvedLinks).filter(isHidden)};}
for(const mobile of [false,true]){
  test(`${mobile?'mobile':'desktop'} synchronous file rename callback observes a completed hidden projection and original argument`,async()=>{
    const host=await start(mobile);const file=host.indexed.get('visible/file.md');const observations=[];const observer=(ref,old)=>observations.push(snapshot(host,ref,old));host.app.vault.on('rename',observer);host.app.vault.onFirst('rename',observer);
    for(const destination of ['Technical/one.md','Technical/two.md','visible/file.md']){
      const offset=observations.length;await host.app.vault.rename(file,destination);assert.equal(observations.length-offset,2);
      for(const observed of observations.slice(offset)){assert.equal(observed.file,file);assert.equal(observed.path,destination);assert.equal(observed.deleted,false);for(const key of ['index','roots','lookup','metadata','links'])assert.deepEqual(observed[key],[],`callback ${destination}: ${key}`);}
    }
    assert.equal(host.indexed.get('visible/file.md'),file);
  });
  test(`${mobile?'mobile':'desktop'} synchronous folder callbacks never expose hidden entries during the native descendant loop`,async()=>{
    const host=await start(mobile,['visible/deep/file.md','visible/deep/other.md']);host.adapter.renamePause=true;const folder=host.indexed.get('visible');const child=host.indexed.get('visible/deep/file.md');const observations=[];host.app.vault.on('rename',(file,old)=>observations.push(snapshot(host,file,old)));
    for(const destination of ['Technical/one','Technical/two','returned']){
      const offset=observations.length;await host.app.vault.rename(folder,destination);assert.ok(observations.length>offset);
      for(const observed of observations.slice(offset))for(const key of ['index','roots','lookup','metadata','links'])assert.deepEqual(observed[key],[],`callback ${observed.path}: ${key}`);
      assert.equal(child.path,destination+'/deep/file.md');assert.equal(child.deleted,false);
    }
    assert.equal(host.indexed.get(child.path),child);assert.equal(child.parent.parent,folder);
  });
  test(`${mobile?'mobile':'desktop'} hidden external modification updates held native stat and invalidates cached read`,async()=>{
    const host=await start(mobile);const file=host.indexed.get('visible/file.md');const old=await host.app.vault.cachedRead(file);await host.app.vault.rename(file,'Technical/file.md');const fresh=bytes('[[Fresh external]]');host.physical.set('Technical/file.md',{type:'file',content:fresh,mtime:42});
    await host.adapter.reconcileFile('Technical/file.md','Technical/file.md');assert.equal(file.stat.mtime,42);assert.equal(file.stat.size,fresh.length);assert.notDeepEqual(fresh,old);assert.deepEqual(await host.app.vault.cachedRead(file),fresh);
    await host.app.vault.rename(file,'visible/file.md');await host.metadataCache.drain();const cache=host.metadataCache.fileCache[file.path];assert.equal(cache.mtime,42);assert.equal(cache.size,fresh.length);assert.deepEqual(host.metadataCache.resolvedLinks[file.path],{'Fresh external':1});
  });
  test(`${mobile?'mobile':'desktop'} hidden physical modify reaches the held editor's ordinary read/conflict seam with no public index`,async()=>{
    for(const dirty of [false,true]){
      const host=await start(mobile);const file=host.indexed.get('visible/file.md');const editor=host.openEditor(file);const local=bytes('[[Local buffer]]');if(dirty)editor.setValue(local);await host.app.vault.rename(file,'Technical/file.md');const remote=bytes('[[Remote external]]');host.physical.set(file.path,{type:'file',content:remote,mtime:81});const observations=[];host.app.vault.on('modify',ref=>observations.push(snapshot(host,ref)));
      await host.adapter.reconcileFile(file.path,file.path);await editor.drain();await host.metadataCache.drain();assert.equal(editor.file,file);assert.equal(file.deleted,false);assert.equal(editor.refreshes.at(-1).file,file);assert.deepEqual(editor.refreshes.at(-1).data,remote);assert.equal(editor.conflicts.length,dirty?1:0);assert.deepEqual(editor.buffer,dirty?local:remote);
      assert.equal(observations.length,1);for(const key of ['index','roots','lookup','metadata','links'])assert.deepEqual(observations[0][key],[]);assert.equal(host.metadataCache.fileCache[file.path],undefined);assert.deepEqual(host.physical.get(file.path).content,remote,'no forced save of dirty buffer');
    }
  });
}
async function delayedEdit(hidden){
  const host=await start();const file=host.indexed.get('visible/file.md');const old=bytes('[[Old]]');const fresh=bytes('[[Fresh data]]');await host.app.vault.modifyBinary(file,old);await host.metadataCache.drain();host.metadataCache.events.length=0;
  let release,read;host.metadataCache.gate=new Promise(resolve=>{release=resolve;});const captured=new Promise(resolve=>{read=resolve;});host.metadataCache.onRead=()=>read();host.metadataCache.deletePath(file.path);host.metadataCache.computeFileMetadataAsync(file);await captured;
  if(hidden)await host.app.vault.rename(file,'Technical/file.md');await host.app.vault.modifyBinary(file,fresh);if(hidden)await host.app.vault.rename(file,'visible/file.md');
  const current=host.physical.get('visible/file.md');release();await host.metadataCache.drain();const cache=host.metadataCache.fileCache[file.path];
  assert.equal(cache.hash,[...fresh].join(','));assert.equal(cache.mtime,current.mtime);assert.equal(cache.size,fresh.length);assert.deepEqual(host.metadataCache.resolvedLinks[file.path],{'Fresh data':1});assert.equal(host.indexed.get(file.path),file);
  assert.deepEqual(host.metadataCache.errors,[]);
  const changes=host.metadataCache.events.filter(([type])=>type==='changed').map(([,ref,data])=>({same:ref===file,text:new TextDecoder().decode(data)}));return changes;
}
test('serial native queue plus fresh visible compute finishes ABA with current data/stat/links; stale changed also occurs in visible control',{timeout:3000},async()=>{
  const baseline=await delayedEdit(false);const aba=await delayedEdit(true);for(const observed of [baseline,aba]){assert.deepEqual(observed[0],{same:true,text:'[[Old]]'});assert.ok(observed.length>=2);assert.ok(observed.slice(1).every(change=>change.same&&change.text==='[[Fresh data]]'));}
});
