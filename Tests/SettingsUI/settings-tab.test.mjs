import assert from 'node:assert/strict';
import test from 'node:test';
import {loadRuntime} from '../Fixtures/load-runtime.mjs';
import {fakeHost} from '../Fixtures/host-adapter.mjs';
import {uiSdk,element,resetUi} from '../Fixtures/ui-host.mjs';
const {default:SievePlugin}=await loadRuntime('main',uiSdk);

async function setup({late=false,rule='Technical',broken=false,fallback=false,unsupported=false}={}){
  resetUi();const host=fakeHost();host.app.vault.getName=()=> 'Vault folder';if(late){await host.app.vault.load();host.layout();}
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
  resetUi();const host=fakeHost();host.app.vault.getName=()=> 'Vault folder';const path='.custom/plugins/sieve/data.json';const saved={schemaVersion:1,rules:'Technical',displayName:'Stored name'};const data=new Map([[path,JSON.stringify(saved)]]);const writes=[];
  let release,readStarted;const blocked=new Promise(resolve=>{release=resolve;});const entered=new Promise(resolve=>{readStarted=resolve;});
  Object.assign(host.adapter,{async exists(p){return data.has(p);},async read(p){readStarted();await blocked;return data.get(p);},async write(p,value){writes.push(p);data.set(p,value);}});
  const plugin=new SievePlugin(host.app);const loading=plugin.onload();await entered;const tab=plugin.settingTabs[0];tab.display();
  return{...host,data,writes,plugin,tab,saved,release,loading,async ready(){release();await loading;await host.app.vault.load();host.layout();}};
}
test('early displayed settings stay disabled then hydrate saved rules before an unchanged user Save',async()=>{
  const h=await delayedStartup();try{
    const rules=element(h.tab.containerEl,'textarea'),name=element(h.tab.containerEl,'input'),save=element(h.tab.containerEl,'button','Save');
    assert.equal(h.plugin.getStatus().status,'loading');assert.equal(rules.disabled,true);assert.equal(name.disabled,true);assert.equal(save.disabled,true);rules.change('Wrong early edit');name.change('Wrong early name');save.click();assert.equal(h.writes.length,0);
    await h.ready();assert.equal(rules.value,'Technical');assert.equal(name.value,'Stored name');assert.equal(save.disabled,true);assert.equal(rules.disabled,false);assert.equal(name.disabled,false);
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
    h.tab.display();assert.equal(element(h.tab.containerEl,'textarea').value,'Local draft');await element(h.tab.containerEl,'button','Save').click();assert.equal(h.plugin.savedSettings.rules,'Local draft');assert.equal(h.plugin.savedSettings.displayName,'Local name');assert.equal(h.plugin.activeSettings.rules,'Technical');assert.ok(globalThis.__sieveModals.at(-1).opened);
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
    h.data.set(path,'{"invalid"');await h.plugin.onExternalSettingsChange();h.data.set(path,JSON.stringify({schemaVersion:1,rules:'External correction',displayName:'External name'}));await h.plugin.onExternalSettingsChange();h.tab.display();
    assert.equal(element(h.tab.containerEl,'textarea').value,'User fallback draft');assert.equal(element(h.tab.containerEl,'input').value,'User fallback name');assert.match(h.tab.containerEl.textContent,/unsaved/i);
    await element(h.tab.containerEl,'button','Save').click();assert.equal(h.plugin.savedSettings.rules,'User fallback draft');assert.equal(h.plugin.savedSettings.displayName,'User fallback name');
  }finally{h.tab.hide();h.plugin.onunload();}
});
test('successful explicit Save becomes the displayed clean baseline for later external corrections',async()=>{
  const h=await setup();try{
    element(h.tab.containerEl,'textarea').change('Saved local change');await element(h.tab.containerEl,'button','Save').click();element(globalThis.__sieveModals.at(-1).contentEl,'button','Postpone').click();
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
    assert.match(h.tab.containerEl.textContent,/line 1.*included file/i);assert.doesNotMatch(h.tab.containerEl.textContent,/private read detail|Could not read file \.stignore/);assert.equal(globalThis.__sieveModals.length,0);
  }finally{h.tab.hide();h.plugin.onunload();}
});
test('save blocks overlapping edits and offers explicit reload; Later keeps active rules',async()=>{
  const h=await setup();try{
    const rules=element(h.tab.containerEl,'textarea');rules.change('Other');const save=element(h.tab.containerEl,'button','Save');
    const oldWrite=h.adapter.write;let release;const delay=new Promise(resolve=>{release=resolve;});h.adapter.write=async(...args)=>{await delay;return oldWrite(...args);};
    let reloads=0;globalThis.window={location:{reload(){reloads++;}}};
    const pending=save.click();assert.equal(save.disabled,true);assert.equal(rules.disabled,true);rules.change('Lost');assert.equal(h.plugin.draftSettings.rules,'Other');assert.equal(save.click(),undefined);release();await pending;
    assert.equal(h.plugin.savedSettings.rules,'Other');assert.equal(h.plugin.activeSettings.rules,'Technical');assert.equal(reloads,0);assert.match(h.tab.containerEl.textContent,/reopen/i);
    const modal=globalThis.__sieveModals.at(-1);assert.ok(modal.opened);element(modal.contentEl,'button','Postpone').click();assert.equal(reloads,0);
    rules.change('Another');await save.click();element(globalThis.__sieveModals.at(-1).contentEl,'button','Reload').click();assert.equal(reloads,1);assert.equal(save.disabled,true);assert.equal(rules.disabled,false);
  }finally{delete globalThis.window;h.tab.hide();h.plugin.onunload();}
});
test('late enable shows pending reopen while unchanged Save stays disabled',async()=>{
  const h=await setup({late:true});try{
    assert.equal(h.plugin.getStatus().pendingReload,true);assert.equal((await h.plugin.saveSettings(h.plugin.draftSettings)).pending,false);
    assert.equal(element(h.tab.containerEl,'button','Save').disabled,true);assert.match(h.tab.containerEl.textContent,/reopen/i);assert.equal(globalThis.__sieveModals.length,0);
  }finally{h.tab.hide();h.plugin.onunload();}
});
test('tab redraw follows host language, fields have accessible labels, and hide unsubscribes',async()=>{
  const h=await setup();try{
    globalThis.__sieveTestLanguage='ru';h.tab.display();assert.match(h.tab.containerEl.textContent,/Каждое правило в новой строке/);assert.doesNotMatch(h.tab.containerEl.textContent,/Syncthing|[ёЁ]/);
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
    assert.equal(h.writes.length,0);assert.equal(h.plugin.savedSettings.rules,'Technical');assert.match(h.tab.containerEl.textContent,/Line 2: Invalid pattern \(filters\/team.rules\)/);assert.equal(globalThis.__sieveModals.length,0);
  }finally{h.tab.hide();h.plugin.onunload();}
});
test('real included .stignore remains the diagnostic source instead of being labeled UI rules',async()=>{
  const h=await setup();try{
    h.physical.set('.stignore',{type:'file',content:new TextEncoder().encode('[')});
    const rules=element(h.tab.containerEl,'textarea'),save=element(h.tab.containerEl,'button','Save');rules.change('[');await save.click();
    const errors=h.tab.containerEl.descendants().find(el=>el.attributes.id==='sieve-settings-errors');assert.match(errors.textContent,/^Line 1: Invalid pattern$/);
    rules.change('#include .stignore');await save.click();assert.match(errors.textContent,/^Line 1: Invalid pattern \(\.stignore\)$/);assert.equal(h.writes.length,0);
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

test('saving the fallback rules through the real service offers reload and Later preserves recovery until reopen',async()=>{
  const h=await setup({broken:true,fallback:true});let reopened;
  try{
    const rules=element(h.tab.containerEl,'textarea'),save=element(h.tab.containerEl,'button','Save');const recovered={schemaVersion:1,rules:'Technical',displayName:'Recovered'};
    rules.change('[');await save.click();assert.equal(h.writes.length,0);assert.equal(globalThis.__sieveModals.length,0);assert.equal(h.data.get('.custom/plugins/sieve/data.json'),'{');assert.equal(h.plugin.getStatus().fallback,true);
    rules.change('Technical');await save.click();assert.deepEqual(h.plugin.savedSettings,recovered);assert.deepEqual(h.plugin.activeSettings,recovered);assert.equal(h.plugin.getStatus().fallback,true);assert.equal(h.plugin.getStatus().pendingReload,true);
    assert.match(h.tab.containerEl.textContent,/Previous working rules are active/);assert.match(h.tab.containerEl.textContent,/reopen/i);assert.doesNotMatch(h.tab.containerEl.textContent,/invalid JSON/);
    let reloads=0;globalThis.window={location:{reload(){reloads++;}}};const offer=globalThis.__sieveModals.at(-1);assert.ok(offer?.opened,'successful recovery Save must offer reload');element(offer.contentEl,'button','Postpone').click();assert.equal(reloads,0);assert.equal(h.plugin.getStatus().pendingReload,true);assert.equal(h.plugin.getStatus().fallback,true);
    const writeCount=h.writes.length;assert.equal(save.disabled,true);await save.click();assert.equal(h.writes.length,writeCount);assert.equal(h.plugin.getStatus().pendingReload,true);
    assert.deepEqual(h.writes,['.custom/plugins/sieve/data.previous.json','.custom/plugins/sieve/data.json']);assert.equal([...h.data.keys()].filter(path=>path.includes('previous')).length,1);
    h.tab.hide();h.plugin.onunload();const fresh=fakeHost();Object.assign(fresh.adapter,{exists:h.adapter.exists,read:h.adapter.read,write:h.adapter.write});reopened=new SievePlugin(fresh.app);await reopened.onload();await fresh.app.vault.load();fresh.layout();
    assert.equal(reopened.getStatus().status,'applied');assert.equal(reopened.getStatus().fallback,false);assert.equal(reopened.getStatus().pendingReload,false);assert.deepEqual(reopened.activeSettings,recovered);assert.equal(h.writes.length,writeCount);
  }finally{delete globalThis.window;h.tab.hide();h.plugin.onunload();reopened?.onunload();}
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

test('native settings rows show examples, vault-folder placeholder and status beside Save in both languages',async()=>{
  for(const language of ['en','ru']){
    const h=await setup();try{
      globalThis.__sieveTestLanguage=language;h.tab.display();
      const examples=h.tab.containerEl.descendants().filter(el=>el.classes.has('sieve-syntax-example'));
      assert.equal(examples.length,5);assert.deepEqual(examples.map(row=>element(row,'code').textContent),['!important','*.tmp','/build','**/cache',language==='ru'?'// комментарий':'// comment']);
      for(const row of examples)assert.ok(element(row,'code').classes.has('sieve-syntax-pattern'));
      for(const row of examples.slice(0,4))assert.ok(element(row,'span').textContent);
      assert.equal(element(examples[4],'span'),undefined);
      const group=h.tab.containerEl.descendants().find(el=>el.classes.has('setting-items'));
      assert.ok(group,'rules and syntax use a native setting group');assert.equal(group.children.length,2);
      assert.equal(element(h.tab.containerEl,'textarea').parentElement.parentElement,group.children[0]);
      assert.equal(element(h.tab.containerEl,'button',language==='ru'?'Справка':'Help').parentElement.parentElement,group.children[1]);
      assert.equal(h.tab.icon,'layers');
      const heading=h.tab.containerEl.descendants().find(el=>el.attributes.role==='heading');assert.equal(heading.attributes['aria-level'],'2');assert.equal(heading.textContent.trim(),'Sieve');
      assert.ok(heading.descendants().some(el=>el.attributes['data-icon']==='layers'&&el.attributes['aria-hidden']==='true'));
      assert.doesNotMatch(h.tab.containerEl.textContent,/Excludes files|Исключает файлы/);
      assert.equal(element(h.tab.containerEl,'input').placeholder,'Vault folder');
      const save=element(h.tab.containerEl,'button',language==='ru'?'Сохранить':'Save'),setting=save.parentElement.parentElement;
      assert.ok(setting.children.some(el=>el.textContent===(language==='ru'?'Статус':'Status')));
      assert.ok(setting.children.some(el=>el.classes.has('sieve-status')));assert.equal(save.disabled,true);
      const rules=element(h.tab.containerEl,'textarea');rules.change('[');await save.click();
      const errors=h.tab.containerEl.descendants().find(el=>el.attributes.id==='sieve-settings-errors');
      assert.equal(errors.parentElement,rules.parentElement.parentElement,'rules diagnostics stay inside the rules setting');
      assert.ok(errors.classes.has('setting-item-description'),'rule errors inherit native description typography');
      assert.ok(errors.parentElement.children.indexOf(errors)>errors.parentElement.children.indexOf(rules.parentElement),'diagnostics follow the rules control');
      assert.equal(rules.attributes['aria-invalid'],'true');assert.ok(errors.textContent);assert.ok(errors.children.every(el=>el.classes.has('sieve-status-error')));
    }finally{h.tab.hide();h.plugin.onunload();}
  }
});

test('rules placeholder disappears on focus and restores on blur without inserting sample rules',async()=>{
  const h=await setup({rule:''});try{
    const rules=element(h.tab.containerEl,'textarea');assert.equal(rules.value,'');assert.equal(rules.placeholder,'*.tmp\n/build\n**/cache');
    await rules.focus();assert.equal(rules.placeholder,'');await rules.blur();assert.equal(rules.placeholder,'*.tmp\n/build\n**/cache');assert.equal(rules.value,'');assert.equal(h.writes.length,0);
  }finally{h.tab.hide();h.plugin.onunload();}
});

test('Save follows dirty values, blur validates without writing, and edits clear known invalid results',async()=>{
  const h=await setup();try{
    const rules=element(h.tab.containerEl,'textarea'),save=element(h.tab.containerEl,'button','Save');
    assert.equal(save.disabled,true);rules.change('[');assert.equal(save.disabled,false);assert.equal(rules.attributes['aria-invalid'],'false');
    await new Promise(resolve=>setTimeout(resolve,10));assert.equal(rules.attributes['aria-invalid'],'false','typing must not trigger validation');
    await rules.blur();assert.equal(rules.attributes['aria-invalid'],'true');assert.equal(save.disabled,true);assert.equal(h.writes.length,0);assert.equal(h.plugin.savedSettings.rules,'Technical');assert.equal(h.plugin.activeSettings.rules,'Technical');
    rules.change('Other');assert.equal(rules.attributes['aria-invalid'],'false');assert.equal(save.disabled,false);assert.doesNotMatch(h.tab.containerEl.textContent,/Line 1: Invalid pattern/);
    rules.change('Technical');assert.equal(save.disabled,true);element(h.tab.containerEl,'input').change('New name');assert.equal(save.disabled,false);await save.click();assert.equal(save.disabled,true);assert.equal(h.plugin.savedSettings.displayName,'New name');
  }finally{h.tab.hide();h.plugin.onunload();}
});

test('blur toward Save lets the first native click perform authoritative validation',async()=>{
  const h=await setup();try{
    const rules=element(h.tab.containerEl,'textarea'),save=element(h.tab.containerEl,'button','Save');let checks=0;const validate=h.plugin.validateSettings.bind(h.plugin);h.plugin.validateSettings=(...args)=>{checks++;return validate(...args);};
    rules.change('[');await rules.blur(save);assert.equal(checks,0);assert.equal(save.disabled,false);await save.click();assert.equal(save.disabled,true);assert.equal(rules.attributes['aria-invalid'],'true');assert.equal(h.writes.length,0);
  }finally{h.tab.hide();h.plugin.onunload();}
});

test('stale blur results cannot invalidate a newer edit or a reopened settings session',async()=>{
  const h=await setup();try{
    const validate=h.plugin.validateSettings.bind(h.plugin);let release;h.plugin.validateSettings=()=>new Promise(resolve=>{release=resolve;});
    let rules=element(h.tab.containerEl,'textarea');rules.change('[');const validating=rules.blur();rules.change('Latest');release({ok:false,error:{code:'rules'}});await validating;
    assert.equal(rules.attributes['aria-invalid'],'false');assert.equal(element(h.tab.containerEl,'button','Save').disabled,false);assert.doesNotMatch(h.tab.containerEl.textContent,/Could not validate/);
    const closedValidation=rules.blur();h.tab.hide();h.tab.display();release({ok:false,error:{code:'rules'}});await closedValidation;
    rules=element(h.tab.containerEl,'textarea');assert.equal(rules.value,'Technical');assert.equal(rules.attributes['aria-invalid'],'false');assert.equal(element(h.tab.containerEl,'button','Save').disabled,true);assert.equal(h.writes.length,0);h.plugin.validateSettings=validate;
  }finally{h.tab.hide();h.plugin.onunload();}
});

test('closing settings discards local fields and reopens latest saved or fallback/default settings',async()=>{
  for(const options of [{},{broken:true,fallback:true},{broken:true}]){
    const h=await setup(options);try{
      element(h.tab.containerEl,'textarea').change('Discard rules');element(h.tab.containerEl,'input').change('Discard name');
      if(!options.broken){h.data.set('.custom/plugins/sieve/data.json',JSON.stringify({schemaVersion:1,rules:'External saved',displayName:'External name'}));await h.plugin.onExternalSettingsChange();}
      const count=h.writes.length;h.tab.hide();assert.equal(h.writes.length,count);h.tab.display();
      assert.equal(element(h.tab.containerEl,'textarea').value,options.fallback?'Technical':options.broken?'':'External saved');
      assert.equal(element(h.tab.containerEl,'input').value,options.fallback?'Recovered':options.broken?'':'External name');assert.equal(h.writes.length,count);
      assert.equal(element(h.tab.containerEl,'button','Save').disabled,!options.broken,'unchanged recovery values still need persistence');
    }finally{h.tab.hide();h.plugin.onunload();}
  }
});

test('unchanged fallback/default can be saved to recover invalid persisted data',async()=>{
  for(const fallback of [false,true]){
    const h=await setup({broken:true,fallback});try{
      const save=element(h.tab.containerEl,'button','Save');assert.equal(save.disabled,false);await save.click();assert.equal(save.disabled,true);assert.equal(h.plugin.needsSettingsRecovery,false);assert.equal(JSON.parse(h.data.get('.custom/plugins/sieve/data.json')).rules,fallback?'Technical':'');
    }finally{h.tab.hide();h.plugin.onunload();}
  }
});

test('failed saves remain retryable without another edit',async()=>{
  const h=await setup();try{
    const save=element(h.tab.containerEl,'button','Save');element(h.tab.containerEl,'textarea').change('Other');const write=h.adapter.write;h.adapter.write=async()=>{throw Error('private');};await save.click();assert.equal(save.disabled,false);
    h.adapter.write=write;await save.click();assert.equal(save.disabled,true);assert.equal(h.plugin.savedSettings.rules,'Other');
  }finally{h.tab.hide();h.plugin.onunload();}
});

test('a corrected included file clears failed-Save diagnostics on blur without capturing backup',async()=>{
  const h=await setup();try{
    const rules=element(h.tab.containerEl,'textarea'),save=element(h.tab.containerEl,'button','Save');h.physical.set('rules',{type:'file',content:new TextEncoder().encode('[')});
    rules.change('#include rules');await save.click();assert.equal(save.disabled,true);assert.equal(rules.attributes['aria-invalid'],'true');assert.equal(h.writes.length,0);
    h.physical.set('rules',{type:'file',content:new TextEncoder().encode('Technical')});await rules.blur();assert.equal(save.disabled,false);assert.equal(rules.attributes['aria-invalid'],'false');assert.equal(h.writes.length,0);await save.click();assert.equal(h.plugin.savedSettings.rules,'#include rules');
  }finally{h.tab.hide();h.plugin.onunload();}
});

test('timeout on blur or Save leaves the same draft retryable',async()=>{
  const h=await setup();try{
    const rules=element(h.tab.containerEl,'textarea'),save=element(h.tab.containerEl,'button','Save');rules.change('Other');
    const validate=h.plugin.validateSettings.bind(h.plugin);h.plugin.validateSettings=async()=>({ok:false,error:{code:'timeout'}});await rules.blur();assert.equal(save.disabled,false);assert.match(h.tab.containerEl.textContent,/timed out/);assert.equal(h.writes.length,0);h.plugin.validateSettings=validate;
    const persist=h.plugin.saveSettings.bind(h.plugin);h.plugin.saveSettings=async()=>({ok:false,error:{code:'timeout'}});await save.click();assert.equal(save.disabled,false);h.plugin.saveSettings=persist;await save.click();assert.equal(save.disabled,true);assert.equal(h.plugin.savedSettings.rules,'Other');
  }finally{h.tab.hide();h.plugin.onunload();}
});

test('hide during failed save cannot restore a discarded draft when reopened before completion',async()=>{
  const h=await setup();try{
    const rules=element(h.tab.containerEl,'textarea');rules.change('Discard while saving');let release;h.adapter.write=async()=>{await new Promise(resolve=>{release=resolve;});throw Error('private');};
    const pending=element(h.tab.containerEl,'button','Save').click();await new Promise(resolve=>setTimeout(resolve,0));h.tab.hide();h.tab.display();assert.equal(element(h.tab.containerEl,'textarea').value,'Technical');release();await pending;
    assert.equal(element(h.tab.containerEl,'textarea').value,'Technical');assert.equal(h.plugin.draftSettings.rules,'Technical');assert.equal(element(h.tab.containerEl,'button','Save').disabled,true);assert.equal(globalThis.__sieveModals.length,0);
  }finally{h.tab.hide();h.plugin.onunload();}
});

test('hide during successful save follows the completed saved values when reopened before completion',async()=>{
  const h=await setup();try{
    element(h.tab.containerEl,'textarea').change('Saved while closed');const write=h.adapter.write;let release;const gate=new Promise(resolve=>{release=resolve;});h.adapter.write=async(...args)=>{await gate;return write(...args);};
    const pending=element(h.tab.containerEl,'button','Save').click();await new Promise(resolve=>setTimeout(resolve,0));h.tab.hide();h.tab.display();assert.equal(element(h.tab.containerEl,'textarea').value,'Technical');release();await pending;
    assert.equal(h.plugin.savedSettings.rules,'Saved while closed');assert.equal(element(h.tab.containerEl,'textarea').value,'Saved while closed');assert.equal(element(h.tab.containerEl,'button','Save').disabled,true);assert.equal(globalThis.__sieveModals.length,0);assert.ok(!globalThis.__sieveTestNotices.includes('Settings saved'));
  }finally{h.tab.hide();h.plugin.onunload();}
});

test('closing after failed draft validation restores saved-config diagnostics without stale draft errors',async()=>{
  for(const options of [{},{broken:true,fallback:true},{broken:true}]){
    const h=await setup(options);try{
      element(h.tab.containerEl,'textarea').change('[');await element(h.tab.containerEl,'button','Save').click();assert.match(h.tab.containerEl.textContent,/Line 1: Invalid pattern/);
      h.tab.hide();h.tab.display();assert.doesNotMatch(h.tab.containerEl.textContent,/Invalid pattern/i);if(!options.broken)assert.doesNotMatch(h.tab.containerEl.textContent,/unsaved/i);assert.equal(element(h.tab.containerEl,'textarea').attributes['aria-invalid'],'false');
      if(options.broken)assert.match(h.tab.containerEl.textContent,/invalid JSON/);else assert.doesNotMatch(h.tab.containerEl.textContent,/invalid JSON/);
      assert.equal(h.writes.length,0);
    }finally{h.tab.hide();h.plugin.onunload();}
  }
});

test('late failed Save after close preserves the actual fallback-config error on the reopened form',async()=>{
  const h=await setup({broken:true,fallback:true});try{
    element(h.tab.containerEl,'textarea').change('#include missing');const pending=element(h.tab.containerEl,'button','Save').click();h.tab.hide();h.tab.display();await pending;
    assert.equal(element(h.tab.containerEl,'textarea').value,'Technical');assert.match(h.tab.containerEl.textContent,/invalid JSON/);assert.doesNotMatch(h.tab.containerEl.textContent,/Could not read the included file/);assert.equal(h.writes.length,0);
  }finally{h.tab.hide();h.plugin.onunload();}
});
