import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {sanitizeProject,buildArtifact} from '../print-run-lab/project-schema.js';
import {stabilityRule,convert,categorize,loadInput,engineSha256,buildOutputs,RELIC_HOLD_REASON} from './print-run-lab-to-prv.mjs';
import {manyFormats} from './print-run-lab-many-formats.mjs';
const script=new URL('./print-run-lab-to-prv.mjs',import.meta.url).pathname;
const row=(id,name,odds,extra={})=>({id,name,familyId:'f',odds,eligible:null,serial:null,anchor:false,page:1,...extra});
// X has two consistent anchors; Y has two conflicting anchors (1000 vs 1500 packs), so Y rows are unstable.
function project(){
  return sanitizeProject({version:1,title:'Synthetic',families:[{id:'f',name:'Base',count:100,cards:[],sectionKind:'Base'},{id:'r',name:'Woven Relics',count:10,cards:[],sectionKind:'Autograph / memorabilia'},{id:'a',name:'Signatures',count:10,cards:[],sectionKind:'Autograph / memorabilia'}],
    formats:['X','Y'],packTotals:[null,null],aliases:[],sources:{},warnings:[],formatConfigs:{},oddsBlocking:false,
    rows:[row('base','BASE',['1:1','1:1']),row('xonly','X PARALLEL',['1:10','-']),row('yonly','Y PARALLEL',['-','1:10']),row('zero','NEVER PULLED',['-','-']),
      row('xa','X ANCHOR A',['1:10','-'],{eligible:10,serial:10,anchor:true}),row('xb','X ANCHOR B',['1:20','-'],{eligible:5,serial:10,anchor:true}),
      row('ya','Y ANCHOR A',['-','1:10'],{eligible:10,serial:10,anchor:true}),row('yb','Y ANCHOR B',['-','1:10'],{eligible:15,serial:10,anchor:true}),
      row('relic','WOVEN RELIC',['1:10','-'],{familyId:'r'}),row('sig','SIGNATURE',['1:10','-'],{familyId:'a'})]});
}
test('stability rule holds unstable, zero and relic rows and publishes stable ones',()=>{
  const {rule,estimates,held}=convert(project());
  const by=id=>rule.rows.find(r=>r.id===id);
  assert.equal(by('xonly').status,'PUBLISHABLE');assert.equal(by('base').status,'HELD');
  assert.equal(by('yonly').status,'HELD');assert.match(by('yonly').reason,/max change [\d.]+% > 5\.00% when anchor disabled: Y ANCHOR/);
  assert.equal(by('zero').status,'HELD');assert.match(by('zero').reason,/zero\/undetermined/);
  const heldBy=id=>held.find(h=>h.id===id),est=id=>estimates.find(e=>e.row_id===id);
  assert.deepEqual(heldBy('relic').reasons,[RELIC_HOLD_REASON]);
  assert.equal(est('sig').category,'Autograph');assert.equal(est('xonly').category,'Base');
  assert.ok(estimates.every(e=>e.serial_limit===null&&e.estimate===true));
  assert.equal(estimates.length+held.length,rule.rows.length);
});
test('rule is deterministic; an invalid refit with a single-anchor format holds only touching rows and publishes the rest',()=>{
  assert.deepEqual(stabilityRule(project()).rows,stabilityRule(project()).rows);
  const p=project();p.rows=p.rows.filter(r=>r.id!=='yb');
  const rule=stabilityRule(p),by=id=>rule.rows.find(r=>r.id===id);
  assert.equal(rule.invalidRefits.length,1);assert.deepEqual(rule.invalidRefits[0].u_formats,['Y']);assert.equal(rule.unexplainedRefits.length,0);
  assert.equal(by('xonly').status,'PUBLISHABLE');assert.equal(by('sig').status,'PUBLISHABLE');
  for(const id of ['base','yonly','ya'])assert.equal(by(id).status,'HELD');
  assert.match(by('yonly').reason,/format Y rests on a single anchor \(Y ANCHOR A\)/);
});
test('an unexplained invalid refit holds every row',()=>{
  // Two anchors, each in both formats: disabling one leaves one equation for two unknowns, with no single-anchor format.
  const p=sanitizeProject({version:1,title:'U',families:[{id:'f',name:'Base',count:100,cards:[],sectionKind:'Base'}],formats:['X','Y'],packTotals:[null,null],aliases:[],sources:{},warnings:[],formatConfigs:{},oddsBlocking:false,
    rows:[row('r1','ROW',['1:10','1:10']),row('a1','A1',['1:10','1:20'],{eligible:10,serial:10,anchor:true}),row('a2','A2',['1:20','1:10'],{eligible:10,serial:10,anchor:true})]});
  const orig=console.error;let warned='';console.error=m=>{warned+=m;};
  let rule;try{rule=stabilityRule(p);}finally{console.error=orig;}
  assert.ok(rule.unexplainedRefits.length>0);assert.match(warned,/unexplained/);
  assert.ok(rule.rows.every(r=>r.status==='HELD'&&/refit failed unexplained/.test(r.reason)));
});
test('normal rows are unchanged when every refit is valid',()=>{
  const rule=stabilityRule(project());
  assert.equal(rule.invalidRefits.length,0);assert.equal(rule.rows.find(r=>r.id==='xonly').status,'PUBLISHABLE');
});
test('relic handling is configurable and never labelled Autograph',()=>{
  const p=project(),r=p.rows.find(x=>x.id==='relic');
  assert.deepEqual(categorize(p,r),{category:null,hold:RELIC_HOLD_REASON});
  assert.equal(categorize(p,r,{relic:'Relic'}).category,'Relic');
  assert.notEqual(categorize(p,r,{relic:'Relic'}).category,'Autograph');
});
test('a 14-format project converts',()=>{
  const out=buildOutputs(sanitizeProject(manyFormats(14)),{source:{kind:'project'},cvCode:'code'});
  assert.equal(out.prv.counts.rows,29);assert.equal(out.prv.cv_code,'code');assert.match(out.md,/Held rows/);
});
test('artifact input is refused when the engine sha differs, and accepted when it matches',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prv-'));
  try{
    const a=buildArtifact(project(),{projectId:'prl_00000000-0000',revisionId:'rev-00000001',publishedAt:'2026-01-01T00:00:00.000Z'});
    const good=path.join(dir,'good.json'),bad=path.join(dir,'bad.json');
    fs.writeFileSync(good,JSON.stringify(a));fs.writeFileSync(bad,JSON.stringify({...a,model:{...a.model,engine_sha256:'0'.repeat(64)}}));
    assert.throws(()=>loadInput(bad),/Refusing to run: engine sha/);
    assert.equal(loadInput(good).source.kind,'artifact');assert.equal(a.model.engine_sha256,engineSha256());
    assert.throws(()=>execFileSync(process.execPath,[script,'--in',bad,'--out-dir',path.join(dir,'o')],{stdio:'pipe'}));
    execFileSync(process.execPath,[script,'--in',good,'--out-dir',path.join(dir,'o'),'--cv-code','x'],{stdio:'pipe'});
    for(const f of ['prv-input.json','held-rows.json','held-rows.md'])assert.ok(fs.existsSync(path.join(dir,'o',f)));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'o','prv-input.json'),'utf8')).engine_sha256,engineSha256());
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
