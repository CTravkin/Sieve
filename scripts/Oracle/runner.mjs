import { spawn } from 'node:child_process';
import { access, mkdir, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createTestDirectory } from '../test-temporary.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const oracle = path.join(repository, 'scripts', 'Oracle');
const temporary = process.env.SIEVE_ORACLE_TEMP || path.resolve(repository, '../Local/.temp/Oracle');
let built;

function execute(command, args, input = '', cwd = repository, timeoutMs = 0) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, env: { ...process.env, SIEVE_ORACLE_TEMP: temporary } });
    let timedOut = false;
    const timer = timeoutMs > 0 ? setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) { timedOut = true; child.kill(); }
    },timeoutMs) : undefined;
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`Native oracle exceeded ${timeoutMs} ms and was terminated`));
      else if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited ${code}: ${stderr}`));
    });
    child.stdin.end(input);
  });
}

export async function createOracle({ directory = temporary, binary = process.env.SIEVE_ORACLE_BINARY } = {}) {
  // Explicit external executables remain owned by the caller.
  if (binary) {
    const supplied = path.resolve(binary);
    await access(supplied, constants.X_OK);
    return { binary: supplied, supplied: true, cleanup: async () => {} };
  }
  const owned = await createTestDirectory('build-', directory);
  try {
    const files = await Promise.all(['go.mod', 'go.sum', 'main.go', 'sandbox.go'].map(name => readFile(path.join(oracle, name))));
    const hash = createHash('sha256').update(Buffer.concat(files)).digest('hex').slice(0, 16);
    const binary = path.join(owned.path, `oracle-${hash}${process.platform === 'win32' ? '.exe' : ''}`);
    await execute('go', ['build', '-mod=readonly', '-trimpath', '-o', binary, '.'], '', oracle);
    return { binary, supplied: false, cleanup: () => owned.cleanup() };
  } catch (error) {
    await owned.cleanup();
    throw error;
  }
}

export async function cleanupOracle() {
  if (built) await (await built).cleanup();
}

export async function buildOracle() {
  if (!built) {
    built = createOracle();
    // Direct helper users also release their build after outstanding work ends.
    process.once('beforeExit', () => { void cleanupOracle().catch(error => { console.error(error); process.exitCode = 1; }); });
  }
  return (await built).binary;
}

export async function runOracle(fixtures, { timeoutMs = 0 } = {}) {
  await mkdir(temporary, { recursive: true });
  return JSON.parse(await execute(await buildOracle(), [], JSON.stringify(fixtures), repository, timeoutMs));
}

export async function nativeUnicodeLower() {
  return JSON.parse(await execute(await buildOracle(), ['unicode-lower']));
}

export async function nativeUnicodeNormalization() {
  return JSON.parse(await execute(await buildOracle(), ['unicode-normalization']));
}

export async function normalizeWithOracle(samples) {
  return JSON.parse(await execute(await buildOracle(), ['normalize'], JSON.stringify(samples)));
}
