// SPDX-License-Identifier: MPL-2.0
import type {HostMethod,NativeFile,RuntimeApp} from './contracts.ts';
import {method} from './contracts.ts';
import type {Wrap} from './projection.ts';

/** Extend native rename snapshots privately; FileManager still owns link edits. */
export function installHiddenLinks(app:RuntimeApp,hiddenFiles:()=>NativeFile[],wrap:Wrap,failed:()=>void):()=>void {
  const manager=app.fileManager;const metadata=app.metadataCache;const vault=app.vault;
  const lookup=metadata.uniqueFileLookup as Record<string,unknown>;
  let active=true;
  const guard=<T>(operation:()=>T):T=>{try{return operation();}catch(error){failed();throw error;}};
  const augment=(snapshot:unknown):(()=>void)=>{
    const files=hiddenFiles();if(files.length===0)return ()=>{};
    if(!Array.isArray(snapshot))throw Error('Unsupported link snapshot');
    const additions:{sourceFile:unknown;reference:unknown;resolvedFile:NativeFile;resolvedPaths:string[]}[]=[];
    // Equal-content source files can share the same reference objects.
    const seen=new Map<unknown,Set<unknown>>();
    for(const item of snapshot){const refs=seen.get(item.sourceFile)??new Set<unknown>();refs.add(item.reference);seen.set(item.sourceFile,refs);}
    const byPath=new Map(files.map(file=>[file.path,file]));const byName=new Map<string,NativeFile[]>();
    for(const file of files){const name=file.name.toLowerCase();const list=byName.get(name)??[];list.push(file);byName.set(name,list);}
    const shadowVault=Object.create(vault) as object;
    Object.defineProperty(shadowVault,'getFileByPath',{value:(key:string)=>byPath.get(key)??method(vault,'getFileByPath').call(vault,key)});
    const shadowLookup=Object.create(lookup) as object;
    Object.defineProperty(shadowLookup,'get',{value:(name:string)=>[...((method(lookup,'get').call(lookup,name) as NativeFile[]|undefined)??[]),...(byName.get(name)??[])]});
    const shadowMetadata=Object.create(metadata) as object;
    Object.defineProperties(shadowMetadata,{vault:{value:shadowVault},uniqueFileLookup:{value:shadowLookup}});
    method(metadata,'iterateAllRefs').call(metadata,(sourcePath:string,reference:{link:string})=>{
      const link=reference.link.split('#',1)[0];
      if(!link)return;
      const source=method(vault,'getFileByPath').call(vault,sourcePath);
      if(!source || seen.get(source)?.has(reference))return;
      if((method(metadata,'getLinkpathDest').call(metadata,link,sourcePath) as NativeFile[]).length)return;
      const resolved=method(metadata,'getLinkpathDest').call(shadowMetadata,link,sourcePath) as NativeFile[];
      if(resolved.length!==1 || !byPath.has(resolved[0].path))return;
      const refs=seen.get(source)??new Set<unknown>();refs.add(reference);seen.set(source,refs);
      const item={sourceFile:source,reference,resolvedFile:resolved[0],resolvedPaths:[resolved[0].path]};snapshot.push(item);additions.push(item);
    });
    return ()=>{
      const discarded=new Set(additions.filter(item=>!active || item.resolvedFile.deleted || item.resolvedFile.path===item.resolvedPaths[0]));
      if(discarded.size===0)return;
      let count=0;for(const item of snapshot)if(!discarded.has(item))snapshot[count++]=item;snapshot.length=count;
    };
  };
  wrap(manager,'runAsyncLinkUpdate',function(original,args){
    if(typeof args[0]!=='function')return original.apply(manager,args);
    const callback=args[0] as HostMethod;
    const wrapped:HostMethod=function(...values){
      const cleanup=active?guard(()=>augment(values[0])):()=>{};const prune=()=>guard(cleanup);
      let value:unknown;try{value=callback.apply(this,values);}catch(error){prune();throw error;}
      if(value && typeof (value as PromiseLike<unknown>).then==='function')return Promise.resolve(value).finally(prune);
      prune();return value;
    };
    return original.call(manager,wrapped,...args.slice(1));
  },false);
  return ()=>{active=false;};
}
