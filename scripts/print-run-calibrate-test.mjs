import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {buildArtifact} from '../print-run-lab/project-schema.js';
import {calibrate} from './print-run-calibrate.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const reports=path.join(root,'data/print-run-lab/v1/calibration/reports');
const fixturePath=path.join(root,'data/print-run-lab/v1/calibration/2023-bowman-sapphire-mlb.json');
const digest=b=>createHash('sha256').update(b).digest('hex');
function example(packs=81750){
  const p={version:1,title:'Calibration test',families:[{id:'base',name:'Base',count:10,cards:[],sectionKind:'Base'}],formats:['Hobby'],rows:[
    {id:'regular',name:'Base regular',familyId:'base',odds:['1:10'],eligible:null,serial:null,anchor:false},
    {id:'anchor',name:'Base numbered',familyId:'base',odds:['1:'+packs/10],eligible:null,serial:1,anchor:true}
  ],packTotals:[null],sources:{},aliases:[],warnings:[],allowScenario:false};
  return buildArtifact(p,{projectId:'prl_calibration-test',revisionId:'test-revision-001',publishedAt:'2026-11-01T12:00:00Z'});
}
function fixture(){return {schema_version:1,set:{slug:'calibration-test',project_id:'prl_calibration-test'},provenance:{owner_target:{source_url:'https://example.test/owner-target',pulled_at:'2026-11-01'},cross_check:null},aggregate:{format:'Hobby',metric:'total_packs',unit:'packs',owner_value:80000},per_parallel:[{family_id:'base',row_id:'regular',source_label:'Owner base label',format:'Hobby',metric:'copies_per_card',unit:'copies_per_card',owner_value:800,set_size:10}],aliases:[{from:'Owner base label',to:'base'}]};}

test('known point 81750 versus 80000 is +2.19% and passes',()=>{
  const r=calibrate(example(),fixture());assert.equal(r.verdict,'PASS');assert.equal(r.aggregate.relative_error,0.021875);assert.equal((r.aggregate.relative_error*100).toFixed(2),'2.19');assert.equal(r.summary.unmatched_rows,0);
});
test('aggregate gate is inclusive at both 5% boundaries and fails beyond them',()=>{
  for(const packs of [76000,84000])assert.equal(calibrate(example(packs),fixture()).verdict,'PASS');
  for(const packs of [75999,84001])assert.equal(calibrate(example(packs),fixture()).verdict,'FAIL');
  assert.ok(calibrate(example(75999),fixture()).aggregate.relative_error<0);
});
test('stable row ID disambiguates multiple parallels within one checklist family',()=>{
  const r=calibrate(example(),fixture());assert.equal(r.per_parallel[0].row_id,'regular');assert.equal(r.per_parallel[0].actual_value,817.5);assert.equal(r.unscored_rows[0].row_id,'anchor');
});
test('only explicit aliases and exact names resolve targets without IDs',()=>{
  const f=fixture();delete f.per_parallel[0].family_id;delete f.per_parallel[0].row_id;f.per_parallel[0].source_label='Base regular';f.aliases=[{from:'Base regular',to:'base'}];
  assert.equal(calibrate(example(),f).verdict,'PASS');f.per_parallel[0].source_label='base Regular';assert.equal(calibrate(example(),f).verdict,'INCOMPLETE');
});
test('ambiguous names and contradictory aliases are reported rather than first-matched',()=>{
  const a=example();a.project.rows[1].name=a.calculation.results[1].name='Base regular';const f=fixture();delete f.per_parallel[0].row_id;f.per_parallel[0].source_label='Base regular';f.aliases=[];
  assert.equal(calibrate(a,f).unmatched[0].reason,'ambiguous-parallel');
  const ambiguous=fixture();ambiguous.aliases.push({from:'Owner base label',to:'another-family'});assert.equal(calibrate(example(),ambiguous).unmatched[0].reason,'ambiguous-explicit-alias');
  const contradictory=fixture();contradictory.aliases=[{from:'Owner base label',to:'another-family'}];assert.equal(calibrate(example(),contradictory).unmatched[0].reason,'family-alias-disagreement');
});
test('missing IDs, formats, checklist sizes and estimates prevent a false PASS',()=>{
  for(const [key,value,reason] of [['family_id','missing','family-alias-disagreement'],['row_id','missing','unknown-parallel'],['format','Retail','unknown-pack-format'],['set_size',11,'checklist-size-disagreement']]){
    const f=fixture();f.per_parallel[0][key]=value;const r=calibrate(example(),f);assert.equal(r.verdict,'INCOMPLETE');assert.equal(r.unmatched[0].reason,reason);
  }
  const a=example();a.calculation.results[0].byFormat=null;a.calculation.results[0].perCard=null;a.calculation.results[0].total=null;assert.equal(calibrate(a,fixture()).unmatched[0].reason,'estimate-unavailable');
  const f=fixture();f.aggregate.format='Retail';assert.equal(calibrate(example(),f).verdict,'INCOMPLETE');
});
test('per-parallel differences are report-only with a strict greater-than-10% flag',()=>{
  const f=fixture();f.per_parallel[0].owner_value=700;const r=calibrate(example(),f);assert.equal(r.verdict,'PASS');assert.equal(r.per_parallel[0].soft_flag,true);
  const a=example(80000);a.calculation.results[0].perCard=880;assert.equal(calibrate(a,fixture()).per_parallel[0].soft_flag,false);a.calculation.results[0].perCard=880.01;assert.equal(calibrate(a,fixture()).per_parallel[0].soft_flag,true);
});
test('tiny denominators retain absolute copies and zero targets never divide by zero',()=>{
  const a=example();a.calculation.results[0].perCard=1.02;const f=fixture();f.per_parallel[0].owner_value=1.01;const r=calibrate(a,f).per_parallel[0];assert.equal(r.tiny_denominator,true);assert.ok(Math.abs(r.absolute_difference-0.01)<1e-12);
  f.per_parallel[0].owner_value=0;const z=calibrate(a,f).per_parallel[0];assert.equal(z.relative_error,null);assert.equal(z.absolute_difference,1.02);assert.equal(z.soft_flag,true);
});
test('comparisons use the selected format rather than summed multi-format perCard',()=>{
  const a=example();a.project.formats.push('Retail');a.project.packTotals.push(null);for(const row of a.project.rows)row.odds.push('-');a.calculation.packTotals.push(90000);a.calculation.formatChecks.push({...a.calculation.formatChecks[0],format:'Retail'});a.calculation.packRange.push(null);
  for(const r of a.calculation.results){r.byFormat.push(1000);r.total+=1000;r.perCard=r.total/r.count;}
  assert.equal(calibrate(a,fixture()).per_parallel[0].actual_value,817.5);
});
test('non-median methods cannot claim comparison eligibility',()=>{
  for(const method of ['entered','experimental-fit']){const a=example();a.calculation.methodUsed=method;const r=calibrate(a,fixture());assert.equal(r.method_eligible,false);assert.equal(r.verdict,'INCOMPLETE');}
});
test('wrong project/model, units, non-finite inputs and duplicate targets reject',()=>{
  const wrong=fixture();wrong.set.project_id='prl_another-project';assert.throws(()=>calibrate(example(),wrong),/project_id/);
  const model=fixture();model.set.engine_sha256='0'.repeat(64);assert.throws(()=>calibrate(example(),model),/engine hash/);
  for(const change of [f=>f.aggregate.unit='cards',f=>f.aggregate.owner_value=0,f=>f.per_parallel[0].metric='total_copies',f=>f.per_parallel[0].owner_value=Infinity,f=>f.per_parallel.push({...f.per_parallel[0]})]){const f=fixture();change(f);assert.throws(()=>calibrate(example(),f));}
  const a=example();a.calculation.results[0].perCard=Infinity;assert.throws(()=>calibrate(a,fixture()));
});
test('two differently expressed fixture targets cannot count the same row twice',()=>{
  const f=fixture();f.per_parallel.push({...f.per_parallel[0],row_id:undefined,source_label:'Base regular'});f.aliases.push({from:'Base regular',to:'base'});const r=calibrate(example(),f);assert.equal(r.verdict,'INCOMPLETE');assert.equal(r.unmatched[0].reason,'duplicate-resolved-target');
});
test('comparison does not mutate either source and publication status stays pinned',()=>{
  const a=example(),f=fixture(),beforeA=JSON.stringify(a),beforeF=JSON.stringify(f);const r=calibrate(a,f);assert.equal(JSON.stringify(a),beforeA);assert.equal(JSON.stringify(f),beforeF);assert.deepEqual(r.published_status,{estimate_status:'provisional',calibration_status:'not-yet-calibrated'});assert.equal(r.reference.revision_id,a.revision_id);assert.equal(r.reference.engine_sha256,a.model.engine_sha256);
});
test('known baseline bytes cannot be substituted while retaining the same revision identity',()=>{
  const a=example(),f=fixture();f.set.baseline_revision_id=a.revision_id;f.set.baseline_sha256='a'.repeat(64);assert.throws(()=>calibrate(a,f,{artifactSha256:'b'.repeat(64)}),/byte hash/);assert.equal(calibrate(a,f,{artifactSha256:'a'.repeat(64)}).verdict,'PASS');
});
test('overflowing derived percentages stay explicit and never serialize as false agreement',()=>{
  const f=fixture();f.per_parallel[0].owner_value=Number.MIN_VALUE;const r=calibrate(example(),f);assert.equal(r.per_parallel[0].relative_error,null);assert.equal(r.per_parallel[0].relative_error_note,'non-finite-derived-relative-error');assert.equal(r.per_parallel[0].soft_flag,true);assert.ok(!JSON.stringify(r).includes('Infinity'));
  f.aggregate.owner_value=Number.MIN_VALUE;const aggregate=calibrate(example(),f);assert.equal(aggregate.verdict,'FAIL');assert.equal(aggregate.aggregate.relative_error_note,'non-finite-derived-relative-error');
});
test('CLI writes an atomic sibling report with hashes and rejects input overwrites',async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'prl-calibration-'));await fs.mkdir(reports,{recursive:true});const outDir=await fs.mkdtemp(path.join(reports,'.test-'));
  try{
    const artifact=path.join(tmp,'artifact.json'),target=path.join(tmp,'fixture.json'),out=path.join(outDir,'report.json');await fs.writeFile(artifact,JSON.stringify(example()));await fs.writeFile(target,JSON.stringify(fixture()));const original=await fs.readFile(artifact);
    const cli=(...args)=>spawnSync(process.execPath,['scripts/print-run-calibrate.mjs','--artifact',artifact,'--fixture',target,...args],{cwd:root,encoding:'utf8'});
    assert.equal(cli('--out',out).status,0);const report=JSON.parse(await fs.readFile(out,'utf8'));assert.equal(report.reference.artifact_sha256,digest(original));assert.equal(report.verdict,'PASS');assert.deepEqual(await fs.readFile(artifact),original);
    assert.equal(cli('--out',artifact).status,2);const link=path.join(outDir,'input-link.json');await fs.symlink(artifact,link);assert.equal(cli('--out',link).status,2);assert.deepEqual(await fs.readFile(artifact),original);
    const f=fixture();f.aggregate.owner_value=100000;await fs.writeFile(target,JSON.stringify(f));assert.equal(cli('--out',out).status,1);assert.equal(JSON.parse(await fs.readFile(out,'utf8')).verdict,'FAIL');
  }finally{await fs.rm(tmp,{recursive:true,force:true});await fs.rm(outDir,{recursive:true,force:true});}
});
test('committed Bowman fixture scores its real published revision with complete coverage',async()=>{
  const f=JSON.parse(await fs.readFile(fixturePath,'utf8'));
  // Pin the immutable baseline, not a mutable catalog entry: future owner
  // publications must not be blocked because their median changes.
  assert.ok(f.set.baseline_path.startsWith('projects/'+f.set.project_id+'/'));
  const bytes=await fs.readFile(path.join(root,'data/print-run-lab/v1',f.set.baseline_path));assert.equal(digest(bytes),f.set.baseline_sha256);const a=JSON.parse(bytes),r=calibrate(a,f);assert.equal(a.revision_id,f.set.baseline_revision_id);
  assert.equal(f.set.slug,'2023-bowman-sapphire-mlb');assert.equal(a.project.families[0].count,150);assert.equal(a.project.families[1].count,29);assert.equal(a.project.rows.length,14);assert.equal(a.project.rows.find(row=>row.id==='bs23-unnumbered-base').anchor,false);assert.equal(a.calculation.results.find(row=>row.id==='bs23-unnumbered-base').perCard,null);
  const unconfirmed=a.project.rows.find(row=>row.name==='CHROME PROSPECTS AUTO');assert.equal(unconfirmed.serial,199);assert.equal(unconfirmed.weight,0.1);assert.match(unconfirmed.serialSource,/unconfirmed/);
  assert.equal(r.verdict,'PASS');assert.equal(r.aggregate.actual_value,81490);assert.equal(r.summary.matched_rows,13);assert.equal(r.unmatched.length,0);assert.equal(r.summary.per_parallel_soft_flags,0);assert.equal(a.calibration_status,'not-yet-calibrated');
});
