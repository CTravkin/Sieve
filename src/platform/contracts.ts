import type {Matcher,Platform} from '../core/types.ts';
export type HostMethod=(this:object,...args:unknown[])=>unknown;
export interface CacheEntry {type:'file'|'folder';realpath:string;[key:string]:unknown}
export interface PrivateAdapter {files:Record<string,CacheEntry>;basePath:string;fsPromises?:Record<string,unknown>;fs?:Record<string,unknown>;[key:string]:unknown}
export interface NativeFile {path:string;name:string;deleted:boolean;[key:string]:unknown}
export interface PrivateVault {adapter:unknown;configDir:string;load?:unknown;fileMap:Record<string,NativeFile>;[key:string]:unknown}
export interface RuntimeApp {vault:PrivateVault;metadataCache:Record<string,unknown>;fileManager:Record<string,unknown>;workspace:{layoutReady?:boolean;onLayoutReady:(callback:()=>void)=>unknown}}
export type RuntimePhase='pending'|'applied'|'error'|'disposed';
export interface FilterInstallation {readonly status:'ready'|'unsupported'|'error';readonly phase:RuntimePhase;readonly reloadNeeded:boolean;readonly initialStarted:boolean;readonly initialCompleted:boolean;readonly layoutReady:boolean;dispose():void}
export interface FilterOptions {onChange?:()=>void}
export type FilterInstaller=(app:RuntimeApp,matcher:Matcher,platform:Platform,options?:FilterOptions)=>FilterInstallation;
export function method(owner:object,key:string):HostMethod{return (owner as Record<string,unknown>)[key] as HostMethod;}
/** Buffer/views and ArrayBuffers from another host realm retain exact bytes. */
export function copyBinary(value:unknown):Uint8Array {
  if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer,value.byteOffset,value.byteLength).slice();
  try{return new Uint8Array(ArrayBuffer.prototype.slice.call(value,0));}catch{throw Error('Include read failed');}
}
