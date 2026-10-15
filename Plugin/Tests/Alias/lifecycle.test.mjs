// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import {loadRuntime} from '../Fixtures/load-runtime.mjs';
import {fakeHost} from '../Fixtures/host-adapter.mjs';
import {uiSdk,resetUi} from '../Fixtures/ui-host.mjs';
const {default:SievePlugin}=await loadRuntime('main',uiSdk);

test('accepted alias follows fallback/save/external state without changing active rules or identity',async()=>{
  resetUi();const h=fakeHost();const originalGetName=()=> 'Shared';h.app.vault.getName=originalGetName;
  h.app.title='Shared - Obsidian 1.14.4';const originalTitle=function(note){return note?note+' - '+this.title:this.title;};h.app.getAppTitle=originalTitle;
  const current='.custom/plugins/sieve/data.json',previous='.custom/plugins/sieve/data.previous.json';
  const data=new Map([[current,JSON.stringify({schemaVersion:1,rules:'[',displayName:'Invalid candidate'})],[previous,JSON.stringify({schemaVersion:1,settings:{schemaVersion:1,rules:'Technical',displayName:'Recovered'},includes:[]})]]);
  let failWrite=false;Object.assign(h.adapter,{async exists(p){return data.has(p);},async read(p){return data.get(p);},async write(p,v){if(failWrite)throw Error('fixture denied');data.set(p,v);}});
  const plugin=new SievePlugin(h.app);try{
    await plugin.onload();assert.equal(h.app.getAppTitle('Note'),'Note - Shared - Obsidian 1.14.4','projection waits for layout');await h.app.vault.load();h.layout();
    assert.equal(h.app.getAppTitle('Note'),'Note - Recovered - Obsidian 1.14.4');assert.equal(plugin.activeSettings.rules,'Technical');
    plugin.setDraftSettings({schemaVersion:1,rules:'Other',displayName:'Draft'});assert.equal(h.app.getAppTitle(),'Recovered - Obsidian 1.14.4');
    failWrite=true;assert.equal((await plugin.saveSettings({schemaVersion:1,rules:'Other',displayName:'Rejected'})).ok,false);assert.equal(h.app.getAppTitle(),'Recovered - Obsidian 1.14.4');
    failWrite=false;assert.equal((await plugin.saveSettings({schemaVersion:1,rules:'Other',displayName:'Saved'})).ok,true);assert.equal(h.app.getAppTitle(),'Saved - Obsidian 1.14.4');assert.equal(plugin.activeSettings.rules,'Technical');
    data.set(current,JSON.stringify({schemaVersion:1,rules:'[',displayName:'Bad external'}));await plugin.onExternalSettingsChange();assert.equal(h.app.getAppTitle(),'Saved - Obsidian 1.14.4');
    data.set(current,JSON.stringify({schemaVersion:1,rules:'External',displayName:'External'}));await plugin.onExternalSettingsChange();assert.equal(h.app.getAppTitle(),'External - Obsidian 1.14.4');assert.equal(plugin.activeSettings.rules,'Technical');
    assert.equal(h.app.vault.getName,originalGetName);assert.equal(h.app.title,'Shared - Obsidian 1.14.4');
  }finally{plugin.onunload();}
  assert.equal(h.app.getAppTitle,originalTitle);
});
