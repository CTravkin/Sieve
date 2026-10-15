import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createTestDirectory} from '../../scripts/test-temporary.mjs';

const repository=fileURLToPath(new URL('../../',import.meta.url));
const helper=path.join(repository,'scripts/package-paths.ps1');
const quote=value=>"'"+value.replaceAll("'","''")+"'";
async function fixture(t){
  const owned=await createTestDirectory('package-boundary-');
  t.after(()=>owned.cleanup());
  const directory=owned.path;
  const root=path.join(directory,'Repository'),outside=path.join(directory,'Outside');
  await mkdir(root,{recursive:true});await mkdir(outside);await writeFile(path.join(outside,'license.txt'),'owned guard fixture\n');
  return{root,outside};
}
function run(body){return execFileSync('pwsh.exe',['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'; . ${quote(helper)}; ${body}`],{encoding:'utf8'}).trim();}
function rejected(root,target,extra=''){
  return run(`$blocked=$false; try { $null=Assert-SievePackagePath -RepositoryRoot ${quote(root)} -Path ${quote(target)} ${extra} } catch { if($_.Exception.Message -notlike '*reparse*'){throw}; $blocked=$true }; if(-not $blocked){throw 'Expected physical path rejection'}; 'REJECTED'`);
}
const windows={skip:process.platform!=='win32'};
test('private package guard accepts owned physical files and a new archive leaf',windows,async t=>{
  const {root}=await fixture(t);await mkdir(path.join(root,'dist/sieve'),{recursive:true});const file=path.join(root,'dist/sieve/main.js');await writeFile(file,'owned\n');
  assert.equal(run(`$null=Assert-SievePackagePath -RepositoryRoot ${quote(root)} -Path ${quote(file)}; $null=Assert-SievePackagePath -RepositoryRoot ${quote(root)} -Path ${quote(path.join(root,'dist/new.zip'))} -AllowMissingLeaf; 'PASS'`),'PASS');
});
test('private package guard rejects an output directory junction before ZIP creation',windows,async t=>{
  const {root,outside}=await fixture(t);run(`$null=New-Item -ItemType Junction -Path ${quote(path.join(root,'dist'))} -Target ${quote(outside)}; 'CREATED'`);
  assert.equal(rejected(root,path.join(root,'dist/new.zip'),'-AllowMissingLeaf'),'REJECTED');
});
test('private package guard rejects an artifact directory junction before reading its identity',windows,async t=>{
  const {root,outside}=await fixture(t);await mkdir(path.join(root,'dist'));run(`$null=New-Item -ItemType Junction -Path ${quote(path.join(root,'dist/sieve'))} -Target ${quote(outside)}; 'CREATED'`);
  assert.equal(rejected(root,path.join(root,'dist/sieve')),'REJECTED');
});
test('private package guard rejects intermediate license and source junctions',windows,async t=>{
  const {root,outside}=await fixture(t);await mkdir(path.join(root,'dist/sieve'),{recursive:true});
  for(const name of ['licenses','src']){
    const junction=path.join(root,'dist/sieve',name);run(`$null=New-Item -ItemType Junction -Path ${quote(junction)} -Target ${quote(outside)}; 'CREATED'`);
    assert.equal(rejected(root,path.join(junction,'license.txt')),'REJECTED');
  }
});
