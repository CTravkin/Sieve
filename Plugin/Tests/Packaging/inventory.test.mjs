// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,copyFile,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createTestDirectory} from '../../scripts/test-temporary.mjs';

const repository=fileURLToPath(new URL('../../',import.meta.url));
const json=value=>JSON.stringify(value,null,2)+'\n';
const sha=value=>createHash('sha256').update(value).digest('hex');
const windows={skip:process.platform!=='win32'};
async function fixture(t){
  const owned=await createTestDirectory('package-inventory-');
  t.after(()=>owned.cleanup());
  const root=owned.path;
  for(const directory of ['Plugin/scripts','Docs/Licenses','Plugin/src/core','Builds/sieve/licenses','Builds/sieve/src/core','hooks'])await mkdir(path.join(root,directory),{recursive:true});
  for(const name of ['package.ps1','package-paths.ps1'])await copyFile(path.join(repository,'scripts',name),path.join(root,'Plugin/scripts',name));
  await writeFile(path.join(root,'.gitignore'),'Builds/\n');
  await writeFile(path.join(root,'Plugin/package.json'),json({version:'0.1.0',sieveBuild:1}));
  await writeFile(path.join(root,'Docs/Licenses/owned.txt'),'Owned license fixture\n');
  await writeFile(path.join(root,'Plugin/src/core/owned.ts'),'export const owned=1;\n');
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git(['init','-q']);git(['add','.gitignore','Plugin/package.json','Plugin/scripts/package.ps1','Plugin/scripts/package-paths.ps1','Docs/Licenses/owned.txt','Plugin/src/core/owned.ts']);
  git(['-c','commit.gpgsign=false','-c',`core.hooksPath=${path.join(root,'hooks')}`,'-c','user.name=Sieve Package Test','-c','user.email=sieve-test@example.invalid','commit','-qm','Owned package test fixture']);
  const files={
    'main.js':'Owned main fixture\n','manifest.json':json({id:'sieve',version:'0.1.0'}),
    'README.md':'Owned install fixture\n','LICENSE':'Owned license fixture\n','THIRD-PARTY-NOTICES.md':'Owned notices fixture\n',
    'licenses/owned.txt':'Owned license fixture\n','src/core/owned.ts':'export const owned=1;\n',
  };
  for(const [name,bytes] of Object.entries(files))await writeFile(path.join(root,'Builds/sieve',name),bytes);
  const identity={schemaVersion:1,pluginId:'sieve',dirty:false,gitCommit:git(['rev-parse','HEAD']),version:'0.1.0',build:1,sourceFingerprint:'a'.repeat(64),files:Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,sha(bytes)]))};
  const identityPath=path.join(root,'Builds/sieve/identity.json');await writeFile(identityPath,json(identity));
  await writeFile(path.join(root,'Builds/task-fixture.json'),json({owner:'sieve-package-inventory-test',root}));
  return{root,identity,identityPath,output:path.join(root,'Builds/Sieve 0.1.0 (build 1).zip')};
}
function pack(context){return JSON.parse(execFileSync('pwsh.exe',['-NoProfile','-NonInteractive','-File',path.join(context.root,'Plugin/scripts/package.ps1')],{cwd:context.root,encoding:'utf8',timeout:15000,stdio:['ignore','pipe','pipe']}));}
async function absent(file){await assert.rejects(access(file),error=>error.code==='ENOENT');}

test('package builder emits complete inventory and preserves an existing archive',windows,async t=>{
  const context=await fixture(t);const proof=pack(context);assert.equal(proof.files,8);assert.equal(proof.gitCommit,context.identity.gitCommit);
  const bytes=await readFile(context.output);assert.equal(proof.sha256.toLowerCase(),sha(bytes));
  assert.throws(()=>pack(context),error=>String(error.stderr).includes('Preserve existing package'));
  assert.deepEqual(await readFile(context.output),bytes);
});
const corrupt={
  empty:identity=>{identity.files={};},
  missingMain:identity=>{delete identity.files['main.js'];},
  reservedIdentity:identity=>{identity.files['identity.json']='b'.repeat(64);},
  caseDuplicate:identity=>{identity.files['MAIN.JS']=identity.files['main.js'];},
  traversal:identity=>{identity.files['../sieve/main.js']=identity.files['main.js'];delete identity.files['main.js'];},
  wrongHash:identity=>{identity.files['main.js']='b'.repeat(64);},
};
for(const [name,tamper] of Object.entries(corrupt))test(`package builder refuses ${name} before ZIP creation`,windows,async t=>{
  const context=await fixture(t);tamper(context.identity);await writeFile(context.identityPath,json(context.identity));
  assert.throws(()=>pack(context));await absent(context.output);
});
test('package builder refuses an uncommitted source change before ZIP creation',windows,async t=>{
  const context=await fixture(t);await writeFile(path.join(context.root,'Plugin/src/core/owned.ts'),'Changed owned fixture\n');
  assert.throws(()=>pack(context),error=>String(error.stderr).includes('Commit the plugin'));
  await absent(context.output);
});
