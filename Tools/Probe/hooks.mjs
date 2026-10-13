// Diagnostic prefix decisions only. This is not the Syncthing matcher.
export function observeVaultLoad(vault, record) {
  const original = vault.load;
  const descriptor = Object.getOwnPropertyDescriptor(vault, 'load');
  let active = true;
  const wrapper = function (...args) {
    const started = performance.now();
    const finish = (method) => { if (active) record({ kind: 'lifecycle', method, durationMs: performance.now() - started }); };
    if (active) record({ kind: 'lifecycle', method: 'vault-load-start' });
    let result;
    try { result = original.apply(this, args); }
    catch (error) { finish('vault-load-error'); throw error; }
    if (result && typeof result.then === 'function') result.then(() => finish('vault-load-end'), () => finish('vault-load-error'));
    else finish('vault-load-end');
    return result;
  };
  vault.load = wrapper;
  return () => {
    active = false;
    if (vault.load !== wrapper) return;
    if (descriptor) Object.defineProperty(vault, 'load', descriptor);
    else delete vault.load;
  };
}

export function installProbeHooks(adapter, options, record) {
  const required = ['listRecursiveChild', 'reconcileFile', 'reconcileFileInternal', 'listRecursive', 'listAll', 'trigger'];
  const patchable = (key) => {
    const descriptor = Object.getOwnPropertyDescriptor(adapter, key);
    return descriptor ? descriptor.configurable : Object.isExtensible(adapter);
  };
  if (options.probeFixture !== true || !required.every((key) => typeof adapter[key] === 'function') || typeof adapter.removeFile !== 'function' || !adapter.fsPromises || ![...required, 'fsPromises'].every(patchable)) {
    return { status: 'unsupported', dispose() {} };
  }
  let active = true;
  const restores = [];
  const normalized = (value) => {
    const text = String(value).replaceAll('\\', '/').normalize('NFC');
    return adapter.insensitive ? text.toLowerCase() : text;
  };
  const excluded = options.excluded.map(normalized);
  const included = options.included.map(normalized);
  const configDir = normalized(options.configDir ?? '.obsidian');
  const within = (path, root) => path === root || path.startsWith(`${root}/`);
  function skip(path) {
    if (!active || !options.filtered || typeof path !== 'string') return false;
    const name = normalized(path);
    if (within(name, configDir)) return false;
    return excluded.some((root) => within(name, root)) && !included.some((allowed) => within(name, allowed) || allowed.startsWith(`${name}/`));
  }
  function wrap(owner, key, body) {
    const original = owner[key];
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    const wrapper = function (...args) {
      return active ? body.call(this, original, args) : original.apply(this, args);
    };
    Object.defineProperty(owner, key, { configurable: true, writable: true, enumerable: descriptor?.enumerable ?? true, value: wrapper });
    restores.push(() => {
      if (owner[key] !== wrapper) return;
      if (descriptor) Object.defineProperty(owner, key, descriptor);
      else delete owner[key];
    });
  }
  wrap(adapter, 'trigger', function (original, args) {
    // Desktop rename bypasses reconcileFile. Let the host update any retained
    // TFile path first, then forget only the adapter/index entry. removeFile is
    // the host's in-memory bookkeeping method, never a filesystem operation.
    const result = original.apply(this, args);
    if (args[0] === 'renamed' && skip(args[1])) {
      this.removeFile(args[1]);
      record({ kind: 'index-prune', method: 'renamed', path: args[1] });
    }
    return result;
  });
  for (const key of ['listRecursiveChild', 'reconcileFile', 'reconcileFileInternal']) {
    wrap(adapter, key, function (original, args) {
      const path = key === 'listRecursiveChild' ? (args[0] ? `${args[0]}/${args[1]}` : args[1]) : args[0];
      if (skip(path)) {
        record({ kind: 'skip', method: key, path });
        return Promise.resolve();
      }
      record({ kind: 'scanner', method: key, path });
      return original.apply(this, args);
    });
  }
  for (const key of ['listRecursive', 'listAll']) {
    wrap(adapter, key, function (original, args) {
      record({ kind: 'scanner', method: key, path: args[0] ?? '' });
      return original.apply(this, args);
    });
  }
  // Instrument this adapter's fs reference; never modify node:fs.promises itself.
  const originalFs = adapter.fsPromises;
  const descriptor = Object.getOwnPropertyDescriptor(adapter, 'fsPromises');
  const observedFs = Object.create(originalFs);
  for (const key of ['readdir', 'lstat', 'stat', 'readFile', 'realpath']) {
    if (typeof originalFs[key] !== 'function') continue;
    Object.defineProperty(observedFs, key, { configurable: true, writable: true, value: function (...args) {
      if (active) {
        const base = String(adapter.basePath).replaceAll('\\', '/').replace(/\/$/, '');
        const full = String(args[0]).replaceAll('\\', '/');
        record({ kind: 'io', method: key, path: full.startsWith(`${base}/`) ? full.slice(base.length + 1) : full === base ? '' : '<outside-vault>' });
      }
      return originalFs[key].apply(originalFs, args);
    } });
  }
  Object.defineProperty(adapter, 'fsPromises', { configurable: true, writable: true, enumerable: descriptor?.enumerable ?? true, value: observedFs });
  restores.push(() => {
    if (adapter.fsPromises !== observedFs) return;
    if (descriptor) Object.defineProperty(adapter, 'fsPromises', descriptor);
    else delete adapter.fsPromises;
  });
  return {
    status: 'ready',
    dispose() {
      if (!active) return;
      active = false;
      for (const restore of restores.reverse()) restore();
    },
  };
}
