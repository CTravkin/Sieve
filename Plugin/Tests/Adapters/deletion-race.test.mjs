// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntime } from '../Fixtures/load-runtime.mjs';
import { fakeHost } from '../Fixtures/host-adapter.mjs';
const { compileRules } = await loadRuntime('core/matcher');
const { installFilter } = await loadRuntime('platform/lifecycle');

for (const mobile of [false, true]) test(`${mobile ? 'mobile' : 'desktop'} disappearing traversable excluded container uses native deletion recovery`, async () => {
  const host = fakeHost(mobile, ['Transient/keep.md', 'notes/control.md']);
  const compiled = await compileRules('!Transient/keep.md\nTransient', { platform: 'linux' });
  assert.equal(compiled.ok, true);
  assert.equal(compiled.matcher.match('Transient').ignored, true);
  assert.equal(compiled.matcher.match('Transient').canSkipDir, false);
  const hook = installFilter(host.app, compiled.matcher, mobile ? 'android' : 'linux');
  await host.app.vault.load(); host.layout(); await host.metadataCache.drain();
  assert.equal(hook.phase, 'applied');
  assert.ok(host.indexed.has('Transient/keep.md'));
  for (const name of [...host.physical.keys()]) if (name === 'Transient' || name.startsWith('Transient/')) host.physical.delete(name);
  await assert.doesNotReject(host.adapter.reconcileFile('Transient', 'Transient'));
  await host.metadataCache.drain();
  assert.equal(hook.phase, 'applied');
  assert.equal(hook.reloadNeeded, false);
  assert.equal(host.indexed.has('Transient'), false);
  assert.equal(host.indexed.has('Transient/keep.md'), false);
  assert.ok(host.indexed.has('notes/control.md'));
  await host.adapter.writeBinary('Transient/keep.md', new Uint8Array([1, 2]));
  assert.ok(host.indexed.has('Transient/keep.md'), 'later native events remain filtered and operational');
  hook.dispose();
});
