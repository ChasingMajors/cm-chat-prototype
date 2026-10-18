import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const c=vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../command-center/static-exporter/Code.gs',import.meta.url),'utf8'),c);
let ids=[],checks=[],uploads=0;
const jobs=new Map();
c.PropertiesService={getScriptProperties:()=>({getProperty:()=>JSON.stringify(ids),setProperty:(_,v)=>ids=JSON.parse(v)})};
c.LockService={getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})};
c.readPipelineJob_=id=>jobs.get(id);
c.verifyPrvReleaseBoth_=code=>{checks.push(code);return {github:{ok:false},public:{ok:false}}};
c.publishPrvProductAtomic_=()=>{uploads++;return {ok:true,status:'published_and_public_validated'}};
function job(id,stage,extra={}) {
 const j={data:{id,code:id,kind:'prv',stage,created_at:'2026-01-01T00:00:00Z',updated_at:new Date(Date.now()-3600000).toISOString(),attempts:0,...extra},file:{setContent(){}}};
 jobs.set(id,j);ids.push(id);return j;
}
const a=job('older','published_pages_pending',{expected:{},verification_started_at:new Date().toISOString(),verification_checked_at:'2026-01-01T00:00:00Z'});
const b=job('other','published_pages_pending',{expected:{},verification_started_at:new Date().toISOString(),verification_checked_at:'2026-01-02T00:00:00Z'});
job('queued','queued');
c.runSentinelPublishJobs();
assert.deepEqual(checks,['older'],'a pending release gets checked despite a queued upload');assert.equal(uploads,1);
assert.equal(a.data.stage,'verifying');assert.equal(a.data.verification_checks,1);assert(a.data.verification_checked_at>'2026-01-02');
c.runSentinelPublishJobs();assert.deepEqual(checks,['older','other'],'unsuccessful checks rotate instead of starving other pending releases');assert.equal(uploads,1);
const expired=job('expired','published_pages_pending',{expected:{},commit:'saved-commit',verification_started_at:new Date(Date.now()-25*3600000).toISOString()});
const result=c.publicPipelineJob_(expired,true);
assert.equal(result.job.stage,'failed');assert.equal(result.ok,false);assert.match(result.error,/24 hours/);assert(!ids.includes('expired'));assert.equal(expired.data.commit,'saved-commit');assert.equal(uploads,1,'expiry never uploads');
c.verifyPrvReleaseBoth_=()=>({github:{ok:true},public:{ok:true}});
assert.equal(c.publicPipelineJob_(a,true).job.stage,'complete');assert.equal(a.data.error,'');assert(!ids.includes('older'));assert.equal(uploads,1);
console.log('Pending verification fairness, busy-queue progress, bounded expiry, saved receipt retention and no-repeat uploads passed.');
