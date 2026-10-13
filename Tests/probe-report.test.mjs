import test from 'node:test';
import assert from 'node:assert/strict';
import { observedTechnicalIo } from '../Tools/Probe/report.mjs';

const started = { status: 'ready', truncated: false, counts: { 'lifecycle:vault-load-start': 1, 'scanner:listAll': 1, 'lifecycle:layout-ready': 1 }, events: [] };

test('a truncated native trace cannot claim zero I/O', () => {
  assert.equal(observedTechnicalIo({ ...started, truncated: true }), null);
});

test('a report without a measured startup cannot claim zero I/O', () => {
  assert.equal(observedTechnicalIo({ ...started, counts: {} }), null);
});

test('a complete startup trace counts only actual technical filesystem calls', () => {
  assert.equal(observedTechnicalIo({ ...started, events: [
    { kind: 'scanner', path: 'Technical' },
    { kind: 'io', path: 'Technical' },
    { kind: 'io', path: 'Technical/deep/keep.md' },
    { kind: 'io', path: 'Docs/note.md' },
  ] }), 2);
});
