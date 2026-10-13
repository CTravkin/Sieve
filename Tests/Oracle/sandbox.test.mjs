import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, stat, chmod, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { runOracle } from '../../Tools/Oracle/runner.mjs';

test('unsafe alias and permission plans reject before touching an own external sentinel on every OS', async () => {
  const temporary = fileURLToPath(new URL('../../Local/.temp/Oracle/', import.meta.url));
  await mkdir(temporary,{recursive:true});
  const owned = await mkdtemp(path.join(temporary,'sandbox-sentinel-'));
  assert.ok(path.resolve(owned).startsWith(path.resolve(temporary)+path.sep));
  const sentinel = path.join(owned,'sentinel.txt');
  const content = Buffer.from('Own synthetic P1 regression sentinel; no user data\n');
  await writeFile(sentinel,content,{mode:0o640});
  const originalMode = (await stat(sentinel)).mode & 0o777;
  const originalHash = createHash('sha256').update(content).digest('hex');
  try {
    const cases = [
      { name:'external-target', aliases:{alias:sentinel}, permissions:{alias:0} },
      { name:'external-name', aliases:{[sentinel]:'common'}, permissions:{[sentinel]:0} },
      { name:'external-ancestor-target', aliases:{directory:owned}, permissions:{'directory/sentinel.txt':0} },
      { name:'external-permission-name', permissions:{[sentinel]:0} },
      { name:'permission-symlink-leaf', aliases:{alias:'common'}, permissions:{alias:0} },
      { name:'permission-symlink-ancestor', aliases:{directory:'dir'}, permissions:{'directory/common':0} },
    ];
    for (const fixture of cases) {
      const [result] = await runOracle([{...fixture,basic:true,rules:'',files:{common:'safe','dir/common':'safe'},paths:[]}]);
      assert.match(result.error,/sandbox|symlink permission/i,fixture.name);
      assert.equal((await stat(sentinel)).mode & 0o777,originalMode,fixture.name);
      assert.equal(createHash('sha256').update(await readFile(sentinel)).digest('hex'),originalHash,fixture.name);
    }
  } finally {
    await chmod(sentinel,originalMode);
    assert.ok(path.resolve(owned).startsWith(path.resolve(temporary)+path.sep));
    await rm(owned,{recursive:true,force:true});
  }
});
