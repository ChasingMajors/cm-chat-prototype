import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../command-center/operator-backend/PublishMonitor.gs',import.meta.url),'utf8');
const A='a'.repeat(40),B='b'.repeat(40),P='c'.repeat(40);
function harness(){
 const props=new Map(),sent=[],calls=[];let triggers=[],locked=false;
 const ctx=vm.createContext({console,Date,JSON,PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k)})},
  Utilities:{newBlob:s=>({getBytes:()=>Buffer.from(s)}),DigestAlgorithm:{SHA_256:'SHA256'},Charset:{UTF_8:'UTF8'},computeDigest:(_,s)=>[...crypto.createHash('sha256').update(s).digest()]},
  LockService:{getScriptLock:()=>({tryLock:()=>{if(locked)return false;locked=true;return true;},releaseLock:()=>{locked=false;}})},
  ScriptApp:{getProjectTriggers:()=>triggers,newTrigger:fn=>({timeBased(){return this;},everyMinutes(){return this;},create(){triggers.push({getHandlerFunction:()=>fn});}}),deleteTrigger:t=>{triggers=triggers.filter(x=>x!==t);}},
  MailApp:{getRemainingDailyQuota:()=>10,sendEmail:(...args)=>sent.push(args)},UrlFetchApp:{fetch:(url,options)=>{calls.push({url,options});throw Error('Unexpected network call');}},
  requireOperatorKey_:key=>{if(key!=='admin')throw Error('Invalid operator key');}});
 vm.runInContext(source,ctx);
 const job=()=>({id:'test-job-0001',code:'product',kind:'checklist',state:'commit_submitted',submitted_sha:A,release_sha:A,created_at:new Date().toISOString(),deadline_at:new Date(Date.now()+3600000).toISOString(),next_poll_at:new Date(0).toISOString(),polls:0,evidence:{}});
 const api=(options={})=>path=>{
  calls.push(path);
  if(path==='/commits/'+A)return {parents:[{sha:P}]};
  if(path.startsWith('/actions/workflows/'))return {workflow_runs:options.runs??[{id:10,run_attempt:1,run_number:1,path:'.github/workflows/vault-data.yml',head_sha:A,event:'push',status:'completed',conclusion:'success',html_url:'https://github.com/ChasingMajors/chasing-majors-app/actions/runs/10'}]};
  if(path==='/pages/builds/latest')return {commit:options.release||A,status:options.buildStatus||'built'};
  if(path==='/commits/'+B)return {parents:[{sha:options.parent||A}],commit:{message:'Refresh structured Vault data',committer:{date:'2026-10-26T12:01:00Z'}},author:{login:'github-actions[bot]'}};
  if(path==='/actions/runs/10/jobs?per_page=30')return {jobs:[{name:'refresh',started_at:'2026-10-26T12:00:00Z',completed_at:'2026-10-26T12:02:00Z'}]};
  if(path.startsWith('/deployments?'))return [{id:22,sha:options.release||A,environment:'github-pages'}];
  if(path==='/deployments/22/statuses?per_page=10')return [{state:options.deploymentState||'success'}];
  throw Error('Unhandled '+path);
 };
 return {ctx,props,sent,calls,job,api,get triggers(){return triggers;}};
}
test('matching successful SHA, checks and deployment reach live verified only with content proof',()=>{const h=harness(),j=h.job();h.ctx.pubmonEvaluate_(j,h.api(),()=>({ok:true,release_sha:A,deployed_sha:A}));assert.equal(j.state,'live_verified');assert.equal(j.base_sha,P);assert.equal(j.workflow_run_id,10);assert.equal(j.deployment_id,22);assert.equal(j.search_state,'pending');});
for(const conclusion of ['failure','cancelled','skipped','timed_out','action_required','neutral'])test('workflow '+conclusion+' is actionable, never live',()=>{const h=harness(),j=h.job();const run={id:10,head_sha:A,path:'.github/workflows/vault-data.yml',event:'push',status:'completed',conclusion,html_url:'https://github.com/ChasingMajors/chasing-majors-app/actions/runs/10'};h.ctx.pubmonEvaluate_(j,h.api({runs:[run]}),()=>{throw Error('Must not verify live');});assert.equal(j.state,conclusion==='cancelled'?'cancelled':'failed');assert.match(j.error,new RegExp(conclusion));});
test('missing workflow remains unverified',()=>{const h=harness(),j=h.job();h.ctx.pubmonEvaluate_(j,h.api({runs:[]}),()=>({ok:true,release_sha:A}));assert.equal(j.state,'commit_submitted');assert.match(j.waiting_for,/Missing/);});
test('unrelated workflow/SHA cannot prove success',()=>{const h=harness(),j=h.job();h.ctx.pubmonEvaluate_(j,h.api({runs:[{head_sha:B,path:'.github/workflows/vault-data.yml',event:'push',conclusion:'success',status:'completed'}]}),()=>({ok:true,release_sha:A}));assert.equal(j.state,'commit_submitted');});
test('CI successor needs direct parent, exact bot message and workflow time window',()=>{const h=harness(),j=h.job();h.ctx.pubmonEvaluate_(j,h.api({release:B}),()=>({ok:true,release_sha:A,deployed_sha:B}));assert.equal(j.state,'live_verified');assert.equal(j.release_sha,B);const bad=h.job();h.ctx.pubmonEvaluate_(bad,h.api({release:B,parent:P}),()=>({ok:true,release_sha:A,deployed_sha:B}));assert.equal(bad.state,'checks_passed');});
test('deployment error fails independently',()=>{const h=harness(),j=h.job();h.ctx.pubmonEvaluate_(j,h.api({deploymentState:'error'}),()=>({ok:true,release_sha:A}));assert.equal(j.state,'failed');});
test('HTTP success without SHA/content evidence cannot pass',()=>{const h=harness(),j=h.job();h.ctx.pubmonEvaluate_(j,h.api(),()=>({ok:false,reason:'Manifest SHA absent'}));assert.equal(j.state,'pages_deployed');assert.match(j.waiting_for,/absent/);});
test('live verifier rejects missing manifest SHA and never substitutes timestamp',()=>{const h=harness(),j=h.job();h.ctx.UrlFetchApp.fetch=()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({generated_at:'now'})});assert.equal(h.ctx.pubmonLive_(j).ok,false);});
test('live verifier requires exact hash, counts, release UUID and SHA',()=>{const h=harness(),j=h.job();j.expected={release_id:'release',content_sha256:'hash',row_count:763,parallel_count:83};h.ctx.UrlFetchApp.fetch=()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({release_sha:A})});h.ctx.pubmonExporter_=()=>({validation:{public:{ok:true,validation_mode:'exact_content_and_release',release_id:'release',content_sha256:'hash',row_count:763,parallel_count:83}}});assert.equal(h.ctx.pubmonLive_(j).ok,true);j.expected.row_count=1;assert.equal(h.ctx.pubmonLive_(j).ok,false);});
test('durable registration is idempotent and excludes credentials',()=>{const h=harness(),p={request_id:'stable-job-001',action:'publishChecklistAfterImport',async:'1',code:'product',key:'secret'};h.ctx.pubmonRegister_(p);h.ctx.pubmonRegister_(p);assert.equal(h.ctx.pubmonIds_().length,1);assert.equal(h.triggers.length,1);assert(!JSON.stringify([...h.props]).includes('secret'));assert.equal(h.ctx.pubmonRead_(p.request_id).exporter_job_id,p.request_id);assert.equal(h.ctx.pubmonRead_(p.request_id).approved_content_hash,null);assert.throws(()=>h.ctx.pubmonRegister_({...p,code:'other'}),/conflict/);});
test('failed receipt persistence prevents publishing registration',()=>{const h=harness();h.ctx.PropertiesService.getScriptProperties=()=>({getProperty:()=>null,setProperty:()=>{throw Error('store failed');}});assert.throws(()=>h.ctx.pubmonRegister_({request_id:'stable-job-001'}),/store failed/);});
test('terminal jobs stop network polling; one email and trigger removed',()=>{const h=harness(),j=h.job();j.state='failed';h.props.set('CM_SENTINEL_ALERT_EMAIL','owner@example.test');h.props.set('CM_PUBMON_INDEX',JSON.stringify([j.id]));h.ctx.pubmonSave_(j);h.ctx.pubmonEnsureTrigger_();h.ctx.runPublishMonitor();h.ctx.runPublishMonitor();assert.equal(h.sent.length,1);assert.equal(h.calls.length,0);assert.equal(h.triggers.length,0);assert.equal(h.ctx.pubmonRead_(j.id).alert_status,'sent');});
test('quota failure remains visible and retries without falsely claiming delivery',()=>{const h=harness(),j=h.job();j.state='overdue';h.props.set('CM_SENTINEL_ALERT_EMAIL','owner@example.test');h.ctx.MailApp.getRemainingDailyQuota=()=>0;h.ctx.pubmonAlert_(j);assert.equal(j.alert_status,'blocked_mail_quota');assert.equal(h.sent.length,0);assert(!j.alert_claimed_at);h.ctx.MailApp.getRemainingDailyQuota=()=>1;h.ctx.pubmonAlert_(j);h.ctx.pubmonAlert_(j);assert.equal(h.sent.length,1);});
test('uncertain email send is not duplicated or presented as sent',()=>{const h=harness(),j=h.job();j.state='failed';h.props.set('CM_SENTINEL_ALERT_EMAIL','owner@example.test');let attempts=0;h.ctx.MailApp.sendEmail=()=>{attempts++;throw Error('timeout');};h.ctx.pubmonAlert_(j);h.ctx.pubmonAlert_(j);assert.equal(attempts,1);assert.equal(j.alert_status,'delivery_unconfirmed');});
test('overdue deadline applies even when monitoring fails',()=>{const h=harness(),j=h.job();j.deadline_at=new Date(0).toISOString();h.ctx.pubmonGitHub_=()=>{throw Error('unavailable');};h.ctx.pubmonPoll_(j);assert.equal(j.state,'overdue');assert.equal(j.polls,1);assert(j.next_poll_at);});
test('backoff and terminal gate prevent requests',()=>{const h=harness(),j=h.job();j.next_poll_at=new Date(Date.now()+60000).toISOString();h.ctx.pubmonPoll_(j);j.state='failed';j.next_poll_at=new Date(0).toISOString();h.ctx.pubmonPoll_(j);assert.equal(h.calls.length,0);assert.equal(j.polls,0);});
test('unauthenticated status rejects before storage/network',()=>{const h=harness();assert.throws(()=>h.ctx.publishMonitorStatus_({key:'wrong'}),/Invalid/);assert.equal(h.calls.length,0);});
test('monitor has no D1, Sheet, webhook or authoring API operations',()=>{assert(!/SpreadsheetApp|api\.cloudflare|webhook|method:\s*["'](?:patch|put|delete)["']/.test(source));assert(!/CM_GITHUB_TOKEN/.test(source));});
