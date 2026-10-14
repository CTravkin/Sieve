import * as Obsidian from 'obsidian';
import {patchable} from '../platform/capabilities.ts';
import {displayName,resolveNames} from './display-name.ts';
import type {AliasApp,AliasCapabilities,AliasInstallation,AliasProvider,AliasSnapshot,VaultLabel} from './contracts.ts';

type NativeFunction=(this:any,...args:any[])=>any;
interface Chooser {app:unknown;items:VaultLabel[];loadVaults:NativeFunction;getItemText:NativeFunction;updateSuggestions:NativeFunction;onChooseItem:NativeFunction;close:NativeFunction}
interface MenuEntry {titleEl?:{textContent:string|null};setTitle?:(title:string)=>unknown}
interface NativeMenu {items?:MenuEntry[];hide?:NativeFunction}
interface AliasSdk {Menu?:{forEvent?:(event:MouseEvent)=>NativeMenu};FuzzySuggestModal?:{prototype:{open?:NativeFunction}}}
interface Options {document?:Document;sdk?:AliasSdk;timeoutMs?:number}
let capturing=false;

/** Restore only our own wrapper; a retained foreign wrapper sees an inert delegate. */
function wrap(owner:object,key:string,replacement:NativeFunction):()=>void {
  const descriptor=Object.getOwnPropertyDescriptor(owner,key);
  Object.defineProperty(owner,key,{configurable:true,writable:true,enumerable:descriptor?.enumerable??false,value:replacement});
  return()=>{if((owner as Record<string,unknown>)[key]!==replacement)return;if(descriptor)Object.defineProperty(owner,key,descriptor);else delete (owner as Record<string,unknown>)[key];};
}
function chooser(value:unknown,app:AliasApp):value is Chooser {
  const modal=value as Chooser;
  return !!modal && modal.app===app && Array.isArray(modal.items) && ['loadVaults','getItemText','updateSuggestions','onChooseItem','close'].every(key=>typeof (modal as unknown as Record<string,unknown>)[key]==='function');
}
function labels(items:readonly VaultLabel[]):boolean {return items.every(item=>item && typeof item.path==='string' && typeof item.name==='string' && typeof item.isCurrentVault==='boolean');}

export function installAliases(app:AliasApp,provider:AliasProvider,current:()=>string,options:Options={}):AliasInstallation {
  const sdk=options.sdk??Obsidian as unknown as AliasSdk;
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
    for(const project of openChoosers.values())void project().catch(()=>{});
  }
  if(titleBase && typeof app.getAppTitle==='function' && patchable(app,'getAppTitle')){
    const original=app.getAppTitle;cleanup.add(wrap(app,'getAppTitle',function(...args){const value=original.apply(this,args);return alive && typeof value==='string'?replaceTitle(value):value;}));capabilities.windowTitle=true;
  }

  const openChoosers=new Map<Chooser,()=>Promise<void>>();
  function captureModal(modal:Chooser):void {
    if(openChoosers.has(modal) || !patchable(modal,'loadVaults') || !patchable(modal,'close'))return;
    let loaded=false,closed=false,request=0;const changes=new Map<VaultLabel,{original:string;written:string}>();
    const restoreNames=()=>{for(const [item,change] of changes)if(item.name===change.written)(item as {name:string}).name=change.original;changes.clear();};
    const project=async()=>{
      if(!alive || !loaded || closed || !labels(modal.items) || modal.items.some(item=>Object.getOwnPropertyDescriptor(item,'name')?.writable!==true))return;
      const version=++request,revision=epoch;const items=modal.items.slice();
      const originals=items.map(item=>({...item,name:changes.get(item)?.original??item.name}));
      let source:AliasSnapshot|undefined;try{source=provider.snapshot?.();}catch{/* Unavailable desktop registry uses original names. */}
      const reader=provider.snapshot?(source??{read:async()=>undefined}):provider;
      let names=await resolveNames(originals,reader,current(),options.timeoutMs,()=>!alive || closed || version!==request || revision!==epoch);
      if(!alive || closed || version!==request || revision!==epoch || items.some((item,index)=>modal.items[index]!==item))return;
      if(source)try{if(!source.validate())names=originals.map(item=>item.isCurrentVault?displayName(item.name,current()):item.name);}catch{names=originals.map(item=>item.isCurrentVault?displayName(item.name,current()):item.name);}
      for(let i=0;i<items.length;i++){
        const item=items[i],existing=changes.get(item);if(existing && item.name!==existing.written)continue;
        changes.set(item,{original:originals[i].name,written:names[i]});(item as {name:string}).name=names[i];
      }
      try{modal.updateSuggestions();}catch{/* Native errors stay isolated from filtering. */}
    };
    openChoosers.set(modal,project);
    const originalLoad=modal.loadVaults,originalClose=modal.close;
    const restorers:(()=>void)[]=[];
    const disposeModal=()=>{closed=true;request++;restoreNames();openChoosers.delete(modal);for(const restore of restorers.reverse())restore();cleanup.delete(disposeModal);if(loaded)try{modal.updateSuggestions();}catch{/* Closed native modal. */}};
    restorers.push(wrap(modal,'loadVaults',function(...args){
      const result=originalLoad.apply(this,args);
      if(alive && !closed)Promise.resolve(result).then(()=>{loaded=true;return project();},()=>{}).catch(()=>{});
      return result;
    }));
    restorers.push(wrap(modal,'close',function(...args){disposeModal();return originalClose.apply(this,args);}));
    cleanup.add(disposeModal);
  }
  const commands=app.commands?.commands;
  const prototype=sdk.FuzzySuggestModal?.prototype;
  if(prototype && typeof prototype.open==='function' && patchable(prototype,'open')){
    for(const id of ['app:switch-vault','app:open-another-vault']){
      const command=commands?.[id];if(!command || typeof command.callback!=='function' || !patchable(command,'callback'))continue;
      const original=command.callback as NativeFunction;
      cleanup.add(wrap(command,'callback',function(...args){
        if(!alive || capturing || typeof prototype.open!=='function' || !patchable(prototype,'open'))return original.apply(this,args);
        const nativeOpen=prototype.open;capturing=true;let count=0;let restore:(()=>void)|undefined;
        try{
          restore=wrap(prototype,'open',function(...openArgs){if(alive && ++count===1 && chooser(this,app))try{captureModal(this);}catch{/* Unknown modal shape must retain native open behavior. */}return nativeOpen.apply(this,openArgs);});
          return original.apply(this,args);
        }finally{try{restore?.();}finally{capturing=false;}}
      }));capabilities.commands.push(id);
    }
  }

  const replay=new WeakMap<Event,{vaults:readonly VaultLabel[];names:readonly string[]}|undefined>();let clickRequest=0;
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
    if((provider.list || provider.snapshot) && typeof sdk.Menu?.forEvent==='function'){
      const switcher=(event:Event):Element|undefined=>{
        const target=event.target as Element|null;return target && typeof target.closest==='function'?target.closest('.workspace-drawer-vault-switcher')??undefined:undefined;
      };
      const capture=(event:Event)=>{
        if(!alive || replay.has(event) || !doc.defaultView?.MouseEvent || event.type!=='click' || event.defaultPrevented || !switcher(event) || (event as MouseEvent).button!==0)return;
        let source:AliasSnapshot|undefined,vaults:readonly VaultLabel[]|undefined;
        try{source=provider.snapshot?.();vaults=provider.snapshot?source?.vaults:provider.list!();}catch{return;}
        if(!vaults?.length || !labels(vaults))return;
        vaults=vaults.map(vault=>({...vault}));
        event.preventDefault();event.stopImmediatePropagation();const request=++clickRequest,target=switcher(event)!;const original=event as MouseEvent;let dispatched=false;
        const dispatch=(names?:readonly string[])=>{
          if(dispatched || !alive || !docs.has(doc) || request!==clickRequest || !target.isConnected)return;
          const Mouse=doc.defaultView?.MouseEvent;if(!Mouse)return;
          const next=new Mouse('click',{bubbles:true,cancelable:true,view:doc.defaultView,button:original.button,buttons:original.buttons,clientX:original.clientX,clientY:original.clientY,screenX:original.screenX,screenY:original.screenY,ctrlKey:original.ctrlKey,altKey:original.altKey,shiftKey:original.shiftKey,metaKey:original.metaKey,detail:original.detail});
          replay.set(next,names?{vaults:vaults!,names:names.map((name,index)=>vaults![index].isCurrentVault?displayName(vaults![index].name,current()):name)}:undefined);dispatched=true;target.dispatchEvent(next);
        };
        void resolveNames(vaults,source??provider,current(),options.timeoutMs,()=>!alive || !docs.has(doc) || request!==clickRequest || !target.isConnected).then(names=>{
          if(!alive || !docs.has(doc) || request!==clickRequest || !target.isConnected)return;
          // A stale/failed registry check restores the native action, without cached aliases.
          let valid:boolean;
          if(source)valid=source.validate();
          else {const latest=provider.list!();valid=!!latest && latest.length===vaults!.length && latest.every((v,i)=>v.path===vaults![i].path && v.id===vaults![i].id && v.isCurrentVault===vaults![i].isCurrentVault);}
          dispatch(valid?names:undefined);
        }).catch(()=>dispatch());
      };
      const bubble=(event:Event)=>{
        const cached=replay.get(event);if(!alive || !cached || !event.defaultPrevented || !switcher(event))return;
        const menu=sdk.Menu!.forEvent!(event as MouseEvent),items=menu.items;
        if(!items || items.length!==cached.vaults.length+2 || !cached.vaults.every((vault,index)=>items[index]?.titleEl?.textContent===vault.name && typeof items[index]?.setTitle==='function'))return;
        const changes:{item:MenuEntry;original:string;name:string}[]=[];
        try{cached.names.forEach((name,index)=>{const item=items[index],original=item.titleEl!.textContent!;changes.push({item,original,name});item.setTitle!(name);});}
        catch{for(const {item,original,name} of changes)if(item.titleEl?.textContent===name)try{item.setTitle!(original);}catch{/* Foreign title setter. */}return;}
        let restoreHide:(()=>void)|undefined;
        const disposeMenu=()=>{for(const {item,original,name} of changes)if(item.titleEl?.textContent===name)item.setTitle!(original);restoreHide?.();resources.delete(disposeMenu);};
        if(typeof menu.hide==='function' && patchable(menu,'hide')){const original=menu.hide;restoreHide=wrap(menu,'hide',function(...args){disposeMenu();return original.apply(this,args);});}
        resources.add(disposeMenu);
      };
      doc.addEventListener('click',capture,true);doc.addEventListener('click',bubble);resources.add(()=>{doc.removeEventListener('click',capture,true);doc.removeEventListener('click',bubble);});capabilities.drawer=true;
    }
    const Observer=doc.defaultView?.MutationObserver;if(Observer && doc.querySelector('title')){
      const observer=new Observer(()=>{if(alive && docs.has(doc))refresh();});observer.observe(doc.querySelector('title')!,{childList:true,subtree:true,characterData:true});resources.add(()=>observer.disconnect());
    }
  }
  const document=options.document??(typeof globalThis.document==='object'?globalThis.document:undefined);if(document)attach(document);
  if(app.workspace.on && app.workspace.offref){
    const change=app.workspace.on('layout-change',refresh);cleanup.add(()=>app.workspace.offref!(change));
    const opened=app.workspace.on('window-open',(_workspace,window:Window)=>{if(window?.document){attach(window.document);refresh();}});cleanup.add(()=>app.workspace.offref!(opened));
    const closed=app.workspace.on('window-close',(_workspace,window:Window)=>{if(window?.document)documentCleanup.get(window.document)?.();});cleanup.add(()=>app.workspace.offref!(closed));
  }
  refresh();
  return {get capabilities():AliasCapabilities{return Object.freeze({...capabilities,commands:Object.freeze([...capabilities.commands])});},refresh,dispose(){
    if(!alive)return;alive=false;epoch++;clickRequest++;for(const restore of [...cleanup].reverse())try{restore();}catch{/* Foreign host changes cannot block other restoration. */}cleanup.clear();
    for(const [label,change] of labelChanges)if(label.textContent===change.written)label.textContent=change.original;
    for(const [doc,change] of titleChanges)if(doc.title===change.written)doc.title=change.original;
    docs.clear();documentCleanup.clear();openChoosers.clear();labelChanges.clear();titleChanges.clear();
  }};
}
