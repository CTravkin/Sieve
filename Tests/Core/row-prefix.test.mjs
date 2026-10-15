import assert from 'node:assert/strict';
import test from 'node:test';
import {loadCoreModule} from '../Fixtures/load-core.mjs';

test('fixed-row search skips long regions without the required ASCII prefix',async()=>{
  const {compileGlob}=await loadCoreModule('glob');const glob=compileGlob('**/third[-_]party*/**');
  const path='Project/'+'x'.repeat(32768)+'/note.md';const original=String.prototype.charCodeAt;let inspected=0;
  String.prototype.charCodeAt=function(...args){if(String(this).length>=32768)inspected++;return original.apply(this,args);};
  try{assert.equal(glob(path),false);}finally{String.prototype.charCodeAt=original;}
  assert.ok(inspected<=16,`Decoded ${inspected} bytes although the required prefix is absent`);
  assert.equal(glob('Project/third_party/vendor/note.md'),true);
});

test('fixed-row prefix search retains overlapping candidates and Unicode fallback',async()=>{
  const {compileGlob}=await loadCoreModule('glob');
  const overlapping=compileGlob('*aba?b*');
  assert.equal(overlapping('ababaXb'),true);assert.equal(overlapping('ababaXX'),false);
  const unicode=compileGlob('*Ж?x*');
  assert.equal(unicode('beforeЖ😀xafter'),true);assert.equal(unicode('beforeЖ😀yafter'),false);
  const ascii=compileGlob('*a?b*');assert.equal(ascii('éaxb'),true);assert.equal(ascii('éaxc'),false);
  assert.equal(ascii('éa😀b'),true);assert.equal(ascii('é/a😀b'),false);
});
