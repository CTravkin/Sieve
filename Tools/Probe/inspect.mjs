// Native Obsidian renderer instrumentation; no browser/UI flow automation.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { observedTechnicalIo } from './report.mjs';

const port = Number(process.argv[2] ?? 9229);
const action = process.argv[4] ?? 'report';
if (!['report', 'activate', 'disable', 'quit'].includes(action)) throw new Error('Unknown native action');
const fixtureRoot = path.join(fileURLToPath(new URL('../../', import.meta.url)), 'Local/.temp/SieveProbe').replaceAll('\\', '/');
const expression = `(async () => JSON.stringify(await (async () => {
  const root = ${JSON.stringify(fixtureRoot)} + '/';
  const profile = require('@electron/remote').app.getPath('userData').replaceAll('\\\\', '/');
  const vault = app.vault.adapter.basePath.replaceAll('\\\\', '/');
  if (!profile.startsWith(root) || !vault.startsWith(root)) throw new Error('Only generated Sieve fixtures are allowed');
  if (${JSON.stringify(action)} === 'activate' && !app.plugins.isEnabled()) await app.plugins.setEnable(true);
  if (${JSON.stringify(action)} === 'disable') await app.plugins.setEnable(false);
  if (${JSON.stringify(action)} === 'quit') {
    setTimeout(() => require('@electron/remote').app.quit(), 100);
    return { quitting: true, vault, profile };
  }
  return globalThis.sieveProbe ? globalThis.sieveProbe.report() : { error:'probe-not-loaded', pluginsEnabled:app.plugins.isEnabled(), vault, profile, index:app.vault.getAllLoadedFiles().map(file => file.path).sort(), metadata:app.metadataCache.getCachedFiles().sort() };
})()))()`;
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local debugger port');
const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
const target = tabs.find((tab) => tab.type === 'page' && /app\.html|index\.html/.test(tab.url));
if (!target) throw new Error('No native Obsidian vault renderer');
const socketUrl = new URL(target.webSocketDebuggerUrl);
if (!['127.0.0.1', 'localhost'].includes(socketUrl.hostname) || socketUrl.protocol !== 'ws:') throw new Error('Debugger must be local');
const socket = new WebSocket(socketUrl);
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Debugger connection timeout')), 5000);
  socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
  socket.addEventListener('error', (event) => { clearTimeout(timeout); reject(event); }, { once: true });
});
try {
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Native report timeout')), 10000);
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id === 1) { clearTimeout(timeout); resolve(message); }
    });
    socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
      expression,
      returnByValue: true,
      awaitPromise: true,
    } }));
  });
  if (result.error || result.result?.exceptionDetails) throw new Error(JSON.stringify(result));
  const report = JSON.parse(result.result.result.value);
  if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  const technicalIndex = report.index?.filter((file) => file.startsWith('Technical'));
  const technicalIo = observedTechnicalIo(report);
  console.log(JSON.stringify({ ...report, index: report.index?.length, metadata: report.metadata?.length, events: report.events?.length, observedStartup: technicalIo !== null, technicalIo, technicalIndexCount: technicalIndex?.length, technicalIndexSample: technicalIndex?.slice(0, 5) }, null, 2));
} finally {
  socket.close();
}
