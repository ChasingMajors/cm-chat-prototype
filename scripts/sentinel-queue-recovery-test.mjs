import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
for (const file of ['command-center/index.html','command-center/simple-agent/index.html']) {
 const script=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
 const fragment=script.slice(script.indexOf('      function queueKey('),script.indexOf('      function renderJsonRetryNotice('));
 const older={kind:'prv',sport:'baseball',bucket:'2026',code:'target',request_id:'saved-request',job_id:'',updated_at:'2026-10-17T12:00:00Z'};
 const newer={...older,job_id:'saved-request',job_stage:'running',updated_at:'2026-10-17T12:01:00Z'};
 let stored=JSON.stringify([newer]),saves=[],failLoad=false,failSave=false;
 const state={};
 const c=vm.createContext({state,DEFAULT_OPERATOR_URL:'fixture',JSON_RETRY_QUEUE_KEY:'queue',readOperatorKey:()=> 'fixture-key',
  localStorage:{getItem:()=>stored,setItem:(_,s)=>stored=s},explainBackendError:String,
  postOperatorJson:async (_,body)=>{if(body.action==='loadAgentMemory'){if(failLoad)throw Error('offline');return {ok:true,memory:{schema:'agent_memory_v1',json_publish_retry_queue:[older]}};}if(failSave)throw Error('save offline');saves.push(structuredClone(body.memory));return {ok:true};}
 });
 vm.runInContext(fragment,c);
 await c.loadSharedJsonRetryQueue();
 assert.equal(saves.length,1,'a newer receipt for the same product must be saved even when queue length is unchanged');
 assert.equal(saves[0].json_publish_retry_queue[0].job_id,newer.job_id);
 assert.deepEqual(JSON.parse(stored),[]);
 stored=JSON.stringify([newer]);failLoad=true;
 await c.loadSharedJsonRetryQueue();
 assert.equal(state.jsonRetryQueue[0].job_id,newer.job_id,'failed shared reads retain the local receipt in memory');
 assert.equal(JSON.parse(stored)[0].job_id,newer.job_id);
 failLoad=false;failSave=true;
 await c.loadSharedJsonRetryQueue();
 assert.equal(JSON.parse(stored)[0].job_id,newer.job_id,'failed sync must never clear the unsynced receipt');
 assert.equal(state.jsonQueueShared,false);
 console.log(file+': same-product receipt updates and offline queue recovery passed');
}
