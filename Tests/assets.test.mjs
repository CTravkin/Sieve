import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkProject } from '../scripts/check-project.mjs';

test('repository assets preserve the approved locale and version contracts', async () => {
  const result = await checkProject();
  assert.equal(result.versionAssigned, true);
  assert.match(result.version, /^\d+\.\d+\.\d+ \([1-9]\d*\)$/);
  assert.ok(result.localeKeys > 0);
});

test('English and Russian syntax help cover directives and traversal limitations', async () => {
  for (const language of ['en', 'ru']) {
    const help = await readFile(new URL(`../Docs/Syntax.${language}.md`, import.meta.url), 'utf8');
    for (const item of ['Syncthing', '#include', '#escape', '(?i)', '(?d)', '[!a-z]', 'a/**/b']) {
      assert.ok(help.includes(item), `${language} help is missing ${item}`);
    }
    const codeBlocks = [...help.matchAll(/```text\n([\s\S]*?)```/g)].map((match) => match[1]);
    assert.equal(codeBlocks.length, 3);
  }
});

test('localized help uses identical executable examples', async () => {
  const examples = async (language) => {
    const help = await readFile(new URL(`../Docs/Syntax.${language}.md`, import.meta.url), 'utf8');
    return [...help.matchAll(/```text\n([\s\S]*?)```/g)].map((match) => match[1].split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('//')).join('\n'));
  };
  assert.deepEqual(await examples('en'), await examples('ru'));
});
