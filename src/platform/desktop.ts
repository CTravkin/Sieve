import type {PrivateAdapter} from './contracts.ts';
import {copyBinary,method} from './contracts.ts';
export function desktopIncludeReader(adapter:PrivateAdapter):(path:string)=>Promise<Uint8Array> {
  return async path=>{
    const provider=adapter.fsPromises;
    if(!provider || typeof provider.readFile!=='function')throw Error('Include read unavailable');
    try{const full=method(adapter,'getFullRealPath').call(adapter,path);return copyBinary(await method(provider,'readFile').call(provider,full));}
    catch{throw Error('Include read failed');}
  };
}
