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
export const RELIC_HOLD_REASON='no relic category in PRV estimate schema';
const RELIC_RE=/\b(?:relics?|memorabilia|patch(?:es)?|swatch(?:es)?|jerseys?)\b/i;
const enginePath=fileURLToPath(new URL('../print-run-lab/engine.js',import.meta.url));
export const engineSha256=()=>createHash('sha256').update(fs.readFileSync(enginePath,'utf8')).digest('hex');

// calculate() mutates rows (_issue/_rates), so every fit gets its own row copies.
const fit=(project,disabledId)=>calculate({...project,rows:project.rows.map(r=>disabledId&&r.id===disabledId?{...r,anchor:false}:{...r})});
const perCardOf=res=>res.results.map(r=>r.perCard);
const usable=res=>res.valid===true&&res.hasEstimate===true&&Array.isArray(res.packTotals)&&res.packTotals.every(Number.isFinite);

// Stability rule. A row is PUBLISHABLE iff base perCard is finite and > 0, every leave-one-anchor-out
// refit is valid, and perCard moves by <= maxChange (relative) in every refit. Otherwise HELD with a reason.
export function stabilityRule(project,{maxChange=DEFAULT_MAX_CHANGE}={}){
  const base=fit(project);
  if(!usable(base))throw Error('Base fit is not valid: '+base.errors.join(' '));
  const basePer=perCardOf(base);
  const anchors=base.diagnostics.filter(d=>d.enabled);
  const worst=basePer.map(()=>({change:0,anchor:null}));const invalid=[];
  for(const a of anchors){
    const re=fit(project,a.id);
    if(!usable(re)){invalid.push({id:a.id,name:a.name});continue;}
    const per=perCardOf(re);
    per.forEach((v,i)=>{
      const b=basePer[i];if(!(Number.isFinite(b)&&b>0))return;
      const change=Number.isFinite(v)?Math.abs(v-b)/b:Infinity;
      if(change>worst[i].change)worst[i]={change,anchor:a};
    });
  }
  const rows=base.results.map((r,i)=>{
    const b=basePer[i];let status='PUBLISHABLE',reason=null;
    if(!(Number.isFinite(b)&&b>0)){status='HELD';reason='zero/undetermined base-fit per-card estimate';}
    else if(invalid.length){status='HELD';reason=`invalid refit when anchor disabled: ${invalid.map(x=>x.name).slice(0,5).join('; ')}${invalid.length>5?` (+${invalid.length-5} more)`:''}; max change over the valid refits ${(worst[i].change*100).toFixed(2)}%`;}
    else if(worst[i].change>maxChange){status='HELD';reason=`max change ${(worst[i].change*100).toFixed(2)}% > ${(maxChange*100).toFixed(2)}% when anchor disabled: ${worst[i].anchor.name}`;}
    return {id:r.id,name:r.name,familyId:r.familyId,family:r.family,count:r.count,perCard:b??null,total:r.total??null,byFormat:r.byFormat??null,
      maxChangePct:Number.isFinite(b)&&b>0?(Number.isFinite(worst[i].change)?+(worst[i].change*100).toFixed(4):null):null,
      worstAnchorId:worst[i].anchor?.id??null,worstAnchor:worst[i].anchor?.name??null,status,reason};
  });
  // Informational only (NOT applied): rows that would pass if invalid refits were ignored.
  const passIgnoringInvalid=rows.filter((r,i)=>r.status==='HELD'&&invalid.length&&Number.isFinite(basePer[i])&&basePer[i]>0&&worst[i].change<=maxChange).length;
  return {base,anchorsTested:anchors.length,invalidRefits:invalid,maxChange,passIgnoringInvalid,rows};
}

// Category mapping. Relic rows are never labelled Autograph. relic='hold' (default) holds them;
// relic='Relic' (or any label) maps them to that category once the app-side schema supports it.
export function categorize(project,row,{relic='hold',categoryMap={}}={}){
  const family=project.families.find(f=>f.id===row.familyId);
  const isRelic=RELIC_RE.test(`${row.name} ${family?.name||''}`);
  if(isRelic){
    if(relic==='hold')return {category:null,hold:RELIC_HOLD_REASON};
    return {category:categoryMap.Relic||relic,hold:null};
  }
  const fromSection=family?.sectionKind;
  let kind=fromSection||(/^base\b/i.test(row.name)||/^base\b/i.test(family?.name||'')?'Base':'Insert');
  if(/\b(?:auto(?:graphs?)?|signatures?)\b/i.test(`${row.name} ${family?.name||''}`))kind='Autograph / memorabilia';
  const key=kind==='Autograph / memorabilia'?'Autograph':kind;
  return {category:categoryMap[key]??key,hold:null};
}

export function convert(project,opts={}){
  const rule=stabilityRule(project,opts);
  const estimates=[],held=[];
  for(const r of rule.rows){
    const row=project.rows.find(x=>x.id===r.id),cat=categorize(project,row,opts);
    const reasons=[];if(r.reason)reasons.push(r.reason);if(cat.hold)reasons.push(cat.hold);
    if(reasons.length){held.push({id:r.id,name:r.name,family:r.family,category:cat.category,per_card:r.perCard,max_change_pct:r.maxChangePct,worst_anchor:r.worstAnchor,reasons});continue;}
    estimates.push({row_id:r.id,name:r.name,family_id:r.familyId,family:r.family,category:cat.category,copies_per_card:r.perCard,total_copies:r.total,eligible_cards:r.count,max_change_pct:r.maxChangePct,serial_limit:null,estimate:true});
  }
  return {rule,estimates,held};
}

export function buildOutputs(project,{source,cvCode=null,...opts}={}){
  const {rule,estimates,held}=convert(project,opts);
  const meta={title:project.title,cv_code:cvCode,source,model_version:MODEL_VERSION,engine_sha256:engineSha256()};
  const ruleDoc={name:'leave-one-anchor-out stability',max_relative_change:rule.maxChange,anchors_tested:rule.anchorsTested,invalid_refits:rule.invalidRefits.map(x=>({id:x.id,name:x.name})),info_only_rows_that_would_pass_if_invalid_refits_ignored:rule.passIgnoringInvalid,relic_handling:opts.relic||'hold'};
  const prv={schema:'cm-prv-estimate-input/1',...meta,rule:ruleDoc,counts:{rows:rule.rows.length,publishable:estimates.length,held:held.length},estimates};
  const report={schema:'cm-prv-held-report/1',...meta,rule:ruleDoc,counts:prv.counts,held};
  const md=[`# Held rows: ${project.title}`,'',`Rule: publish only if base per-card > 0, every leave-one-anchor-out refit is valid, and per-card changes <= ${(rule.maxChange*100).toFixed(2)}% in every refit (${rule.anchorsTested} anchors tested).`,'',
    `Rows: ${rule.rows.length}. Publishable: ${estimates.length}. Held: ${held.length}.`,'',
    ...Object.entries(held.reduce((m,h)=>{const k=h.reasons[0].split(/:| \d/)[0].trim();m[k]=(m[k]||0)+1;return m;},{})).map(([k,n])=>`- ${n} × ${k}`),'',
    ...(rule.invalidRefits.length?[`Invalid refits (no estimate when the anchor is disabled): ${rule.invalidRefits.map(x=>x.name).join('; ')}. Info only, not applied: ${rule.passIgnoringInvalid} held rows would pass if those refits were ignored.`,'']:[]),'| Row | Family | Reason |','|---|---|---|',...held.map(h=>`| ${h.name.replace(/\|/g,'/')} | ${h.family.replace(/\|/g,'/')} | ${h.reasons.join('; ').replace(/\|/g,'/')} |`),''].join('\n');
  return {prv,report,md};
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
  const {prv,report,md}=buildOutputs(project,{source,cvCode:arg('cv-code')||null,relic:arg('relic')||'hold',categoryMap,maxChange});
  fs.mkdirSync(outDir,{recursive:true});
  fs.writeFileSync(path.join(outDir,'prv-input.json'),JSON.stringify(prv,null,1)+'\n');
  fs.writeFileSync(path.join(outDir,'held-rows.json'),JSON.stringify(report,null,1)+'\n');
  fs.writeFileSync(path.join(outDir,'held-rows.md'),md);
  console.log(JSON.stringify(prv.counts));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{main(process.argv.slice(2));}catch(e){console.error(e.message);process.exit(1);}}
