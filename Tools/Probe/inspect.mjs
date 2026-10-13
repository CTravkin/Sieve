// Native Obsidian renderer instrumentation; no browser/UI flow automation.
import { writeFile } from 'node:fs/promises';
import { connectNative } from './native-client.mjs';
import { observedTechnicalIo } from './report.mjs';

const action = process.argv[4] ?? 'report';
if (!['report', 'activate', 'disable', 'quit', 'config-dir'].includes(action)) throw new Error('Unknown native action');
const client = await connectNative(Number(process.argv[2] ?? 9229));
try {
  const report = await client.evaluate(`
    const action = ${JSON.stringify(action)};
    if (action === 'activate' && !app.plugins.isEnabled()) await app.plugins.setEnable(true);
    if (action === 'disable') await app.plugins.setEnable(false);
    if (action === 'config-dir') {
      const configDir = ${JSON.stringify(process.argv[5] ?? '')};
      const fs = require('fs').promises;
      if (!configDir.startsWith('.') || /[/\\\\]/.test(configDir) || configDir === '.') throw new Error('Invalid fixture configDir');
      await fs.access(vaultPath + '/' + configDir + '/plugins/sieve/data.json');
      localStorage.setItem(app.appId + '-config', configDir);
      return { configDir, reopenRequired:true, vault:vaultPath, profile };
    }
    if (action === 'quit') {
      setTimeout(() => require('@electron/remote').app.quit(), 100);
      return { quitting:true, vault:vaultPath, profile };
    }
    return globalThis.sieveProbe ? sieveProbe.report() : { error:'probe-not-loaded', pluginsEnabled:app.plugins.isEnabled(), vault:vaultPath, profile, index:app.vault.getAllLoadedFiles().map(file => file.path).sort(), metadata:app.metadataCache.getCachedFiles().sort() };
  `);
  if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(report, null, 2) + '\n', { flag:'wx' });
  const technicalIndex = report.index?.filter(file => file === 'Technical' || file.startsWith('Technical/'));
  const technicalIo = observedTechnicalIo(report);
  console.log(JSON.stringify({ ...report, index:report.index?.length, metadata:report.metadata?.length, events:report.events?.length, observedStartup:technicalIo !== null, technicalIo, technicalIndexCount:technicalIndex?.length, technicalIndexSample:technicalIndex?.slice(0, 5) }, null, 2));
} finally { client.close(); }
