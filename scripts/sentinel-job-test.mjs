import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
for (const file of ['command-center/index.html','command-center/simple-agent/index.html']) {
 const script=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
 const fragment=script.slice(script.indexOf('      async function publishJsonWithRetry('),script.indexOf('      async function writeChecklistSource'));
 let queue=[],calls=[],modalOpen=true,completed=0,failed=0,uuid=0;
 const state={};
 const ctx=vm.createContext({DEFAULT_OPERATOR_URL:'https://operator.test',state,crypto:{randomUUID:()=> 'job-request-'+(++uuid)},requireOperatorKey:()=> 'test-key',
  queueKey:item=>[item.sport,item.bucket,item.code].join('|'),readJsonRetryQueue:()=>queue,
  writeLocalJsonRetryQueue:items=>queue=structuredClone(items),writeJsonRetryQueue:async items=>queue=structuredClone(items),renderJsonRetryNotice(){},
  openPreviewModal:()=>modalOpen=true,escapeHtml:String,getPublishError:()=> 'Injected failed job',
  renderPublishFailure:()=>failed++,renderPublishSuccess:()=>completed++,
  els:{previewModal:{classList:{contains:()=>modalOpen}}},setTimeout:fn=>{modalOpen=false;fn()},
  postOperatorJson:async (_,body)=>{
   assert(queue[0]?.request_id,'request identity must be saved before the request');
   assert(!JSON.stringify(queue).includes('test-key'),'credentials are not persisted');
   calls.push(structuredClone(body));return {job:{id:body.request_id,stage:'running'}};
  }});
 ctx.postOperatorStep=(action,payload)=>ctx.postOperatorJson("https://operator.test",Object.assign({action},payload));
 vm.runInContext(fragment,ctx);
 const input={target_bucket:'2026',product:{sport:'baseball',code:'target',display_name:'Target'}};
 await ctx.publishJsonWithRetry(input,1);
 assert.equal(calls.length,1);assert.equal(calls[0].job_id,'');assert.equal(queue[0].job_id,'job-request-1');
 assert.equal(state.publishInFlight,false);
 ctx.postOperatorJson=async (_,body)=>{calls.push(structuredClone(body));return {job:{id:body.job_id,stage:'complete'}}};
 await ctx.publishJsonWithRetry(input,1,queue[0]);
 assert.equal(calls[1].job_id,'job-request-1','a reconnect checks the existing job');
 assert.equal(completed,1);assert.equal(uuid,1,'reconnect must not create a new publish');
 ctx.postOperatorJson=async()=>({job:{id:'job-request-1',stage:'failed'}});
 await ctx.publishJsonWithRetry(input,1,queue[0]);
 assert.equal(failed,1);assert.equal(queue[0].job_stage,'failed');
 // A lost submission response must reconnect with the saved request ID.
 queue=[];let interruptedRequest='';
 ctx.postOperatorJson=async (_,body)=>{interruptedRequest=body.request_id;throw Error('connection lost');};
 await ctx.publishJsonWithRetry(input,1);
 assert.equal(queue[0].request_id,interruptedRequest);
 ctx.postOperatorJson=async (_,body)=>{assert.equal(body.request_id,interruptedRequest);return {job:{id:body.request_id,stage:'complete'}};};
 await ctx.publishJsonWithRetry(input,1,queue[0]);
 assert.equal(completed,2);
 // Never submit when neither local nor shared storage confirms the receipt.
 queue=[];let submissions=0;
 ctx.writeLocalJsonRetryQueue=()=>false;ctx.writeJsonRetryQueue=async()=>false;
 ctx.postOperatorJson=async()=>{submissions++;return {job:{id:'unsafe',stage:'running'}};};
 await ctx.publishJsonWithRetry(input,1);
 assert.equal(submissions,0,'a durable job identity must precede submission');
 assert.equal(state.publishInFlight,false);
 console.log(file+': persisted identity, lost response/reconnect, failed-job pause and storage-failure guard passed');
}

// S-1: staleness detection + alerting for jobs stuck in published_pages_pending.
// Load the Static Exporter worker into a VM context with in-memory Drive/Properties
// mocks and a captured UrlFetchApp so no real network/Drive calls occur.
{
 const clone=x=>JSON.parse(JSON.stringify(x));
 const source=fs.readFileSync(new URL('../command-center/static-exporter/Code.gs',import.meta.url),'utf8');
 const names=[...source.matchAll(/^function\s+(\w+)\(/gm)].map(m=>m[1]);
 assert.equal(new Set(names).size,names.length,'no duplicate function declarations in static-exporter Code.gs');

 // Shared GitHub-release harness (mirrors scripts/pipeline-integrity-test.mjs) so a
 // real publish reaches published_pages_pending and, once public assets match, complete.
 const utilities={DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},getUuid:()=>crypto.randomUUID(),sleep(){},
  computeDigest:(_,text)=>[...crypto.createHash('sha256').update(text).digest()],
  newBlob:text=>({getBytes:()=>[...Buffer.from(text)]})};
 let files,publicFiles,requests,stagedTree,head;
 function makeEx(){
  const ex=vm.createContext({Utilities:utilities,Date,console});
  vm.runInContext(source,ex);
  ex.getGitHubConfigBase_=()=>({owner:'owner',repo:'repo',branch:'main'});
  ex.fetchGitHubJsonFileBase_=path=>clone(files.get(path)||null);
  ex.fetchPublicJson_=path=>clone(publicFiles.get('data/v1/'+path)||null);
  ex.SpreadsheetApp={openById:()=>({getSheetByName:()=>null})};
  ex.buildChecklistStaticDataForSingleProductBase_=()=>({generated_at:'new',indexRow:{Code:'target',DisplayName:'Target',Keywords:'',year:'2026',sport:'baseball',manufacturer:'Topps',product:'Target'},
   productPayload:{ok:true,meta:{code:'target',displayName:'Target',year:'2026',sport:'baseball'},rows:[{code:'target',player:'New'}],parallels:[]},searchRows:[{code:'target',player:'New'}]});
  ex.githubRequest_=(method,path,payload)=>{
   requests.push({method,path,payload});
   if(path.includes('/git/ref/')) return {object:{sha:head}};
   if(method==='get'&&path.includes('/git/commits/')) return {tree:{sha:'base-tree'}};
   if(path.endsWith('/git/trees')){stagedTree=payload.tree;return {sha:'new-tree'}};
   if(path.endsWith('/git/commits'))return {sha:'new-commit'};
   if(method==='patch'){stagedTree.forEach(item=>files.set(item.path,JSON.parse(item.content)));head=payload.sha;return {object:{sha:head}}};
   throw Error('Unexpected request '+path);
  };
  return ex;
 }
 function resetRepo(){
  files=new Map([
  ['data/v1/checklists/products/baseball.json',{product_map:{target:'old-product.json'},shards:['old-product.json']}],
  ['data/v1/checklists/products/old-product.json',{products:{target:{meta:{code:'target'},rows:[{player:'Old'}],parallels:[]},other:{rows:[{player:'KEEP'}]}}}],
  ['data/v1/checklists/search-index/baseball.json',{shards:['old-search.json'],product_shards:{target:['old-search.json']}}],
  ['data/v1/checklists/search-index/old-search.json',{rows:[{code:'target',player:'Old'}]}],
  ['data/v1/checklists/index.json',{index:[]}],['data/v1/manifest.json',{vault_version:'KEEP'}]
  ]);publicFiles=new Map([...files].map(([p,v])=>[p,clone(v)]));requests=[];head='base';stagedTree=null;
 }
 // Wire the in-memory Drive/Properties/Lock mocks plus a captured UrlFetchApp.
 function wireQueue(ex,properties,sends){
  let jobFiles=new Map();
  const iterator=items=>{let index=0;return {hasNext:()=>index<items.length,next:()=>items[index++]}};
  const folder={getId:()=> 'job-folder',getFiles:()=>iterator([...jobFiles.values()]),getFilesByName:name=>iterator(jobFiles.has(name)?[jobFiles.get(name)]:[]),
   createFile(name,text){let content=text;const file={getName:()=>name,setContent:value=>content=value,getBlob:()=>({getDataAsString:()=>content})};jobFiles.set(name,file);return file}};
  ex.PropertiesService={getScriptProperties:()=>({getProperty:key=>properties[key],setProperty:(key,value)=>properties[key]=value})};
  ex.DriveApp={createFolder:()=>folder,getFolderById:()=>folder};
  ex.MimeType={PLAIN_TEXT:'text/plain'};ex.LockService={getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})};
  ex.ScriptApp={getProjectTriggers:()=>[{getHandlerFunction:()=> 'runSentinelPublishJobs'}]};
  ex.UrlFetchApp={fetch:(url,opts)=>{sends.push({url,opts});return {getResponseCode:()=>200,getContentText:()=>''}}};
  return jobFiles;
 }
 const CM_6H=6*60*60*1000;

 // Direct unit assertions on the pure decision seam.
 {
  const ex=makeEx();
  const now=Date.now();
  const thresh=vm.runInContext('CM_PUBLISHED_PAGES_PENDING_MAX_AGE_MS',ex);
  assert.equal(thresh,6*60*60*1000,'escalation threshold default is 6 hours');
  assert.equal(ex.shouldEscalatePendingJob_({stage:'published_pages_pending',verification_started_at:new Date(now-thresh-1000).toISOString()},now,thresh),true,'past-threshold pending escalates');
  assert.equal(ex.shouldEscalatePendingJob_({stage:'published_pages_pending',verification_started_at:new Date(now).toISOString()},now,thresh),false,'within-threshold pending does not escalate');
  assert.equal(ex.shouldEscalatePendingJob_({stage:'verifying',verification_started_at:new Date(now-thresh-1000).toISOString()},now,thresh),false,'non-pending stage never escalates');
  assert.equal(ex.shouldEscalatePendingJob_({stage:'published_pages_pending'},now,thresh),false,'missing timestamp does not throw and does not escalate');
 }

 // Build a stale published_pages_pending receipt directly in the queue so the worker
 // sees it without needing real propagation timing.
 function seedStaleJob(ex,jobFiles,id,agedMs){
  const started=new Date(Date.now()-agedMs).toISOString();
  const data={id,kind:'checklist',sport:'baseball',bucket:'2026',code:'target',stage:'published_pages_pending',attempts:1,
   created_at:started,updated_at:started,verification_started_at:started,commit:'abc123',
   expected:{release_id:'r1',content_sha256:'deadbeef'},result:{ok:true,status:'published_pages_pending'}};
  const folder=ex.DriveApp.getFolderById();
  folder.createFile(id+'.json',JSON.stringify(data));
  ex.PropertiesService.getScriptProperties().setProperty('CM_ACTIVE_PUBLISH_JOBS',JSON.stringify([id]));
 }

 // (a)+(b) Stale pending with a webhook configured: escalates once, alerts once.
 {
  resetRepo();
  const sends=[],properties={CM_SENTINEL_ALERT_WEBHOOK_URL:'https://hook.test'};
  const ex=makeEx(),jobFiles=wireQueue(ex,properties,sends);
  seedStaleJob(ex,jobFiles,'stale-webhook',CM_6H+1000);
  ex.runSentinelPublishJobs();
  const after=JSON.parse(jobFiles.get('stale-webhook.json').getBlob().getDataAsString());
  assert.equal(after.stage,'published_pages_timeout','a stale pending job escalates rather than lingering');
  assert.equal(after.escalated,true,'escalation flag is set on the receipt');
  assert.equal(after.commit,'abc123','commit evidence is preserved');
  assert.ok(after.expected&&after.expected.release_id==='r1','expected release evidence is preserved');
  assert.equal(sends.length,1,'exactly one alert is sent on escalation');
  assert.equal(sends[0].url,'https://hook.test');
  const payload=JSON.parse(sends[0].opts.payload);
  assert.equal(payload.state,'published_pages_timeout');
  assert.equal(payload.job_id,'stale-webhook');
  assert.equal(payload.commit,'abc123');
  assert(!JSON.stringify(sends[0].opts.payload).includes('CM_OPERATOR_KEY'),'admin keys stay out of the payload');
  ex.runSentinelPublishJobs();
  assert.equal(sends.length,1,'a later tick does not re-alert an already-escalated job');
 }

 // (c) Stale pending with NO webhook configured: still escalates, no network attempt, no throw.
 {
  resetRepo();
  const sends=[],properties={};
  const ex=makeEx(),jobFiles=wireQueue(ex,properties,sends);
  seedStaleJob(ex,jobFiles,'stale-nohook',CM_6H+1000);
  ex.runSentinelPublishJobs();
  const after=JSON.parse(jobFiles.get('stale-nohook.json').getBlob().getDataAsString());
  assert.equal(after.stage,'published_pages_timeout','escalation still happens with no webhook configured');
  assert.equal(after.escalated,true);
  assert.equal(sends.length,0,'no network call is attempted without a webhook property');
 }

 // (d) Pending within the threshold is left pending, no escalation or send.
 // Use a real publish so the receipt's expected hash matches the committed GitHub
 // assets; public assets stay stale so the opportunistic re-verify keeps it pending.
 {
  resetRepo();
  const sends=[],properties={CM_SENTINEL_ALERT_WEBHOOK_URL:'https://hook.test'};
  const ex=makeEx(),jobFiles=wireQueue(ex,properties,sends);
  ex.enqueuePipelineJob_('checklist',{request_id:'fresh-pending',sport:'baseball',bucket:'2026',code:'target'});
  ex.runSentinelPublishJobs();
  assert.equal(ex.readPipelineJob_('fresh-pending').data.stage,'published_pages_pending');
  // A second tick re-verifies opportunistically; still within threshold, so it stays pending.
  ex.runSentinelPublishJobs();
  const after=JSON.parse(jobFiles.get('fresh-pending.json').getBlob().getDataAsString());
  assert.equal(after.stage,'published_pages_pending','a within-threshold pending job stays pending');
  assert.notEqual(after.escalated,true);
  assert.equal(sends.length,0,'no alert for a within-threshold pending job');
 }

 // (e) No-regression: a normal publish reaches complete once public assets match.
 {
  resetRepo();
  const sends=[],properties={};
  const ex=makeEx(),jobFiles=wireQueue(ex,properties,sends);
  const queued=ex.enqueuePipelineJob_('checklist',{request_id:'happy-request-1',sport:'baseball',bucket:'2026',code:'target'});
  assert.equal(queued.job.stage,'queued');
  ex.runSentinelPublishJobs();
  assert.equal(ex.readPipelineJob_('happy-request-1').data.stage,'published_pages_pending','publish first lands in pending');
  publicFiles=new Map([...files].map(([p,v])=>[p,clone(v)]));
  const reconnected=ex.getPipelineJobStatus_('happy-request-1');
  assert.equal(reconnected.job.stage,'complete','normal propagation still reaches complete');
  assert.equal(sends.length,0,'the happy path fires no escalation alert');
 }

 console.log('static-exporter S-1: stale-pending escalation, single alert, safe-by-default no-webhook, within-threshold pending and happy-path complete passed');
}
