import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Script } from 'node:vm';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const count = Number(process.argv[2] ?? 1000);
if (!Number.isSafeInteger(count) || count < 1 || count > 100000) throw new Error('Invalid synthetic file count');
const artifact = path.join(repository, 'dist/sieve');
const identity = JSON.parse(await readFile(path.join(artifact, 'identity.json'), 'utf8'));
if (!identity.privateCandidate) throw new Error('Build the actual Sieve runtime first');
const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
const run = path.join(repository, 'Local/.temp/SieveProbe', `Runtime-${stamp}`);
const documents = {};
for (let i = 0; i < 100; i++) documents[`Docs/note-${i}.md`] = `# Note ${i}\n\n[[note-0]]\n`;
for (let i = 0; i < count; i++) documents[`Technical/group-${Math.floor(i / 100)}/hidden-${i}.md`] = `# Hidden ${i}\n`;
documents['Technical/deep/keep.md'] = '# Allowed descendant\n';
documents['Board.canvas'] = '{"nodes":[],"edges":[]}\n';
documents['Table.base'] = 'views:\n  - type: table\n    name: Notes\n';
documents['Attachments/sample.svg'] = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="blue"/></svg>\n';
const inventory = Object.fromEntries(Object.entries(documents).map(([name, contents]) => [name, createHash('sha256').update(contents).digest('hex')]));

// Instrumentation belongs only to generated test vaults. It does not ship in
// the candidate and never patches a shared filesystem module or prototype.
const observerSource = String.raw`
const {Plugin,apiVersion,Menu,FuzzySuggestModal}=require('obsidian');
module.exports=class extends Plugin {
  async onload() {
    if((await this.loadData())?.fixtureOnly!==true)return;
    const adapter=this.app.vault.adapter;
    const base=adapter.basePath.replaceAll('\\','/').replace(/\/$/,'');
    const profile=require('@electron/remote').app.getPath('userData').replaceAll('\\','/');
    if(!base.includes('/Local/.temp/SieveProbe/Runtime-')||!profile.includes('/Local/.temp/SieveProbe/Runtime-'))throw new Error('Observer requires generated runtime fixture');
    let active=true,phase='prepare';const events=[];let dropped=0;
    const record=e=>{if(active){if(events.length<100000)events.push({...e,at:performance.now(),phase});else dropped++;}};
    record({kind:'lifecycle',method:'observer-onload'});
    const originalFs=adapter.fsPromises,fs=Object.create(originalFs);
    for(const name of ['readFile','readdir','lstat','stat','realpath'])if(typeof originalFs[name]==='function')Object.defineProperty(fs,name,{value:function(...args){const full=String(args[0]).replaceAll('\\','/');record({kind:'io',method:name,path:full.startsWith(base+'/')?full.slice(base.length+1):full===base?'':'<outside-vault>'});return originalFs[name].apply(originalFs,args);},configurable:true,writable:true});
    adapter.fsPromises=fs;
    const vault=this.app.vault,originalLoad=vault.load,loadDescriptor=Object.getOwnPropertyDescriptor(vault,'load');
    const wrapper=function(...args){phase='scan';const start=performance.now();record({kind:'lifecycle',method:'vault-load-start'});const result=originalLoad.apply(this,args);if(result?.then)result.then(()=>{record({kind:'lifecycle',method:'vault-load-end',durationMs:performance.now()-start});phase='after-load';},()=>record({kind:'lifecycle',method:'vault-load-error'}));return result;};
    vault.load=wrapper;
    this.app.workspace.onLayoutReady(()=>{record({kind:'lifecycle',method:'layout-ready'});phase='layout';});
    this.sdk={Menu,FuzzySuggestModal};
    this.report=()=>({fixtureOnly:true,apiVersion,events:[...events],dropped,base,profile});
    this.register(()=>{active=false;if(adapter.fsPromises===fs)adapter.fsPromises=originalFs;if(vault.load===wrapper){if(loadDescriptor)Object.defineProperty(vault,'load',loadDescriptor);else delete vault.load;}});
  }
};
`;
new Script(observerSource, { filename: 'sieve-fixture-observer/main.js' });
await mkdir(path.dirname(run), { recursive: true });
await mkdir(run);
await mkdir(path.join(run, 'Reports'));
const variants = [
  { name: 'Baseline', rules: '', observerOrder: 'before' },
  { name: 'Filtered', rules: 'Technical', observerOrder: 'before' },
  { name: 'Descendant', rules: '!/Technical/deep/keep.md\nTechnical', observerOrder: 'before' },
  { name: 'SieveFirst', rules: 'Technical', observerOrder: 'after' },
  { name: 'SieveLast', rules: 'Technical', observerOrder: 'before' },
  { name: 'Alternate', rules: 'Technical\n.sieve-config', observerOrder: 'before', configDir: '.sieve-config' },
];
const vaults = [];
for (const variant of variants) {
  const vault = path.join(run, variant.name);
  const configDir = variant.configDir ?? '.obsidian';
  const plugin = path.join(vault, configDir, 'plugins/sieve');
  await mkdir(plugin, { recursive: true });
  // Install the same main.js that the private candidate supplies.
  for (const name of ['main.js', 'manifest.json', 'identity.json']) await writeFile(path.join(plugin, name), await readFile(path.join(artifact, name)), { flag: 'wx' });
  if ((await readdir(artifact)).includes('styles.css')) await writeFile(path.join(plugin, 'styles.css'), await readFile(path.join(artifact, 'styles.css')), { flag: 'wx' });
  for (const [name, contents] of Object.entries(documents)) {
    await mkdir(path.dirname(path.join(vault, name)), { recursive: true });
    await writeFile(path.join(vault, name), contents, { flag: 'wx' });
  }
  await writeFile(path.join(plugin, 'data.json'), JSON.stringify({ schemaVersion: 1, rules: variant.rules, displayName: '' }, null, 2) + '\n', { flag: 'wx' });
  const observer = path.join(vault, configDir, 'plugins/sieve-fixture-observer');
  await mkdir(observer);
  await writeFile(path.join(observer, 'manifest.json'), JSON.stringify({ id:'sieve-fixture-observer', name:'Sieve fixture observer', version:'0.0.1', minAppVersion:'1.14.4', description:'Owned synthetic runtime observation', author:'Sieve', isDesktopOnly:true }), { flag:'wx' });
  await writeFile(path.join(observer, 'main.js'), observerSource, { flag:'wx' });
  await writeFile(path.join(observer, 'data.json'), '{"fixtureOnly":true}', { flag:'wx' });
  const plugins = variant.observerOrder === 'before' ? ['sieve-fixture-observer','sieve'] : ['sieve','sieve-fixture-observer'];
  await writeFile(path.join(vault, configDir, 'community-plugins.json'), JSON.stringify(plugins), { flag:'wx' });
  await writeFile(path.join(vault, configDir, 'app.json'), '{"showReleaseNotes":false}', { flag:'wx' });
  const profile = path.join(run, 'Profiles', variant.name);
  await mkdir(profile, { recursive:true });
  await writeFile(path.join(profile, 'obsidian.json'), JSON.stringify({vaults:{'0000000000000001':{path:vault,ts:Date.now(),open:true}},updateDisabled:true}), {flag:'wx'});
  vaults.push({...variant,vault,profile});
}
await writeFile(path.join(run, 'inventory.json'), JSON.stringify(inventory, null, 2) + '\n', {flag:'wx'});
await writeFile(path.join(run, 'run.json'), JSON.stringify({runtimeFixture:true,identity,vaults,documentCount:Object.keys(inventory).length}, null, 2) + '\n', {flag:'wx'});
console.log(JSON.stringify({run,documentCount:Object.keys(inventory).length,variants:vaults.length}));
