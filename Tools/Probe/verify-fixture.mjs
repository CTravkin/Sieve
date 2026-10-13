import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const fixtureRoot = fileURLToPath(new URL('../../Local/.temp/SieveProbe/', import.meta.url));
const run = path.resolve(process.argv[2] ?? '');
const within = (file, root) => {
  const relative = path.relative(root, file);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
};
if (!within(run, fixtureRoot)) throw new Error('Only generated Sieve fixtures are allowed');
const definition = JSON.parse(await readFile(path.join(run, 'run.json'), 'utf8'));
const inventory = JSON.parse(await readFile(path.join(run, 'inventory.json'), 'utf8'));
let checked = 0;
const failures = [];
for (const variant of definition.vaults) {
  const vault = path.resolve(variant.vault);
  if (!within(vault, run)) throw new Error('Vault escapes the selected fixture');
  const config = JSON.parse(await readFile(path.join(vault, variant.configDir ?? '.obsidian', 'plugins/sieve/data.json'), 'utf8'));
  if (config.probeFixture !== true) throw new Error('Unmarked fixture');
  for (const [file, expected] of Object.entries(inventory)) {
    const target = path.resolve(vault, file);
    if (!within(target, vault)) throw new Error('Inventory path escapes the vault');
    const actual = createHash('sha256').update(await readFile(target)).digest('hex');
    if (actual !== expected) failures.push({ variant:variant.name, file });
    checked++;
  }
}
const report = { run, variants:definition.vaults.length, checked, failures, status:failures.length ? 'FAIL' : 'PASS' };
if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(report, null, 2) + '\n', {flag:'wx'});
console.log(JSON.stringify(report));
if (failures.length) process.exitCode = 1;
