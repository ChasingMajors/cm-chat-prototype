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
  // Track the PDF's current type section (BASE / INSERT / AUTOGRAPH / RELIC).
  // This is the authoritative source for an anchor's influence class: a family
  // listed under AUTOGRAPH is treated as a signature family even when its name
  // lacks an autograph keyword (e.g. "Italics").
  let section=null;
  const SECTION_KIND={BASE:'Base',INSERT:'Insert',INSERTS:'Insert',AUTOGRAPH:'Autograph / memorabilia',AUTOGRAPHS:'Autograph / memorabilia',RELIC:'Autograph / memorabilia',RELICS:'Autograph / memorabilia','AUTOGRAPH RELIC':'Autograph / memorabilia'};
  // Flatten so headings can look ahead at the following rows: a numeric label
  // such as "92 FINEST" is a heading only when the rows beneath it are its
  // "92-N" subset cards; otherwise a numeric-led line is a card.
  const all=[]; for(const page of pages) for(const row of page.rows) all.push({text:row.text.trim(),page:page.number});
  for (let idx=0;idx<all.length;idx++) {
    const {text,page}=all[idx];
    const sectionMatch=/^(BASE|INSERTS?|AUTOGRAPHS?|RELICS?|AUTOGRAPH RELIC)$/.exec(text);
    if (sectionMatch) {current=null;section=SECTION_KIND[sectionMatch[1]]||null;continue;}
    const card=text.match(CARD_ID);
    // A short all-caps line is a heading. Disclaimer/boilerplate prose is
    // excluded. Disclaimer prose ("Checklists provided by Topps...") is mixed
    // case and so already fails the all-caps test below; a genuine all-caps
    // section name that happens to contain TOPPS ("TOPPS TRIBUTE", "TOPPS
    // CHROME ULTRAVIOLET ALL STARS AUTOGRAPHS") is NOT excluded.
    const boilerplate=/\b(?:CHECKLIST|CONTENTS|PROVIDED|CONFIGURATION)\b/.test(text);
    const upper=text.length<100 && /[A-Z]/.test(text) && text===text.toUpperCase() && !boilerplate;
    // Decide heading vs card for an uppercase line that also parses as a card.
    let heading=upper;
    if (upper && card) {
      const numeric=/^(\d+)\s/.exec(text);
      if (numeric) {
        // Numeric-led uppercase line: decide heading vs card from the following
        // card rows. It is a HEADING when the next card IDs are its "<n>-..."
        // subset (e.g. "92 FINEST" -> "92-1") OR use a letter-led dash prefix
        // (e.g. "1993 FINEST PROTOTYPES..." -> "93A-AP"). It is a CARD only when
        // the next rows continue a plain numeric list (e.g. "2 TOM BRADY" sits
        // between "1 ..." and "3 ...").
        // Look only at rows immediately beneath this line, stopping at the next
        // section line or any other heading — a dash-ID that belongs to a
        // DIFFERENT family further down must not promote this numbered card.
        let nextId=null;
        for(let j=idx+1;j<all.length && j<=idx+3;j++){
          const t=all[j].text;
          if(/^(?:BASE|INSERTS?|AUTOGRAPHS?|RELICS?|AUTOGRAPH RELIC)$/.test(t))break; // section boundary
          const m=CARD_ID.exec(t);
          if(m){nextId=m[1];break;}
          // A short all-caps non-card line beneath is a new heading: stop.
          if(t.length<100 && /[A-Z]/.test(t) && t===t.toUpperCase())break;
        }
        // A dash-form subset ID ("92-1", "93A-AP", "FMA-AJ") directly beneath
        // marks a heading; a plain integer ID ("3") means the numeric line is
        // itself a card in a running list.
        heading=!!nextId && /-/.test(nextId);
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
      if (!current) {current={id:`f${families.length}`,name:text,cards:[],page,sectionKind:section};families.push(current);}
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
export function matchFamilies(rows,families,aliases) {
  // Tokenize on the normalized string but keep word boundaries, so a family
  // name matches a row only when its whole words are a leading run of the row's
  // words ("Base Common Refractor" matches "Base Common", but "The Manifold
  // Superfractor" does NOT match "The Man").
  const toks=s=>normalize(s).length?normalizeTokens(s):[];
  const withToks=[...families].map(f=>({f,t:toks(f.name)})).filter(x=>x.t.length);
  const sorted=[...withToks].sort((a,b)=>b.t.length-a.t.length);
  // Explicit user aliases map an odds-name prefix to a stable family ID; they
  // take priority over automatic matching. Each is {from, to} where `to` is a
  // family id. A legacy alias whose `to` is a family name (not an id) is still
  // honored by resolving the name to its current id.
  const idSet=new Set(families.map(f=>f.id));
  const aliasList=(aliases||[]).map(a=>({from:toks(a.from),to:idSet.has(a.to)?a.to:(families.find(f=>f.name===a.to)?.id||a.to)})).filter(a=>a.from.length);
  return rows.map(r=>{
    // A manually assigned row is never re-matched automatically; the user's
    // choice (including an explicit alias edit elsewhere) is preserved.
    if(r.familyIdManual && families.some(f=>f.id===r.familyId))return {...r,ambiguous:false};
    const rt=toks(r.name);
    // 1. Explicit alias: the alias's from-words are a leading run of the row.
    //    The most specific (longest matching prefix) alias wins, so a general
    //    alias does not shadow a more specific one regardless of add order.
    const alias=aliasList.filter(a=>a.from.length<=rt.length && a.from.every((w,i)=>w===rt[i])).sort((x,y)=>y.from.length-x.from.length)[0];
    if(alias){const fam=families.find(f=>f.id===alias.to);if(fam)return {...r,familyId:fam.id,ambiguous:false};}
    // 2. Automatic match. A family matches when its whole words are a leading
    //    run of the row (ordered prefix) or the same set in any order ("Base
    //    Cards Common" vs "Base Common Cards"). Collect every such family, then
    //    require a UNIQUE longest match: if two or more distinct families tie at
    //    the best length (e.g. identical normalized names), leave the row
    //    unmatched and flag it for review rather than silently picking one.
    const hits=withToks.filter(({t})=>{
      if(t.length>rt.length)return false;
      const lead=rt.slice(0,t.length);
      const ordered=t.every((w,i)=>w===lead[i]);
      const sameSet=t.every(w=>lead.includes(w)) && lead.every(w=>t.includes(w));
      return ordered||sameSet;
    });
    if(hits.length){
      const maxLen=Math.max(...hits.map(x=>x.t.length));
      const top=hits.filter(x=>x.t.length===maxLen);
      const ids=new Set(top.map(x=>x.f.id));
      if(ids.size===1)return {...r,familyId:top[0].f.id,ambiguous:false};
      return {...r,familyId:'',ambiguous:true};
    }
    return {...r,familyId:'',ambiguous:false};
  });
}
// Normalize while preserving word boundaries: apply the autograph/base rewrites,
// drop the filler word "cards" (so "Base Common Cards" and "Base Cards Common"
// both reduce to [base, common]), then split into alphanumeric word tokens.
function normalizeTokens(s){
  return String(s).toLowerCase().replace(/autographs?/g,'auto').replace(/base cards/g,'base').replace(/\bcards\b/g,' ').split(/[^a-z0-9]+/).filter(Boolean);
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
  // The family's PDF section (sectionKind, from the checklist parser) is the
  // authoritative class. A name keyword can only ESCALATE to the limited class
  // (a "Base Autograph" is still signed); it never downgrades a family the PDF
  // placed under AUTOGRAPH/RELIC. When no section is known, fall back to the
  // name-based heuristic.
  const nameLimited=/\b(?:auto(?:graphs?)?|relics?|memorabilia|patch(?:es)?|swatch(?:es)?|jerseys?|signatures?)\b/i.test(name);
  const sectionKind=family?.sectionKind;
  const limited=sectionKind==='Autograph / memorabilia'||nameLimited;
  let kind,source;
  if(limited){kind='Autograph / memorabilia';source=sectionKind==='Autograph / memorabilia'?'section':'name';}
  else if(sectionKind==='Base'||sectionKind==='Insert'){kind=sectionKind;source='section';} // a known ordinary section controls the class
  else {kind=/^base\b/i.test(row.name)||/^base\b/i.test(family?.name||'')?'Base':'Insert';source='heuristic';} // no section info: name heuristic
  return {kind,defaultWeight:limited?1:10,source,reason:limited?(source==='section'?'The checklist lists this family under an autograph/relic section; membership can vary by parallel.':'Checklist membership can vary by parallel; signing and memorabilia availability may be incomplete.'):'Higher starting weight for ordinary printed cards; published odds can still be wrong.'};
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
    r.precisionFactor=project.roundingWeights===true?Math.min(1,(Math.min(...denominators)/20)**2):1;
    r.priorWeight=r.weight*r.precisionFactor;
  }
  const anchors=candidates.filter(r=>r.enabled);
  const fixed=formats.map((_,i)=>project.packTotals?.[i]);
  const unknown=formats.map((_,i)=>i).filter(i=>fixed[i]===null||fixed[i]===undefined||fixed[i]==='');
  const packTotals=fixed.map(x=>x===null||x===undefined||x===''?0:Number(x));
  if(packTotals.some(x=>!Number.isFinite(x)||x<0))errors.push('Pack totals must be nonnegative finite numbers.');
  // Each enabled anchor implies, for an UNKNOWN format i it appears in, a Total
  // Packs value. For a pool total `total = subjects*serial`, the anchor equation
  // is sum_f(packs_f * rate_f) = total. Copies already supplied by any FIXED
  // format are subtracted first, so the residual for format i is
  //   packs_i = (total - sum_{fixed f}(packs_f * rate_f)) / rate_i
  // For a single-format (or purely format-exclusive) anchor this reduces to
  // total / rate_i = subjects*serial*N — the owner's hand formula.
  // packImplications[formatIndex] = sorted {id,name,packs} from its anchors.
  const fixedPacks=i=>(project.packTotals?.[i]===null||project.packTotals?.[i]===undefined||project.packTotals?.[i]==='')?null:Number(project.packTotals[i]);
  // Anchors whose implied packs for a format come out non-finite or negative
  // (e.g. fixed-format contribution exceeds the nominal pool) are recorded as
  // issues and kept out of the median rather than poisoning it.
  // Implications are only meaningful for UNKNOWN formats (the median targets).
  // A FIXED format is not being solved, so its "implied packs" is not an
  // estimate and an infeasibility there must not flag the anchor as excluded.
  // Fixed-format slots are therefore left empty and never feed implicationIssues.
  const implicationIssues=new Set();
  const packImplications=formats.map((_,i)=>unknown.includes(i)?anchors
    .filter(r=>(r.rates[i]||0)>0)
    .map(r=>{
      const fixedContribution=r.rates.reduce((s,v,f)=>{const fp=fixedPacks(f);return s+(f!==i&&fp!==null&&v?v*fp:0);},0);
      const packs=(r.total-fixedContribution)/r.rates[i];
      return {id:r.id,name:r.name,weight:r.priorWeight,packs};
    })
    .filter(p=>{if(Number.isFinite(p.packs)&&p.packs>=0)return true;implicationIssues.add(p.id);return false;})
    .sort((x,y)=>x.packs-y.packs):[]);
  // Overflow-safe midpoint: a+(b-a)/2 avoids (a+b) overflowing to Infinity.
  const mid2=(a,b)=>a+(b-a)/2;
  const median=arr=>arr.length?(arr.length%2?arr[(arr.length-1)/2]:mid2(arr[arr.length/2-1],arr[arr.length/2])):null;
  // Weighted median: honors the base/insert>auto influence policy and manual
  // downweighting, so a cluster of low-weight autograph anchors cannot outvote
  // higher-weight base anchors. Falls back to the plain median when all weights
  // are equal. Each item is {packs, weight}.
  const weightedMedian=items=>{
    if(!items.length)return null;
    const tot=items.reduce((s,it)=>s+(it.weight>0?it.weight:0),0);
    if(!(tot>0))return median(items.map(it=>it.packs)); // no positive weights: equal vote
    let acc=0;const half=tot/2;
    for(let k=0;k<items.length;k++){acc+=items[k].weight>0?items[k].weight:0;
      if(acc>half)return items[k].packs;
      if(acc===half)return k+1<items.length?mid2(items[k].packs,items[k+1].packs):items[k].packs;}
    return items.at(-1).packs;
  };
  // Normalized anchor matrix for the experimental solver and the rank check.
  const a=anchors.map(r=>unknown.map(i=>(r.rates[i]||0)*100000/r.total));
  const b=anchors.map(r=>1-r.rates.reduce((sum,v,i)=>sum+(unknown.includes(i)?0:(v||0)*packTotals[i]/r.total),0));

  // --- DEFAULT MODEL (owner's bottom-up serial-anchor method) ---------------
  // For each unknown format, Total Packs = MEDIAN of its anchors' implied packs.
  // This is the owner's hand method and matches the production PRV pipeline. It
  // applies when every unknown format has at least one participating anchor and
  // the anchors are not genuinely coupled across formats (a single anchor row
  // spanning multiple unknown formats cannot be split into per-format packs by
  // median alone — that is the experimental solver's job).
  const experimental=project.method==='experimental'||project.robustWeights===true||project.roundingWeights===true;
  const coupled=anchors.some(r=>unknown.filter(i=>(r.rates[i]||0)>0).length>1);
  const medianApplies=!experimental && !coupled && unknown.every(i=>packImplications[i].length>0);

  const fullRank=formats.length>0 && rank(a)===unknown.length;
  let converged=unknown.length===0,conditioning=unknown.length?Infinity:0;
  let weights=anchors.map(r=>r.priorWeight),robustConverged=true;
  let methodUsed=unknown.length?(medianApplies?'median':'experimental-fit'):'entered';
  // Per-format implied-packs range. Only meaningful under the median model,
  // where each anchor implies a per-format pack total; for a coupled/
  // experimental fit a single anchor spans formats and its per-format implied
  // packs is not separable, so the range would mislead and is withheld.
  const packRange=medianApplies?formats.map((_,i)=>{const ps=packImplications[i].map(p=>p.packs);return ps.length?{min:Math.min(...ps),max:Math.max(...ps),median:weightedMedian(packImplications[i]),anchors:ps.length}:null;}):null;

  if(medianApplies && unknown.length && !errors.length) {
    // Deterministic: each unknown format's packs is the WEIGHTED median of its
    // anchors' implied packs (influence policy preserved).
    unknown.forEach(i=>{packTotals[i]=weightedMedian(packImplications[i]);});
    converged=true;conditioning=1;
  } else if((experimental||coupled) && fullRank && unknown.length && !errors.length) {
    // --- EXPERIMENTAL MODE (NNLS + optional Huber/coarse-odds) --------------
    // Off by default. Used only when explicitly enabled, or when anchors are
    // genuinely coupled across formats so the median cannot separate them.
    const robust=project.robustWeights===true;
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
  // An estimate requires at least one pack format; an empty-format project is
  // not a solved system even though it has no "unknowns".
  if(!formats.length)errors.push('Add at least one pack format before estimating production.');
  // Any anchor whose implied packs could not be computed (non-finite or
  // negative, e.g. a fixed format already exceeding the nominal pool) is a
  // reported issue, never silently dropped into a false "anchors agree".
  // Set of anchor ids whose implied packs were infeasible (negative/non-finite)
  // for at least one format they participate in. The audit message is method-
  // specific: under the median model such a row is genuinely EXCLUDED from that
  // format's median; under the experimental solver it is NOT excluded — it
  // remains in the objective with an infeasible implied pool, which the fit must
  // reconcile. Saying "excluded" in that mode would be false.
  for(const id of implicationIssues){const r=anchors.find(x=>x.id===id);const row=rows.find(x=>x.id===id);if(r&&row&&!row._issue){
    // Precise wording for the median model: an anchor may be feasible for one
    // unknown format and infeasible for another, so it is excluded from the
    // median of the format(s) where its implied pool is infeasible — not
    // necessarily every format it touches.
    const msg=medianApplies
      ?'Implied pack total is negative or non-finite for at least one format (a fixed format may already exceed this pool). This anchor was excluded from that format\u2019s median; review the odds, serial, or entered pack totals.'
      :'Implied pack total is negative or non-finite (a fixed format may already exceed this pool). This anchor is retained in the experimental fit but its implied pool is infeasible; review the odds, serial, or entered pack totals.';
    row._issue=msg;rowIssues.push(`${r.name}: ${msg}`);}}
  // Which anchors actually fed a format median (used only under the median
  // model). Only UNKNOWN formats are median targets, so an anchor that is
  // feasible for a FIXED format but infeasible for every unknown format it
  // touches is not a participant — it fed no median. Building this from
  // packImplications over all formats (including fixed ones) would falsely
  // count such an anchor as "used".
  const medianParticipantIds=medianApplies?new Set(unknown.flatMap(i=>packImplications[i].map(p=>p.id))):null;
  // After solving, every pack total must be finite and nonnegative. A negative
  // inferred total is impossible production and must not pass as agreement.
  if(packTotals.some(x=>!Number.isFinite(x)||x<0))errors.push('Inferred pack totals are negative or non-finite, which is impossible production. Review fixed pack totals, odds, and serial numbers; a fixed format may exceed a nominal pool.');
  const wellConditioned=conditioning<=1000;
  // Identifiable under the default model = every unknown format has at least one
  // participating serial anchor (so a median exists). Under the experimental
  // solver it is full column rank. A fully-entered system (no unknowns) is
  // trivially identifiable.
  const identifiable=unknown.length===0 || (medianApplies ? unknown.every(i=>packImplications[i].length>0) : fullRank);
  // Evidence disagreements are reported, never used as a switch hiding results.
  const hasEstimate=identifiable&&converged&&!errors.length&&packTotals.every(Number.isFinite);
  const diagnostics=candidates.map(r=>{
    const index=anchors.findIndex(a=>a.id===r.id);
    // participation describes what the row ACTUALLY did under the method used:
    //  - 'not-an-anchor': not enabled as an anchor (weight 0 or unchecked)
    //  - 'excluded-from-median': enabled, but its implied packs were infeasible
    //    and dropped from every format median (default model only)
    //  - 'median': enabled and fed at least one format's median
    //  - 'solver': enabled and present in the experimental least-squares fit
    let participation;
    if(index<0)participation='not-an-anchor';
    else if(methodUsed==='median')participation=medianParticipantIds&&medianParticipantIds.has(r.id)?'median':'excluded-from-median';
    else if(methodUsed==='experimental-fit')participation='solver';
    else participation='entered'; // fully-entered totals: anchors only check consistency
    // Effective influence: an anchor excluded from the median exerted none.
    const effectiveWeight=participation==='excluded-from-median'?0:(index>=0?weights[index]:0);
    const rawPredicted=hasEstimate?r.rates.reduce((sum,v,i)=>sum+(v||0)*packTotals[i],0):null;
    // Never let a non-finite predicted value become a NaN discrepancy that then
    // slips past the >5% check as if it agreed.
    const predicted=rawPredicted!==null&&Number.isFinite(rawPredicted)?rawPredicted:null;
    const error=predicted===null?null:Math.abs(predicted-r.total)/r.total;
    return {...r,participation,used:participation==='median'||participation==='solver',effectiveWeight,downweighted:r.enabled&&participation!=='excluded-from-median'&&effectiveWeight<r.weight*0.99,predicted,error:Number.isFinite(error)?error:null,impliedEligible:predicted===null?null:predicted/r.serial};
  });
  const conflicts=diagnostics.filter(r=>r.enabled&&r.error!==null&&r.error>0.05);
  // Rows whose derived value could not be computed (non-finite) must not be read
  // as agreement. Track them by id so an anchor that is also a result row is
  // counted once.
  const derivedIssueIds=new Set(diagnostics.filter(r=>r.enabled&&r.error===null&&hasEstimate).map(r=>r.id));
  const assumptions=methodUsed==='median'
    ?'Default model: each format\u2019s pack total is the WEIGHTED MEDIAN of its numbered anchors\u2019 implied packs (implied packs = eligible subjects \u00d7 serial \u00d7 odds, less any fixed-format contribution), weighted by each anchor\u2019s influence so base/insert anchors outweigh autograph/memorabilia. Each parallel\u2019s estimate = packs \u00f7 odds \u00f7 eligible subjects. A dash means unavailable; anchors with an infeasible implied pool are excluded. These are estimates from published odds anchored on known serial numbers, not manufacturer-confirmed totals.'
    :methodUsed==='entered'
    ?'Pack totals were entered directly; each parallel\u2019s estimate = packs \u00f7 odds \u00f7 eligible subjects. Not manufacturer-confirmed.'
    :'EXPERIMENTAL fit (off by default): nonnegative least squares'+(project.robustWeights===true?' with Huber outlier weighting':'')+(project.roundingWeights===true?' and coarse-odds precision weighting':'')+'. Uncalibrated; compare against the default median model. Not manufacturer-confirmed.';
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
  // usedAnchors counts anchors that actually participated under the method used
  // (fed a format median, or were present in the experimental fit) — not merely
  // enabled anchors, so the "using N anchors" status is honest.
  const usedAnchors=diagnostics.filter(d=>d.used).length;
  return {formatChecks,packTotals:hasEstimate?packTotals:null,methodUsed,packRange,packImplications,identifiable,fullRank,wellConditioned,converged,conditioning,valid:hasEstimate,hasEstimate,diagnostics,conflicts,errors,rowIssues,derivedIssues,results,scenario:provisional,provisional,robustConverged,assumptions,usedAnchors,enabledAnchors:anchors.length};
}
export function csv(rows) {return rows.map(r=>r.map(v=>{const s=String(v??'');return '"'+(/^[\s]*[=+@\-]/.test(s)?"'":'')+s.replaceAll('"','""')+'"';}).join(',')).join('\r\n');}
