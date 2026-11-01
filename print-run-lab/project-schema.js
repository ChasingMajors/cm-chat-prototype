import {calculate} from './engine.js';
import {ENGINE_SHA256} from './model-version.js';
export const MODEL_VERSION='weighted-median-v1';
export const MAX_PROJECT_BYTES=2*1024*1024;
export const MAX_ARTIFACT_BYTES=4*1024*1024;
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const bytes=s=>unescape(encodeURIComponent(s)).length;
function text(v,max=200,empty=false){if(typeof v!=='string'||v.length>max||(!empty&&!v.trim()))throw Error('Invalid project text.');return v;}
function integer(v,max=10000000){if(!Number.isSafeInteger(v)||v<1||v>max)throw Error('Invalid whole-number project value.');return v;}
function finite(v,max=Number.MAX_VALUE){if(!Number.isFinite(v)||v<0||v>max)throw Error('Invalid finite project value.');return v;}
function list(v,max){if(!Array.isArray(v)||v.length>max)throw Error('Invalid project list.');return v;}
function optionalText(target,source,keys,max=2000){for(const k of keys)if(source[k]!==undefined)target[k]=text(source[k],max,true);}
function page(v){return v==null?null:integer(v,10000);}
export function validateCatalog(c){
  if(!obj(c)||c.schema_version!==1||!Array.isArray(c.projects)||c.projects.length>500)throw Error('Invalid projects catalog.');
  const ids=new Set();
  for(const p of c.projects){
    if(!obj(p)||typeof p.id!=='string'||!/^prl_[a-zA-Z0-9-]{8,80}$/.test(p.id)||ids.has(p.id)||typeof p.title!=='string'||!p.title.trim()||p.title.length>300||typeof p.revision_id!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(p.revision_id)||typeof p.sha256!=='string'||!/^[a-f0-9]{64}$/.test(p.sha256)||typeof p.published_at!=='string'||!Number.isFinite(Date.parse(p.published_at))||p.path!==`projects/${p.id}/${p.revision_id}-${p.sha256.slice(0,12)}.json`||p.estimate_status!=='provisional'||p.calibration_status!=='not-yet-calibrated'||!obj(p.model)||typeof p.model.version!=='string'||!p.model.version.trim()||p.model.version.length>100||!/^[a-f0-9]{64}$/.test(p.model.engine_sha256||''))throw Error('Invalid project catalog entry.');
    ids.add(p.id);
  }
  return c;
}
export function sanitizeProject(input){
  if(!obj(input)||input.version!==1)throw Error('Unsupported project version.');
  if(bytes(JSON.stringify(input))>MAX_PROJECT_BYTES)throw Error('Public project exceeds 2 MB. Save the full draft locally and reduce source text before publishing.');
  const p={version:1,title:text(input.title,300),families:[],formats:[],rows:[],packTotals:[],aliases:[],sources:{},warnings:[],formatConfigs:{},allowScenario:false,robustWeights:input.robustWeights===true,roundingWeights:input.roundingWeights===true,oddsBlocking:input.oddsBlocking===true};
  if(input.method!==undefined){if(input.method!=='experimental')throw Error('Unsupported calculation method.');p.method=input.method;}
  for(const name of list(input.formats,12))p.formats.push(text(name,100));
  if(!p.formats.length||new Set(p.formats).size!==p.formats.length)throw Error('Distinct pack formats are required.');
  const familyIds=new Set(),rowIds=new Set();let identities=0;
  for(const f of list(input.families,1000)){
    if(!obj(f))throw Error('Invalid checklist section.');
    const id=text(f.id);if(familyIds.has(id))throw Error('Duplicate section ID.');familyIds.add(id);
    const out={id,name:text(f.name,300),count:integer(f.count),cards:[],page:page(f.page)};
    if(f.sectionKind!=null){if(!['Base','Insert','Autograph / memorabilia'].includes(f.sectionKind))throw Error('Invalid section class.');out.sectionKind=f.sectionKind;}
    const ids=new Set();for(const c of list(f.cards,50000)){if(!obj(c))throw Error('Invalid card identity.');const cid=text(c.id);if(ids.has(cid))throw Error('Duplicate card ID within section.');ids.add(cid);out.cards.push({id:cid,description:text(c.description,1000,true),page:page(c.page)});if(++identities>50000)throw Error('Too many card identities.');}
    p.families.push(out);
  }
  if(!p.families.length)throw Error('A checklist section is required.');
  for(const r of list(input.rows,5000)){
    if(!obj(r))throw Error('Invalid odds row.');const id=text(r.id);if(rowIds.has(id))throw Error('Duplicate odds row ID.');rowIds.add(id);
    const familyId=text(r.familyId,200,true);if(familyId&&!familyIds.has(familyId))throw Error('Unknown checklist section.');
    if(typeof r.anchor!=='boolean')throw Error('Invalid anchor selection.');
    const out={id,name:text(r.name,500),familyId,odds:list(r.odds,12).map(v=>text(v,350,true)),eligible:r.eligible==null?null:integer(r.eligible),serial:r.serial==null?null:integer(r.serial),anchor:r.anchor,page:page(r.page)};
    if(out.odds.length!==p.formats.length)throw Error('Odds columns do not match the formats.');
    for(const k of ['familyIdManual','ambiguous'])if(r[k]!==undefined){if(typeof r[k]!=='boolean')throw Error('Invalid assignment flag.');out[k]=r[k];}
    if(r.weight!=null)out.weight=finite(r.weight,1000);
    optionalText(out,r,['weightNote','serialSource','serialSourceUrl']);
    if(r.referenceBoxOdds!==undefined)out.referenceBoxOdds=list(r.referenceBoxOdds,12).map(v=>text(v,350,true));
    p.rows.push(out);
  }
  if(!p.rows.length)throw Error('Odds rows are required.');
  p.packTotals=list(input.packTotals,12).map(v=>v==null?null:finite(v));if(p.packTotals.length!==p.formats.length)throw Error('Pack total columns do not match.');
  for(const a of list(input.aliases||[],1000)){if(!obj(a))throw Error('Invalid alias.');const to=text(a.to);if(!familyIds.has(to))throw Error('Alias target must be a section ID.');const from=text(a.from,500);if(!/[a-z0-9]/i.test(from))throw Error('Alias prefix is empty.');p.aliases.push({from,to});}
  for(const [name,c] of Object.entries(input.formatConfigs||{})){if(!p.formats.includes(name)||!obj(c))throw Error('Invalid format configuration.');const out={};for(const k of ['cardsPerPack','packsPerBox'])if(c[k]!=null)out[k]=integer(c[k]);optionalText(out,c,['source']);Object.defineProperty(p.formatConfigs,name,{value:out,enumerable:true,writable:true,configurable:true});}
  if(!obj(input.sources))throw Error('Invalid project sources.');
  let sourceRows=0;for(const kind of ['checklist','odds'])if(input.sources[kind]){const s=input.sources[kind];if(!obj(s))throw Error('Invalid source.');const out={name:text(s.name,1000).split(/[\\/]/).pop(),pages:[]};for(const pg of list(s.pages,1000)){const rows=list(pg.rows,20000).map(r=>{if(!obj(r)||++sourceRows>100000)throw Error('Too many source rows.');return {text:text(r.text,10000,true)};});out.pages.push({number:integer(pg.number,10000),rows});}optionalText(out,s,['url','sha256']);p.sources[kind]=out;}
  for(const w of list(input.warnings||[],5000)){if(!obj(w))throw Error('Invalid warning.');p.warnings.push({kind:text(w.kind,100),text:text(w.text,4000,true)});}
  optionalText(p,input,['referenceSource']);
  return p;
}
function jsonSafe(value){return JSON.parse(JSON.stringify(value,(k,v)=>k.startsWith('_')?undefined:typeof v==='number'&&!Number.isFinite(v)?null:v));}
export function buildArtifact(input,{projectId,revisionId,publishedAt}={}){
  const project=sanitizeProject(input),fit=calculate(project);
  if(!fit.valid)throw Error('This project has no resolved production estimate. '+fit.errors.join(' '));
  const snapshot=jsonSafe(fit);snapshot.diagnostics=snapshot.diagnostics.map(d=>({...d,exclusionReason:project.rows.find(r=>r.id===d.id)?._issue||''}));
  const clean=jsonSafe(project);
  const artifact={schema_version:1,project_id:projectId,revision_id:revisionId,published_at:publishedAt,estimate_status:'provisional',calibration_status:'not-yet-calibrated',model:{version:MODEL_VERSION,engine_sha256:ENGINE_SHA256},project:clean,calculation:snapshot};
  if(bytes(JSON.stringify(artifact))>MAX_ARTIFACT_BYTES)throw Error('Public snapshot exceeds 4 MB.');
  return artifact;
}
export function validateArtifact(a){
  if(!obj(a)||a.schema_version!==1||a.estimate_status!=='provisional'||a.calibration_status!=='not-yet-calibrated'||!obj(a.model)||typeof a.model.version!=='string'||!/^[a-f0-9]{64}$/.test(a.model.engine_sha256||''))throw Error('Unsupported published snapshot.');
  if(!/^prl_[a-zA-Z0-9-]{8,80}$/.test(a.project_id||'')||!/^[a-zA-Z0-9-]{8,80}$/.test(a.revision_id||'')||!Number.isFinite(Date.parse(a.published_at)))throw Error('Invalid published revision identity.');
  const project=sanitizeProject(a.project),f=a.calculation;
  if(!obj(f)||f.valid!==true||f.hasEstimate!==true||!Array.isArray(f.packTotals)||f.packTotals.length!==project.formats.length||!f.packTotals.every(v=>Number.isFinite(v)&&v>=0)||!Array.isArray(f.results)||f.results.length!==project.rows.length||!Array.isArray(f.diagnostics)||!Array.isArray(f.formatChecks)||f.formatChecks.length!==project.formats.length||!Array.isArray(f.errors)||!Array.isArray(f.conflicts)||!Array.isArray(f.rowIssues)||typeof f.assumptions!=='string')throw Error('Invalid published calculation.');
  f.results.forEach((r,i)=>{if(!obj(r)||r.id!==project.rows[i].id||r.name!==project.rows[i].name||r.familyId!==project.rows[i].familyId||typeof r.family!=='string')throw Error('Snapshot identities do not match.');if(r.count!=null)integer(r.count);for(const k of ['total','perCard'])if(r[k]!=null&&(!Number.isFinite(r[k])||r[k]<0))throw Error('Invalid snapshot copies.');if(r.byFormat!==null&&(!Array.isArray(r.byFormat)||r.byFormat.length!==project.formats.length||!r.byFormat.every(v=>Number.isFinite(v)&&v>=0)))throw Error('Invalid format copies.');});
  f.formatChecks.forEach((c,i)=>{if(!obj(c)||c.format!==project.formats[i]||c.boxes!=null&&(!Number.isFinite(c.boxes)||c.boxes<0))throw Error('Invalid format summary.');});
  for(const key of ['usedAnchors','enabledAnchors'])if(!Number.isSafeInteger(f[key])||f[key]<0)throw Error('Invalid anchor summary.');
  if(f.packRange!=null){if(!Array.isArray(f.packRange)||f.packRange.length!==project.formats.length)throw Error('Invalid implied-packs range.');for(const r of f.packRange)if(r!==null&&(!obj(r)||!Number.isSafeInteger(r.anchors)||r.anchors<0||!['min','median','max'].every(k=>Number.isFinite(r[k])&&r[k]>=0)))throw Error('Invalid implied-packs range.');}
  return {...a,project};
}
