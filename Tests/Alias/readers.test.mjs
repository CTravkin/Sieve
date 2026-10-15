import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {readFile,readdir} from 'node:fs/promises';
import {loadRuntime} from '../Fixtures/load-runtime.mjs';
import {aliasHost,config,vaults,tick} from './host.mjs';
import {uiSdk} from '../Fixtures/ui-host.mjs';
const {desktopAliasProvider}=await loadRuntime('platform/desktop');
const {mobileAliasProvider}=await loadRuntime('platform/mobile');
const {displayName,resolveNames}=await loadRuntime('alias/display-name');
const {installAliases}=await loadRuntime('alias/projection',uiSdk);

test('desktop validates native current ID, preserves duplicate basenames, and honors per-vault configDir',async()=>{
  const list=vaults(),calls=[],values=new Map([[list[1].id+'-config','.alternate']]);let appId=list[0].id;
  globalThis.window={electron:{ipcRenderer:{sendSync(channel){return channel==='vault'?{path:list[0].path}:Object.fromEntries(list.map(v=>[v.id,{path:v.path}]));}}},require:name=>{assert.equal(name,'path');return path.posix;},localStorage:{getItem:key=>values.get(key)??null}};
  const provider=desktopAliasProvider({fsPromises:{async readFile(...args){calls.push(args);return config('Read alias');}}},appId,'.custom');
  try{assert.deepEqual(provider.list(),list);assert.equal(await provider.read(list[0]),config('Read alias'));assert.equal(await provider.read(list[1]),config('Read alias'));assert.deepEqual(calls,[['/one/Shared/.custom/plugins/sieve/data.json','utf8'],['/two/Shared/.alternate/plugins/sieve/data.json','utf8']]);
    values.set(list[1].id+'-config','../outside');await assert.rejects(provider.read(list[1]),/unavailable/);assert.equal(calls.length,2);
    const wrong=desktopAliasProvider({fsPromises:{readFile(){throw Error('must not read');}}},'wrong','.custom');assert.equal(wrong.list(),undefined);await assert.rejects(wrong.read(list[1]),/unavailable/);
  }finally{delete globalThis.window;}
});

test('mobile only reads native item paths through the existing provider; inaccessible configs fall back',async()=>{
  const calls=[];const provider=mobileAliasProvider({fs:{read(p){calls.push(p);if(p.startsWith('icloud/'))throw Error('denied');return config('Mobile alias');}}},'.custom');
  const items=[{path:'documents/Shared',name:'Shared',isCurrentVault:false},{path:'icloud/Shared',name:'Shared (iCloud)',isCurrentVault:false},{path:'content://native-tree/Shared',name:'Shared',isCurrentVault:false}];
  assert.deepEqual(await resolveNames(items,provider,''),['Mobile alias','Shared (iCloud)','Mobile alias']);assert.deepEqual(calls,['documents/Shared/.obsidian/plugins/sieve/data.json','icloud/Shared/.obsidian/plugins/sieve/data.json','content://native-tree/Shared/.obsidian/plugins/sieve/data.json']);
  await assert.rejects(provider.read({path:'../outside',name:'x',isCurrentVault:false}),/unavailable/);assert.equal(calls.length,3);
});

test('names are literal text, invalid/missing schemas default, and alias reads never compile other rules',async()=>{
  const originals=['','  ','Учеба 🧪','<img src=x onerror=alert(1)>','X'.repeat(5000)];for(const alias of originals){assert.equal(displayName('Shared',alias),alias.trim()?alias:'Shared');assert.deepEqual(await resolveNames([vaults()[1]],{read:async()=>config(alias)},''),[alias.trim()?alias:'Shared']);}
  for(const raw of ['{',undefined,{schemaVersion:2,rules:'',displayName:'Wrong'},{schemaVersion:1,displayName:'Missing rules'}])assert.deepEqual(await resolveNames([vaults()[1]],{read:async()=>raw},''),['Shared']);
  assert.deepEqual(await resolveNames(vaults(),{read:async()=>{throw Error('secret details');}},'Accepted'),['Accepted','Shared']);
  assert.deepEqual(await resolveNames([vaults()[1]],{read:()=>new Promise(()=>{})},'',5),['Shared']);
});

test('portable alias runtime contains no Node/Electron imports outside lazy desktop provider',async()=>{
  const aliases=await readdir(new URL('../../src/alias/',import.meta.url));
  for(const file of [...aliases.filter(file=>file.endsWith('.ts')).map(file=>'alias/'+file),'platform/mobile.ts']){const source=await readFile(new URL('../../src/'+file,import.meta.url),'utf8');assert.doesNotMatch(source,/(?:from\s*|import\s*\(|require\s*\()\s*['"](?:node:|fs|path|electron|@electron\/remote)/);}
});

for(const surface of ['drawer','chooser'])test(`200-vault ${surface} uses constant IPC and bounded concurrent config reads in native order`,async()=>{
  const h=aliasHost(),list=Array.from({length:200},(_,index)=>({id:(index+1).toString(16).padStart(16,'0'),path:'/vault-'+index+'/Shared',name:'Shared',isCurrentVault:index===0}));h.list.splice(0,h.list.length,...list);h.app.appId=list[0].id;
  const ipcCalls=[];globalThis.window={electron:{ipcRenderer:{sendSync(channel){ipcCalls.push(channel);return channel==='vault'?{path:list[0].path}:Object.fromEntries(list.map(v=>[v.id,{path:v.path}]));}}},require:()=>path.posix,localStorage:{getItem:()=>null}};
  let active=0,peak=0,readCount=0;const provider=desktopAliasProvider({fsPromises:{async readFile(file){active++;peak=Math.max(peak,active);readCount++;await tick();active--;return config(file.split('/')[1]);}}},list[0].id,'.custom');const p=installAliases(h.app,provider,h.current,{document:h.doc,sdk:h.sdk,timeoutMs:2000});
  try{let modal;if(surface==='drawer')h.doc.switcher.click();else modal=h.app.commands.commands['app:switch-vault'].callback();
    for(let count=0;count<200 && (readCount<199 || active);count++)await tick();await tick();
    assert.equal(readCount,199);assert.ok(peak<=4,'concurrent file reads must be <=4');assert.equal(ipcCalls.filter(channel=>channel==='vault-list').length,2);assert.equal(ipcCalls.filter(channel=>channel==='vault').length,2);
    const names=surface==='drawer'?h.menus[0].items.slice(0,200).map(item=>item.titleEl.textContent):modal.search;assert.deepEqual(names,list.map((_,index)=>index===0?'Current alias':'vault-'+index));
    if(surface==='drawer'){assert.deepEqual(h.menus[0].items.slice(0,200).map(item=>item.checked),list.map(v=>v.isCurrentVault));h.menus[0].items[199].callback();}else modal.onChooseItem(modal.items[199]);assert.deepEqual(h.selected,[list[199].path]);
  }finally{p.dispose();delete globalThis.window;}
});

test('a projection-wide deadline never replaces timed-out native reads with more pending reads',async()=>{
  const items=Array.from({length:100},(_,index)=>({path:'/v'+index,name:'Original '+index,isCurrentVault:false}));let readCount=0,active=0,peak=0;
  const start=performance.now();const names=await resolveNames(items,{read(){readCount++;active++;peak=Math.max(peak,active);return new Promise(()=>{});}},'',15);const elapsed=performance.now()-start;
  assert.ok(elapsed<200,'one deadline bounds the whole projection, not every batch');
  assert.equal(readCount,4);assert.equal(peak,4);assert.deepEqual(names,items.map(item=>item.name));await tick();assert.equal(readCount,4,'expired workers must stop scheduling reads');
});

test('cancelled read workers finish existing operations but never launch the remaining files',async()=>{
  const items=Array.from({length:100},(_,index)=>({path:'/v'+index,name:'Original '+index,isCurrentVault:false}));let release,cancelled=false,starts=0;const gate=new Promise(resolve=>{release=resolve;});
  const pending=resolveNames(items,{async read(){starts++;await gate;return config('Read');}},'',1500,()=>cancelled);await tick();assert.equal(starts,4);cancelled=true;release();await pending;assert.equal(starts,4);
});

test('chooser snapshot invalidation retains native names and selection without per-item IPC',async()=>{
  const h=aliasHost(),list=h.list,ipcCalls=[];let invalid=false;
  globalThis.window={electron:{ipcRenderer:{sendSync(channel){ipcCalls.push(channel);if(invalid)throw Error('registry unavailable');return channel==='vault'?{path:list[0].path}:Object.fromEntries(list.map(v=>[v.id,{path:v.path}]));}}},require:()=>path.posix,localStorage:{getItem:()=>null}};
  const provider=desktopAliasProvider({fsPromises:{async readFile(){invalid=true;return config('Stale alias');}}},list[0].id,'.custom'),p=installAliases(h.app,provider,h.current,{document:h.doc,sdk:h.sdk});
  try{const modal=h.app.commands.commands['app:switch-vault'].callback();await tick();assert.deepEqual(modal.search,['Current alias','Shared']);modal.onChooseItem(modal.items[1]);assert.deepEqual(h.selected,['/two/Shared']);assert.equal(ipcCalls.length,3,'one failed recheck, never per-file registry scans');}finally{p.dispose();delete globalThis.window;}
});
