import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { checkProject } from '../check-project.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
await checkProject();
const output = path.join(root, 'dist/sieve-probe');
await mkdir(output, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ['Tools/Probe/main.js'],
  bundle: true,
  external: ['obsidian'],
  platform: 'browser',
  format: 'cjs',
  target: 'es2020',
  outfile: path.join(output, 'main.js'),
  metafile: true,
}).then(async (result) => {
  const imports = Object.values(result.metafile.outputs).flatMap((entry) => entry.imports);
  if (imports.some((entry) => entry.path !== 'obsidian')) throw new Error('Unexpected runtime import');
});
await writeFile(path.join(output, 'manifest.json'), await readFile(path.join(root, 'manifest.json')));
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const sha256 = async (file) => createHash('sha256').update(await readFile(file)).digest('hex');
const identity = {
  probe: true,
  version: metadata.version,
  build: metadata.sieveBuild,
  gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()),
  node: process.version,
  esbuild: metadata.devDependencies.esbuild,
  files: Object.fromEntries(await Promise.all(['main.js', 'manifest.json'].map(async (file) => [file, await sha256(path.join(output, file))]))),
};
await writeFile(path.join(output, 'identity.json'), JSON.stringify(identity, null, 2) + '\n');
console.log(JSON.stringify({ output, ...identity }, null, 2));
