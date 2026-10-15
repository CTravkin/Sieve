// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, readFile, readdir, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createTestDirectory } from '../scripts/test-temporary.mjs';
import { loadRuntime } from './Fixtures/load-runtime.mjs';
import { uiSdk } from './Fixtures/ui-host.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const absent = filename => assert.rejects(access(filename), error => error.code === 'ENOENT');

async function fixture(t) {
  const owned = await createTestDirectory('tooling-');
  t.after(() => owned.cleanup());
  return owned.path;
}

test('runtime imports share one pending bundle and module for the same source and host', async () => {
  const first = loadRuntime('i18n/index');
  assert.equal(loadRuntime('i18n/index'), first);
  const [left, right] = await Promise.all([first, loadRuntime('i18n/index')]);
  assert.equal(left, right);
  assert.equal(left.locale('ru').settings.description, 'Исключает файлы и каталоги перед индексацией хранилища');
  assert.equal(await loadRuntime('i18n/index'), left);
});

test('runtime bundle identity includes the supplied host and imports dynamic providers in memory', async () => {
  const first = await loadRuntime('main', uiSdk);
  const changed = await loadRuntime('main', uiSdk + '\nexport const alternateHost = true;\n');
  assert.notEqual(first, changed);
  assert.equal(typeof first.default.prototype.onload, 'function');
  assert.equal(typeof changed.default.prototype.onload, 'function');
});

test('owned cleanup unlinks nested junctions and preserves preexisting parents and external files', async t => {
  const root = await fixture(t);
  const outside = path.join(root, 'preexisting');
  await mkdir(outside);
  const sentinel = path.join(outside, 'sentinel.txt');
  await writeFile(sentinel, 'external fixture\n');
  const owned = await createTestDirectory('owned-', root);
  await symlink(outside, path.join(owned.path, 'external'), process.platform === 'win32' ? 'junction' : 'dir');
  await owned.cleanup();
  await owned.cleanup();
  await absent(owned.path);
  assert.equal(await readFile(sentinel, 'utf8'), 'external fixture\n');
  assert.deepEqual(await readdir(root), ['preexisting']);
});

test('cleanup refuses an owned root replaced by a junction', async t => {
  const root = await fixture(t);
  const outside = path.join(root, 'outside');
  await mkdir(outside);
  const owned = await createTestDirectory('owned-', root);
  const parked = owned.path + '-parked';
  await rename(owned.path, parked);
  let linked = false;
  try {
    await symlink(outside, owned.path, process.platform === 'win32' ? 'junction' : 'dir');
    linked = true;
    await assert.rejects(owned.cleanup(), /Refusing cleanup of replaced test directory/);
  } finally {
    if (linked) await unlink(owned.path);
    await rename(parked, owned.path);
    await owned.cleanup();
  }
  await access(outside);
});

for (const failure of [false, true]) test(`suite wrapper shares an external oracle and cleans its run after ${failure ? 'failure' : 'success'}`, async t => {
  const root = await fixture(t);
  const sentinel = path.join(root, 'sentinel.txt');
  await writeFile(sentinel, 'preexisting input\n');
  const runner = new URL('../scripts/Oracle/runner.mjs', import.meta.url).href;
  const workers = ['first', 'second'];
  for (const name of workers) {
    await writeFile(path.join(root, `${name}.test.mjs`), `
      import test from 'node:test';
      import assert from 'node:assert/strict';
      import {writeFile} from 'node:fs/promises';
      import {buildOracle} from ${JSON.stringify(runner)};
      test('shared executable', async () => {
        const binary = await buildOracle();
        assert.equal(binary, process.execPath);
        assert.equal(await buildOracle(), binary);
        await writeFile(${JSON.stringify(path.join(root, `${name}.json`))}, JSON.stringify({binary, run:process.env.SIEVE_TEST_TEMP}));
        assert.equal(${failure && name === 'second'}, false, 'intentional worker failure');
      });
    `);
  }
  const invoke = () => execFileSync(process.execPath, [path.join(repository, 'scripts/run-tests.mjs'), '--oracle', ...workers.map(name => path.join(root, `${name}.test.mjs`))], {
    cwd: repository, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, SIEVE_TEST_TEMP: root, SIEVE_ORACLE_BINARY: process.execPath },
  });
  if (failure) assert.throws(invoke, error => error.status === 1);
  else assert.match(invoke(), /Native oracle: supplied/);
  const observed = await Promise.all(workers.map(async name => JSON.parse(await readFile(path.join(root, `${name}.json`), 'utf8'))));
  assert.equal(observed[0].run, observed[1].run);
  assert.notEqual(observed[0].run, root);
  for (const result of observed) {
    assert.equal(result.binary, process.execPath);
    await absent(result.run);
    await access(result.binary);
  }
  assert.equal(await readFile(sentinel, 'utf8'), 'preexisting input\n');
});

for (const [phase, signal] of [['creation', 'SIGINT'], ['build', 'SIGINT'], ['build-error', 'SIGTERM']]) {
  test(`suite wrapper cleans and detaches handlers after ${signal} during ${phase}`, async t => {
    const root = await fixture(t);
    const script = path.join(root, 'interruption.mjs');
    await writeFile(script, `
      import assert from 'node:assert/strict';
      import {access, readdir, writeFile} from 'node:fs/promises';
      import {setImmediate} from 'node:timers/promises';
      import path from 'node:path';
      import {runTests} from ${JSON.stringify(new URL('../scripts/run-tests.mjs', import.meta.url).href)};
      import {createTestDirectory} from ${JSON.stringify(new URL('../scripts/test-temporary.mjs', import.meta.url).href)};
      const phase = ${JSON.stringify(phase)}, signal = ${JSON.stringify(signal)};
      const before = ['SIGINT', 'SIGTERM'].map(name => process.listenerCount(name));
      let run, drained = false, cleaned = false;
      const pending = runTests(['--oracle', 'must-not-start.test.mjs'], {prepareOracle: async ({directory}) => {
        assert.notEqual(phase, 'creation', 'Cancelled setup must never start a build');
        run = path.dirname(directory);
        const build = await createTestDirectory('build-', directory);
        const output = path.join(build.path, 'pending-output');
        await writeFile(output, 'owned build output');
        assert.equal(process.emit(signal), true, 'Build interruption must have a handler');
        await setImmediate();
        await access(output); // Cleanup must wait until in-flight work settles.
        drained = true;
        if (phase === 'build-error') {
          await build.cleanup();
          cleaned = true;
          throw new Error('Compiler stopped after interruption');
        }
        return {binary: process.execPath, cleanup: async () => {
          assert.equal(drained, true);
          await build.cleanup();
          cleaned = true;
        }};
      }});
      if (phase === 'creation') assert.equal(process.emit(signal), true, 'Setup interruption must have a handler');
      assert.equal(await pending, signal === 'SIGINT' ? 130 : 143);
      if (phase !== 'creation') {
        assert.equal(drained, true);
        assert.equal(cleaned, true);
        await assert.rejects(access(run), error => error.code === 'ENOENT');
      }
      assert.deepEqual(['SIGINT', 'SIGTERM'].map(name => process.listenerCount(name)), before);
      assert.deepEqual(await readdir(process.env.SIEVE_TEST_TEMP), ['interruption.mjs']);
    `);
    execFileSync(process.execPath, [script], {
      cwd: repository, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, SIEVE_TEST_TEMP: root },
    });
  });
}
