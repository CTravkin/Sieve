// SPDX-License-Identifier: MPL-2.0
import { lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const temporary = path.join(tmpdir(),'sieve-tests');

// Only a newly created directory is owned. Never adopt a caller's parent or
// an existing directory, and refuse cleanup if the owned root was replaced.
export async function createTestDirectory(prefix, parent = process.env.SIEVE_TEST_TEMP || temporary) {
  if (!/^[a-z0-9-]+-$/.test(prefix)) throw new Error('Expected a test directory prefix ending in a dash');
  const base = path.resolve(parent);
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, prefix));
  const physical = await realpath(directory);
  const identity = await lstat(directory);
  return {
    path: directory,
    async cleanup() {
      let current;
      try { current = await lstat(directory); }
      catch (error) { if (error.code === 'ENOENT') return; throw error; }
      if (path.dirname(directory) !== base || current.isSymbolicLink() ||
          current.dev !== identity.dev || current.ino !== identity.ino || await realpath(directory) !== physical) {
        throw new Error(`Refusing cleanup of replaced test directory: ${directory}`);
      }
      // fs.rm unlinks nested symlinks/junctions without following their targets.
      await rm(directory, { recursive: true, force: true });
    },
  };
}
