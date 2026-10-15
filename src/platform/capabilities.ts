import type {PrivateAdapter,RuntimeApp} from './contracts.ts';
export function patchable(owner:object,key:string):boolean {const d=Object.getOwnPropertyDescriptor(owner,key);return d?d.configurable===true:Object.isExtensible(owner);}
export function capabilities(app:RuntimeApp,mobile:boolean):{adapter:PrivateAdapter;keys:string[]}|undefined {
  if(!app?.vault?.adapter || typeof app.vault.adapter!=='object' || !app.workspace || typeof app.workspace.onLayoutReady!=='function' || typeof app.vault.load!=='function' || !patchable(app.vault,'load'))return;
  const vault=app.vault;const metadata=app.metadataCache;
  if(!vault.fileMap || typeof vault.fileMap!=='object' || !['onChange','addChild','removeChild','trigger'].every(k=>typeof vault[k]==='function') || !patchable(vault,'trigger') || !metadata || typeof metadata.initialized!=='boolean' || !['onDelete','updateRelatedLinks','deletePath','computeFileMetadataAsync','saveFileCache','queueFileForLinkResolution','trigger'].every(k=>typeof metadata[k]==='function') || !['deletePath','updateRelatedLinks','computeFileMetadataAsync','saveFileCache','queueFileForLinkResolution','trigger'].every(k=>patchable(metadata,k)))return;
  const lookup=metadata.uniqueFileLookup;
  if(!lookup || typeof lookup!=='object' || !['add','remove'].every(k=>typeof (lookup as Record<string,unknown>)[k]==='function' && patchable(lookup,k)))return;
  const adapter=app.vault.adapter as PrivateAdapter;
  const keys=['listRecursiveChild','reconcileFile','listRecursive','trigger','reconcileFolderCreation','reconcileFileCreation','rename',...(mobile?['watchAndList','reconcileFileChanged','quickList']:['listAll','reconcileFileInternal'])];
  const provider=mobile?adapter.fs:adapter.fsPromises;
  if(!adapter.files || typeof adapter.files!=='object' || typeof adapter.basePath!=='string' || !provider || typeof provider.readdir!=='function' || typeof (mobile?provider.stat:provider.lstat)!=='function' || (mobile && typeof provider.watch!=='function') || !['getFullRealPath','getRealPath','removeFile'].every(k=>typeof adapter[k]==='function') || !keys.every(k=>typeof adapter[k]==='function' && patchable(adapter,k)))return;
  return{adapter,keys};
}
