// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeUnicodeNormalization, normalizeWithOracle } from '../../scripts/Oracle/runner.mjs';
import { loadCoreModule } from '../Fixtures/load-core.mjs';

test('pinned normalization matches native Go on every decomposition, composition, CCC and Hangul syllable', async t => {
  const tables = await nativeUnicodeNormalization();
  const { nativeNormalize } = await loadCoreModule('normalize');
  const samples = [];
  for (const [cp, decomposed] of tables.decompositions) samples.push(String.fromCodePoint(cp), String.fromCodePoint(...decomposed));
  for (const [cp] of tables.combining) samples.push(String.fromCodePoint(cp));
  for (const [a,b] of tables.compositions) samples.push(String.fromCodePoint(a,b));
  for (let cp = 0xac00; cp <= 0xd7a3; cp++) samples.push(String.fromCodePoint(cp));
  for (const cp of [0x300,0x315,0x340,0x344,0x35d,0xf71,0xf81,0xff9e,0x1161,0x11a8]) {
    for (const amount of [29,30,31,60,61]) samples.push('Õ' + String.fromCodePoint(cp).repeat(amount));
  }
  let seed = 0x1700f01d;
  const random = n => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % n; };
  const pool = [...tables.combining.map(([cp]) => cp), 0x61,0x1100,0x1161,0x11a8,0xac00,0x1f600,0xff9e,0x034f];
  for (let i = 0; i < 1024; i++) samples.push(String.fromCodePoint(...Array.from({ length: random(64)+1 }, () => pool[random(pool.length)])));
  const expected = await normalizeWithOracle(samples);
  const differences = [];
  for (let i = 0; i < samples.length; i++) {
    const NFC = nativeNormalize(samples[i], 'linux'); const NFD = nativeNormalize(samples[i], 'ios');
    if (NFC !== expected[i].NFC || NFD !== expected[i].NFD) differences.push({ input:samples[i], actual:{NFC,NFD}, expected:expected[i] });
  }
  t.diagnostic(`${samples.length} samples, ${samples.length*2} NFC/NFD native comparisons, ${differences.length} mismatches; Unicode ${tables.unicode}, native stream-safe CGJ included`);
  assert.equal(differences.length,0,JSON.stringify(differences.slice(0,5),null,2));
});
