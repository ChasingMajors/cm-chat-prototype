import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
const repo = new URL('../', import.meta.url);
const read = file => fs.readFileSync(new URL(file, repo), 'utf8');
const clone = x => JSON.parse(JSON.stringify(x));
const routing=vm.createContext({});
vm.runInContext(read('command-center/operator-backend/Code.gs'),routing);
for(const sport of ['baseball','football','basketball','hockey','soccer']){
 assert.equal(routing.getChecklistSpreadsheetId_(sport,'2099'),'','unmapped year cannot fall back to current');
 assert.equal(routing.getChecklistSpreadsheetId_(sport,'2099-00'),'','unmapped season cannot fall back to current');
 assert.ok(routing.getChecklistSpreadsheetId_(sport,'current'),'explicit current alias remains available');
}
assert.ok(routing.getChecklistSpreadsheetId_('basketball','2026-27'));
assert.ok(routing.getChecklistSpreadsheetId_('baseball','2027'));
assert.equal(routing.getChecklistSpreadsheetId_('soccer','2026'),routing.getChecklistSpreadsheetId_('soccer','2025-26'));
assert.equal(routing.getChecklistSpreadsheetId_('unknown','2026'),'');
const utilities = {DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},getUuid:()=>crypto.randomUUID(),
  computeDigest:(_, text)=>[...crypto.createHash('sha256').update(text).digest()],
  newBlob:text=>({getBytes:()=>[...Buffer.from(text)]})};
function context(file) {
  const source=read(file);
  const names=[...source.matchAll(/^function\s+(\w+)\(/gm)].map(m=>m[1]);
  assert.equal(new Set(names).size,names.length,'no duplicate function declarations: '+file);
  const c=vm.createContext({Utilities:utilities,Date,console});vm.runInContext(source,c);return c;
}
function sheet(name, initial) {
  let cells=clone(initial),writes=0;
  return {getName:()=>name,getDataRange:()=>({getValues:()=>clone(cells)}),getLastRow:()=>cells.length,getMaxRows:()=>1000,
    getRange(r,col,n,width){return {
      getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:width},(_,j)=>cells[r-1+i]?.[col-1+j]??'')),
      setNumberFormat(){return this},setValues(rows){writes++;rows.forEach((row,i)=>{cells[r-1+i] ||= [];row.forEach((v,j)=>cells[r-1+i][col-1+j]=v)});return this},
      clearContent(){for(let i=0;i<n;i++)for(let j=0;j<width;j++)cells[r-1+i][col-1+j]='';return this}
    }},appendRow(row){cells.push(clone(row))},rows:()=>clone(cells),writes:()=>writes};
}
const op=context('command-center/operator-backend/Code.gs');
const realRecoveryDocument=op.importRecoveryDocument_;
let sh=sheet('ChecklistRows',[['code','player'],['target','old1'],['other','KEEP'],['target','old2'],['target','old3']]);
op.ensureSheetWithHeaders_=()=>sh;op.getHeaders_=()=>['code','player'];
op.replaceRowsByCode_({},'ChecklistRows','target',[{code:'target',player:'new'}],[]);
assert.deepEqual(sh.rows(),[['code','player'],['target','new'],['other','KEEP'],['',''],['','']]);
op.replaceRowsByCode_({},'ChecklistRows','target',[],[]);
assert.equal(sh.rows().filter(row=>row[0]==='target').length,0,'intentional empty parallel replacement clears old rows');
assert.equal(sh.rows()[2][1],'KEEP');
sh=sheet('ChecklistRows',[['code','player'],...Array.from({length:1000},(_,i)=>['target',String(i)])]);
op.ensureSheetWithHeaders_=()=>sh;
op.replaceRowsByCode_({},'ChecklistRows','target',Array.from({length:1000},(_,i)=>({code:'target',player:'new'+i})),[]);
assert.equal(sh.writes(),1,'1000 contiguous updates use one batch write');
// Exercise a recovery after the operation modified the sheet and then failed.
sh=sheet('ChecklistRows',[['code','player'],['target','old'],['other','KEEP']]);
const status=sheet('CMImportStatus',[['code','stage','updated_at']]);
const ss={getId:()=> 'spreadsheet',getSheetByName:name=>name==='CMImportStatus'?status:sh};
let stored={},id=0;
op.PropertiesService={getScriptProperties:()=>({getProperty:k=>stored[k],setProperty:(k,v)=>stored[k]=v})};
op.importRecoveryDocument_=()=>{let value="";return {getId:()=>String(++id),setContent:v=>value=v,getBlob:()=>({getDataAsString:()=>value})}};
op.MimeType={PLAIN_TEXT:'text/plain'};op.LockService={getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})};
op.SpreadsheetApp={openById:()=>ss};op.requireOperatorKey_=()=>{};
op.ensureSheetWithHeaders_=(_,name)=>name==='CMImportStatus'?status:sh;
op.getHeaders_=s=>s.rows()[0];
const failed=op.runRecoverableImport_({sourceUrl:'source',sport:'baseball',key:'test'},'checklist',()=>{
 op.replaceRowsByCode_(ss,'ChecklistRows','target',[{code:'target',player:'new'}],[]);throw Error('Injected write failure');
});
assert.equal(failed.ok,false);assert.equal(sh.rows()[1][1],'old');assert.equal(sh.rows()[2][1],'KEEP');
assert(failed.recovery.includes('restored'));
const recoverySheet=sheet('Recovery',[]);
const originalRange=recoverySheet.getRange;
let dropMarker=false;
recoverySheet.getRange=(...args)=>{
 const range=originalRange(...args),write=range.setValues;
 range.setValues=function(rows){if(dropMarker&&rows[0]?.[1]==='complete'){dropMarker=false;throw Error('Interrupted snapshot save')}return write.call(this,rows)};return range;
};
op.SpreadsheetApp={create:()=>({getId:()=> 'recovery',getSheets:()=>[recoverySheet]})};
const recovery=realRecoveryDocument('', 'Recovery');
const unicode='x'.repeat(29999)+'😀'+'y'.repeat(31000);
recovery.setContent(unicode);
assert.equal(recovery.getBlob().getDataAsString(),unicode);
dropMarker=true;
assert.throws(()=>recovery.setContent('A newer but interrupted snapshot'),/Interrupted/);
assert.equal(recovery.getBlob().getDataAsString(),unicode,'interrupted snapshot save preserves the prior committed snapshot');
console.log('Exact replacement, batching, unrelated-row preservation, rollback and interrupted snapshot recovery passed.');

const ex=context('command-center/static-exporter/Code.gs');
let files,publicFiles,requests,stagedTree,head,failTree=false,conflict=false;
ex.getGitHubConfigBase_=()=>({owner:'owner',repo:'repo',branch:'main'});
ex.fetchGitHubJsonFileBase_=path=>clone(files.get(path)||null);
ex.fetchPublicJson_=path=>clone(publicFiles.get('data/v1/'+path)||null);
ex.SpreadsheetApp={openById:()=>({getSheetByName:()=>null})};
ex.buildChecklistStaticDataForSingleProductBase_=()=>({generated_at:'new',indexRow:{Code:'target',DisplayName:'Target',Keywords:'',year:'2026',sport:'baseball',manufacturer:'Topps',product:'Target'},
 productPayload:{ok:true,meta:{code:'target',displayName:'Target',year:'2026',sport:'baseball'},rows:[{code:'target',player:'New'}],parallels:[]},searchRows:[{code:'target',player:'New'}]});
ex.githubRequest_=(method,path,payload)=>{
 requests.push({method,path,payload});
 if(path.includes('/git/ref/')) return {object:{sha:conflict&&requests.filter(x=>x.path.includes('/git/ref/')).length>1?'changed':head}};
 if(method==='get'&&path.includes('/git/commits/')) return {tree:{sha:'base-tree'}};
 if(path.endsWith('/git/trees')){if(failTree)throw Error('Injected tree failure');stagedTree=payload.tree;assert.equal(payload.base_tree,'base-tree');return {sha:'new-tree'}};
 if(path.endsWith('/git/commits'))return {sha:'new-commit'};
 if(method==='patch'){assert.equal(payload.force,false);stagedTree.forEach(item=>files.set(item.path,JSON.parse(item.content)));head=payload.sha;return {object:{sha:head}}};
 throw Error('Unexpected request '+path);
};
function reset(){
 files=new Map([
 ['data/v1/checklists/products/baseball.json',{product_map:{target:'old-product.json'},shards:['old-product.json']}],
 ['data/v1/checklists/products/old-product.json',{products:{target:{meta:{code:'target'},rows:[{player:'Old'}],parallels:[]},other:{rows:[{player:'KEEP'}]}}}],
 ['data/v1/checklists/search-index/baseball.json',{shards:['old-search.json'],product_shards:{target:['old-search.json']}}],
 ['data/v1/checklists/search-index/old-search.json',{rows:[{code:'target',player:'Old'}]}],
 ['data/v1/checklists/index.json',{index:[]}],['data/v1/manifest.json',{vault_version:'KEEP'}]
 ]);publicFiles=new Map([...files].map(([p,v])=>[p,clone(v)]));requests=[];head='base';stagedTree=null;failTree=false;conflict=false;
}
reset();
const result=ex.publishChecklistAfterImportLocked_({sport:'baseball',bucket:'2026',code:'target'});
assert.equal(requests.filter(x=>x.method==='patch').length,1,'release advances branch once');
assert.equal(result.publish_result.files_published,6);
assert.equal(result.validation.github.ok,true);assert.equal(result.validation.public.ok,false,'stale public assets cannot pass');
assert.equal(result.status,'published_pages_pending');
assert.equal(files.get('data/v1/checklists/products/old-product.json').products.other.rows[0].player,'KEEP');
assert.equal(files.get('data/v1/manifest.json').vault_version,'KEEP');
publicFiles=new Map([...files].map(([p,v])=>[p,clone(v)]));
assert.equal(ex.verifyChecklistReleaseBoth_('baseball','target',result.publish_result.expected).public.ok,true);
const product=files.get('data/v1/checklists/products/old-product.json').products.target;
product.rows[0].player='Tampered same row count';
assert.equal(ex.verifyChecklistRelease_('baseball','target',result.publish_result.expected,false).ok,false,'same counts are insufficient');
reset();failTree=true;
assert.throws(()=>ex.publishChecklistAfterImportLocked_({sport:'baseball',bucket:'2026',code:'target'}),/tree failure/);
assert.equal(requests.filter(x=>x.method==='patch').length,0,'staging failure exposes no release');
assert.equal(files.get('data/v1/checklists/products/old-product.json').products.target.rows[0].player,'Old');
reset();conflict=true;
assert.throws(()=>ex.publishChecklistAfterImportLocked_({sport:'baseball',bucket:'2026',code:'target'}),/conflict/);
assert.equal(requests.filter(x=>x.method==='patch').length,0,'concurrent changes are not overwritten');
assert.equal(vm.runInContext('CM_GITHUB_TRANSACTION',ex),null,'staging is cleared after failure');
console.log('Atomic commit, staging failure, conflict, exact content, and stale-public verification passed.');
// Product-scoped PRV publishing must not rewrite population files or duplicate
// an old target in a shared shard.
reset();
files.set('data/v1/vault/index.json',{index:[{Code:'target',DisplayName:'Old'},{Code:'other',DisplayName:'Keep'}]});
files.set('data/v1/vault/products/all.json',{product_map:{target:'shared.json',other:'shared.json'},shards:['shared.json']});
files.set('data/v1/vault/products/shared.json',{products:{target:{meta:{code:'target'},rows:[{setLine:'Old'}]},other:{meta:{code:'other'},rows:[{setLine:'KEEP'}]}}});
ex.buildPrvProductRelease_=()=>{
 const product={meta:{code:'target',displayName:'Target'},rows:[{code:'target',setLine:'New',printRun:1234}]};
 const index={Code:'target',DisplayName:'Target'};
 const expected={release_id:'test-prv-release',content_sha256:ex.productContentHash_(product),row_count:1,index_sha256:ex.pipelineHash_(index)};
 product.meta.release_id=expected.release_id;product.meta.content_sha256=expected.content_sha256;
 return {product,index,expected};
};
const prv=ex.publishPrvProductAtomic_('target');
assert.equal(prv.validation.github.ok,true);
assert(!stagedTree.some(file=>file.path.includes('/pop/')));
assert.equal(files.get('data/v1/vault/products/shared.json').products.target,undefined);
assert.equal(files.get('data/v1/vault/products/shared.json').products.other.rows[0].setLine,'KEEP');
assert.equal(requests.filter(x=>x.method==='patch').length,1);
console.log('PRV product-only publication and shared-shard migration passed.');

let jobFiles=new Map(),properties={};
const iterator=items=>{let index=0;return {hasNext:()=>index<items.length,next:()=>items[index++]}};
const folder={getId:()=> 'job-folder',getFiles:()=>iterator([...jobFiles.values()]),getFilesByName:name=>iterator(jobFiles.has(name)?[jobFiles.get(name)]:[]),
 createFile(name,text){let content=text;const file={getName:()=>name,setContent:value=>content=value,getBlob:()=>({getDataAsString:()=>content})};jobFiles.set(name,file);return file}};
ex.PropertiesService={getScriptProperties:()=>({getProperty:key=>properties[key],setProperty:(key,value)=>properties[key]=value})};
ex.DriveApp={createFolder:()=>folder,getFolderById:()=>folder};
ex.MimeType={PLAIN_TEXT:'text/plain'};ex.LockService={getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})};
ex.ScriptApp={getProjectTriggers:()=>[{getHandlerFunction:()=> 'runSentinelPublishJobs'}]};
reset();
const queued=ex.enqueuePipelineJob_('checklist',{request_id:'stable-request-123',sport:'baseball',bucket:'2026',code:'target',key:'DO-NOT-STORE'});
assert.equal(queued.job.stage,'queued');
ex.enqueuePipelineJob_('checklist',{request_id:'stable-request-123',sport:'baseball',bucket:'2026',code:'target'});
assert.equal(jobFiles.size,1,'a lost enqueue response cannot create a duplicate job');
assert.throws(()=>ex.enqueuePipelineJob_('checklist',{request_id:'stable-request-123',sport:'baseball',bucket:'2026',code:'other'}),/different publish target/);
assert(!jobFiles.get('stable-request-123.json').getBlob().getDataAsString().includes('DO-NOT-STORE'));
ex.runSentinelPublishJobs();
assert.equal(ex.readPipelineJob_('stable-request-123').data.stage,'published_pages_pending');
assert.equal(requests.filter(x=>x.method==='patch').length,1);
publicFiles=new Map([...files].map(([p,v])=>[p,clone(v)]));
const reconnected=ex.getPipelineJobStatus_('stable-request-123');
assert.equal(reconnected.job.stage,'complete');
assert.equal(requests.filter(x=>x.method==='patch').length,1,'verification after reconnect does not republish');
ex.runSentinelPublishJobs();
assert.equal(requests.filter(x=>x.method==='patch').length,1,'worker does not repeat completed jobs');
assert(ex.readPipelineJob_('stable-request-123').data.expected.content_sha256);
console.log('Durable queue deduplication, credential exclusion, worker, reconnect and verification-only resume passed.');

const prvOperator=context('command-center/operator-backend/Code.gs');
prvOperator.runRecoverableImport_=(_,kind,operation)=>{assert.equal(kind,'prv');return operation()};
prvOperator.previewPrvSource_=()=>({ok:true,status:'preview_ready',multi_product:true});
assert.equal(prvOperator.executePrvSourceImport_({sourceUrl:'source'}).ok,false,'mixed-product articles cannot write ambiguous rows');
const completeRows=Array.from({length:250},(_,i)=>({setType:'Parallel',setLine:'Parallel '+i,printRun:1000}));
prvOperator.previewPrvSource_=()=>({ok:true,status:'preview_ready',row_count:250,rows:completeRows.slice(0,200),product:{code:'prv-target',year:'2026'}});
prvOperator.fetchText_=()=> 'source';prvOperator.extractSubstackBodyHtml_=x=>x;prvOperator.parseSlabSquatchPrintRunRows_=()=>completeRows;
prvOperator.getVaultSpreadsheetId_=()=> 'prv-source';prvOperator.SpreadsheetApp={openById:()=>({getId:()=> 'prv-source'})};
prvOperator.upsertPrvIndex_=()=>{};
let writtenPrvRows;
prvOperator.replaceRowsByCode_=(_,name,code,rows)=>writtenPrvRows=rows;
prvOperator.validateWrittenPrvProduct_=()=>({ok:true,index_rows:1,product_rows:250});
assert.equal(prvOperator.executePrvSourceImport_({sourceUrl:'source'}).wrote.rows,250);
assert.equal(writtenPrvRows.length,250,'PRV writes must not truncate at the preview response cap');
console.log('PRV mixed-product protection and full-source import beyond preview cap passed.');
