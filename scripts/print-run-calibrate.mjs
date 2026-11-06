import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {validateArtifact} from '../print-run-lab/project-schema.js';

const reportsRoot=fileURLToPath(new URL('../data/print-run-lab/v1/calibration/reports/',import.meta.url));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=v=>typeof v==='string'&&v.trim().length>0;
const finite=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const AGGREGATE_BAND=0.05,PARALLEL_BAND=0.10;

function checkFixture(f){
  if(!object(f)||f.schema_version!==1||!object(f.set)||!text(f.set.slug)||!/^[a-z0-9-]+$/.test(f.set.slug)||!text(f.set.project_id))throw Error('Invalid fixture identity.');
  if(!object(f.provenance)||!object(f.provenance.owner_target)||!text(f.provenance.owner_target.source_url)||!text(f.provenance.owner_target.pulled_at))throw Error('Fixture provenance is required.');
  const a=f.aggregate;
  if(!object(a)||a.metric!=='total_packs'||a.unit!=='packs'||!text(a.format)||!finite(a.owner_value)||a.owner_value<=0)throw Error('Aggregate must specify a positive total_packs target in packs.');
  if(!Array.isArray(f.per_parallel)||!f.per_parallel.length||!Array.isArray(f.aliases))throw Error('Fixture parallel targets and aliases are required.');
  for(const alias of f.aliases)if(!object(alias)||!text(alias.from)||!text(alias.to))throw Error('Invalid explicit alias.');
  const seen=new Set();
  for(const t of f.per_parallel){
    if(!object(t)||!text(t.source_label)||!text(t.format)||t.metric!=='copies_per_card'||t.unit!=='copies_per_card'||!finite(t.owner_value))throw Error('Invalid per-parallel metric or target.');
    if(t.family_id!=null&&!text(t.family_id)||t.row_id!=null&&!text(t.row_id))throw Error('Invalid target identity.');
    if(t.set_size!=null&&(!Number.isSafeInteger(t.set_size)||t.set_size<1))throw Error('Invalid target checklist size.');
    const key=JSON.stringify([t.family_id??null,t.row_id??t.source_label,t.format]);
    if(seen.has(key))throw Error('Duplicate fixture target.');seen.add(key);
  }
}

function differences(actual,expected){
  const difference=actual-expected;
  // A zero reference has no meaningful relative error; expose absolute copies.
  const rawRelative=expected===0?null:difference/expected;
  const relative=rawRelative!==null&&Number.isFinite(rawRelative)?rawRelative:null;
  return {difference,absolute_difference:Math.abs(difference),relative_error:relative,absolute_relative_error:relative===null?null:Math.abs(relative),relative_error_note:expected===0?'zero-reference':relative===null?'non-finite-derived-relative-error':null};
}

function resolveTarget(t,f,artifact){
  const families=new Set(artifact.project.families.map(x=>x.id));
  const aliases=new Set(f.aliases.filter(a=>a.from===t.source_label).map(a=>a.to));
  if(aliases.size>1)return {reason:'ambiguous-explicit-alias'};
  const alias=[...aliases][0];
  if(t.family_id&&alias&&t.family_id!==alias)return {reason:'family-alias-disagreement'};
  const familyId=t.family_id||alias;
  if(!families.has(familyId))return {reason:'unknown-family-id'};
  const formatIndex=artifact.project.formats.indexOf(t.format);
  if(formatIndex<0)return {reason:'unknown-pack-format'};
  // A checklist family contains multiple parallels. Its ID and format alone
  // are insufficient: use the stable odds-row ID, or an exact row-name match.
  const candidates=artifact.calculation.results.filter(r=>r.familyId===familyId&&(t.row_id?r.id===t.row_id:r.name===t.source_label));
  if(candidates.length!==1)return {reason:candidates.length?'ambiguous-parallel':'unknown-parallel'};
  const row=candidates[0];
  if(t.set_size!=null&&row.count!==t.set_size)return {reason:'checklist-size-disagreement'};
  if(!Number.isSafeInteger(row.count)||row.count<1||!row.byFormat||!finite(row.byFormat[formatIndex])||!finite(row.perCard))return {reason:'estimate-unavailable'};
  const actual=artifact.project.formats.length===1?row.perCard:row.byFormat[formatIndex]/row.count;
  if(!finite(actual))return {reason:'estimate-unavailable'};
  return {row,familyId,actual};
}

export function calibrate(input,fixture,{generatedAt=new Date().toISOString(),artifactSha256=null,fixtureSha256=null}={}){
  const artifact=validateArtifact(input);checkFixture(fixture);
  if(artifact.project_id!==fixture.set.project_id)throw Error('Fixture project_id does not match the published project.');
  if(fixture.set.engine_sha256&&fixture.set.engine_sha256!==artifact.model.engine_sha256)throw Error('Fixture engine hash does not match the published model.');
  if(artifactSha256&&artifact.revision_id===fixture.set.baseline_revision_id&&fixture.set.baseline_sha256&&artifactSha256!==fixture.set.baseline_sha256)throw Error('Baseline artifact byte hash does not match the fixture.');
  const formatIndex=artifact.project.formats.indexOf(fixture.aggregate.format);
  const actualPacks=formatIndex<0?null:artifact.calculation.packTotals[formatIndex];
  const aggregate=actualPacks===null?{...fixture.aggregate,actual_value:null,within_band:false,reason:'unknown-pack-format'}:{...fixture.aggregate,actual_value:actualPacks,...differences(actualPacks,fixture.aggregate.owner_value),within_band:Math.abs(actualPacks-fixture.aggregate.owner_value)/fixture.aggregate.owner_value<=AGGREGATE_BAND+1e-12};
  aggregate.relative_error_band=AGGREGATE_BAND;
  aggregate.pack_range=formatIndex<0?null:artifact.calculation.packRange?.[formatIndex]??null;
  const perParallel=[],unmatched=[],usedRows=new Set(),usedTargets=new Set();
  for(const target of fixture.per_parallel){
    const resolved=resolveTarget(target,fixture,artifact);
    if(resolved.reason){unmatched.push({...target,reason:resolved.reason});continue;}
    const identity=JSON.stringify([resolved.row.id,target.format]);
    if(usedTargets.has(identity)){unmatched.push({...target,reason:'duplicate-resolved-target'});continue;}
    usedTargets.add(identity);
    const d=differences(resolved.actual,target.owner_value);
    perParallel.push({...target,family_id:resolved.familyId,row_id:resolved.row.id,actual_value:resolved.actual,...d,soft_flag:d.absolute_relative_error===null?d.absolute_difference>0:d.absolute_relative_error>PARALLEL_BAND+1e-12,tiny_denominator:target.owner_value<=2});
    usedRows.add(resolved.row.id);
  }
  const relativeErrors=perParallel.map(p=>p.absolute_relative_error).filter(v=>v!==null).sort((a,b)=>a-b);
  const middle=Math.floor(relativeErrors.length/2);
  const methodEligible=artifact.calculation.methodUsed==='median';
  const complete=actualPacks!==null&&unmatched.length===0;
  const verdict=!complete||!methodEligible?'INCOMPLETE':aggregate.within_band?'PASS':'FAIL';
  return {
    schema_version:1,generated_at:generatedAt,set_slug:fixture.set.slug,verdict,
    scope:'Offline comparison against owner targets only; not manufacturer confirmation or a change to publication eligibility.',
    reference:{project_id:artifact.project_id,revision_id:artifact.revision_id,engine_sha256:artifact.model.engine_sha256,model_version:artifact.model.version,artifact_sha256:artifactSha256,fixture_sha256:fixtureSha256},
    published_status:{estimate_status:artifact.estimate_status,calibration_status:artifact.calibration_status},
    method_used:artifact.calculation.methodUsed,method_eligible:methodEligible,aggregate,
    source_cautions:{anchor_discrepancies:artifact.calculation.conflicts.length,anchor_discrepancy_names:artifact.calculation.conflicts.map(r=>r.name),row_issues:artifact.calculation.rowIssues.length,note:'A comparison PASS does not resolve source-odds discrepancies or missing estimates.'},
    per_parallel:perParallel,unmatched,
    summary:{fixture_rows:fixture.per_parallel.length,matched_rows:perParallel.length,unmatched_rows:unmatched.length,per_parallel_soft_flags:perParallel.filter(r=>r.soft_flag).length,per_parallel_relative_error_band:PARALLEL_BAND,median_absolute_relative_error:relativeErrors.length?(relativeErrors.length%2?relativeErrors[middle]:(relativeErrors[middle-1]+relativeErrors[middle])/2):null},
    unscored_rows:artifact.calculation.results.filter(r=>!usedRows.has(r.id)).map(r=>({row_id:r.id,family_id:r.familyId,name:r.name,estimate_available:finite(r.perCard),reason:r.perCard==null?'No estimate or no owner comparison target; inspect project coverage notes.':'No owner comparison target.'})),
    provenance:structuredClone(fixture.provenance)
  };
}

export async function runCli(args){
  const options={};
  for(let i=0;i<args.length;i+=2){if(!['--artifact','--fixture','--out'].includes(args[i])||!args[i+1]||options[args[i]])throw Error('Usage: node scripts/print-run-calibrate.mjs --artifact PATH --fixture PATH [--out PATH]');options[args[i]]=args[i+1];}
  if(!options['--artifact']||!options['--fixture'])throw Error('Both --artifact and --fixture are required.');
  const [artifactBytes,fixtureBytes]=await Promise.all([fs.readFile(options['--artifact']),fs.readFile(options['--fixture'])]);
  const artifact=JSON.parse(artifactBytes),fixture=JSON.parse(fixtureBytes);
  const report=calibrate(artifact,fixture,{artifactSha256:sha256(artifactBytes),fixtureSha256:sha256(fixtureBytes)});
  const out=path.resolve(options['--out']||path.join(reportsRoot,fixture.set.slug+'-'+artifact.revision_id+'.json'));
  const root=path.resolve(reportsRoot);
  if(!out.startsWith(root+path.sep)||path.extname(out)!=='.json')throw Error('Report output must be a JSON file under data/print-run-lab/v1/calibration/reports/.');
  await fs.mkdir(path.dirname(out),{recursive:true});
  const [realRoot,realParent,artifactPath,fixturePath]=await Promise.all([fs.realpath(root),fs.realpath(path.dirname(out)),fs.realpath(options['--artifact']),fs.realpath(options['--fixture'])]);
  if(realParent!==realRoot&&!realParent.startsWith(realRoot+path.sep))throw Error('Report directory escapes the calibration reports directory.');
  const existing=await fs.realpath(out).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  if(out===artifactPath||out===fixturePath||existing===artifactPath||existing===fixturePath)throw Error('Report cannot overwrite an input.');
  const temporary=path.join(path.dirname(out),'.calibration-'+randomUUID()+'.tmp');
  try{await fs.writeFile(temporary,JSON.stringify(report,null,2)+'\n',{flag:'wx'});await fs.rename(temporary,out);}finally{await fs.rm(temporary,{force:true});}
  console.log(JSON.stringify({verdict:report.verdict,total_packs:report.aggregate.actual_value,owner_total_packs:report.aggregate.owner_value,relative_error:report.aggregate.relative_error,unmatched:report.unmatched.length,per_parallel_soft_flags:report.summary.per_parallel_soft_flags,report:path.relative(fileURLToPath(new URL('../',import.meta.url)),out)}));
  return report.verdict==='PASS'?0:1;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{process.exitCode=await runCli(process.argv.slice(2));}catch(e){console.error('Calibration failed: '+e.message);process.exitCode=2;}
}
