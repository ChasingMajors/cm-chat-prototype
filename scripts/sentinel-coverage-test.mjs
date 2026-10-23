import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const cache=new Map();
const c=vm.createContext({Utilities:{DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,s)=>[...crypto.createHash('sha256').update(s).digest()]},CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v,ttl)=>{assert.equal(ttl,300);cache.set(k,v);}})}});
vm.runInContext(fs.readFileSync(new URL('../command-center/operator-backend/Code.gs',import.meta.url),'utf8'),c);
const src=(name,value=10,size='')=>({setType:'Insert',setLine:name,printRun:value,serial:'',subSetSize:size});
const pub=(name,value=10,size=null)=>({set_name:name,measurement:{value,kind:'estimate'},serial_limit:null,checklist_size:size,raw:{serial:''}});
assert.equal(c.comparePrvCoverageRows_([src('One')],[pub('One')]).state,'parsed_rows_match');
assert.equal(c.comparePrvCoverageRows_([src('One'),src('Two')],[pub('One')]).state,'partially_covered');
assert.equal(c.comparePrvCoverageRows_([src('One',11)],[pub('One')]).state,'source_updated');
assert.equal(c.comparePrvCoverageRows_([src('One',10,5)],[pub('One',10,4)]).state,'source_updated');
assert.equal(c.comparePrvCoverageRows_([src('One')],[pub('One'),pub('One')]).state,'uncertain_match');
assert.equal(c.comparePrvCoverageRows_([src('One')],[{...pub('One'),serial_limit:10}]).state,'uncertain_match');
assert.equal(c.comparePrvCoverageRows_([],[]).state,'unverified');
assert.equal(c.comparePrvCoverageRows_([src('One')],[pub('One',null)]).state,'uncertain_match');
const index={code:'target',name:'2026 Topps Chrome Baseball',sport:'baseball',row_count:1,public_file:'target-abc.json',public_revision:'one'};
const item={title:index.name,sport:'baseball',source_url:'https://slabsquatch.substack.com/p/test',matched_code:'target',status:'needs_review'};
c.extractSubstackBodyHtml_=()=> 'body';c.isSubstackPostPaywalled_=()=>false;c.extractSubstackPostTitle_=()=>index.name;c.parseSlabSquatchPrintRunRows_=()=>[src('One')];c.splitPrvProductTitles_=()=>[index.name];
let reads=0;c.fetchText_=url=>{reads++;return url.includes('/products/')?JSON.stringify({meta:{code:'target',sport:'baseball'},rows:[pub('One')]}):'article';};
let result=c.reviewPrvSourceCoverage_(item,[index],{remaining:8});assert.equal(result.status,'covered');assert.ok(result.source_fingerprint);assert.ok(result.coverage_checked_at);assert.equal(reads,2);
result=c.reviewPrvSourceCoverage_(item,[index],{remaining:0});assert.equal(result.status,'covered');assert.equal(result.coverage_cached,true);assert.equal(reads,2);
result=c.reviewPrvSourceCoverage_(item,[{...index,public_file:'target-new.json'}],{remaining:0});assert.equal(result.status,'needs_review');assert.equal(result.coverage_state,'unverified');
result=c.reviewPrvSourceCoverage_(item,[index,{...index,code:'duplicate'}],{remaining:8});assert.equal(result.coverage_state,'uncertain_match');
result=c.reviewPrvSourceCoverage_({...item,title:'2025 Topps Chrome Baseball'},[index],{remaining:8});assert.equal(result.coverage_state,'uncertain_match');
cache.clear();c.fetchText_=()=>{throw Error('offline');};result=c.reviewPrvSourceCoverage_(item,[index],{remaining:8});assert.equal(result.coverage_state,'unverified');assert.equal(cache.size,0);
// PRV 404 fix (Layer B): a matched product whose published file 404s (stale index) must read as a clean
// informational 'data_unavailable' state, not the generic 'unverified' "Coverage check failed" error.
cache.clear();c.extractSubstackBodyHtml_=()=>'body';c.isSubstackPostPaywalled_=()=>false;c.extractSubstackPostTitle_=()=>index.name;c.parseSlabSquatchPrintRunRows_=()=>[src('One')];c.splitPrvProductTitles_=()=>[index.name];
c.fetchText_=url=>{if(url.includes('/products/')){const e=new Error('Fetch failed 404 for '+url);e.statusCode=404;throw e;}return 'article';};
result=c.reviewPrvSourceCoverage_(item,[index],{remaining:8});assert.equal(result.coverage_state,'data_unavailable','a 404 on a matched product file is a clean not-available state');assert.notEqual(result.coverage_state,'unverified','a 404 must not read as a generic coverage failure');
// Regression: a non-404 file-fetch failure still reads as 'unverified'.
c.fetchText_=url=>{if(url.includes('/products/')){const e=new Error('Fetch failed 503 for '+url);e.statusCode=503;throw e;}return 'article';};
result=c.reviewPrvSourceCoverage_(item,[index],{remaining:8});assert.equal(result.coverage_state,'unverified','a 5xx file-fetch failure still reads as unverified');
c.fetchText_=()=> 'article';c.isSubstackPostPaywalled_=()=>true;result=c.reviewPrvSourceCoverage_(item,[index],{remaining:8});assert.equal(result.status,'known_issue');assert.notEqual(result.status,'covered');
c.fetchText_=()=> '{}';assert.throws(()=>c.fetchVaultPublicIndexRows_(),/coverage is unavailable/);
assert.equal(c.classifyPrvSourceItem_(item,[index]).status,'needs_review','positive row count alone cannot mean covered');
// FEAT-002: a strong match that is a published-but-empty PRV shell is 'known_empty', not possible_update/missing/needs_review.
const emptyIndex={...index,row_count:0,status:'empty'};
const emptyClassified=c.classifyPrvSourceItem_(item,[emptyIndex]);
assert.equal(emptyClassified.status,'known_empty','strong match with status:empty must be known_empty');
assert.equal(emptyClassified.coverage_state,'known_empty','known_empty carries coverage_state');
assert.equal(emptyClassified.matched_code,'target','known_empty carries matched_code');
assert.equal(emptyClassified.matched_name,index.name,'known_empty carries matched_name');
assert.notEqual(emptyClassified.status,'possible_update');
assert.notEqual(emptyClassified.status,'missing');
assert.notEqual(emptyClassified.status,'needs_review');
// Backward-compat: no status field, row_count 0 still derives known_empty.
const emptyNoStatus={...index,row_count:0};delete emptyNoStatus.status;
assert.equal(c.classifyPrvSourceItem_(item,[emptyNoStatus]).status,'known_empty','row_count:0 alone derives known_empty');
// Preserved behavior: a non-match still returns missing.
assert.equal(c.classifyPrvSourceItem_({...item,title:'Totally Unrelated Product 1999',sport:'baseball'},[index]).status,'missing','non-match still returns missing');
// FEAT-002 (F1): the COMPOSED source-watch flow must preserve known_empty as terminal/non-actionable.
// A known-empty published shell whose source post parses a real print-run row must NOT be
// relabeled possible_update/partially_covered/needs_review by the coverage/budget logic.
(function(){
  const base={...index,row_count:0,status:'empty'};
  c.extractSubstackBodyHtml_=()=>'body';c.isSubstackPostPaywalled_=()=>false;c.extractSubstackPostTitle_=()=>index.name;
  c.parseSlabSquatchPrintRunRows_=()=>[src('One')];c.splitPrvProductTitles_=()=>[index.name];
  // A parseable source payload exists for the matched product; before the fix this made it actionable.
  c.fetchText_=url=>url.includes('/products/')?JSON.stringify({meta:{code:'target',sport:'baseball'},rows:[pub('One',11)]}):'article';
  cache.clear();
  // With remaining budget — the path that formerly re-labeled to possible_update/needs_review.
  let composed=c.reviewPrvSourceCoverage_(c.classifyPrvSourceItem_(item,[base]),[base],{remaining:8});
  assert.equal(composed.status,'known_empty','composed flow keeps known_empty with budget remaining');
  assert.equal(composed.coverage_state,'known_empty','known_empty coverage_state preserved through review');
  assert.equal(composed.matched_code,'target','known_empty keeps matched_code through review');
  for(const actionable of ['possible_update','partially_covered','needs_review','source_updated','covered']){
    assert.notEqual(composed.status,actionable,'known_empty must not be relabeled '+actionable);
    assert.notEqual(composed.coverage_state,actionable,'known_empty coverage_state must not be relabeled '+actionable);
  }
  // With exhausted budget — the path that formerly re-labeled to needs_review/unverified.
  composed=c.reviewPrvSourceCoverage_(c.classifyPrvSourceItem_(item,[base]),[base],{remaining:0});
  assert.equal(composed.status,'known_empty','composed flow keeps known_empty even with exhausted budget');
  assert.equal(composed.coverage_state,'known_empty','exhausted budget does not relabel known_empty');
  // Preserved: a genuinely missing product still flows through to an actionable/missing status.
  const missingComposed=c.reviewPrvSourceCoverage_(c.classifyPrvSourceItem_({...item,title:'Totally Unrelated Product 1999',sport:'baseball'},[base]),[base],{remaining:8});
  assert.equal(missingComposed.status,'missing','genuinely missing product still returns missing through composed flow');
})();
// FEAT-002: runDeepBackendAudit_ downgrades an empty-sheet product to informational when the public index row is a known-empty shell.
const auditSource={Code:'target',code:'target',sport:'baseball',DisplayName:index.name,year:'2026',Keywords:'kw',row_count:0,parallel_count:0};
c.fetchChecklistSourceRows_=()=>[auditSource];
c.fetchChecklistPublicJsonRows_=()=>[{Code:'target',code:'target',sport:'baseball',DisplayName:index.name,row_count:0,parallel_count:0,status:'empty'}];
const knownEmptyAudit=c.runDeepBackendAudit_({}).issues.find(i=>i.type==='product_has_no_checklist_rows');
assert.ok(knownEmptyAudit,'empty-sheet product still produces an entry');
assert.equal(knownEmptyAudit.status,'known_empty','known-empty public shell downgrades the empty-sheet issue');
assert.equal(knownEmptyAudit.severity,'low','known-empty empty-sheet issue is informational');
c.fetchChecklistPublicJsonRows_=()=>[{Code:'target',code:'target',sport:'baseball',DisplayName:index.name,row_count:0,parallel_count:0}];
const needsAdminAudit=c.runDeepBackendAudit_({}).issues.find(i=>i.type==='product_has_no_checklist_rows');
assert.equal(needsAdminAudit.status,'needs_admin','without a known-empty public shell the empty-sheet issue stays actionable');
assert.equal(needsAdminAudit.severity,'medium','non-shell empty-sheet issue stays medium severity');
console.log('PRV coverage: missing groups, changed values/counts, ambiguity, serial semantics, cached fingerprints, revision invalidation, known-empty shells and unavailable sources passed.');
const action={type:'prv_source_review',product:index.name,sport:'baseball',sourceUrl:item.source_url,coverageState:'partially_covered',status:'approval_required'};
assert.equal(c.validateScheduledAutoActionSafety_(action).ok,false);
assert.equal(c.validateScheduledAutoActionSafety_({...action,status:'approved'}).ok,true);
const memory=c.mergeScheduledPrvActions_([],[{...item,coverage_state:'unverified'}],'now','quick_json');assert.equal(memory[0].coverageState,'unverified');assert.equal(c.validateScheduledAutoActionSafety_(memory[0]).ok,false);
