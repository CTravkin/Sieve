export interface SieveSettings { readonly schemaVersion: 1; readonly rules: string; readonly displayName: string }
export const defaultSettings = (): SieveSettings => Object.freeze({schemaVersion:1,rules:'',displayName:''});
export function parseSettings(value: unknown): SieveSettings {
  if(!value || typeof value!=='object' || Array.isArray(value)) throw Error('Invalid settings schema');
  const record=value as Record<string,unknown>;
  if(!['schemaVersion','rules','displayName'].every(key=>Object.prototype.hasOwnProperty.call(record,key)) || record.schemaVersion!==1 || typeof record.rules!=='string' || typeof record.displayName!=='string') throw Error('Invalid settings schema');
  return Object.freeze({schemaVersion:1,rules:record.rules,displayName:record.displayName});
}
export const sameSettings=(a:SieveSettings|undefined,b:SieveSettings|undefined):boolean => a?.rules===b?.rules && a?.displayName===b?.displayName && a?.schemaVersion===b?.schemaVersion;

export interface CapturedInclude { readonly path: string; readonly contentBase64: string }
export interface WorkingSnapshot { readonly schemaVersion: 1; readonly settings: SieveSettings; readonly includes: readonly CapturedInclude[] }
export function encodeBytes(bytes: Uint8Array): string {
  let binary=''; for(const b of bytes) binary+=String.fromCharCode(b);
  return btoa(binary);
}
export function decodeBytes(encoded: string): Uint8Array {
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw Error('Invalid include snapshot');
  return Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
}
export function parseSnapshot(value: unknown): WorkingSnapshot {
  if(!value || typeof value!=='object' || Array.isArray(value)) throw Error('Invalid previous settings');
  const record=value as Record<string,unknown>;
  if(!Object.prototype.hasOwnProperty.call(record,'schemaVersion') || record.schemaVersion!==1 || !Object.prototype.hasOwnProperty.call(record,'settings') || !Object.prototype.hasOwnProperty.call(record,'includes') || !Array.isArray(record.includes)) throw Error('Invalid previous settings');
  const includes=record.includes.map((entry:unknown)=>{
    if(!entry || typeof entry!=='object' || Array.isArray(entry)) throw Error('Invalid include snapshot');
    const item=entry as Record<string,unknown>;
    if(!Object.prototype.hasOwnProperty.call(item,'path') || !Object.prototype.hasOwnProperty.call(item,'contentBase64') || typeof item.path!=='string' || typeof item.contentBase64!=='string' || /^(?:[a-zA-Z]:|\/)/.test(item.path)) throw Error('Invalid include snapshot');
    decodeBytes(item.contentBase64);
    return Object.freeze({path:item.path,contentBase64:item.contentBase64});
  });
  return Object.freeze({schemaVersion:1,settings:parseSettings(record.settings),includes:Object.freeze(includes)});
}
