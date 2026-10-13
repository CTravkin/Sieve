import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRules } from '../../dist/core/matcher.mjs';
import { runOracle } from '../../Tools/Oracle/runner.mjs';

const platform=process.platform==='win32'?'windows':process.platform==='darwin'?'darwin':'linux';

test('optimized grouping preserves native pivot ties, ordering, UTF-8 quirks and long valid masks', async t => {
  const paths=['','a','ab','abc','😀a','😀b','x/😀','a/b','aaaa','a/b/c','longname','longnamea','a😀','xyz'];
  const fixtures=[];
  for(const n of [32,64,128,256]) {
    const stars='**'.repeat(n);
    fixtures.push({name:`long-super-literal/${n}`,rules:stars+'a'+stars,paths});
    fixtures.push({name:`long-super-UTF8/${n}`,rules:stars+'😀'+stars,paths});
  }
  for(const n of [32,64,128]) fixtures.push({name:`long-alternating/${n}`,rules:'a**'.repeat(n),paths:['xyz','a','b']});
  for(const block of ['*?a','?*a','[!/]?a','a??**','*?😀','*?a**?b']) for(const n of [32,64]) {
    fixtures.push({name:`disjoint-groups/${block}/${n}`,rules:block.repeat(n),paths:['xyz','a','b']});
  }
  for(const n of [1,2,4,32,64]) {
    const fixed='longname?**?a?**'.repeat(n);
    for(const rules of [fixed,fixed+'*?a','*?a**'+fixed,'a?**?a?**'.repeat(n)+'*?longname','longname??**?a??**'.repeat(n)+'*?a']) {
      fixtures.push({name:`independent-batch/${n}/${fixtures.length}`,rules,paths:n<=4?paths:['xyz','a','b']});
    }
  }
  // Primitive collapse can split a fixed row; fixed-row collapse can split a
  // primitive run. Vary text lengths, empty alternatives and separator order
  // on both sides so neither candidate count nor length alone decides a tie.
  for(const left of ['a','longname','😀','{,a}','[ab]']) for(const join of ['*?','?*','**?','??','[!/]?','[!xy][!yx]']) for(const right of ['a','aaaaaaa','{,a}','?']) {
    fixtures.push({name:`overlap-order/${left}/${join}/${right}`,rules:left+join+right+'**'+right+join+left,paths});
    fixtures.push({name:`overlap-reverse/${left}/${join}/${right}`,rules:right+join+left+'*'+left+join+right,paths});
  }
  const blocks=['a?','😀[ab]','[!/]?','**','***','[!xy][!xy]','{,a}','longname','[ab]','?*','*?','**?'];
  let seed=0x5009beef;
  const random=n=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)%n;};
  for(let i=0;i<512;i++) fixtures.push({name:`selection-order/${i}`,rules:Array.from({length:random(6)+3},()=>blocks[random(blocks.length)]).join(''),paths});
  const closureBlocks=['*?a','??a','a??','?*','[!/]?[ab]','[!xy][!yx]','😀?','{,a}?','longname?','**?a'];
  seed=0x9a71703c;
  for(let i=0;i<512;i++) fixtures.push({name:`incremental-overlap/${i}`,rules:Array.from({length:random(12)+4},()=>closureBlocks[random(closureBlocks.length)]).join(''),paths});
  const native=await runOracle(fixtures,{timeoutMs:30000});
  let comparisons=0;
  for(let i=0;i<fixtures.length;i++) {
    const result=await compileRules(fixtures[i].rules,{platform});
    assert.equal(result.ok,true,fixtures[i].name);
    assert.equal(native[i].error,undefined,fixtures[i].name);
    assert.equal(result.revision.endsWith(':'+native[i].hash),true,fixtures[i].name);
    for(const {path,...expected} of native[i].matches) {
      assert.deepEqual(result.matcher.match(path),expected,`${fixtures[i].name}: ${path}`);
      comparisons++;
    }
  }
  t.diagnostic(`${fixtures.length} native grouping/long-mask fixtures, ${comparisons} flags, zero differences; seeds 5009beef and 9a71703c`);
});
