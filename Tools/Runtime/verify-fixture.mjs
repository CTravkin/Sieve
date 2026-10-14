import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../../Local/.temp/SieveProbe/',import.meta.url));
const run=path.resolve(process.argv[2]??'');
const inside=(target,base)=>{const relative=path.relative(base,target);return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);};
if(!inside(run,root))throw new Error('Only generated runtime fixtures are allowed');
const definition=JSON.parse(await readFile(path.join(run,'run.json'),'utf8'));
if(!definition.runtimeFixture)throw new Error('Runtime fixture marker missing');
const inventory=JSON.parse(await readFile(path.join(run,'inventory.json'),'utf8'));
const failures=[];let checked=0;
for(const variant of definition.vaults){
  const vault=path.resolve(variant.vault);
  if(!inside(vault,run))throw new Error('Vault escapes run');
  for(const [name,expected] of Object.entries(inventory)){
    const target=path.resolve(vault,name);
    if(!inside(target,vault))throw new Error('Inventory escapes vault');
    const actual=createHash('sha256').update(await readFile(target)).digest('hex');
    if(actual!==expected)failures.push({variant:variant.name,path:name});
    checked++;
  }
}
const report={runtimeFixture:true,run,checked,failures,status:failures.length?'FAIL':'PASS'};
if(process.argv[3])await writeFile(process.argv[3],JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report));
if(failures.length)process.exitCode=1;
