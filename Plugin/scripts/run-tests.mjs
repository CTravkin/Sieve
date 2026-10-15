// SPDX-License-Identifier: MPL-2.0
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createTestDirectory } from './test-temporary.mjs';
import { createOracle } from './Oracle/runner.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));

export async function runTests(args, { prepareOracle = createOracle } = {}) {
  const useOracle = args[0] === '--oracle';
  const patterns = useOracle ? args.slice(1) : args;
  if (!patterns.length) throw new Error('Specify test files or patterns');
  let run;
  let oracle;
  let child;
  let interrupted;
  const signalCode = signal => signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1;
  const interrupt = signal => { interrupted ??= signal; child?.kill(signal); };
  const onInterrupt = () => interrupt('SIGINT');
  const onTerminate = () => interrupt('SIGTERM');
  // Install before the first await: even directory creation and Go compilation
  // belong to this run. An in-flight build drains before its files are removed.
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);
  try {
    run = await createTestDirectory('tests-');
    if (interrupted) return signalCode(interrupted);
    const env = { ...process.env, SIEVE_TEST_TEMP: run.path };
    // A wrapper can be tested from a Node test worker. The new runner owns its
    // own workers rather than inheriting the invoking worker's private marker.
    delete env.NODE_TEST_CONTEXT;
    if (useOracle) {
      const directory = path.join(run.path, 'Oracle');
      await mkdir(directory);
      if (interrupted) return signalCode(interrupted);
      oracle = await prepareOracle({ directory });
      if (interrupted) return signalCode(interrupted);
      env.SIEVE_ORACLE_BINARY = oracle.binary;
      env.SIEVE_ORACLE_TEMP = directory;
      console.log(`Native oracle: ${oracle.supplied ? 'supplied' : 'one run-owned build'} ${oracle.binary}`);
    }
    return await new Promise((resolve, reject) => {
      child = spawn(process.execPath, ['--test', ...patterns], { cwd: repository, env, stdio: 'inherit', windowsHide: true });
      child.once('error', reject);
      child.once('close', (code, signal) => resolve(interrupted ? signalCode(interrupted) : code ?? (signal ? signalCode(signal) : 1)));
    });
  } catch (error) {
    if (interrupted) return signalCode(interrupted);
    throw error;
  } finally {
    try {
      try { await oracle?.cleanup(); }
      finally { await run?.cleanup(); }
    } finally {
      process.off('SIGINT', onInterrupt);
      process.off('SIGTERM', onTerminate);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await runTests(process.argv.slice(2));
}
