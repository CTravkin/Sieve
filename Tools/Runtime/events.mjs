import { writeFile } from 'node:fs/promises';
import { connectNative } from '../Probe/native-client.mjs';

const output = process.argv[2];
if (!output) throw new Error('A new runtime event report is required');
const client = await connectNative(Number(process.argv[3] ?? 9229));
try {
  const report = await client.evaluate(`
    if(!vaultPath.includes('/SieveProbe/Runtime-')||!profile.includes('/SieveProbe/Runtime-'))throw new Error('Actual-runtime fixture required');
    const plugin=app.plugins.plugins.sieve;
    if(plugin?.getStatus?.().status!=='applied'||plugin.activeSettings?.rules!=='Technical')throw new Error('Applied Technical exclusion required');
    const fs=require('fs').promises,base=app.vault.adapter.basePath,nl=String.fromCharCode(10);
    const exists=p=>!!app.vault.getAbstractFileByPath(p);
    const disk=p=>base+'/'+p;
    const results=[];
    const assert=(value,message)=>{if(!value)throw new Error(message);};
    const settle=async predicate=>{const end=Date.now()+5000;while(!(await predicate())){if(Date.now()>end)throw new Error('Runtime event timeout');await new Promise(resolve=>setTimeout(resolve,40));}};
    const check=async(name,action)=>{try{const details=await action();results.push({name,status:'PASS',details});}catch(error){results.push({name,status:'FAIL',error:String(error)});}};
    const owned=['Docs/sieve-runtime.md','Docs/sieve-runtime-renamed.md','Docs/sieve-runtime-recovered.md','Technical/sieve-runtime.md','Technical/sieve-runtime-watch.md','Attachments/sieve-runtime.svg','Docs/sieve-runtime-dirty.md','Technical/sieve-runtime-dirty.md','Docs/sieve-runtime-recovered.md.replace'];
    const folders=['Docs/sieve-runtime-folder','Technical/sieve-runtime-folder','Docs/sieve-runtime-names','Technical/sieve-runtime-names'];
    const repeated=['Docs/sieve-runtime-cycle.md','Technical/sieve-runtime-cycle.md','Technical/sieve-runtime-cycle-next.md','Docs/sieve-runtime-cycle-returned.md'];
    const control=['Docs/sieve-runtime-editor-control.md','Docs/sieve-runtime-editor-control-renamed.md'];
    const deletion=['Docs/sieve-runtime-editor-delete.md','Technical/sieve-runtime-editor-delete.md'];
    owned.push(...repeated,...control,...deletion);
    for(const p of [...owned,...folders])assert(!(await app.vault.adapter.exists(p)),'Existing event path: '+p);
    await check('create-save-visible',async()=>{
      const file=await app.vault.create(owned[0],'# Created'+nl);assert(file,'Create returned no indexed file');
      await app.vault.modify(file,'# Saved'+nl);assert(await app.vault.adapter.read(owned[0])==='# Saved'+nl,'Save mismatch');
    });
    await check('rename-visible',async()=>{
      await app.fileManager.renameFile(app.vault.getAbstractFileByPath(owned[0]),owned[1]);
      await settle(()=>exists(owned[1])&&!exists(owned[0]));
    });
    await check('move-hidden-retained-save',async()=>{
      const file=app.vault.getAbstractFileByPath(owned[1]);await app.fileManager.renameFile(file,owned[3]);
      await settle(()=>!exists(owned[1])&&!exists(owned[3]));assert(file.path===owned[3],'Held path stale');
      await app.vault.modify(file,'# Retained'+nl);assert(await app.vault.adapter.read(owned[3])==='# Retained'+nl,'Held save lost');assert(!(await app.vault.adapter.exists(owned[1])),'Old path recreated');
    });
    await check('external-move-edit-atomic',async()=>{
      await fs.rename(disk(owned[3]),disk(owned[2]));await settle(()=>exists(owned[2]));
      await fs.writeFile(disk(owned[2]),'# External'+nl);await settle(()=>app.vault.getAbstractFileByPath(owned[2])?.stat.size===11);
      const temporary=owned[2]+'.replace';assert(!(await app.vault.adapter.exists(temporary)),'Atomic temporary path exists');
      await fs.writeFile(disk(temporary),'# Replaced'+nl,{flag:'wx'});await fs.rename(disk(temporary),disk(owned[2]));
      await settle(async()=>await app.vault.read(app.vault.getAbstractFileByPath(owned[2]))==='# Replaced'+nl);
    });
    await check('external-create-hidden',async()=>{
      await fs.writeFile(disk(owned[4]),'# Hidden'+nl,{flag:'wx'});await new Promise(resolve=>setTimeout(resolve,500));
      assert(!exists(owned[4]),'Hidden external file entered index');assert(!app.metadataCache.getCachedFiles().includes(owned[4]),'Hidden metadata entered cache');
    });
    await check('attachment-native-read-delete',async()=>{
      const text='<svg xmlns="http://www.w3.org/2000/svg"/>';
      const file=await app.vault.createBinary(owned[5],new TextEncoder().encode(text).buffer);
      assert(new TextDecoder().decode(await app.vault.readBinary(file))===text,'Attachment read mismatch');
      await app.vault.delete(file,true);await settle(()=>!exists(owned[5]));assert(!(await app.vault.adapter.exists(owned[5])),'Attachment delete failed');
    });
    await check('folder-move-retained-child-save',async()=>{
      await app.vault.createFolder(folders[0]);const child=await app.vault.create(folders[0]+'/child.md','# Child'+nl);
      await app.fileManager.renameFile(app.vault.getAbstractFileByPath(folders[0]),folders[1]);
      await settle(()=>!exists(folders[1])&&!exists(folders[1]+'/child.md'));assert(child.path===folders[1]+'/child.md','Child path stale');
      await app.vault.modify(child,'# Saved child'+nl);assert(await app.vault.adapter.read(child.path)==='# Saved child'+nl,'Child save lost');
    });
    await check('native-nbsp-nfd-resolver-save',async()=>{
      await app.vault.createFolder(folders[2]);const raw='Cafe'+String.fromCharCode(0x301,0xA0)+'note.md';const key=raw.replace(/[\\u00A0\\u202F]/g,' ').normalize('NFC');
      await fs.writeFile(disk(folders[2]+'/'+raw),'# Names'+nl,{flag:'wx'});await settle(()=>exists(folders[2]+'/'+key));
      const child=app.vault.getAbstractFileByPath(folders[2]+'/'+key);
      await app.fileManager.renameFile(app.vault.getAbstractFileByPath(folders[2]),folders[3]);
      await settle(()=>!exists(folders[3]+'/'+key));await app.vault.modify(child,'# Unicode save'+nl);
      assert(await fs.readFile(disk(folders[3]+'/'+raw),'utf8')==='# Unicode save'+nl,'Physical Unicode name save failed');
      let sibling=false;try{await fs.access(disk(folders[3]+'/'+key));sibling=true;}catch{}
      assert(!sibling,'Normalized sibling was created');return{raw,key,heldPath:child.path};
    });
    await check('retained-hidden-hidden-visible-rename-save',async()=>{
      const file=await app.vault.create(repeated[0],'# Cycle initial'+nl);
      for(const destination of repeated.slice(1)){
        await app.fileManager.renameFile(file,destination);
        await settle(()=>file.path===destination);
        assert(file.deleted!==true,'Physical existing file marked deleted');
      }
      await settle(()=>app.vault.getAbstractFileByPath(repeated[3])===file);
      await app.vault.modify(file,'# Cycle saved'+nl);
      assert(await fs.readFile(disk(repeated[3]),'utf8')==='# Cycle saved'+nl,'Returned path save failed');
      return{heldPath:file.path,identityPreserved:true};
    });
    await check('dirty-editor-visible-positive-control',async()=>{
      const initial='# Control initial'+nl,changed='# Control unsaved'+nl;
      const file=await app.vault.create(control[0],initial);const leaf=app.workspace.getLeaf(true);
      await leaf.openFile(file,{active:true,state:{mode:'source'}});const view=leaf.view;
      const sawCodeMirror=!!view.containerEl.querySelector('.cm-editor');
      assert(view.editor&&view.file===file&&sawCodeMirror,'Native source editor missing');
      view.editor.setValue(changed);assert(await fs.readFile(disk(control[0]),'utf8')===initial,'Control was not dirty');
      await app.fileManager.renameFile(file,control[1]);
      await settle(async()=>await fs.readFile(disk(control[1]),'utf8')===changed);
      assert(view.file===file&&file.path===control[1],'Visible editor identity changed');
      leaf.detach();return{nativeEditor:true,sawCodeMirror,actual:changed};
    });
    await check('actual-markdown-editor-dirty-rename',async()=>{
      const initial='# Editor initial'+nl,changed='# Editor unsaved'+nl;
      const file=await app.vault.create(owned[6],initial);
      const leaf=app.workspace.getLeaf(true);await leaf.openFile(file,{active:true,state:{mode:'source'}});
      const view=leaf.view;assert(view.editor&&view.file===file,'Native Markdown editor missing');
      const sawCodeMirrorBefore=!!view.containerEl.querySelector('.cm-editor');
      assert(sawCodeMirrorBefore,'Native source editor DOM missing');
      view.editor.setValue(changed);assert(view.editor.getValue()===changed,'Native editor buffer unchanged');
      const before=await fs.readFile(disk(owned[6]),'utf8');assert(before===initial,'Dirty scenario already saved before rename');
      await app.fileManager.renameFile(file,owned[7]);await settle(()=>!exists(owned[7]));
      const deadline=Date.now()+5000;let actual=await fs.readFile(disk(owned[7]),'utf8');
      while(actual!==changed&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,80));actual=await fs.readFile(disk(owned[7]),'utf8');}
      const details={nativeEditor:true,sawCodeMirrorBefore,before,actual,expected:changed,fileDeleted:file.deleted,heldPath:file.path,viewPath:view.file?.path??null,indexAbsent:!exists(owned[7])};
      if(actual!==changed){results.push({name:'dirty-editor-state',status:'INFO',details});throw new Error('Unsaved native editor data did not reach renamed physical file');}
      assert(!(await app.vault.adapter.exists(owned[6])),'Dirty editor save recreated old path');
      leaf.detach();return details;
    });
    await check('real-delete-hidden-open-file',async()=>{
      const file=await app.vault.create(deletion[0],'# Delete initial'+nl);const leaf=app.workspace.getLeaf(true);
      await leaf.openFile(file,{active:true,state:{mode:'source'}});const view=leaf.view;
      await app.fileManager.renameFile(file,deletion[1]);assert(view.file===file,'Projection already closed open editor');
      view.editor.setValue('# Delete pending'+nl);await app.vault.delete(file,true);
      await settle(()=>file.deleted===true&&view.file!==file);
      await new Promise(resolve=>setTimeout(resolve,1200));assert(!(await app.vault.adapter.exists(deletion[1])),'Deleted file recreated by pending autosave');
      leaf.detach();return{closedOnPhysicalDelete:true};
    });
    // Delete only explicitly generated event files; retain the reports, not a
    // changed document tree. The fixture inventory itself is never rewritten.
    for(const p of owned){try{await fs.unlink(disk(p));}catch(error){if(error.code!=='ENOENT')throw error;}}
    for(const folder of folders){try{for(const entry of await fs.readdir(disk(folder),{withFileTypes:true})){assert(entry.isFile(),'Unexpected nested event content');await fs.unlink(disk(folder+'/'+entry.name));}await fs.rmdir(disk(folder));}catch(error){if(error.code!=='ENOENT')throw error;}}
    await check('event-files-cleanup',async()=>{await settle(()=>[...owned,...folders].every(p=>!exists(p)));});
    return{runtimeFixture:true,results,pluginStatus:plugin.getStatus(),index:app.vault.getAllLoadedFiles().map(file=>file.path).sort(),metadata:app.metadataCache.getCachedFiles().sort()};
  `,{timeout:60000});
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(report.results,null,2));
  if(report.results.some(result=>result.status==='FAIL'))process.exitCode=1;
} finally { client.close(); }
