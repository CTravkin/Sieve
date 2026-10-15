// SPDX-License-Identifier: MPL-2.0
import {parseSettings} from '../settings/model.ts';
import type {AliasProvider,VaultLabel} from './contracts.ts';

/** Names are text. Whitespace-only input means use the host's original name. */
export function displayName(original:string,alias:string):string {return alias.trim()?alias:original;}
/** Bounded reads keep an inaccessible provider from swallowing a native click. */
export async function resolveNames(vaults:readonly VaultLabel[],provider:AliasProvider,current:string,timeoutMs=1500,cancelled:()=>boolean=()=>false):Promise<readonly string[]> {
  const names=vaults.map(vault=>vault.isCurrentVault?displayName(vault.name,current):vault.name);
  const deadline=Date.now()+timeoutMs;let next=0;
  const worker=async()=>{
    while(next<vaults.length && Date.now()<deadline && !cancelled()){
      const index=next++,vault=vaults[index];if(vault.isCurrentVault)continue;
      let timer:ReturnType<typeof setTimeout>|undefined;
      try {
        const raw=await Promise.race([Promise.resolve().then(()=>{if(cancelled())throw Error('Alias read cancelled');return provider.read(vault);}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Alias read unavailable')),Math.max(0,deadline-Date.now()));})]);
        names[index]=displayName(vault.name,parseSettings(typeof raw==='string'?JSON.parse(raw):raw).displayName);
      }catch{/* A failed/expired read keeps the original name. */}finally{if(timer!==undefined)clearTimeout(timer);}
    }
  };
  // Timed-out workers stop scheduling files, so pending native reads stay <=4.
  await Promise.all(Array.from({length:Math.min(4,vaults.length)},worker));return names;
}
