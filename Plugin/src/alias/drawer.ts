// SPDX-License-Identifier: MPL-2.0
import {patchable} from '../platform/capabilities.ts';
import {displayName,resolveNames} from './display-name.ts';
import {wrap,type NativeFunction} from './native.ts';
import {labels,sameVaults} from './vault-labels.ts';
import type {AliasProvider,AliasSnapshot,VaultLabel} from './contracts.ts';

interface MenuEntry {titleEl?:{textContent:string|null};setTitle?:(title:string)=>unknown}
interface NativeMenu {items?:MenuEntry[];hide?:NativeFunction}
export interface DrawerSdk {Menu?:{forEvent?:(event:MouseEvent)=>NativeMenu}}
interface Options {sdk:DrawerSdk;timeoutMs?:number;alive():boolean;attached(document:Document):boolean}

export function installDrawerAliases(provider:AliasProvider,current:()=>string,options:Options) {
  const {sdk,alive,attached}=options;
  const replay=new WeakMap<Event,{vaults:readonly VaultLabel[];names:readonly string[]}|undefined>();let clickRequest=0;
  return {cancelPending(){clickRequest++;},attach(doc:Document,resources:Set<()=>void>):boolean {
    if(!(provider.list || provider.snapshot) || typeof sdk.Menu?.forEvent!=='function')return false;
    const switcher=(event:Event):Element|undefined=>{
      const target=event.target as Element|null;return target && typeof target.closest==='function'?target.closest('.workspace-drawer-vault-switcher')??undefined:undefined;
    };
    const capture=(event:Event)=>{
      if(!alive() || replay.has(event) || !doc.defaultView?.MouseEvent || event.type!=='click' || event.defaultPrevented || !switcher(event) || (event as MouseEvent).button!==0)return;
      let source:AliasSnapshot|undefined,vaults:readonly VaultLabel[]|undefined;
      try{source=provider.snapshot?.();vaults=provider.snapshot?source?.vaults:provider.list!();}catch{return;}
      if(!vaults?.length || !labels(vaults))return;
      vaults=vaults.map(vault=>({...vault}));
      event.preventDefault();event.stopImmediatePropagation();const request=++clickRequest,target=switcher(event)!;const original=event as MouseEvent;let dispatched=false;
      const dispatch=(names?:readonly string[])=>{
        if(dispatched || !alive() || !attached(doc) || request!==clickRequest || !target.isConnected)return;
        const Mouse=doc.defaultView?.MouseEvent;if(!Mouse)return;
        const next=new Mouse('click',{bubbles:true,cancelable:true,view:doc.defaultView,button:original.button,buttons:original.buttons,clientX:original.clientX,clientY:original.clientY,screenX:original.screenX,screenY:original.screenY,ctrlKey:original.ctrlKey,altKey:original.altKey,shiftKey:original.shiftKey,metaKey:original.metaKey,detail:original.detail});
        replay.set(next,names?{vaults:vaults!,names:names.map((name,index)=>vaults![index].isCurrentVault?displayName(vaults![index].name,current()):name)}:undefined);dispatched=true;target.dispatchEvent(next);
      };
      void resolveNames(vaults,source??provider,current(),options.timeoutMs,()=>!alive() || !attached(doc) || request!==clickRequest || !target.isConnected).then(names=>{
        if(!alive() || !attached(doc) || request!==clickRequest || !target.isConnected)return;
        // A stale/failed registry check restores the native action, without cached aliases.
        const valid=source?source.validate():sameVaults(provider.list!(),vaults!);
        dispatch(valid?names:undefined);
      }).catch(()=>dispatch());
    };
    const bubble=(event:Event)=>{
      const cached=replay.get(event);if(!alive() || !cached || !event.defaultPrevented || !switcher(event))return;
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
    doc.addEventListener('click',capture,true);doc.addEventListener('click',bubble);resources.add(()=>{doc.removeEventListener('click',capture,true);doc.removeEventListener('click',bubble);});return true;
  }};
}
