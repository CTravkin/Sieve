// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import {loadRuntime} from '../Fixtures/load-runtime.mjs';
const {localizeManifestDescription}=await loadRuntime('ui/manifest-description');

test('loaded manifest descriptions follow RU/EN without changing identity or the original descriptor on disposal',()=>{
  const manifest={id:'sieve',version:'0.6.16',description:'Excludes files and folders before vault indexing.'};
  const original=Object.getOwnPropertyDescriptor(manifest,'description');let language='ru';
  const restore=localizeManifestDescription(manifest,()=>language);
  assert.equal(manifest.description,'Исключает файлы и каталоги перед индексацией хранилища.');
  for(language of ['en','de','fr'])assert.equal(manifest.description,original.value);
  assert.equal(manifest.id,'sieve');assert.equal(manifest.version,'0.6.16');
  restore();assert.deepEqual(Object.getOwnPropertyDescriptor(manifest,'description'),original);
});

test('unavailable/locked metadata is left alone and later foreign changes survive disposal',()=>{
  localizeManifestDescription(undefined,()=> 'ru')();
  const locked=Object.freeze({description:'Native'});localizeManifestDescription(locked,()=> 'ru')();assert.equal(locked.description,'Native');
  const manifest={description:'Native'};const restore=localizeManifestDescription(manifest,()=> 'ru');
  Object.defineProperty(manifest,'description',{value:'Other owner',writable:true});restore();assert.equal(manifest.description,'Other owner');
});

test('normal foreign assignment keeps the writable manifest contract and survives disposal',()=>{
  const manifest={description:'Native'};const original=Object.getOwnPropertyDescriptor(manifest,'description');
  const restore=localizeManifestDescription(manifest,()=> 'ru');
  manifest.description='Assigned by host';
  assert.deepEqual(Object.getOwnPropertyDescriptor(manifest,'description'),{...original,value:'Assigned by host'});
  restore();assert.equal(manifest.description,'Assigned by host');
});
