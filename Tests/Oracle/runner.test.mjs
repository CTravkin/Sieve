import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readdir } from 'node:fs/promises';
import path from 'node:path';
import { buildOracle, createOracle } from '../../scripts/Oracle/runner.mjs';
import { createTestDirectory } from '../../scripts/test-temporary.mjs';

test('oracle workers reuse the suite executable and leave supplied executables owned by the caller', async t => {
  const binary = await buildOracle();
  assert.equal(await buildOracle(), binary);
  if (process.env.SIEVE_ORACLE_BINARY) assert.equal(binary, path.resolve(process.env.SIEVE_ORACLE_BINARY));
  else t.diagnostic('Direct worker invocation uses its own disposable build');
  const supplied = await createOracle({ binary });
  assert.equal(supplied.supplied, true);
  await supplied.cleanup();
  await access(binary);
});

test('failed pinned Go build removes its newly created build directory', async () => {
  const owned = await createTestDirectory('oracle-failure-');
  const previous = process.env.GOTOOLCHAIN;
  try {
    process.env.GOTOOLCHAIN = 'invalid-test-toolchain';
    await assert.rejects(createOracle({ directory: owned.path, binary: '' }), error => /exited/.test(error.message) || error.code === 'ENOENT');
    assert.deepEqual(await readdir(owned.path), []);
  } finally {
    if (previous === undefined) delete process.env.GOTOOLCHAIN;
    else process.env.GOTOOLCHAIN = previous;
    await owned.cleanup();
  }
});
