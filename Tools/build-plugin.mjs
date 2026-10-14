import { build } from 'esbuild';
import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { checkProject } from './check-project.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist/sieve');
await checkProject();
await mkdir(output, { recursive: true });
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const built = await build({
  absWorkingDir: root,
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2020',
  external: ['obsidian', 'electron', '@electron/remote', 'fs', 'fs/promises', 'node:fs', 'node:fs/promises', 'path', 'node:path'],
  loader: { '.md': 'text' },
  legalComments: 'inline',
  outfile: path.join(output, 'main.js'),
  write: false,
  metafile: true,
});
const sourceFiles = new Set(Object.keys(built.metafile.inputs));
async function sourceTree(directory) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await sourceTree(file);
    else sourceFiles.add(file);
  }
}
await sourceTree('src');
sourceFiles.add('Tools/build-plugin.mjs');
try { await readFile(path.join(root, 'styles.css')); sourceFiles.add('styles.css'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const sourceDigest = createHash('sha256').update(JSON.stringify(metadata.devDependencies));
for (const file of [...sourceFiles].sort()) sourceDigest.update(file).update('\0').update(await readFile(path.join(root, file))).update('\0');
const sourceFingerprint = sourceDigest.digest('hex');
let previous;
try { previous = JSON.parse(await readFile(path.join(output, 'identity.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
function increasedVersion(current, prior) {
  const a=current.split('.').map(Number), b=prior.split('.').map(Number);
  for(let index=0;index<3;index++){if(a[index]!==b[index])return a[index]>b[index];}
  return false;
}
if (previous?.sourceFingerprint && previous.sourceFingerprint !== sourceFingerprint &&
    (!increasedVersion(metadata.version, previous.version) || previous.build >= metadata.sieveBuild)) {
  throw new Error('Changed runtime source requires a new development version and build number before packaging');
}
// Node references are confined to the lazy desktop provider. Shared/mobile
// source must not acquire a filesystem or Electron dependency through bundling.
for (const [file, input] of Object.entries(built.metafile.inputs)) {
  for (const entry of input.imports) {
    if (entry.external && entry.path !== 'obsidian' && file !== 'src/platform/desktop.ts') {
      throw new Error(`Runtime import outside desktop provider: ${file}: ${entry.path}`);
    }
  }
}
for (const file of built.outputFiles) await writeFile(file.path, file.contents);
await writeFile(path.join(output, 'manifest.json'), await readFile(path.join(root, 'manifest.json')));
if (sourceFiles.has('styles.css')) await writeFile(path.join(output, 'styles.css'), await readFile(path.join(root, 'styles.css')));
else { try { await unlink(path.join(output, 'styles.css')); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
const notices = (await readFile(path.join(root, 'THIRD-PARTY-NOTICES.md'), 'utf8')).replaceAll('Tools/Oracle/licenses/', 'licenses/');
await writeFile(path.join(output, 'THIRD-PARTY-NOTICES.md'), notices);
await mkdir(path.join(output, 'licenses'), { recursive: true });
for (const name of await readdir(path.join(root, 'Tools/Oracle/licenses'))) {
  await writeFile(path.join(output, 'licenses', name), await readFile(path.join(root, 'Tools/Oracle/licenses', name)));
}
// Preserve the covered source form together with its upstream licenses.
await mkdir(path.join(output, 'src/core'), { recursive: true });
for (const name of await readdir(path.join(root, 'src/core'))) {
  if (name.endsWith('.ts')) await writeFile(path.join(output, 'src/core', name), await readFile(path.join(root, 'src/core', name)));
}
const hash = async file => createHash('sha256').update(await readFile(path.join(output, file))).digest('hex');
const files = ['main.js', 'manifest.json', 'THIRD-PARTY-NOTICES.md'];
if (sourceFiles.has('styles.css')) files.push('styles.css');
for (const name of await readdir(path.join(root, 'Tools/Oracle/licenses'))) files.push(`licenses/${name}`);
for (const name of await readdir(path.join(root, 'src/core'))) if (name.endsWith('.ts')) files.push(`src/core/${name}`);
const identity = {
  privateCandidate: true,
  version: metadata.version,
  build: metadata.sieveBuild,
  sourceFingerprint,
  gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()),
  node: process.version,
  esbuild: metadata.devDependencies.esbuild,
  typescript: metadata.devDependencies.typescript,
  obsidianApi: metadata.devDependencies.obsidian,
  files: Object.fromEntries(await Promise.all(files.map(async file => [file, await hash(file)]))),
};
await writeFile(path.join(output, 'identity.json'), JSON.stringify(identity, null, 2) + '\n');
console.log(JSON.stringify({ output, ...identity }, null, 2));
