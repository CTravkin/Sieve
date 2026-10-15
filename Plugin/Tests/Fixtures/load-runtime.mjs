// SPDX-License-Identifier: MPL-2.0
import { fileURLToPath } from 'node:url';
import {createHash} from 'node:crypto';

const modules = new Map();

export function loadRuntime(name, obsidian) {
  const key = JSON.stringify([name, obsidian ?? null]);
  if (!modules.has(key)) {
    const loading = bundleRuntime(name, obsidian);
    modules.set(key, loading);
    loading.catch(() => { if (modules.get(key) === loading) modules.delete(key); });
  }
  return modules.get(key);
}

async function bundleRuntime(name, obsidian) {
  const { build } = await import('esbuild');
  const result = await build({
    entryPoints:[fileURLToPath(new URL(`../../src/${name}.ts`,import.meta.url))],
    bundle:true,write:false,format:'esm',platform:'browser',target:'es2020',loader:{'.md':'text'},metafile:true,
    plugins:obsidian?[{name:'test-host',setup(builder){builder.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:obsidian,loader:'js'}));}}]:[],
  });
  if (result.outputFiles.length !== 1 || Object.values(result.metafile.outputs).some(output => output.imports.length)) {
    throw new Error('Runtime test bundle must have no runtime imports');
  }
  const contents=result.outputFiles[0].text;
  const hash=createHash('sha256').update(contents).digest('hex');
  const source=contents+`\n//# sourceURL=sieve-runtime-test/${name}-${hash.slice(0,12)}.mjs\n`;
  return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
}
