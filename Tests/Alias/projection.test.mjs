import assert from 'node:assert/strict';
import test from 'node:test';
import {loadRuntime} from '../Fixtures/load-runtime.mjs';
import {uiSdk} from '../Fixtures/ui-host.mjs';
import {aliasHost,Document,deferred,tick} from './host.mjs';
const {installAliases}=await loadRuntime('alias/projection',uiSdk);
const install=h=>installAliases(h.app,h.provider,h.current,{document:h.doc,sdk:h.sdk,timeoutMs:25});

for(const nativeMenu of [false,true])test(`drawer resolves every alias before native conversion (nativeMenu=${nativeMenu})`,async()=>{
  const h=aliasHost({nativeMenu}),gate=deferred();h.provider.read=async vault=>{h.reads.push(vault.path);await gate.promise;return{schemaVersion:1,rules:'[',displayName:'Other alias'};};
  const originalId=h.app.appId,originalGetName=h.app.vault.getName;const p=install(h);try{
    h.doc.switcher.click();assert.equal(h.menus.length,0);assert.equal(h.reads.length,0,'no async reads in event capture stack');await tick();assert.deepEqual(h.reads,['/two/Shared']);gate.resolve();await tick();await new Promise(resolve=>setTimeout(resolve,1));
    assert.equal(h.menus.length,1);const menu=h.menus[0];assert.deepEqual(menu.converted,['Current alias','Other alias',undefined,'Manage vaults']);assert.deepEqual(menu.items.slice(0,2).map(item=>item.checked),[true,false]);menu.items[1].callback();menu.items[3].callback();assert.deepEqual(h.selected,['/two/Shared','manage']);
    assert.equal(h.app.appId,originalId);assert.equal(h.app.vault.getName,originalGetName);assert.equal(h.doc.label.textContent,'Current alias');assert.equal(h.doc.title,'Note - Current alias - Obsidian 1.14.4');
  }finally{gate.resolve();p.dispose();}assert.equal(h.doc.label.textContent,'Shared');assert.equal(h.doc.title,'Note - Shared - Obsidian 1.14.4');assert.deepEqual(h.menus[0].items.map(item=>item.titleEl?.textContent),['Shared','Shared',undefined,'Manage vaults']);
});

test('commands capture only their native instance, restore prototype before async reads and refresh alias search',async()=>{
  const h=aliasHost(),prototype=h.sdk.FuzzySuggestModal.prototype,originalOpen=prototype.open,command=h.app.commands.commands['app:switch-vault'],originalCallback=command.callback;
  h.provider.read=async()=>{assert.equal(prototype.open,originalOpen);return {schemaVersion:1,rules:'[',displayName:'Other alias'};};
  const originalChoose=h.NativeChooser.prototype.onChooseItem,p=install(h);
  try{const modal=command.callback();assert.equal(prototype.open,originalOpen);await tick();assert.deepEqual(modal.search,['Current alias','Other alias']);assert.equal(modal.onChooseItem,originalChoose);assert.deepEqual(modal.items.map(item=>item.path),['/one/Shared','/two/Shared']);modal.onChooseItem(modal.items[1]);assert.deepEqual(h.selected,['/two/Shared']);
    h.setCurrent('Changed');p.refresh();await tick();assert.deepEqual(modal.search,['Changed','Other alias']);
    const unrelated=new h.NativeChooser().open();await tick();assert.deepEqual(unrelated.search,['Shared','Shared']);unrelated.close();
    modal.close();assert.deepEqual(modal.items.map(item=>item.name),['Shared','Shared']);
  }finally{p.dispose();}assert.equal(command.callback,originalCallback);assert.equal(prototype.open,originalOpen);
});

test('async mobile-style load finishes before alias projection; close/dispose cancel inflight work',async()=>{
  const loadGate=deferred(),h=aliasHost({loadGate}),p=install(h),modal=h.app.commands.commands['app:open-another-vault'].callback();
  assert.deepEqual(modal.items,[]);assert.equal(h.reads.length,0);loadGate.resolve();await tick();assert.deepEqual(modal.search,['Current alias','Other alias']);
  const readGate=deferred();h.provider.read=()=>readGate.promise;h.setCurrent('Cancelled');p.refresh();modal.close();readGate.resolve({schemaVersion:1,rules:'',displayName:'Late'});await tick();assert.deepEqual(modal.items.map(item=>item.name),['Shared','Shared']);
  const second=h.app.commands.commands['app:switch-vault'].callback();await tick();p.dispose();assert.deepEqual(second.items.map(item=>item.name),['Shared','Shared']);
});

test('foreign command/title wrappers survive unload while retained Sieve wrappers become inert',async()=>{
  const h=aliasHost(),p=install(h),command=h.app.commands.commands['app:switch-vault'];const ours=command.callback,ourTitle=h.app.getAppTitle;
  const foreign=function(...args){return ours.apply(this,args);},foreignTitle=function(...args){return 'Foreign '+ourTitle.apply(this,args);};command.callback=foreign;h.app.getAppTitle=foreignTitle;
  h.doc.label.textContent='Foreign label';h.doc.title='Foreign title';p.dispose();assert.equal(command.callback,foreign);assert.equal(h.app.getAppTitle,foreignTitle);assert.equal(h.app.getAppTitle(),'Foreign Shared - Obsidian 1.14.4');
  assert.equal(h.doc.label.textContent,'Foreign label');assert.equal(h.doc.title,'Foreign title');const modal=command.callback();await tick();assert.deepEqual(modal.search,['Shared','Shared']);assert.equal(h.doc.handlers.length,0);
});

test('command throw/reentrancy always restores temporary prototype and return/this/arguments',async()=>{
  const h=aliasHost(),prototype=h.sdk.FuzzySuggestModal.prototype,open=prototype.open,command=h.app.commands.commands['app:switch-vault'];let calls=0;
  command.callback=function(arg){assert.equal(this,command);assert.equal(arg,42);calls++;if(calls===1)return command.callback.call(this,arg);new h.NativeChooser().open();return 'native return';};const p=install(h);
  assert.equal(command.callback.call(command,42),'native return');await tick();assert.equal(prototype.open,open);assert.deepEqual(h.modals[0].search,['Current alias','Other alias']);p.dispose();
  command.callback=()=>{throw Error('native throw');};const p2=install(h);assert.throws(()=>command.callback(),/native throw/);assert.equal(prototype.open,open);p2.dispose();
});

test('unrelated/defaultPrevented clicks, contextmenu and unsupported surfaces retain host behavior',async()=>{
  const h=aliasHost(),p=install(h);const originalRead=h.provider.read;h.provider.read=()=>{throw Error('must not read');};
  for(const event of [{type:'click',button:0,defaultPrevented:true,target:h.doc.switcher},{type:'contextmenu',button:2,target:h.doc.switcher},{type:'click',button:0,target:{closest:()=>null}}])for(const [callback,capture] of h.doc.handlers)if(capture)callback(event);
  await tick();assert.equal(h.menus.length,0);p.dispose();h.provider.read=originalRead;
  Object.defineProperty(h.app,'getAppTitle',{configurable:false,writable:false,value:h.app.getAppTitle});Object.defineProperty(h.app.commands.commands['app:switch-vault'],'callback',{configurable:false,value:()=> 'unchanged'});
  const unsupported=installAliases(h.app,{read:h.provider.read},h.current,{document:h.doc,sdk:{}});assert.equal(unsupported.capabilities.windowTitle,false);assert.equal(unsupported.capabilities.drawer,false);assert.deepEqual(unsupported.capabilities.commands,[]);assert.equal(unsupported.capabilities.activeLabel,true);unsupported.dispose();
});

test('dispose/close and newest-click cancellation do not replay late native menus',async()=>{
  const h=aliasHost(),gate=deferred();h.provider.read=()=>gate.promise;const p=install(h);h.doc.switcher.click();await tick();p.dispose();gate.resolve({schemaVersion:1,rules:'',displayName:'Late'});await tick();assert.equal(h.menus.length,0);
  const h2=aliasHost(),first=deferred();let reads=0;h2.provider.read=()=>++reads===1?first.promise:Promise.resolve({schemaVersion:1,rules:'',displayName:'Latest'});const p2=install(h2);h2.doc.switcher.click();await tick();h2.doc.switcher.click();await tick();first.resolve({schemaVersion:1,rules:'',displayName:'Old'});await tick();assert.equal(h2.menus.length,1);assert.equal(h2.menus[0].items[1].titleEl.textContent,'Latest');p2.dispose();
});

test('registry changes during reads replay one fresh native menu without stale aliases',async()=>{
  const h=aliasHost(),gate=deferred();h.provider.read=()=>gate.promise;const listeners=new Map();h.app.workspace.on=(name,cb)=>{listeners.set(name,cb);return name;};h.app.workspace.offref=name=>listeners.delete(name);const p=install(h);
  const second=new Document();listeners.get('window-open')({}, {document:second});assert.equal(second.title,'Note - Current alias - Obsidian 1.14.4');
  h.doc.switcher.click();await tick();h.list[1]={...h.list[1],path:'/changed/Shared'};gate.resolve({schemaVersion:1,rules:'',displayName:'Stale alias'});await tick();assert.equal(h.menus.length,1);assert.deepEqual(h.menus[0].items.map(item=>item.titleEl?.textContent),['Shared','Shared',undefined,'Manage vaults']);h.menus[0].items[1].callback();assert.deepEqual(h.selected,['/changed/Shared']);p.dispose();assert.equal(second.label.textContent,'Shared');assert.equal(second.title,'Note - Shared - Obsidian 1.14.4');assert.equal(listeners.size,0);
});

test('host note-title updates through getAppTitle restore the original vault suffix on unload',()=>{
  const h=aliasHost(),p=install(h);h.doc.title=h.app.getAppTitle('Second note');p.refresh();assert.equal(h.doc.title,'Second note - Current alias - Obsidian 1.14.4');
  h.setCurrent('<literal 🧪>');p.refresh();assert.equal(h.doc.title,'Second note - <literal 🧪> - Obsidian 1.14.4');h.doc.label.textContent='Foreign owner';p.refresh();assert.equal(h.doc.label.textContent,'Foreign owner');p.dispose();assert.equal(h.doc.title,'Second note - Shared - Obsidian 1.14.4');assert.equal(h.doc.label.textContent,'Foreign owner');
});

test('late prototype lock keeps commands usable and leaves other modals untouched',async()=>{
  const h=aliasHost(),p=install(h),prototype=h.sdk.FuzzySuggestModal.prototype;Object.defineProperty(prototype,'open',{value:prototype.open,configurable:false,writable:false});
  const modal=h.app.commands.commands['app:switch-vault'].callback();await tick();assert.deepEqual(modal.search,['Shared','Shared']);p.dispose();
});

test('current alias saved while drawer reads are pending is used by the eventual native conversion',async()=>{
  const h=aliasHost({nativeMenu:true}),gate=deferred();h.provider.read=()=>gate.promise;const p=install(h);h.doc.switcher.click();await tick();h.setCurrent('Saved during I/O');p.refresh();gate.resolve({schemaVersion:1,rules:'',displayName:'Other'});await tick();assert.equal(h.menus[0].items[0].titleEl.textContent,'Saved during I/O');p.dispose();
});

test('HTML and long Unicode aliases stay literal in drawer, search, title and active label',async()=>{
  const h=aliasHost(),literal='<img src=x onerror=alert(1)> Учеба 🧪 '+'X'.repeat(5000);h.setCurrent(literal);h.provider.read=async()=>({schemaVersion:1,rules:'',displayName:literal});const p=install(h);
  h.doc.switcher.click();const modal=h.app.commands.commands['app:switch-vault'].callback();await tick();assert.equal(h.doc.label.textContent,literal);assert.equal(h.app.getAppTitle(),literal+' - Obsidian 1.14.4');assert.deepEqual(modal.search,[literal,literal]);assert.equal(h.menus[0].items[1].titleEl.textContent,literal);p.dispose();
});

test('closing native menus/choosers restores temporary instance wrappers without retaining projections',async()=>{
  const h=aliasHost(),p=install(h);h.doc.switcher.click();const modal=h.app.commands.commands['app:switch-vault'].callback();await tick();
  const menu=h.menus[0],nativeHide=Object.getPrototypeOf(menu).hide,nativeClose=h.sdk.FuzzySuggestModal.prototype.close;
  assert.notEqual(menu.hide,nativeHide);assert.notEqual(modal.close,nativeClose);assert.equal(menu.hide(),menu);assert.equal(menu.hide,nativeHide);assert.deepEqual(menu.items.map(item=>item.titleEl?.textContent),['Shared','Shared',undefined,'Manage vaults']);
  modal.close();assert.equal(modal.close,nativeClose);assert.equal(modal.loadVaults,h.NativeChooser.prototype.loadVaults);p.dispose();
});

test('locked native item names refuse the whole chooser projection without partial aliases or unhandled errors',async()=>{
  const h=aliasHost(),load=h.NativeChooser.prototype.loadVaults;h.NativeChooser.prototype.loadVaults=function(){load.call(this);Object.freeze(this.items[1]);};const p=install(h),modal=h.app.commands.commands['app:switch-vault'].callback();await tick();assert.deepEqual(modal.search,['Shared','Shared']);h.setCurrent('Next');p.refresh();await tick();assert.deepEqual(modal.items.map(item=>item.name),['Shared','Shared']);p.dispose();
});

test('native callback with inherited open restores absence of own prototype property',async()=>{
  const h=aliasHost(),prototype=h.sdk.FuzzySuggestModal.prototype,own=Object.getOwnPropertyDescriptor(prototype,'open');delete prototype.open;Object.setPrototypeOf(prototype,{open:own.value});const p=install(h);
  const modal=h.app.commands.commands['app:switch-vault'].callback();assert.equal(Object.hasOwn(prototype,'open'),false);await tick();assert.deepEqual(modal.search,['Current alias','Other alias']);p.dispose();assert.equal(Object.hasOwn(prototype,'open'),false);
});

test('throwing registry recheck after capture falls back to one native click with original callbacks',async()=>{
  const h=aliasHost(),gate=deferred();h.provider.read=()=>gate.promise;let lists=0;h.provider.list=()=>{if(++lists>1)throw Error('registry changed');return h.list;};const p=install(h);
  h.doc.switcher.click();await tick();gate.resolve({schemaVersion:1,rules:'',displayName:'Stale alias'});await tick();assert.equal(h.menus.length,1);assert.deepEqual(h.menus[0].items.map(item=>item.titleEl?.textContent),['Shared','Shared',undefined,'Manage vaults']);h.menus[0].items[1].callback();assert.deepEqual(h.selected,['/two/Shared']);assert.equal(lists,2);p.dispose();
});

test('window-close releases document observers/listeners/tracking and later refresh touches only live windows',()=>{
  const h=aliasHost(),listeners=new Map(),observers=[];h.app.workspace.on=(event,callback)=>{listeners.set(event,callback);return event;};h.app.workspace.offref=event=>listeners.delete(event);
  const p=install(h),live=new Document();listeners.get('window-open')({}, {document:live});
  for(let index=0;index<80;index++){
    const doc=new Document();doc.titleNode={};doc.querySelector=()=>doc.titleNode;doc.defaultView.MutationObserver=class{constructor(callback){this.callback=callback;observers.push(this);}observe(){this.connected=true;}disconnect(){this.connected=false;}};
    listeners.get('window-open')({}, {document:doc});assert.equal(doc.label.textContent,'Current alias');assert.equal(observers.at(-1).connected,true);
    if(index===79){doc.label.textContent='Foreign label';doc.title='Foreign title';}
    assert.equal(typeof listeners.get('window-close'),'function');listeners.get('window-close')({}, {document:doc});assert.equal(doc.handlers.length,0);assert.equal(observers.at(-1).connected,false);
    assert.equal(doc.label.textContent,index===79?'Foreign label':'Shared');assert.equal(doc.title,index===79?'Foreign title':'Note - Shared - Obsidian 1.14.4');
    doc.querySelectorAll=()=>{throw Error('closed document retained');};
  }
  h.setCurrent('Live update');assert.doesNotThrow(()=>p.refresh());assert.equal(live.label.textContent,'Live update');assert.equal(h.doc.label.textContent,'Live update');p.dispose();assert.equal(live.handlers.length,0);assert.equal(observers.filter(observer=>observer.connected).length,0);assert.equal(listeners.size,0);
});

test('a closed document cancels its pending drawer replay while the main window stays live',async()=>{
  const h=aliasHost(),gate=deferred(),listeners=new Map();h.provider.read=()=>gate.promise;h.app.workspace.on=(event,callback)=>{listeners.set(event,callback);return event;};h.app.workspace.offref=event=>listeners.delete(event);const p=install(h),popout=new Document();let nativeClicks=0;
  popout.switcher.handlers.push(()=>nativeClicks++);listeners.get('window-open')({}, {document:popout});popout.switcher.click();await tick();listeners.get('window-close')({}, {document:popout});gate.resolve({schemaVersion:1,rules:'',displayName:'Late'});await tick();assert.equal(nativeClicks,0);h.setCurrent('Live');p.refresh();assert.equal(h.doc.label.textContent,'Live');assert.equal(popout.label.textContent,'Shared');p.dispose();
});

for(const cancel of ['dispose','window-close'])test(`${cancel} cancels queued reads after the first four native reads drain`,async()=>{
  const h=aliasHost(),gate=deferred(),listeners=new Map();h.list.splice(0,h.list.length,...Array.from({length:40},(_,index)=>({id:String(index+1),path:'/v'+index,name:'Shared',isCurrentVault:index===0})));let starts=0;h.provider.read=async()=>{starts++;await gate.promise;return{schemaVersion:1,rules:'',displayName:'Alias'};};
  h.app.workspace.on=(event,callback)=>{listeners.set(event,callback);return event;};h.app.workspace.offref=event=>listeners.delete(event);const p=install(h);h.doc.switcher.click();await tick();assert.equal(starts,4);
  if(cancel==='dispose')p.dispose();else listeners.get('window-close')({}, {document:h.doc});gate.resolve();await tick();assert.equal(starts,4);assert.equal(h.menus.length,0);p.dispose();
});

test('closing a chooser stops scheduling files after its first four provider reads',async()=>{
  const h=aliasHost(),gate=deferred();h.list.splice(0,h.list.length,...Array.from({length:40},(_,index)=>({path:'/v'+index,name:'Shared',isCurrentVault:index===0})));let starts=0;h.provider.read=async()=>{starts++;await gate.promise;return{schemaVersion:1,rules:'',displayName:'Alias'};};const p=install(h),modal=h.app.commands.commands['app:switch-vault'].callback();await tick();assert.equal(starts,4);modal.close();gate.resolve();await tick();assert.equal(starts,4);assert.deepEqual(modal.items.map(item=>item.name),Array(40).fill('Shared'));p.dispose();
});

test('a newer drawer request stops the older workers from scheduling more files',async()=>{
  const h=aliasHost(),older=deferred(),newer=deferred();h.list.splice(0,h.list.length,...Array.from({length:40},(_,index)=>({path:'/v'+index,name:'Shared',isCurrentVault:index===0})));let starts=0;h.provider.read=async()=>{const attempt=++starts;await(attempt<=4?older.promise:newer.promise);return{schemaVersion:1,rules:'',displayName:attempt<=4?'Old':'New'};};const p=install(h);
  h.doc.switcher.click();await tick();assert.equal(starts,4);h.doc.switcher.click();await tick();assert.equal(starts,8);older.resolve();await tick();assert.equal(starts,8);assert.equal(h.menus.length,0);newer.resolve();await tick();assert.equal(starts,43);assert.equal(h.menus.length,1);assert.equal(h.menus[0].items[39].titleEl.textContent,'New');p.dispose();
});
