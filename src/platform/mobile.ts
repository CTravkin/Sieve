import type {PrivateAdapter} from './contracts.ts';
import {copyBinary,method} from './contracts.ts';
export function mobileIncludeReader(adapter:PrivateAdapter):(path:string)=>Promise<Uint8Array> {
  return async path=>{
    try{return copyBinary(await method(adapter,'readBinary').call(adapter,path));}
    catch{throw Error('Include read failed');}
  };
}
