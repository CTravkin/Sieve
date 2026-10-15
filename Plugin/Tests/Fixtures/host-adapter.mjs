// SPDX-License-Identifier: MPL-2.0
import {attachLinkManager} from './link-manager.mjs';
export const hostKey=path=>path.replace(/[\\/]+/g,'/').replace(/^\/+|\/+$/g,'').replace(/[\u00a0\u202f]/g,' ').normalize('NFC')||'/';
const parentOf=path=>path.includes('/')?path.slice(0,path.lastIndexOf('/')):'';
class AbstractFile {
  constructor(vault,path){this.vault=vault;this.parent=null;this.deleted=false;this.setPath(path);}
  setPath(path){this.path=path;this.name=path.slice(path.lastIndexOf('/')+1);}
}
class File extends AbstractFile {
  constructor(vault,path){super(vault,path);this.saving=0;this.stat=null;}
  cache(value){this.cached=value;}
  setPath(path){super.setPath(path);const dot=this.name.lastIndexOf('.');this.basename=dot<0?this.name:this.name.slice(0,dot);this.extension=dot<0?'':this.name.slice(dot+1);}
}
class Folder extends AbstractFile {
  constructor(vault,path){super(vault,path);this.children=[];}
  isRoot(){return this.path==='/';}
}
/** Exact source seams: adapter physical cache -> Vault.onChange -> identity-sensitive listeners. */
export function fakeHost(mobile=false,paths=['Technical/secret.md','notes/public.md']) {
  const physical=new Map([['',{type:'folder'}]]);const io=[];const events=[];const vaultEvents=[];const metadata=new Map();const callbacks=[];const listeners=new Map();let clock=1;
  for(const path of paths){physical.set(path,{type:'file',content:new Uint8Array([1,2,3])});for(let parent=parentOf(path);parent&&!physical.has(parent);parent=parentOf(parent))physical.set(parent,{type:'folder'});}
  const relative=p=>String(p).replace(/^\/vault\/?/,'');
  const stats=p=>{io.push(['stat',relative(p)]);const entry=physical.get(relative(p));if(!entry)throw Object.assign(Error('ENOENT'),{code:'ENOENT'});return {mtime:entry.mtime??0,size:entry.content?.length??0,type:entry.type==='folder'?'directory':'file',isFile:()=>entry.type==='file',isDirectory:()=>entry.type==='folder',isSymbolicLink:()=>false};};
  const fs={
    async readdir(p){io.push(['readdir',relative(p)]);const prefix=relative(p)?relative(p)+'/':'';return [...physical.keys()].filter(k=>k.startsWith(prefix)&&k!==relative(p)&&!k.slice(prefix.length).includes('/')).map(k=>mobile?{name:k.slice(prefix.length),type:physical.get(k).type==='folder'?'directory':'file',mtime:physical.get(k).mtime??0,size:physical.get(k).content?.length??0}:k.slice(prefix.length));},
    async lstat(p){return stats(p);},async stat(p){return stats(p);},async watch(){io.push(['watch','']);},
    async watchAndStatAll(){io.push(['bulk','']);return {children:[...physical].filter(([p])=>p).map(([name,e])=>({name,type:e.type==='folder'?'directory':'file'}))};},
    async readFile(p){io.push(['read',relative(p)]);return physical.get(relative(p))?.content??new Uint8Array();},
  };
  const vault={
    fileMap:{},configDir:'.custom',adapter:null,
    getAbstractFileByPath(p){return Object.hasOwn(this.fileMap,p)?this.fileMap[p]:null;},
    getDirectParent(file){return this.fileMap[parentOf(file.path)||'/']??null;},
    addChild(file){const parent=this.getDirectParent(file);if(parent&&parent!==file.parent){if(file.parent)file.parent.children.splice(file.parent.children.indexOf(file),1);parent.children.push(file);file.parent=parent;}},
    removeChild(file){if(file.parent){const siblings=file.parent.children;const index=siblings.indexOf(file);if(index>=0)siblings.splice(index,1);file.parent=null;}},
    on(name,callback){const entries=listeners.get(name)??[];entries.push(callback);listeners.set(name,entries);},
    onFirst(name,callback){const entries=listeners.get(name)??[];entries.unshift(callback);listeners.set(name,entries);},
    trigger(type,...args){vaultEvents.push([type,...args]);for(const callback of [...listeners.get(type)??[]])callback(...args);},
    onChange(type,path,old,stat){
      const map=this.fileMap;
      if(type==='file-created'||type==='folder-created'){const file=type==='file-created'?new File(this,path):new Folder(this,path);if(file instanceof File)file.stat=stat;map[path]=file;this.addChild(file);this.trigger('create',file);}
      else if(type==='modified'){if(!Object.hasOwn(map,path))return;const file=map[path];if(file instanceof File){file.stat=stat;if(!file.saving)file.cache(null);}this.trigger('modify',file);}
      else if(type==='file-removed'||type==='folder-removed'){if(Object.hasOwn(map,path)){const file=map[path];this.removeChild(file);delete map[path];file.deleted=true;this.trigger('delete',file);}}
      else if(type==='renamed'){if(Object.hasOwn(map,old)){const file=map[old];this.removeChild(file);file.setPath(path);this.addChild(file);map[path]=file;delete map[old];this.trigger('rename',file,old);}}
      else if(type==='raw')this.trigger('raw',path);
    },
    async load(){this.fileMap={'/':new Folder(this,'/')};if(mobile)await this.adapter.watchAndList();else await this.adapter.listAll();metadataCache.initialize();},
    async rename(file,path){await this.adapter.rename(file.path,hostKey(path));},
    async readBinary(file){return this.adapter.readBinary(file.path);},
    async cachedRead(file){if(file.cached!=null)return file.cached;const bytes=await this.readBinary(file);file.cache(bytes);return bytes;},
    async modifyBinary(file,bytes){file.saving++;try{file.cache(null);await this.adapter.writeBinary(file.path,bytes);}finally{file.saving--; }},
    async delete(file){await this.adapter.remove(file.path);},
  };
  const lookup=new Map();
  const workQueue={promise:Promise.resolve(),queue(callback){const result=this.promise.then(callback,callback);this.promise=result;return result;}};
  const metadataCache={initialized:false,fileCache:{},metadataCache:{},resolvedLinks:{},unresolvedLinks:{},workQueue,pending:[],events:[],errors:[],counters:{queue:[],reads:[],parses:[],related:[]},uniqueFileLookup:{
    add(name,file){const entries=lookup.get(name)??new Set();entries.add(file);lookup.set(name,entries);},
    remove(name,file){const entries=lookup.get(name);entries?.delete(file);if(entries?.size===0)lookup.delete(name);},
  },
    trigger(type,...args){this.events.push([type,...args]);},
    saveFileCache(path,value){if(value){this.fileCache[path]=value;metadata.set(path,value);}else {delete this.fileCache[path];metadata.delete(path);}},
    queueFileForLinkResolution(file){this.events.push(['queue',file]);if(file){const cache=this.fileCache[file.path];const data=cache&&this.metadataCache[cache.hash];if(data)this.resolvedLinks[file.path]=Object.fromEntries(data.links.map(link=>[link,1]));}},
    computeFileMetadataAsync(file){
      if(!(file instanceof File))return;this.uniqueFileLookup.add(file.name.toLowerCase(),file);const path=file.path;const stat=file.stat??{mtime:0,size:0};let cached=this.fileCache[path];
      if(cached&&cached.mtime===stat.mtime&&cached.size===stat.size&&this.metadataCache[cached.hash]){this.queueFileForLinkResolution(file);return;}
      if(!cached){cached={mtime:0,size:0,hash:''};this.saveFileCache(path,cached);}
      this.counters.queue.push(path);
      const task=this.workQueue.queue(async()=>{try{this.counters.reads.push(file.path);const bytes=(await vault.readBinary(file)).slice();this.onRead?.(file,bytes);await this.gate;const hash=[...bytes].join(',');let data=this.metadataCache[hash];if(!data){this.counters.parses.push(file.path);data={links:[...new TextDecoder().decode(bytes).matchAll(/\[\[([^\]]+)\]\]/g)].map(match=>match[1])};}Object.assign(cached,{mtime:stat.mtime,size:stat.size,hash});this.saveFileCache(path,cached);this.metadataCache[hash]=data;this.queueFileForLinkResolution(file);this.trigger('changed',file,bytes,data);}catch(error){this.errors.push(error.code??'read-failed');}});this.pending.push(task);
    },
    updateRelatedLinks(names){this.counters.related.push(names);},
    deletePath(path){delete this.resolvedLinks[path];delete this.unresolvedLinks[path];this.saveFileCache(path,null);this.updateRelatedLinks([path.slice(path.lastIndexOf('/')+1)]);this.queueFileForLinkResolution(null);},
    onDelete(file){if(file instanceof File){this.uniqueFileLookup.remove(file.name.toLowerCase(),file);this.trigger('deleted',file);this.deletePath(file.path);}},
    onRename(file,old){if(file instanceof File){this.uniqueFileLookup.remove(old.slice(old.lastIndexOf('/')+1).toLowerCase(),file);this.uniqueFileLookup.add(file.name.toLowerCase(),file);for(const map of [this.resolvedLinks,this.unresolvedLinks])if(Object.hasOwn(map,old)){map[file.path]=map[old];delete map[old];}if(Object.hasOwn(this.fileCache,old)){this.saveFileCache(file.path,this.fileCache[old]);this.saveFileCache(old,null);}this.queueFileForLinkResolution(null);}},
    onCreate(file){this.computeFileMetadataAsync(file);},
    watchVaultChanges(){vault.on('create',this.onCreate.bind(this));vault.on('modify',this.computeFileMetadataAsync.bind(this));vault.on('rename',this.onRename.bind(this));vault.on('delete',this.onDelete.bind(this));vault.on('external-watch',this.computeFileMetadataAsync.bind(this));},
    initialize(){if(this.initialized)return;for(const path of Object.keys(this.fileCache))if(!Object.hasOwn(vault.fileMap,path))this.deletePath(path);for(const file of Object.values(vault.fileMap))this.computeFileMetadataAsync(file);this.initialized=true;this.watchVaultChanges();},
    async drain(){await this.workQueue.promise;this.pending.length=0;},
  };
  // Native FileExplorer uses path keys, even though each item retains a TFile.
  const explorer={fileItems:{},files:new Map(),onCreate(file){if(file.path==='/'||Object.hasOwn(this.fileItems,file.path))return;const item={file,el:{},updateTitle(){}};this.fileItems[file.path]=item;this.files.set(item.el,file);},onDelete(file){if(Object.hasOwn(this.fileItems,file.path)){const item=this.fileItems[file.path];this.files.delete(item.el);delete this.fileItems[file.path];}},onRename(file,old){if(Object.hasOwn(this.fileItems,old)){const item=this.fileItems[old];delete this.fileItems[old];this.fileItems[file.path]=item;item.updateTitle();this.files.set(item.el,file);}}};
  vault.on('create',explorer.onCreate.bind(explorer));vault.on('delete',explorer.onDelete.bind(explorer));vault.on('rename',explorer.onRename.bind(explorer));
  const adapter={basePath:'/vault',files:{},fsPromises:mobile?undefined:fs,fs:mobile?fs:undefined,insensitive:false,
    getFullRealPath(p){return '/vault/'+(p==='/'?'':p);},
    getRealPath(p){for(let current=p;current;current=parentOf(current))if(Object.hasOwn(this.files,current))return this.files[current].realpath+p.slice(current.length);return p;},
    trigger(type,path,old,stat){events.push([type,path,old]);vault.onChange(type,path,old,stat);},
    removeFile(p){const entry=this.files[p];delete this.files[p];if(entry)this.trigger(entry.type==='folder'?'folder-removed':'file-removed',p);},
    async listAll(){this.files={'/':{type:'folder',realpath:'/'}};await this.listRecursive('');},
    async watchAndList(){this.files={'/':{type:'folder',realpath:'/'}};const result=await fs.watchAndStatAll(this.basePath);for(const entry of result.children)this.quickList('',entry);},
    quickList(parent,entry){const p=parent?parent+'/'+entry.name:entry.name;this.trigger('raw',hostKey(p));if(entry.type==='file')this.reconcileFileChanged(p,hostKey(p),entry);else if(entry.type==='directory'){this.files[hostKey(p)]={type:'folder',realpath:p};this.trigger('folder-created',hostKey(p));}},
    async listRecursive(parent){const entries=await fs.readdir(this.getFullRealPath(parent));await Promise.all(entries.map(e=>this.listRecursiveChild(parent,e)));},
    async listRecursiveChild(parent,entry){const p=parent?parent+'/'+(mobile?entry.name:entry):(mobile?entry.name:entry);const key=hostKey(p);this.trigger('raw',key);if(mobile){if(entry.type==='file')this.reconcileFileChanged(p,key,entry);else await this.reconcileFolderCreation(p,key);}else await this.reconcileFileInternal(p,key);},
    async reconcileFile(p,key){this.trigger('raw',key);try{if(mobile){const stat=await fs.stat(this.getFullRealPath(p));if(stat.type==='file')this.reconcileFileChanged(p,key,stat);else await this.reconcileFolderCreation(p,key);}else await this.reconcileFileInternal(p,key);}catch(error){if(error.code!=='ENOENT')throw error;for(const child of Object.keys(this.files).filter(k=>k===key||k.startsWith(key+'/')))this.removeFile(child);}},
    async reconcileFileInternal(p,key){const stat=await fs.lstat(this.getFullRealPath(p));if(stat.isFile())await this.reconcileFileCreation(p,key,stat);else await this.reconcileFolderCreation(p,key);},
    reconcileFileChanged(p,key,stat){if(this.files[key]){this.files[key].realpath=p;this.trigger('modified',key,undefined,stat);}else return this.reconcileFileCreation(p,key,stat);},
    reconcileFileCreation(p,key,stat){const prior=this.files[key];this.files[key]={type:'file',realpath:p};this.trigger(prior?'modified':'file-created',key,undefined,stat);},
    async reconcileFolderCreation(p,key){if(!this.files[key]){this.files[key]={type:'folder',realpath:p};this.trigger('folder-created',key);await this.listRecursive(p);}else this.files[key].realpath=p;},
    async rename(from,to){
      const realFrom=this.getRealPath(from);const realTo=this.getRealPath(to);const root=this.files[from];const oldReal=root?.realpath;
      if(from===to)return;if(!physical.has(realFrom))throw Object.assign(Error('ENOENT'),{code:'ENOENT'});
      if(physical.has(realTo))throw Error('Destination file already exists');
      if(!physical.has(parentOf(realTo)))throw Object.assign(Error('ENOENT destination parent'),{code:'ENOENT'});
      for(const old of [...physical.keys()].filter(p=>p===realFrom||p.startsWith(realFrom+'/'))){const value=physical.get(old);physical.delete(old);physical.set(realTo+old.slice(realFrom.length),value);}
      // Native performs physical rename even when no cache entry exists, then returns without notifications.
      if(!root)return;
      delete this.files[from];root.realpath=this.getRealPath(to);this.files[to]=root;this.trigger('renamed',to,from);
      if(root.type==='folder'){
        if(!mobile&&this.renamePause)await new Promise(resolve=>setTimeout(resolve,0));
        for(const old of Object.keys(this.files).filter(p=>p.startsWith(from+'/'))){const value=this.files[old];delete this.files[old];const key=to+old.slice(from.length);value.realpath=root.realpath+value.realpath.slice(oldReal.length);this.files[key]=value;this.trigger('renamed',key,old);}
      }
    },
    async readBinary(p){const real=this.getRealPath(p);io.push(['direct-read',real]);return physical.get(real).content;},
    async writeBinary(p,bytes){const real=this.getRealPath(p);physical.set(real,{type:'file',content:bytes,mtime:++clock});await this.reconcileFile(real,hostKey(p));},
    async remove(p){const real=this.getRealPath(p);for(const path of [...physical.keys()].filter(k=>k===real||k.startsWith(real+'/')))physical.delete(path);for(const key of Object.keys(this.files).filter(k=>k===p||k.startsWith(p+'/')))this.removeFile(key);},
  };
  vault.adapter=adapter;
  if(mobile)delete adapter.reconcileFileInternal;
  else {delete adapter.watchAndList;delete adapter.quickList;delete adapter.reconcileFileChanged;}
  const app={vault,metadataCache,workspace:{layoutReady:false,onLayoutReady(callback){callbacks.push(callback);}}};
  const layout=()=>{app.workspace.layoutReady=true;for(const callback of callbacks)callback();};
  const openEditor=file=>{
    const equal=(a,b)=>a?.length===b?.length&&a.every((value,index)=>value===b[index]);
    const original=physical.get(adapter.getRealPath(file.path)).content;
    const view={file,buffer:original,lastSavedData:original,pending:[],conflicts:[],refreshes:[],dirty:false,saving:false,
      setValue(bytes){this.buffer=bytes;this.dirty=true;},
      onModify(changed){if(!this.saving&&changed===this.file)this.pending.push(this.loadFileInternal(changed));},
      async loadFileInternal(changed){const data=changed.saving?await vault.cachedRead(changed):await vault.readBinary(changed);const previous=this.lastSavedData;this.lastSavedData=data;this.refreshes.push({file:changed,data});if(equal(previous,data))return;if(this.dirty){if(equal(this.buffer,data))return;if(!equal(this.buffer,previous)){this.conflicts.push({base:previous,local:this.buffer,remote:data});return;}}this.buffer=data;},
      // Conflict recording models the native merge branch; the actual e2 merge
      // algorithm/editor UI remains an independent native QA seam.
      async autosave(){if(this.file&&!this.file.deleted){this.saving=true;try{await vault.modifyBinary(this.file,this.buffer);this.lastSavedData=this.buffer;this.dirty=false;}finally{this.saving=false;}}},
      async drain(){await Promise.all(this.pending);this.pending.length=0;},
    };
    vault.on('modify',changed=>view.onModify(changed));vault.on('delete',removed=>{if(removed===view.file)view.file=null;});return view;
  };
  const host={app,adapter,physical,io,events,vaultEvents,metadata,metadataCache,explorer,lookup,layout,openEditor,get indexed(){return new Map(Object.entries(vault.fileMap).filter(([key])=>key!=='/'));}};
  attachLinkManager(host);return host;
}
