// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRules } from '../../.build/core/matcher.mjs';
import { runOracle } from '../../scripts/Oracle/runner.mjs';

const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux';

async function compareBasic(fixture) {
  const [native] = await runOracle([{ ...fixture, basic: true }]);
  const portable = await compileRules(fixture.rules, { platform, readInclude: async path => {
    if (!Object.hasOwn(fixture.files, path)) throw new Error('file not found');
    return fixture.files[path];
  } });
  assert.equal(portable.ok, !native.error, JSON.stringify({ fixture, native, portable }));
  if (portable.ok) {
    assert.equal(portable.revision.endsWith(':' + native.hash), true);
    for (const { path, ...expected } of native.matches) assert.deepEqual(portable.matcher.match(path), expected);
  }
  return { native, portable };
}

test('accessible includes may escape the root and resolve nested siblings from their new filesystem', async () => {
  await compareBasic({ name: 'outside-nested', rules: '#include ../common', files: { '../common': '#include further\ndrop', '../further': 'other' }, paths: ['drop', 'other'] });
});

test('outside-root lexical aliases follow native filesystem identity rather than global realpath dedup', async () => {
  await compareBasic({ name: 'outside-repeat', rules: '#include ../common\n#include .././common', files: { '../common': 'drop' }, paths: ['drop'] });
});

test('absolute include paths are characterized with native filepath join rather than presumed supported', async () => {
  const [native] = await runOracle([{ name: 'absolute-native', basic: true, rules: '#include {{outside}}/common', files: { '../common': 'drop' }, paths: ['drop'] }]);
  assert.ok(native.error, 'The pinned root virtual source joins the absolute path into its own filesystem');
  assert.equal(native.parseError, true);
});

test('native include files follow symlink aliases while preserving distinct lexical identities', { skip: platform === 'windows' ? 'NOT_TESTED: upstream symlink test skips Windows; no privilege change is authorized' : false }, async () => {
  const [native] = await runOracle([{ name: 'symlink-alias', basic: true, rules: '#include alias\n#include real', files: { real: 'drop' }, aliases: { alias: 'real' }, paths: ['drop', 'keep'] }]);
  assert.equal(native.error, undefined);
  const portable = await compileRules('#include alias\n#include real', { platform, readInclude: async () => 'drop' });
  assert.equal(portable.ok, true);
  assert.deepEqual(portable.dependencies.map(d => d.path), ['alias', 'real']);
  for (const { path, ...expected } of native.matches) assert.deepEqual(portable.matcher.match(path), expected);
});

test('native inaccessible include is a parse/read failure, never an empty rule set', { skip: platform === 'windows' || process.getuid?.() === 0 ? 'NOT_TESTED: POSIX permission denial requires an unprivileged Unix host' : false }, async () => {
  const [native] = await runOracle([{ name: 'permission-denied', basic: true, rules: '#include denied', files: { denied: 'drop' }, permissions: { denied: 0 }, paths: ['drop'] }]);
  assert.equal(native.parseError, true);
  assert.match(native.error, /permission denied/i);
  const portable = await compileRules('#include denied', { platform, readInclude: async () => { throw new Error('permission denied'); } });
  assert.equal(portable.ok, false);
  assert.equal(portable.diagnostics[0].code, 'include-read');
});
