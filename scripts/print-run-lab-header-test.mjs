import assert from 'node:assert/strict';
import {parseOdds} from '../print-run-lab/engine.js';
let checks=0;
function test(name,fn){fn();checks++;console.log('PASS',name);}
// Build a row from [text,x] pairs, the way pdf-reader exposes them.
const mk=(cells)=>({text:cells.map(c=>c[0]).join(' '),items:cells.map(([text,x,w])=>({text,x,width:w||Math.max(10,text.length*5)}))});
const page=(rows,number=1)=>({number,rows});
const disclaimer=[mk([['Odds are subject to change.',18]]),mk([['Topps makes no guarantee.',18]])];
// Exact geometry of the 2026-27 Topps Flagship Basketball odds header.
const line1=mk([['Card',18],['HOBBY',328],['HOBBY',392],['RETAIL',456],['RETAIL',520],['RETAIL',584],['RETAIL',648],['RETAIL',712],['PROMO',775],['BLACK',841],['COSTCO',901],['CHINA EX',962,48],['CHINA EX',1026,48],['ALL STAR',1089],['SAMS',1164]]);
const line2=mk([['JUMBO',392],['HANGER',452],['FAT PACK',513],['VALUE',585],['MEGA BOX',639],['FANATICS',705],['SILVER',776],['FRIDAY VB',831],['FLAGSHIP',897],['WAVE 1',967],['WAVE 2',1031],['GAME',1099],['CLUB BOX',1152]]);
const line3=mk([['PACK',460],['BOX',591],['VB',723],['PACKS',777],['COL',911]]);
const xs=[340,404,468,532,596,660,724,793,852,921,980,1044,1108,1177];
const dataRow=(name,vals)=>mk([[name,18],...vals.map((v,i)=>[v,xs[i]])]);
const FORMATS=['HOBBY','HOBBY JUMBO','RETAIL HANGER PACK','RETAIL FAT PACK','RETAIL VALUE BOX','RETAIL MEGA BOX','RETAIL FANATICS VB','PROMO SILVER PACKS','BLACK FRIDAY VB','COSTCO FLAGSHIP COL','CHINA EX WAVE 1','CHINA EX WAVE 2','ALL STAR GAME','SAMS CLUB BOX'];
const r1=dataRow('BASE',['1:1','1:1','1:1','1:1','1:1','1:1','1:1','-','1:1','-','1:1','1:1','1:1','-']);
const r2=dataRow('BASE CHROME',['1:2','-','1:3','-','1:4','-','1:5','1:6','-','1:7','-','1:8','-','1:9']);
test('three-line header yields 14 named formats and aligned odds',()=>{
  const o=parseOdds([page([...disclaimer,line1,line2,line3,r1,r2])]);
  assert.deepEqual(o.formats,FORMATS);
  assert.equal(o.rows.length,2);assert.equal(o.warnings.length,0);assert.equal(o.blocking,false);
  assert.deepEqual(o.rows[0].odds,['1:1','1:1','1:1','1:1','1:1','1:1','1:1','-','1:1','-','1:1','1:1','1:1','-']);
  assert.deepEqual(o.rows[1].odds,['1:2','-','1:3','-','1:4','-','1:5','1:6','-','1:7','-','1:8','-','1:9']);
});
test('repeated three-line header on a later page keeps the same formats',()=>{
  const o=parseOdds([page([line1,line2,line3,r1]),page([...disclaimer,line1,line2,line3,r2],2)]);
  assert.deepEqual(o.formats,FORMATS);assert.equal(o.rows.length,2);assert.equal(o.warnings.length,0);
});
test('systemic cell-count mismatch emits one blocking warning and caps row warnings',()=>{
  const short=dataRow('BASE',['1:1','1:1','1:1']);
  const rows=Array.from({length:30},(_,i)=>mk([[`ROW ${i}`,18],['1:1',340],['1:1',404],['1:1',468]]));
  const o=parseOdds([page([mk([['Card',18],['HOBBY',328],['RETAIL',392],['PROMO',456],['SAMS',520]]),...rows,short])]);
  assert.equal(o.rows.length,0);assert.equal(o.blocking,true);
  assert.match(o.warnings[0],/header was read as 4 pack formats but the data rows have 3 cells/);
  assert.ok(o.warnings.length<=8,`warnings capped, got ${o.warnings.length}`);
});
test('an isolated mismatch stays a non-blocking per-row warning',()=>{
  const good=Array.from({length:10},(_,i)=>mk([[`ROW ${i}`,18],['1:1',340],['1:1',404]]));
  const o=parseOdds([page([mk([['Card',18],['HOBBY',328],['RETAIL',392]]),...good,mk([['ODD',18],['1:1',340]])])]);
  assert.equal(o.rows.length,10);assert.equal(o.blocking,false);assert.equal(o.warnings.length,1);
});
test('a label-only data row under a one-line header is not folded',()=>{
  const o=parseOdds([page([mk([['Card',18],['HOBBY',328],['RETAIL',392]]),mk([['BASE CARDS',18]]),mk([['BASE',18],['1:1',340],['1:2',404]])])]);
  assert.deepEqual(o.formats,['HOBBY','RETAIL']);assert.equal(o.rows.length,1);assert.deepEqual(o.rows[0].odds,['1:1','1:2']);
  // Even an aligned upper-case label-only row is rejected without a matching data row.
  const o2=parseOdds([page([mk([['Card',18],['HOBBY',328],['RETAIL',392]]),mk([['BASE CARDS',340]]),mk([['BASE',18],['1:1',340],['1:2',404]])])]);
  assert.deepEqual(o2.formats,['HOBBY','RETAIL']);
});
test('existing wrapped header (SKU columns over channel qualifiers) still folds',()=>{
  const o=parseOdds([page([
    mk([['Card',18],['5313 - HOBBY PACK ODDS',300],['5314 - HOBBY PACK ODDS',420]]),
    mk([['HOBBY JUMBO',300],['DELIGHT BOX',420]]),
    mk([['BASE',18],['1:1',340],['1:2',460]])])]);
  assert.equal(o.formats.length,2);assert.equal(o.rows.length,1);assert.equal(o.warnings.length,0);
});
console.log(`${checks} header checks passed.`);
