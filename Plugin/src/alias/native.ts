// SPDX-License-Identifier: MPL-2.0
export type NativeFunction=(this:any,...args:any[])=>any;

/** Restore only our own wrapper; a retained foreign wrapper sees an inert delegate. */
export function wrap(owner:object,key:string,replacement:NativeFunction):()=>void {
  const descriptor=Object.getOwnPropertyDescriptor(owner,key);
  Object.defineProperty(owner,key,{configurable:true,writable:true,enumerable:descriptor?.enumerable??false,value:replacement});
  return()=>{if((owner as Record<string,unknown>)[key]!==replacement)return;if(descriptor)Object.defineProperty(owner,key,descriptor);else delete (owner as Record<string,unknown>)[key];};
}
