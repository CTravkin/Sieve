import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRules } from '../../dist/core/matcher.mjs';
import { runOracle } from '../../scripts/Oracle/runner.mjs';
import { projectTree } from '../Fixtures/tree.mjs';

const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux';

test('native scanner and pruned/exhaustive matcher walks retain the same accessible files', async t => {
  const tree = ['technical/deep/keep.md', 'technical/deep/drop.txt', 'technical/other.md', 'node_modules/deep/keep.md', 'notes/a.md', 'notes/b.txt', 'plain.md', '.stversions/archive.md'];
  const sources = ['node_modules\ntechnical\n!*.md\n*', '!/technical/deep/keep.md\ntechnical\n!*.md\n*', '!/technical\n*', 'technical/\n!*.md\n*', '!/**\n*', ''];
  // Deterministic tree/rule permutations exercise skip order and rooted include exceptions.
  for (const include of ['!/technical/deep/keep.md', '!technical/deep/keep.md', '!/notes', '!/n*', '!/notes/a.md', '!*.md']) {
    for (const exclude of ['technical', 'technical/', '/technical', 'node_modules\ntechnical', '*']) {
      sources.push(`${include}\n${exclude}`); sources.push(`${exclude}\n${include}`);
    }
  }
  const fixtures = sources.map((rules,i) => ({ name: `traversal/${i}`, rules, tree, paths: [] }));
  const native = await runOracle(fixtures);
  for (let i = 0; i < fixtures.length; i++) {
    const result = await compileRules(fixtures[i].rules, { platform });
    assert.equal(result.ok, true);
    const exhaustive = projectTree(result.matcher, tree, false);
    const pruned = projectTree(result.matcher, tree, true);
    assert.deepEqual(pruned.files, exhaustive.files, fixtures[i].rules);
    assert.deepEqual(pruned.containers, exhaustive.containers, fixtures[i].rules);
    assert.deepEqual(native[i].scan.errors, []);
    assert.deepEqual(pruned.files, native[i].scan.files, fixtures[i].rules);
    // Native Syncthing emits extra allowed empty directories; Sieve's projection retains
    // the minimal set of parents required by the allowed files for the UI index.
    for (const container of pruned.containers) assert.equal(tree.some(p => p.startsWith(container + '/')), true);
  }
  t.diagnostic(`${fixtures.length} native scanner trees; zero file/pruning differences, minimal parent containers checked`);
});
