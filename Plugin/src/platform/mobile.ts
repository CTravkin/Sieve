// SPDX-License-Identifier: MPL-2.0
import type {PrivateAdapter} from './contracts.ts';
import {copyBinary,method} from './contracts.ts';
import type {AliasProvider} from '../alias/contracts.ts';
export function mobileIncludeReader(adapter:PrivateAdapter):(path:string)=>Promise<Uint8Array> {
  return async path=>{
    try{return copyBinary(await method(adapter,'readBinary').call(adapter,path));}
    catch{throw Error('Include read failed');}
  };
}

/** Only the already available native provider; no inferred filesystem registry. */
export function mobileAliasProvider(adapter:PrivateAdapter,configDir:string):AliasProvider {
  return {async read(vault){
    const provider=adapter.fs;
    const directory=vault.isCurrentVault?configDir:'.obsidian';
    if(!provider || typeof provider.read!=='function' || !vault.path || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(vault.path) || /^(?:[a-z]:|[\\/])/i.test(directory) || directory.split(/[\\/]/).some(part=>part==='..' || part==='.' || !part))throw Error('Alias read unavailable');
    return method(provider,'read').call(provider,vault.path.replace(/\/$/,'')+'/'+directory+'/plugins/sieve/data.json');
  }};
}
