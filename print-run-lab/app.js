import {applyFinestReference,finestConfigs,referenceSource} from './finest-reference.js';
import {readPdf} from './pdf-reader.js';
import {parseChecklist,parseOdds,matchFamilies,calculate,anchorProfile,csv} from './engine.js';
import {createOperatorClient} from '../command-center/operator-client.js';
import {loadCatalog,loadPublished} from './published-projects.js';
import {sanitizeProject} from './project-schema.js';
import {ENGINE_SHA256} from './model-version.js';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const influence=n=>n===null||n===undefined?'—':Number(n).toLocaleString(undefined,{maximumSignificantDigits:4});
const fmt=n=>n===null||n===undefined?'—':Number(n).toLocaleString(undefined,{maximumFractionDigits:1});
let project={version:1,title:'',families:[],formats:[],rows:[],packTotals:[],allowScenario:false,robustWeights:false,roundingWeights:false,formatConfigs:{},aliases:[],oddsBlocking:false,sources:{},warnings:[]};let fit;let busy=false;let resultPage=0;
const operator=createOperatorClient();
let owner={authorized:false,publish:false},authEpoch=0,loadSequence=0,catalog=[],frozenSnapshot=null,lastPublic=null,selectedEntry=null,editBase=null,pendingPublish=null,pendingDraft=null;
const canEdit=()=>owner.authorized&&!frozenSnapshot&&!pendingPublish;
const PENDING_KEY='cm_print_run_pending_publish_v1';
function savePending(){try{if(pendingPublish)sessionStorage.setItem(PENDING_KEY,JSON.stringify(pendingPublish));else sessionStorage.removeItem(PENDING_KEY);}catch{}}
function readOnly(id){if(canEdit())return;for(const el of $(id).querySelectorAll('input,select,button')){if(el.tagName==='BUTTON'){el.remove();continue;}const span=document.createElement('span');span.textContent=el.tagName==='SELECT'?(el.selectedOptions[0]?.textContent||'—'):el.type==='checkbox'?(el.checked?'Yes':'No'):(el.value||el.placeholder||'—');el.replaceWith(span);}}
function permissions(){
  const edit=canEdit();for(const el of document.querySelectorAll('[data-owner-control]')){el.hidden=!edit;el.disabled=!edit||busy;}
  for(const id of ['robustWeights','roundingWeights'])$(id).closest('label').hidden=!edit;
  $('ownerSources').hidden=!edit;$('publishReview').hidden=!owner.authorized||!!frozenSnapshot&&!pendingPublish;$('ownerLogin').hidden=owner.authorized;$('logout').hidden=!owner.authorized;$('editProject').hidden=!owner.authorized||!frozenSnapshot;$('editProject').disabled=busy||!!pendingPublish;
  $('approvePublic').disabled=!edit;
  $('publish').disabled=!edit||!owner.publish||busy||!fit?.valid||!!pendingPublish||!$('approvePublic').checked;
  $('publishStatus').hidden=!pendingPublish||!owner.authorized;
  $('exportProject').disabled=!project.families.length;
  $('projects').disabled=busy||!!pendingPublish;$('example').disabled=busy||!!pendingPublish;$('refreshProjects').disabled=busy||!!pendingPublish;
}
function rememberPublic(){lastPublic={project:structuredClone(project),snapshot:frozenSnapshot?structuredClone(frozenSnapshot):null,entry:selectedEntry?{...selectedEntry}:null};}
function lockOwner(message='Authoring locked. Public viewing and exports remain available.'){
  authEpoch++;loadSequence++;clearTimeout(publishPoll);operator.clear();owner={authorized:false,publish:false};pendingPublish=null;pendingDraft=null;$('ownerKey').value='';$('ownerSources').replaceChildren();$('approvePublic').checked=false;$('signIn').disabled=false;
  if(lastPublic){project=structuredClone(lastPublic.project);frozenSnapshot=lastPublic.snapshot?structuredClone(lastPublic.snapshot):null;selectedEntry=lastPublic.entry;}else{project={version:1,title:'',families:[],formats:[],rows:[],packTotals:[],aliases:[],sources:{},warnings:[],formatConfigs:{},allowScenario:false};frozenSnapshot=null;selectedEntry=null;}
  editBase=null;busy=false;render();$('authNotice').textContent=message;
}
async function authorizeAuthoring(){
  if(!canEdit())return false;const epoch=authEpoch;
  try{await operator.verify();return epoch===authEpoch&&canEdit();}catch(e){if(e.authRejected)lockOwner();notice(e.message);return false;}
}
function notice(message){$('notice').textContent=message;}
function download(name,data,type){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function setBusy(value){busy=value;for(const id of ['example','checklist','odds','restore','openProject','save'])if($(id))$(id).disabled=value;permissions();}
function rematch(){project.rows=matchFamilies(project.rows,project.families,project.aliases);}
async function loadPdf(kind,buffer,name,sequence=loadSequence){
  const pages=await readPdf(buffer,(n,total)=>notice(`Reading ${name} · page ${n} of ${total}…`));
  if(sequence!==loadSequence)throw Error('Source load cancelled.');
  const parsed=kind==='checklist'?parseChecklist(pages):parseOdds(pages);
  if(kind==='checklist')project.families=parsed.families;
  else {project.formats=parsed.formats;project.rows=parsed.rows;project.packTotals=parsed.formats.map(()=>null);project.allowScenario=false;project.oddsBlocking=!!parsed.blocking;project.formatConfigs={};project.referenceSource='';}
  project.warnings=project.warnings.filter(w=>w.kind!==kind).concat(parsed.warnings.map(text=>({kind,text})));
  project.sources[kind]={name,pages};project.allowScenario=false;rematch();
}
function render(){
  $('workspace').hidden=!project.sources.checklist&&!project.sources.odds&&!project.families.length;
  if($('title'))$('title').value=project.title;
  $('referenceNote').textContent=project.referenceSource?project.referenceSource+'. Numbering and box configurations are reference inputs, separate from the PDFs.':'';
  if($('checklistName'))$('checklistName').textContent=project.sources.checklist?.name||'Base cards, inserts, autographs and variations';
  if($('oddsName'))$('oddsName').textContent=project.sources.odds?.name||'All pack formats, detected automatically';
  $('publicationNote').textContent=selectedEntry?(frozenSnapshot?'Viewing published revision ':'Editing a copy of revision ')+selectedEntry.revision_id+' · '+project.title+' · '+selectedEntry.published_at:project.title;
  $('counts').textContent=`${project.families.length} sections · ${project.rows.length} odds rows`;
  $('formatCount').textContent=`${project.formats.length} pack formats`;
  $('warnings').innerHTML=project.warnings.map(w=>`<p>${esc(w.kind)}: ${esc(w.text)}</p>`).join('')||'<p>No extraction warnings. Review section counts and matches before using estimates.</p>';
  $('sourceText').textContent=Object.entries(project.sources).map(([kind,source])=>`${kind.toUpperCase()}: ${source.name}\n`+source.pages.map(p=>`PAGE ${p.number}\n`+p.rows.map(r=>r.text).join('\n')).join('\n\n')).join('\n\n');
  $('families').innerHTML=project.families.map(f=>`<tr><td><input aria-label="Section name" data-family="${esc(f.id)}" data-field="name" value="${esc(f.name)}"></td><td><input aria-label="Section card count" type="number" min="1" step="1" data-family="${esc(f.id)}" data-field="count" value="${f.count}"><small> ${f.cards.length} extracted</small></td><td>${esc(f.page||'Manual')}</td><td><button class="remove" data-remove-family="${esc(f.id)}" aria-label="Remove ${esc(f.name)}">×</button></td></tr>`).join('');
  renderOdds();
  $('formats').innerHTML=project.formats.map((name,i)=>{
    const config=project.formatConfigs&&Object.hasOwn(project.formatConfigs,name)?project.formatConfigs[name]:{};
    return `<div class="format-card"><label>Format name <input data-format-name="${i}" aria-label="Pack format name ${i+1}" value="${esc(name)}"></label><label for="pack${i}">Pack total</label><input id="pack${i}" data-pack="${i}" type="number" min="0" step="any" placeholder="Auto from anchors" value="${project.packTotals[i]??''}"><span id="estimate${i}"></span><label>Cards per pack<input data-config="cardsPerPack" data-format-index="${i}" type="number" min="1" step="1" value="${config.cardsPerPack??''}" placeholder="Optional" aria-label="Cards per pack for ${esc(name)}"></label><label>Packs per box<input data-config="packsPerBox" data-format-index="${i}" type="number" min="1" step="1" value="${config.packsPerBox??''}" placeholder="Optional" aria-label="Packs per box for ${esc(name)}"></label><span id="configCheck${i}"></span><small>${esc(config.source||'')}</small><button data-remove-format="${i}" style="margin-top:8px">Remove format</button></div>`;
  }).join('');
  $('roundingWeights').checked=project.roundingWeights===true;
  $('robustWeights').checked=project.robustWeights===true;
  renderAliases();
  recalculate();
  readOnly('families');readOnly('formats');permissions();
}
function renderAliases(){
  // Alias targets are stable family IDs; the option value is the id and the
  // visible label is the current family name, so a rename never breaks the alias.
  $('aliasTo').innerHTML=project.families.map(f=>`<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('');
  $('aliasRows').innerHTML=(project.aliases||[]).map((a,i)=>{const fam=project.families.find(f=>f.id===a.to);return `<tr><td>${esc(a.from)}</td><td>${esc(fam?fam.name:'(section removed)')}</td><td><button class="remove" data-remove-alias="${i}" aria-label="Remove alias ${esc(a.from)}">×</button></td></tr>`;}).join('')||'<tr><td colspan="3">No aliases. Add one when an odds row name does not match its checklist section.</td></tr>';
  readOnly('aliasRows');
}
function renderOdds(){
  $('oddsHead').innerHTML='<tr><th>Parallel</th><th>Checklist section</th>'+project.formats.map(f=>`<th>${esc(f)}</th>`).join('')+'<th>Eligible</th><th>Copies/card</th><th>Anchor</th><th>Page</th><th></th></tr>';
  const term=$('oddsFilter').value.toLowerCase();
  $('oddsRows').innerHTML=project.rows.filter(r=>r.name.toLowerCase().includes(term)).map(r=>`<tr><td><input data-row="${esc(r.id)}" data-field="name" value="${esc(r.name)}" aria-label="Parallel name"></td><td><select aria-label="Checklist section for ${esc(r.name)}" data-row="${esc(r.id)}" data-field="familyId"><option value="">Unmatched</option>${project.families.map(f=>`<option value="${esc(f.id)}" ${f.id===r.familyId?'selected':''}>${esc(f.name)}</option>`).join('')}</select>${!r.familyId&&r.ambiguous?'<br><span class="bad">Ambiguous name — assign a section or add an alias.</span>':''}</td>${r.odds.map((o,i)=>`<td><input data-row="${esc(r.id)}" data-odd="${i}" value="${esc(o)}" aria-label="${esc(project.formats[i])} odds for ${esc(r.name)}"></td>`).join('')}<td><input type="number" min="1" step="1" placeholder="Section" aria-label="Eligible cards for ${esc(r.name)}" data-row="${esc(r.id)}" data-field="eligible" value="${r.eligible??''}"></td><td><input type="number" min="1" step="1" aria-label="Copies per card for ${esc(r.name)}" data-row="${esc(r.id)}" data-field="serial" value="${r.serial??''}"></td><td><input type="checkbox" data-row="${esc(r.id)}" data-field="anchor" ${r.anchor?'checked':''} aria-label="Use ${esc(r.name)} as anchor"></td><td>${esc(r.page||'Manual')}${r.referenceBoxOdds?.length?`<br><small>Box odds (reference only): ${esc(r.referenceBoxOdds.join(', '))}</small>`:''}</td><td><button class="remove" data-remove-row="${esc(r.id)}" aria-label="Remove odds row">×</button></td></tr>`).join('');
  readOnly('oddsRows');
}
function recalculate(){
  fit=frozenSnapshot?structuredClone(frozenSnapshot):calculate(project);
  project.formats.forEach((_,i)=>{const range=fit.packRange?.[i];const rangeTxt=range&&range.anchors>1?` · ${range.anchors} anchors imply ${fmt(range.min)}–${fmt(range.max)} packs (median used)`:'';$(`estimate${i}`).textContent=fit.packTotals?`${project.packTotals[i]!==null?'Entered':fit.methodUsed==='median'?'Median':'Fitted'}: ${fmt(fit.packTotals[i])} packs${fit.formatChecks[i].boxes!==null?' · ≈ '+fmt(fit.formatChecks[i].boxes)+' boxes':''}${rangeTxt}${fit.formatChecks[i].boundaryZero?' · nonnegative-boundary allocation: the anchors do not pin this format, so it solved to zero. This is not evidence the format has no cards.':''}`:'Needs an independent anchor or entered pack total';});
  fit.formatChecks.forEach((check,i)=>{$(`configCheck${i}`).textContent=check.cardsPerPack?`Listed odds sum to ≈ ${fmt(check.listedCardsPerPack)} cards/pack; declared ${check.cardsPerPack}. Rounded or incomplete odds can differ. This is a check, not an additional production anchor.`:'';});
  const unmatched=project.rows.filter(r=>!r.familyId).length;
  const status=$('fitStatus');
  status.className='fit-status'+(fit.provisional||!fit.hasEstimate?' warning':'');
  status.textContent=fit.errors.length?fit.errors.join(' '):!project.formats.length?'Upload the odds PDF to detect pack formats.':!fit.fullRank?'The available anchors do not determine every pack format. Enter a known pack total or add an independent numbered anchor to resolve the allocation.':!fit.converged?'The numerical fit could not be resolved. Review the selected anchors or enter a known pack total.':`${fit.methodUsed==='median'?`Weighted median of ${fit.usedAnchors} anchor${fit.usedAnchors===1?'':'s'}`:fit.methodUsed==='experimental-fit'?`Experimental fit using ${fit.usedAnchors} anchor${fit.usedAnchors===1?'':'s'}`:'Estimates from entered pack totals'}${fit.methodUsed==='median'&&fit.enabledAnchors>fit.usedAnchors?` (${fit.enabledAnchors-fit.usedAnchors} enabled anchor${fit.enabledAnchors-fit.usedAnchors===1?'':'s'} excluded as infeasible — see step 03)`:''}. ${fit.conflicts.length?`${fit.conflicts.length} anchor discrepancies are flagged below; they do not hide estimates.`:fit.derivedIssues?`${fit.derivedIssues} row${fit.derivedIssues>1?'s':''} could not produce a finite estimate and ${fit.derivedIssues>1?'are':'is'} flagged below; agreement cannot be assessed.`:'Selected anchors agree within 5%; this is a consistency check, not a confidence interval.'}`;
  if(fit.hasEstimate&&!fit.wellConditioned)status.textContent+=' Pack allocation is sensitive to small odds changes; treat these estimates with extra caution.';
  if(!fit.robustConverged)status.textContent+=' Automatic weight refinement reached its iteration limit; the displayed fit is provisional.';
  if(unmatched)status.textContent+=` ${unmatched} odds rows need a checklist match for a per-card estimate.`;
  const ambiguous=project.rows.filter(r=>!r.familyId&&r.ambiguous).length;
  if(ambiguous)status.textContent+=` ${ambiguous} of those have ambiguous names; assign a section or add a name alias in step 02.`;
  if(fit.rowIssues.length)status.textContent+=` ${fit.rowIssues.length} invalid odds rows are marked individually; other estimates remain available.`;
  $('anchors').innerHTML=project.rows.filter(r=>r.serial>0).map(r=>{
    const d=fit.diagnostics.find(d=>d.id===r.id),family=project.families.find(f=>f.id===r.familyId),profile=anchorProfile(r,family);
    const known=(r.eligible??family?.count)*r.serial;
    return `<tr><td><strong>${esc(r.name)}</strong><br>${esc(profile.kind)}<br><small>${esc(profile.reason)}</small>${r.serialSource?`<br><small>Numbering: ${esc(r.serialSource)}</small>`:''}</td><td>${Number.isFinite(known)?fmt(known):'Match section'}</td><td>${fmt(d?.predicted)}</td><td>${fmt(d?.impliedEligible)}</td><td class="${d?.error>0.05?'bad':'good'}">${d?.error!==null&&d?.error!==undefined?fmt(d.error*100)+'%':'—'}</td><td><input type="number" min="0" max="1000" step="any" data-anchor-weight="${esc(r.id)}" value="${r.weight??''}" placeholder="${profile.defaultWeight}" aria-label="Anchor weight for ${esc(r.name)}"><small>Default ${profile.defaultWeight}${r.weight!==null&&r.weight!==undefined?' · custom':''}</small></td><td>${influence(d?.precisionFactor)}</td><td>${influence(d?.effectiveWeight)}${d?.downweighted?'<br><span class="bad">Auto reduced</span>':''}${d?.participation==='excluded-from-median'?'<br><span class="bad">Excluded: infeasible implied pool</span>':''}</td><td><input data-anchor-note="${esc(r.id)}" value="${esc(r.weightNote||'')}" maxlength="2000" placeholder="Why you trust or question these odds" aria-label="Source concern for ${esc(r.name)}"></td><td><input type="checkbox" data-anchor="${esc(r.id)}" ${r.anchor?'checked':''} aria-label="Use anchor ${esc(r.name)}"></td></tr>`;
  }).join('')||'<tr><td colspan="11">No numbered anchors yet. Match a Superfractor row or enter verified copies per card in the odds table.</td></tr>';
  $('exportAnchors').disabled=!fit.hasEstimate;
  readOnly('oddsRows');readOnly('anchors');permissions();
  renderResults();
}
function filteredResults(){const q=$('filter').value.toLowerCase().trim();return fit.results.filter(r=>!q||[r.name,r.family,...(project.families.find(f=>f.id===r.familyId)?.cards||[]).map(c=>c.id+' '+c.description)].some(v=>v.toLowerCase().includes(q)));}
function renderResults(){
  const cardView=$('view').value==='card';const q=$('filter').value.toLowerCase().trim();
  const list=filteredResults();let entries=list;
  if(cardView)entries=list.flatMap(r=>{const f=project.families.find(f=>f.id===r.familyId);if(!f||f.cards.length!==r.count)return [];return f.cards.filter(c=>!q||[r.name,r.family,c.id,c.description].some(v=>v.toLowerCase().includes(q))).map(card=>({r,card}));});
  const pages=Math.max(1,Math.ceil(entries.length/100));resultPage=Math.min(resultPage,pages-1);
  const visible=entries.slice(resultPage*100,(resultPage+1)*100);
  $('resultHead').innerHTML=cardView?'<tr><th>Card number</th><th>Checklist entry / parallel</th>'+project.formats.map(f=>`<th>${esc(f)} copies/card</th>`).join('')+'<th>Est. copies/card</th><th>Known numbering</th></tr>':'<tr><th>Parallel / card family</th><th>Eligible cards</th>'+project.formats.map(f=>`<th>${esc(f)} copies</th>`).join('')+'<th>Total copies</th><th>Avg. copies/card</th><th>Known numbering</th></tr>';
  $('results').innerHTML=visible.map(entry=>{
    if(cardView){const {r,card}=entry;return `<tr><td>${esc(card.id)}</td><td><strong>${esc(card.description)}</strong><br>${esc(r.name)} · ${esc(r.family)}</td>${project.formats.map((_,i)=>`<td>${fmt(r.byFormat?r.byFormat[i]/r.count:null)}</td>`).join('')}<td>${fmt(r.perCard)}</td><td>${r.serial?' /'+fmt(r.serial):'Unnumbered / unknown'}</td></tr>`;}
    const r=entry;return `<tr><td><strong>${esc(r.name)}</strong><br><span>${esc(r.family)} · source p.${esc(r.page||'manual')}</span>${r.issue?`<br><span class="bad">${esc(r.issue)}</span>`:''}</td><td>${r.count??'—'}</td>${project.formats.map((_,i)=>`<td>${fmt(r.byFormat?.[i])}</td>`).join('')}<td>${fmt(r.total)}</td><td>${fmt(r.perCard)}</td><td>${r.serial?' /'+fmt(r.serial):'Unnumbered / unknown'}</td></tr>`;
  }).join('')||`<tr><td colspan="20">No matching ${cardView?'card identities':'parallel rows'}. ${cardView?'Card view requires an extracted identity for every eligible card.':''}</td></tr>`;
  $('resultCount').textContent=`${entries.length.toLocaleString()} ${cardView?'card estimates':'parallel rows'}`;
  $('pageLabel').textContent=`Page ${resultPage+1} of ${pages}`;$('prevPage').disabled=resultPage===0;$('nextPage').disabled=resultPage>=pages-1;
  $('resultsStatus').className='fit-status'+(fit.provisional||!fit.hasEstimate?' warning':'');
  $('resultsStatus').textContent=fit.hasEstimate?(fit.provisional?'Best-fit estimates are shown below. Source disagreements and weight adjustments are documented in step 03.':'Estimated production is shown below, using the selected anchor weights.'):'Pack allocation is unresolved. See step 03 for the missing information or source-column correction needed.';
  $('resultNote').textContent=(fit.hasEstimate?fit.assumptions+' Autograph/memorabilia eligibility can vary by parallel. Known numbering is separate from the estimated checklist average.':'An unresolved allocation cannot establish separate format copies; enter a known pack total or add an independent anchor above.')+(cardView?' Card view omits sections with incomplete identities or differing eligibility counts; per-subject values assume equal production.':'');
  $('export').disabled=!fit.valid;$('exportCards').disabled=!fit.valid;
}
$('example').addEventListener('click',async()=>{
  if(busy||pendingPublish)return;
  if(canEdit()&&project.families.length&&!confirm('Load the example? Save your local draft first if you want to keep edits.'))return;
  const sequence=++loadSequence;setBusy(true);const previous=project;
  try{
    project={version:1,title:'2025 Topps Finest Football',families:[],formats:[],rows:[],packTotals:[],allowScenario:false,robustWeights:false,roundingWeights:false,formatConfigs:{},aliases:[],oddsBlocking:false,sources:{},warnings:[]};
    for(const [kind,file]of [['checklist','2025-finest-checklist.pdf'],['odds','2025-finest-odds.pdf']]){
      const response=await fetch('./examples/'+file);if(!response.ok)throw Error(`Example unavailable (${response.status})`);
      await loadPdf(kind,await response.arrayBuffer(),file,sequence);
    }
    if(sequence!==loadSequence)return;project.rows=applyFinestReference(project.rows);project.formatConfigs=structuredClone(finestConfigs);project.referenceSource=referenceSource;frozenSnapshot=null;selectedEntry=null;editBase=null;$('approvePublic').checked=false;
    render();rememberPublic();notice('Topps Finest loaded from the original PDFs. Best-fit estimates are shown with base/insert anchors weighted above autograph/memorabilia anchors. Review adjustments in step 03.');
  }catch(e){if(sequence===loadSequence){project=previous;render();notice(e.message);}}finally{if(sequence===loadSequence)setBusy(false);}
});

$('oddsFilter').addEventListener('input',renderOdds);$('filter').addEventListener('input',()=>{resultPage=0;renderResults();});
$('view').addEventListener('change',()=>{resultPage=0;renderResults();});
$('prevPage').addEventListener('click',()=>{resultPage--;renderResults();});$('nextPage').addEventListener('click',()=>{resultPage++;renderResults();});
$('roundingWeights').addEventListener('change',e=>{if(!canEdit()||busy)return;project.roundingWeights=e.target.checked;recalculate();});
$('robustWeights').addEventListener('change',e=>{if(!canEdit()||busy)return;project.robustWeights=e.target.checked;recalculate();});
document.addEventListener('change',event=>{
  if(!canEdit()||busy)return;const el=event.target;
  if(el.dataset.family){const f=project.families.find(f=>f.id===el.dataset.family);if(el.dataset.field==='count'&&(!el.checkValidity()||Number(el.value)<1)){notice('Card counts must be positive whole numbers.');render();return;}f[el.dataset.field]=el.dataset.field==='count'?Number(el.value):el.value;renderOdds();recalculate();}
  if(el.dataset.row){const row=project.rows.find(r=>r.id===el.dataset.row);if(!row)return;
    if(el.dataset.odd!==undefined)row.odds[+el.dataset.odd]=el.value;
    else {const field=el.dataset.field;if(['serial','eligible'].includes(field)&&el.value!==''&&!el.checkValidity()){notice('Copies and eligible card counts must be positive whole numbers.');renderOdds();return;}row[field]=field==='anchor'?el.checked:['serial','eligible'].includes(field)?(el.value===''?null:Number(el.value)):el.value;if(field==='serial'){row.serialSource='Manually entered numbering';delete row.serialSourceUrl;}
      // A manual section choice is sticky: automatic rematching (including alias
      // edits) must not overwrite it. Choosing "Unmatched" clears the override
      // so auto-matching can resume for that row.
      if(field==='familyId'){if(el.value)row.familyIdManual=true;else delete row.familyIdManual;renderOdds();}}
    recalculate();
  }
  if(el.dataset.anchorWeight){const r=project.rows.find(r=>r.id===el.dataset.anchorWeight);if(!el.checkValidity()){notice('Use an anchor weight from 0 to 1000. The previous value was kept.');recalculate();return;}r.weight=el.value===''?null:Number(el.value);recalculate();}
  if(el.dataset.anchorNote){project.rows.find(r=>r.id===el.dataset.anchorNote).weightNote=el.value.slice(0,2000);}
  if(el.dataset.anchor){project.rows.find(r=>r.id===el.dataset.anchor).anchor=el.checked;renderOdds();recalculate();}
  if(el.dataset.config){if(!el.checkValidity()){notice('Box configuration values must be positive whole numbers.');render();return;}const name=project.formats[+el.dataset.formatIndex];const existing=project.formatConfigs&&Object.hasOwn(project.formatConfigs,name)?project.formatConfigs[name]:{};project.formatConfigs={...project.formatConfigs,[name]:{...existing,[el.dataset.config]:el.value===''?null:Number(el.value),source:'User-entered product configuration'}};recalculate();}
  if(el.dataset.formatName!==undefined){const name=el.value.trim();if(!name||project.formats.some((f,i)=>i!==+el.dataset.formatName&&f===name)){notice('Use a unique, nonempty pack format name.');render();return;}const old=project.formats[+el.dataset.formatName];if(old!==name&&project.formatConfigs&&Object.hasOwn(project.formatConfigs,old)){project.formatConfigs={...project.formatConfigs,[name]:project.formatConfigs[old]};delete project.formatConfigs[old];}project.formats[+el.dataset.formatName]=name;render();}
  if(el.dataset.pack!==undefined){if(!el.checkValidity()){notice('Pack totals must be nonnegative numbers. The previous value was kept.');render();return;}project.packTotals[+el.dataset.pack]=el.value===''?null:Number(el.value);recalculate();}
});
document.addEventListener('click',e=>{
  if(!canEdit()||busy)return;const format=e.target.closest('[data-remove-format]');if(format){const i=+format.dataset.removeFormat;if(project.formatConfigs)delete project.formatConfigs[project.formats[i]];project.formats.splice(i,1);project.packTotals.splice(i,1);project.rows.forEach(r=>r.odds.splice(i,1));project.allowScenario=false;render();return;}
  const family=e.target.closest('[data-remove-family]');const row=e.target.closest('[data-remove-row]');
  if(family){const fid=family.dataset.removeFamily;project.families=project.families.filter(f=>f.id!==fid);project.rows.forEach(r=>{if(r.familyId===fid){r.familyId='';delete r.familyIdManual;}});if(project.aliases)project.aliases=project.aliases.filter(a=>a.to!==fid);render();}
  if(row){project.rows=project.rows.filter(r=>r.id!==row.dataset.removeRow);renderOdds();recalculate();}
  const alias=e.target.closest('[data-remove-alias]');
  if(alias){project.aliases.splice(+alias.dataset.removeAlias,1);rematch();render();}
});
$('addAlias').addEventListener('click',()=>{
  if(!canEdit()||busy)return;
  const from=$('aliasFrom').value.trim(),to=$('aliasTo').value;
  if(!from){notice('Enter the odds-name text the alias should match.');return;}
  if(!to){notice('Add a checklist section first, then choose it for the alias.');return;}
  project.aliases=[...(project.aliases||[]),{from,to}];$('aliasFrom').value='';rematch();render();notice(`Alias added: “${from}” → ${to}.`);
});
$('addFormat').addEventListener('click',()=>{if(!canEdit()||busy)return;project.formats.push('Format '+(project.formats.length+1));project.packTotals.push(null);project.rows.forEach(r=>r.odds.push('-'));project.allowScenario=false;render();});

$('addFamily').addEventListener('click',()=>{if(!canEdit()||busy)return;project.families.push({id:crypto.randomUUID(),name:'New section',count:1,cards:[],page:null});render();});
$('addOdds').addEventListener('click',()=>{if(!canEdit()||busy)return;project.rows.push({id:crypto.randomUUID(),name:'New parallel',familyId:'',odds:project.formats.map(()=>'-'),eligible:null,serial:null,anchor:false,page:null});$('oddsFilter').value='';renderOdds();recalculate();});

function bindOwnerSources(){
for(const kind of ['checklist','odds'])$(kind).addEventListener('change',async event=>{
  if(busy||!await authorizeAuthoring())return;const sequence=++loadSequence;const file=event.target.files[0];if(!file)return;if(file.size>30*1024*1024){notice("PDF exceeds 30 MB. Please use a smaller PDF.");return;}
  setBusy(true);
  try{await loadPdf(kind,await file.arrayBuffer(),file.name,sequence);if(sequence!==loadSequence)return;editBase=null;selectedEntry=null;render();notice(`${file.name} loaded. Review the extracted sections and odds.`);}catch(e){notice(`Could not read PDF: ${e.message}`);}finally{if(sequence===loadSequence)setBusy(false);event.target.value='';}
});
$('title').addEventListener('input',e=>{if(canEdit())project.title=e.target.value;});
$('openProject').addEventListener('click',()=>{if(canEdit())$('restore').click();});
$('save').addEventListener('click',()=>{if(!canEdit())return;const clean=JSON.parse(JSON.stringify(project,(k,v)=>k.startsWith('_')?undefined:v));download('print-run-project.json',JSON.stringify(clean,null,2),'application/json');notice('Project saved, including source text, edits and assumptions.');});
$('restore').addEventListener('change',async e=>{
  if(busy||!await authorizeAuthoring())return;const sequence=++loadSequence;const previous=project;
  try{const f=e.target.files[0];if(!f)return;if(f.size>30*1024*1024)throw Error('Project file exceeds 30 MB.');const p=JSON.parse(await f.text());if(sequence!==loadSequence)return;
    const isObj=v=>v&&typeof v==='object'&&!Array.isArray(v);
    if(p.version!==1||!Array.isArray(p.families)||!Array.isArray(p.formats)||!p.formats.every(f=>typeof f==='string')||!Array.isArray(p.rows)||!isObj(p.sources)||!Array.isArray(p.warnings)||typeof p.allowScenario!=='boolean'||(p.oddsBlocking!==undefined&&typeof p.oddsBlocking!=='boolean')||(p.robustWeights!==undefined&&typeof p.robustWeights!=='boolean')||(p.roundingWeights!==undefined&&typeof p.roundingWeights!=='boolean'))throw Error('Unsupported project file.');
    const KINDS=['Base','Insert','Autograph / memorabilia'];
    if(!p.families.every(f=>typeof f.id==='string'&&typeof f.name==='string'&&Number.isInteger(f.count)&&f.count>0&&(f.sectionKind===undefined||f.sectionKind===null||KINDS.includes(f.sectionKind))&&Array.isArray(f.cards)&&f.cards.every(c=>typeof c.id==='string'&&typeof c.description==='string'))||!p.rows.every(r=>typeof r.id==='string'&&typeof r.name==='string'&&typeof r.anchor==='boolean'&&(r.familyIdManual===undefined||typeof r.familyIdManual==='boolean')&&(r.weight===undefined||r.weight===null||Number.isFinite(r.weight)&&r.weight>=0&&r.weight<=1000)&&(r.weightNote===undefined||typeof r.weightNote==='string'&&r.weightNote.length<=2000)&&(r.familyId===''||p.families.some(f=>f.id===r.familyId))&&Array.isArray(r.odds)&&r.odds.length===p.formats.length&&r.odds.every(o=>typeof o==='string')&&(r.referenceBoxOdds===undefined||Array.isArray(r.referenceBoxOdds)&&r.referenceBoxOdds.every(o=>typeof o==='string'))&&(r.serial===null||Number.isInteger(r.serial)&&r.serial>0)&&(r.eligible===null||Number.isInteger(r.eligible)&&r.eligible>0))||!Array.isArray(p.packTotals)||p.packTotals.length!==p.formats.length||!p.packTotals.every(v=>v===null||Number.isFinite(v)&&v>=0))throw Error('Invalid project data.');
    if(new Set(p.families.map(f=>f.id)).size!==p.families.length||new Set(p.rows.map(r=>r.id)).size!==p.rows.length)throw Error('Duplicate section or row identifiers.');
    if(!Object.values(p.sources).every(s=>typeof s.name==='string'&&Array.isArray(s.pages)&&s.pages.every(page=>Array.isArray(page.rows)&&page.rows.every(r=>typeof r.text==='string'))))throw Error('Invalid source text.');
    if(p.formatConfigs!==undefined&&(!isObj(p.formatConfigs)||!Object.entries(p.formatConfigs).every(([name,c])=>p.formats.includes(name)&&isObj(c)&&['cardsPerPack','packsPerBox'].every(k=>c[k]===undefined||c[k]===null||Number.isSafeInteger(c[k])&&c[k]>0)&&(c.source===undefined||typeof c.source==='string'))))throw Error('Invalid box configuration.');
    // Alias `to` is a stable family id; a legacy name-target is accepted and
    // migrated to its id below. Either must resolve to an existing family.
    if(p.aliases!==undefined&&(!Array.isArray(p.aliases)||!p.aliases.every(a=>isObj(a)&&typeof a.from==='string'&&a.from.trim()&&typeof a.to==='string'&&p.families.some(f=>f.id===a.to||f.name===a.to))))throw Error('Invalid name aliases (each needs a nonempty prefix and a target section that exists).');
    p.formatConfigs??={};p.aliases=(p.aliases||[]).map(a=>({...a,to:p.families.some(f=>f.id===a.to)?a.to:p.families.find(f=>f.name===a.to).id}));p.roundingWeights=p.roundingWeights===true;
    p.oddsBlocking=!!p.oddsBlocking;p.robustWeights=p.robustWeights===true;project=p;editBase=null;selectedEntry=null;frozenSnapshot=null;render();notice('Project restored. Saved assumptions and edits are applied.');
  }catch(err){if(sequence!==loadSequence)return;project=previous;render();notice(`Could not open project: ${err.message}`);}finally{e.target.value='';}
});
}
function exportResults(cards){
  if(!fit.valid)return;
  const header=['Project','Status','Parallel','Section',...(cards?['Card number','Card description']:[]),'Eligible cards',...project.formats.map(f=>`${f} estimated copies${cards?" per card":""}`),'Estimated total parallel copies','Estimated average copies per card','Known copies per card','Source odds page','Assumption','Estimated packs by format','Estimated boxes by format','Anchor calculation ledger'];
  const data=[header];const status=fit.provisional?'PROVISIONAL — SOURCE DISAGREEMENTS / LIMITED SUPPORT':'PROVISIONAL — NOT YET CALIBRATED';
  const q=$('filter').value.toLowerCase().trim();
  for(const r of filteredResults()){
    const f=project.families.find(f=>f.id===r.familyId);
    if(cards && (!f||r.count!==f.cards.length)){continue;}
    const entries=cards?f.cards:[null];
    for(const card of entries){
      if(card&&q&&![r.name,r.family,card.id,card.description].some(v=>v.toLowerCase().includes(q)))continue;
      data.push([project.title,status,r.name,r.family,...(cards?[card.id,card.description]:[]),r.count,...(r.byFormat||[]).map(v=>cards?v/r.count:v),r.total,r.perCard,r.serial,r.page,fit.assumptions+' Average assumes equal production among eligible subjects; autograph/memorabilia parallel eligibility may differ from the checklist. Detected formats only.',project.formats.map((f,i)=>f+'='+fit.packTotals[i]).join('; '),fit.formatChecks.map(c=>c.format+'='+ (c.boxes??'unknown')).join('; '),'Export anchor-calculations.csv for configured and used weights, discrepancies, numbering sources and source notes.']);
    }
  }
  download(cards?'card-print-run-estimates.csv':'parallel-print-run-estimates.csv',csv(data),'text/csv;charset=utf-8');
  notice(cards?'Card CSV exported. Sections with missing card identities or eligibility overrides are omitted; use parallel CSV for those rows.':'Parallel CSV exported with estimate status and assumptions.');
}
const PARTICIPATION_LABEL={'median':'Used (fed format median)','solver':'Used (experimental fit)','excluded-from-median':'Excluded (infeasible implied pool)','entered':'Consistency check only (totals entered)','not-an-anchor':'Not used as anchor'};
$('exportAnchors').addEventListener('click',()=>{if(!fit.hasEstimate)return;download('anchor-calculations.csv',csv([['Anchor','Kind','Checklist count','Known copies per eligible card','Checklist-based copies','Estimated copies','Implied eligible cards','Relative discrepancy','Participation','Exclusion reason','Configured weight','Applied weight','Odds precision factor','Automatic reduction','Numbering source','Source concern','Method',...project.formats.map(f=>f+' packs')],...fit.diagnostics.map(d=>[d.name,d.kind,d.count,d.serial,d.total,d.predicted,d.impliedEligible,d.error,PARTICIPATION_LABEL[d.participation]||d.participation,d.participation==='excluded-from-median'?(d.exclusionReason||project.rows.find(r=>r.id===d.id)?._issue||'Infeasible implied pool'):'',d.weight,d.effectiveWeight,d.precisionFactor,d.downweighted,project.rows.find(r=>r.id===d.id)?.serialSource||'Assumed Superfractor /1 or manually entered',project.rows.find(r=>r.id===d.id)?.weightNote||'',fit.assumptions,...fit.packTotals])]),'text/csv;charset=utf-8');notice('Anchor calculations exported with participation, applied weights, discrepancies and pack totals.');});
$('export').addEventListener('click',()=>exportResults(false));$('exportCards').addEventListener('click',()=>exportResults(true));

async function refreshCatalog(){
  const sequence=++loadSequence;
  try{
    const next=await loadCatalog();if(sequence!==loadSequence)return;
    catalog=next.projects;$('projects').replaceChildren(new Option('Choose a published project',''),...catalog.map(p=>new Option(p.title+' · provisional',p.id)));
    if(selectedEntry)$('projects').value=selectedEntry.id;
    $('catalogNotice').textContent=catalog.length?catalog.length+' published project'+(catalog.length===1?'':'s')+'.':'No shared projects have been published yet. The Finest example is available above.';
    const requested=new URLSearchParams(location.search).get('project');if(requested&&!selectedEntry&&catalog.some(p=>p.id===requested))await selectPublished(requested);
  }catch(e){if(sequence===loadSequence)$('catalogNotice').textContent=e.message+' The current view was kept.';}
}
async function selectPublished(id){
  if(busy||pendingPublish||!id)return;const entry=catalog.find(p=>p.id===id);if(!entry)return;
  if(canEdit()&&project.families.length&&!confirm('Switch projects? Save your local draft first if you want to keep edits.'))return;
  const sequence=++loadSequence;setBusy(true);
  try{const a=await loadPublished(entry);if(sequence!==loadSequence)return;project=a.project;frozenSnapshot=a.calculation;selectedEntry=entry;editBase=null;pendingPublish=null;resultPage=0;$('approvePublic').checked=false;render();rememberPublic();notice('Published revision loaded read-only. Estimates remain provisional.');}
  catch(e){if(sequence===loadSequence)notice(e.message);}finally{if(sequence===loadSequence)setBusy(false);}
}
$('projects').addEventListener('change',e=>void selectPublished(e.target.value));
$('refreshProjects').addEventListener('click',()=>{if(!busy&&!pendingPublish)void refreshCatalog();});
async function unlockOwner(value){
  if(busy)return;const epoch=++authEpoch;$('signIn').disabled=true;
  try{const caps=await operator.verify(value);if(epoch!==authEpoch)return;owner={authorized:caps.capabilities?.author===true,publish:caps.capabilities?.publish===true&&caps.model?.engine_sha256===ENGINE_SHA256};
    if(!owner.authorized)throw Error('Authoring was not authorized.');
    $('ownerKey').value='';$('ownerSources').replaceChildren($('ownerSourcesTemplate').content.cloneNode(true));bindOwnerSources();
    try{const saved=JSON.parse(sessionStorage.getItem(PENDING_KEY)||'null');if(saved&&/^[a-zA-Z0-9_-]{16,80}$/.test(saved.request_id))pendingPublish=saved;}catch{}
    render();$('authNotice').textContent=owner.publish?'Owner authoring unlocked. Publish creates a provisional public revision.':'Owner authoring unlocked. Shared publishing requires the updated backend and its publishing setting.';
    if(pendingPublish)void checkPublication();
  }catch(err){if(epoch===authEpoch){owner={authorized:false,publish:false};$('authNotice').textContent=err.message;permissions();}}finally{if(epoch===authEpoch)$('signIn').disabled=false;}
}
$('ownerLogin').addEventListener('submit',e=>{e.preventDefault();void unlockOwner($('ownerKey').value);});
$('logout').addEventListener('click',()=>lockOwner());
$('editProject').addEventListener('click',()=>{if(!owner.authorized||!frozenSnapshot||busy||pendingPublish)return;editBase={id:selectedEntry.id,revision_id:selectedEntry.revision_id};project=structuredClone(project);frozenSnapshot=null;$('approvePublic').checked=false;render();notice('Editing a local copy. Publish will create a new shared revision; Save local draft only downloads a file.');});
$('approvePublic').addEventListener('change',permissions);
$('exportProject').addEventListener('click',()=>{if(!project.families.length)return;const data=frozenSnapshot?{schema_version:1,project_id:selectedEntry.id,revision_id:selectedEntry.revision_id,published_at:selectedEntry.published_at,estimate_status:'provisional',calibration_status:'not-yet-calibrated',model:selectedEntry.model,project,calculation:frozenSnapshot}:project;download('print-run-project.json',JSON.stringify(data,(k,v)=>k.startsWith('_')?undefined:v,2),'application/json');notice('Project downloaded locally. No shared data was changed.');});
let publishPoll=null;
async function checkPublication(){
  if(!pendingPublish||!owner.authorized)return;const epoch=authEpoch,requestId=pendingPublish.request_id;
  try{const r=await operator.request('printRunPublishStatus',{request_id:requestId});if(epoch!==authEpoch||pendingPublish?.request_id!==requestId)return;const j=r.publication;
    if(j.state==='live_verified'){const matches=pendingDraft&&JSON.stringify(sanitizeProject(project))===pendingDraft;pendingPublish=null;pendingDraft=null;savePending();notice('Published and live-verified. Public readers can now open this revision.');await refreshCatalog();const entry=catalog.find(p=>p.id===j.project_id);if(entry&&matches){selectedEntry=entry;editBase={id:entry.id,revision_id:entry.revision_id};}render();return;}
    notice('Publication '+j.state.replaceAll('_',' ')+'. '+(j.message||'Check status before repeating Publish.'));
    if(['failed','superseded'].includes(j.state)){pendingPublish=null;savePending();render();return;}
    if(j.state!=='deployment_failed'&&Date.now()-pendingPublish.started<180000){clearTimeout(publishPoll);publishPoll=setTimeout(()=>void checkPublication(),5000);}
  }catch(e){if(epoch!==authEpoch)return;if(e.authRejected){lockOwner();return;}notice(e.message+' Use Check publication status; do not start a duplicate publication.');}
  permissions();
}
$('publishStatus').addEventListener('click',()=>{clearTimeout(publishPoll);void checkPublication();});
$('publish').addEventListener('click',async()=>{
  if(!canEdit()||!owner.publish||!fit?.valid||busy||pendingPublish||!$('approvePublic').checked)return;
  if(!await authorizeAuthoring())return;const epoch=authEpoch;
  let clean;try{clean=sanitizeProject(project);}catch(e){notice(e.message);return;}
  pendingPublish={request_id:crypto.randomUUID(),started:Date.now()};pendingDraft=JSON.stringify(clean);savePending();render();
  try{const r=await operator.request('publishPrintRunProject',{request_id:pendingPublish.request_id,project_id:editBase?.id||null,expected_revision:editBase?.revision_id||null,engine_sha256:ENGINE_SHA256,project:clean},120000);
    if(epoch!==authEpoch)return;notice('Publication '+r.publication.state.replaceAll('_',' ')+'. '+(r.publication.message||'Checking deployment…'));if(r.publication.state==='failed'){pendingPublish=null;savePending();render();}else await checkPublication();
  }catch(e){if(epoch!==authEpoch)return;if(e.authRejected){lockOwner();return;}if(e.requestRejected){pendingPublish=null;savePending();render();notice(e.message);return;}notice(e.message+' Use Check publication status before trying again.');permissions();}
});
render();void refreshCatalog();if(operator.hasKey())void unlockOwner();
