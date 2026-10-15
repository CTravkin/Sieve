import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../',import.meta.url));
const program = `
import {readFileSync} from 'node:fs';
import {compileRules} from './dist/core/matcher.mjs';
const {n,shape}=JSON.parse(readFileSync(0,'utf8'));
const rules=shape==='alternate'?'a**'.repeat(n):shape==='disjoint'?'*?a'.repeat(n):shape==='ties'?'longname?**?a?**'.repeat(n)+'*?a':'**'.repeat(n)+'a'+'**'.repeat(n);
const started=performance.now();
const result=await compileRules(rules,{platform:'linux'});
if(!result.ok) throw new Error(JSON.stringify(result.diagnostics));
console.log(JSON.stringify({bytes:rules.length,elapsed:performance.now()-started,yes:shape===undefined?result.matcher.match('deep/😀a/end').ignored:undefined,no:result.matcher.match('xyz').ignored}));
`;

test('Projects directory groups handle thousands of long unique startup paths within a bounded subprocess', t => {
  const matchProgram = `
    import {compileRules} from './dist/core/matcher.mjs';
    const rules = [
      '(?i)**/{temp,temp[-_]*,tmp*,whisper[-_]work*,build,dist,target,bin,obj,go-mod,go-build}/**',
      '(?i)**/{src,internal,cmd,lib,libs,include,vendor,third[-_]party*,packages}/**',
      '(?i)!*.md', '*',
    ].join('\\n');
    const compiled = await compileRules(rules, {platform:'windows'});
    if(!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    const started = performance.now();
    for(let i=0;i<6000;i++) {
      const path = 'Project/QA/Evidence/2026-10-03 hourly-works-baseline/baseline-src/Frontend/scripts/choice-list-contract-' + i + (i%2 ? '.md' : '.cjs');
      const result = compiled.matcher.match(path);
      if(result.ignored !== (i%2===0) || !result.caseFolded || result.canSkipDir || result.deletable) throw Error('Matching semantics changed at '+i);
    }
    console.log(JSON.stringify({paths:6000,elapsed:performance.now()-started}));
  `;
  const child=spawnSync(process.execPath,['--input-type=module','-e',matchProgram],{cwd:repository,encoding:'utf8',timeout:5000,maxBuffer:65536,windowsHide:true});
  assert.equal(child.error,undefined,`Startup matching exceeded its 5-second subprocess bound: ${child.error?.message}`);
  assert.equal(child.status,0,child.stderr.slice(0,2000));
  const result=JSON.parse(child.stdout);
  assert.equal(result.paths,6000);
  t.diagnostic(`6000 unique long startup paths matched in ${result.elapsed.toFixed(1)} ms`);
});

test('long mixed glob compiles within a bounded subprocess without restricting valid mask length', t => {
  const child=spawnSync(process.execPath,['--input-type=module','-e',program],{cwd:repository,input:JSON.stringify({n:16383}),encoding:'utf8',timeout:5000,maxBuffer:65536,windowsHide:true});
  assert.equal(child.error,undefined,`Compiler exceeded its 5-second subprocess bound: ${child.error?.message}`);
  assert.equal(child.status,0,child.stderr);
  const result=JSON.parse(child.stdout);
  assert.equal(result.bytes,65533);
  assert.equal(result.yes,true);
  assert.equal(result.no,false);
  t.diagnostic(`65533-byte mask compiled in ${result.elapsed.toFixed(1)} ms in an isolated subprocess`);
});

test('long alternating fixed/variable tokens compile without exhausting the JS stack', t => {
  const child=spawnSync(process.execPath,['--input-type=module','-e',program],{cwd:repository,input:JSON.stringify({n:21844,shape:'alternate'}),encoding:'utf8',timeout:5000,maxBuffer:65536,windowsHide:true});
  assert.equal(child.error,undefined,child.error?.message);
  assert.equal(child.status,0,child.stderr.slice(0,2000));
  const result=JSON.parse(child.stdout);
  assert.equal(result.bytes,65532);
  assert.equal(result.no,false);
  t.diagnostic(`65532-byte alternating mask compiled in ${result.elapsed.toFixed(1)} ms without recursive construction`);
});

test('many disjoint gluable groups compile near the valid byte limit in a bounded subprocess', t => {
  const child=spawnSync(process.execPath,['--input-type=module','-e',program],{cwd:repository,input:JSON.stringify({n:21844,shape:'disjoint'}),encoding:'utf8',timeout:5000,maxBuffer:65536,windowsHide:true});
  assert.equal(child.error,undefined,`Disjoint group compilation exceeded its 5-second bound: ${child.error?.message}`);
  assert.equal(child.status,0,child.stderr.slice(0,2000));
  const result=JSON.parse(child.stdout);
  assert.equal(result.bytes,65532);
  assert.equal(result.no,false);
  t.diagnostic(`65532-byte disjoint-group mask compiled in ${result.elapsed.toFixed(1)} ms without rescanning all remaining groups`);
});

test('independent fixed groups with alternating length/count preference avoid repeated winner scans', t => {
  const child=spawnSync(process.execPath,['--input-type=module','-e',program],{cwd:repository,input:JSON.stringify({n:4095,shape:'ties'}),encoding:'utf8',timeout:5000,maxBuffer:65536,windowsHide:true});
  assert.equal(child.error,undefined,child.error?.message);
  assert.equal(child.status,0,child.stderr.slice(0,2000));
  const result=JSON.parse(child.stdout);
  assert.equal(result.bytes,65523);
  assert.equal(result.no,false);
  t.diagnostic(`65523-byte mask with alternating native length/count preferences compiled in ${result.elapsed.toFixed(1)} ms`);
});
