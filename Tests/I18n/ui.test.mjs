import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {loadRuntime} from '../Fixtures/load-runtime.mjs';
import {uiSdk,element,resetUi} from '../Fixtures/ui-host.mjs';
const i18n=await loadRuntime('i18n/index');
const {SyntaxHelpModal,syntaxHelp}=await loadRuntime('ui/syntax-help',uiSdk);
const {statusLines}=await loadRuntime('ui/status');
test('diagnostics localize caller source and codes without echoing private reason',()=>{
  for(const language of ['en','ru','de'])for(const code of ['pattern','escape','include-read','multiple-include','include-syntax','line-too-long']){
    const root=i18n.diagnosticMessage({source:'.stignore',line:3,code,isRoot:true,reason:'PRIVATE_CONTENT'},language);
    const nested=i18n.diagnosticMessage({source:'filters/team.rules',line:9,code,reason:'PRIVATE_CONTENT'},language);
    assert.match(root,/3/);assert.match(nested,/filters\/team\.rules/);assert.match(nested,/9/);assert.doesNotMatch(root,/\.stignore|PRIVATE_CONTENT/);assert.doesNotMatch(nested,/PRIVATE_CONTENT/);
    assert.match(root,language==='ru'?/^Строка 3: /:/^Line 3: /);assert.doesNotMatch(root,/Правила фильтрации|Filter rules/);
    assert.match(nested,/\(filters\/team\.rules\)$/);
    if(language==='ru')assert.doesNotMatch(root,/Invalid|Could not|[ёЁ]/);if(language==='de')assert.equal(root,i18n.diagnosticMessage({source:'.stignore',line:3,code,isRoot:true,reason:''},'en'));
  }
  for(const isRoot of [false,undefined])assert.match(i18n.diagnosticMessage({source:'.stignore',line:1,code:'pattern',isRoot,reason:''},'en'),/^Line 1: .* \(\.stignore\)$/);
  assert.match(i18n.diagnosticMessage({source:'Filter rules',line:1,code:'pattern',isRoot:false,reason:''},'en'),/\(Filter rules\)$/,'A real included filename must not be mistaken for the root field label');
});
test('runtime status distinguishes saved pending, unsaved draft, fallback and unfiltered',()=>{
  const saved={schemaVersion:1,rules:'A',displayName:''},draft={...saved,rules:'B'};
  const base={status:'applied',fallback:false,pendingReload:false,diagnostics:[],initial:{started:true,completed:true,layoutReady:true}};
  assert.match(statusLines(base,saved,draft,'en').join(' '),/loaded.*active.*unsaved/i);
  assert.match(statusLines({...base,pendingReload:true},saved,saved,'en').join(' '),/reopening the vault/i);
  assert.match(statusLines({...base,fallback:true},saved,saved,'en').join(' '),/previous.*working/i);
  for(const [status,pattern] of [['loading',/Loading/],['pending',/not.*applied/],['unfiltered',/without filtering/],['unsupported',/does not support/],['error',/Could not complete/],['disposed',/disabled/]])assert.match(statusLines({...base,status},saved,saved,'en').join(' '),pattern);
});
test('offline modal renders canonical help examples and cleans rendering component on close',async()=>{
  resetUi();for(const language of ['en','ru','es']){
    globalThis.__sieveTestLanguage=language;const selected=language==='ru'?'ru':'en';const document=await readFile(new URL(`../../Docs/Syntax.${selected}.md`,import.meta.url),'utf8');
    const examples=[...document.matchAll(/```text\r?\n([\s\S]*?)```/g)].map(match=>match[1]);const help=syntaxHelp(language);
    for(const example of examples)assert.ok(help.includes(example));assert.match(help,/Syncthing/);assert.match(help,/a\/\*\*\/b/);assert.doesNotMatch(help,/Syntax\.(?:en|ru)\.md|Oracle|Syncthing \d|## (Sources|Источники)/);
    assert.ok(help.indexOf('Syncthing')<help.indexOf('|'),'compatibility introduction precedes the first table');
    const modal=new SyntaxHelpModal({});modal.open();await modal.rendered;assert.equal(globalThis.__sieveRenders.at(-1).markdown,help);const component=globalThis.__sieveRenders.at(-1).component;assert.equal(component.loaded,true);assert.ok(element(modal.contentEl,'button',selected==='ru'?'Закрыть':'Close'));modal.close();assert.equal(component.unloaded,true);assert.equal(modal.contentEl.textContent,'');
  }
});
