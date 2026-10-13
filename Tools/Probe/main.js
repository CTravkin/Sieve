import { Plugin, Platform, apiVersion, Notice } from 'obsidian';
import { installProbeHooks, observeVaultLoad } from './hooks.mjs';

// Disposable research plugin. Prefix fixtures do not implement filter syntax.
export default class SieveProbe extends Plugin {
  async onload() {
    const started = performance.now();
    this.events = [{ kind: 'lifecycle', method: 'onload-start', at: started }];
    this.counts = {};
    const record = (event) => {
      const key = `${event.kind}:${event.method}`;
      this.counts[key] = (this.counts[key] ?? 0) + 1;
      if (this.events.length < 100000) this.events.push({ ...event, at: performance.now() });
    };
    this.options = { excluded: ['Technical'], included: [], filtered: false, ...(await this.loadData()), configDir: this.app.vault.configDir };
    if (this.options.probeFixture !== true) return;
    await new Promise((resolve) => setTimeout(resolve, this.options.prepareDelayMs ?? 50));
    const vault = this.app.vault;
    this.register(observeVaultLoad(vault, record));
    this.hooks = installProbeHooks(vault.adapter, this.options, record);
    this.register(() => this.hooks.dispose());
    this.report = () => ({
      probe: true,
      version: this.manifest.version,
      apiVersion,
      desktop: Platform.isDesktopApp,
      mobile: Platform.isMobileApp,
      adapter: vault.adapter.constructor.name,
      capabilities: Object.fromEntries(['listAll', 'watchAndList', 'listRecursiveChild', 'reconcileFile', 'reconcileFileInternal', 'fsPromises', 'fs'].map((key) => [key, typeof vault.adapter[key]])),
      status: this.hooks.status,
      filtered: this.options.filtered,
      configDir: vault.configDir,
      vaultName: vault.getName(),
      index: vault.getAllLoadedFiles().map((file) => file.path).sort(),
      metadata: this.app.metadataCache.getCachedFiles().sort(),
      counts: this.counts,
      observedStartup: this.counts['lifecycle:vault-load-start'] === 1 && this.counts['scanner:listAll'] === 1,
      events: this.events,
      truncated: Object.values(this.counts).reduce((sum, count) => sum + count, 0) >= 100000,
    });
    globalThis.sieveProbe = this;
    this.register(() => { if (globalThis.sieveProbe === this) delete globalThis.sieveProbe; });
    this.addCommand({ id: 'export-probe-report', name: 'Export probe report', callback: async () => {
      const file = `${vault.configDir}/plugins/sieve/probe-report.json`;
      await vault.adapter.write(file, JSON.stringify(this.report(), null, 2));
      new Notice(file);
    } });
    record({ kind: 'lifecycle', method: 'hooks-ready' });
    this.app.workspace.onLayoutReady(() => record({ kind: 'lifecycle', method: 'layout-ready' }));
    record({ kind: 'lifecycle', method: 'onload-end' });
  }
}
