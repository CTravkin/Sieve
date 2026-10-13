import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
const run = path.join(root, 'Local/.temp/SieveProbe', stamp);
await mkdir(path.dirname(run), { recursive: true });
await mkdir(run); // Never overwrite an existing fixture or profile.
const count = Number(process.argv[2] ?? 2000);
if (!Number.isSafeInteger(count) || count < 1 || count > 100000) throw new Error('File count must be an integer between 1 and 100000');
const documentFiles = {};
for (let index = 0; index < 100; index++) documentFiles[`Docs/note-${index}.md`] = `# Note ${index}\n\n[[note-0]]\n`;
for (let index = 0; index < count; index++) documentFiles[`Technical/group-${Math.floor(index / 100)}/hidden-${index}.md`] = `# Hidden ${index}\n`;
documentFiles['Technical/deep/keep.md'] = '# Allowed descendant\n';
documentFiles['Board.canvas'] = '{"nodes":[],"edges":[]}\n';
documentFiles['Table.base'] = 'views:\n  - type: table\n    name: Notes\n';
documentFiles['Attachments/sample.svg'] = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="blue"/></svg>\n';
const inventory = Object.fromEntries(Object.entries(documentFiles).map(([file, content]) => [file, createHash('sha256').update(content).digest('hex')]));
const variants = [
  { name: 'Baseline', filtered: false, included: [] },
  { name: 'Filtered', filtered: true, included: [] },
  { name: 'Descendant', filtered: true, included: ['Technical/deep/keep.md'] },
  { name: 'SieveFirst', filtered: true, included: [], sentinelOrder: 'after' },
  { name: 'SieveLast', filtered: true, included: [], sentinelOrder: 'before' },
  { name: 'Alternate', filtered: true, included: [], configDir: '.sieve-config' },
];
const vaults = [];
for (const variant of variants) {
  const vault = path.join(run, variant.name);
  const configDir = variant.configDir ?? '.obsidian';
  const plugin = path.join(vault, configDir, 'plugins/sieve');
  await mkdir(plugin, { recursive: true });
  for (const [file, content] of Object.entries(documentFiles)) {
    const target = path.join(vault, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, { flag: 'wx' });
  }
  for (const file of ['main.js', 'manifest.json', 'identity.json']) await writeFile(path.join(plugin, file), await readFile(path.join(root, 'dist/sieve-probe', file)), { flag: 'wx' });
  await writeFile(path.join(plugin, 'data.json'), JSON.stringify({ probeFixture: true, filtered: variant.filtered, excluded: ['Technical', configDir], included: variant.included, prepareDelayMs: 100 }));
  const plugins = ['sieve'];
  if (variant.sentinelOrder) {
    const sentinel = path.join(vault, configDir, 'plugins/sieve-order-sentinel');
    await mkdir(sentinel);
    await writeFile(path.join(sentinel, 'manifest.json'), JSON.stringify({ id:'sieve-order-sentinel', name:'Sieve order sentinel', version:'0.0.1', minAppVersion:'1.14.4', description:'Disposable startup observer', author:'Sieve', isDesktopOnly:true }));
    await writeFile(path.join(sentinel, 'data.json'), '{"probeFixture":true}');
    await writeFile(path.join(sentinel, 'main.js'), "const {Plugin}=require('obsidian');module.exports=class extends Plugin{async onload(){if((await this.loadData())?.probeFixture!==true)return;(globalThis.sieveProbeOrder??=[]).push({plugin:'sentinel',method:'onload',at:performance.now()});}};");
    if (variant.sentinelOrder === 'before') plugins.unshift('sieve-order-sentinel');
    else plugins.push('sieve-order-sentinel');
  }
  await writeFile(path.join(vault, configDir, 'community-plugins.json'), JSON.stringify(plugins));
  await writeFile(path.join(vault, configDir, 'app.json'), '{"showReleaseNotes":false}');
  const profile = path.join(run, 'Profiles', variant.name);
  await mkdir(profile, { recursive: true });
  await writeFile(path.join(profile, 'obsidian.json'), JSON.stringify({ vaults: { '0000000000000001': { path: vault, ts: Date.now(), open: true } }, updateDisabled: true }));
  vaults.push({ ...variant, vault, profile });
}
await writeFile(path.join(run, 'inventory.json'), JSON.stringify(inventory, null, 2) + '\n');
await writeFile(path.join(run, 'run.json'), JSON.stringify({ vaults, documentCount: Object.keys(inventory).length }, null, 2) + '\n');
console.log(JSON.stringify({ run, vaults, documentCount: Object.keys(inventory).length }, null, 2));
