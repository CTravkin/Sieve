import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,copyFile,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const repository=fileURLToPath(new URL('../../',import.meta.url));
const json=value=>JSON.stringify(value,null,2)+'\n';
const sha=value=>createHash('sha256').update(value).digest('hex');
const windows={skip:process.platform!=='win32'};
async function fixture(){
  const root=path.join(repository,'../Local/.temp/Development/2026-10-14',`package-inventory-${randomUUID()}`);
  for(const directory of ['scripts/Oracle/licenses','src/core','dist/sieve/licenses','dist/sieve/src/core','hooks'])await mkdir(path.join(root,directory),{recursive:true});
  for(const name of ['package-private.ps1','package-paths.ps1'])await copyFile(path.join(repository,'scripts',name),path.join(root,'scripts',name));
  await writeFile(path.join(root,'.gitignore'),'dist/\n');
  await writeFile(path.join(root,'package.json'),json({version:'0.1.0',sieveBuild:1}));
  await writeFile(path.join(root,'scripts/Oracle/licenses/owned.txt'),'Owned license fixture\n');
  await writeFile(path.join(root,'src/core/owned.ts'),'export const owned=1;\n');
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git(['init','-q']);git(['add','.gitignore','package.json','scripts/package-private.ps1','scripts/package-paths.ps1','scripts/Oracle/licenses/owned.txt','src/core/owned.ts']);
  git(['-c','commit.gpgsign=false','-c',`core.hooksPath=${path.join(root,'hooks')}`,'-c','user.name=Sieve Package Test','-c','user.email=sieve-test@example.invalid','commit','-qm','Owned package test fixture']);
  const files={
    'main.js':'Owned main fixture\n','manifest.json':json({id:'sieve',version:'0.1.0'}),
    'INSTALL.md':'Owned install fixture\n','THIRD-PARTY-NOTICES.md':'Owned notices fixture\n',
    'licenses/owned.txt':'Owned license fixture\n','src/core/owned.ts':'export const owned=1;\n',
  };
  for(const [name,bytes] of Object.entries(files))await writeFile(path.join(root,'dist/sieve',name),bytes);
  const identity={privateCandidate:true,dirty:false,gitCommit:git(['rev-parse','HEAD']),version:'0.1.0',build:1,sourceFingerprint:'a'.repeat(64),files:Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,sha(bytes)]))};
  const identityPath=path.join(root,'dist/sieve/identity.json');await writeFile(identityPath,json(identity));
  await writeFile(path.join(root,'dist/task-fixture.json'),json({owner:'sieve-package-inventory-test',root}));
  return{root,identity,identityPath,output:path.join(root,'dist/result.zip')};
}
function pack(context){return JSON.parse(execFileSync('pwsh.exe',['-NoProfile','-NonInteractive','-File',path.join(context.root,'scripts/package-private.ps1'),'-Destination',context.output],{cwd:context.root,encoding:'utf8',timeout:15000,stdio:['ignore','pipe','pipe']}));}
async function absent(file){await assert.rejects(access(file),error=>error.code==='ENOENT');}

test('real private packer emits complete inventory and preserves an existing archive',windows,async()=>{
  const context=await fixture();const proof=pack(context);assert.equal(proof.files,7);assert.equal(proof.gitCommit,context.identity.gitCommit);
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
for(const [name,tamper] of Object.entries(corrupt))test(`real private packer refuses ${name} before ZIP creation`,windows,async()=>{
  const context=await fixture();tamper(context.identity);await writeFile(context.identityPath,json(context.identity));
  assert.throws(()=>pack(context));await absent(context.output);
});
test('real private packer refuses an uncommitted source change before ZIP creation',windows,async()=>{
  const context=await fixture();await writeFile(path.join(context.root,'src/core/owned.ts'),'Changed owned fixture\n');
  assert.throws(()=>pack(context),error=>String(error.stderr).includes('Commit the private candidate'));
  await absent(context.output);
});
