// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import {compileRules} from '../../.build/core/matcher.mjs';
import {loadCoreModule} from '../Fixtures/load-core.mjs';

test('glob path encoding preserves every ASCII byte and encodes non-ASCII UTF-16 boundaries',async()=>{
  const {encodeGlobPath}=await loadCoreModule('glob');
  const encoder=new TextEncoder();
  for(let cp=0;cp<=0xffff;cp+=128){
    const text=Array.from({length:128},(_,i)=>String.fromCharCode(cp+i)).join('');
    assert.equal(encodeGlobPath(text),String.fromCharCode(...encoder.encode(text)),`UTF-16 block ${cp}`);
  }
  for(const text of ['','last\n','\u007f\u0080','\ud83d\ude00','\ud800word\udfff'])assert.equal(encodeGlobPath(text),String.fromCharCode(...encoder.encode(text)));
});

test('standalone globs still accept ordinary Unicode paths without prepared encoding',async()=>{
  const {compileGlob}=await loadCoreModule('glob');const glob=compileGlob('**/Текст.md');
  assert.equal(glob('Каталог/Текст.md'),true);assert.equal(glob('Каталог/Другой.md'),false);assert.equal(glob('Каталог/Текст.txt'),false);
});

test('one path check encodes UTF-8 at most once for each required case form',async()=>{
  for(const platform of ['windows','linux']){
    const rules=Array.from({length:30},(_,i)=>`${i%2?'(?i)':''}/missing-${i}`).join('\n')+'\n(?i)!*.md\n*';
    const compiled=await compileRules(rules,{platform});assert.equal(compiled.ok,true);
    const original=TextEncoder.prototype.encode;let encoded=0;
    TextEncoder.prototype.encode=function(...args){encoded++;return original.apply(this,args);};
    try{
      for(let i=0;i<20;i++){
        const before=encoded;
        assert.deepEqual(compiled.matcher.match(`Каталог/Раздел-${i}.MD`),{ignored:false,deletable:false,caseFolded:true,canSkipDir:false});
        assert.ok(encoded-before<=(platform==='windows'?1:2),`UTF-8 encoded ${encoded-before} times for one ${platform} path`);
      }
    }finally{TextEncoder.prototype.encode=original;}
  }
});

test('prepared encoding never crosses path checks, case forms or matcher instances',async()=>{
  const first=await compileRules('/Каталог/Файл.MD\n(?i)!*.md\n*',{platform:'linux'});
  const other=await compileRules('(?i)/каталог/файл.md\n!*',{platform:'linux'});
  assert.equal(first.ok,true);assert.equal(other.ok,true);
  for(const path of ['Каталог/Файл.MD','Каталог/Другой.MD','каталог/файл.md','😀/документ.md','\ud800/документ.md','Каталог/Файл.MD']){
    assert.equal(first.matcher.match(path).ignored,path==='Каталог/Файл.MD');
    assert.equal(other.matcher.match(path).ignored,path.toLowerCase()==='каталог/файл.md');
  }
});
