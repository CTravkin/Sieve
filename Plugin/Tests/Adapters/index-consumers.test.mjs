// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import {loadRuntime} from '../Fixtures/load-runtime.mjs';
import {fakeHost} from '../Fixtures/host-adapter.mjs';
const {compileRules}=await loadRuntime('core/matcher');
const {installFilter}=await loadRuntime('platform/lifecycle');
const bytes=text=>new TextEncoder().encode(text);
const hidden=path=>path==='Technical'||path.startsWith('Technical/');
async function start(mobile,paths=['visible/file.md']){const host=fakeHost(mobile,[...paths,'Technical/initial-hidden.md']);const compiled=await compileRules('Technical',{platform:'linux'});host.hook=installFilter(host.app,compiled.matcher,mobile?'android':'linux');assert.equal(host.hook.status,'ready');await host.app.vault.load();host.layout();await host.metadataCache.drain();return host;}
function resetCounters(host){for(const values of Object.values(host.metadataCache.counters))values.length=0;}
for(const mobile of [false,true]){
  test(`${mobile?'mobile':'desktop'} hidden physical modify performs no new metadata read/parse with no editor or a clean/dirty editor`,async()=>{
    for(const mode of ['none','clean','dirty']){
      const host=await start(mobile);const file=host.indexed.get('visible/file.md');const editor=mode==='none'?undefined:host.openEditor(file);const local=bytes('[[Own dirty buffer]]');if(mode==='dirty')editor.setValue(local);await host.app.vault.rename(file,'Technical/file.md');await host.metadataCache.drain();resetCounters(host);const remote=bytes(`[[Remote ${mode}]]`);host.physical.set(file.path,{type:'file',content:remote,mtime:71});
      await host.adapter.reconcileFile(file.path,file.path);await editor?.drain();await host.metadataCache.drain();for(const [kind,count] of Object.entries(host.metadataCache.counters))assert.deepEqual(count,[],`${mode}: metadata ${kind}`);
      assert.equal(file.deleted,false);assert.equal(file.stat.mtime,71);assert.equal(host.metadataCache.fileCache[file.path],undefined);assert.deepEqual(Object.keys(host.explorer.fileItems).filter(hidden),[]);assert.deepEqual(host.physical.get(file.path).content,remote);
      if(editor){assert.equal(editor.file,file);assert.deepEqual(editor.refreshes.at(-1).data,remote);assert.equal(editor.conflicts.length,mode==='dirty'?1:0);assert.deepEqual(editor.buffer,mode==='dirty'?local:remote);}
      host.metadataCache.computeFileMetadataAsync(file);host.app.vault.trigger('external-watch',file);await host.metadataCache.drain();for(const values of Object.values(host.metadataCache.counters))assert.deepEqual(values,[],'direct and external-watch metadata entry points are guarded');
      const beforeCreate=host.vaultEvents.filter(([kind,ref])=>kind==='create'&&ref===file).length;await host.app.vault.rename(file,'visible/returned.md');await host.metadataCache.drain();assert.equal(host.explorer.fileItems[file.path]?.file,file);assert.deepEqual(host.metadataCache.counters.queue,[file.path]);assert.deepEqual(host.metadataCache.counters.reads,[file.path]);assert.equal(host.vaultEvents.filter(([kind,ref])=>kind==='create'&&ref===file).length,beforeCreate+1);assert.equal(host.metadataCache.fileCache[file.path].size,remote.length);
    }
  });
  test(`${mobile?'mobile':'desktop'} FileExplorer file projection is absent inside hidden rename callbacks and restores the same visible file`,async()=>{
    const host=await start(mobile);const file=host.indexed.get('visible/file.md');const seen=[];host.app.vault.on('rename',(ref,old)=>seen.push({ref,old,path:ref.path,items:Object.keys(host.explorer.fileItems).filter(hidden),hasCurrent:Object.hasOwn(host.explorer.fileItems,ref.path),indexed:host.app.vault.getAbstractFileByPath(ref.path),lookup:[...host.lookup.values()].flatMap(set=>[...set]).filter(file=>hidden(file.path))}));
    for(const destination of ['Technical/one.md','Technical/two.md','visible/returned.md']){
      await host.app.vault.rename(file,destination);await host.metadataCache.drain();const observation=seen.at(-1);assert.equal(observation.ref,file);assert.equal(observation.path,destination);assert.deepEqual(observation.items,[]);assert.deepEqual(observation.lookup,[]);assert.equal(observation.hasCurrent,!hidden(destination));assert.equal(observation.indexed,hidden(destination)?null:file);assert.equal(file.deleted,false);
    }
    assert.equal(host.explorer.fileItems[file.path].file,file);await host.app.vault.delete(file);assert.equal(file.deleted,true);assert.equal(host.explorer.fileItems[file.path],undefined);
  });
  test(`${mobile?'mobile':'desktop'} FileExplorer async folder cycle removes old subtree keys without changing native child identity`,async()=>{
    const host=await start(mobile,['visible/deep/file.md','visible/deep/other.md']);host.adapter.renamePause=true;const folder=host.indexed.get('visible');const child=host.indexed.get('visible/deep/file.md');const seen=[];host.app.vault.on('rename',file=>seen.push({path:file.path,items:Object.keys(host.explorer.fileItems).filter(hidden)}));
    for(const destination of ['Technical/one','Technical/two','returned']){
      const offset=seen.length;await host.app.vault.rename(folder,destination);await host.metadataCache.drain();for(const frame of seen.slice(offset))assert.deepEqual(frame.items,[],frame.path);assert.equal(child.path,destination+'/deep/file.md');assert.equal(child.deleted,false);
      if(hidden(destination))assert.ok(!Object.keys(host.explorer.fileItems).some(path=>path==='visible'||path.startsWith('visible/')));else {assert.equal(host.explorer.fileItems[folder.path].file,folder);assert.equal(host.explorer.fileItems[child.path].file,child);}
    }
    await host.app.vault.modifyBinary(child,bytes('[[Saved child]]'));assert.deepEqual(host.physical.get(child.path).content,bytes('[[Saved child]]'));
  });
}
test('compute guard preflight is atomic and a foreign retained wrapper becomes ordinary after dispose',async()=>{
  const locked=fakeHost();const before=locked.adapter.trigger;Object.defineProperty(locked.metadataCache,'computeFileMetadataAsync',{value:locked.metadataCache.computeFileMetadataAsync,configurable:false});const result=await compileRules('Technical',{platform:'linux'});assert.equal(installFilter(locked.app,result.matcher,'linux').status,'unsupported');assert.equal(locked.adapter.trigger,before);
  const host=await start(false);const file=host.indexed.get('visible/file.md');await host.app.vault.rename(file,'Technical/file.md');await host.metadataCache.drain();resetCounters(host);const retained=host.metadataCache.computeFileMetadataAsync;const foreign=function(...args){return retained.apply(this,args);};host.metadataCache.computeFileMetadataAsync=foreign;host.hook.dispose();assert.equal(host.metadataCache.computeFileMetadataAsync,foreign);host.metadataCache.deletePath(file.path);foreign.call(host.metadataCache,file);await host.metadataCache.drain();assert.deepEqual(host.metadataCache.counters.reads,[file.path]);
});
