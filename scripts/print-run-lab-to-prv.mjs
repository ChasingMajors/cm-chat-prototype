// Offline converter: Print Run Lab project or published artifact -> PRV estimate input.
// Applies a fixed, reproducible leave-one-anchor-out stability rule to the Lab's own calculate().
// The tool, not the owner, decides which estimates are publishable. Nothing is pushed or deployed.
// Usage: node scripts/print-run-lab-to-prv.mjs --in <project-or-artifact.json> --out-dir <dir>
//        [--cv-code <code>] [--relic hold|Relic] [--category-map <json>] [--max-change 0.05]
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {calculate,parseRatio} from '../print-run-lab/engine.js';
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

// Stability rule. For each enabled anchor a, refit with a disabled.
//  - Valid refit: every row's perCard may move at most maxChange (relative).
//  - Invalid refit: U(a) = formats a has odds in that no other enabled anchor has positive rate in
//    (those formats rest on a single anchor). Rows with odds in any U(a) format are HELD. The remaining
//    rows are judged against a second refit with a disabled AND the U(a) format columns removed
//    (rows with odds only in U(a) dropped), which must itself be valid.
//  - Invalid refit with U(a) empty, or an invalid reduced refit: unexplained; ALL rows are held, loudly.
// A row is PUBLISHABLE iff base perCard is finite and > 0 and no anchor's refit holds it.
export const UNEXPLAINED_REASON='refit failed unexplained';
const positive=(row,i)=>parseRatio(row.odds[i])!==null;
function reduce(project,disabledId,drop){
  const keep=project.formats.map((_,i)=>!drop.includes(i));
  const pick=a=>a&&a.filter((_,i)=>keep[i]);
  const formats=pick(project.formats);
  const rows=project.rows.filter(r=>r.odds.some((_,i)=>keep[i]&&positive(r,i))).map(r=>{
    const o={...r,odds:pick(r.odds),anchor:r.id===disabledId?false:r.anchor};
    if(r.referenceBoxOdds)o.referenceBoxOdds=pick(r.referenceBoxOdds);
    return o;
  });
  const formatConfigs=Object.fromEntries(Object.entries(project.formatConfigs||{}).filter(([k])=>formats.includes(k)));
  return {...project,formats,packTotals:pick(project.packTotals),formatConfigs,rows};
}
export function stabilityRule(project,{maxChange=DEFAULT_MAX_CHANGE}={}){
  const base=fit(project);
  if(!usable(base))throw Error('Base fit is not valid: '+base.errors.join(' '));
  const basePer=perCardOf(base),idx=new Map(base.results.map((r,i)=>[r.id,i]));
  const anchors=base.diagnostics.filter(d=>d.enabled);
  const anchorRows=anchors.map(a=>project.rows.find(r=>r.id===a.id));
  const worst=basePer.map(()=>({change:0,anchor:null}));
  const holds=basePer.map(()=>[]);          // reasons from anchor refits
  const invalid=[],unexplained=[];
  const holdAll=reason=>holds.forEach(h=>h.push(reason));
  for(const a of anchors){
    const arow=project.rows.find(r=>r.id===a.id);
    const re=fit(project,a.id);
    let per,skip=new Set(),mapIdx=i=>i;
    if(usable(re))per=perCardOf(re);
    else{
      const others=anchorRows.filter(r=>r.id!==a.id);
      const U=project.formats.map((_,i)=>i).filter(i=>positive(arow,i)&&!others.some(o=>positive(o,i)));
      const entry={id:a.id,name:a.name,u_formats:U.map(i=>project.formats[i]),reduced_valid:null};
      invalid.push(entry);
      if(!U.length){entry.explained=false;unexplained.push(entry);holdAll(`${UNEXPLAINED_REASON}: disabling anchor ${a.name} gives an invalid refit with no single-anchor format`);continue;}
      entry.explained=true;
      project.rows.forEach(r=>{if(U.some(i=>positive(r,i))){const k=idx.get(r.id);if(k!==undefined){skip.add(k);holds[k].push(`format ${U.map(i=>project.formats[i]).join(', ')} rests on a single anchor (${a.name})`);}}});
      const reduced=reduce(project,a.id,U);
      const rr=fit(reduced);
      entry.reduced_valid=usable(rr);
      if(!usable(rr)){entry.explained=false;unexplained.push(entry);holdAll(`${UNEXPLAINED_REASON}: reduced refit without anchor ${a.name} and format ${entry.u_formats.join(', ')} is invalid`);continue;}
      const ids=rr.results.map(r=>r.id),per2=perCardOf(rr);
      per=basePer.map(()=>undefined);ids.forEach((id,j)=>{per[idx.get(id)]=per2[j];});
    }
    per.forEach((v,i)=>{
      const b=basePer[i];if(!(Number.isFinite(b)&&b>0)||skip.has(i)||v===undefined)return;
      const change=Number.isFinite(v)?Math.abs(v-b)/b:Infinity;
      if(change>worst[i].change)worst[i]={change,anchor:a};
    });
  }
  const rows=base.results.map((r,i)=>{
    const b=basePer[i];let status='PUBLISHABLE',reason=null;
    if(!(Number.isFinite(b)&&b>0)){status='HELD';reason='zero/undetermined base-fit per-card estimate';}
    else if(holds[i].length){status='HELD';reason=[...new Set(holds[i])].slice(0,3).join('; ')+(new Set(holds[i]).size>3?` (+${new Set(holds[i]).size-3} more)`:'');}
    else if(worst[i].change>maxChange){status='HELD';reason=`max change ${(worst[i].change*100).toFixed(2)}% > ${(maxChange*100).toFixed(2)}% when anchor disabled: ${worst[i].anchor.name}`;}
    return {id:r.id,name:r.name,familyId:r.familyId,family:r.family,count:r.count,perCard:b??null,total:r.total??null,byFormat:r.byFormat??null,
      maxChangePct:Number.isFinite(b)&&b>0?(Number.isFinite(worst[i].change)?+(worst[i].change*100).toFixed(4):null):null,
      worstAnchorId:worst[i].anchor?.id??null,worstAnchor:worst[i].anchor?.name??null,status,reason};
  });
  if(unexplained.length)console.error(`WARNING: ${unexplained.length} unexplained invalid refit(s) (${unexplained.map(u=>u.name).join('; ')}); ALL rows held.`);
  return {base,anchorsTested:anchors.length,invalidRefits:invalid,unexplainedRefits:unexplained,maxChange,rows};
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
  const ruleDoc={name:'leave-one-anchor-out stability',max_relative_change:rule.maxChange,anchors_tested:rule.anchorsTested,invalid_refits:rule.invalidRefits,unexplained_refits:rule.unexplainedRefits.length,relic_handling:opts.relic||'hold'};
  const prv={schema:'cm-prv-estimate-input/1',...meta,rule:ruleDoc,counts:{rows:rule.rows.length,publishable:estimates.length,held:held.length},estimates};
  const report={schema:'cm-prv-held-report/1',...meta,rule:ruleDoc,counts:prv.counts,held};
  const md=[`# Held rows: ${project.title}`,'',`Rule: publish only if base per-card > 0 and per-card changes <= ${(rule.maxChange*100).toFixed(2)}% in every leave-one-anchor-out refit (${rule.anchorsTested} anchors tested). An invalid refit holds only rows touching formats that rest on that single anchor, and the rest are judged on a reduced refit without those formats. An invalid refit with no single-anchor format holds every row.`,'',
    `Rows: ${rule.rows.length}. Publishable: ${estimates.length}. Held: ${held.length}.`,'',
    ...Object.entries(held.reduce((m,h)=>{const k=/rests on a single anchor/.test(h.reasons[0])?'format rests on a single anchor':h.reasons[0].split(/:| \d/)[0].trim();m[k]=(m[k]||0)+1;return m;},{})).map(([k,n])=>`- ${n} × ${k}`),'',
    ...(rule.invalidRefits.length?[`Invalid refits when the anchor is disabled: ${rule.invalidRefits.map(x=>`${x.name} (single-anchor formats: ${x.u_formats.join(', ')||'none'})`).join('; ')}.`,'']:[]),...(rule.unexplainedRefits.length?[`**WARNING: ${rule.unexplainedRefits.length} unexplained invalid refit(s); all rows held.**`,'']:[]),'| Row | Family | Reason |','|---|---|---|',...held.map(h=>`| ${h.name.replace(/\|/g,'/')} | ${h.family.replace(/\|/g,'/')} | ${h.reasons.join('; ').replace(/\|/g,'/')} |`),''].join('\n');
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
