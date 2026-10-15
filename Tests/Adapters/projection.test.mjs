import assert from 'node:assert/strict';
import test from 'node:test';
import {loadRuntime} from '../Fixtures/load-runtime.mjs';
import {fakeHost,hostKey} from '../Fixtures/host-adapter.mjs';
const {compileRules}=await loadRuntime('core/matcher');
const {installFilter}=await loadRuntime('platform/lifecycle');
async function start(mobile,paths,rules='Technical'){
  const host=fakeHost(mobile,[...paths,'Technical/initial-hidden.md']);const result=await compileRules(rules,{platform:'linux'});assert.equal(result.ok,true);
  host.hook=installFilter(host.app,result.matcher,mobile?'android':'linux');assert.equal(host.hook.status,'ready');await host.app.vault.load();host.layout();await host.metadataCache.drain();return host;
}
function hidden(host,prefix='Technical'){
  assert.ok(![...host.indexed.keys()].some(p=>p===prefix||p.startsWith(prefix+'/')));
  assert.ok(![...host.metadata.keys()].some(p=>p===prefix||p.startsWith(prefix+'/')));
  assert.ok(![...host.lookup.values()].flatMap(entries=>[...entries]).some(file=>file.path===prefix||file.path.startsWith(prefix+'/')));
  assert.ok(!host.app.vault.fileMap['/'].children.some(file=>file.path===prefix||file.path.startsWith(prefix+'/')));
}
for(const mobile of [false,true]){
  test(`${mobile?'mobile':'desktop'} projection preserves dirty editor until ordinary autosave; actual delete closes it`,async()=>{
    const host=await start(mobile,['visible/file.md']);const file=host.indexed.get('visible/file.md');const editor=host.openEditor(file);const dirty=new Uint8Array([8,6,4]);editor.setValue(dirty);
    const deletions=[];host.app.vault.on('delete',event=>deletions.push({event,heldDeleted:file.deleted}));
    const nativeWrite=host.adapter.writeBinary;const nativeDelete=host.adapter.remove;
    await host.app.vault.rename(file,'Technical/file.md');await host.metadataCache.drain();hidden(host);
    const metadataDeletes=host.metadataCache.events.filter(([type])=>type==='deleted');assert.equal(metadataDeletes.length,1,'projection publishes exactly one metadata deletion');assert.equal(metadataDeletes[0][1].path,'visible/file.md','rename projection deletes the old public key');
    assert.notEqual(deletions[0].event,file);assert.equal(deletions[0].heldDeleted,false);
    assert.equal(editor.file,file);assert.equal(file.deleted,false);assert.equal(file.path,'Technical/file.md');assert.equal(host.adapter.writeBinary,nativeWrite);assert.equal(host.adapter.remove,nativeDelete);
    await editor.autosave();assert.deepEqual(host.physical.get('Technical/file.md').content,dirty);hidden(host);
    await host.app.vault.delete(file);assert.equal(file.deleted,true);assert.equal(editor.file,null);assert.equal(deletions.at(-1).event,file);assert.equal(deletions.at(-1).heldDeleted,true);await editor.autosave();assert.equal(host.physical.has('Technical/file.md'),false);hidden(host);
  });
  test(`${mobile?'mobile':'desktop'} same file survives visible-hidden-hidden-visible rename with exact native identity`,async()=>{
    const name='Cafe\u0301\u00a0note.md';const host=await start(mobile,[`visible/${name}`]);const file=host.indexed.get(hostKey(`visible/${name}`));
    for(const destination of ['Technical/one.md','Technical/two.md','visible/back.md']){
      await host.app.vault.rename(file,destination);await host.metadataCache.drain();assert.equal(file.path,destination);assert.ok(host.physical.has(destination));
      if(destination.startsWith('Technical'))hidden(host);else assert.equal(host.indexed.get(destination),file);
    }
    assert.equal(file.deleted,false);const edited=new Uint8Array([5,5]);await host.app.vault.modifyBinary(file,edited);assert.deepEqual(host.physical.get(file.path).content,edited);assert.ok(!host.physical.has(hostKey(`visible/${name}`)));
  });
  test(`${mobile?'mobile':'desktop'} repeated folder rename preserves every held descendant and allowed containers`,async()=>{
    const host=await start(mobile,['visible/deep/file.md','visible/deep/other.md']);host.adapter.renamePause=true;const folder=host.indexed.get('visible');const child=host.indexed.get('visible/deep/file.md');
    for(const destination of ['Technical/first','Technical/second','returned']){
      await host.app.vault.rename(folder,destination);await host.metadataCache.drain();assert.equal(folder.path,destination);assert.equal(child.path,destination+'/deep/file.md');assert.equal(child.deleted,false);
      if(destination.startsWith('Technical'))hidden(host);else {assert.equal(host.indexed.get(child.path),child);assert.equal(child.parent,host.indexed.get('returned/deep'));assert.equal(child.parent.parent,folder);assert.equal(folder.parent,host.app.vault.fileMap['/']);}
    }
    await host.app.vault.modifyBinary(child,new Uint8Array([7]));assert.deepEqual(host.physical.get('returned/deep/file.md').content,new Uint8Array([7]));
  });
  test(`${mobile?'mobile':'desktop'} external removal of a retained hidden file stays a real deletion`,async()=>{
    const host=await start(mobile,['visible/file.md']);const file=host.indexed.get('visible/file.md');const editor=host.openEditor(file);await host.app.vault.rename(file,'Technical/file.md');host.physical.delete('Technical/file.md');
    await host.adapter.reconcileFile('Technical/file.md','Technical/file.md');assert.equal(file.deleted,true);assert.equal(editor.file,null);await editor.autosave();assert.equal(host.physical.has('Technical/file.md'),false);
  });
}
test('queued pre-rename metadata cannot restore hidden cache, unique lookup or publish changed events',async()=>{
  const host=await start(false,['visible/file.md']);const file=host.indexed.get('visible/file.md');let release;host.metadataCache.gate=new Promise(resolve=>{release=resolve;});host.metadataCache.deletePath(file.path);host.metadataCache.computeFileMetadataAsync(file);
  await host.app.vault.rename(file,'Technical/file.md');host.metadataCache.events.length=0;release();await host.metadataCache.drain();hidden(host);assert.ok(!host.metadata.has('visible/file.md'));assert.ok(!host.metadataCache.events.some(([type,ref])=>['changed','queue'].includes(type)&&ref===file));
});
test('dirty visible rename positive control uses the same ordinary save path',async()=>{
  const host=await start(false,['visible/file.md']);const file=host.indexed.get('visible/file.md');const editor=host.openEditor(file);const bytes=new Uint8Array([9,8]);editor.setValue(bytes);await host.app.vault.rename(file,'visible/control.md');await editor.autosave();assert.equal(editor.file,file);assert.deepEqual(host.physical.get('visible/control.md').content,bytes);
});
for(const mobile of [false,true])test(`${mobile?'mobile':'desktop'} resume retains native original realpath for hidden NBSP/NFD objects`,async()=>{
  const name='Cafe\u0301\u00a0note.md';
  // Keep a divergent realPath after a folder move, matching native cache mutation.
  const folderHost=await start(mobile,[`visible/${name}`]);const folder=folderHost.indexed.get('visible');const child=folderHost.indexed.get(hostKey(`visible/${name}`));await folderHost.app.vault.rename(folder,'Technical/moved');
  if(mobile)await folderHost.adapter.watchAndList();else await folderHost.adapter.listAll();
  assert.deepEqual(await folderHost.adapter.readBinary(child.path),folderHost.physical.get(`Technical/moved/${name}`).content);await folderHost.app.vault.rename(folder,'returned');assert.equal(child.path,hostKey(`returned/${name}`));assert.equal(child.deleted,false);assert.equal(folderHost.indexed.get(child.path),child);
});
test('new Vault and metadata capability checks stay atomic and foreign wrappers restore safely',async()=>{
  const compiled=await compileRules('Technical',{platform:'linux'});
  for(const key of ['saveFileCache','deletePath','updateRelatedLinks','lookup-remove','lookup-add','vault-trigger']){const locked=fakeHost();const before=locked.adapter.listRecursiveChild;const owner=key.startsWith('lookup-')?locked.metadataCache.uniqueFileLookup:key==='vault-trigger'?locked.app.vault:locked.metadataCache;const method=key.startsWith('lookup-')?key.slice(7):key==='vault-trigger'?'trigger':key;Object.defineProperty(owner,method,{value:owner[method],configurable:false});assert.equal(installFilter(locked.app,compiled.matcher,'linux').status,'unsupported');assert.equal(locked.adapter.listRecursiveChild,before);}
  const host=await start(false,['visible/file.md']);const original=host.app.vault.trigger;const retained=host.metadataCache.saveFileCache;const foreign=function(...args){return retained.apply(this,args);};host.metadataCache.saveFileCache=foreign;host.hook.dispose();assert.equal(host.metadataCache.saveFileCache,foreign);host.metadataCache.saveFileCache('Technical/manual.md',{});assert.ok(host.metadata.has('Technical/manual.md'));assert.notEqual(host.app.vault.trigger,original);
});
