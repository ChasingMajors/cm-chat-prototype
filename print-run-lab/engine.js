// Pure parsing and math; odds are normalized to expected hits per pack.
export const normalize = s => String(s).toLowerCase().replace(/autographs?/g,'auto').replace(/base cards/g,'base').replace(/[^a-z0-9]/g,'');
export function parseRatio(s) {
  if (/^\s*[-–—]\s*$/.test(s)) return null;
  const m=String(s).replaceAll(',','').match(/^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/);
  if (!m || +m[1]<=0 || +m[2]<=0) throw new Error(`Invalid odds: ${s}. Use 1:3500, 6:1, or -.`);
  return +m[1]/+m[2];
}
const CARD_ID=/^(\d+|[A-Za-z0-9]+-[A-Za-z0-9-]+)\s+(.+)/;
export function parseChecklist(pages) {
  const families=[]; const warnings=[]; let current=null; let orphans=0;
  // Flatten so headings can look ahead at the following rows: a numeric label
  // such as "92 FINEST" is a heading only when the rows beneath it are its
  // "92-N" subset cards; otherwise a numeric-led line is a card.
  const all=[]; for(const page of pages) for(const row of page.rows) all.push({text:row.text.trim(),page:page.number});
  for (let idx=0;idx<all.length;idx++) {
    const {text,page}=all[idx];
    if (/^(?:BASE|INSERTS?|AUTOGRAPHS?|RELICS?)$/.test(text)) {current=null;continue;}
    const card=text.match(CARD_ID);
    const upper=text.length<100 && /[A-Z]/.test(text) && text===text.toUpperCase() && !/CHECKLIST|TOPPS|CONTENTS|PROVIDED|CONFIGURATION/.test(text);
    // Decide heading vs card for an uppercase line that also parses as a card.
    let heading=upper;
    if (upper && card) {
      const numeric=/^(\d+)\s/.exec(text);
      if (numeric) {
        // Numeric-led uppercase line: a heading only if the next card-like rows
        // are its "<n>-..." subset. Otherwise it is a plain card (e.g.
        // "2 TOM BRADY PATRIOTS").
        const next=all.slice(idx+1,idx+4).map(r=>r.text).find(t=>CARD_ID.test(t));
        heading=!!next && new RegExp(`^${numeric[1]}-`).test(next);
      }
      // Non-numeric uppercase lines that parse as a card (rare) stay headings.
    }
    if (card && !heading) {
      if (!current) {orphans++;continue;}
      if (!current.cards.some(c=>c.id===card[1])) current.cards.push({id:card[1],description:card[2],page});
      continue;
    }
    if (heading) {
      current=families.find(f=>f.name===text);
      if (!current) {current={id:`f${families.length}`,name:text,cards:[],page};families.push(current);}
    }
  }
  const result=families.filter(f=>f.cards.length).map(f=>({...f,count:f.cards.length}));
  if (!result.length) warnings.push('No checklist sections found. Use the source text to review headings, or add sections manually. Scanned PDFs require OCR before upload.');
  else if (orphans) warnings.push(`${orphans} card row${orphans>1?'s':''} appeared before any recognized section heading and ${orphans>1?'were':'was'} not assigned. Review the extracted sections; a missed heading may merge or drop cards.`);
  return {families:result,warnings};
}
const ODDS_CELL=/^(?:\d[\d,]*(?:\.\d+)?:\d[\d,]*(?:\.\d+)?|[-–—])$/;
// Collapse whitespace-separated ratio fragments ("1 : 3,500") back into single
// cells, so PDF text fragmentation around the colon does not drop a row.
function joinOddsTokens(tokens) {
  const out=[];
  for(let i=0;i<tokens.length;i++) {
    let t=tokens[i];
    while(i+1<tokens.length && (/:$/.test(t) || tokens[i+1]===':' || /^:/.test(tokens[i+1]))) {t+=tokens[++i];}
    out.push(t);
  }
  return out;
}
// An odds table starts at a header row. Topps sheets use "Card", the plural
// "Cards", or "Component Description" as the row-label column, optionally
// followed by a "NumberedTo" serial-metadata column and the pack/box-odds
// columns.
const ODDS_HEADER=/^(?:Cards?|Component Description)\b/i;
// A single format label token that is actually metadata or a box-odds column,
// not an independent pack population.
const META_LABEL=/^numbered\s*to$/i;
const BOXODDS_LABEL=/\bbox\s*odds?\b/i;
const PACKODDS_LABEL=/\bpack\s*odds?\b/i;
// Group a header row's items into labelled columns by x-gap, then classify each
// column as a pack format, serial metadata, reference box odds, or the leading
// label column. Returns {formats, roles} where roles[i] is 'format' |
// 'numberedTo' | 'boxOdds' and aligns with the kept odds columns.
function headerColumns(items) {
  const parts=(items||[]).filter(i=>i.text.trim());
  const groups=[];
  for(const item of parts) {
    const prev=groups.at(-1);
    if(prev && item.x-prev.end<18) {prev.text+=' '+item.text;prev.end=item.x+item.width;}
    else groups.push({text:item.text.trim(),x:item.x,end:item.x+item.width});
  }
  // Drop the leading label column(s): everything up to and including the
  // Card/Cards/Component Description label.
  let start=0;
  for(let i=0;i<groups.length;i++){if(ODDS_HEADER.test(groups[i].text)){start=i+1;break;}}
  return groups.slice(start).map(g=>{
    // Clean SKU/catalog noise and the "PACK ODDS" suffix so a column reads as a
    // channel name: "5313 - HOBBY PACK ODDS" -> "HOBBY", "FGC006155 Hobby" ->
    // "Hobby". Preserve BOX/NumberedTo role detection on the raw text first.
    const raw=g.text;
    // Strip only a leading catalog identifier — a pure number ("5313"), a
    // number with a trailing "-" ("5313-"), or a letters+many-digits SKU
    // ("FGC006155") — plus the "PACK ODDS" suffix. Never strip ordinal/edition
    // qualifiers like "1st Edition" (an ordinal is digits + st/nd/rd/th), which
    // distinguish real formats.
    const CATALOG=/^(?:\d+\s*-\s*|\d+\s+(?=[A-Za-z])|[A-Za-z]{2,}\d{3,}\s*-?\s*)(?!(?:st|nd|rd|th)\b)/i;
    const label=raw.replace(CATALOG,'').replace(PACKODDS_LABEL,'').replace(BOXODDS_LABEL,'').replace(/\s+/g,' ').trim()||raw.trim();
    return {label,x:g.x,end:g.end,role:META_LABEL.test(raw)?'numberedTo':BOXODDS_LABEL.test(raw)?'boxOdds':'format'};
  });
}
export function parseOdds(pages) {
  let columns=[]; let formats=[]; const rows=[]; const warnings=[]; let blocking=false; const consumed=new Set();
  const warn=(text,block)=>{warnings.push(text);if(block)blocking=true;};
  const canonical=JSON.stringify.bind(JSON);
  for (let pi=0;pi<pages.length;pi++) { const page=pages[pi]; for (let ri=0;ri<page.rows.length;ri++) { const row=page.rows[ri];
    if (consumed.has(row)) continue; // a header-qualifier line already folded in
    if (ODDS_HEADER.test(row.text.trim())) {
      let cols=headerColumns(row.items);
      // Wrapped header: the channel qualifiers may sit on the next line
      // ("HOBBY JUMBO DELIGHT BOX BOX" under five SKU columns). When the
      // following row is label-only (no odds/dash cells) with one item per
      // format column, fold its words into each column's label, keeping a
      // distinguishing word from the first line so repeats stay unique.
      const next=page.rows[ri+1];
      const fmtCols=cols.filter(c=>c.role==='format');
      const quals=next&&next.items?next.items.filter(i=>i.text.trim()):[];
      const isQualLine=quals.length>=2 && !quals.some(i=>ODDS_CELL.test(i.text.trim())) && !ODDS_HEADER.test(next.text.trim());
      // A wrapped header carries the channel qualifiers on a second line
      // ("HOBBY JUMBO DELIGHT BOX BOX") under SKU/catalog columns. Only fold it
      // when there is positive evidence of a wrap, not when an ordinary
      // label-only data row (e.g. a "BASE CARDS" section line) happens to sit
      // below the header:
      //  - the first header's format labels look like catalog noise (contain a
      //    digit) or the gap heuristic under-segmented them (fewer than the
      //    qualifier count), AND
      //  - the qualifier items sit under the header's column span (aligned to
      //    the right of the leading label column), not at the left margin.
      const headerSpanStart=fmtCols.length?Math.min(...fmtCols.map(c=>c.x)):Infinity;
      // Line 1 is catalog noise (not channel names) when its labels carry digits
      // or look like hyphenated SKU codes, or when the gap heuristic produced
      // fewer columns than the qualifier line.
      const noisy=fmtCols.some(c=>/\d/.test(c.label)||/^[A-Z]+-[A-Z0-9-]+$/i.test(c.label)) || quals.length>fmtCols.length;
      const aligned=quals.every(q=>q.x>=headerSpanStart-40);
      if(isQualLine && noisy && aligned && quals.length>=fmtCols.length) {
        cols=quals.map(q=>({label:q.text.trim(),x:q.x,end:q.x+q.width,role:META_LABEL.test(q.text)?'numberedTo':BOXODDS_LABEL.test(q.text)?'boxOdds':'format'}));
        consumed.add(next);
      }
      const detectedFormats=cols.filter(c=>c.role==='format').map(c=>c.label);
      if(!detectedFormats.length) continue; // a label-only wrap line; ignore.
      if(!formats.length) {
        columns=cols;formats=detectedFormats;
        // Duplicate names are not recorded in `blocking` (a mapping flag):
        // calculate() re-checks duplicates live, so renaming a column to a
        // unique name resolves them without clearing a real mapping block.
        const dup=detectedFormats.filter((f,i)=>detectedFormats.indexOf(f)!==i);
        if(dup.length)warn(`Page ${page.number}: duplicate pack-format heading${dup.length>1?'s':''} (${[...new Set(dup)].join(', ')}). Rename the columns so each format is distinct; estimates are blocked until resolved.`,false);
      } else if(canonical(formats)!==canonical(detectedFormats)) {
        const sameSet=detectedFormats.length===formats.length && [...detectedFormats].sort().join('\u0001')===[...formats].sort().join('\u0001');
        if(sameSet) {columns=cols;page._oddsOrder=detectedFormats;warn(`Page ${page.number}: format columns are in a different order than the first header (${detectedFormats.join(', ')}); cells were re-mapped to the detected formats. Verify the columns.`,false);}
        else warn(`Page ${page.number}: format headings differ from the first header (${detectedFormats.join(', ') || 'none'}). Column mapping is ambiguous; estimates are blocked until the odds table is corrected.`,true);
      } else {
        // Identical format names repeated: refresh the active column roles (a
        // later header may add/move a NumberedTo or box-odds column) and return
        // to canonical order so later rows map correctly.
        columns=cols;delete page._oddsOrder;
      }
      continue;
    }
    if(!formats.length) continue;
    const order=page._oddsOrder||formats;
    let tokens=joinOddsTokens(row.text.trim().split(/\s+/));
    // Pull trailing odds/dash cells off the end.
    const trailing=[];
    while(tokens.length && ODDS_CELL.test(tokens.at(-1))) trailing.unshift(tokens.pop());
    // If the header declared a NumberedTo column, the row may carry a bare
    // integer serial between the name and the odds cells. Pull it off the end
    // of the remaining name tokens when present.
    let serial=/super\s*fractor/i.test(row.text)?1:null;
    const hasNumberedTo=columns.some(c=>c.role==='numberedTo');
    if(hasNumberedTo && tokens.length && /^\d{1,7}$/.test(tokens.at(-1))) {serial=Number(tokens.pop());}
    const name=tokens.join(' ');
    // Split trailing cells by the declared column roles IN ORDER, so a box-odds
    // column that precedes the pack column is not mistaken for pack odds. The
    // trailing cells correspond left-to-right to the non-metadata columns
    // (format and boxOdds); NumberedTo is read separately above.
    const cellCols=columns.filter(c=>c.role==='format'||c.role==='boxOdds');
    const oddsCols=columns.filter(c=>c.role==='format');
    let odds=trailing, referenceBoxOdds;
    if(columns.some(c=>c.role==='boxOdds')) {
      if(trailing.length===cellCols.length) {
        odds=[];referenceBoxOdds=[];
        cellCols.forEach((c,i)=>{(c.role==='format'?odds:referenceBoxOdds).push(trailing[i]);});
      } else {
        // Cell count does not match the declared columns: do not guess a split.
        warn(`Page ${page.number}: could not align pack/box odds for “${row.text}” (${trailing.length} of ${cellCols.length} columns).`,false);
        continue;
      }
    }
    if(!odds.length) {
      if(name && /(?:\d[\d,]*\s*:\s*\d|[-–—])\s*$/.test(row.text)) warn(`Page ${page.number}: could not read odds for “${row.text}”; row skipped.`,false);
      continue;
    }
    if(odds.length!==order.length) {warn(`Page ${page.number}: could not align odds for “${row.text}” (${odds.length} of ${order.length} columns).`,false);continue;}
    const canonicalOdds=order===formats?odds:formats.map(f=>odds[order.indexOf(f)]);
    const rec={id:`o${rows.length}`,name,odds:canonicalOdds,formatPages:page.number,familyId:'',eligible:null,serial,anchor:serial!==null,page:page.number};
    if(referenceBoxOdds&&referenceBoxOdds.length)rec.referenceBoxOdds=referenceBoxOdds;
    rows.push(rec);
  } }
  if(!formats.length) warn('No format headings detected. Expected a Card, Cards, or Component Description header followed by pack-format columns. Review source text; scanned PDFs require OCR.',false);
  return {formats,rows,warnings,blocking};
}
export function matchFamilies(rows,families) {
  // Tokenize on the normalized string but keep word boundaries, so a family
  // name matches a row only when its whole words are a leading run of the row's
  // words ("Base Common Refractor" matches "Base Common", but "The Manifold
  // Superfractor" does NOT match "The Man").
  const toks=s=>normalize(s).length?normalizeTokens(s):[];
  const sorted=[...families].map(f=>({f,t:toks(f.name)})).filter(x=>x.t.length).sort((a,b)=>b.t.length-a.t.length);
  return rows.map(r=>{
    const rt=toks(r.name);
    const hit=sorted.find(({t})=>t.length<=rt.length && t.every((w,i)=>w===rt[i]));
    return {...r,familyId:hit?.f.id||''};
  });
}
// Normalize while preserving word boundaries: apply the same autograph/base
// rewrites as normalize(), then split into alphanumeric word tokens.
function normalizeTokens(s){
  return String(s).toLowerCase().replace(/autographs?/g,'auto').replace(/base cards/g,'base').split(/[^a-z0-9]+/).filter(Boolean);
}
// Numerical rank of a matrix via Gauss-Jordan with partial pivoting and a
// column-scaled relative pivot tolerance (so the threshold is not tied to the
// raw magnitude of the entries).
function rank(matrix) {
  const a=matrix.map(r=>[...r]);if(!a.length||!a[0].length)return 0;
  const scale=a[0].map((_,j)=>Math.max(1e-300,...a.map(r=>Math.abs(r[j]))));
  let k=0;
  for(let j=0;j<a[0].length;j++) {
    let p=k;for(let i=k;i<a.length;i++)if(Math.abs(a[i][j])>Math.abs(a[p]?.[j]||0))p=i;
    if(Math.abs(a[p]?.[j]||0)/scale[j]<1e-7)continue;
    [a[k],a[p]]=[a[p],a[k]];const v=a[k][j];a[k]=a[k].map(x=>x/v);
    for(let i=0;i<a.length;i++){if(i===k)continue;const q=a[i][j];a[i]=a[i].map((x,c)=>x-q*a[k][c]);} k++;
    if(k===a.length)break;
  }return k;
}
// Solve a square system m x = v by Gauss elimination with partial pivoting.
// Returns {x, singular} where singular is true when the matrix is effectively
// rank deficient (small scaled pivot), in which case x is not trustworthy.
function solveLinear(m,v) {
  const n=v.length;if(!n)return {x:[],singular:false};
  const a=m.map((r,i)=>[...r,v[i]]);
  const scale=a.map(r=>Math.max(1e-300,...r.slice(0,n).map(Math.abs)));
  for(let col=0;col<n;col++) {
    let p=col;for(let i=col+1;i<n;i++)if(Math.abs(a[i][col])/scale[i]>Math.abs(a[p][col])/scale[p])p=i;
    if(Math.abs(a[p][col])/scale[p]<1e-12)return {x:new Array(n).fill(0),singular:true};
    [a[col],a[p]]=[a[p],a[col]];[scale[col],scale[p]]=[scale[p],scale[col]];
    for(let i=0;i<n;i++){if(i===col)continue;const f=a[i][col]/a[col][col];for(let c=col;c<=n;c++)a[i][c]-=f*a[col][c];}
  }
  return {x:a.map((r,i)=>r[n]/r[i]),singular:false};
}
// Nonnegative least squares via the Lawson-Hanson active-set method, solving the
// normal equations of the active set with a direct linear solver each step.
// Returns {x, converged}. converged is false if the iteration cap is reached or
// an active-set solve is singular.
function nnls(A,b) {
  const n=A[0]?.length||0;if(!n)return {x:[],converged:true};
  const x=new Array(n).fill(0);const passive=new Array(n).fill(false);
  const AtA=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>A.reduce((s,r)=>s+r[i]*r[j],0)));
  const Atb=Array.from({length:n},(_,i)=>A.reduce((s,r,k)=>s+r[i]*b[k],0));
  const grad=()=>Atb.map((g,i)=>g-AtA[i].reduce((s,v,j)=>s+v*x[j],0));
  const maxOuter=10*n+30;
  for(let outer=0;outer<maxOuter;outer++) {
    const w=grad();
    let t=-1,best=1e-9;for(let i=0;i<n;i++)if(!passive[i]&&w[i]>best){best=w[i];t=i;}
    if(t<0)return {x,converged:true};
    passive[t]=true;
    for(let inner=0;inner<4*n+10;inner++) {
      const idx=[];for(let i=0;i<n;i++)if(passive[i])idx.push(i);
      const sub=idx.map(i=>idx.map(j=>AtA[i][j]));
      const {x:z,singular}=solveLinear(sub,idx.map(i=>Atb[i]));
      if(singular)return {x,converged:false};
      if(idx.every((i,k)=>z[k]>1e-12)) {idx.forEach((i,k)=>x[i]=z[k]);break;}
      let alpha=Infinity;for(let k=0;k<idx.length;k++)if(z[k]<=1e-12){const i=idx[k];const r=x[i]/(x[i]-z[k]);if(r<alpha)alpha=r;}
      if(!Number.isFinite(alpha))return {x,converged:false};
      idx.forEach((i,k)=>x[i]=x[i]+alpha*(z[k]-x[i]));
      for(let i=0;i<n;i++)if(passive[i]&&x[i]<=1e-12){x[i]=0;passive[i]=false;}
    }
  }
  return {x,converged:false};
}
// Eigenvalues of a small symmetric matrix via the cyclic Jacobi method. Used to
// estimate the 2-norm condition number of the anchor system (sqrt of the ratio
// of largest to smallest eigenvalue of AtA).
function symEigenvalues(M) {
  const n=M.length;if(!n)return [];if(n===1)return [M[0][0]];
  const a=M.map(r=>[...r]);
  for(let sweep=0;sweep<100;sweep++) {
    let off=0;for(let p=0;p<n;p++)for(let q=p+1;q<n;q++)off+=a[p][q]*a[p][q];
    if(off<1e-24)break;
    for(let p=0;p<n;p++)for(let q=p+1;q<n;q++) {
      if(Math.abs(a[p][q])<1e-300)continue;
      const theta=(a[q][q]-a[p][p])/(2*a[p][q]);
      const t=Math.sign(theta||1)/(Math.abs(theta)+Math.sqrt(theta*theta+1));
      const c=1/Math.sqrt(t*t+1),s=t*c;
      for(let k=0;k<n;k++){const akp=a[k][p],akq=a[k][q];a[k][p]=c*akp-s*akq;a[k][q]=s*akp+c*akq;}
      for(let k=0;k<n;k++){const apk=a[p][k],aqk=a[q][k];a[p][k]=c*apk-s*aqk;a[q][k]=s*apk+c*aqk;}
    }
  }
  return a.map((r,i)=>r[i]);
}
// Relative influence defaults are editable heuristics, not confidence probabilities.
export function anchorProfile(row,family) {
  const name=`${row.name} ${family?.name||''}`;
  const limited=/\b(?:auto(?:graphs?)?|relics?|memorabilia|patch(?:es)?|swatch(?:es)?|jerseys?|signatures?)\b/i.test(name);
  const kind=limited?'Autograph / memorabilia':/^base\b/i.test(row.name)||/^base\b/i.test(family?.name||'')?'Base':'Insert';
  return {kind,defaultWeight:limited?1:10,reason:limited?'Checklist membership can vary by parallel; signing and memorabilia availability may be incomplete.':'Higher starting weight for ordinary printed cards; published odds can still be wrong.'};
}
// Column and right-hand-side scaling makes the existing active-set solver's
// tolerances independent of physical pack magnitudes. Condition measures angles,
// rather than differences in the production scale of independent formats.
function solveWeighted(a,b,weights) {
  const n=a[0]?.length||0;
  if(!n)return {x:[],converged:true,conditioning:0};
  const weighted=a.map((r,i)=>r.map(v=>v*Math.sqrt(weights[i])));
  const rhs=b.map((v,i)=>v*Math.sqrt(weights[i]));
  const norms=Array.from({length:n},(_,j)=>Math.hypot(...weighted.map(r=>r[j])));
  if(norms.some(v=>!Number.isFinite(v)||v===0))return {x:[],converged:false,conditioning:Infinity};
  const A=weighted.map(r=>r.map((v,j)=>v/norms[j]));
  const rhsNorm=Math.max(...rhs.map(Math.abs),1e-300);
  const B=rhs.map(v=>v/rhsNorm);
  const gram=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>A.reduce((sum,r)=>sum+r[i]*r[j],0)));
  const eig=symEigenvalues(gram);const min=Math.min(...eig),max=Math.max(...eig);
  const conditioning=min>0?Math.sqrt(max/min):Infinity;
  const sol=nnls(A,B);
  const x=sol.x.map((v,j)=>v*rhsNorm/norms[j]);
  return {x,converged:sol.converged&&x.every(v=>Number.isFinite(v)&&v>=0),conditioning};
}
export function calculate(project) {
  const {formats,families,rows}=project;const errors=[],rowIssues=[],candidates=[];
  // Duplicate format names are always a blocking mapping problem, re-checked
  // live so renaming a column to a unique name resolves it and a restored
  // project with duplicates cannot slip through with oddsBlocking=false.
  const dupFormats=[...new Set(formats.filter((f,i)=>formats.indexOf(f)!==i))];
  if(dupFormats.length)errors.push(`Duplicate pack-format name${dupFormats.length>1?'s':''} (${dupFormats.join(', ')}). Rename the columns so each format is distinct.`);
  if(project.oddsBlocking)errors.push('Pack-format columns need correction before they can be used. This is a column-mapping issue, not disagreement between numbered anchors.');
  for(const row of rows) {
    row._issue=null;
    try {
      const rates=row.odds.map(parseRatio);
      if(rates.length!==formats.length)throw Error('Wrong number of format columns');
      // Hit rates must be finite, positive, and within a sane range so that a
      // rate x pack-total product cannot overflow to a non-finite estimate.
      if(rates.some(v=>v!==null&&(!Number.isFinite(v)||v<=0||v>1e9)))throw Error('Odds must give a finite positive hit rate');
      row._rates=rates;
      const family=families.find(f=>f.id===row.familyId),count=row.eligible??family?.count;
      const profile=anchorProfile(row,family);
      const weight=row.weight??profile.defaultWeight;
      if(!Number.isFinite(weight)||weight<0||weight>1000)throw Error('Anchor weight must be between 0 and 1000');
      // Serial and eligible counts must be physically plausible integers so a
      // pool total (count x serial) stays finite and meaningful.
      if(row.serial!=null&&(!Number.isSafeInteger(row.serial)||row.serial<=0||row.serial>1e7))throw Error('Copies per card must be a whole number between 1 and 10,000,000');
      if(count!=null&&(!Number.isSafeInteger(count)||count<=0||count>1e7))throw Error('Eligible card count must be a whole number between 1 and 10,000,000');
      if(row.serial>0 && count>0 && rates.some(v=>v>0)){
        const total=count*row.serial;
        if(!Number.isFinite(total)||total<=0)throw Error('Pool total (eligible x copies) is not a finite positive number');
        candidates.push({id:row.id,name:row.name,count,serial:row.serial,total,rates,...profile,weight,enabled:row.anchor===true&&weight>0});
      }
    }catch(e){row._rates=null;row._issue=e.message;rowIssues.push(`${row.name}: ${e.message}`);}
  }
  for(const r of candidates) {
    const row=rows.find(row=>row.id===r.id);
    const denominators=row.odds.filter(o=>!/^\s*[-–—]\s*$/.test(o)).map(o=>Number(o.replaceAll(',','').split(':')[1]));
    r.precisionFactor=project.roundingWeights===false?1:Math.min(1,(Math.min(...denominators)/20)**2);
    r.priorWeight=r.weight*r.precisionFactor;
  }
  const anchors=candidates.filter(r=>r.enabled);
  const fixed=formats.map((_,i)=>project.packTotals?.[i]);
  const unknown=formats.map((_,i)=>i).filter(i=>fixed[i]===null||fixed[i]===undefined||fixed[i]==='');
  const packTotals=fixed.map(x=>x===null||x===undefined||x===''?0:Number(x));
  if(packTotals.some(x=>!Number.isFinite(x)||x<0))errors.push('Pack totals must be nonnegative finite numbers.');
  const a=anchors.map(r=>unknown.map(i=>(r.rates[i]||0)*100000/r.total));
  const b=anchors.map(r=>1-r.rates.reduce((sum,v,i)=>sum+(unknown.includes(i)?0:(v||0)*packTotals[i]/r.total),0));
  const fullRank=formats.length>0 && rank(a)===unknown.length;
  let converged=unknown.length===0,conditioning=unknown.length?Infinity:0;
  let weights=anchors.map(r=>r.priorWeight),robustConverged=true;
  // Huber relative-error fit: beyond 20% disagreement an anchor's influence
  // decreases smoothly. Never rewrite the source odds or silently delete a row.
  const robust=project.robustWeights!==false;
  if(fullRank && unknown.length && !errors.length) {
    let previous=null;
    for(let pass=0;pass<(robust?400:1);pass++) {
      const sol=solveWeighted(a,b,weights);converged=sol.converged;conditioning=sol.conditioning;
      if(!converged)break;
      unknown.forEach((i,j)=>packTotals[i]=sol.x[j]*100000);
      const next=anchors.map(r=>{
        const predicted=r.rates.reduce((sum,v,i)=>sum+(v||0)*packTotals[i],0);
        const error=Math.abs(predicted-r.total)/r.total;
        return r.priorWeight*(robust?Math.min(1,0.2/Math.max(error,1e-300)):1);
      });
      if(!robust)break;
      const change=previous?Math.max(...sol.x.map((v,j)=>Math.abs(v-previous[j])/Math.max(1,Math.abs(v)))):Infinity;
      const weightChange=Math.max(...weights.map((w,i)=>Math.abs(next[i]-w)/Math.max(w,1e-300)));
      if(change<1e-7&&weightChange<1e-6)break;
      if(pass===399){robustConverged=false;break;}
      previous=sol.x;weights=next;
    }
  }
  const wellConditioned=conditioning<=1000;
  const identifiable=fullRank;
  // Evidence disagreements are reported, never used as a switch hiding results.
  const hasEstimate=identifiable&&converged&&!errors.length&&packTotals.every(Number.isFinite);
  const diagnostics=candidates.map(r=>{
    const index=anchors.findIndex(a=>a.id===r.id);
    const effectiveWeight=index>=0?weights[index]:0;
    const rawPredicted=hasEstimate?r.rates.reduce((sum,v,i)=>sum+(v||0)*packTotals[i],0):null;
    // Never let a non-finite predicted value become a NaN discrepancy that then
    // slips past the >5% check as if it agreed.
    const predicted=rawPredicted!==null&&Number.isFinite(rawPredicted)?rawPredicted:null;
    const error=predicted===null?null:Math.abs(predicted-r.total)/r.total;
    return {...r,effectiveWeight,downweighted:r.enabled&&effectiveWeight<r.weight*0.99,predicted,error:Number.isFinite(error)?error:null,impliedEligible:predicted===null?null:predicted/r.serial};
  });
  const conflicts=diagnostics.filter(r=>r.enabled&&r.error!==null&&r.error>0.05);
  // Rows whose derived value could not be computed (non-finite) must not be read
  // as agreement. Track them by id so an anchor that is also a result row is
  // counted once.
  const derivedIssueIds=new Set(diagnostics.filter(r=>r.enabled&&r.error===null&&hasEstimate).map(r=>r.id));
  const assumptions='Base and ordinary insert anchors start at weight 10; autograph/memorabilia anchors at 1. Weights are editable heuristics. '+(project.roundingWeights===false?'Coarse-odds precision adjustment is off. ':'Coarse odds use precision factor min(1,(smallest printed denominator/20)^2). ')+(robust?'Huber weighting reduces influence beyond 20% relative disagreement. ':'Automatic outlier weighting is off. ');
  const results=rows.map(row=>{
    const family=families.find(f=>f.id===row.familyId),count=row.eligible??family?.count;
    let byFormat=hasEstimate&&row._rates?row._rates.map((v,i)=>v===null?0:v*packTotals[i]):null;
    let total=byFormat?.reduce((sum,v)=>sum+v,0)??null;
    // A derived copy count that is not finite is reported as an issue rather
    // than displayed; it never becomes an estimate.
    let issue=row._issue;
    if(byFormat&&(byFormat.some(v=>!Number.isFinite(v))||!Number.isFinite(total))){byFormat=null;total=null;derivedIssueIds.add(row.id);if(!issue)issue='Estimated copies are not a finite number for this row; check its odds, copies, and eligible count.';}
    const perCard=total!==null&&count>0?total/count:null;
    const profile=anchorProfile(row,family);
    return {id:row.id,name:row.name,family:family?.name||'Unmatched',familyId:row.familyId,count,serial:row.serial,byFormat,total,perCard:Number.isFinite(perCard)?perCard:null,page:row.page,kind:profile.kind,issue};
  });
  // A derived-value failure (anchor or any result row) is an unresolved issue:
  // it forces the provisional state and is never read as "anchors agree".
  const derivedIssues=derivedIssueIds.size;
  const provisional=hasEstimate&&(conflicts.length>0||!wellConditioned||!robustConverged||rowIssues.length>0||derivedIssues>0);
  const formatChecks=formats.map((format,i)=>{
    const config=project.formatConfigs&&Object.hasOwn(project.formatConfigs,format)?project.formatConfigs[format]:{};
    const expectedCards=rows.reduce((sum,row)=>sum+(row._rates?.[i]||0),0);
    // A format solved to ~0 while anchors reference it is a nonnegative-boundary
    // allocation (the sources don't pin it), not proof the format has no cards.
    const referenced=unknown.includes(i)&&anchors.some(r=>(r.rates[i]||0)>0);
    const boundaryZero=hasEstimate&&unknown.includes(i)&&referenced&&packTotals[i]<=1e-6;
    return {format,cardsPerPack:config.cardsPerPack??null,packsPerBox:config.packsPerBox??null,boxes:hasEstimate&&config.packsPerBox>0&&Number.isFinite(packTotals[i])?packTotals[i]/config.packsPerBox:null,listedCardsPerPack:expectedCards,source:config.source||'',boundaryZero};
  });
  return {formatChecks,packTotals:hasEstimate?packTotals:null,identifiable,fullRank,wellConditioned,converged,conditioning,valid:hasEstimate,hasEstimate,diagnostics,conflicts,errors,rowIssues,derivedIssues,results,scenario:provisional,provisional,robustConverged,assumptions,usedAnchors:anchors.length};
}
export function csv(rows) {return rows.map(r=>r.map(v=>{const s=String(v??'');return '"'+(/^[\s]*[=+@\-]/.test(s)?"'":'')+s.replaceAll('"','""')+'"';}).join(',')).join('\r\n');}
