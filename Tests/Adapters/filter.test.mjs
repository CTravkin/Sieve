import assert from 'node:assert/strict';
import test from 'node:test';
import {loadRuntime} from '../Fixtures/load-runtime.mjs';
import {fakeHost,hostKey} from '../Fixtures/host-adapter.mjs';
const {compileRules}=await loadRuntime('core/matcher');
const {installFilter}=await loadRuntime('platform/lifecycle');
async function install(host,rules){const result=await compileRules(rules,{platform:'linux'});assert.equal(result.ok,true);return installFilter(host.app,result.matcher,host.adapter.fs?'android':'linux');}

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
test('a synchronous initial vault-load error never claims completed or applied',async()=>{
  const host=fakeHost();host.app.vault.load=()=>{throw Error('synthetic load failure');};const hook=await install(host,'Technical');assert.throws(()=>host.app.vault.load(),/synthetic/);host.layout();assert.equal(hook.phase,'error');assert.equal(hook.initialCompleted,false);
});
test('partial managed mobile failure restores ordinary bulk only after reporting unfiltered recovery',async()=>{
  const host=fakeHost(true);const readdir=host.adapter.fs.readdir;host.adapter.fs.readdir=async p=>{if(p==='/vault/notes')throw Error('provider failure');return readdir(p);};const bulk=host.adapter.fs.watchAndStatAll;let phaseAtBulk;
  host.adapter.fs.watchAndStatAll=async(...args)=>{phaseAtBulk=hook.phase;return bulk(...args);};const hook=await install(host,'Technical');await host.app.vault.load();host.layout();assert.equal(phaseAtBulk,'error');assert.equal(hook.phase,'error');assert.ok(host.indexed.has('Technical/secret.md'));
});
