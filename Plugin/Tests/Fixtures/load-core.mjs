// SPDX-License-Identifier: MPL-2.0
import { fileURLToPath } from 'node:url';

export async function loadCoreModule(name) {
  if (process.env.SIEVE_CORE_PREBUILT === '1') return import(new URL(`../../.build/core/${name}.mjs`, import.meta.url));
  const { build } = await import('esbuild');
  const result = await build({ entryPoints: [fileURLToPath(new URL(`../../src/core/${name}.ts`, import.meta.url))], bundle: true, format: 'esm', platform: 'neutral', target: 'es2020', write: false });
  const source = result.outputFiles[0].text + `\n//# sourceURL=sieve-core-test/${name}.mjs\n`;
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}
