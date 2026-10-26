import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const c=vm.createContext({console,Date});
vm.runInContext(fs.readFileSync(new URL('../command-center/static-exporter/Code.gs',import.meta.url),'utf8'),c);
const finest='2025_26_topps_finest_uefa_club_competitions_soccer';
const legacy='2025_26_finest_uefa_club_competitions_soccer';
const name='2025-26 Topps Finest UEFA Club Competitions Soccer';
const meta={code:legacy,displayname:name,year:'2025-26',sport:'Soccer',manufacturer:'Topps',product:'Finest UEFA Club Competitions'};
const row={...meta,code:finest,displayname:name.replace('Topps','Topp'),settype:'Insert',setline:'The Man',printrun:'123',serial:'/99',subsetsize:'20',notes:'Preserve evidence'};
const clone=x=>JSON.parse(JSON.stringify(x));
const plain=x=>clone(x);
const reconcile=(index,products)=>c.prvReconcileTables_(index,products);

const source=[clone(row)],index=[clone(meta)],before=JSON.stringify({source,index});
let result=reconcile(index,source);
assert.equal(result.index[0].code,finest,'retain established CV/PRV public code');
assert.equal(result.products[0].displayname,name,'reviewed source typo corrected only in adapter');
assert.equal(result.report.unmatched_rows,0);
assert.equal(JSON.stringify({source,index}),before,'input rows and catalog remain immutable');
assert.deepEqual(plain(reconcile(result.index,result.products)),plain(result),'review is idempotent');
assert.deepEqual(plain(result.products[0]),{...row,displayname:name},'all measurement/subset fields preserved');
assert.equal(reconcile([{...meta,code:finest}],[row]).products[0].displayname,name,'already canonical index also corrects reviewed typo');
assert.equal(reconcile([meta],[{...row,displayname:name}]).index[0].code,finest,'correct source spelling is also accepted');
assert.equal(reconcile([], [row]).index.length,0,'never fabricate missing metadata');

for(const delta of [{year:'2024-25'},{sport:'Basketball'},{manufacturer:'Other'},{product:'Other'},{displayname:'2025-26 Topps Finest UEFA Sapphire Soccer'}]) {
  result=reconcile([meta],[{...row,...delta}]);
  assert.equal(result.index[0].code,legacy,'unreviewed source identity must not activate alias');
  assert.equal(result.report.unmatched_rows,1);
}
for(const catalog of [[meta,clone(meta)],[meta,{...meta,code:finest}],[meta,{...meta,code:'unreviewed-code'}],[{...meta,displayname:'Other product'}],[{...meta,year:'2024-25'}],[{...meta,manufacturer:'Other'}],[{...meta,code:'unreviewed-code'}]]) {
  result=reconcile(catalog,[row]);
  assert.equal(result.products[0].displayname,row.displayname,'conflicting/ambiguous catalog never normalizes source typo');
  assert.equal(result.products[0].prv_identity_hold,true,'conflicts are excluded from exports even when an exact code exists');
  assert.equal(result.report.unmatched[0].held,true);
}
result=reconcile([meta],[row,{...row,displayname:'2024-25 Topps Finest UEFA Club Competitions Soccer',year:'2024-25'}]);
assert.equal(result.index[0].code,legacy,'mixed source-code group is held as a whole');

const pristine={code:'2026_topps_pristine_premier_league_soccer',displayname:'2025-26 Topps Pristine Premier League Soccer',year:'2025-26',sport:'soccer',manufacturer:'Topps',product:'Pristine Premier League'};
const merlin={...pristine,code:'2026_merlin_premier_league_soccer',displayname:'2025-26 Topps Merlin Premier League Soccer',product:'Merlin Premier League'};
const combined={code:'2026_topps_pristine_premier_league_2026_merlin_premier_league_soccer',displayname:'2026 Topps Pristine Premier League & 2026 Merlin Premier League Soccer',year:'2026',sport:'Soccer',setline:'Base card',printrun:12667};
const publicCodes=['2025_26_topps_pristine_premier_league_soccer','2025_26_topps_merlin_premier_league'];
result=reconcile([pristine,merlin],[combined,{...combined,setline:'Pristine Autos'}]);
assert.deepEqual(Array.from(result.index,x=>x.code),publicCodes,'split public identities remain distinct');
assert.equal(result.report.unmatched_rows,2,'no row guessed from order, number or partial subset name');
assert.equal(result.report.unmatched[0].held,true);
assert.deepEqual(Array.from(result.report.unmatched[0].candidate_public_codes),publicCodes);
assert(result.products.every(x=>x.code===combined.code),'held rows are never copied to either split identity');
assert.equal(reconcile([pristine,{...pristine,code:'another-pristine'}],[]).index[0].code,pristine.code,'ambiguous split identity is not rewritten');

const ordinary={code:'ordinary',displayname:'2025 Ordinary Baseball',year:'2025',sport:'baseball'};
result=reconcile([meta,ordinary],[row,{...ordinary,setline:'Base',printrun:50}]);
assert.equal(result.products[1].code,ordinary.code,'unrelated direct-code routing unchanged');
assert.equal(reconcile([ordinary],[{...ordinary,code:'source-alias'}]).products[0].code,ordinary.code,'unique name/year/sport fallback unchanged');

// Exercise full export and single-product release through the real adapter.
c.getVaultSpreadsheet_=()=>({getSheetByName:n=>n});
c.sheetObjects_=n=>n==='Index'?[meta,pristine,merlin]:n==='Products'?[row,combined]:[];
c.buildPopStaticData_=()=>({});c.assertSourceImportComplete_=()=>{};
c.productContentHash_=()=> 'hash';c.pipelineHash_=()=> 'hash';c.Utilities={getUuid:()=> 'release'};
const full=c.buildVaultStaticData_();
assert.equal(full.products[finest].rows.length,1);
assert.equal(full.products[publicCodes[0]].rows.length,0);
assert.equal(full.products[publicCodes[1]].rows.length,0);
assert.equal(full.products[combined.code],undefined,'held combined rows produce no combined product');
assert.deepEqual(plain(c.buildPrvProductRelease_(finest).product.rows),plain(full.products[finest].rows),'single/full route parity');
for(const code of publicCodes) assert.throws(()=>c.buildPrvProductRelease_(code),/without rows/,'empty split cannot be published as coverage');
c.sheetObjects_=n=>n==='Index'?[meta,{...meta,code:finest}]:n==='Products'?[row]:[];
assert.equal(c.buildVaultStaticData_().products[finest].rows.length,0,'ambiguous reviewed aliases cannot publish through direct-code routing');
assert.throws(()=>c.buildPrvProductRelease_(finest),/without rows/);
c.sheetObjects_=n=>n==='Index'?[{...pristine,code:combined.code}]:n==='Products'?[combined]:[];
assert.equal(c.buildVaultStaticData_().products[combined.code].rows.length,0,'stale combined metadata never republishes held rows');
assert.throws(()=>c.buildPrvProductRelease_(combined.code),/without rows/);
console.log('Reviewed PRV identity tests passed: public-code preservation, typo guards, ambiguous holds, split isolation, immutable inputs, idempotence and full/single export parity.');

const mixed='2023_topps_chrome_sapphire_baseball';
const sapphireMeta=(year,code)=>({code,displayname:year+' Topps Chrome Sapphire'+(year==='2019'?' Edition':'')+' Baseball',year,sport:'baseball',manufacturer:'Topps',product:'Chrome Sapphire'});
const specs=[['2019','19TCSmlb','1,030','700','Base','[Base]'],['2020','20TCSmlb','1,030','700','Base','[Base]'],['2021','21TCSmlb','1,100','660','Base','[Base]'],['2023','23TCSmlb','1,200','660','Base','[Base]'],['2023','23TCSmlb','150','10','Insert','Sapphire Selections']];
const sm=specs.filter((x,i)=>i!==4).map(x=>sapphireMeta(x[0],x[1]));
const sr=specs.map(x=>({...sapphireMeta(x[0],mixed),settype:x[4],setline:x[5],printrun:x[2],subsetsize:x[3],parallel:'',serial:'',packodds:'',cmurl:'',notes:''}));
const held=[{...sr[2],year:'2022',displayname:'2022 Topps Chrome Sapphire Baseball'},{...sr[2],year:'2022',displayname:'2022 Topps Chrome Sapphire Baseball',code:'2022_topps_chrome_sapphire_baseball',printrun:'1,082'},...sr.slice(0,3).map(x=>({...x,setline:'Autograph'}))];
result=reconcile(sm,[...sr,...held]);
assert.equal(result.products.filter(x=>x.prv_identity_review).length,5);
assert.equal(result.products.filter(x=>x.prv_identity_hold).length,5);
assert.equal(result.report.unmatched_rows,5);
assert.deepEqual(plain(reconcile(result.index,result.products)),plain(result),'Sapphire review is idempotent');
for(const delta of [{printrun:'1,031'},{setline:'Other'},{year:'2018'},{serial:'/99'},{cmurl:'https://example.com/new-evidence'},{notes:'Changed evidence'}])assert.equal(reconcile(sm,[{...sr[0],...delta}]).products.filter(x=>x.prv_identity_review).length,0,'changed source evidence requires renewed review');
assert.equal(reconcile(sm,[sr[0],clone(sr[0])]).products.filter(x=>x.prv_identity_review).length,0,'duplicate signatures are held');
assert.equal(reconcile([...sm,clone(sm[0])],[sr[0]]).products.filter(x=>x.prv_identity_review).length,0,'ambiguous target held');
assert.equal(reconcile([],sr).products.filter(x=>x.prv_identity_review).length,0,'no target metadata fabricated');
c.sheetObjects_=n=>n==='Index'?sm:n==='Products'?[...sr,...held]:[];
const sapphireFull=c.buildVaultStaticData_();
assert.equal(Object.values(sapphireFull.products).reduce((n,p)=>n+p.rows.length,0),5);
const selections=sapphireFull.products[mixed].rows.find(x=>x.setLine==='Sapphire Selections');
assert.equal(selections.setType,'Insert');
for(const p of Object.values(sapphireFull.products)){
  if(!p.rows.length)continue;
  assert.deepEqual(plain(c.buildPrvProductRelease_(p.meta.code).product.rows),plain(p.rows));
  for(const row of p.rows){assert.match(row.notes,/Unverified estimate/);assert.equal(row.cmURL,'');assert.notEqual(row.setLine,'Autograph');}
}
console.log('Five-row Sapphire staging tests passed: exact signatures, held exclusions, qualifier preservation, subset identity, idempotence and single/full export parity.');

assert.equal(reconcile(sm,sr.map(r=>({...r,printrun:Number(r.printrun.replaceAll(',','')),subsetsize:Number(r.subsetsize)}))).products.filter(r=>r.prv_identity_review).length,5,'Sheet numeric values and CSV thousands formatting identify the same exact measurements');
assert.equal(reconcile(sm,[{...sr[0],printrun:1030.01}]).products.filter(r=>r.prv_identity_review).length,0,'numeric formatting normalization never approximates values');

// Synthetic fixtures exercise the approval adapter, never production coverage.
const step=vm.createContext({Date,Logger:{log(){}},Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_algorithm,s)=>Array.from(createHash('sha256').update(s).digest()),getUuid:()=> 'fixture'}});
vm.runInContext(fs.readFileSync(new URL('../command-center/static-exporter/Code.gs',import.meta.url),'utf8'),step);
const fixtureMeta={code:'fixture-public',displayname:'2025 Fixture Baseball',year:'2025',sport:'baseball',manufacturer:'Fixture',product:'Fixture'};
const fixtureRow={...fixtureMeta,code:'fixture-source',settype:'Insert',setline:'Selections',parallel:'',printrun:'1,234',serial:'',subsetsize:'10',packodds:'1:12',notes:'Preserve original note',cmurl:''};
const fixtureRule={source:'fixture-source',target:'fixture-public',meta:fixtureMeta,count:1,sha256:createHash('sha256').update(JSON.stringify([step.prvStep7Signature_(fixtureRow,'fixture-source')])).digest('hex')};
step.prvApprovedStep7Manifest_=()=>[fixtureRule];
let approved=step.prvApplyApprovedStep7_([],[fixtureRow]);
assert.equal(approved.index.length,1);assert.equal(approved.products[0].code,'fixture-public');assert.equal(approved.products[0].settype,'Insert');assert.equal(approved.products[0].packodds,'1:12');assert.equal(approved.products[0].prv_identity_review.measurement_verified,false);assert.match(approved.products[0].prv_measurement_note,/Unverified/);
assert.deepEqual(plain(step.prvApplyApprovedStep7_(approved.index,approved.products)),plain(approved),'Step 7 adapter is idempotent');
assert.equal(fixtureRow.code,'fixture-source','authoring input remains immutable');
assert.equal(step.prvApplyApprovedStep7_([],[{...fixtureRow,printrun:1234}]).index.length,1,'numeric CSV/Sheet formatting matches exactly');
for(const delta of [{printrun:1235},{notes:'Changed evidence'},{packodds:'1:13'},{cmurl:'https://example.com/evidence'},{settype:'Base'},{year:'2026'}]){
 const held=step.prvApplyApprovedStep7_([],[{...fixtureRow,...delta}]);assert.equal(held.index.length,0);assert.equal(held.products[0].prv_identity_hold,true,'changed evidence must be held');
}
assert.equal(step.prvApplyApprovedStep7_([],[fixtureRow,fixtureRow]).index.length,0,'duplicate source signatures do not publish');
assert.equal(step.prvApplyApprovedStep7_([{...fixtureMeta,year:'2024'}],[fixtureRow]).products[0].prv_identity_hold,true,'conflicting exact target code is held');
assert.equal(step.prvApplyApprovedStep7_([],[fixtureRow,{...fixtureRow,code:'fixture-public'}]).products[0].prv_identity_hold,true,'pre-existing target rows are not appended blindly');
step.getVaultSpreadsheet_=()=>({getSheetByName:n=>n});step.sheetObjects_=n=>n==='Products'?[fixtureRow]:[];step.buildPopStaticData_=()=>({});step.assertSourceImportComplete_=()=>{};step.productContentHash_=()=> 'fixture';step.pipelineHash_=()=> 'fixture';
const stepFull=step.buildVaultStaticData_().products['fixture-public'];assert.equal(stepFull.rows[0].odds,'1:12');assert.equal(stepFull.rows[0].setType,'Insert');assert.match(stepFull.rows[0].notes,/Preserve original note.*Unverified/);
assert.deepEqual(plain(step.buildPrvProductRelease_('fixture-public').product.rows),plain(stepFull.rows),'Step 7 full/single export parity includes odds and qualifiers');
console.log('Step 7 approval guards passed: exact signatures, changed-evidence holds, no blind append, idempotence, input immutability, odds, subset and qualifier preservation.');
