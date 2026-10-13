import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCoreModule } from '../Fixtures/load-core.mjs';

test('normalization is pinned without relying on the host ICU tables', async () => {
  const { nativeNormalize } = await loadCoreModule('normalize');
  const original = String.prototype.normalize;
  String.prototype.normalize = () => { throw new Error('Host normalization unavailable'); };
  try {
    assert.equal(nativeNormalize('cafe\u0301', 'linux'), 'café');
    assert.equal(nativeNormalize('café', 'ios'), 'cafe\u0301');
    assert.equal(nativeNormalize('\u1100\u1161\u11a8', 'windows'), '각');
    assert.equal(nativeNormalize('각', 'darwin'), '\u1100\u1161\u11a8');
    assert.equal(nativeNormalize('a\u0315\u0300', 'linux'), 'à\u0315');
    assert.equal(nativeNormalize('\u0344', 'android'), '\u0308\u0301');
  } finally { String.prototype.normalize = original; }
});
