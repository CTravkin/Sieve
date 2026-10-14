import assert from 'node:assert/strict';
import test from 'node:test';
import {loadRuntime} from '../Fixtures/load-runtime.mjs';
import {fakeHost} from '../Fixtures/host-adapter.mjs';
import {uiSdk,element,resetUi} from '../Fixtures/ui-host.mjs';
const {default:SievePlugin}=await loadRuntime('main',uiSdk);

async function setup({late=false,rule='Technical',broken=false,fallback=false,unsupported=false}={}){
  resetUi();const host=fakeHost();if(late){await host.app.vault.load();host.layout();}
  const data=new Map([['.custom/plugins/sieve/data.json',JSON.stringify({schemaVersion:1,rules:rule,displayName:'Demo'})]]);const writes=[];
  if(broken)data.set('.custom/plugins/sieve/data.json','{');
  if(fallback)data.set('.custom/plugins/sieve/data.previous.json',JSON.stringify({schemaVersion:1,settings:{schemaVersion:1,rules:'Technical',displayName:'Recovered'},includes:[]}));
  if(unsupported)Object.defineProperty(host.adapter,'trigger',{value:host.adapter.trigger,configurable:false});
  Object.assign(host.adapter,{async exists(path){return data.has(path);},async read(path){if(!data.has(path))throw Error('private read detail');return data.get(path);},async write(path,text){writes.push(path);data.set(path,text);}});
  const nativeRead=host.adapter.fsPromises.readFile;host.adapter.fsPromises.readFile=async path=>{if(!host.physical.has(String(path).replace(/^\/vault\/?/,'')))throw Error('private read detail');return nativeRead(path);};
  const plugin=new SievePlugin(host.app);await plugin.onload();if(!late){await host.app.vault.load();host.layout();}
  assert.equal(plugin.settingTabs.length,1,'native settings tab is registered');const tab=plugin.settingTabs[0];tab.display();
  return{...host,data,writes,plugin,tab};
}
async function delayedStartup(){
  resetUi();const host=fakeHost();const path='.custom/plugins/sieve/data.json';const saved={schemaVersion:1,rules:'Technical',displayName:'Stored name'};const data=new Map([[path,JSON.stringify(saved)]]);const writes=[];
  let release,readStarted;const blocked=new Promise(resolve=>{release=resolve;});const entered=new Promise(resolve=>{readStarted=resolve;});
  Object.assign(host.adapter,{async exists(p){return data.has(p);},async read(p){readStarted();await blocked;return data.get(p);},async write(p,value){writes.push(p);data.set(p,value);}});
  const plugin=new SievePlugin(host.app);const loading=plugin.onload();await entered;const tab=plugin.settingTabs[0];tab.display();
  return{...host,data,writes,plugin,tab,saved,release,loading,async ready(){release();await loading;await host.app.vault.load();host.layout();}};
}
test('early displayed settings stay disabled then hydrate saved rules before an unchanged user Save',async()=>{
  const h=await delayedStartup();try{
    const rules=element(h.tab.containerEl,'textarea'),name=element(h.tab.containerEl,'input'),save=element(h.tab.containerEl,'button','Save');
    assert.equal(h.plugin.getStatus().status,'loading');assert.equal(rules.disabled,true);assert.equal(name.disabled,true);assert.equal(save.disabled,true);rules.change('Wrong early edit');name.change('Wrong early name');save.click();assert.equal(h.writes.length,0);
    await h.ready();assert.equal(rules.value,'Technical');assert.equal(name.value,'Stored name');assert.equal(save.disabled,false);assert.equal(rules.disabled,false);assert.equal(name.disabled,false);
    await save.click();assert.deepEqual(h.plugin.savedSettings,h.saved);assert.equal(h.writes.length,0);
    rules.change('User draft');name.change('User name');h.layout();assert.equal(rules.value,'User draft');assert.equal(name.value,'User name');assert.equal(h.plugin.draftSettings.rules,'User draft');
  }finally{h.release();await h.loading;h.tab.hide();h.plugin.onunload();}
});
test('settings API rejects a save while startup is still reading persisted nonempty rules',async()=>{
  const h=await delayedStartup();try{
    const result=await h.plugin.saveSettings({schemaVersion:1,rules:'',displayName:''});assert.equal(result.ok,false);assert.equal(result.error.code,'cancelled');assert.equal(h.writes.length,0);
    h.plugin.setDraftSettings({schemaVersion:1,rules:'Premature',displayName:'Premature'});assert.equal(h.plugin.draftSettings.rules,'');await h.ready();assert.deepEqual(h.plugin.savedSettings,h.saved);
  }finally{h.release();await h.loading;h.tab.hide();h.plugin.onunload();}
});
test('external changes hydrate a clean form but preserve dirty entered draft across redraw and save',async()=>{
  const h=await setup();try{
    const path='.custom/plugins/sieve/data.json';h.data.set(path,JSON.stringify({schemaVersion:1,rules:'External clean',displayName:'External name'}));await h.plugin.onExternalSettingsChange();
    assert.equal(element(h.tab.containerEl,'textarea').value,'External clean');assert.equal(element(h.tab.containerEl,'input').value,'External name');assert.doesNotMatch(h.tab.containerEl.textContent,/unsaved/i);assert.equal(h.plugin.activeSettings.rules,'Technical');
    element(h.tab.containerEl,'textarea').change('Local draft');element(h.tab.containerEl,'input').change('Local name');h.data.set(path,JSON.stringify({schemaVersion:1,rules:'External dirty',displayName:'External next'}));await h.plugin.onExternalSettingsChange();
    assert.equal(element(h.tab.containerEl,'textarea').value,'Local draft');assert.equal(element(h.tab.containerEl,'input').value,'Local name');assert.match(h.tab.containerEl.textContent,/unsaved/i);
    h.tab.hide();h.tab.display();assert.equal(element(h.tab.containerEl,'textarea').value,'Local draft');await element(h.tab.containerEl,'button','Save').click();assert.equal(h.plugin.savedSettings.rules,'Local draft');assert.equal(h.plugin.savedSettings.displayName,'Local name');assert.equal(h.plugin.activeSettings.rules,'Technical');assert.ok(globalThis.__sieveModals.at(-1).opened);
  }finally{h.tab.hide();h.plugin.onunload();}
});
test('clean fallback form follows corrected external settings and never saves the previous snapshot over them',async()=>{
  const h=await setup({broken:true,fallback:true});try{
    assert.equal(h.plugin.savedSettings,undefined);assert.equal(element(h.tab.containerEl,'input').value,'Recovered');
    const corrected={schemaVersion:1,rules:'Corrected fallback',displayName:'Corrected name'},path='.custom/plugins/sieve/data.json';h.data.set(path,JSON.stringify(corrected));await h.plugin.onExternalSettingsChange();
    assert.equal(element(h.tab.containerEl,'textarea').value,corrected.rules);assert.equal(element(h.tab.containerEl,'input').value,corrected.displayName);assert.doesNotMatch(h.tab.containerEl.textContent,/unsaved/i);
    const writeCount=h.writes.length;await element(h.tab.containerEl,'button','Save').click();assert.equal(h.writes.length,writeCount);assert.deepEqual(JSON.parse(h.data.get(path)),corrected);assert.equal(h.plugin.activeSettings.rules,'Technical');
  }finally{h.tab.hide();h.plugin.onunload();}
});
test('clean form survives invalid external JSON then follows its corrected settings',async()=>{
  const h=await setup();try{
    const path='.custom/plugins/sieve/data.json';h.data.set(path,'{');await h.plugin.onExternalSettingsChange();assert.equal(h.plugin.savedSettings,undefined);assert.match(h.tab.containerEl.textContent,/invalid JSON/);
    const corrected={schemaVersion:1,rules:'Corrected after error',displayName:'New name'};h.data.set(path,JSON.stringify(corrected));await h.plugin.onExternalSettingsChange();
    assert.equal(element(h.tab.containerEl,'textarea').value,corrected.rules);assert.equal(element(h.tab.containerEl,'input').value,corrected.displayName);assert.doesNotMatch(h.tab.containerEl.textContent,/invalid JSON|unsaved/i);
    const writeCount=h.writes.length;await element(h.tab.containerEl,'button','Save').click();assert.equal(h.writes.length,writeCount);assert.deepEqual(JSON.parse(h.data.get(path)),corrected);
  }finally{h.tab.hide();h.plugin.onunload();}
});
test('dirty fallback draft survives invalid and corrected external settings across redraw',async()=>{
  const h=await setup({broken:true,fallback:true});try{
    const path='.custom/plugins/sieve/data.json';element(h.tab.containerEl,'textarea').change('User fallback draft');element(h.tab.containerEl,'input').change('User fallback name');
    h.data.set(path,'{"invalid"');await h.plugin.onExternalSettingsChange();h.data.set(path,JSON.stringify({schemaVersion:1,rules:'External correction',displayName:'External name'}));await h.plugin.onExternalSettingsChange();h.tab.hide();h.tab.display();
    assert.equal(element(h.tab.containerEl,'textarea').value,'User fallback draft');assert.equal(element(h.tab.containerEl,'input').value,'User fallback name');assert.match(h.tab.containerEl.textContent,/unsaved/i);
    await element(h.tab.containerEl,'button','Save').click();assert.equal(h.plugin.savedSettings.rules,'User fallback draft');assert.equal(h.plugin.savedSettings.displayName,'User fallback name');
  }finally{h.tab.hide();h.plugin.onunload();}
});
test('successful explicit Save becomes the displayed clean baseline for later external corrections',async()=>{
  const h=await setup();try{
    element(h.tab.containerEl,'textarea').change('Saved local change');await element(h.tab.containerEl,'button','Save').click();element(globalThis.__sieveModals.at(-1).contentEl,'button','Later').click();
    const path='.custom/plugins/sieve/data.json';h.data.set(path,JSON.stringify({schemaVersion:1,rules:'Later external change',displayName:'Later name'}));await h.plugin.onExternalSettingsChange();
    assert.equal(element(h.tab.containerEl,'textarea').value,'Later external change');assert.equal(element(h.tab.containerEl,'input').value,'Later name');assert.doesNotMatch(h.tab.containerEl.textContent,/unsaved/i);
  }finally{h.tab.hide();h.plugin.onunload();}
});
test('dispose during startup leaves an early form disabled and prevents late hydration',async()=>{
  const h=await delayedStartup();h.plugin.onunload();h.release();await h.loading;
  assert.equal(element(h.tab.containerEl,'textarea').disabled,true);assert.equal(element(h.tab.containerEl,'button','Save').disabled,true);assert.equal(element(h.tab.containerEl,'textarea').value,'');assert.equal(h.writes.length,0);assert.equal(globalThis.__sieveModals.length,0);assert.equal(h.plugin.getStatus().status,'disposed');
});
test('draft editing never writes or changes active rules; invalid include retains draft without reload',async()=>{
  const h=await setup();try{
    element(h.tab.containerEl,'textarea').change('#include missing.rules');
    assert.equal(h.plugin.draftSettings.rules,'#include missing.rules');assert.equal(h.plugin.savedSettings.rules,'Technical');assert.equal(h.plugin.activeSettings.rules,'Technical');assert.equal(h.writes.length,0);
    assert.match(h.tab.containerEl.textContent,/unsaved/i);
    await element(h.tab.containerEl,'button','Save').click();
    assert.equal(h.writes.length,0);assert.equal(h.plugin.draftSettings.rules,'#include missing.rules');assert.equal(element(h.tab.containerEl,'textarea').value,'#include missing.rules');
    assert.match(h.tab.containerEl.textContent,/Filter rules.*line 1.*included file/i);assert.doesNotMatch(h.tab.containerEl.textContent,/private read detail|Could not read file \.stignore/);assert.equal(globalThis.__sieveModals.length,0);
  }finally{h.tab.hide();h.plugin.onunload();}
});
test('save blocks overlapping edits and offers explicit reload; Later keeps active rules',async()=>{
  const h=await setup();try{
    const rules=element(h.tab.containerEl,'textarea');rules.change('Other');const save=element(h.tab.containerEl,'button','Save');
    const oldWrite=h.adapter.write;let release;const delay=new Promise(resolve=>{release=resolve;});h.adapter.write=async(...args)=>{await delay;return oldWrite(...args);};
    let reloads=0;globalThis.window={location:{reload(){reloads++;}}};
    const pending=save.click();assert.equal(save.disabled,true);assert.equal(rules.disabled,true);rules.change('Lost');assert.equal(h.plugin.draftSettings.rules,'Other');assert.equal(save.click(),undefined);release();await pending;
    assert.equal(h.plugin.savedSettings.rules,'Other');assert.equal(h.plugin.activeSettings.rules,'Technical');assert.equal(reloads,0);assert.match(h.tab.containerEl.textContent,/full.*reopen/i);
    const modal=globalThis.__sieveModals.at(-1);assert.ok(modal.opened);element(modal.contentEl,'button','Later').click();assert.equal(reloads,0);
    await save.click();element(globalThis.__sieveModals.at(-1).contentEl,'button','Reload vault').click();assert.equal(reloads,1);assert.equal(save.disabled,false);assert.equal(rules.disabled,false);
  }finally{delete globalThis.window;h.tab.hide();h.plugin.onunload();}
});
test('late enable offers reload even when an unchanged save result has no settings pending flag',async()=>{
  const h=await setup({late:true});try{
    assert.equal(h.plugin.getStatus().pendingReload,true);assert.equal((await h.plugin.saveSettings(h.plugin.draftSettings)).pending,false);
    await element(h.tab.containerEl,'button','Save').click();assert.equal(globalThis.__sieveModals.at(-1).opened,true);assert.match(h.tab.containerEl.textContent,/full.*reopen/i);
  }finally{h.tab.hide();h.plugin.onunload();}
});
test('tab redraw follows host language, fields have accessible labels, and hide unsubscribes',async()=>{
  const h=await setup();try{
    globalThis.__sieveTestLanguage='ru';h.tab.display();assert.match(h.tab.containerEl.textContent,/Исключает файлы и каталоги перед индексацией хранилища/);assert.doesNotMatch(h.tab.containerEl.textContent,/Syncthing|[ёЁ]/);
    assert.equal(element(h.tab.containerEl,'textarea').attributes['aria-label'],'Правила фильтрации');assert.equal(element(h.tab.containerEl,'input').attributes['aria-label'],'Отображаемое имя хранилища');
    for(const tag of ['textarea','input'])for(const id of element(h.tab.containerEl,tag).attributes['aria-describedby'].split(' '))assert.ok(h.tab.containerEl.descendants().some(el=>el.attributes.id===id),'accessible description target exists');
    h.tab.hide();const text=h.tab.containerEl.textContent;await h.plugin.saveSettings({schemaVersion:1,rules:'Changed after hide',displayName:''});assert.equal(h.tab.containerEl.textContent,text);
    globalThis.__sieveTestLanguage='fr';h.tab.display();assert.ok(element(h.tab.containerEl,'button','Save'));
  }finally{h.tab.hide();h.plugin.onunload();}
});
test('nested include parse errors name the source file and do not publish partial settings',async()=>{
  const h=await setup();try{
    h.physical.set('filters/team.rules',{type:'file',content:new TextEncoder().encode('// first line\n[')});
    element(h.tab.containerEl,'textarea').change('#include filters/team.rules');await element(h.tab.containerEl,'button','Save').click();
    assert.equal(h.writes.length,0);assert.equal(h.plugin.savedSettings.rules,'Technical');assert.match(h.tab.containerEl.textContent,/filters\/team.rules, line 2: Invalid pattern/);assert.equal(globalThis.__sieveModals.length,0);
  }finally{h.tab.hide();h.plugin.onunload();}
});
test('real included .stignore remains the diagnostic source instead of being labeled UI rules',async()=>{
  const h=await setup();try{
    h.physical.set('.stignore',{type:'file',content:new TextEncoder().encode('[')});
    const rules=element(h.tab.containerEl,'textarea'),save=element(h.tab.containerEl,'button','Save');rules.change('[');await save.click();
    const errors=h.tab.containerEl.descendants().find(el=>el.attributes.id==='sieve-settings-errors');assert.match(errors.textContent,/^Filter rules, line 1/);
    rules.change('#include .stignore');await save.click();assert.match(errors.textContent,/^\.stignore, line 1/);assert.equal(h.writes.length,0);
  }finally{h.tab.hide();h.plugin.onunload();}
});
test('fallback, unfiltered and unsupported states are visible without claiming saved rules applied',async()=>{
  for(const options of [{broken:true,fallback:true},{broken:true},{unsupported:true}]){
    const h=await setup(options);try{
      const text=h.tab.containerEl.textContent;
      if(options.fallback){assert.match(text,/Previous working rules are active/);assert.equal(element(h.tab.containerEl,'input').value,'Recovered');assert.match(text,/invalid JSON/);}
      else if(options.broken){assert.match(text,/without filtering/);assert.match(text,/invalid JSON/);assert.doesNotMatch(text,/Loaded rules are active/);}
      else {assert.match(text,/does not support Sieve filtering/);assert.doesNotMatch(text,/Loaded rules are active/);}
    }finally{h.tab.hide();h.plugin.onunload();}
  }
});
test('unload while save is in flight cannot open late reload or success notice',async()=>{
  const h=await setup();element(h.tab.containerEl,'textarea').change('Other');const oldWrite=h.adapter.write;let release;const delay=new Promise(resolve=>{release=resolve;});h.adapter.write=async(...args)=>{await delay;return oldWrite(...args);};
  const pending=element(h.tab.containerEl,'button','Save').click();await new Promise(resolve=>setTimeout(resolve,0));h.plugin.onunload();release();await pending;
  assert.equal(globalThis.__sieveModals.length,0);assert.ok(!globalThis.__sieveTestNotices.includes('Settings saved'));assert.equal(h.plugin.getStatus().status,'disposed');
});
test('failed write retains entered draft and never opens a reload offer',async()=>{
  const h=await setup();try{
    element(h.tab.containerEl,'textarea').change('Other');h.adapter.write=async()=>{throw Error('secret storage detail');};await element(h.tab.containerEl,'button','Save').click();
    assert.equal(h.plugin.savedSettings.rules,'Technical');assert.equal(h.plugin.draftSettings.rules,'Other');assert.equal(globalThis.__sieveModals.length,0);assert.match(h.tab.containerEl.textContent,/Could not save/);assert.doesNotMatch(h.tab.containerEl.textContent,/secret storage detail/);
  }finally{h.tab.hide();h.plugin.onunload();}
});
