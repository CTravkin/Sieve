// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRules } from '../../.build/core/matcher.mjs';

async function compile(text, context = {}) {
  const result = await compileRules(text, { platform: 'linux', ...context });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return result;
}

test('first match includes a descendant before excluding its directory', async () => {
  const { matcher } = await compile('!/technical/deep/keep.md\ntechnical');
  assert.deepEqual(matcher.match('technical'), { ignored: true, deletable: false, caseFolded: false, canSkipDir: false });
  assert.equal(matcher.match('technical/deep/keep.md').ignored, false);
  assert.equal(matcher.match('technical/deep/drop.md').ignored, true);
});

test('directory exclusion before an allowlist permits pruning', async () => {
  const { matcher } = await compile('node_modules\n!*.md\n*');
  assert.equal(matcher.match('node_modules').canSkipDir, true);
  assert.equal(matcher.match('node_modules/keep.md').ignored, true);
  assert.equal(matcher.match('other').canSkipDir, false);
});

test('rooted top-level include exceptions preserve safe skipping', async () => {
  for (const rule of ['!/test', '!/t[eih]t', '!/t*t', '!/t?t', '!/**']) {
    const { matcher } = await compile(`${rule}\n*`);
    assert.equal(matcher.match('whatever').canSkipDir, rule !== '!/**', rule);
  }
});

test('internal and temporary names override allow rules without deleting', async () => {
  const { matcher } = await compile('!**');
  for (const name of ['.stfolder', '.stfolder/child', '.stignore', '.stversions/file', 'dir/.syncthing.x.tmp', 'dir/~syncthing~x.tmp']) {
    assert.deepEqual(matcher.match(name), { ignored: true, deletable: false, caseFolded: false, canSkipDir: true }, name);
  }
  assert.equal(matcher.match('dir/.stignore').ignored, false);
  assert.equal(matcher.match('.').ignored, false);
});

test('platform profiles use native normalization and default folding', async () => {
  for (const platform of ['windows', 'darwin', 'ios', 'linux', 'android']) {
    const { matcher } = await compile('CAFÉ\nfile?', { platform });
    const n = platform === 'darwin' || platform === 'ios' ? 'NFD' : 'NFC';
    assert.equal(matcher.match('café'.normalize(n)).ignored, ['windows', 'darwin', 'ios'].includes(platform), platform);
    assert.equal(matcher.match('file😀').ignored, true, platform);
  }
});

test('explicit folding follows Go simple rune mapping rather than contextual lowercase', async () => {
  const { matcher } = await compile('(?i)/İΣ\n(?i)/𐐀');
  assert.equal(matcher.match('iσ').ignored, true);
  assert.equal(matcher.match('iς').ignored, false);
  assert.equal(matcher.match('𐐨').ignored, true);
});

test('included file resolves at virtual root and its children resolve locally', async () => {
  const seen = [];
  const files = { 'filters/common': '#include nested\nfrom-common', 'filters/nested': 'from-nested' };
  const result = await compile('#include filters/common\nlocal', { readInclude: async path => { seen.push(path); return files[path]; } });
  assert.deepEqual(seen, ['filters/common', 'filters/nested']);
  assert.deepEqual(result.dependencies.map(d => d.path), seen);
  assert.equal(result.matcher.match('from-nested').ignored, true);
  assert.equal(result.matcher.match('local').ignored, true);
});

test('include failures retain source file and one-based line diagnostics', async () => {
  const result = await compileRules('// header\n#include filters/common', { platform: 'linux', readInclude: async () => { throw new Error('permission denied'); } });
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].source, '.stignore');
  assert.equal(result.diagnostics[0].line, 2);
  assert.equal(result.diagnostics[0].code, 'include-read');
  assert.match(result.diagnostics[0].reason, /permission denied/);
  assert.equal(result.matcher, undefined);
});

test('diagnostic root provenance distinguishes an included .stignore with the same source and line',async()=>{
  const root=await compileRules('[',{platform:'linux'});
  const included=await compileRules('#include .stignore',{platform:'linux',readInclude:async()=> '['});
  assert.equal(root.ok,false);assert.equal(included.ok,false);
  const a=root.diagnostics[0],b=included.diagnostics[0];
  for(const key of ['source','line','code','reason'])assert.equal(a[key],b[key]);
  assert.equal(a.isRoot,true);assert.equal(b.isRoot,false);
  for(const [rules,files,source,isRoot] of [
    ['// header\n#include missing',{},'.stignore',true],
    ['#include .stignore',{'.stignore':'// header\n#include missing'},'.stignore',false],
    ['#include filters/team',{ 'filters/team':'// header\n#include missing'},'filters/team',false],
  ]){
    const result=await compileRules(rules,{platform:'linux',readInclude:async path=>{if(!Object.hasOwn(files,path))throw Error('unavailable');return files[path];}});
    assert.equal(result.ok,false);assert.equal(result.diagnostics[0].code,'include-read');assert.equal(result.diagnostics[0].source,source);assert.equal(result.diagnostics[0].line,2);assert.equal(result.diagnostics[0].isRoot,isRoot);
  }
});

test('global exact-line dedup runs before repeated include detection', async () => {
  let reads = 0;
  const { matcher, dependencies } = await compile('#include a\n#include a', { readInclude: async () => { reads++; return 'drop'; } });
  assert.equal(reads, 1);
  assert.equal(dependencies.length, 1);
  assert.equal(matcher.match('drop').ignored, true);
  const result = await compileRules('#include a\n#include ./a', { platform: 'linux', readInclude: async () => 'drop' });
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, 'multiple-include');
});

test('escape state belongs to each file and includes may precede its declaration', async () => {
  const { matcher } = await compile('#include a\n#escape=|\nroot|{name|}', { readInclude: async () => '#escape=\\\nchild\\{name\\}' });
  assert.equal(matcher.match('root{name}').ignored, true);
  assert.equal(matcher.match('child{name}').ignored, true);
});

test('compile errors do not replace an earlier immutable matcher or poison retries', async () => {
  let contents = 'drop';
  const context = { platform: 'linux', readInclude: async () => contents };
  const first = await compile('#include a', context);
  contents = '[';
  assert.equal((await compileRules('#include a', context)).ok, false);
  assert.equal(first.matcher.match('drop').ignored, true);
  contents = 'keep';
  const second = await compile('#include a', context);
  assert.notEqual(second.revision, first.revision);
  assert.equal(second.matcher.match('drop').ignored, false);
  assert.equal(Object.isFrozen(first.matcher), true);
  assert.equal(Object.isFrozen(first.dependencies), true);
  assert.equal(Object.isFrozen(first.dependencies[0]), true);
});

test('identical patterns keep the revision while changed includes change it', async () => {
  const a = await compile('drop\n// old');
  const b = await compile('drop\ndrop\n// new');
  assert.equal(a.revision, b.revision);
  assert.equal((await compile('')).matcher.match('normal').ignored, false);
});

test('external context mutation cannot change a compiled matcher', async () => {
  const context = { platform: 'linux' };
  const result = await compileRules('drop', context);
  assert.equal(result.ok, true);
  context.platform = 'windows';
  assert.equal(result.matcher.match('dir\\drop').ignored, false);
  assert.equal(result.matcher.match('.stignore').caseFolded, false);
});

test('a Windows absolute drive include never escapes through a relative reader boundary', async () => {
  const result = await compileRules('#include C:/outside/common', { platform:'windows', readInclude: async path => {
    if (path === 'C:/outside/common') return 'drop';
    throw new Error('invalid relative drive path');
  } });
  assert.equal(result.ok,false);
  assert.equal(result.diagnostics[0].code,'include-read');
});
