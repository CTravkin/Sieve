import type {CacheEntry,HostMethod,NativeFile,PrivateAdapter,RuntimeApp} from './contracts.ts';
import {method} from './contracts.ts';

export type Wrap=(owner:object,key:string,body:(original:HostMethod,args:unknown[])=>unknown)=>void;
/** Physical adapter cache remains native; only the Vault content projection is hidden. */
export function installProjection(app:RuntimeApp,adapter:PrivateAdapter,ignored:(real:string)=>boolean,wrap:Wrap,beforeRenameCallback:()=>void) {
  const vault=app.vault;const metadata=app.metadataCache;const hidden=new Map<string,{file:NativeFile;cache:CacheEntry}>();
  const lookup=metadata.uniqueFileLookup as Record<string,unknown>;const shadows=new WeakMap<object,NativeFile>();
  const returning=new WeakMap<NativeFile,boolean>();
  let removing:{file:NativeFile;deleted:boolean;path:string}|undefined;
  const indexed=(key:string):NativeFile|undefined=>Object.prototype.hasOwnProperty.call(vault.fileMap,key)?vault.fileMap[key]:undefined;
  const publishable=(file:NativeFile):boolean=>indexed(file.path)===file && !ignored(adapter.files[file.path]?.realpath??file.path);
  const restore=(key:string):NativeFile|undefined=>{
    const entry=hidden.get(key);if(!entry)return;
    hidden.delete(key);returning.set(entry.file,false);Object.defineProperty(vault.fileMap,key,{value:entry.file,configurable:true,writable:true,enumerable:true});return entry.file;
  };
  function hide(key:string,projectionPath=key):void {
    const file=indexed(key);if(!file)return;
    const cache=adapter.files[key];if(!cache)return;hidden.set(key,{file,cache});
    const previous=removing;removing={file,deleted:file.deleted,path:projectionPath};
    try{method(vault,'onChange').call(vault,cache.type==='folder'?'folder-removed':'file-removed',key);}
    finally{file.deleted=removing.deleted;removing=previous;}
  }
  wrap(metadata,'computeFileMetadataAsync',(original,args)=>{
    const file=args[0];
    if(file && typeof file==='object' && typeof (file as NativeFile).path==='string'){
      const path=(file as NativeFile).path;if(ignored(adapter.files[path]?.realpath??path))return;
    }
    // Early installation precedes initialize/watchVaultChanges binding this
    // current method. Editor modify listeners still receive the physical file.
    return original.apply(metadata,args);
  });
  wrap(lookup,'add',(original,args)=>{
    const file=args[1];if(file && typeof file==='object' && !publishable(file as NativeFile))return;
    return original.apply(lookup,args);
  });
  wrap(lookup,'remove',(original,args)=>{
    const file=args[1];const native=file && typeof file==='object'?shadows.get(file):undefined;
    return native?original.call(lookup,args[0],native,...args.slice(2)):original.apply(lookup,args);
  });
  wrap(vault,'trigger',(original,args)=>{
    if(args[0]==='rename' && args[1] && typeof args[1]==='object' && typeof args[2]==='string'){
      const file=args[1] as NativeFile;const old=args[2];
      if(ignored(adapter.files[file.path]?.realpath??file.path)){
        // Native updated this exact TFile before dispatch. Finish the projection
        // now; every synchronous listener still receives the operational original.
        if(adapter.files[file.path]?.type==='file'){
          method(lookup,'remove').call(lookup,old.slice(old.lastIndexOf('/')+1).toLowerCase(),file);
          method(metadata,'deletePath').call(metadata,file.path);
        }
        returning.delete(file);hide(file.path,old);
      }else if(returning.has(file)){
        // The old projected item was deleted. Native FileExplorer.onRename only
        // moves existing old items; one index-create restores this exact original.
        returning.set(file,true);original.call(vault,'create',file);
      }
      beforeRenameCallback();
    }
    if(args[0]==='delete' && removing && args[1]===removing.file){
      const shadow=Object.create(Object.getPrototypeOf(removing.file),Object.getOwnPropertyDescriptors(removing.file)) as NativeFile;
      method(shadow,'setPath').call(shadow,removing.path);
      shadows.set(shadow,removing.file);
      // Native onChange removed the exact original from parent.children/fileMap.
      // Identity-sensitive FileView deletion sees only the projection shadow.
      removing.file.deleted=removing.deleted;return original.call(vault,'delete',shadow,...args.slice(2));
    }
    if(args[0]==='delete' && args[1] && typeof args[1]==='object')returning.delete(args[1] as NativeFile);
    return original.apply(vault,args);
  });
  wrap(metadata,'saveFileCache',(original,args)=>{
    const path=args[0];if(args[1]!=null && typeof path==='string' && (!indexed(path) || ignored(adapter.files[path]?.realpath??path)))return;
    return original.apply(metadata,args);
  });
  wrap(metadata,'queueFileForLinkResolution',(original,args)=>{
    const file=args[0];if(file && typeof file==='object' && !publishable(file as NativeFile))return;
    return original.apply(metadata,args);
  });
  wrap(metadata,'trigger',(original,args)=>{
    const file=args[1];if((args[0]==='changed'||args[0]==='resolve') && file && typeof file==='object' && !publishable(file as NativeFile))return;
    return original.apply(metadata,args);
  });
  return {
    indexed,
    has:(key:string):boolean=>hidden.has(key),
    restore,
    restoreParent(key:string):boolean {
      const file=restore(key);if(!file)return false;
      returning.delete(file);
      method(vault,'addChild').call(vault,file);method(vault,'trigger').call(vault,'create',file);return true;
    },
    compute(key:string):void {const file=indexed(key);if(file && publishable(file)){if(returning.get(file)){returning.delete(file);return;}method(metadata,'computeFileMetadataAsync').call(metadata,file);}},
    hide,
    modified(key:string,stat:unknown):void {
      const file=hidden.get(key)?.file??indexed(key);
      // Exact Vault.onChange state update, with the public index still absent.
      // Ordinary physical modify notification keeps held editors/conflicts alive.
      if(file && typeof file.cache==='function'){if(indexed(key)===file)hide(key);file.stat=stat;if(!file.saving)method(file,'cache').call(file,null);method(vault,'trigger').call(vault,'modify',file);}
    },
    retainCache():void {
      // Resume may reset the native cache. Preserve only known hidden operational
      // entries, without publishing them into the content index.
      for(const [key,entry] of hidden)if(!Object.prototype.hasOwnProperty.call(adapter.files,key))Object.defineProperty(adapter.files,key,{value:entry.cache,configurable:true,writable:true,enumerable:true});
    },
  };
}
