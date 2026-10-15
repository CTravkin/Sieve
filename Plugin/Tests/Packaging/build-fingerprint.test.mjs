// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,copyFile,symlink} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createTestDirectory} from '../../scripts/test-temporary.mjs';

const repository=fileURLToPath(new URL('../../',import.meta.url));
const metadata={version:'0.1.0',sieveBuild:1,devDependencies:{esbuild:'0.28.2',typescript:'7.0.2',obsidian:'1.14.4'}};
const quoteJson=value=>JSON.stringify(value,null,2)+'\n';
async function fixture(t){
  const owned=await createTestDirectory('package-fingerprint-');
  t.after(()=>owned.cleanup());
  const root=owned.path;
  for(const directory of ['Plugin/scripts','Docs/Licenses','Plugin/src/core'])await mkdir(path.join(root,directory),{recursive:true});
  await copyFile(path.join(repository,'scripts/build-plugin.mjs'),path.join(root,'Plugin/scripts/build-plugin.mjs'));
  await copyFile(path.join(repository,'scripts/layout.mjs'),path.join(root,'Plugin/scripts/layout.mjs'));
  // Asset validation is covered by the repository suite. This fixture isolates
  // the unchanged production builder and its source/package revision boundary.
  const files={
    'Plugin/scripts/check-project.mjs':'export async function checkProject(){return {}; }\n',
    'Plugin/package.json':quoteJson(metadata),'manifest.json':quoteJson({id:'sieve',version:'0.1.0'}),
    'Plugin/src/main.ts':'export const value=1;\n','Plugin/src/core/value.ts':'export const covered=1;\n',
    'README.md':'# Owned installation fixture\n', 'LICENSE':'Owned project license fixture\n',
    'Docs/THIRD-PARTY-NOTICES.md':'Owned notices fixture Licenses/fixture.txt\n',
    'Docs/Licenses/fixture.txt':'Owned license fixture\n',
    'Plugin/tsconfig.json':quoteJson({compilerOptions:{target:'ES2020'}}),
  };
  for(const [name,bytes] of Object.entries(files))await writeFile(path.join(root,name),bytes);
  // Fixtures live outside the checkout: bind installed build dependencies and
  // give the unchanged builder its own source identity instead of inheriting Git.
  await symlink(path.join(repository,'node_modules'),path.join(root,'Plugin/node_modules'),'junction');
  await writeFile(path.join(root,'.gitignore'),'Builds/\nnode_modules/\n');
  await mkdir(path.join(root,'hooks'));
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  git(['init','-q']);
  git(['add','.gitignore','Plugin','Docs','manifest.json','README.md','LICENSE']);
  git(['-c','commit.gpgsign=false','-c',`core.hooksPath=${path.join(root,'hooks')}`,'-c','user.name=Sieve Build Test','-c','user.email=sieve-test@example.invalid','commit','-qm','Owned build fixture']);
  return root;
}
function build(root){return execFileSync(process.execPath,[path.join(root,'Plugin/scripts/build-plugin.mjs')],{cwd:path.join(root,'Plugin'),encoding:'utf8',timeout:15000,stdio:['ignore','pipe','pipe']});}
const identity=root=>readFile(path.join(root,'Builds/sieve/identity.json'),'utf8').then(JSON.parse);
const hashFiles=async root=>Object.fromEntries(await Promise.all(['main.js','manifest.json','README.md','identity.json'].map(async name=>[name,await readFile(path.join(root,'Builds/sieve',name),'utf8')])));

test('unchanged source rebuild retains build, fingerprint, README and bundled notices',async t=>{
  const root=await fixture(t);build(root);const before=await identity(root);build(root);const after=await identity(root);
  assert.equal(after.build,1);assert.equal(after.sourceFingerprint,before.sourceFingerprint);assert.deepEqual(after.files,before.files);
  assert.equal(await readFile(path.join(root,'Builds/sieve/README.md'),'utf8'),await readFile(path.join(root,'README.md'),'utf8'));
  assert.match(await readFile(path.join(root,'Builds/sieve/main.js'),'utf8'),/Owned license fixture/);
  assert.equal(after.pluginId,'sieve');
});
for(const name of ['README.md','LICENSE','Docs/THIRD-PARTY-NOTICES.md','Docs/Licenses/fixture.txt','Plugin/tsconfig.json','Plugin/scripts/layout.mjs'])test(`changed imported ${name} requires a new version before overwriting a package`,async t=>{
  const root=await fixture(t);build(root);const before=await identity(root),bytes=await hashFiles(root);
  if(name.endsWith('.json'))await writeFile(path.join(root,name),quoteJson({compilerOptions:{target:'ES2020',useDefineForClassFields:true}}));
  else await writeFile(path.join(root,name),(await readFile(path.join(root,name),'utf8'))+(name.endsWith('.mjs')?'// Changed owned fixture\n':'Changed owned fixture\n'));
  assert.throws(()=>build(root),error=>String(error.stderr).includes('Changed runtime source requires a new development version and build number'));
  assert.deepEqual(await hashFiles(root),bytes,'Rejected build must preserve all previous package files');
  await writeFile(path.join(root,'Plugin/package.json'),quoteJson({...metadata,version:'0.1.1',sieveBuild:2}));
  await writeFile(path.join(root,'manifest.json'),quoteJson({id:'sieve',version:'0.1.1'}));
  build(root);const after=await identity(root);assert.equal(after.build,2);assert.notEqual(after.sourceFingerprint,before.sourceFingerprint);
});
