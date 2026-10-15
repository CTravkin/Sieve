import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRules } from '../../dist/core/matcher.mjs';
import {loadCoreModule} from '../Fixtures/load-core.mjs';

import { projectTree } from '../Fixtures/tree.mjs';

const files = ['node_modules/deep/keep.md', 'technical/deep/keep.md', 'technical/deep/drop.txt', 'technical/other.md', 'dir/a.md', 'dir/deep/a.txt', 'plain.md', '.stversions/archive.md', 'dir/.syncthing.test.tmp'];

test('pruning preserves exactly the exhaustive allowed files and minimal parent containers', async () => {
  const examples = [
    'node_modules\ntechnical\n!*.md\n*',
    '!/technical/deep/keep.md\ntechnical\n!*.md\n*',
    '!technical/deep/keep.md\ntechnical\n!*.md\n*',
    '!/technical\n*',
    'technical\n!technical/deep/keep.md\n*',
    '!/**\n*',
    'technical/\n!*.md\n*',
    '',
  ];
  for (const rules of examples) {
    const result = await compileRules(rules, { platform: 'linux' });
    assert.equal(result.ok, true);
    const exhaustive = projectTree(result.matcher, files, false);
    const pruned = projectTree(result.matcher, files, true);
    assert.deepEqual(pruned.files, exhaustive.files, rules);
    assert.deepEqual(pruned.containers, exhaustive.containers, rules);
    if (rules.startsWith('node_modules\ntechnical')) {
      assert.deepEqual(pruned.skipped.filter(p => !p.startsWith('.')), ['node_modules', 'technical']);
      assert.equal(pruned.seen.some(p => p.startsWith('technical/')), false);
    }
    if (rules.startsWith('!/technical/deep')) {
      assert.deepEqual(pruned.containers.filter(p => p.startsWith('technical')), ['technical', 'technical/deep']);
      assert.equal(pruned.files.includes('technical/deep/keep.md'), true);
    }
  }
});

test('a single-directory wildcard rejects at the first separator without decoding the remaining path',async()=>{
  const {compileGlob}=await loadCoreModule('glob');const glob=compileGlob('dir/*');
  const suffix='file/'+'x'.repeat(32768);const original=String.prototype.charCodeAt;let inspected=0;
  String.prototype.charCodeAt=function(...args){if(String(this)===suffix)inspected++;return original.apply(this,args);};
  try{assert.equal(glob('dir/'+suffix),false);}finally{String.prototype.charCodeAt=original;}
  assert.ok(inspected<=5,`Decoded ${inspected} bytes although the first separator rejects the path`);
  assert.equal(glob('dir/имя😀.md'),true);assert.equal(glob('dir/имя😀.md/nested'),false);
});
