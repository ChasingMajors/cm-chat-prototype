import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseRatio,parseChecklist,parseOdds,matchFamilies,calculate,anchorProfile,csv} from '../print-run-lab/engine.js';
import {readPdf} from '../print-run-lab/pdf-reader.js';
import {applyFinestReference,finestConfigs} from '../print-run-lab/finest-reference.js';
let checks=0;
function test(name,fn){fn();checks++;console.log('PASS',name);}
const families=[{id:'a',name:'BASE CARDS COMMON',count:100,cards:[]}];
const row=(id,odds,count=100)=>({id,name:id,odds,familyId:'a',eligible:count,serial:1,anchor:true});
const project=(rows,formats=['Hobby','Breaker Delight'])=>({families,formats,rows,packTotals:formats.map(()=>null),allowScenario:false});
test('normalizes both odds directions and unavailable cells',()=>{assert.equal(parseRatio('6:1'),6);assert.equal(parseRatio('1:3,500'),1/3500);assert.equal(parseRatio('-'),null);assert.throws(()=>parseRatio('0:10'));assert.throws(()=>parseRatio('1:0'));});
test('single-format 1/1 production anchor',()=>{const p=project([row('super',['1:3500'])],['Hobby']);const f=calculate(p);assert.equal(f.valid,true);assert.ok(Math.abs(f.packTotals[0]-350000)<.01);assert.ok(Math.abs(f.results[0].perCard-1)<1e-8);});
test('shared pool requires independent equations',()=>{const f=calculate(project([row('super',['1:3500','1:2924'])]));assert.equal(f.identifiable,false);assert.equal(f.results[0].total,null);});
test('combines shared and format-exclusive pools',()=>{const p=project([row('shared',['1:1000','1:500']),row('exclusive',['-','1:500'],20)]);p.rows.push({...row('common',['6:1','-']),serial:null,anchor:false});const f=calculate(p);assert.equal(f.valid,true);assert.ok(Math.abs(f.packTotals[0]-80000)<1);assert.ok(Math.abs(f.packTotals[1]-10000)<1);assert.ok(Math.abs(f.results[2].perCard-4800)<1);});
test('three formats are solved together',()=>{const f=calculate(project([row('a',['1:100','-','-'],10),row('b',['-','1:200','-'],10),row('c',['-','-','1:300'],10)],['Hobby','Delight','Retail']));assert.equal(f.valid,true);assert.deepEqual(f.packTotals.map(Math.round),[1000,2000,3000]);});
test('known pack totals resolve remaining unknown format',()=>{const p=project([row('shared',['1:1000','1:500'])]);p.packTotals=[80000,null];const f=calculate(p);assert.equal(f.valid,true);assert.ok(Math.abs(f.packTotals[1]-10000)<.01);});
test('contradictory anchors show estimates and diagnostics without an opt-in',()=>{const p=project([row('a',['-','1:100'],10),row('b',['-','1:100'],100),row('c',['1:100','-'],10)]);const f=calculate(p);assert.equal(f.valid,true);assert.ok(f.conflicts.length);assert.ok(f.results[0].total>0);assert.equal(f.provisional,true);});
test('an invalid row is isolated while valid production estimates remain visible',()=>{const p=project([row('anchor',['1:100'],10),{...row('invalid',['garbage']),anchor:false}],['Hobby']);const f=calculate(p);assert.equal(f.valid,true);assert.equal(f.rowIssues.length,1);assert.equal(f.results[1].total,null);assert.ok(f.results[0].total>0);});
test('negative pack totals block estimates with otherwise valid odds',()=>{const p=project([row('super',['1:3500','1:2924'])]);p.packTotals=[-1,100];const f=calculate(p);assert.ok(f.errors.some(e=>/nonnegative/.test(e)));assert.equal(f.valid,false);});
test('eligible parallel counts override checklist size',()=>{const p=project([row('exclusive',['1:100'],20)],['Hobby']);const f=calculate(p);assert.equal(Math.round(f.packTotals[0]),2000);assert.equal(f.results[0].count,20);});
test('CSV escapes text and neutralizes spreadsheet formulas',()=>{assert.equal(csv([['=HYPERLINK("x")','a,b','line\n2']]),'"\'=HYPERLINK(""x"")","a,b","line\n2"');});
test('CSV neutralizes every dangerous prefix including leading whitespace',()=>{
  for(const v of ['=1','+1','-1','@1','\t=1','\r=1',' =1','\n=1','  @cmd'])assert.equal(csv([[v]]),`"'${v.replaceAll('"','""')}"`,`expected apostrophe for ${JSON.stringify(v)}`);
  for(const v of ['normal','2+3','0;=1'])assert.equal(csv([[v]]),`"${v}"`,`expected no apostrophe for ${JSON.stringify(v)}`);
});
const c=parseChecklist(await readPdf(await readFile(new URL('../print-run-lab/examples/2025-finest-checklist.pdf',import.meta.url))));
const o=parseOdds(await readPdf(await readFile(new URL('../print-run-lab/examples/2025-finest-odds.pdf',import.meta.url))));
test('real checklist counts preserve numeric headings across page breaks',()=>{assert.equal(c.families.length,24);assert.equal(c.families.find(f=>f.name==='92 FINEST').count,44);assert.equal(c.families.find(f=>f.name==='LANDMARK METAL SERIES').count,20);assert.deepEqual(c.families.slice(0,3).map(f=>f.count),[100,100,100]);});
test('real odds detect both formats and all 228 rows',()=>{assert.deepEqual(o.formats,['Hobby','Breaker Delight']);assert.equal(o.rows.length,228);assert.equal(o.warnings.length,0);});
test('real families match every odds row and expose published conflicts',()=>{const rows=matchFamilies(o.rows,c.families);assert.equal(rows.filter(r=>!r.familyId).length,0);const f=calculate({...o,rows,families:c.families,allowScenario:false});assert.equal(f.identifiable,true);assert.equal(f.valid,true);assert.equal(f.provisional,true);assert.equal(f.results.filter(r=>r.total!==null).length,228);assert.ok(f.conflicts.some(r=>r.name==='Team Finest Superfractor'));});

// --- Regression tests for findings confirmed in the independent audits ---

// Sensitive systems must be solved accurately and clearly marked; source conflicts no longer hide estimates.
test('sensitive allocations show accurate estimates with a conditioning warning',()=>{
  const p=project([row('a',['1:1000','1:2000'],10),row('b',['1:1000','1:2001'],10)]);
  const f=calculate(p);
  assert.equal(f.valid,true);assert.equal(f.wellConditioned,false);assert.equal(f.provisional,true);assert.ok(Math.abs(f.packTotals[0]-10000)<1);assert.ok(f.packTotals[1]<1);
});
test('sensitive positive-production allocation is shown with explicit caution',()=>{
  const p=project([row('a',['1:1000','1:2000'],211),row('b',['1:1000','1:2010'],210)]);
  const f=calculate(p);assert.equal(f.valid,true);assert.ok(f.conditioning>500);assert.ok(Math.abs(f.packTotals[0]-10000)<1);assert.ok(Math.abs(f.packTotals[1]-402000)<1);
});
test('well-conditioned systems still solve exactly and report convergence',()=>{
  const three=calculate({families,formats:['H','D','R'],rows:[row('a',['1:100','-','-'],10),row('b',['-','1:200','-'],10),row('c',['-','-','1:300'],10)],packTotals:[null,null,null],allowScenario:false});
  assert.equal(three.valid,true);assert.equal(three.converged,true);assert.deepEqual(three.packTotals.map(Math.round),[1000,2000,3000]);
});

// Finding 2: a later page whose format columns are reordered is re-mapped to the
// canonical order; an unknown/extra format name blocks estimates.
test('reordered odds columns are re-mapped to canonical format order',()=>{
  const pages=[
    {number:1,rows:[{text:'Card Hobby Retail',items:[{text:'Card',x:0,width:20},{text:'Hobby',x:100,width:30},{text:'Retail',x:200,width:30}]}]},
    {number:2,rows:[{text:'Card Retail Hobby',items:[{text:'Card',x:0,width:20},{text:'Retail',x:100,width:30},{text:'Hobby',x:200,width:30}]},{text:'Two 1:300 1:400',items:[]}]},
  ];
  const od=parseOdds(pages);
  assert.equal(od.blocking,false);
  assert.deepEqual(od.rows.find(r=>r.name==='Two').odds,['1:400','1:300']);
});
test('unknown format heading on a later page blocks estimates',()=>{
  const pages=[
    {number:1,rows:[{text:'Card Hobby Retail',items:[{text:'Card',x:0,width:20},{text:'Hobby',x:100,width:30},{text:'Retail',x:200,width:30}]}]},
    {number:2,rows:[{text:'Card Jumbo Retail',items:[{text:'Card',x:0,width:20},{text:'Jumbo',x:100,width:30},{text:'Retail',x:200,width:30}]}]},
  ];
  const od=parseOdds(pages);assert.equal(od.blocking,true);
  assert.equal(calculate({families:[],formats:od.formats,rows:od.rows,packTotals:od.formats.map(()=>null),allowScenario:false,oddsBlocking:od.blocking}).valid,false);
});

// Finding 3: odds cells split by whitespace around the colon are still parsed.
test('whitespace-fragmented ratio cells are parsed, not dropped',()=>{
  const pages=[{number:1,rows:[
    {text:'Card Hobby Retail',items:[{text:'Card',x:0,width:20},{text:'Hobby',x:100,width:30},{text:'Retail',x:200,width:30}]},
    {text:'One 1 : 100 1 : 200',items:[]},
  ]}];
  const od=parseOdds(pages);assert.equal(od.rows.length,1);assert.deepEqual(od.rows[0].odds,['1:100','1:200']);
});

// Finding 4: an all-caps card row must not be misread as a section heading,
// while a genuine numeric heading (92 FINEST) still becomes a section.
test('all-caps card rows stay cards; numeric headings stay sections',()=>{
  const bad=parseChecklist([{number:1,rows:['BASE CARDS COMMON','1 Cam Ward Titans','2 TOM BRADY PATRIOTS','3 Joe Burrow Bengals'].map(t=>({text:t}))}]);
  assert.equal(bad.families.length,1);assert.equal(bad.families[0].count,3);assert.deepEqual(bad.families[0].cards.map(c=>c.id),['1','2','3']);
  const ninety=parseChecklist([{number:1,rows:['92 FINEST','92-1 Trey McBride Cards','92-2 Bijan Robinson Falcons'].map(t=>({text:t}))}]);
  assert.equal(ninety.families[0].name,'92 FINEST');assert.equal(ninety.families[0].count,2);
});

// Finding 5: prefix matching respects word boundaries.
test('family matching respects word boundaries',()=>{
  assert.equal(matchFamilies([{id:'r',name:'The Manifold Superfractor',odds:[],familyId:''}],[{id:'wrong',name:'The Man',cards:[],count:1}])[0].familyId,'');
  assert.equal(matchFamilies([{id:'r',name:'The Man Refractor',odds:[],familyId:''}],[{id:'ok',name:'The Man',cards:[],count:1}])[0].familyId,'ok');
});

test('legacy scenario flag no longer controls visibility',()=>{
  const rows=[row('a',['-','1:100'],10),row('b',['-','1:100'],100),row('c',['1:100','-'],10)];
  const base={families,formats:['Hobby','Breaker Delight'],rows,packTotals:[null,null]};
  const a=calculate({...base,allowScenario:false}),b=calculate({...base,allowScenario:true});assert.equal(a.valid,true);assert.equal(b.valid,true);assert.deepEqual(a.packTotals,b.packTotals);
});
test('base and insert default influence exceeds auto and relic anchors',()=>{
  for(const name of ['Base Common Superfractor','Reflash Superfractor'])assert.equal(anchorProfile({name}).defaultWeight,10);
  for(const name of ['Finest Autographs Superfractor','Finest Freshman Auto Superfractor','Patch Superfractor','Memorabilia Superfractor','Relics Red'])assert.equal(anchorProfile({name}).defaultWeight,1);
});
test('weighted production agrees with a hand-derived relative least-squares optimum',()=>{
  const p=project([{...row('Base Common Superfractor',['1:100'],10),name:'Base Common Superfractor'},{...row('Finest Autographs Superfractor',['1:100'],100),name:'Finest Autographs Superfractor'}],['Hobby']);p.robustWeights=false;
  let f=calculate(p);const expected=(10/1000+1/10000)/(10/1000**2+1/10000**2);assert.ok(Math.abs(f.packTotals[0]-expected)<1e-6);assert.equal(f.diagnostics[1].weight,1);
  p.rows[1].weight=0;f=calculate(p);assert.ok(Math.abs(f.packTotals[0]-1000)<1e-6);assert.equal(f.diagnostics[1].effectiveWeight,0);assert.ok(Math.abs(f.diagnostics[1].impliedEligible-10)<1e-8);
  p.rows[1].weight=1000;f=calculate(p);assert.ok(f.packTotals[0]>5000);
});
test('questionable anchors can be manually downweighted without changing source odds',()=>{
  const p=project([row('reliable',['1:100'],10),row('questionable',['1:100'],100)],['Hobby']);p.robustWeights=false;
  const before=calculate(p).packTotals[0];p.rows[1].weight=0.1;const after=calculate(p);assert.ok(Math.abs(after.packTotals[0]-1000)<Math.abs(before-1000));assert.deepEqual(p.rows[1].odds,['1:100']);
});
test('automatic outlier reductions are visible and can be disabled',()=>{
  const p=project([row('a',['1:100'],10),row('b',['1:100'],100)],['Hobby']);const f=calculate(p);assert.ok(f.diagnostics.some(d=>d.downweighted));assert.equal(f.robustConverged,true);
  p.robustWeights=false;assert.ok(calculate(p).diagnostics.every(d=>d.effectiveWeight===d.weight));
});
test('coarse odds have an explicit lower precision weight',()=>{
  const p=project([row('coarse',['1:2'],10)],['Hobby']);const f=calculate(p);assert.ok(Math.abs(f.diagnostics[0].precisionFactor-0.01)<1e-12);assert.ok(Math.abs(f.packTotals[0]-20)<1e-8);
  p.roundingWeights=false;assert.equal(calculate(p).diagnostics[0].precisionFactor,1);
});
test('column scaling preserves independent pools and extreme pack scales',()=>{
  const independent=calculate(project([row('a',['1:100','-'],10),row('b',['-','1:200000'],10)]));assert.equal(independent.valid,true);assert.ok(independent.wellConditioned);assert.deepEqual(independent.packTotals.map(Math.round),[1000,2000000]);
  const huge=calculate(project([row('a',['1:100000000','1:200000000'],111),row('b',['1:100000000','1:202000000'],110)]));assert.equal(huge.valid,true);assert.ok(Math.abs(huge.packTotals[0]/1e9-1)<1e-6);assert.ok(Math.abs(huge.packTotals[1]/20.2e9-1)<1e-6);
});
test('supplied Finest numbering is scoped to the example and preserves omissions',()=>{
  const rows=applyFinestReference(matchFamilies(o.rows,c.families));const find=name=>rows.find(r=>r.name===name);
  assert.equal(find('Base Common Refractors Sky Blue').serial,325);assert.equal(find('Base Uncommon Refractor Red').serial,5);assert.equal(find('Base Rare Xfractor Blue').serial,49);assert.equal(find('92 Finest Refractor').serial,92);assert.equal(find('Framed White').serial,1);assert.equal(find('Base Common Refractors Oil Spill').serial,null);
  assert.equal(o.rows.find(r=>r.name==='Base Common Refractors Sky Blue').serial,null);
  const f=calculate({formats:o.formats,families:c.families,rows,packTotals:[null,null],formatConfigs:finestConfigs});assert.equal(f.hasEstimate,true);assert.equal(f.robustConverged,true);assert.equal(f.results.filter(r=>r.total!==null).length,228);assert.equal(f.usedAnchors,172);
  assert.ok(Math.abs(f.formatChecks[0].boxes*6-f.packTotals[0])<1e-6);assert.equal(f.formatChecks[1].boxes,f.packTotals[1]);assert.equal(f.formatChecks[0].cardsPerPack,10);assert.ok(f.conflicts.length>0);
});

// --- Batch 1 hardening: deterministic reader & accounting fixes ---
// Fixtures mirror the layouts confirmed in the multi-product study (Cards /
// Component Description headers, NumberedTo metadata, pack-vs-box odds, wrapped
// headers, duplicate headings) without depending on external PDFs.
const hdr=(...labels)=>({text:'Card '+labels.join(' '),items:[{text:'Card',x:0,width:20},...labels.map((l,i)=>({text:l,x:100+i*100,width:30}))]});
const dataRow=(name,...cells)=>({text:name+' '+cells.join(' '),items:[]});

test('plural "Cards" header is recognized',()=>{
  const o=parseOdds([{number:1,rows:[{text:'Cards Hobby',items:[{text:'Cards',x:0,width:30},{text:'Hobby',x:120,width:30}]},dataRow('Base Refractor','1:5')]}]);
  assert.deepEqual(o.formats,['Hobby']);assert.equal(o.rows.length,1);assert.deepEqual(o.rows[0].odds,['1:5']);
});
test('Component Description header with NumberedTo metadata reads serials, not a format',()=>{
  const o=parseOdds([{number:1,rows:[
    {text:'Component Description NumberedTo HOBBY PACK ODDS',items:[{text:'Component Description',x:0,width:120},{text:'NumberedTo',x:300,width:60},{text:'HOBBY PACK ODDS',x:460,width:80}]},
    {text:'Base Refractor 199 1:4',items:[]},
    {text:'Base Superfractor 1 1:1000',items:[]},
  ]}]);
  assert.deepEqual(o.formats,['HOBBY']);assert.equal(o.rows.length,2);
  assert.equal(o.rows[0].serial,199);assert.deepEqual(o.rows[0].odds,['1:4']);
  assert.equal(o.rows[1].serial,1);
});
test('pack and box odds for one population: box odds kept as reference, not a second format',()=>{
  const o=parseOdds([{number:1,rows:[
    {text:'Component Description HOBBY PACK ODDS HOBBY BOX ODDS',items:[{text:'Component Description',x:0,width:120},{text:'HOBBY PACK ODDS',x:300,width:90},{text:'HOBBY BOX ODDS',x:460,width:90}]},
    {text:'Base Refractor 2:1 8:1',items:[]},
  ]}]);
  assert.deepEqual(o.formats,['HOBBY']);assert.equal(o.rows.length,1);
  assert.deepEqual(o.rows[0].odds,['2:1']);assert.deepEqual(o.rows[0].referenceBoxOdds,['8:1']);
});
test('wrapped header: qualifier line folds in; ambiguous duplicate columns block',()=>{
  // Line 1 has merged SKU columns; line 2 carries the channel qualifiers, two of which repeat ("BOX").
  const o=parseOdds([{number:1,rows:[
    {text:'Card SKU-A SKU-B SKU-C SKU-D SKU-E',items:[{text:'Card',x:0,width:20},{text:'SKU-A',x:300,width:40},{text:'SKU-B',x:450,width:40},{text:'SKU-C',x:650,width:40},{text:'SKU-D',x:850,width:40},{text:'SKU-E',x:1030,width:40}]},
    {text:'HOBBY JUMBO DELIGHT BOX BOX',items:[{text:'HOBBY',x:415,width:40},{text:'JUMBO',x:605,width:40},{text:'DELIGHT',x:805,width:40},{text:'BOX',x:1003,width:30},{text:'BOX',x:1194,width:30}]},
    {text:'Rookie Auto 1:43 1:8 1:1 1:124 1:81',items:[]},
  ]}]);
  assert.deepEqual(o.formats,['HOBBY','JUMBO','DELIGHT','BOX','BOX']);
  assert.equal(o.rows.length,1);assert.deepEqual(o.rows[0].odds,['1:43','1:8','1:1','1:124','1:81']);
  // Duplicate BOX columns are a live-checked block: calculate() refuses to
  // estimate until the names are made distinct (parseOdds.blocking is reserved
  // for ambiguous column mapping, not duplicate names).
  const f=calculate({families:[],formats:o.formats,rows:o.rows,packTotals:o.formats.map(()=>null),allowScenario:false,oddsBlocking:o.blocking});
  assert.equal(f.valid,false);assert.ok(f.errors.some(e=>/Duplicate pack-format/.test(e)));
});
test('duplicate pack-format headings block estimates',()=>{
  const o=parseOdds([{number:1,rows:[hdr('Hobby','Hobby'),dataRow('Base','1:10','1:20')]}]);
  // Duplicate names are blocked live by calculate(), not via parseOdds.blocking
  // (which is reserved for ambiguous column mapping that a rename cannot fix).
  assert.equal(calculate({families:[],formats:o.formats,rows:o.rows,packTotals:o.formats.map(()=>null),allowScenario:false,oddsBlocking:o.blocking}).valid,false);
});
test('reorder followed by a return to canonical order maps every row correctly',()=>{
  const o=parseOdds([{number:1,rows:[
    hdr('Hobby','Retail'),
    {text:'Card Retail Hobby',items:[{text:'Card',x:0,width:20},{text:'Retail',x:100,width:30},{text:'Hobby',x:200,width:30}]},
    dataRow('One','1:100','1:200'),
    hdr('Hobby','Retail'),
    dataRow('Two','1:300','1:400'),
  ]}]);
  assert.deepEqual(o.rows.find(r=>r.name==='One').odds,['1:200','1:100']); // under reordered header
  assert.deepEqual(o.rows.find(r=>r.name==='Two').odds,['1:300','1:400']); // header reset to canonical
});
test('non-finite derived values are isolated, never certified as within 5%',()=>{
  // A finite-but-huge rate whose rate x pack product would overflow is rejected.
  const big='1'+'0'.repeat(308)+':1';
  const f=calculate({families:[],formats:['A'],rows:[{id:'r',name:'r',odds:[big],familyId:'',eligible:1,serial:null,anchor:false}],packTotals:[2],allowScenario:false});
  assert.equal(f.rowIssues.length,1);assert.equal(f.results[0].total,null);
  // Astronomical serial/eligible are rejected rather than producing NaN diagnostics.
  const g=calculate({families:[],formats:['A'],rows:[{id:'r',name:'r',odds:['1:100'],familyId:'',eligible:1e200,serial:1e200,anchor:true}],packTotals:[2],allowScenario:false});
  assert.equal(g.rowIssues.length,1);
  assert.ok(g.diagnostics.every(d=>d.error===null||Number.isFinite(d.error)));
  assert.ok(g.results.every(r=>r.total===null||Number.isFinite(r.total)));
});
test('a referenced format solved to zero is flagged as a boundary allocation',()=>{
  const r=(id,odds,c)=>({id,name:id,odds,familyId:'',eligible:c,serial:1,anchor:true});
  const f=calculate({families:[],formats:['A','B','C'],rows:[r('a',['1:100','-','-'],10),r('c',['-','-','1:100'],10),r('b',['1:100','1:100','1:100'],10)],packTotals:[null,null,null],allowScenario:false,robustWeights:false,roundingWeights:false});
  const bCheck=f.formatChecks.find(c=>c.format==='B');
  assert.equal(bCheck.boundaryZero,true);
  assert.equal(f.formatChecks.find(c=>c.format==='A').boundaryZero,false);
});

// --- Batch 1 corrections: adverse fixtures from the independent re-validation ---

test('box-before-pack column order is read by role, not position',()=>{
  const o=parseOdds([{number:1,rows:[
    {text:'Card HOBBY BOX ODDS HOBBY PACK ODDS',items:[{text:'Card',x:0,width:20},{text:'HOBBY BOX ODDS',x:300,width:90},{text:'HOBBY PACK ODDS',x:460,width:90}]},
    {text:'Base Refractor 8:1 2:1',items:[]},
  ]}]);
  assert.deepEqual(o.formats,['HOBBY']);
  assert.deepEqual(o.rows[0].odds,['2:1']);           // pack odds, not the box column
  assert.deepEqual(o.rows[0].referenceBoxOdds,['8:1']);
});
test('an ordinary label-only row does not overwrite format names',()=>{
  const o=parseOdds([{number:1,rows:[
    {text:'Card Hobby Retail',items:[{text:'Card',x:0,width:20},{text:'Hobby',x:200,width:30},{text:'Retail',x:400,width:30}]},
    {text:'BASE CARDS',items:[{text:'BASE',x:0,width:40},{text:'CARDS',x:70,width:40}]}, // left-margin section label
    {text:'Base Superfractor 1:100 1:200',items:[]},
  ]}]);
  assert.deepEqual(o.formats,['Hobby','Retail']);
  assert.equal(o.rows.find(r=>r.name==='Base Superfractor').serial,1);
});
test('a repeated header refreshes active column roles (NumberedTo appears later)',()=>{
  const o=parseOdds([{number:1,rows:[
    {text:'Card Hobby',items:[{text:'Card',x:0,width:20},{text:'Hobby',x:200,width:30}]},
    {text:'First Superfractor 1:100',items:[]},
    {text:'Card NumberedTo Hobby',items:[{text:'Card',x:0,width:20},{text:'NumberedTo',x:120,width:60},{text:'Hobby',x:300,width:30}]},
    {text:'Base Refractor 99 1:10',items:[]},
  ]}]);
  const br=o.rows.find(r=>r.name==='Base Refractor');
  assert.equal(br.serial,99);assert.deepEqual(br.odds,['1:10']);
});
test('duplicate-only block clears when names are made unique',()=>{
  // Duplicate names are re-checked live; parseOdds does not set the mapping flag for them.
  const parsed=parseOdds([{number:1,rows:[{text:'Card Hobby Hobby',items:[{text:'Card',x:0,width:20},{text:'Hobby',x:100,width:30},{text:'Hobby',x:200,width:30}]},{text:'Base 1:10 1:20',items:[]}]}]);
  assert.equal(parsed.blocking,false); // mapping flag not raised for a duplicate name
  const blocked=calculate({families:[],formats:['Hobby','Hobby'],rows:[],packTotals:[null,null],allowScenario:false,oddsBlocking:parsed.blocking});
  assert.equal(blocked.valid,false);assert.ok(blocked.errors.some(e=>/Duplicate pack-format/.test(e)));
  const fixed=calculate({families:[],formats:['Hobby','Retail'],rows:[],packTotals:[null,null],allowScenario:false,oddsBlocking:false});
  assert.ok(!fixed.errors.some(e=>/Duplicate pack-format/.test(e)));
});
test('incompatible-header mapping block survives a format rename',()=>{
  // A later header with a different format name is a mapping-ambiguity block.
  const parsed=parseOdds([{number:1,rows:[
    {text:'Card Hobby',items:[{text:'Card',x:0,width:20},{text:'Hobby',x:200,width:30}]},
    {text:'Base Superfractor 1:100',items:[]},
    {text:'Card Retail',items:[{text:'Card',x:0,width:20},{text:'Retail',x:200,width:30}]},
    {text:'Insert Superfractor 1:200',items:[]},
  ]}]);
  assert.equal(parsed.blocking,true); // ambiguous mapping -> real block
  const blocked=calculate({families:[],formats:parsed.formats,rows:[],packTotals:parsed.formats.map(()=>null),allowScenario:false,oddsBlocking:parsed.blocking});
  assert.equal(blocked.valid,false);assert.ok(blocked.errors.some(e=>/column-mapping|need correction/.test(e)));
  // Renaming the single format (uniqueness unchanged) must NOT clear a mapping block.
  const renamed=calculate({families:[],formats:['Hobby Renamed'],rows:[],packTotals:[null],allowScenario:false,oddsBlocking:true});
  assert.equal(renamed.valid,false);assert.ok(renamed.errors.some(e=>/column-mapping|need correction/.test(e)));
});
test('combined duplicate + mapping block: resolving names keeps the mapping block',()=>{
  const both=calculate({families:[],formats:['Hobby','Hobby'],rows:[],packTotals:[null,null],allowScenario:false,oddsBlocking:true});
  assert.ok(both.errors.some(e=>/Duplicate pack-format/.test(e)));assert.ok(both.errors.some(e=>/column-mapping|need correction/.test(e)));
  const namesFixed=calculate({families:[],formats:['Hobby','Retail'],rows:[],packTotals:[null,null],allowScenario:false,oddsBlocking:true});
  assert.ok(!namesFixed.errors.some(e=>/Duplicate pack-format/.test(e))); // duplicate resolved
  assert.ok(namesFixed.errors.some(e=>/column-mapping|need correction/.test(e))); // mapping block remains
  assert.equal(namesFixed.valid,false);
});
test('derivedIssues counts an overflowing anchor once, not twice',()=>{
  const f=calculate({families:[],formats:['A'],rows:[{id:'r',name:'r',odds:['1000000000:1'],familyId:'',eligible:1,serial:1,anchor:true}],packTotals:[1e308],allowScenario:false});
  assert.equal(f.derivedIssues,1); // the same row is an anchor AND a result row
  assert.equal(f.provisional,true);
});
test('non-finite derived value forces provisional and is not read as agreement',()=>{
  const f=calculate({families:[],formats:['A'],rows:[{id:'r',name:'r',odds:['1000000000:1'],familyId:'',eligible:1,serial:1,anchor:true}],packTotals:[1e308],allowScenario:false});
  assert.equal(f.conflicts.length,0);assert.ok(f.derivedIssues>0);assert.equal(f.provisional,true);
  assert.equal(f.results[0].total,null);
});
test('eligible card counts must be whole numbers',()=>{
  const f=calculate({families:[],formats:['A'],rows:[{id:'r',name:'r',odds:['1:100'],familyId:'',eligible:1.5,serial:1,anchor:true}],packTotals:[null],allowScenario:false});
  assert.equal(f.rowIssues.length,1);assert.equal(f.valid,false);
});
test('label cleaning strips catalog codes but preserves ordinal/edition qualifiers',()=>{
  const sku=parseOdds([{number:1,rows:[{text:'Card 5313 - HOBBY PACK ODDS',items:[{text:'Card',x:0,width:20},{text:'5313 - HOBBY PACK ODDS',x:300,width:120}]},{text:'Base 1:5',items:[]}]}]);
  assert.deepEqual(sku.formats,['HOBBY']);
  const ord=parseOdds([{number:1,rows:[{text:'Card 1st Edition PACK ODDS',items:[{text:'Card',x:0,width:20},{text:'1st Edition PACK ODDS',x:300,width:120}]},{text:'Base 1:5',items:[]}]}]);
  assert.deepEqual(ord.formats,['1st Edition']);
});

console.log(`${checks} checks passed.`);
