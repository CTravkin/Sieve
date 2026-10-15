// SPDX-License-Identifier: MPL-2.0
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compileRules } from '../../.build/core/matcher.mjs';
import { runOracle, nativeUnicodeLower } from '../../scripts/Oracle/runner.mjs';
import { upstreamFixtures, upstreamCoverage } from '../Fixtures/upstream.mjs';

const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux';
const normalizePath = p => platform === 'windows' ? p.replaceAll('\\', '/') : p;

async function compare(fixtures, label, t) {
  const native = await runOracle(fixtures);
  const differences = [];
  let matchCount = 0; let errorCount = 0;
  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i]; const oracle = native[i];
    assert.equal(oracle.upstreamCommit, '4461a1ce354d3990660966ad70176e00246adb61');
    assert.equal(oracle.profile.os, platform);
    const result = await compileRules(f.rules, { platform, readInclude: async filename => {
      const key = normalizePath(filename);
      if (Object.hasOwn(f.bytes ?? {}, key)) return Uint8Array.from(f.bytes[key]);
      if (!Object.hasOwn(f.files ?? {}, key)) throw new Error('file not found');
      return f.files[key];
    } });
    if (result.ok !== !oracle.error) {
      differences.push({ fixture: f, native: oracle, portable: result });
      continue;
    }
    if (f.error !== undefined) assert.equal(!!oracle.error, f.error, f.name);
    if (oracle.error) { errorCount++; continue; }
    const nativeHash = oracle.hash;
    if (!result.revision.endsWith(':' + nativeHash)) differences.push({ fixture: f, nativeHash, portableRevision: result.revision });
    for (let j = 0; j < f.paths.length; j++) {
      const { path: filename, ...expected } = oracle.matches[j];
      const actual = result.matcher.match(filename);
      if (f.expected) assert.equal(expected.ignored, f.expected[j], `${f.name}: native expectation ${filename}`);
      if (!Object.keys(expected).every(key => expected[key] === actual[key])) differences.push({ fixture: { ...f, paths: [filename] }, expected, actual });
      matchCount++;
    }
  }
  if (differences.length) {
    const directory = path.join(process.env.SIEVE_TEST_TEMP||tmpdir(),'sieve-oracle');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory,`${label}-mismatches.json`), JSON.stringify(differences, null, 2));
  }
  t.diagnostic(`${label}: ${fixtures.length} fixtures, ${matchCount} path/flag comparisons, ${errorCount} compile errors, ${differences.length} mismatches; native ${platform}`);
  assert.equal(differences.length, 0, JSON.stringify(differences.slice(0, 3), null, 2).slice(0, 3000));
  return { fixtures: fixtures.length, matches: matchCount, errors: errorCount, mismatches: differences.length };
}

test('all pinned upstream syntax and match/traversal rows agree with native lib/ignore', async t => {
  const fixtures = upstreamFixtures(platform);
  await compare(fixtures, 'upstream', t);
  t.diagnostic(`${Object.keys(upstreamCoverage).length} upstream test functions mapped; platform-specific unavailable tests are listed separately`);
});

function generatedFixtures() {
  // Fixed xorshift32 seed. Keep cases replayable, independent of wall-clock/environment.
  let seed = 0x51e7e216;
  const random = n => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % n; };
  const atoms = ['a', 'b', '春', '😀', '?', '*', '**', '[ab]', '[a-z]', '[!x]', '{a,b}', '{a,{b,c}}', '␛?', ' ', '.', '#snapshot'];
  const names = ['a', 'b', 'c', 'x', 'z', 'spring春', '春', '😀', 'ab', 'a/b', 'b/a', 'a😀', 'a?', '#snapshot', '.', 'x.txt', 'a.md', 'A', 'İ', 'Σ', '𐐀'];
  const fixtures = [];
  for (let i = 0; i < 512; i++) {
    const rules = [];
    const size = random(6) + 1;
    for (let j = 0; j < size; j++) {
      const prefix = ['', '!', '(?i)', '(?d)', '(?i)!(?d)', '!!', '(?i)(?i)'][random(7)];
      const root = ['', '/', '**/'][random(3)];
      let body = atoms[random(atoms.length)];
      if (random(2)) body += atoms[random(atoms.length)];
      if (random(3) === 0) body += '/' + atoms[random(atoms.length)];
      body += ['', '/', '/**'][random(3)];
      rules.push(prefix + root + body);
    }
    const paths = Array.from({ length: 24 }, () => {
      const n = names[random(names.length)];
      return random(3) ? n : names[random(names.length)] + '/' + n;
    });
    fixtures.push({ name: `seed-51e7e216/${i}`, rules: rules.join('\n'), paths });
  }
  return fixtures;
}

test('fixed-seed generated patterns and paths have zero native flag differences', async t => {
  await compare(generatedFixtures(), 'generated', t);
});

test('minimized native optimizer regressions remain in the replay corpus', async t => {
  const fixtures = JSON.parse(await readFile(new URL('../Fixtures/regressions.json', import.meta.url), 'utf8'));
  fixtures.push({ name: 'overlapping-prefix-suffix', rules: 'a/**/b', paths: ['a/b', 'a/x/b', 'deep/a/b'] });
  await compare(fixtures, 'regressions', t);
});

test('all Go simple Unicode lowercase mappings and rune boundaries agree', async t => {
  const { unicode, pairs } = await nativeUnicodeLower();
  assert.equal(unicode, '17.0.0', 'Regenerate and review the pinned Unicode data before changing oracle toolchain');
  const fixtures = pairs.map(([upper, lower], i) => ({ name: `simple-lower/${i}`, rules: '(?i)/x' + String.fromCodePoint(upper), paths: ['x' + String.fromCodePoint(upper), 'x' + String.fromCodePoint(lower)] }));
  fixtures.push(
    { name: 'rune-wildcards', rules: '/x?\n/春[😀-🙏]\n/😀[!a]', paths: ['x😀', 'x春', 'x𐐀', 'xa/b', '春😁', '😀😀', '😀/', '😀a'] },
    { name: 'Go-context-independent-lower', rules: '(?i)/ΟΣ\n(?i)/İ\n(?i)/ẞ', paths: ['οσ', 'ος', 'i', 'i̇', 'ß'] },
    { name: 'normalization-NFC-native-input', rules: 'café\n*ä*', paths: ['café', 'åäö'].map(s => s.normalize(platform === 'darwin' ? 'NFD' : 'NFC')) },
    { name: 'multibyte-escape', rules: '#escape=😀\n😀{春😀}.md\n😀😀', paths: ['{春}.md', '😀'] },
    { name: 'literal-replacement-rune', rules: '\ufffd', paths: ['\ufffd'] },
    { name: 'invalid-byte-rule', rules: '#include a', bytes: { a: [0xff, 0x61] }, paths: ['a'] },
    { name: 'invalid-byte-comment', rules: '#include a', bytes: { a: [0x2f, 0x2f, 0xff] }, paths: ['a'] },
    { name: 'invalid-byte-long-comment', rules: '#include a', bytes: { a: [0x2f, 0x2f, ...Array(40000).fill(255)] }, paths: ['a'] },
    { name: 'UTF8-BOM', rules: '#include a', bytes: { a: [0xef, 0xbb, 0xbf, 0x61] }, paths: ['a', '\ufeffa'] },
  );
  await compare(fixtures, 'unicode', t);
});

test('include graphs, lexical aliases, escape state and malformed source agree', async t => {
  await compare([
    { name: 'nested', rules: '#include filters/a', files: { 'filters/a': '#include b\na', 'filters/b': 'b' }, paths: ['a', 'b', 'filters/a'] },
    { name: 'include-directive-dedup', rules: '#include a\n#include a', files: { a: 'drop' }, paths: ['drop'] },
    { name: 'multiple-include', rules: '#include a\n#include ./a', files: { a: 'drop' }, paths: ['drop'], error: true },
    { name: 'global-line-dedup-across-files', rules: '#include a\n#include b\n*', files: { a: '!keep', b: '!keep\n*' }, paths: ['keep', 'drop'] },
    { name: 'local-escape', rules: '#include a\n#escape=|\nroot|{name|}', files: { a: '#escape=\\\nchild\\{name\\}' }, paths: ['root{name}', 'child{name}'] },
    { name: 'cycle-dedup', rules: '#include a', files: { a: '#include b\na', b: '#include a\nb' }, paths: ['a', 'b'] },
    { name: 'cycle-alias', rules: '#include a', files: { a: '#include b', b: '#include ./a' }, paths: [], error: true },
    { name: 'included-main-virtual-source', rules: '#include .stignore', files: { '.stignore': '#include .stignore\ndrop' }, paths: ['drop'] },
    { name: 'include-tabs-not-space', rules: '#include\ta', files: { a: 'drop' }, paths: ['drop'], error: true },
    { name: 'include-prefix-literal', rules: '#included a', files: { a: 'drop' }, paths: ['drop'] },
    { name: 'Go-whitespace-not-JS', rules: '\u0085a\u0085\n\ufeffb', paths: ['a', 'b', '\ufeffb'] },
    { name: 'scanner-oversized-token', rules: 'a'.repeat(65536), paths: [], error: true },
    { name: 'scanner-maximum-token', rules: 'a'.repeat(65535) + '\n', paths: [] },
    { name: 'nested-error', rules: '// header\n#include a', files: { a: '// child\n[' }, paths: [], error: true },
    { name: 'deep-brace-alternatives', rules: '{'.repeat(2000) + 'a' + '}'.repeat(2000), paths: ['a', 'b'] },
    ...['{a,a*}', '{a*b,a*b}', '{a*,a?,a}', 'a{,b}', '{a,{}}', '{a*,a*}b'].map((rules,i) => ({ name:`alternative-optimizer/${i}`, rules, paths:['','a','ab','aa','ab/😀','axb','a😀b','deep/a','deep/ab'] })),
  ], 'includes', t);
});

test('every RU and EN syntax example executes through the native oracle', async t => {
  const examples = [];
  for (const file of ['Syntax.en.md', 'Syntax.ru.md']) {
    const source = await readFile(new URL(`../../../Docs/${file}`, import.meta.url), 'utf8');
    for (const [index, block] of [...source.matchAll(/```text\r?\n([\s\S]*?)```/g)].entries()) {
      examples.push({ name: `${file}/fence/${index}`, rules: block[1], files: { 'filters/common.stignore': 'technical' }, paths: ['node_modules', 'build', 'dist', 'nested/node_modules/a.md', 'readme.md', 'nested/readme.MD', 'image.png', 'drop.tmp', 'technical', '{draft}.md'] });
    }
    const inline = [...source.matchAll(/`([^`\r\n]+)`/g)].map(m => m[1]);
    const patterns = ['*', '**', '?', '[abc]', '[a-z]', '[!a-z]', '{md,txt,pdf}', 'node_modules', 'node_modules/', 'a/**/b', '(?i)!*.md', '(?d)(?i)*.tmp', '(?di)', '\\{draft\\}.md', '|{draft|}.md'];
    for (const rule of patterns.filter(p => inline.includes(p))) examples.push({ name: `${file}/inline/${rule}`, rules: rule, paths: ['node_modules', 'node_modules/a.md', 'a/b', 'a/x/b', 'draft.md', '{draft}.md', 'file.tmp', 'FILE.TMP', 'x', 'a', 'md', 'drop.txt'] });
  }
  await compare(examples, 'help-examples', t);
});
