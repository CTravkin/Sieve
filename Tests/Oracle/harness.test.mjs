import assert from 'node:assert/strict';
import test from 'node:test';
import { runOracle } from '../../scripts/Oracle/runner.mjs';

test('native oracle reports pinned platform flags and first-match decisions', async () => {
  const [result] = await runOracle([{ name: 'first-match', rules: '!keep.md\n(?d)*', paths: ['keep.md', 'hide.txt', '.stignore'] }]);
  assert.equal(result.error, undefined);
  assert.equal(result.upstreamCommit, '4461a1ce354d3990660966ad70176e00246adb61');
  assert.equal(result.profile.os, process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux');
  assert.deepEqual(result.matches.map(m => m.ignored), [false, true, true]);
  assert.equal(result.matches[1].deletable, true);
  assert.equal(result.matches[1].canSkipDir, false);
  assert.equal(result.matches[2].canSkipDir, true);
});

test('native oracle surfaces missing includes as parse errors', async () => {
  const [result] = await runOracle([{ name: 'missing', rules: '#include unavailable', paths: ['anything'] }]);
  assert.equal(result.parseError, true);
  assert.match(result.error, /file not found/);
  assert.deepEqual(result.matches, []);
});

test('native scanner finds an explicitly included descendant through ignored parents', async () => {
  const [result] = await runOracle([{ name: 'scanner', rules: '!/technical/deep/keep.md\ntechnical', paths: [], tree: ['technical/deep/keep.md', 'technical/deep/drop.md', 'plain.md'] }]);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.scan.files, ['plain.md', 'technical/deep/keep.md']);
  assert.deepEqual(result.scan.errors, []);
});
