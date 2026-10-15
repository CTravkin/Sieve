// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {repositoryRoot} from './layout.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const readJson = async (relativePath) => JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));

function flatten(value, prefix = '') {
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    const name = prefix ? `${prefix}.${key}` : key;
    return typeof item === 'string' ? [[name, item]] : Object.entries(flatten(item, name));
  }));
}

async function listMarkdown(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || ['node_modules', 'Builds', 'AGENTS.md'].includes(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listMarkdown(target));
    else if (entry.name.endsWith('.md')) result.push(target);
  }
  return result;
}

export function validateVersionMetadata(metadata, manifest, versions) {
  const versionAssigned = Object.hasOwn(metadata, 'version');
  if (!versionAssigned) {
    assert.equal(Object.hasOwn(metadata, 'sieveBuild'), false, 'An unassigned version must not have a build number');
    assert.equal(Object.hasOwn(manifest, 'version'), false, 'An unassigned version must not appear in the manifest');
    assert.deepEqual(versions, {}, 'An unassigned version must not have release compatibility entries');
    return { versionAssigned: false, version: null };
  }
  assert.match(metadata.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  assert.equal(manifest.version, metadata.version, 'Manifest and package versions must match');
  assert.ok(Number.isSafeInteger(metadata.sieveBuild) && metadata.sieveBuild > 0);
  assert.equal(versions[metadata.version], manifest.minAppVersion);
  return { versionAssigned: true, version: `${metadata.version} (${metadata.sieveBuild})` };
}

export async function checkProject() {
  const [metadata, manifest, versions, en, ru] = await Promise.all([
    readJson('package.json'), readFile(path.join(repositoryRoot,'manifest.json'),'utf8').then(JSON.parse), readFile(path.join(repositoryRoot,'versions.json'),'utf8').then(JSON.parse),
    readJson('src/locales/en.json'), readJson('src/locales/ru.json'),
  ]);
  const versionMetadata = validateVersionMetadata(metadata, manifest, versions);
  assert.equal(manifest.id, 'sieve');
  assert.equal(manifest.isDesktopOnly, false);
  assert.equal(manifest.description, en.settings.description);
  const english = flatten(en);
  const russian = flatten(ru);
  assert.deepEqual(Object.keys(english).sort(), Object.keys(russian).sort(), 'Locale keys must match');
  for (const key of Object.keys(english)) {
    const placeholders = (text) => [...text.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((match) => match[1]).sort();
    assert.deepEqual(placeholders(english[key]), placeholders(russian[key]), `Placeholder mismatch: ${key}`);
    assert.ok(english[key].trim() && russian[key].trim(), `Empty translation: ${key}`);
    if (key.startsWith('settings.')) {
      assert.doesNotMatch(english[key], /syncthing/i, `Compatibility mention on main screen: ${key}`);
      assert.doesNotMatch(russian[key], /syncthing|синкт[иы]нг/i, `Compatibility mention on main screen: ${key}`);
    }
    assert.doesNotMatch(russian[key], /[ёЁ]/);
  }
  assert.equal(ru.settings.description, 'Исключает файлы и каталоги перед индексацией хранилища.');
  assert.equal(ru.messages.unsupportedVersion, 'Эта версия Obsidian не поддерживает фильтрацию Sieve');
  for (const locale of [en, ru]) {
    const examples=Object.values(locale.settings.syntaxExamples);
    assert.equal(examples.length,5);
    assert.deepEqual(examples.slice(0,4).map(example=>example.rule),['!important','*.tmp','/build','**/cache']);
    assert.match(examples[4].rule,/^\/\//);
    assert.equal(locale.settings.rulesPlaceholder,'*.tmp\n/build\n**/cache');
  }
  const markdown = await listMarkdown(repositoryRoot);
  let linkCount = 0;
  for (const file of markdown) {
    const content = await readFile(file, 'utf8');
    if (/\.ru\.md$/.test(file)) assert.doesNotMatch(content, /[ёЁ]/);
    for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      let target = match[1].replace(/^<|>$/g, '').split('#')[0];
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      target = decodeURIComponent(target);
      const resolved = path.resolve(path.dirname(file), target);
      await access(resolved);
      linkCount++;
    }
  }
  return { ...versionMetadata, localeKeys: Object.keys(english).length, markdownFiles: markdown.length, localLinks: linkCount };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await checkProject(), null, 2));
}
