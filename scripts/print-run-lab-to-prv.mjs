// Offline converter: Print Run Lab project or published artifact -> PRV estimate input.
// Applies a fixed, reproducible leave-one-anchor-out stability rule to the Lab's own calculate().
// The tool, not the owner, decides which estimates are publishable. Nothing is pushed or deployed.
// Usage: node scripts/print-run-lab-to-prv.mjs --in <project-or-artifact.json> --out-dir <dir>
//        [--cv-code <code>] [--relic hold|Relic] [--category-map <json>] [--max-change 0.05]
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {calculate} from '../print-run-lab/engine.js';
import {sanitizeProject,validateArtifact,MODEL_VERSION} from '../print-run-lab/project-schema.js';

export const DEFAULT_MAX_CHANGE=0.05;
export const NOT_IN_CV_REASON='subset not in the CV checklist for this product';
export const DUPLICATE_REASON='duplicate row label in family; PRV cannot distinguish the rows';
export const RELIC_HOLD_REASON='no relic category in PRV estimate schema';
const RELIC_RE=/\b(?:relics?|memorabilia|patch(?:es)?|swatch(?:es)?|jerseys?|fabrics?|remnants?)\b/i;
export const AMBIGUOUS_MEMORABILIA_REASON='autograph/memorabilia family without autograph wording or a CV section; cannot tell autograph from relic';
const AUTO_RE=/\b(?:auto(?:graphs?)?|signatures?|signed)\b/i,FACSIMILE_RE=/\bfacsimile\b/i;
const keyOf=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const titleCase=s=>String(s||'').trim().toLowerCase().replace(/\b([a-z])/g,c=>c.toUpperCase());
// CV subset lookup: exact alphanumeric key, then the key without a trailing "cards" ("BASE CARDS" -> "Base").
export function cvSubsetFor(cvSections,familyName){
  if(!cvSections)return null;
  const k=keyOf(familyName);
  return cvSections.get(k)||cvSections.get(k.replace(/cards$/,''))||null;
}
export function cvSectionsFrom(cvProduct){
  const m=new Map();
  for(const r of cvProduct.rows||[])if(r.subset&&r.section&&!m.has(keyOf(r.subset)))m.set(keyOf(r.subset),{subset:r.subset,section:r.section});
  return m;
}
const enginePath=fileURLToPath(new URL('../print-run-lab/engine.js',import.meta.url));
export const engineSha256=()=>createHash('sha256').update(fs.readFileSync(enginePath,'utf8')).digest('hex');

// calculate() mutates rows (_issue/_rates), so every fit gets its own row copies.
const fit=(project,disabledId)=>calculate({...project,rows:project.rows.map(r=>disabledId&&r.id===disabledId?{...r,anchor:false}:{...r})});

// Stability rule, applied exactly. For each enabled anchor a, refit with a disabled.
//  - A row is PUBLISHABLE iff its base perCard is finite and > 0, every refit is valid, and its perCard
//    changes <= maxChange (relative) in every refit.
//  - If ANY refit is not usable (invalid, no estimate, non-finite pack totals), every row is HELD.
//    There is no salvage: unidentifiable formats are not dropped and no reduced refit is run.
export const INVALID_REFIT_REASON='refit invalid';
const perCardOf=res=>res.results.map(r=>r.perCard);
const usable=res=>res.valid===true&&res.hasEstimate===true&&Array.isArray(res.packTotals)&&res.packTotals.every(Number.isFinite);
export function stabilityRule(project,{maxChange=DEFAULT_MAX_CHANGE}={}){
  const base=fit(project);
  if(!usable(base))throw Error('Base fit is not valid: '+base.errors.join(' '));
  const basePer=perCardOf(base);
  const anchors=base.diagnostics.filter(d=>d.enabled);
  const worst=basePer.map(()=>({change:0,anchor:null}));
  const invalid=[];
  for(const a of anchors){
    const re=fit(project,a.id);
    if(!usable(re)){invalid.push({id:a.id,name:a.name,errors:(re.errors||[]).slice(0,3)});continue;}
    perCardOf(re).forEach((v,i)=>{
      const b=basePer[i];if(!(Number.isFinite(b)&&b>0))return;
      const change=Number.isFinite(v)?Math.abs(v-b)/b:Infinity;
      if(change>worst[i].change)worst[i]={change,anchor:a};
    });
  }
  const invalidReason=invalid.length?`${INVALID_REFIT_REASON}: disabling anchor ${invalid[0].name} gives an invalid refit${invalid.length>1?` (+${invalid.length-1} more anchors)`:''}`:null;
  const rows=base.results.map((r,i)=>{
    const b=basePer[i];let status='PUBLISHABLE',reason=null;
    if(!(Number.isFinite(b)&&b>0)){status='HELD';reason='zero/undetermined base-fit per-card estimate';}
    else if(invalidReason){status='HELD';reason=invalidReason;}
    else if(worst[i].change>maxChange){status='HELD';reason=`max change ${(worst[i].change*100).toFixed(2)}% > ${(maxChange*100).toFixed(2)}% when anchor disabled: ${worst[i].anchor.name}`;}
    return {id:r.id,name:r.name,familyId:r.familyId,family:r.family,count:r.count,perCard:b??null,total:r.total??null,byFormat:r.byFormat??null,
      maxChangePct:Number.isFinite(b)&&b>0?(Number.isFinite(worst[i].change)?+(worst[i].change*100).toFixed(4):null):null,
      worstAnchorId:worst[i].anchor?.id??null,worstAnchor:worst[i].anchor?.name??null,status,reason};
  });
  if(invalid.length)console.error(`WARNING: ${invalid.length} invalid leave-one-anchor-out refit(s) (${invalid.map(u=>u.name).join('; ')}); ALL rows held.`);
  return {base,anchorsTested:anchors.length,invalidRefits:invalid,maxChange,rows};
}
// Category mapping. Relic rows are never labelled Autograph. relic='hold' (default) holds them;
// relic='Relic' (or any label) maps them to that category once the app-side schema supports it.
// When the CV checklist is supplied, the CV section decides (Base, Insert, Variation->Insert,
// Autograph, Relic); facsimile signatures are never Autograph.
export function categorize(project,row,{relic='hold',categoryMap={},cvSections=null}={}){
  const family=project.families.find(f=>f.id===row.familyId);
  const cv=cvSubsetFor(cvSections,family?.name);
  if(cv){
    const sec={Base:'Base',Insert:'Insert',Variation:'Insert',Autograph:'Autograph',Relic:'Relic'}[cv.section];
    if(sec==='Relic'){if(relic==='hold')return {category:null,hold:RELIC_HOLD_REASON};return {category:categoryMap.Relic||relic,hold:null};}
    if(sec)return {category:categoryMap[sec]??sec,hold:null};
  }
  const isRelic=RELIC_RE.test(`${row.name} ${family?.name||''}`);
  if(isRelic){
    if(relic==='hold')return {category:null,hold:RELIC_HOLD_REASON};
    return {category:categoryMap.Relic||relic,hold:null};
  }
  const fromSection=family?.sectionKind;
  let kind=fromSection||(/^base\b/i.test(row.name)||/^base\b/i.test(family?.name||'')?'Base':'Insert');
  const text=`${row.name} ${family?.name||''}`,auto=AUTO_RE.test(text)&&!FACSIMILE_RE.test(text);
  if(auto)kind='Autograph / memorabilia';
  else if(kind==='Autograph / memorabilia'){if(!FACSIMILE_RE.test(text))return {category:null,hold:AMBIGUOUS_MEMORABILIA_REASON};kind='Insert';}
  const key=kind==='Autograph / memorabilia'?'Autograph':kind;
  return {category:categoryMap[key]??key,hold:null};
}

export function convert(project,opts={}){
  const rule=stabilityRule(project,opts);
  const estimates=[],held=[];
  // Rows sharing family and name cannot be told apart in PRV (one record per subset+parallel): hold all of them.
  const dupKey=r=>r.familyId+'\0'+r.name,dupCount=rule.rows.reduce((m,r)=>m.set(dupKey(r),(m.get(dupKey(r))||0)+1),new Map());
  for(const r of rule.rows){
    const row=project.rows.find(x=>x.id===r.id),cat=categorize(project,row,opts);
    const reasons=[];if(r.reason)reasons.push(r.reason);if(cat.hold)reasons.push(cat.hold);if(dupCount.get(dupKey(r))>1)reasons.push(DUPLICATE_REASON);if(opts.cvSections&&!cvSubsetFor(opts.cvSections,project.families.find(f=>f.id===r.familyId)?.name))reasons.push(NOT_IN_CV_REASON);
    if(reasons.length){held.push({id:r.id,name:r.name,family:r.family,category:cat.category,per_card:r.perCard,max_change_pct:r.maxChangePct,worst_anchor:r.worstAnchor,reasons});continue;}
    estimates.push({row_id:r.id,page:row.page??null,name:r.name,family_id:r.familyId,family:r.family,category:cat.category,copies_per_card:r.perCard,total_copies:r.total,eligible_cards:r.count,max_change_pct:r.maxChangePct,serial_limit:null,estimate:true});
  }
  return {rule,estimates,held};
}

export function buildOutputs(project,{source,cvCode=null,...opts}={}){
  const {rule,estimates,held}=convert(project,opts);
  const meta={title:project.title,cv_code:cvCode,source,model_version:MODEL_VERSION,engine_sha256:engineSha256()};
  const ruleDoc={name:'leave-one-anchor-out stability',max_relative_change:rule.maxChange,anchors_tested:rule.anchorsTested,invalid_refits:rule.invalidRefits,relic_handling:opts.relic||'hold'};
  const prv={schema:'cm-prv-estimate-input/1',...meta,rule:ruleDoc,counts:{rows:rule.rows.length,publishable:estimates.length,held:held.length},estimates};
  const report={schema:'cm-prv-held-report/1',...meta,rule:ruleDoc,counts:prv.counts,held};
  const md=[`# Held rows: ${project.title}`,'',`Rule: publish only if base per-card > 0 and per-card changes <= ${(rule.maxChange*100).toFixed(2)}% in every leave-one-anchor-out refit (${rule.anchorsTested} anchors tested).` + " Any invalid refit holds every row.",'',
    `Rows: ${rule.rows.length}. Publishable: ${estimates.length}. Held: ${held.length}.`,'',
    ...Object.entries(held.reduce((m,h)=>{const k=h.reasons[0].split(/:| \d/)[0].trim();m[k]=(m[k]||0)+1;return m;},{})).map(([k,n])=>`- ${n} × ${k}`),'',
    ...(rule.invalidRefits.length?[`**WARNING: invalid refit when anchor disabled: ${rule.invalidRefits.map(x=>x.name).join('; ')}. All rows held.**`,'']:[]),'| Row | Family | Reason |','|---|---|---|',...held.map(h=>`| ${h.name.replace(/\|/g,'/')} | ${h.family.replace(/\|/g,'/')} | ${h.reasons.join('; ').replace(/\|/g,'/')} |`),''].join('\n');
  return {prv,report,md};
}

// PRV schema-4 input for the app's print_run_lab_estimates_v1 method. meta is copied exactly from the
// CV index entry; one record per publishable row; values unrounded; serial_limit always null.
export function toPrvSchema4(project,out,{cvEntry,cvSections,estimateUrl,reviewedDate,projectFile,projectSha256}){
  if(!cvEntry)throw Error('CV index entry required for --prv-file.');
  const meta={code:cvEntry.Code,displayName:cvEntry.DisplayName,keywords:cvEntry.Keywords,year:cvEntry.year,manufacturer:cvEntry.manufacturer,product:cvEntry.product,sport:cvEntry.sport};
  const unmatched=new Set();
  const records=out.prv.estimates.map(e=>{
    const fam=project.families.find(f=>f.id===e.family_id),cv=cvSubsetFor(cvSections,fam?.name);
    if(!cv)unmatched.add(fam?.name||e.family);
    const famName=String(fam?.name||e.family).toUpperCase(),rowName=String(e.name).toUpperCase();
    const prefixes=[famName,famName.replace(/\s+CARDS$/,'')];
    const pre=prefixes.find(x=>rowName===x||rowName.startsWith(x+' '));
    const parallel=pre?titleCase(rowName.slice(pre.length)):titleCase(rowName);
    return {id:e.row_id,kind:'estimate',category:e.category,name:cv?cv.subset:titleCase(fam?.name||e.family),subjects:e.eligible_cards,estimate:e.copies_per_card,serial_limit:null,parallel,page:e.page};
  });
  const heldReasons={};for(const h of out.report.held){const k=h.reasons[0].split(/:| \d/)[0].trim();heldReasons[k]=(heldReasons[k]||0)+1;}
  const relicHeld=out.report.held.filter(h=>h.reasons.includes(RELIC_HOLD_REASON)).length;
  return {schema_version:4,code:cvEntry.Code,meta,sources:{estimate_url:estimateUrl,reviewed_date:reviewedDate},
    method:{name:'print_run_lab_estimates_v1',calibration:`Print Run Lab weighted-median fit of ${project.formats.length} Topps pack formats to numbered anchors. Only rows passing the leave-one-anchor-out stability rule (per-card change <= ${(out.prv.rule.max_relative_change*100).toFixed(0)}% in every refit) are published. Provisional; not manufacturer-confirmed.`},
    lab_provenance:{status:'pending-lab-publication',project_id:null,revision_id:null,
      note:'project_id and revision_id are filled after the owner publishes this project in Print Run Lab.',
      model_version:out.prv.model_version,engine_sha256:out.prv.engine_sha256,
      corrected_project:{file:projectFile,sha256:projectSha256},
      formats:project.formats,
      stability_rule:{name:out.prv.rule.name,max_relative_change:out.prv.rule.max_relative_change,anchors_tested:out.prv.rule.anchors_tested,invalid_refits:out.prv.rule.invalid_refits,relic_handling:out.prv.rule.relic_handling},
      counts:{rows:out.prv.counts.rows,published:records.length,held:out.prv.counts.held,held_by_reason:heldReasons,relic_rows_held:relicHeld},
      families_not_in_cv:[...unmatched].sort(),
      source_documents:{odds_pdf:project.sources?.odds?.name??null,checklist_pdf:project.sources?.checklist?.name??null}},
    records};
}
export function loadInput(file){
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  if(data&&data.project&&data.model){ // published artifact
    const sha=engineSha256();
    if(data.model.engine_sha256!==sha)throw Error(`Refusing to run: engine sha ${sha} differs from artifact model.engine_sha256 ${data.model.engine_sha256}.`);
    validateArtifact(data);
    return {project:sanitizeProject(data.project),source:{kind:'artifact',project_id:data.project_id,revision_id:data.revision_id}};
  }
  return {project:sanitizeProject(data),source:{kind:'project',sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')}};
}

function main(argv){
  const arg=n=>{const i=argv.indexOf('--'+n);return i<0?undefined:argv[i+1];};
  const input=arg('in'),outDir=arg('out-dir');
  if(!input||!outDir)throw Error('Usage: print-run-lab-to-prv.mjs --in <file> --out-dir <dir> [--cv-code c] [--relic hold|Relic] [--category-map file] [--max-change 0.05]');
  const {project,source}=loadInput(input);
  const categoryMap=arg('category-map')?JSON.parse(fs.readFileSync(arg('category-map'),'utf8')):{};
  const maxChange=arg('max-change')===undefined?DEFAULT_MAX_CHANGE:Number(arg('max-change'));
  if(!Number.isFinite(maxChange)||maxChange<0)throw Error('Invalid --max-change.');
  const cvProduct=arg('cv-product')?JSON.parse(fs.readFileSync(arg('cv-product'),'utf8')):null;
  const cvCode=arg('cv-code')||null;
  const cvSections=cvProduct?cvSectionsFrom(cvProduct.products?.[cvCode]||cvProduct):null;
  const out=buildOutputs(project,{source,cvCode,relic:arg('relic')||'hold',categoryMap,maxChange,cvSections});
  const {prv,report,md}=out;
  if(arg('prv-file')){
    const index=JSON.parse(fs.readFileSync(arg('cv-index'),'utf8')).index||[];
    const matches=index.filter(e=>e.Code===cvCode);if(matches.length!==1)throw Error('--prv-file requires exactly one CV index entry for --cv-code.');
    const doc=toPrvSchema4(project,out,{cvEntry:matches[0],cvSections,estimateUrl:arg('estimate-url'),reviewedDate:arg('reviewed-date'),projectFile:path.basename(input),projectSha256:source.sha256??null});
    fs.writeFileSync(arg('prv-file'),JSON.stringify(doc,null,2)+'\n');
  }
  fs.mkdirSync(outDir,{recursive:true});
  fs.writeFileSync(path.join(outDir,'prv-input.json'),JSON.stringify(prv,null,1)+'\n');
  fs.writeFileSync(path.join(outDir,'held-rows.json'),JSON.stringify(report,null,1)+'\n');
  fs.writeFileSync(path.join(outDir,'held-rows.md'),md);
  console.log(JSON.stringify(prv.counts));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{main(process.argv.slice(2));}catch(e){console.error(e.message);process.exit(1);}}
