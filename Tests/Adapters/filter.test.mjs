import assert from 'node:assert/strict';
import test from 'node:test';
import {loadRuntime} from '../Fixtures/load-runtime.mjs';
import {fakeHost,hostKey} from '../Fixtures/host-adapter.mjs';
const {compileRules}=await loadRuntime('core/matcher');
const {installFilter}=await loadRuntime('platform/lifecycle');
async function install(host,rules){const result=await compileRules(rules,{platform:'linux'});assert.equal(result.ok,true);return installFilter(host.app,result.matcher,host.adapter.fs?'android':'linux');}

test('startup shares immutable path decisions across adapter, projection and parent checks',async()=>{
  const paths=Array.from({length:100},(_,i)=>`notes/deep/group-${i%5}/entry-${i}.md`);
  const host=fakeHost(false,[...paths,'Technical/private.md']);const compiled=await compileRules('Technical',{platform:'linux'});
  assert.equal(compiled.ok,true);const calls=new Map();
  const matcher={match(path){calls.set(path,(calls.get(path)??0)+1);return compiled.matcher.match(path);}};
  const hook=installFilter(host.app,matcher,'linux');await host.app.vault.load();host.layout();await host.metadataCache.drain();
  assert.equal(hook.phase,'applied');for(const path of paths)assert.ok(host.indexed.has(path));
  assert.equal(host.indexed.has('Technical/private.md'),false);
  for(const [path,count] of calls)assert.equal(count,1,`Repeated matching for ${path}`);
  await host.adapter.rename(paths[0],'Technical/entry-0.md');assert.equal(host.indexed.has('Technical/entry-0.md'),false);
  await host.adapter.rename('Technical/entry-0.md',paths[0]);assert.ok(host.indexed.has(paths[0]));
  hook.dispose();
});

test('decision reuse stays bounded and belongs to its filter installation',async()=>{
  const host=fakeHost(false,[]);const compiled=await compileRules('Technical',{platform:'linux'});assert.equal(compiled.ok,true);
  const calls=new Map();const matcher={match(path){calls.set(path,(calls.get(path)??0)+1);return compiled.matcher.match(path);}};
  const hook=installFilter(host.app,matcher,'linux');
  for(let i=0;i<10000;i++)host.adapter.trigger('raw',`Technical/entry-${i}.md`);
  host.adapter.trigger('raw','Technical/entry-9999.md');assert.equal(calls.get('Technical/entry-9999.md'),1,'recent paths should be reused');
  host.adapter.trigger('raw','Technical/entry-0.md');assert.equal(calls.get('Technical/entry-0.md'),2,'old paths must be evicted rather than retained without a bound');
  hook.dispose();const other=fakeHost(false,['Technical/entry-0.md']);const replacement=await install(other,'!Technical/entry-0.md\n*');
  await other.app.vault.load();other.layout();assert.equal(replacement.phase,'applied');assert.ok(other.indexed.has('Technical/entry-0.md'));
});

test('startup stale metadata cleanup avoids repeated related-link rescans while retaining native deletion and visible resolution',async()=>{
  const host=fakeHost(false,['notes/public.md','Technical/hidden.md']);
  for(let i=0;i<10000;i++){
    const path=`Technical/old-${i}.md`;host.metadataCache.fileCache[path]={mtime:0,size:0,hash:'old'};
    host.metadataCache.resolvedLinks[path]={};host.metadataCache.unresolvedLinks[path]={};
  }
  const hook=await install(host,'Technical');await host.app.vault.load();host.layout();await host.metadataCache.drain();
  assert.equal(hook.phase,'applied');assert.deepEqual(Object.keys(host.metadataCache.fileCache),['notes/public.md']);
  assert.deepEqual(Object.keys(host.metadataCache.resolvedLinks),['notes/public.md']);assert.deepEqual(Object.keys(host.metadataCache.unresolvedLinks),[]);
  assert.ok(host.metadataCache.events.some(([kind,file])=>kind==='queue'&&file?.path==='notes/public.md'));
  assert.ok(host.metadataCache.events.some(([kind,file])=>kind==='queue'&&file===null),'native deletion still queues its barrier');
  assert.equal(host.metadataCache.counters.related.length,0,'every retained file is already queued by native initialization');
  host.metadataCache.deletePath('notes/public.md');assert.equal(host.metadataCache.counters.related.length,1,'normal runtime deletion must still refresh related links');
  hook.dispose();host.metadataCache.initialized=false;host.metadataCache.deletePath('Technical/after-unload.md');assert.equal(host.metadataCache.counters.related.length,2);
});

for(const mobile of [false,true])test(`${mobile?'mobile':'desktop'} startup prunes before IO, preserves direct access and config, claims applied only after traversal/layout`,async()=>{
  const host=fakeHost(mobile,['Technical/secret.md','notes/public.md','.custom/plugins/sieve/data.json']);const originalBytes=host.physical.get('Technical/secret.md').content;
  const hook=await install(host,'Technical\n.custom');assert.equal(hook.status,'ready');assert.equal(hook.phase,'pending');
  await host.app.vault.load();assert.equal(hook.phase,'pending');host.layout();assert.equal(hook.phase,'applied');
  assert.ok(!host.io.some(([,p])=>p==='Technical'||p.startsWith('Technical/')));assert.ok(!host.events.some(([type,p])=>type==='raw'&&p==='Technical'));
  assert.ok(host.indexed.has('notes/public.md'));assert.ok(host.io.some(([,p])=>p.startsWith('.custom')));assert.ok(!host.io.some(([type])=>type==='bulk'));
  assert.deepEqual(await host.adapter.readBinary('Technical/secret.md'),originalBytes);assert.deepEqual(host.physical.get('Technical/secret.md').content,originalBytes);
  hook.dispose();hook.dispose();assert.equal(hook.phase,'disposed');
});
test('ignored traversable files never publish metadata and only necessary folder containers remain',async()=>{
  const host=fakeHost(false,['Technical/deep/keep.md','Technical/empty/secret.md','Technical/deep/secret.md']);await install(host,'!Technical/deep/keep.md\nTechnical');await host.app.vault.load();host.layout();
  assert.deepEqual([...host.indexed.keys()].sort(),['Technical','Technical/deep','Technical/deep/keep.md']);assert.ok(!host.events.some(([type,p])=>type==='file-created'&&p.endsWith('secret.md')));assert.ok(host.physical.has('Technical/empty/secret.md'));
});

for(const mobile of [false,true])test(`${mobile?'mobile':'desktop'} dirty containers are hidden deepest first, preserving insertion order at equal depths`,async()=>{
  const paths=['Technical/a/deep/keep.md','Technical/very-long-branch/keep.md','Technical/z/deep/keep.md'];
  const host=fakeHost(mobile,paths);const hook=await install(host,'!keep.md\nTechnical');await host.app.vault.load();host.layout();
  const removed=[];host.app.vault.on('delete',file=>{if(Array.isArray(file.children))removed.push(file.path);});
  for(const path of paths){host.physical.delete(path);host.adapter.removeFile(path);}
  await Promise.resolve();
  assert.deepEqual(removed,['Technical/a/deep','Technical/z/deep','Technical/a','Technical/very-long-branch','Technical/z','Technical']);
  assert.equal(host.indexed.size,0);assert.ok(host.physical.has('Technical/a/deep'),'projection cleanup preserves physical folders');assert.equal(hook.phase,'applied');hook.dispose();
});
test('preflight is atomic and late enable remains pending without patching an existing index',async()=>{
  const locked=fakeHost();const before=locked.adapter.listRecursiveChild;Object.defineProperty(locked.adapter,'trigger',{value:locked.adapter.trigger,configurable:false});assert.equal((await install(locked,'Technical')).status,'unsupported');assert.equal(locked.adapter.listRecursiveChild,before);
  const late=fakeHost();await late.app.vault.load();late.layout();const method=late.adapter.listRecursiveChild;const hook=await install(late,'Technical');assert.equal(hook.phase,'pending');assert.equal(hook.reloadNeeded,true);assert.equal(late.adapter.listRecursiveChild,method);assert.ok(late.indexed.has('Technical/secret.md'));
});
test('foreign retained wrapper survives unload and own guards become inert',async()=>{
  const host=fakeHost();const hook=await install(host,'Technical');const retained=host.adapter.reconcileFile;
  const foreign=function(...args){return retained.apply(this,args);};host.adapter.reconcileFile=foreign;hook.dispose();
  assert.equal(host.adapter.reconcileFile,foreign);await host.adapter.reconcileFile('Technical/secret.md',hostKey('Technical/secret.md'));assert.ok(host.io.some(([,p])=>p==='Technical/secret.md'));
});

for(const mobile of [false,true])test(`${mobile?'mobile':'desktop'} folder rename updates retained references before pruning and preserves allowed descendant containers`,async()=>{
  const host=fakeHost(mobile,['visible/deep/keep.md','visible/deep/secret.md','visible/empty/secret.md']);host.adapter.renamePause=true;await install(host,'!Technical/deep/keep.md\nTechnical');await host.app.vault.load();host.layout();
  const kept=host.indexed.get('visible/deep/keep.md');const hidden=host.indexed.get('visible/deep/secret.md');await host.adapter.rename('visible','Technical');
  assert.equal(kept.path,'Technical/deep/keep.md');assert.equal(hidden.path,'Technical/deep/secret.md');assert.equal(host.indexed.get('Technical/deep/keep.md'),kept);
  assert.ok(!host.events.some(([type,path])=>type==='folder-removed'&&(path==='Technical'||path==='Technical/deep')),'retained descendant parents must survive the asynchronous host rename');
  assert.deepEqual([...host.indexed.keys()].sort(),['Technical','Technical/deep','Technical/deep/keep.md']);assert.ok(host.physical.has('Technical/deep/secret.md'));
});
test('fully excluded folder rename keeps the physical source and moves retained file paths before cache removal',async()=>{
  const host=fakeHost(false,['visible/deep/file.md']);host.adapter.renamePause=true;await install(host,'Technical');await host.app.vault.load();host.layout();const ref=host.indexed.get('visible/deep/file.md');
  await host.adapter.rename('visible','Technical');assert.equal(ref.path,'Technical/deep/file.md');assert.equal(host.indexed.size,0);assert.ok(host.physical.has('Technical/deep/file.md'));
});
test('failed managed mobile scan restores own hooks and explicitly recovers an unfiltered startup',async()=>{
  const host=fakeHost(true);const original=host.adapter.watchAndList;host.adapter.fs.watch=async()=>{throw Error('provider-secret');};const hook=await install(host,'Technical');
  await host.app.vault.load();host.layout();assert.equal(hook.phase,'error');assert.equal(hook.status,'error');assert.equal(host.adapter.watchAndList,original);
  assert.ok(host.io.some(([kind])=>kind==='bulk'));assert.ok(host.indexed.has('Technical/secret.md'));
});
test('pruning after folder rename preserves direct resolution of a retained NBSP/NFD file path',async()=>{
  const name='Foo\u00a0e\u0301.md';const host=fakeHost(false,[`visible/${name}`]);const originalGetter=host.adapter.getRealPath;const hook=await install(host,'Technical');await host.app.vault.load();host.layout();const retained=host.indexed.get(hostKey(`visible/${name}`));
  await host.adapter.rename('visible','Technical');const original=host.physical.get(`Technical/${name}`).content;
  assert.deepEqual(await host.adapter.readBinary(retained.path),original);
  const edited=new Uint8Array([8,9]);await host.adapter.writeBinary(retained.path,edited);assert.deepEqual(host.physical.get(`Technical/${name}`).content,edited);assert.equal(host.physical.has(retained.path),false);
  hook.dispose();assert.equal(host.adapter.getRealPath,originalGetter);assert.deepEqual(await host.adapter.readBinary(retained.path),edited);assert.equal(host.indexed.size,0,'resolver restoration must not republish content');
});

for(const mobile of [false,true])test(`${mobile?'mobile':'desktop'} leaf events and direct writes keep hidden metadata out while external visible transitions re-enter`,async()=>{
  const host=fakeHost(mobile,['Technical/secret.md','notes/public.md']);await install(host,'Technical');await host.app.vault.load();host.layout();host.io.length=0;host.events.length=0;
  await host.adapter.writeBinary('Technical/new.md',new Uint8Array([7]));assert.ok(host.physical.has('Technical/new.md'));assert.ok(!host.events.some(([kind,path])=>['raw','file-created','modified'].includes(kind)&&path.startsWith('Technical')));assert.equal(host.io.length,0);
  host.physical.set('Technical/cached.md',{type:'file',content:new Uint8Array([3])});host.adapter.files['Technical/cached.md']={type:'file',realpath:'Technical/cached.md'};host.app.vault.onChange('file-created','Technical/cached.md',undefined,{mtime:0,size:1});await host.metadataCache.drain();host.io.length=0;await host.adapter.reconcileFile('Technical/cached.md','Technical/cached.md');assert.ok(!host.indexed.has('Technical/cached.md'));assert.equal(host.io.length,0);
  host.physical.set('notes/external.md',{type:'file',content:new Uint8Array([9])});await host.adapter.reconcileFile('notes/external.md','notes/external.md');assert.ok(host.indexed.has('notes/external.md'));
});
test('mobile resume uses guarded recursion and never the bulk bridge',async()=>{
  const host=fakeHost(true);await install(host,'Technical');await host.app.vault.load();host.layout();host.io.length=0;await host.adapter.watchAndList();
  assert.ok(host.io.some(([kind])=>kind==='watch'));assert.ok(!host.io.some(([kind,path])=>kind==='bulk'||path.startsWith('Technical')));
});
test('host key projection does not change the matcher realPath case, spaces or platform Unicode',async()=>{
  const path='Foo\u00a0e\u0301.md';const host=fakeHost(false,[path,'foo e\u0301.md']);await install(host,`/${path}`);await host.app.vault.load();host.layout();
  assert.ok(!host.events.some(([kind,key])=>kind==='file-created'&&key===hostKey(path)));assert.ok(host.indexed.has(hostKey('foo e\u0301.md')));
});
test('mutation failure rolls every earlier own hook back without filesystem effects',async()=>{
  const host=fakeHost();const before=Object.getOwnPropertyDescriptors(host.adapter);const extras=[host.app.vault,host.metadataCache,host.metadataCache.uniqueFileLookup];const otherBefore=extras.map(Object.getOwnPropertyDescriptors);let fail=true;
  host.app.vault.adapter=new Proxy(host.adapter,{defineProperty(target,key,descriptor){if(key==='listRecursive'&&fail){fail=false;throw Error('atomic failure');}return Reflect.defineProperty(target,key,descriptor);}});
  const hook=await install(host,'Technical');assert.equal(hook.status,'error');assert.deepEqual(Object.getOwnPropertyDescriptors(host.adapter),before);assert.deepEqual(extras.map(Object.getOwnPropertyDescriptors),otherBefore);assert.deepEqual(host.io,[]);
});
function methods(host){
  return [host.adapter,host.app.vault,host.metadataCache,host.metadataCache.uniqueFileLookup].flatMap(owner=>Object.entries(Object.getOwnPropertyDescriptors(owner)).filter(([,descriptor])=>typeof descriptor.value==='function').map(([key,descriptor])=>({owner,key,descriptor})));
}
function restored(before){for(const {owner,key,descriptor} of before)assert.deepEqual(Object.getOwnPropertyDescriptor(owner,key),descriptor,`${key} must retain its native descriptor`);}

for(const key of ['load','listAll','listRecursive','reconcileFolderCreation'])for(const synchronous of [true,false])test(`${key} ${synchronous?'throw':'rejection'} releases own hooks, preserves the original failure and requires reopen`,async()=>{
  const host=fakeHost();const owner=key==='load'?host.app.vault:host.adapter;const error=Error('synthetic startup failure');let calls=0;
  owner[key]=()=>{calls++;if(synchronous)throw error;return Promise.reject(error);};
  const before=methods(host);const sources=structuredClone(host.physical);const hook=await install(host,'Technical');
  if(key==='load'&&synchronous)assert.throws(()=>host.app.vault.load(),value=>value===error);
  else await assert.rejects(host.app.vault.load(),value=>value===error);
  host.layout();assert.equal(hook.phase,'error');assert.equal(hook.status,'error');assert.equal(hook.reloadNeeded,true);assert.equal(hook.initialCompleted,false);assert.equal(calls,1);restored(before);
  assert.ok(!host.indexed.has('Technical/secret.md'),'failure must not fabricate a full index');assert.deepEqual(host.physical,sources);
  await host.adapter.reconcileFile('Technical/secret.md','Technical/secret.md');assert.ok(host.io.some(([,path])=>path==='Technical/secret.md'));assert.ok(host.indexed.has('Technical/secret.md'),'later native events are unfiltered');assert.equal(hook.phase,'error');hook.dispose();
});

test('a late startup rejection leaves foreign wrappers inert and blocks later successful completion',async()=>{
  const host=fakeHost();const sources=structuredClone(host.physical);let resolveLoad,rejectList;let listCalls=0,loadCalls=0;
  const loadValue=new Promise(resolve=>{resolveLoad=resolve;}),listValue=new Promise((_,reject)=>{rejectList=reject;});
  host.app.vault.load=()=>{loadCalls++;return loadValue;};host.adapter.listAll=()=>{listCalls++;return listValue;};
  const before=methods(host);const hook=await install(host,'Technical');const returnedLoad=host.app.vault.load();assert.equal(returnedLoad,loadValue);const returnedList=host.adapter.listAll();assert.equal(returnedList,listValue);
  const retained=host.adapter.reconcileFile;const foreign=function(...args){return retained.apply(this,args);};host.adapter.reconcileFile=foreign;
  const error=Error('late startup failure');const rejected=assert.rejects(returnedList,value=>value===error);rejectList(error);await rejected;
  assert.equal(host.adapter.reconcileFile,foreign);restored(before.filter(entry=>entry.key!=='reconcileFile'));
  resolveLoad('native result');assert.equal(await returnedLoad,'native result');host.layout();assert.equal(hook.phase,'error');assert.equal(hook.initialCompleted,false);assert.equal(hook.reloadNeeded,true);assert.equal(loadCalls,1);assert.equal(listCalls,1);
  assert.equal(host.indexed.size,0);assert.deepEqual(host.physical,sources);await foreign.call(host.adapter,'Technical/secret.md','Technical/secret.md');assert.ok(host.indexed.has('Technical/secret.md'));hook.dispose();assert.equal(host.adapter.reconcileFile,foreign);
});

test('synchronous filter-body errors release hooks without retrying the native operation',async()=>{
  const host=fakeHost();const before=methods(host);const sources=structuredClone(host.physical);const hook=await install(host,'Technical');
  assert.throws(()=>host.adapter.listRecursiveChild('',{}),/Unsupported adapter entry signature/);
  assert.equal(hook.phase,'error');assert.equal(hook.reloadNeeded,true);restored(before);assert.deepEqual(host.io,[]);assert.deepEqual(host.physical,sources);hook.dispose();
});

test('an asynchronous guarded child failure preserves its Promise and disables all own hooks',async()=>{
  const host=fakeHost();const error=Error('native child failure');let reject;const value=new Promise((_,failure)=>{reject=failure;});host.adapter.listRecursiveChild=()=>value;
  const before=methods(host);const hook=await install(host,'Technical');const returned=host.adapter.listRecursiveChild('notes','public.md');assert.equal(returned,value);
  const rejected=assert.rejects(returned,cause=>cause===error);reject(error);await rejected;assert.equal(hook.phase,'error');restored(before);hook.dispose();
});

test('failing status observers and a foreign accessor cannot replace the original throw or prevent other restoration',async()=>{
  const host=fakeHost();const error=Error('native load failure');host.app.vault.load=()=>{throw error;};const before=methods(host);const compiled=await compileRules('Technical',{platform:'linux'});
  let notices=0;const hook=installFilter(host.app,compiled.matcher,'linux',{onChange(){notices++;throw Error('observer failure');}});
  const foreignGetter=()=>{throw Error('foreign getter failure');};Object.defineProperty(host.adapter,'reconcileFile',{configurable:true,get:foreignGetter});
  assert.throws(()=>host.app.vault.load(),cause=>cause===error);assert.equal(hook.phase,'error');assert.equal(notices,1);assert.equal(Object.getOwnPropertyDescriptor(host.adapter,'reconcileFile').get,foreignGetter);restored(before.filter(entry=>entry.key!=='reconcileFile'));hook.dispose();
});

test('failure preserves a foreign accessor returning an own wrapper and restores inherited native methods',async()=>{
  const host=fakeHost();const error=Error('native load failure');host.app.vault.load=()=>{throw error;};
  const inherited=host.adapter.listRecursive;delete host.adapter.listRecursive;Object.setPrototypeOf(host.adapter,{listRecursive:inherited});const before=methods(host);const hook=await install(host,'Technical');
  const retained=host.adapter.reconcileFile;const foreignGetter=()=>retained;Object.defineProperty(host.adapter,'reconcileFile',{configurable:true,enumerable:false,get:foreignGetter});const foreign=Object.getOwnPropertyDescriptor(host.adapter,'reconcileFile');
  assert.throws(()=>host.app.vault.load(),cause=>cause===error);assert.deepEqual(Object.getOwnPropertyDescriptor(host.adapter,'reconcileFile'),foreign);assert.equal(Object.hasOwn(host.adapter,'listRecursive'),false);assert.equal(host.adapter.listRecursive,inherited);restored(before.filter(entry=>entry.key!=='reconcileFile'));
  await host.adapter.reconcileFile('Technical/secret.md','Technical/secret.md');assert.ok(host.indexed.has('Technical/secret.md'));assert.equal(hook.phase,'error');hook.dispose();
});

for(const asynchronous of [false,true])test(`filter completion failure preserves the native ${asynchronous?'Promise':'return value'} without retry`,async()=>{
  const host=fakeHost();host.adapter.files.notes={type:'folder',realpath:'notes'};const nativeValue=asynchronous?Promise.resolve('native result'):{result:'native result'};let calls=0;host.adapter.listRecursive=()=>{calls++;host.adapter.files.notes.realpath='notes/changed';return nativeValue;};
  const compiled=await compileRules('!notes/public.md\nnotes',{platform:'linux'});let decisions=0;const matcher={...compiled.matcher,match(path){if(++decisions===2)throw Error('completion failure');return compiled.matcher.match(path);}};
  const before=methods(host);const sources=structuredClone(host.physical);const hook=installFilter(host.app,matcher,'linux');const returned=host.adapter.listRecursive('notes');assert.equal(returned,nativeValue);if(asynchronous)assert.equal(await returned,'native result');
  assert.equal(hook.phase,'error');assert.equal(hook.reloadNeeded,true);assert.equal(calls,1);restored(before);assert.deepEqual(host.physical,sources);hook.dispose();
});

for(const synchronous of [true,false])test(`ordinary rename ${synchronous?'throw':'rejection'} is neither retried nor treated as a broken filter`,async()=>{
  const host=fakeHost();const sources=structuredClone(host.physical);const error=Error('rename denied');let attempts=0;host.adapter.rename=()=>{attempts++;if(synchronous)throw error;return Promise.reject(error);};
  const hook=await install(host,'Technical');await host.app.vault.load();host.layout();const retained=host.indexed.get('notes/public.md');
  if(synchronous)assert.throws(()=>host.adapter.rename('notes/public.md','Technical/secret.md'),cause=>cause===error);
  else await assert.rejects(host.adapter.rename('notes/public.md','Technical/secret.md'),cause=>cause===error);
  assert.equal(attempts,1);assert.equal(hook.phase,'applied');assert.equal(hook.reloadNeeded,false);assert.equal(retained.path,'notes/public.md');assert.deepEqual(host.physical,sources);
  host.io.length=0;await host.adapter.reconcileFile('Technical/secret.md','Technical/secret.md');assert.deepEqual(host.io,[]);hook.dispose();
});

test('native reconcile ENOENT remains handled by the host without disabling a healthy filter',async()=>{
  const host=fakeHost();const hook=await install(host,'Technical');await host.app.vault.load();host.layout();const retained=host.indexed.get('notes/public.md');host.physical.delete('notes/public.md');
  await host.adapter.reconcileFile('notes/public.md','notes/public.md');assert.equal(retained.deleted,true);assert.equal(host.indexed.has('notes/public.md'),false);assert.equal(hook.phase,'applied');assert.equal(hook.reloadNeeded,false);
  host.io.length=0;await host.adapter.reconcileFile('Technical/secret.md','Technical/secret.md');assert.deepEqual(host.io,[]);hook.dispose();
});
test('partial managed mobile failure restores ordinary bulk only after reporting unfiltered recovery',async()=>{
  const host=fakeHost(true);const readdir=host.adapter.fs.readdir;host.adapter.fs.readdir=async p=>{if(p==='/vault/notes')throw Error('provider failure');return readdir(p);};const bulk=host.adapter.fs.watchAndStatAll;let phaseAtBulk;
  host.adapter.fs.watchAndStatAll=async(...args)=>{phaseAtBulk=hook.phase;return bulk(...args);};const hook=await install(host,'Technical');await host.app.vault.load();host.layout();assert.equal(phaseAtBulk,'error');assert.equal(hook.phase,'error');assert.ok(host.indexed.has('Technical/secret.md'));
});
