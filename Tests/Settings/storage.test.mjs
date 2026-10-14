import assert from 'node:assert/strict';
import test from 'node:test';
import {loadRuntime} from '../Fixtures/load-runtime.mjs';

const {SettingsService}=await loadRuntime('settings/storage');
const config=(rules='',displayName='')=>({schemaVersion:1,rules,displayName});
function memory(initial={}) {
  const files=new Map(Object.entries(initial)); const writes=[];
  return {files,writes,failBackup:false,async exists(p){return files.has(p);},async read(p){if(!files.has(p))throw Error('secret-read-error');return files.get(p);},async write(p,v){if(this.failBackup&&p.endsWith('previous.json'))throw Error('secret-write-error');writes.push(p);files.set(p,v);}};
}
const options=(io,readInclude)=>({io,configDir:'.custom',platform:'linux',readInclude});
const current='.custom/plugins/sieve/data.json'; const previous='.custom/plugins/sieve/data.previous.json';

test('sanitized settings diagnostics preserve root provenance without retaining parser reason',async()=>{
  const io=memory();const service=new SettingsService(options(io,async()=> '['));await service.startup();
  const root=await service.save(config('['));const included=await service.save(config('#include .stignore'));
  assert.equal(root.ok,false);assert.equal(included.ok,false);assert.equal(root.error.diagnostics[0].source,'.stignore');assert.equal(included.error.diagnostics[0].source,'.stignore');
  assert.equal(root.error.diagnostics[0].isRoot,true);assert.equal(included.error.diagnostics[0].isRoot,false);assert.deepEqual(io.writes,[]);assert.doesNotMatch(JSON.stringify(included),/unexpected end|invalid pattern/);
});

test('unchanged startup/save writes no backup; changed save keeps active independent from saved/draft',async()=>{
  const io=memory({[current]:JSON.stringify(config('private'))});const service=new SettingsService(options(io));
  const startup=await service.startup();assert.equal(startup.ok,true);service.confirmActive();
  assert.equal((await service.save(config('private'))).ok,true);assert.deepEqual(io.writes,[]);
  assert.equal((await service.save(config('next','Display'))).ok,true);
  assert.deepEqual(io.writes,[previous,current]);assert.equal(service.state.active.rules,'private');assert.equal(service.state.saved.rules,'next');assert.equal(service.state.pending,true);
  assert.equal(JSON.parse(io.files.get(previous)).settings.rules,'private');
});
test('fallback uses captured binary includes even after live dependency fails',async()=>{
  const io=memory({[current]:JSON.stringify(config('#include ../rules'))});let available=true;
  const service=new SettingsService(options(io,async()=>{if(!available)throw Error('secret-dependency');return Uint8Array.from([47,47,255,10,112,114,105,118,97,116,101]);}));
  assert.equal((await service.startup()).ok,true);service.confirmActive();await service.save(config('next'));
  available=false;io.files.set(current,JSON.stringify(config('#include ../missing')));
  const replacement=new SettingsService(options(io,async()=>{throw Error('secret-dependency');}));const recovered=await replacement.startup();
  assert.equal(recovered.ok,true);assert.equal(recovered.fallback,true);assert.equal(recovered.compiled.matcher.match('private').ignored,true);
  assert.equal(replacement.state.active.rules,'#include ../rules');assert.ok(!JSON.stringify(replacement.state.error).includes('secret-dependency'));
});

test('recovery Save of the active fallback snapshot stays pending until a fresh valid startup',async()=>{
  const settings=config('#include rules','Recovered');const snapshot={schemaVersion:1,settings,includes:[{path:'rules',contentBase64:btoa('Technical')}]};
  const io=memory({[current]:'{',[previous]:JSON.stringify(snapshot)});const service=new SettingsService(options(io,async()=> 'Technical'));
  assert.equal((await service.startup()).fallback,true);service.confirmActive();assert.equal(service.state.pending,true);
  assert.equal((await service.save(config('['))).ok,false);assert.deepEqual(io.writes,[]);assert.equal(io.files.get(current),'{');assert.equal(service.state.fallback,true);
  const saved=await service.save(settings);assert.equal(saved.ok,true);assert.equal(saved.changed,true);assert.equal(saved.pending,true);assert.equal(service.state.pending,true);assert.equal(service.state.fallback,true);assert.equal(service.state.error,undefined);assert.deepEqual(service.state.active,settings);
  assert.deepEqual(io.writes,[previous,current]);assert.deepEqual(JSON.parse(io.files.get(previous)),snapshot);assert.deepEqual(JSON.parse(io.files.get(current)),settings);assert.equal([...io.files.keys()].filter(path=>path.includes('previous')).length,1);
  const unchanged=await service.save(settings);assert.equal(unchanged.changed,false);assert.equal(unchanged.pending,true);assert.deepEqual(io.writes,[previous,current]);service.dispose();
  const reopened=new SettingsService(options(io,async()=> 'Technical'));const startup=await reopened.startup();assert.equal(startup.ok,true);assert.equal(startup.fallback,false);assert.equal(reopened.state.fallback,false);assert.equal(reopened.state.pending,false);assert.equal(reopened.state.error,undefined);assert.deepEqual(reopened.state.active,settings);reopened.dispose();
});
test('invalid JSON/candidate and backup failure never overwrite current or expose raw source',async()=>{
  const io=memory({[current]:'{"password":"top-secret"'});const broken=new SettingsService(options(io));
  assert.equal((await broken.startup()).ok,false);assert.ok(!JSON.stringify(broken.state).includes('top-secret'));
  io.files.set(current,JSON.stringify(config('private')));const service=new SettingsService(options(io));await service.startup();service.confirmActive();
  assert.equal((await service.save(config('['))).ok,false);assert.deepEqual(io.writes,[]);
  io.failBackup=true;assert.equal((await service.save(config('next'))).ok,false);assert.equal(JSON.parse(io.files.get(current)).rules,'private');assert.deepEqual(io.writes,[]);
});

test('missing settings default only this vault while malformed/unsupported schema remains an error',async()=>{
  const absent=memory();const fresh=new SettingsService(options(absent));assert.equal((await fresh.startup()).ok,true);assert.deepEqual(fresh.state.active,config());assert.deepEqual(absent.writes,[]);
  for(const invalid of [{rules:'',displayName:''},{schemaVersion:2,rules:'',displayName:''},[],{schemaVersion:1,rules:2,displayName:''}]) {
    const service=new SettingsService(options(memory({[current]:JSON.stringify(invalid)})));assert.equal((await service.startup()).ok,false);assert.equal(service.state.active,undefined);
  }
});
test('manual app-open change captures working backup without overwriting the manually changed data',async()=>{
  const io=memory({[current]:JSON.stringify(config('private'))});const service=new SettingsService(options(io));await service.startup();service.confirmActive();
  const manual=JSON.stringify(config('['));io.files.set(current,manual);
  const changed=await service.externalChange();assert.equal(changed.ok,false);assert.equal(service.state.pending,true);assert.equal(io.files.get(current),manual);assert.deepEqual(io.writes,[previous]);
  const next=new SettingsService(options(io));const result=await next.startup();assert.equal(result.ok,true);assert.equal(result.fallback,true);assert.equal(next.state.active.rules,'private');
});
test('invalid previous snapshot does not turn startup error into an empty filter',async()=>{
  const io=memory({[current]:JSON.stringify(config('[')),[previous]:JSON.stringify({schemaVersion:1,settings:config('private'),includes:[{path:'/absolute-secret',contentBase64:'!invalid'}]})});
  const service=new SettingsService(options(io));assert.equal((await service.startup()).ok,false);assert.equal(service.state.active,undefined);assert.deepEqual(io.writes,[]);
});
test('unload cancels a delayed include before publishing any active revision',async()=>{
  const io=memory({[current]:JSON.stringify(config('#include delayed'))});let release;const pending=new Promise(r=>{release=r;});
  const service=new SettingsService(options(io,()=>pending));const start=service.startup();await new Promise(r=>setTimeout(r,0));service.dispose();release('private');
  assert.equal((await start).ok,false);assert.equal(service.state.active,undefined);assert.deepEqual(io.writes,[]);
});
test('hung include cannot hold startup past its IO deadline',async()=>{
  const io=memory({[current]:JSON.stringify(config('#include delayed'))});const service=new SettingsService({...options(io,()=>new Promise(()=>{})),timeoutMs:20});
  const result=await service.startup();assert.equal(result.ok,false);assert.equal(service.state.error.code,'timeout');assert.equal(service.state.active,undefined);assert.deepEqual(io.writes,[]);
});
test('concurrent saves serialize and preserve the same observed working snapshot',async()=>{
  const io=memory({[current]:JSON.stringify(config('private'))});const service=new SettingsService(options(io));await service.startup();service.confirmActive();
  const results=await Promise.all([service.save(config('first')),service.save(config('last'))]);assert.ok(results.every(x=>x.ok));assert.equal(service.state.saved.rules,'last');assert.equal(service.state.active.rules,'private');assert.equal(JSON.parse(io.files.get(previous)).settings.rules,'private');
});
test('IO timeout recovers a previously captured config without another IO reader',async()=>{
  const io=memory({[current]:JSON.stringify(config('#include delayed')),[previous]:JSON.stringify({schemaVersion:1,settings:config('private'),includes:[]})});
  const service=new SettingsService({...options(io,()=>new Promise(()=>{})),timeoutMs:20});assert.equal((await service.startup()).fallback,true);assert.equal(service.state.error.code,'timeout');assert.equal(service.state.active.rules,'private');assert.deepEqual(io.writes,[]);
});
test('snapshots safely retain own __proto__ include names and only own schema properties are accepted',async()=>{
  const io=memory({[current]:JSON.stringify(config('#include __proto__'))});const service=new SettingsService(options(io,async()=>new TextEncoder().encode('private')));await service.startup();service.confirmActive();await service.save(config('next'));
  assert.equal(JSON.parse(io.files.get(previous)).includes[0].path,'__proto__');io.files.set(current,JSON.stringify(config('[')));const next=new SettingsService(options(io));assert.equal((await next.startup()).fallback,true);
  assert.equal((await next.save(Object.create(config('innocent')))).ok,false);assert.equal({}.rules,undefined);
});
test('explicit save notices changed include bytes, captures previous bytes and leaves the old matcher active',async()=>{
  const io=memory({[current]:JSON.stringify(config('#include included'))});let text='private';const service=new SettingsService(options(io,async()=>text));await service.startup();service.confirmActive();text='other';
  const saved=await service.save(config('#include included'));assert.equal(saved.changed,true);assert.equal(saved.pending,true);assert.deepEqual(io.writes,[previous,current]);assert.equal(atob(JSON.parse(io.files.get(previous)).includes[0].contentBase64),'private');
  const count=io.writes.length;assert.equal((await service.save(config('#include included'))).changed,false);assert.equal(io.writes.length,count);
});
test('repeated notification for identical invalid manual data does not rewrite the backup',async()=>{
  const io=memory({[current]:JSON.stringify(config('private'))});const service=new SettingsService(options(io));await service.startup();service.confirmActive();io.files.set(current,'{"secret":"unclosed');
  await service.externalChange();await service.externalChange();assert.deepEqual(io.writes,[previous]);assert.ok(!JSON.stringify(service.state).includes('unclosed'));
});
test('outside lexical aliases retain ordered duplicate include bytes in a portable fallback',async()=>{
  const io=memory({[current]:JSON.stringify(config('#include ../common\n#include .././common'))});let index=0;
  const service=new SettingsService(options(io,async()=>index++?'second':'first'));const initial=await service.startup();assert.equal(initial.ok,true);service.confirmActive();await service.save(config('next'));
  const captures=JSON.parse(io.files.get(previous)).includes;assert.equal(captures.length,2);assert.equal(captures[0].path,captures[1].path);assert.notEqual(captures[0].contentBase64,captures[1].contentBase64);
  io.files.set(current,JSON.stringify(config('[')));const next=new SettingsService(options(io));const fallback=await next.startup();assert.equal(fallback.fallback,true);assert.equal(fallback.compiled.matcher.match('first').ignored,true);assert.equal(fallback.compiled.matcher.match('second').ignored,true);
});
