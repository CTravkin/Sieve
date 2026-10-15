import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({
  absWorkingDir: root,
  entryPoints: { matcher:'src/core/matcher.ts', normalize:'src/core/normalize.ts' },
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2020',
  outdir: 'dist/core',
  outExtension: { '.js':'.mjs' },
  metafile: true,
});
const imports = Object.values(result.metafile.outputs).flatMap(output => output.imports);
if (imports.length) throw new Error('Shared matcher must have no runtime imports');
console.log('Portable matcher bundled without runtime imports');
