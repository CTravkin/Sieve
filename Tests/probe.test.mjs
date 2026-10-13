import test from 'node:test';
import assert from 'node:assert/strict';
import { installProbeHooks, observeVaultLoad } from '../Tools/Probe/hooks.mjs';

function host() {
  const calls = [];
  const adapter = {
    basePath: '/fixture',
    trigger() {},
    removeFile() {},
    fsPromises: {
      async readdir(path) { calls.push(['readdir', path]); return []; },
      async lstat(path) { calls.push(['lstat', path]); return {}; },
      async readFile(path) { calls.push(['readFile', path]); return 'content'; },
    },
    async listRecursiveChild(parent, name) {
      const path = parent ? `${parent}/${name}` : name;
      calls.push(['raw', path]);
      await this.reconcileFileInternal(path, path);
    },
    async reconcileFile(path, normalized) {
      calls.push(['raw', normalized]);
      await this.reconcileFileInternal(path, normalized);
    },
    async reconcileFileInternal(path) { await this.fsPromises.lstat(`${this.basePath}/${path}`); },
    async listRecursive(path) { await this.fsPromises.readdir(`${this.basePath}/${path}`); },
    async listAll() { await this.listRecursive(''); },
    async read(path) { return this.fsPromises.readFile(`${this.basePath}/${path}`); },
  };
  return { adapter, calls };
}

test('pruned initial and event paths never reach raw or scanner I/O', async () => {
  const { adapter, calls } = host();
  const events = [];
  const hooks = installProbeHooks(adapter, { probeFixture: true, excluded: ['Technical'], included: [], filtered: true }, (event) => events.push(event));
  assert.equal(hooks.status, 'ready');
  await adapter.listRecursiveChild('', 'Technical');
  await adapter.reconcileFile('Technical/secret.md', 'Technical/secret.md');
  await adapter.reconcileFileInternal('Technical/direct.md', 'Technical/direct.md');
  assert.deepEqual(calls, []);
  assert.equal(events.filter((event) => event.kind === 'skip').length, 3);
});

test('allowed descendant and its containers survive while siblings are pruned', async () => {
  const { adapter, calls } = host();
  installProbeHooks(adapter, { probeFixture: true, excluded: ['Technical'], included: ['Technical/deep/keep.md'], filtered: true }, () => {});
  await adapter.listRecursiveChild('', 'Technical');
  await adapter.listRecursiveChild('Technical', 'deep');
  await adapter.listRecursiveChild('Technical/deep', 'keep.md');
  await adapter.listRecursiveChild('Technical/deep', 'other.md');
  assert.deepEqual(calls, [
    ['raw', 'Technical'], ['lstat', '/fixture/Technical'],
    ['raw', 'Technical/deep'], ['lstat', '/fixture/Technical/deep'],
    ['raw', 'Technical/deep/keep.md'], ['lstat', '/fixture/Technical/deep/keep.md'],
  ]);
});

test('filtering preserves direct reads and access to the configured configDir', async () => {
  const { adapter, calls } = host();
  installProbeHooks(adapter, { probeFixture: true, excluded: ['Technical', '.config'], included: [], configDir: '.config', filtered: true }, () => {});
  assert.equal(await adapter.read('Technical/include.txt'), 'content');
  await adapter.reconcileFile('.config/plugins/sieve/data.json', '.config/plugins/sieve/data.json');
  assert.deepEqual(calls, [
    ['readFile', '/fixture/Technical/include.txt'],
    ['raw', '.config/plugins/sieve/data.json'],
    ['lstat', '/fixture/.config/plugins/sieve/data.json'],
  ]);
});

test('baseline observation does not filter and records actual filesystem calls', async () => {
  const { adapter, calls } = host();
  const events = [];
  installProbeHooks(adapter, { probeFixture: true, excluded: ['Technical'], included: [], filtered: false }, (event) => events.push(event));
  await adapter.listRecursiveChild('', 'Technical');
  assert.deepEqual(calls, [['raw', 'Technical'], ['lstat', '/fixture/Technical']]);
  assert.ok(events.some((event) => event.kind === 'io' && event.method === 'lstat' && event.path === 'Technical'));
});

test('dispose is idempotent and restores instance properties', () => {
  const { adapter } = host();
  const originalChild = adapter.listRecursiveChild;
  const originalFs = adapter.fsPromises;
  const hooks = installProbeHooks(adapter, { probeFixture: true, excluded: [], included: [], filtered: true }, () => {});
  assert.notEqual(adapter.listRecursiveChild, originalChild);
  assert.notEqual(adapter.fsPromises, originalFs);
  hooks.dispose();
  hooks.dispose();
  assert.equal(adapter.listRecursiveChild, originalChild);
  assert.equal(adapter.fsPromises, originalFs);
});

test('dispose preserves a later foreign wrapper while making its retained Sieve wrapper inert', async () => {
  const { adapter, calls } = host();
  const hooks = installProbeHooks(adapter, { probeFixture: true, excluded: ['Technical'], included: [], filtered: true }, () => {});
  const sieveChild = adapter.listRecursiveChild;
  const foreign = async function (...args) { calls.push(['foreign']); return sieveChild.apply(this, args); };
  adapter.listRecursiveChild = foreign;
  hooks.dispose();
  assert.equal(adapter.listRecursiveChild, foreign);
  await adapter.listRecursiveChild('', 'Technical');
  assert.deepEqual(calls, [['foreign'], ['raw', 'Technical'], ['lstat', '/fixture/Technical']]);
});

test('unsupported adapters remain untouched rather than receiving a partial filter', () => {
  const adapter = { async listRecursiveChild() {} };
  const original = adapter.listRecursiveChild;
  const hooks = installProbeHooks(adapter, { probeFixture: true, excluded: [], included: [], filtered: true }, () => {});
  assert.equal(hooks.status, 'unsupported');
  assert.equal(adapter.listRecursiveChild, original);
});

test('a locked later adapter method rejects the whole installation before changing earlier methods', () => {
  const { adapter } = host();
  const originalChild = adapter.listRecursiveChild;
  const originalFs = adapter.fsPromises;
  Object.defineProperty(adapter, 'reconcileFileInternal', { configurable: false, writable: false, value: adapter.reconcileFileInternal });
  const hooks = installProbeHooks(adapter, { probeFixture: true, excluded: ['Technical'], included: [], filtered: true }, () => {});
  assert.equal(hooks.status, 'unsupported');
  assert.equal(adapter.listRecursiveChild, originalChild);
  assert.equal(adapter.fsPromises, originalFs);
});

test('a retained lifecycle wrapper stops recording after unload and preserves its original receiver', () => {
  const events = [];
  const vault = { loads: 0, load() { this.loads++; return this.loads; } };
  const dispose = observeVaultLoad(vault, (event) => events.push(event));
  assert.equal(vault.load(), 1);
  const sieveLoad = vault.load;
  const foreign = function (...args) { return sieveLoad.apply(this, args); };
  vault.load = foreign;
  dispose();
  dispose();
  assert.equal(vault.load, foreign);
  assert.equal(vault.load(), 2);
  assert.equal(events.length, 2);
});

test('startup timing observes asynchronous completion without replacing the host promise', async () => {
  const events = [];
  let complete;
  const promise = new Promise(resolve => { complete = resolve; });
  const vault = { load: () => promise };
  const dispose = observeVaultLoad(vault, event => events.push(event));
  assert.equal(vault.load(), promise);
  assert.equal(events.length, 1);
  complete('loaded');
  assert.equal(await promise, 'loaded');
  assert.equal(events[1].method, 'vault-load-end');
  assert.ok(events[1].durationMs >= 0);
  dispose();
});

test('copying a probe into an unmarked vault cannot activate filtering', () => {
  const { adapter } = host();
  const originalChild = adapter.listRecursiveChild;
  const hooks = installProbeHooks(adapter, { excluded: ['Technical'], included: [], filtered: true }, () => {});
  assert.equal(hooks.status, 'unsupported');
  assert.equal(adapter.listRecursiveChild, originalChild);
});

test('a rename into an excluded path updates retained file references before removing only index entries', () => {
  const { adapter, calls } = host();
  const retained = { path: 'Docs/note.md', deleted: false };
  const index = new Map([[retained.path, retained]]);
  adapter.files = { [retained.path]: { realpath: retained.path } };
  adapter.trigger = (type, path, oldPath) => {
    calls.push([type, path, oldPath]);
    if (type === 'renamed') {
      const file = index.get(oldPath);
      if (file) { index.delete(oldPath); file.path = path; index.set(path, file); }
    } else if (type === 'file-removed') {
      const file = index.get(path);
      if (file) { file.deleted = true; index.delete(path); }
    }
  };
  adapter.removeFile = function (path) {
    delete this.files[path];
    this.trigger('file-removed', path);
  };
  const events = [];
  installProbeHooks(adapter, { probeFixture: true, excluded: ['Technical'], included: [], filtered: true }, (event) => events.push(event));
  adapter.files['Technical/note.md'] = adapter.files['Docs/note.md'];
  delete adapter.files['Docs/note.md'];
  adapter.trigger('renamed', 'Technical/note.md', 'Docs/note.md');
  assert.equal(retained.path, 'Technical/note.md');
  assert.equal(retained.deleted, true);
  assert.equal(index.size, 0);
  assert.deepEqual(adapter.files, {});
  assert.deepEqual(calls, [['renamed', 'Technical/note.md', 'Docs/note.md'], ['file-removed', 'Technical/note.md', undefined]]);
  assert.deepEqual(events.filter(event => event.kind === 'index-prune'), [{kind: 'index-prune', method: 'renamed', path: 'Technical/note.md'}]);
});
