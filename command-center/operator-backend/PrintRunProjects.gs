/* Owner-authorized public Lab snapshots. Deploy with generated PrintRunModel.gs.
 * No CV/PRV/Sheet/D1 writes. Fixed repo/path; no client-selected destination.
 */
var PRL_OWNER='ChasingMajors', PRL_REPO='cm-chat-prototype', PRL_BRANCH='main';
var PRL_PREFIX='data/print-run-lab/v1/', PRL_PUBLIC='https://sentinel.chasingmajors.com/';
function prlEnabled_(){return PropertiesService.getScriptProperties().getProperty('CM_PRL_PUBLISH_ENABLED')==='true';}
function prlToken_(){var t=PropertiesService.getScriptProperties().getProperty('CM_GITHUB_TOKEN');if(!t)throw Error('Lab publishing credential is not configured.');return t;}
function prlAdminCapabilities_(body){
  requireOperatorKey_(body.key);
  return {ok:true,capabilities:{author:true,publish:prlEnabled_()&&!!PropertiesService.getScriptProperties().getProperty('CM_GITHUB_TOKEN')},model:{version:PRLModel.MODEL_VERSION,engine_sha256:PRLModel.ENGINE_SHA256}};
}
function prlHash_(s){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,s,Utilities.Charset.UTF_8).map(function(n){return ('0'+(n&255).toString(16)).slice(-2);}).join('');}
function prlBytes_(s){return Utilities.newBlob(s).getBytes().length;}
function prlRequestId_(id){if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{16,80}$/.test(id))throw Error('Invalid publish request ID.');return id;}
function prlApi_(method,path,payload,missing){
  var url=githubRepoApiUrl_(PRL_OWNER,PRL_REPO,path),options={method:method,contentType:'application/json'};if(payload!==undefined)options.payload=JSON.stringify(payload);var r=githubFetch_(url,prlToken_(),options),code=r.getResponseCode();
  if(code===404&&missing)return null;
  if(code<200||code>=300)throw Error('Lab repository request failed (HTTP '+code+'); no automatic publication retry.');
  var s=r.getContentText();return s?JSON.parse(s):{};
}
function prlCatalogValid_(c){
  return PRLModel.validateCatalog(c);
}
function prlCatalog_(sha){
  var f=prlApi_('get','/contents/'+PRL_PREFIX+'index.json?ref='+encodeURIComponent(sha),undefined,true);
  if(!f)return {schema_version:1,projects:[]};
  if(f.encoding!=='base64'||typeof f.content!=='string')throw Error('Public projects index is unavailable.');
  return prlCatalogValid_(JSON.parse(Utilities.newBlob(Utilities.base64Decode(f.content.replace(/\s/g,''))).getDataAsString('UTF-8')));
}
function prlReadJob_(id){var s=PropertiesService.getScriptProperties().getProperty('CM_PRL_JOB_'+prlRequestId_(id));return s?JSON.parse(s):null;}
function prlSaveJob_(job){
  var props=PropertiesService.getScriptProperties(),text=JSON.stringify(job);if(prlBytes_(text)>7500)throw Error('Publication receipt is too large.');
  var ids=JSON.parse(props.getProperty('CM_PRL_JOBS')||'[]');
  if(ids.indexOf(job.request_id)<0){
    while(ids.length>=50){var at=ids.findIndex(function(id){var old=prlReadJob_(id);return !old||['live_verified','failed','superseded'].indexOf(old.state)>=0;});if(at<0)throw Error('Resolve outstanding publication receipts before publishing more projects.');props.deleteProperty('CM_PRL_JOB_'+ids[at]);ids.splice(at,1);}
    ids.push(job.request_id);
  }
  // Persist/index receipt before a Git ref can move. Lost responses are recoverable.
  props.setProperty('CM_PRL_JOB_'+job.request_id,text);props.setProperty('CM_PRL_JOBS',JSON.stringify(ids));
  if(props.getProperty('CM_PRL_JOB_'+job.request_id)!==text)throw Error('Publication receipt could not be saved.');
}
function prlReply_(job){return {ok:true,publication:job};}
function prlPublish_(body){
  requireOperatorKey_(body.key);
  if(!prlEnabled_())throw Error('Lab publishing is not enabled. Local Save does not publish a project.');
  prlToken_();prlRequestId_(body.request_id);
  if(body.engine_sha256!==PRLModel.ENGINE_SHA256)throw Error('The Lab and publishing backend need the same calculation version. Save your draft and reload after the backend update.');
  var project=PRLModel.sanitizeProject(body.project);
  var id=body.project_id==null?null:body.project_id,expected=body.expected_revision==null?null:body.expected_revision;
  if(id!==null&&!/^prl_[a-zA-Z0-9-]{8,80}$/.test(id))throw Error('Invalid project ID.');
  if(expected!==null&&(typeof expected!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(expected)))throw Error('Invalid expected revision.');
  var requestHash=prlHash_(JSON.stringify({project:project,project_id:id,expected_revision:expected,engine:PRLModel.ENGINE_SHA256}));
  var lock=LockService.getScriptLock();if(!lock.tryLock(1000))throw Error('Another publication is in progress. Check status before retrying.');
  var job;
  try{
    var existing=prlReadJob_(body.request_id);
    if(existing){if(existing.request_hash!==requestHash)throw Error('Publish request ID was already used for different content.');return prlReply_(existing);}
    var base=prlApi_('get','/git/ref/heads/'+PRL_BRANCH).object.sha,catalog=prlCatalog_(base);
    var entry=id?catalog.projects.find(function(p){return p.id===id;}):null;
    if((entry?entry.revision_id:null)!==expected||id&&!entry)throw Error('Published project changed or no longer exists. Reload it before publishing a new revision.');
    id=id||'prl_'+Utilities.getUuid();var revision=Utilities.getUuid(),now=new Date().toISOString();
    var artifact=PRLModel.buildArtifact(project,{projectId:id,revisionId:revision,publishedAt:now});
    var artifactText=JSON.stringify(artifact,null,2)+'\n';if(prlBytes_(artifactText)>4*1024*1024)throw Error('Public revision exceeds 4 MB.');
    var hash=prlHash_(artifactText),path='projects/'+id+'/'+revision+'-'+hash.slice(0,12)+'.json';
    var nextEntry={id:id,title:project.title,revision_id:revision,path:path,sha256:hash,published_at:now,estimate_status:'provisional',calibration_status:'not-yet-calibrated',model:artifact.model};
    catalog={schema_version:1,release_id:revision,updated_at:now,projects:catalog.projects.filter(function(p){return p.id!==id;}).concat([nextEntry])};prlCatalogValid_(catalog);
    job={request_id:body.request_id,request_hash:requestHash,project_id:id,revision_id:revision,path:path,sha256:hash,base_commit:base,state:'validated',created_at:now};prlSaveJob_(job);
    var commit=prlApi_('get','/git/commits/'+base);
    if(prlApi_('get','/git/ref/heads/'+PRL_BRANCH).object.sha!==base)throw Error('Repository changed during publication. Reload before publishing again.');
    var tree=prlApi_('post','/git/trees',{base_tree:commit.tree.sha,tree:[{path:PRL_PREFIX+path,mode:'100644',type:'blob',content:artifactText},{path:PRL_PREFIX+'index.json',mode:'100644',type:'blob',content:JSON.stringify(catalog,null,2)+'\n'}]});
    var candidate=prlApi_('post','/git/commits',{message:'Publish provisional Print Run Lab project '+id,tree:tree.sha,parents:[base]});
    job.commit=candidate.sha;job.state='committing';prlSaveJob_(job);
    prlApi_('patch','/git/refs/heads/'+PRL_BRANCH,{sha:candidate.sha,force:false});
    job.state='committed';prlSaveJob_(job);return prlReply_(job);
  }catch(e){
    if(job){job.state=job.commit?'delivery_uncertain':'failed';job.message=job.commit?'The commit may have been submitted. Check publication status; do not repeat Publish.':e.message;try{prlSaveJob_(job);}catch{}return prlReply_(job);}
    throw e;
  }finally{lock.releaseLock();}
}
function prlPublicText_(path){
  if(path.indexOf(PRL_PREFIX)!==0||path.indexOf('..')>=0)throw Error('Unapproved public path.');
  var r=UrlFetchApp.fetch(PRL_PUBLIC+path+'?verification='+Date.now(),{muteHttpExceptions:true,followRedirects:true});
  if(r.getResponseCode()!==200)throw Error('Public revision is not available yet.');return r.getContentText();
}
function prlStatus_(body){
  requireOperatorKey_(body.key);var job=prlReadJob_(body.request_id);if(!job)throw Error('Publication receipt not found.');
  if(['failed','live_verified','superseded'].indexOf(job.state)>=0)return prlReply_(job);
  if(!job.commit)return prlReply_(job);
  try{
    var head=prlApi_('get','/git/ref/heads/'+PRL_BRANCH).object.sha;
    if(head!==job.commit){var comparison=prlApi_('get','/compare/'+job.commit+'...'+head);if(comparison.merge_base_commit.sha!==job.commit)return prlReply_(Object.assign({},job,{state:'delivery_uncertain',message:'Candidate commit is not confirmed on main. Review the receipt before starting another publication.'}));}
    var runs=prlApi_('get','/actions/runs?head_sha='+encodeURIComponent(job.commit)+'&per_page=30').workflow_runs;
    var pages=runs.find(function(r){return r.name==='pages build and deployment';}),checks=runs.find(function(r){return r.name==='Pipeline regressions';});
    if([pages,checks].some(function(r){return r&&r.status==='completed'&&r.conclusion!=='success';}))return prlReply_(Object.assign({},job,{state:'deployment_failed',message:'Deployment or checks failed. The repository commit exists; review before publishing again.'}));
    if(!pages||!checks||pages.conclusion!=='success'||checks.conclusion!=='success')return prlReply_(Object.assign({},job,{state:'deploying',message:'Committed; waiting for checks and GitHub Pages.'}));
    var catalog=prlCatalogValid_(JSON.parse(prlPublicText_(PRL_PREFIX+'index.json'))),entry=catalog.projects.find(function(p){return p.id===job.project_id;});
    if(!entry||entry.revision_id!==job.revision_id){
      var current=prlCatalog_(head).projects.find(function(p){return p.id===job.project_id;});
      if(entry&&current&&entry.revision_id===current.revision_id&&entry.sha256===current.sha256&&current.revision_id!==job.revision_id){
        var replacement=prlPublicText_(PRL_PREFIX+entry.path);
        if(prlHash_(replacement)===entry.sha256){job.state='superseded';job.message='A newer revision is already published. Reload the shared project before editing again.';prlSaveJob_(job);return prlReply_(job);}
      }
      return prlReply_(Object.assign({},job,{state:'deploying',message:'Waiting for the public catalog to show this revision.'}));
    }
    var text=prlPublicText_(PRL_PREFIX+job.path);if(entry.sha256!==job.sha256||prlHash_(text)!==job.sha256)throw Error('Public revision verification has not matched yet.');
    job.state='live_verified';job.verified_at=new Date().toISOString();job.url=PRL_PUBLIC+'print-run-lab/?project='+encodeURIComponent(job.project_id);delete job.message;prlSaveJob_(job);return prlReply_(job);
  }catch(e){return prlReply_(Object.assign({},job,{state:job.state==='delivery_uncertain'?'delivery_uncertain':'deploying',message:'Publication is not live-verified yet. '+e.message}));}
}
