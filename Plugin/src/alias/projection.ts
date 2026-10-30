// SPDX-License-Identifier: MPL-2.0
import * as Obsidian from 'obsidian';
import {patchable} from '../platform/capabilities.ts';
import {displayName} from './display-name.ts';
import {installChooserAliases,type ChooserSdk} from './chooser.ts';
import {installDrawerAliases,type DrawerSdk} from './drawer.ts';
import {wrap} from './native.ts';
import type {AliasApp,AliasCapabilities,AliasInstallation,AliasProvider} from './contracts.ts';

type AliasSdk=ChooserSdk&DrawerSdk;
interface Options {document?:Document;sdk?:AliasSdk;timeoutMs?:number}

export function installAliases(app:AliasApp,provider:AliasProvider,current:()=>string,options:Options={}):AliasInstallation {
  const sdk=options.sdk??Obsidian;
  let alive=true,epoch=0;const cleanup=new Set<()=>void>();let previousName=current();
  const docs=new Set<Document>();const documentCleanup=new Map<Document,()=>void>();const labelChanges=new Map<Element,{original:string;written:string}>();
  const titleChanges=new Map<Document,{original:string;written:string}>();
  const base=typeof app.vault.getName==='function'?app.vault.getName():'';
  const titleBase=typeof app.title==='string' && (app.title===base || app.title.startsWith(base+' - '))?app.title:undefined;
  const capabilities:{activeLabel:boolean;windowTitle:boolean;drawer:boolean;commands:string[]}={activeLabel:false,windowTitle:false,drawer:false,commands:[]};
  const replaceTitle=(value:string):string=>titleBase && value.endsWith(titleBase)?value.slice(0,-titleBase.length)+displayName(base,current())+titleBase.slice(base.length):value;
  const originalTitle=(value:string):string=>{
    if(!titleBase)return value;
    for(const name of [current(),previousName]){const projected:string=displayName(base,name)+titleBase.slice(base.length);if(projected!==titleBase && value.endsWith(projected))return value.slice(0,-projected.length)+titleBase;}
    return value;
  };
  function refresh():void {
    if(!alive)return;epoch++;
    for(const doc of docs){
      for(const label of doc.querySelectorAll('.workspace-drawer-vault-name')){
        const entry=labelChanges.get(label);if(entry && label.textContent!==entry.written && label.textContent!==entry.original)continue;
        const tracked=labelChanges.get(label)??{original:label.textContent??base,written:''};
        tracked.written=displayName(tracked.original,current());if(label.textContent!==tracked.written)label.textContent=tracked.written;labelChanges.set(label,tracked);capabilities.activeLabel=true;
      }
      if(capabilities.windowTitle){
        const tracked=titleChanges.get(doc);const source=tracked && doc.title===tracked.written?tracked.original:originalTitle(doc.title);
        const projected=replaceTitle(source);if(projected!==source || tracked){titleChanges.set(doc,{original:source,written:projected});if(doc.title!==projected)doc.title=projected;}
      }
    }
    previousName=current();
    choosers.refresh();
  }
  if(titleBase && typeof app.getAppTitle==='function' && patchable(app,'getAppTitle')){
    const original=app.getAppTitle;cleanup.add(wrap(app,'getAppTitle',function(...args){const value=original.apply(this,args);return alive && typeof value==='string'?replaceTitle(value):value;}));capabilities.windowTitle=true;
  }

  const choosers=installChooserAliases(app,provider,current,{sdk,timeoutMs:options.timeoutMs,alive:()=>alive,epoch:()=>epoch,cleanup});
  capabilities.commands.push(...choosers.commands);
  const drawer=installDrawerAliases(provider,current,{sdk,timeoutMs:options.timeoutMs,alive:()=>alive,attached:doc=>docs.has(doc)});
  function attach(doc:Document):void {
    if(!alive || docs.has(doc))return;docs.add(doc);
    const resources=new Set<()=>void>();
    const disposeDocument=()=>{
      if(!docs.delete(doc))return;
      for(const release of [...resources].reverse())try{release();}catch{/* Closed or foreign window state. */}resources.clear();
      for(const [label,change] of labelChanges)if(label.ownerDocument===doc){if(label.textContent===change.written)label.textContent=change.original;labelChanges.delete(label);}
      const title=titleChanges.get(doc);if(title && doc.title===title.written)doc.title=title.original;titleChanges.delete(doc);
      documentCleanup.delete(doc);cleanup.delete(disposeDocument);
    };
    documentCleanup.set(doc,disposeDocument);cleanup.add(disposeDocument);
    if(drawer.attach(doc,resources))capabilities.drawer=true;
    const Observer=doc.defaultView?.MutationObserver;if(Observer && doc.querySelector('title')){
      const observer=new Observer(()=>{if(alive && docs.has(doc))refresh();});observer.observe(doc.querySelector('title')!,{childList:true,subtree:true,characterData:true});resources.add(()=>observer.disconnect());
    }
  }
  const document=options.document??(typeof window==='object'?window.document:undefined);if(document)attach(document);
  if(app.workspace.on && app.workspace.offref){
    const change=app.workspace.on('layout-change',refresh);cleanup.add(()=>app.workspace.offref!(change));
    const eventDocument=(value:unknown):Document|undefined=>{const doc=(value as {document?:Document}|null)?.document;return doc?.defaultView&&typeof doc.addEventListener==='function'?doc:undefined;};
    const opened=app.workspace.on('window-open',(_workspace,value)=>{const doc=eventDocument(value);if(doc){attach(doc);refresh();}});cleanup.add(()=>app.workspace.offref!(opened));
    const closed=app.workspace.on('window-close',(_workspace,value)=>{const doc=eventDocument(value);if(doc)documentCleanup.get(doc)?.();});cleanup.add(()=>app.workspace.offref!(closed));
  }
  refresh();
  return {get capabilities():AliasCapabilities{return Object.freeze({...capabilities,commands:Object.freeze([...capabilities.commands])});},refresh,dispose(){
    if(!alive)return;alive=false;epoch++;drawer.cancelPending();for(const restore of [...cleanup].reverse())try{restore();}catch{/* Foreign host changes cannot block other restoration. */}cleanup.clear();
    for(const [label,change] of labelChanges)if(label.textContent===change.written)label.textContent=change.original;
    for(const [doc,change] of titleChanges)if(doc.title===change.written)doc.title=change.original;
    docs.clear();documentCleanup.clear();choosers.clear();labelChanges.clear();titleChanges.clear();
  }};
}
