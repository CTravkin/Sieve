import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const repository=fileURLToPath(new URL('../../',import.meta.url));
const metadata={version:'0.1.0',sieveBuild:1,devDependencies:{esbuild:'0.28.2',typescript:'7.0.2',obsidian:'1.14.4'}};
const quoteJson=value=>JSON.stringify(value,null,2)+'\n';
async function fixture(){
  const root=path.join(repository,'Local/.temp/Development/2026-10-14',`package-fingerprint-${randomUUID()}`);
  for(const directory of ['Tools/Oracle/licenses','Docs','src/core'])await mkdir(path.join(root,directory),{recursive:true});
  await copyFile(path.join(repository,'Tools/build-plugin.mjs'),path.join(root,'Tools/build-plugin.mjs'));
  // Asset validation is covered by the repository suite. This fixture isolates
  // the unchanged production builder and its source/package revision boundary.
  const files={
    'Tools/check-project.mjs':'export async function checkProject(){return {}; }\n',
    'package.json':quoteJson(metadata),'manifest.json':quoteJson({id:'sieve',version:'0.1.0'}),
    'src/main.ts':'export const value=1;\n','src/core/value.ts':'export const covered=1;\n',
    'Docs/Private-Package.md':'# Owned installation fixture\n',
    'THIRD-PARTY-NOTICES.md':'Owned notices fixture Tools/Oracle/licenses/fixture.txt\n',
    'Tools/Oracle/licenses/fixture.txt':'Owned license fixture\n',
    'tsconfig.json':quoteJson({compilerOptions:{target:'ES2020'}}),
  };
  for(const [name,bytes] of Object.entries(files))await writeFile(path.join(root,name),bytes);
  return root;
}
function build(root){return execFileSync(process.execPath,[path.join(root,'Tools/build-plugin.mjs')],{cwd:root,encoding:'utf8',timeout:15000,stdio:['ignore','pipe','pipe']});}
const identity=root=>readFile(path.join(root,'dist/sieve/identity.json'),'utf8').then(JSON.parse);
const hashFiles=async root=>Object.fromEntries(await Promise.all(['main.js','manifest.json','INSTALL.md','identity.json'].map(async name=>[name,await readFile(path.join(root,'dist/sieve',name),'utf8')])));

test('unchanged source rebuild retains build, fingerprint and packaged installation text',async()=>{
  const root=await fixture();build(root);const before=await identity(root);build(root);const after=await identity(root);
  assert.equal(after.build,1);assert.equal(after.sourceFingerprint,before.sourceFingerprint);assert.deepEqual(after.files,before.files);
  assert.equal(await readFile(path.join(root,'dist/sieve/INSTALL.md'),'utf8'),await readFile(path.join(root,'Docs/Private-Package.md'),'utf8'));
});
for(const name of ['Docs/Private-Package.md','THIRD-PARTY-NOTICES.md','Tools/Oracle/licenses/fixture.txt','tsconfig.json'])test(`changed imported ${name} requires a new version before overwriting a package`,async()=>{
  const root=await fixture();build(root);const before=await identity(root),bytes=await hashFiles(root);
  if(name.endsWith('.json'))await writeFile(path.join(root,name),quoteJson({compilerOptions:{target:'ES2020',useDefineForClassFields:true}}));
  else await writeFile(path.join(root,name),(await readFile(path.join(root,name),'utf8'))+'Changed owned fixture\n');
  assert.throws(()=>build(root),error=>String(error.stderr).includes('Changed runtime source requires a new development version and build number'));
  assert.deepEqual(await hashFiles(root),bytes,'Rejected build must preserve all previous package files');
  await writeFile(path.join(root,'package.json'),quoteJson({...metadata,version:'0.1.1',sieveBuild:2}));
  await writeFile(path.join(root,'manifest.json'),quoteJson({id:'sieve',version:'0.1.1'}));
  build(root);const after=await identity(root);assert.equal(after.build,2);assert.notEqual(after.sourceFingerprint,before.sourceFingerprint);
});
