import fs from 'node:fs';
import vm from 'node:vm';
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
 console.log(file+': persisted request identity, browser close/reconnect and failed-job pause passed');
}
