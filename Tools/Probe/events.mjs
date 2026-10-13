import { writeFile } from 'node:fs/promises';
import { connectNative } from './native-client.mjs';

const output = process.argv[2];
if (!output) throw new Error('A new event report path is required');
const client = await connectNative(Number(process.argv[3] ?? 9229));
try {
  const result = await client.evaluate(`
    if (!globalThis.sieveProbe || sieveProbe.hooks.status !== 'ready' || !sieveProbe.options.filtered) throw new Error('A filtered diagnostic fixture is required');
    const results = [];
    const assert = (ok, message) => { if (!ok) throw new Error(message); };
    const settle = async (condition) => {
      const limit = Date.now() + 5000;
      while (!condition()) { if (Date.now() > limit) throw new Error('File event timeout'); await new Promise(resolve => setTimeout(resolve, 50)); }
    };
    const check = async (name, action) => {
      try { await action(); results.push({name, status:'PASS'}); }
      catch (error) { results.push({name, status:'FAIL', error:String(error)}); }
    };
    const exists = file => !!app.vault.getAbstractFileByPath(file);
    const fs = require('fs').promises;
    const base = app.vault.adapter.basePath;
    const diskPath = file => base + '/' + file;
    const owned = ['Docs/sieve-event.md','Docs/sieve-event-renamed.md','Docs/sieve-event-recovered.md','Technical/sieve-event.md','Technical/sieve-watch.md','Attachments/sieve-event.svg','Docs/sieve-event-folder/child.md','Technical/sieve-event-folder/child.md'];
    const folders = ['Docs/sieve-event-folder','Technical/sieve-event-folder'];
    for (const file of [...owned, ...folders]) assert(!(await app.vault.adapter.exists(file)), 'Event path already exists: ' + file);
    await check('host-create', async () => {
      await app.vault.create(owned[0], '# Created\\n');
      await settle(() => exists(owned[0]));
      assert(await app.vault.adapter.read(owned[0]) === '# Created\\n', 'Created content mismatch');
    });
    await check('host-save', async () => {
      await app.vault.modify(app.vault.getAbstractFileByPath(owned[0]), '# Saved\\n');
      assert(await app.vault.adapter.read(owned[0]) === '# Saved\\n', 'Saved content mismatch');
    });
    await check('host-rename-visible', async () => {
      await app.fileManager.renameFile(app.vault.getAbstractFileByPath(owned[0]), owned[1]);
      await settle(() => exists(owned[1]) && !exists(owned[0]));
      assert(await app.vault.adapter.read(owned[1]) === '# Saved\\n', 'Rename lost content');
    });
    await check('host-move-into-excluded', async () => {
      const retained = app.vault.getAbstractFileByPath(owned[1]);
      await app.fileManager.renameFile(retained, owned[3]);
      await settle(() => !exists(owned[1]) && !exists(owned[3]));
      assert(await app.vault.adapter.read(owned[3]) === '# Saved\\n', 'Move lost content');
      assert(retained.path === owned[3], 'Retained file path was not updated');
      await app.vault.modify(retained, '# Retained save\\n');
      assert(await app.vault.adapter.read(owned[3]) === '# Retained save\\n', 'Retained file save lost content');
      assert(!(await app.vault.adapter.exists(owned[1])), 'Retained file save recreated the old path');
      await app.vault.modify(retained, '# Saved\\n');
    });
    await check('external-move-back', async () => {
      const source = await app.vault.adapter.exists(owned[3]) ? owned[3] : owned[1];
      await fs.rename(diskPath(source), diskPath(owned[2]));
      await settle(() => exists(owned[2]) && !exists(source));
      assert(await app.vault.adapter.read(owned[2]) === '# Saved\\n', 'External move lost content');
    });
    await check('external-edit-visible', async () => {
      await fs.writeFile(diskPath(owned[2]), '# External\\n');
      await settle(() => app.vault.getAbstractFileByPath(owned[2])?.stat.size === 11);
      assert(await app.vault.read(app.vault.getAbstractFileByPath(owned[2])) === '# External\\n', 'External edit mismatch');
    });
    await check('external-create-excluded', async () => {
      const eventStart = sieveProbe.events.length;
      await fs.writeFile(diskPath(owned[4]), '# Hidden\\n', {flag:'wx'});
      await settle(() => sieveProbe.events.slice(eventStart).some(event => event.kind === 'skip' && event.path === owned[4]));
      assert(!exists(owned[4]), 'Excluded external file entered index');
      assert(!sieveProbe.events.slice(eventStart).some(event => event.kind === 'io' && event.path === owned[4]), 'Scanner touched excluded file');
    });
    await check('attachment-create-open-delete', async () => {
      const text = '<svg xmlns="http://www.w3.org/2000/svg"/>';
      const bytes = new TextEncoder().encode(text).buffer;
      const file = await app.vault.createBinary(owned[5], bytes);
      assert(new TextDecoder().decode(await app.vault.readBinary(file)) === text, 'Attachment read mismatch');
      await app.vault.delete(file, true);
      await settle(() => !exists(owned[5]));
      assert(!(await app.vault.adapter.exists(owned[5])), 'Attachment remains on disk');
    });
    await check('host-folder-move-into-excluded', async () => {
      await app.vault.createFolder(folders[0]);
      const child = await app.vault.create(owned[6], '# Child\\n');
      await app.fileManager.renameFile(app.vault.getAbstractFileByPath(folders[0]), folders[1]);
      await settle(() => [...folders, owned[6], owned[7]].every(file => !exists(file)));
      assert(await app.vault.adapter.read(owned[7]) === '# Child\\n', 'Folder move lost child');
      assert(child.path === owned[7], 'Folder move did not update retained child path');
      await app.vault.modify(child, '# Saved child\\n');
      assert(await app.vault.adapter.read(owned[7]) === '# Saved child\\n', 'Retained child save failed');
      assert(!(await app.vault.adapter.exists(folders[0])), 'Folder move recreated the old folder');
    });
    for (const file of owned) {
      if (await app.vault.adapter.exists(file)) await fs.unlink(diskPath(file));
    }
    for (const folder of folders) {
      if (await app.vault.adapter.exists(folder)) await fs.rmdir(diskPath(folder));
    }
    await check('event-files-cleanup', async () => { await settle(() => [...owned, ...folders].every(file => !exists(file))); });
    return {results, report:sieveProbe.report()};
  `, { timeout: 60000 });
  await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(result.results, null, 2));
  if (result.results.some((item) => item.status !== 'PASS')) process.exitCode = 1;
} finally { client.close(); }
