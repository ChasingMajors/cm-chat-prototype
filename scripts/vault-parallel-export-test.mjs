import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({console,Date});
vm.runInContext(fs.readFileSync(new URL('../command-center/static-exporter/Code.gs',import.meta.url),'utf8'),context);
const source={code:'test',settype:'Base',setline:'Base',parallel:'Aqua Holo Foil',printrun:200,serial:'',subsetsize:300};
context.getVaultSpreadsheet_=()=>({getSheetByName:name=>name});
context.sheetObjects_=name=>name==='Index'?[{code:'test',displayname:'Test Basketball',sport:'basketball'}]:name==='Products'?[source]:[];
context.assertSourceImportComplete_=()=>{};
context.buildPopStaticData_=()=>({});
context.exportPopStaticData_=()=>{};
context.productContentHash_=()=> 'test-hash';
context.pipelineHash_=()=> 'test-hash';
context.Utilities={getUuid:()=> 'test-release'};
for(const product of [context.buildVaultStaticData_().products.test,context.buildPrvProductRelease_('test').product]){
 assert.equal(product.rows[0].parallel,'Aqua Holo Foil');assert.equal(product.rows[0].setLine,'Base');assert.equal(product.rows[0].printRun,200);assert.equal(product.rows[0].subSetSize,300);
}
// Legacy blank descriptors must not change every product's source fingerprint.
source.parallel='';
assert.ok(!Object.hasOwn(context.buildVaultStaticData_().products.test.rows[0],'parallel'));
assert.ok(!Object.hasOwn(context.buildPrvProductRelease_('test').product.rows[0],'parallel'));
const written=[];
context.ensureFolderPath_=()=>({});
context.writeJsonFile_=(_dir,name,data)=>written.push({name,data});
context.writeShardedObjectMap_=(_dir,_sport,products)=>{written.push({products});return [];};
context.exportVaultStaticData_({});
assert.ok(written.some(r=>r.products?.test),'Drive export includes the Vault product');
source.parallel='Aqua Holo Foil';written.length=0;context.exportVaultStaticData_({});
assert.equal(written.find(r=>r.products?.test).products.test.rows[0].parallel,'Aqua Holo Foil');
console.log('Vault parallel export checks passed for Drive, full GitHub and single-product releases.');
