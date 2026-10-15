import { readFile, writeFile } from 'node:fs/promises';
import { runOracle } from './runner.mjs';
import { compileRules } from '../../dist/core/matcher.mjs';

const input = new URL('../../../Local/.temp/Oracle/generated-mismatches.json', import.meta.url);
const differences = JSON.parse(await readFile(input, 'utf8')).filter(x => x.expected);
const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux';

async function isDifferent(fixture) {
  const [oracle] = await runOracle([fixture]);
  const core = await compileRules(fixture.rules, { platform });
  if (!core.ok || oracle.error) return false;
  const { path, ...expected } = oracle.matches[0];
  return Object.keys(expected).some(key => expected[key] !== core.matcher.match(path)[key]);
}

const minimized = [];
for (const { fixture: original } of differences) {
  let fixture = { name: original.name, rules: original.rules, paths: original.paths };
  for (const property of ['rules', 'path']) {
    let chars = Array.from(property === 'rules' ? fixture.rules : fixture.paths[0]);
    for (let i = 0; i < chars.length;) {
      const shortened = [...chars.slice(0, i), ...chars.slice(i + 1)].join('');
      const candidate = property === 'rules' ? { ...fixture, rules: shortened } : { ...fixture, paths: [shortened] };
      if (await isDifferent(candidate)) { fixture = candidate; chars.splice(i, 1); i = 0; } else i++;
    }
  }
  if (!minimized.some(f => f.rules === fixture.rules && f.paths[0] === fixture.paths[0])) minimized.push(fixture);
}
await writeFile(new URL('../../Tests/Fixtures/regressions.json', import.meta.url), JSON.stringify(minimized, null, 2) + '\n');
console.log(`Minimized ${differences.length} mismatches to ${minimized.length} regression fixtures`);
