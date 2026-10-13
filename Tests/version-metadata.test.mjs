import test from 'node:test';
import assert from 'node:assert/strict';
import { validateVersionMetadata } from '../Tools/check-project.mjs';

test('planning assets can remain without a release version or build number', () => {
  assert.deepEqual(validateVersionMetadata({}, {}, {}), { versionAssigned: false, version: null });
});

test('unassigned metadata rejects leftover build, manifest version, or compatibility entries', () => {
  assert.throws(() => validateVersionMetadata({ sieveBuild: 1 }, {}, {}));
  assert.throws(() => validateVersionMetadata({}, { version: '1.2.3' }, {}));
  assert.throws(() => validateVersionMetadata({}, {}, { '1.2.3': '1.14.4' }));
});

test('an explicitly assigned version retains the Obsidian version and separate build number', () => {
  assert.deepEqual(validateVersionMetadata(
    { version: '1.2.3', sieveBuild: 17 },
    { version: '1.2.3', minAppVersion: '1.14.4' },
    { '1.2.3': '1.14.4' },
  ), { versionAssigned: true, version: '1.2.3 (17)' });
});

test('assigned release metadata rejects prefixes and prerelease or build suffixes', () => {
  for (const version of ['v1.2.3', '1.2.3-beta', '1.2.3+17', '1.2.3 (17)', '01.2.3']) {
    assert.throws(() => validateVersionMetadata(
      { version, sieveBuild: 17 },
      { version, minAppVersion: '1.14.4' },
      { [version]: '1.14.4' },
    ));
  }
});

test('assigned metadata rejects mismatched version, host compatibility, and invalid build numbers', () => {
  assert.throws(() => validateVersionMetadata(
    { version: '1.2.3', sieveBuild: 17 }, { version: '1.2.4', minAppVersion: '1.14.4' }, { '1.2.3': '1.14.4' },
  ));
  assert.throws(() => validateVersionMetadata(
    { version: '1.2.3', sieveBuild: 17 }, { version: '1.2.3', minAppVersion: '1.14.4' }, { '1.2.3': '1.13.0' },
  ));
  for (const sieveBuild of [0, -1, 1.5, '17']) {
    assert.throws(() => validateVersionMetadata(
      { version: '1.2.3', sieveBuild }, { version: '1.2.3', minAppVersion: '1.14.4' }, { '1.2.3': '1.14.4' },
    ));
  }
});
