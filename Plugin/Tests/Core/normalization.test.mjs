// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCoreModule } from '../Fixtures/load-core.mjs';

test('normalization is pinned without relying on the host ICU tables', async () => {
  const { nativeNormalize } = await loadCoreModule('normalize');
  const original = String.prototype.normalize;
  String.prototype.normalize = () => { throw new Error('Host normalization unavailable'); };
  try {
    assert.equal(nativeNormalize('cafe\u0301', 'linux'), 'café');
    assert.equal(nativeNormalize('café', 'ios'), 'cafe\u0301');
    assert.equal(nativeNormalize('\u1100\u1161\u11a8', 'windows'), '각');
    assert.equal(nativeNormalize('각', 'darwin'), '\u1100\u1161\u11a8');
    assert.equal(nativeNormalize('a\u0315\u0300', 'linux'), 'à\u0315');
    assert.equal(nativeNormalize('\u0344', 'android'), '\u0308\u0301');
  } finally { String.prototype.normalize = original; }
});

test('ASCII paths bypass Unicode code-point scans on every platform',async()=>{
  const {nativeNormalize}=await loadCoreModule('normalize');
  const ascii=Array.from({length:128},(_,cp)=>String.fromCharCode(cp)).join('')+'Project/README.md';
  const original=String.prototype.codePointAt;let scanned=0;
  String.prototype.codePointAt=function(...args){scanned++;return original.apply(this,args);};
  try{for(const platform of ['windows','linux','darwin','ios','android'])assert.equal(nativeNormalize(ascii,platform),ascii);}
  finally{String.prototype.codePointAt=original;}
  assert.equal(scanned,0,'ASCII normalization should not scan Unicode code points');
  assert.equal(nativeNormalize('ASCII/café','ios'),'ASCII/cafe\u0301');
});

test('Go whitespace trimming retains boundary controls and BOM outside its whitespace set',async()=>{
  const {trimSpace}=await loadCoreModule('normalize');
  const whitespace=new Set([9,10,11,12,13,32,0x85,0xa0,0x1680,...Array.from({length:11},(_,i)=>0x2000+i),0x2028,0x2029,0x202f,0x205f,0x3000]);
  for(let cp=0;cp<=0xffff;cp++){
    const char=String.fromCharCode(cp);
    assert.equal(trimSpace(char+'word'+char),whitespace.has(cp)?'word':char+'word'+char,`U+${cp.toString(16)}`);
  }
});
