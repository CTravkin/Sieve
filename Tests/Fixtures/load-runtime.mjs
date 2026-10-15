import { fileURLToPath, pathToFileURL } from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

export async function loadRuntime(name, obsidian) {
  const { build } = await import('esbuild');
  const result = await build({
    entryPoints:[fileURLToPath(new URL(`../../src/${name}.ts`,import.meta.url))],
    bundle:true,write:false,format:'esm',platform:'browser',target:'es2020',loader:{'.md':'text'},
    plugins:obsidian?[{name:'test-host',setup(builder){builder.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:obsidian,loader:'js'}));}}]:[],
  });
  const directory=fileURLToPath(new URL('../../../Local/.temp/Development/2026-10-14/runtime-tests/',import.meta.url));
  await mkdir(directory,{recursive:true});
  const contents=result.outputFiles[0].contents;
  const output=path.join(directory,`${name.replace(/[^a-z0-9]+/gi,'-')}-${process.pid}-${createHash('sha256').update(contents).digest('hex').slice(0,12)}.mjs`);
  await writeFile(output,contents);
  return import(pathToFileURL(output).href);
}
