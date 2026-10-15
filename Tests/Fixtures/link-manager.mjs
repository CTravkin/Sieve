import path from 'node:path';
// Contract model of native FileManager: clean snapshot, rename, native rewrite.
// Native Obsidian scenarios separately verify resolver and syntax fidelity.
export function attachLinkManager(host) {
  const {app,lookup,metadataCache:metadata}=host,vault=app.vault;
  vault.getFileByPath=function(key){const file=this.getAbstractFileByPath(key);return file&&typeof file.cache==='function'?file:null;};
  metadata.uniqueFileLookup.get=name=>[...(lookup.get(name)??[])];
  const refs=[];
  metadata.iterateAllRefs=callback=>{for(const entry of refs)callback(entry.source.path,entry.reference);};
  metadata.getLinkpathDest=function(link,source){
    const candidates=this.uniqueFileLookup.get(path.posix.basename(link.toLowerCase()).replace(/\.md$/,'')+'.md')??[];
    if(link.startsWith('./')||link.startsWith('../')){const wanted=path.posix.normalize(path.posix.join(path.posix.dirname(source),link)).replace(/\.md$/,'');return candidates.filter(f=>f.path.replace(/\.md$/,'')===wanted);}
    const exact=link.replace(/^\//,'').replace(/\.md$/,'');
    return candidates.filter(f=>f.path.replace(/\.md$/,'')===exact||(!link.startsWith('/')&&f.path.replace(/\.md$/,'').endsWith('/'+exact)));
  };
  const updates=[];
  const manager=app.fileManager={inProgressUpdates:null,pending:Promise.resolve(),
    renameFile(file,destination){return this.runAsyncLinkUpdate(()=>vault.rename(file,destination));},
    runAsyncLinkUpdate(callback){
      if(this.inProgressUpdates){this.inProgressUpdates.push(callback);return Promise.resolve();}
      const task=this.pending.then(async()=>{
        await metadata.drain();const snapshot=[];
        metadata.iterateAllRefs((sourcePath,reference)=>{const resolved=this.app.metadataCache.getLinkpathDest(reference.link.split('#')[0],sourcePath);if(resolved.length)snapshot.push({sourceFile:vault.getFileByPath(sourcePath),reference,resolvedFile:resolved[0],resolvedPaths:resolved.map(file=>file.path)});});
        this.inProgressUpdates=[];
        try{await callback(snapshot);while(this.inProgressUpdates.length){const jobs=this.inProgressUpdates;this.inProgressUpdates=[];await Promise.all(jobs.map(job=>job(snapshot)));}}finally{this.inProgressUpdates=null;}
        for(const ref of snapshot)if(ref.resolvedPaths[0]!==ref.resolvedFile.path){updates.push(ref);ref.reference.link=ref.resolvedFile.path.replace(/\.md$/,'')+(ref.reference.link.includes('#')?'#'+ref.reference.link.split('#').slice(1).join('#'):'');}
      });this.pending=task.catch(()=>{});return task;
    },app,
  };
  return {manager,refs,updates,addRef(source,target,extra={}){const reference={link:target,...extra};refs.push({source,reference});return reference;}};
}
