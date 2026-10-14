import { writeFile } from 'node:fs/promises';
import { connectNative } from '../Probe/native-client.mjs';

const action = process.argv[4] ?? 'report';
if (!['report','activate','disable','quit','config-dir'].includes(action)) throw new Error('Unknown runtime fixture action');
let client = await connectNative(Number(process.argv[2] ?? 9229));
try {
  const body = `
    if(!vaultPath.includes('/SieveProbe/Runtime-')||!profile.includes('/SieveProbe/Runtime-'))throw new Error('Actual-runtime fixtures required');
    const action=${JSON.stringify(action)};
    if(action==='config-dir'){
      const configDir=${JSON.stringify(process.argv[5] ?? '')};
      if(!configDir.startsWith('.')||/[/\\\\]/.test(configDir)||configDir==='.')throw new Error('Invalid fixture configDir');
      await require('fs').promises.access(vaultPath+'/'+configDir+'/plugins/sieve/data.json');
      localStorage.setItem(app.appId+'-config',configDir);
      return {configDir,reopenRequired:true,vault:vaultPath,profile};
    }
    if(action==='activate'&&!app.plugins.isEnabled())await app.plugins.setEnable(true);
    if(action==='disable')await app.plugins.setEnable(false);
    if(action==='quit'){
      setTimeout(()=>require('@electron/remote').app.quit(),100);
      return {quitting:true,vault:vaultPath,profile};
    }
    const plugin=app.plugins.plugins.sieve;
    const observer=app.plugins.plugins['sieve-fixture-observer'];
    // Allow metadata callbacks to settle; this is not a cold/warm benchmark.
    await new Promise(resolve=>setTimeout(resolve,400));
    return {
      runtimeFixture:true,version:plugin?.manifest.version??null,
      apiVersion:observer?.report?.().apiVersion??null,vault:vaultPath,profile,
      configDir:app.vault.configDir,pluginsEnabled:app.plugins.isEnabled(),
      pluginStatus:typeof plugin?.getStatus==='function'?plugin.getStatus():null,
      index:app.vault.getAllLoadedFiles().map(file=>file.path).sort(),
      metadata:app.metadataCache.getCachedFiles().sort(),
      trace:typeof observer?.report==='function'?observer.report():null,
    };
  `;
  let report;
  try { report = await client.evaluate(body); }
  catch (error) {
    // Restricted-mode activation can reload the renderer. The activation is
    // idempotent; reconnect once and verify the new native state before quitting.
    if (action !== 'activate' || !/Execution context was destroyed/.test(String(error))) throw error;
    client.close();
    client = await connectNative(Number(process.argv[2] ?? 9229));
    report = await client.evaluate(body);
  }
  if (action === 'activate' && (!report.pluginsEnabled || !report.pluginStatus)) throw new Error('Native plugin activation did not persist; preserve fixture for diagnosis');
  const events = report.trace?.events;
  const complete = Boolean(events && !report.trace.dropped &&
    events.filter(event=>event.method==='vault-load-start').length===1 &&
    events.filter(event=>event.method==='vault-load-end').length===1 &&
    events.some(event=>event.method==='layout-ready') &&
    !events.some(event=>event.method==='vault-load-error'));
  const technical = report.index?.filter(file=>file==='Technical'||file.startsWith('Technical/'));
  const enriched = {
    ...report, observedStartup:complete,
    technicalIo:complete?events.filter(event=>event.kind==='io'&&event.phase!=='prepare'&&(event.path==='Technical'||event.path?.startsWith('Technical/'))).length:null,
    vaultLoadDurationMs:complete?events.find(event=>event.method==='vault-load-end').durationMs:null,
    rendererLayoutMs:complete?events.find(event=>event.method==='layout-ready').at:null,
  };
  if(process.argv[3])await writeFile(process.argv[3],JSON.stringify(enriched,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({...enriched,index:report.index?.length,metadata:report.metadata?.length,trace:events?{events:events.length,dropped:report.trace.dropped}:null,technicalIndex:technical?.length,technicalSample:technical?.slice(0,5)},null,2));
} finally { client.close(); }
