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
  // EXPERIMENTAL weighted-least-squares optimum (opt-in; off by default).
  const p=project([{...row('Base Common Superfractor',['1:100'],10),name:'Base Common Superfractor'},{...row('Finest Autographs Superfractor',['1:100'],100),name:'Finest Autographs Superfractor'}],['Hobby']);p.method='experimental';p.robustWeights=false;p.roundingWeights=false;
  let f=calculate(p);const expected=(10/1000+1/10000)/(10/1000**2+1/10000**2);assert.ok(Math.abs(f.packTotals[0]-expected)<1e-6);assert.equal(f.diagnostics[1].weight,1);
  p.rows[1].weight=0;f=calculate(p);assert.ok(Math.abs(f.packTotals[0]-1000)<1e-6);assert.equal(f.diagnostics[1].effectiveWeight,0);assert.ok(Math.abs(f.diagnostics[1].impliedEligible-10)<1e-8);
  p.rows[1].weight=1000;f=calculate(p);assert.ok(f.packTotals[0]>5000);
});
test('questionable anchors can be manually downweighted (experimental mode)',()=>{
  const p=project([row('reliable',['1:100'],10),row('questionable',['1:100'],100)],['Hobby']);p.method='experimental';p.robustWeights=false;p.roundingWeights=false;
  const before=calculate(p).packTotals[0];p.rows[1].weight=0.1;const after=calculate(p);assert.ok(Math.abs(after.packTotals[0]-1000)<Math.abs(before-1000));assert.deepEqual(p.rows[1].odds,['1:100']);
});
test('automatic outlier reductions are off by default and opt-in in experimental mode',()=>{
  // Default: no Huber downweighting, weights equal configured weights.
  const base=project([row('a',['1:100'],10),row('b',['1:100'],100)],['Hobby']);
  assert.ok(calculate(base).diagnostics.every(d=>d.effectiveWeight===d.weight));
  // Opt-in Huber reduces an outlier's effective weight and is reported.
  const exp=project([row('a',['1:100'],10),row('b',['1:100'],100)],['Hobby']);exp.robustWeights=true;
  const f=calculate(exp);assert.ok(f.diagnostics.some(d=>d.downweighted));assert.equal(f.robustConverged,true);
});
test('coarse-odds precision factor is off by default and opt-in',()=>{
  const base=project([row('coarse',['1:2'],10)],['Hobby']);
  assert.equal(calculate(base).diagnostics[0].precisionFactor,1); // off by default
  const exp=project([row('coarse',['1:2'],10)],['Hobby']);exp.roundingWeights=true;
  assert.ok(Math.abs(calculate(exp).diagnostics[0].precisionFactor-0.01)<1e-12);
});
test('default median model solves independent pools and extreme pack scales',()=>{
  const independent=calculate(project([row('a',['1:100','-'],10),row('b',['-','1:200000'],10)]));
  assert.equal(independent.valid,true);assert.equal(independent.methodUsed,'median');assert.deepEqual(independent.packTotals.map(Math.round),[1000,2000000]);
  // Coupled extreme-scale system routes to the experimental solver automatically.
  const huge=calculate(project([row('a',['1:100000000','1:200000000'],111),row('b',['1:100000000','1:202000000'],110)]));
  assert.equal(huge.valid,true);assert.ok(Math.abs(huge.packTotals[0]/1e9-1)<1e-6);assert.ok(Math.abs(huge.packTotals[1]/20.2e9-1)<1e-6);
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

// --- Batch 2: source-hierarchy classification, aliases, ambiguity, headings ---
const checklist=lines=>parseChecklist([{number:1,rows:lines.map(t=>({text:t}))}]);

test('a family under the AUTOGRAPH section defaults to weight 1 by its section, not its name',()=>{
  const c=checklist(['AUTOGRAPH','ITALICS','IT-1 A Player','IT-2 B Player']);
  const fam=c.families.find(f=>f.name==='ITALICS');
  assert.equal(fam.sectionKind,'Autograph / memorabilia');
  const p=anchorProfile({name:'Italics Blue Refractor'},fam);
  assert.equal(p.defaultWeight,1);assert.equal(p.kind,'Autograph / memorabilia');assert.equal(p.source,'section');
});
test('section classification does not downgrade a name that says autograph',()=>{
  const p=anchorProfile({name:'Base Autographs Gold'},{name:'BASE AUTOGRAPHS',sectionKind:'Base'});
  assert.equal(p.defaultWeight,1); // name escalates to limited even under a Base section
});
test('base/insert sections classify without an autograph keyword',()=>{
  const base=anchorProfile({name:'Base Common Refractor'},{name:'BASE CARDS COMMON',sectionKind:'Base'});
  assert.equal(base.defaultWeight,10);assert.equal(base.kind,'Base');
  const ins=anchorProfile({name:'Nocturnal Gold'},{name:'NOCTURNAL',sectionKind:'Insert'});
  assert.equal(ins.defaultWeight,10);assert.equal(ins.kind,'Insert');
});
test('a TOPPS-containing section heading is kept; disclaimer prose is excluded',()=>{
  const c=checklist(['BASE CARDS COMMON','1 A Player','TOPPS TRIBUTE','TT-1 B Player','TT-2 C Player']);
  assert.ok(c.families.some(f=>f.name==='TOPPS TRIBUTE'&&f.count===2));
  const d=checklist(['Checklists provided by Topps reflect the intended configuration','BASE CARDS COMMON','1 A Player']);
  assert.ok(!d.families.some(f=>/provided by Topps/i.test(f.name)));
});
test('word-order-insensitive matching resolves "Base Cards Common" vs "Base Common Cards"',()=>{
  const m=matchFamilies([{id:'r',name:'Base Cards Common Refractor',odds:[],familyId:''}],[{id:'a',name:'Base Common Cards',cards:[],count:1}]);
  assert.equal(m[0].familyId,'a');assert.equal(m[0].ambiguous,false);
});
test('explicit aliases take priority over automatic matching',()=>{
  const fams=[{id:'a',name:'ITALICS',cards:[],count:1},{id:'b',name:'Base',cards:[],count:1}];
  const m=matchFamilies([{id:'r',name:'Italics Base Set',odds:[],familyId:''}],fams,[{from:'Italics',to:'ITALICS'}]);
  assert.equal(m[0].familyId,'a');
});
test('an ambiguous name is left unmatched and flagged, not silently assigned',()=>{
  const m=matchFamilies([{id:'r',name:'Red Blue Gold',odds:[],familyId:''}],[{id:'a',name:'Blue Red Gold',cards:[],count:1},{id:'b',name:'Gold Red Blue',cards:[],count:1}]);
  assert.equal(m[0].familyId,'');assert.equal(m[0].ambiguous,true);
  const none=matchFamilies([{id:'r',name:'Totally Different',odds:[],familyId:''}],[{id:'a',name:'Base Common',cards:[],count:1}]);
  assert.equal(none[0].familyId,'');assert.equal(none[0].ambiguous,false);
});
test('word-boundary protection survives the Batch 2 matcher',()=>{
  const m=matchFamilies([{id:'r',name:'The Manifold Superfractor',odds:[],familyId:''}],[{id:'w',name:'The Man',cards:[],count:1}]);
  assert.equal(m[0].familyId,'');
});
test('a numeric prototype heading with a dash-form subset splits from the prior family',()=>{
  const c=checklist(['FINEST MOMENTS AUTOGRAPHS','FMA-AJ Aaron Judge Yankees','FMA-BC Bartolo Colon Mets','1993 FINEST PROTOTYPES AUTOGRAPH VARIATION','93A-AP Andy Pettitte Astros','93A-BH Bryce Harper Phillies']);
  assert.equal(c.families.find(f=>f.name==='FINEST MOMENTS AUTOGRAPHS').count,2);
  assert.equal(c.families.find(f=>f.name==='1993 FINEST PROTOTYPES AUTOGRAPH VARIATION').count,2);
  // the numeric-led "2 TOM BRADY" in a plain integer list is still a card, not a heading
  const d=checklist(['BASE CARDS COMMON','1 Alpha Beta','2 TOM BRADY PATRIOTS','3 Gamma Delta']);
  assert.equal(d.families.length,1);assert.equal(d.families[0].count,3);
});

// --- Batch 2 corrections from the independent re-validation ---

test('a numeric card just before a new section/family heading is not lost',()=>{
  // The look-ahead must stop at a section line, not mistake "2 TOM BRADY" for a
  // heading because "RF-1" (a different family) appears two rows below.
  const c=checklist(['BASE','BASE CARDS','1 Alpha Player','2 TOM BRADY PATRIOTS','INSERTS','REFLASH','RF-1 Beta Player']);
  assert.equal(c.families.find(f=>f.name==='BASE CARDS').count,2);
  assert.equal(c.families.find(f=>f.name==='REFLASH').count,1);
});
test('identical normalized names are flagged ambiguous on the primary path, not silently picked',()=>{
  const fams=[{id:'a',name:'BASE CARDS COMMON',cards:[],count:50},{id:'b',name:'BASE COMMON CARDS',cards:[],count:99}];
  const m=matchFamilies([{id:'r',name:'Base Cards Common Superfractor',odds:[],familyId:''}],fams);
  assert.equal(m[0].familyId,'');assert.equal(m[0].ambiguous,true);
  // Reversing the family order must give the same (ambiguous) outcome.
  const m2=matchFamilies([{id:'r',name:'Base Cards Common Superfractor',odds:[],familyId:''}],[fams[1],fams[0]]);
  assert.equal(m2[0].familyId,'');assert.equal(m2[0].ambiguous,true);
});
test('a genuine all-caps TOPPS section heading is kept, not merged as prose',()=>{
  const c=checklist(['TEAM FINEST','TF-1 Alpha Beta','TOPPS CHROME ULTRAVIOLET ALL STARS AUTOGRAPHS','UV-1 Gamma Delta','UV-2 Echo Fox']);
  assert.equal(c.families.find(f=>f.name==='TEAM FINEST').count,1);
  const uv=c.families.find(f=>f.name==='TOPPS CHROME ULTRAVIOLET ALL STARS AUTOGRAPHS');
  assert.ok(uv&&uv.count===2);
  // mixed-case disclaimer prose is still excluded
  const d=checklist(['Checklists provided by Topps reflect the configuration','BASE CARDS COMMON','1 Alpha Beta']);
  assert.ok(!d.families.some(f=>/provided by Topps/i.test(f.name)));
});
test('a manual section assignment is preserved through an unrelated alias rematch',()=>{
  const fams=[{id:'small',name:'Small',cards:[],count:10},{id:'large',name:'Large',cards:[],count:100}];
  const rows=[{id:'r',name:'Large Superfractor',odds:['1:100'],familyId:'small',familyIdManual:true,serial:1,anchor:true}];
  const after=matchFamilies(rows,fams,[{from:'Unrelated',to:'Small'}]);
  assert.equal(after[0].familyId,'small'); // user's override wins
  const auto=matchFamilies([{id:'r',name:'Large Superfractor',odds:['1:100'],familyId:'small',serial:1,anchor:true}],fams,[]);
  assert.equal(auto[0].familyId,'large'); // without the flag, auto-match reassigns
});
test('the most specific alias wins regardless of add order',()=>{
  const fams=[{id:'b',name:'Base',cards:[],count:10},{id:'v',name:'Variation',cards:[],count:5}];
  const aliases=[{from:'Base',to:'Base'},{from:'Base Variation',to:'Variation'}];
  const m=matchFamilies([{id:'r',name:'Base Variation Gold',odds:[],familyId:''}],fams,aliases);
  assert.equal(m[0].familyId,'v'); // the longer "Base Variation" alias, not the general "Base"
});
test('a known ordinary section controls the class; a name keyword only escalates',()=>{
  const insert=anchorProfile({name:'Base Refractor'},{name:'Tribute',sectionKind:'Insert'});
  assert.equal(insert.kind,'Insert');assert.equal(insert.source,'section');assert.equal(insert.defaultWeight,10);
  const esc=anchorProfile({name:'Autograph Parallel'},{name:'Some Insert',sectionKind:'Insert'});
  assert.equal(esc.defaultWeight,1); // name escalates to limited even under an Insert section
});

// Alias persistence lifecycle (aliases target stable family IDs). These mirror
// the app's restore-migration and family-delete handlers so a valid UI edit can
// never produce a project the app rejects on reopen.
const restoreAliases=p=>{ // mirrors app.js restore validation + migration
  const isObj=v=>v&&typeof v==='object'&&!Array.isArray(v);
  if(p.aliases!==undefined&&(!Array.isArray(p.aliases)||!p.aliases.every(a=>isObj(a)&&typeof a.from==='string'&&a.from.trim()&&typeof a.to==='string'&&p.families.some(f=>f.id===a.to||f.name===a.to))))throw Error('Invalid name aliases');
  return (p.aliases||[]).map(a=>({...a,to:p.families.some(f=>f.id===a.to)?a.to:p.families.find(f=>f.name===a.to).id}));
};
test('an alias targeting a renamed family still restores and resolves',()=>{
  const families=[{id:'small',name:'Small',cards:[],count:10},{id:'large',name:'Large',cards:[],count:100}];
  const aliases=[{from:'Large',to:'small'}];        // id target
  families[0].name='Small Renamed';                 // rename leaves the id alias intact
  assert.doesNotThrow(()=>restoreAliases({families,aliases}));
  assert.equal(matchFamilies([{id:'r',name:'Large Superfractor',odds:[],familyId:''}],families,aliases)[0].familyId,'small');
});
test('deleting a family removes its dependent aliases and orphaned manual flags',()=>{
  let project={families:[{id:'small',name:'Small',cards:[],count:10},{id:'large',name:'Large',cards:[],count:100}],aliases:[{from:'Large',to:'small'}],rows:[{id:'r',name:'Large SF',familyId:'small',familyIdManual:true}]};
  const fid='small';
  project.families=project.families.filter(f=>f.id!==fid);
  project.rows.forEach(r=>{if(r.familyId===fid){r.familyId='';delete r.familyIdManual;}});
  project.aliases=project.aliases.filter(a=>a.to!==fid);
  assert.deepEqual(project.aliases,[]);
  assert.equal(project.rows[0].familyId,'');assert.equal('familyIdManual' in project.rows[0],false);
  assert.doesNotThrow(()=>restoreAliases(project));
});
test('a legacy name-based alias migrates to a family id on restore',()=>{
  const migrated=restoreAliases({families:[{id:'f0',name:'Base Common',cards:[],count:10}],aliases:[{from:'BC',to:'Base Common'}]});
  assert.equal(migrated[0].to,'f0');
});
test('an alias to a nonexistent section is rejected on restore',()=>{
  assert.throws(()=>restoreAliases({families:[{id:'f0',name:'Base',cards:[],count:1}],aliases:[{from:'X',to:'ghost'}]}));
});

// --- Batch 3: owner's median serial-anchor model is the default -------------

test('default model is the median of serial-anchor implied packs',()=>{
  // One format, serial-numbered base parallels. Total Packs = median of
  // (subjects * serial * odds) across anchors; each parallel PR = packs/odds/subjects.
  const rows=[['a',150,55,10],['b',150,60,9],['c',150,50,11],['d',150,25,22],['e',150,10,54],['f',150,1,526]]
    .map(([id,subj,sn,N])=>({id,name:id,odds:['1:'+N],familyId:id,eligible:subj,serial:sn,anchor:true}));
  const fams=rows.map(r=>({id:r.id,name:r.id,count:r.eligible,cards:[]}));
  const f=calculate({families:fams,formats:['Hobby'],rows,packTotals:[null],allowScenario:false});
  assert.equal(f.methodUsed,'median');
  assert.equal(f.packTotals[0],81750);                 // median of 78900,81000,81000,82500,82500,82500
  assert.deepEqual(f.packRange[0],{min:78900,max:82500,median:81750,anchors:6});
  // per-parallel copies/card = packs / odds / subjects
  assert.ok(Math.abs(f.results.find(r=>r.id==='a').perCard-81750/10/150)<1e-9);
});
test('median model: format-exclusive anchors solve per format',()=>{
  const rows=[
    {id:'h',name:'h',odds:['1:100','-'],familyId:'h',eligible:10,serial:1,anchor:true},
    {id:'d',name:'d',odds:['-','1:200'],familyId:'d',eligible:10,serial:1,anchor:true},
  ];
  const f=calculate({families:[{id:'h',name:'h',count:10,cards:[]},{id:'d',name:'d',count:10,cards:[]}],formats:['Hobby','Delight'],rows,packTotals:[null,null],allowScenario:false});
  assert.equal(f.methodUsed,'median');assert.deepEqual(f.packTotals.map(Math.round),[1000,2000]);
});
test('median model subtracts fixed-format contributions from a shared anchor',()=>{
  // Shared /1 pool of 100 cards; Hobby fixed at 80000 (supplies 80 copies via 1:1000),
  // leaving 20 for Delight at 1:500 -> 20*500 = 10000 Delight packs.
  const f=calculate({families:[{id:'a',name:'a',count:100,cards:[]}],formats:['Hobby','Delight'],rows:[{id:'s',name:'s',odds:['1:1000','1:500'],familyId:'a',eligible:100,serial:1,anchor:true}],packTotals:[80000,null],allowScenario:false});
  assert.equal(f.methodUsed,'median');assert.ok(Math.abs(f.packTotals[1]-10000)<1e-6);
});
test('genuinely coupled multi-format anchors route to the experimental solver',()=>{
  // Two anchors, each spanning both unknown formats -> median cannot separate them.
  const f=calculate({families:[{id:'a',name:'a',count:10,cards:[]},{id:'b',name:'b',count:10,cards:[]}],formats:['Hobby','Delight'],rows:[
    {id:'a',name:'a',odds:['1:100','1:200'],familyId:'a',eligible:10,serial:1,anchor:true},
    {id:'b',name:'b',odds:['1:150','1:250'],familyId:'b',eligible:10,serial:1,anchor:true},
  ],packTotals:[null,null],allowScenario:false});
  assert.equal(f.methodUsed,'experimental-fit');assert.equal(f.packRange,null);
});
test('heuristics are off by default and opt-in via method/flags',()=>{
  const base=project([row('x',['1:2'],10)],['Hobby']); // coarse odds
  const d=calculate(base);
  assert.equal(d.diagnostics[0].precisionFactor,1);                 // coarse-odds off
  assert.ok(d.diagnostics.every(dd=>dd.effectiveWeight===dd.weight)); // Huber off
  assert.ok(/Default model: each format/.test(d.assumptions));
  const e=calculate({...project([row('x',['1:2'],10)],['Hobby']),robustWeights:true,roundingWeights:true});
  assert.ok(/EXPERIMENTAL/.test(e.assumptions));
});

// --- Batch 3 corrections from the independent re-validation -----------------

test('negative inferred production is rejected, never reported as agreement',()=>{
  // Hobby fixed at 100 already exceeds a nominal pool of 10 at 1:1; Delight residual is negative.
  const f=calculate({families:[{id:'a',name:'a',count:10,cards:[]}],formats:['Hobby','Delight'],rows:[{id:'s',name:'s',odds:['1:1','1:1'],familyId:'a',eligible:10,serial:1,anchor:true}],packTotals:[100,null],allowScenario:false});
  assert.equal(f.valid,false);assert.equal(f.packTotals,null);assert.equal(f.conflicts.length,0);
  // The impossible negative residual is surfaced (as an error and/or row issue), never as agreement.
  assert.ok([...f.errors,...f.rowIssues].some(e=>/negative or non-finite/.test(e)));
  assert.ok(f.results.every(r=>r.total===null||r.total>=0));
});
test('default median is weighted: base/insert priority and downweighting are honored',()=>{
  const fams=[{id:'base',name:'Base',count:10,cards:[],sectionKind:'Base'},...[1,2,3].map(i=>({id:'au'+i,name:'Autographs '+i,count:100,cards:[],sectionKind:'Autograph / memorabilia'}))];
  const rows=[{id:'base',name:'Base X',odds:['1:100'],familyId:'base',eligible:10,serial:1,anchor:true},...[1,2,3].map(i=>({id:'au'+i,name:'Autographs '+i,odds:['1:100'],familyId:'au'+i,eligible:100,serial:1,anchor:true}))];
  // Base implies 1000 (weight 10); three autos imply 10000 each (weight 1).
  // Weighted median must favor the base tier, not the equal-vote 10000.
  const f=calculate({families:fams,formats:['Hobby'],rows,packTotals:[null],allowScenario:false});
  assert.equal(f.methodUsed,'median');assert.equal(f.packTotals[0],1000);
  // Manual downweighting of the autos keeps the base-tier result.
  const rows2=rows.map(r=>r.id.startsWith('au')?{...r,weight:0.001}:r);
  assert.equal(calculate({families:fams,formats:['Hobby'],rows:rows2,packTotals:[null],allowScenario:false}).packTotals[0],1000);
});
test('non-finite implied packs are excluded as issues, not folded into the range',()=>{
  const big='1:'+'1'+'0'.repeat(308);
  const f=calculate({families:[],formats:['Hobby'],rows:[
    {id:'a',name:'a',odds:['1:100'],familyId:'',eligible:100,serial:1,anchor:true},
    {id:'b',name:'b',odds:['1:101'],familyId:'',eligible:100,serial:1,anchor:true},
    {id:'c',name:'c',odds:[big],familyId:'',eligible:2,serial:1,anchor:true},
  ],packTotals:[null],allowScenario:false});
  assert.ok(f.valid);assert.equal(f.rowIssues.length,1);
  assert.ok(Number.isFinite(f.packRange[0].min)&&Number.isFinite(f.packRange[0].max));
  assert.equal(f.packRange[0].anchors,2);
});
test('an empty-format project is not a valid estimate',()=>{
  const f=calculate({families:[],rows:[],formats:[],packTotals:[],allowScenario:false});
  assert.equal(f.valid,false);assert.ok(f.errors.some(e=>/at least one pack format/.test(e)));
});

// --- Audit-trail / ledger honesty (Codex fixture) -------------------------
// Hobby fixed at 100; Bad Base implies negative packs for the unknown Delight
// format (fixed contribution 100 > pool 10) so it is INFEASIBLE there; Good
// Base is feasible. Under the default WEIGHTED-MEDIAN model the excluded anchor
// must report participation 'excluded-from-median', used=false, applied weight
// 0, and must NOT be counted in usedAnchors. The ledger may not call it "used".
const ledgerFixture=extra=>({
  families:[{id:'bad',name:'Bad Base',count:10,cards:[],sectionKind:'Base'},{id:'good',name:'Good Base',count:200,cards:[],sectionKind:'Base'}],
  formats:['Hobby','Delight'],
  rows:[
    {id:'bad',name:'Bad Base',odds:['1:1','1:1'],familyId:'bad',eligible:10,serial:1,anchor:true},
    {id:'good',name:'Good Base',odds:['-','1:1'],familyId:'good',eligible:200,serial:1,anchor:true},
  ],
  packTotals:[100,null],allowScenario:false,...extra,
});
test('default median: an infeasible anchor is excluded from the audit trail, not counted as used',()=>{
  const f=calculate(ledgerFixture());
  assert.equal(f.methodUsed,'median');
  const bad=f.diagnostics.find(d=>d.name==='Bad Base'),good=f.diagnostics.find(d=>d.name==='Good Base');
  assert.equal(bad.participation,'excluded-from-median');
  assert.equal(bad.used,false);
  assert.equal(bad.effectiveWeight,0);
  assert.equal(good.participation,'median');
  assert.equal(good.used,true);
  assert.ok(good.effectiveWeight>0);
  assert.equal(f.usedAnchors,1);
  assert.equal(f.enabledAnchors,2);
  assert.ok(f.rowIssues.some(m=>/Bad Base/.test(m)&&/excluded/.test(m)));
  assert.ok(!f.rowIssues.some(m=>/Bad Base/.test(m)&&/retained in the experimental fit/.test(m)));
});
test('experimental fit: an infeasible anchor is retained (not falsely reported as excluded)',()=>{
  const f=calculate(ledgerFixture({method:'experimental'}));
  assert.equal(f.methodUsed,'experimental-fit');
  const bad=f.diagnostics.find(d=>d.name==='Bad Base');
  assert.equal(bad.participation,'solver');
  assert.equal(bad.used,true);
  assert.ok(bad.effectiveWeight>0);
  assert.ok(f.rowIssues.some(m=>/Bad Base/.test(m)&&/retained in the experimental fit/.test(m)));
  assert.ok(!f.rowIssues.some(m=>/Bad Base/.test(m)&&/excluded from that format/.test(m)));
});
test('entered mode: consistency-only anchors are not mislabeled "excluded as infeasible"',()=>{
  // All pack totals entered -> methodUsed 'entered'; anchors only check
  // consistency, so they are NOT median participants (used=false) but are also
  // NOT excluded as infeasible. The status line's "excluded as infeasible" note
  // is gated to the median model; this asserts the invariant that gate relies on.
  const f=calculate({families:[{id:'a',name:'Base',count:100,cards:[],sectionKind:'Base'}],formats:['Hobby'],rows:[{id:'a',name:'Base',odds:['1:100'],familyId:'a',eligible:100,serial:1,anchor:true}],packTotals:[100000],allowScenario:false});
  assert.equal(f.methodUsed,'entered');
  const d=f.diagnostics[0];
  assert.equal(d.participation,'entered');
  assert.equal(d.used,false);
  assert.ok(d.effectiveWeight>0); // still a valid consistency checker, not excluded
  assert.ok(f.rowIssues.every(m=>!/excluded/i.test(m))); // no exclusion issue raised
  // The status clause that prints "excluded as infeasible" fires only for median.
  const excludedNoteFires=f.methodUsed==='median'&&f.enabledAnchors>f.usedAnchors;
  assert.equal(excludedNoteFires,false);
});
test('exported anchor ledger carries Participation, Exclusion reason and Applied weight, consistent with the method',()=>{
  const f=calculate(ledgerFixture());
  const PARTICIPATION_LABEL={'median':'Used (fed format median)','solver':'Used (experimental fit)','excluded-from-median':'Excluded (infeasible implied pool)','entered':'Consistency check only (totals entered)','not-an-anchor':'Not used as anchor'};
  const header=['Anchor','Kind','Checklist count','Known copies per eligible card','Checklist-based copies','Estimated copies','Implied eligible cards','Relative discrepancy','Participation','Exclusion reason','Configured weight','Applied weight','Odds precision factor','Automatic reduction','Numbering source','Source concern','Method',...['Hobby','Delight'].map(x=>x+' packs')];
  const text=csv([header,...f.diagnostics.map(d=>[d.name,d.kind,d.count,d.serial,d.total,d.predicted,d.impliedEligible,d.error,PARTICIPATION_LABEL[d.participation]||d.participation,d.participation==='excluded-from-median'?'Infeasible implied pool':'',d.weight,d.effectiveWeight,d.precisionFactor,d.downweighted,'',' ',f.assumptions,...f.packTotals])]);
  const lines=text.split(/\r?\n/).filter(Boolean);
  assert.ok(lines[0].includes('Participation')&&lines[0].includes('Exclusion reason')&&lines[0].includes('Applied weight'));
  // Every cell is double-quoted with no embedded commas in this fixture, so a
  // split on '","' with the outer quotes stripped recovers the columns exactly.
  const cols=l=>l.replace(/^"/,'').replace(/"$/,'').split('","');
  const badCols=cols(lines.find(l=>l.startsWith('"Bad Base"')));
  const headerCols=cols(lines[0]);
  const col=(row,name)=>row[headerCols.indexOf(name)];
  assert.equal(col(badCols,'Participation'),'Excluded (infeasible implied pool)');
  assert.equal(col(badCols,'Exclusion reason'),'Infeasible implied pool');
  // The excluded anchor's exported applied weight is 0 — it never claims influence.
  assert.equal(col(badCols,'Applied weight'),'0');
  const goodCols=cols(lines.find(l=>l.startsWith('"Good Base"')));
  assert.equal(col(goodCols,'Participation'),'Used (fed format median)');
  assert.ok(Number(col(goodCols,'Applied weight'))>0);
  // The exported method string names the weighted median.
  assert.ok(/WEIGHTED MEDIAN/.test(f.assumptions));
});

console.log(`${checks} checks passed.`);
