// SPDX-License-Identifier: MPL-2.0
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export const pluginRoot=fileURLToPath(new URL('../',import.meta.url));
export const repositoryRoot=path.resolve(pluginRoot,'..');
export const buildsRoot=path.join(repositoryRoot,'Builds');
export const artifactRoot=path.join(buildsRoot,'sieve');
