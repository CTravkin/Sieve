// SPDX-License-Identifier: MPL-2.0
import {patchable} from '../platform/capabilities.ts';
import {displayName,resolveNames} from './display-name.ts';
import {wrap,type NativeFunction} from './native.ts';
import {labels} from './vault-labels.ts';
import type {AliasApp,AliasProvider,AliasSnapshot,VaultLabel} from './contracts.ts';

interface Chooser {app:unknown;items:VaultLabel[];loadVaults:NativeFunction;getItemText:NativeFunction;updateSuggestions:NativeFunction;onChooseItem:NativeFunction;close:NativeFunction}
export interface ChooserSdk {FuzzySuggestModal?:{prototype:{open?:NativeFunction}}}
interface Options {sdk:ChooserSdk;timeoutMs?:number;alive:()=>boolean;epoch:()=>number;cleanup:Set<()=>void>}
let capturing=false;

function chooser(value:unknown,app:AliasApp):value is Chooser {
  const modal=value as Chooser;
  return !!modal && modal.app===app && Array.isArray(modal.items) && ['loadVaults','getItemText','updateSuggestions','onChooseItem','close'].every(key=>typeof (modal as unknown as Record<string,unknown>)[key]==='function');
}

export function installChooserAliases(app:AliasApp,provider:AliasProvider,current:()=>string,options:Options) {
  const {sdk,alive,epoch,cleanup}=options;
  const openChoosers=new Map<Chooser,()=>Promise<void>>();
  function captureModal(modal:Chooser):void {
    if(openChoosers.has(modal) || !patchable(modal,'loadVaults') || !patchable(modal,'close'))return;
    let loaded=false,closed=false,request=0;const changes=new Map<VaultLabel,{original:string;written:string}>();
    const restoreNames=()=>{for(const [item,change] of changes)if(item.name===change.written)(item as {name:string}).name=change.original;changes.clear();};
    const project=async()=>{
      if(!alive() || !loaded || closed || !labels(modal.items) || modal.items.some(item=>Object.getOwnPropertyDescriptor(item,'name')?.writable!==true))return;
      const version=++request,revision=epoch();const items=modal.items.slice();
      const originals=items.map(item=>({...item,name:changes.get(item)?.original??item.name}));
      let source:AliasSnapshot|undefined;try{source=provider.snapshot?.();}catch{/* Unavailable desktop registry uses original names. */}
      const reader=provider.snapshot?(source??{read:async()=>undefined}):provider;
      let names=await resolveNames(originals,reader,current(),options.timeoutMs,()=>!alive() || closed || version!==request || revision!==epoch());
      if(!alive() || closed || version!==request || revision!==epoch() || items.some((item,index)=>modal.items[index]!==item))return;
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
      if(alive() && !closed)Promise.resolve(result).then(()=>{loaded=true;return project();},()=>{}).catch(()=>{});
      return result;
    }));
    restorers.push(wrap(modal,'close',function(...args){disposeModal();return originalClose.apply(this,args);}));
    cleanup.add(disposeModal);
  }
  const commands=app.commands?.commands,installed:string[]=[];
  const prototype=sdk.FuzzySuggestModal?.prototype;
  if(prototype && typeof prototype.open==='function' && patchable(prototype,'open')){
    for(const id of ['app:switch-vault','app:open-another-vault']){
      const command=commands?.[id];if(!command || typeof command.callback!=='function' || !patchable(command,'callback'))continue;
      const original=command.callback as NativeFunction;
      cleanup.add(wrap(command,'callback',function(...args){
        if(!alive() || capturing || typeof prototype.open!=='function' || !patchable(prototype,'open'))return original.apply(this,args);
        const nativeOpen=prototype.open;capturing=true;let count=0;let restore:(()=>void)|undefined;
        try{
          restore=wrap(prototype,'open',function(...openArgs){if(alive() && ++count===1 && chooser(this,app))try{captureModal(this);}catch{/* Unknown modal shape must retain native open behavior. */}return nativeOpen.apply(this,openArgs);});
          return original.apply(this,args);
        }finally{try{restore?.();}finally{capturing=false;}}
      }));installed.push(id);
    }
  }
  return {commands:installed,refresh(){for(const project of openChoosers.values())void project().catch(()=>{});},clear(){openChoosers.clear();}};
}
