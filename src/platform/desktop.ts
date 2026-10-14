import type {PrivateAdapter} from './contracts.ts';
import {copyBinary,method} from './contracts.ts';
import type {AliasProvider,AliasSnapshot,VaultLabel} from '../alias/contracts.ts';
export function desktopIncludeReader(adapter:PrivateAdapter):(path:string)=>Promise<Uint8Array> {
  return async path=>{
    const provider=adapter.fsPromises;
    if(!provider || typeof provider.readFile!=='function')throw Error('Include read unavailable');
    try{const full=method(adapter,'getFullRealPath').call(adapter,path);return copyBinary(await method(provider,'readFile').call(provider,full));}
    catch{throw Error('Include read failed');}
  };
}

/** Native desktop modules are resolved only inside this lazy desktop provider. */
export function desktopAliasProvider(adapter:PrivateAdapter,appId:string|undefined,configDir:string):AliasProvider {
  type DesktopHost={require?:(name:string)=>any;electron?:{ipcRenderer?:{sendSync:(channel:string)=>unknown}};localStorage?:Storage};
  const host=typeof window==='object'?window as unknown as DesktopHost:undefined;
  function registry():readonly VaultLabel[]|undefined {
    try {
      const ipc=host?.electron?.ipcRenderer??host?.require?.('electron')?.ipcRenderer;
      const path=host?.require?.('path');if(!ipc || typeof path?.basename!=='function' || typeof appId!=='string')return;
      const current=ipc.sendSync('vault') as {path?:unknown},entries=ipc.sendSync('vault-list') as Record<string,{path?:unknown}>;
      if(!current || typeof current.path!=='string' || !entries || typeof entries!=='object' || !Object.prototype.hasOwnProperty.call(entries,appId) || entries[appId]?.path!==current.path)return;
      const result:VaultLabel[]=[];
      for(const id of Object.keys(entries)){const entry=entries[id];if(!/^[a-f0-9]{16}$/i.test(id) || !entry || typeof entry.path!=='string' || !entry.path)return;result.push({id,path:entry.path,name:path.basename(entry.path),isCurrentVault:entry.path===current.path});}
      return result;
    }catch{return;}
  }
  function snapshot():AliasSnapshot|undefined {
    const vaults=registry();if(!vaults)return;
    const byId=new Map(vaults.map(vault=>[vault.id!,vault]));const byPath=new Map<string,VaultLabel|undefined>();
    for(const vault of vaults)byPath.set(vault.path,byPath.has(vault.path)?undefined:vault);
    return {vaults,validate(){const latest=registry();return !!latest && latest.length===vaults.length && latest.every((vault,index)=>vault.id===vaults[index].id && vault.path===vaults[index].path && vault.isCurrentVault===vaults[index].isCurrentVault);},async read(vault){
      const entry=vault.id?byId.get(vault.id):byPath.get(vault.path);
      if(!entry || entry.path!==vault.path || !adapter.fsPromises || typeof adapter.fsPromises.readFile!=='function')throw Error('Alias read unavailable');
      const override=entry.isCurrentVault?configDir:host?.localStorage?.getItem(entry.id+'-config')||'.obsidian';
      if(typeof override!=='string' || !override || /^(?:[a-z]:|[\\/])/i.test(override) || override.split(/[\\/]/).some(part=>part==='..' || part==='.' || !part))throw Error('Alias config unavailable');
      const path=host?.require?.('path');if(typeof path?.join!=='function')throw Error('Alias read unavailable');
      return method(adapter.fsPromises,'readFile').call(adapter.fsPromises,path.join(entry.path,override,'plugins','sieve','data.json'),'utf8');
    }};
  }
  return {list:registry,snapshot,async read(vault){const source=snapshot();if(!source)throw Error('Alias read unavailable');return source.read(vault);}};
}
