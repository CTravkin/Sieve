import { fileURLToPath } from 'node:url';
import path from 'node:path';

const fixtureRoot = path.join(fileURLToPath(new URL('../../', import.meta.url)), 'Local/.temp/SieveProbe').replaceAll('\\', '/') + '/';

export async function connectNative(port = 9229) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local debugger port');
  let target;
  const deadline = Date.now() + 10000;
  while (!target) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) target = (await response.json()).find(tab => tab.type === 'page' && /app\.html|index\.html/.test(tab.url));
    } catch { /* A newly launched native debugger may not be listening yet. */ }
    if (!target) {
      if (Date.now() >= deadline) throw new Error('No native Obsidian vault renderer before timeout');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  const url = new URL(target.webSocketDebuggerUrl);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol !== 'ws:') throw new Error('Debugger must be local');
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('Debugger connection timeout')); }, 5000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Debugger connection failed')); }, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const result = JSON.parse(event.data);
    const request = pending.get(result.id);
    if (!request) return;
    pending.delete(result.id);
    clearTimeout(request.timer);
    if (result.error || result.result?.exceptionDetails) request.reject(new Error(JSON.stringify(result)));
    else request.resolve(result.result.result.value);
  });
  socket.addEventListener('close', () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Debugger closed')); }
    pending.clear();
  });
  return {
    async evaluate(body, { ready = true, timeout = 15000 } = {}) {
      const expression = `(async () => {
        const deadline = Date.now() + 10000;
        while (!globalThis.app?.vault?.adapter || !app.plugins || (${ready} && !app.workspace?.layoutReady)) {
          if (Date.now() > deadline) throw new Error('Native vault readiness timeout');
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        const root = ${JSON.stringify(fixtureRoot)};
        const profile = require('@electron/remote').app.getPath('userData').replaceAll('\\\\','/');
        const vaultPath = app.vault.adapter.basePath.replaceAll('\\\\','/');
        if (!profile.startsWith(root) || !vaultPath.startsWith(root)) throw new Error('Only generated Sieve fixtures are allowed');
        ${body}
      })()`;
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Native evaluation timeout')); }, timeout);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
      });
    },
    close() { socket.close(); },
  };
}
