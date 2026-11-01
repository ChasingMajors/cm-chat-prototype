/* Owner-only metadata maintenance. Codes, card rows and quantities are immutable.
 * Legacy source codes remain aliases; canonical public codes live in the registry.
 * Run registrySourcePreflight, then registrySourceApply. No web-app route is added.
 */
function registrySourcePreflight(){return registrySourceMaintenance_(false);}
function registrySourceApply(){return registrySourceMaintenance_(true);}
function registrySourcePublish(){const r=registrySourceMaintenance_(false);if(r.changes)throw Error('Source metadata still needs review; no publication started.');return publishVaultStaticDataToGitHub();}
function registrySourceFormulaAudit(){
 const files=DriveApp.searchFiles("title contains 'registry-source-metadata-backup-' and trashed = false");let file=null;
 while(files.hasNext()){const f=files.next();if(!file||f.getDateCreated()>file.getDateCreated())file=f;}
 if(!file)throw Error('No maintenance backup found');
 const snapshot=JSON.parse(file.getBlob().getDataAsString());
 const sh=getVaultSpreadsheet_().getSheetByName('Products');Logger.log('Registry dependency audit: '+JSON.stringify({row:2344,code:sh.getRange('A2344').getValue(),code_formula:sh.getRange('A2344').getFormula(),year:sh.getRange('D2344').getValue(),year_formula:sh.getRange('D2344').getFormula(),display_formula:sh.getRange('B2344').getFormula()}));
 if(snapshot.review!=='registry-source-metadata-2026-10-25')throw Error('Unexpected backup');
 const grids=new Map(),bad=[];let matched=0;
 snapshot.cells.forEach(p=>{const key=p.ss+'|'+p.tab;if(!grids.has(key)){const sh=SpreadsheetApp.openById(p.ss).getSheetByName(p.tab),r=sh.getDataRange();grids.set(key,{v:r.getValues(),f:r.getFormulas()});}
 const g=grids.get(key),actual=g.v[p.row-1][p.col-1],formula=g.f[p.row-1][p.col-1];
 if(p.formula_before?formula===p.formula_before:actual===p.before)matched++;else if(bad.length<5)bad.push({tab:p.tab,row:p.row,col:p.col,before:p.before,actual:actual,formula:formula});});
 Logger.log('Registry rollback audit: '+JSON.stringify({backup_id:file.getId(),cells:snapshot.cells.length,matched:matched,mismatches:snapshot.cells.length-matched,examples:bad}));
}
function registrySourceJson_(file){
 const r=UrlFetchApp.fetch('https://app.chasingmajors.com/'+file,{muteHttpExceptions:true});
 if(r.getResponseCode()!==200)throw Error('Registry source HTTP '+r.getResponseCode());
 return JSON.parse(r.getContentText());
}
function registrySourceMaintenance_(apply){
 const lock=LockService.getScriptLock();if(!lock.tryLock(1000))throw Error('Exporter busy; no source changes made.');
 try{
  const index=registrySourceJson_('data/v2/vault/index.json'),registry=registrySourceJson_('data/v2/vault/product-registry.json');
  const legacy=registrySourceJson_('data/v1/vault/index.json'),policy=registrySourceJson_('data/prv-cv-identity-policy.json');
  if(index.index.length!==127||index.index.some(e=>e.identity_status!=='compliant'))throw Error('Active registry scope changed; review required.');
  const ss=getVaultSpreadsheet_(),ssId=ss.getId(),tabs=['Index','Products'],tables={},values={},headers={},formats={},formulas={},plan=[],seen=new Set();
  tabs.forEach(tab=>{const sh=ss.getSheetByName(tab);if(!sh)throw Error('Missing PRV source tab '+tab);const range=sh.getDataRange();values[tab]=range.getValues();formats[tab]=range.getNumberFormats();formulas[tab]=range.getFormulas();headers[tab]=values[tab][0].map(normalizeHeader_);tables[tab]=sheetObjects_(sh);});
  function a1(row,col){let label='';for(;col>0;col=Math.floor((col-1)/26))label=String.fromCharCode(65+(col-1)%26)+label;return label+row;}
  const before=prvReconcileTables_(tables.Index,tables.Products);
  const report={mode:apply?'applied':'preflight',active_products:127,index_rows:tables.Index.length,product_rows:tables.Products.length,matched_index_rows:0,matched_product_rows:0,unchanged_cells:0,changes:0,cv_changes:0,source_aliases:[],derived_or_unmatched:[],backup_id:''};
  const text=v=>String(v==null?'':v).trim(),fold=v=>text(v).toLowerCase().replace(/\s+/g,' ');
  const active=new Set(index.index.map(e=>e.Code)),targets=registry.products.filter(e=>active.has(e.Code));
  function codes(code){const direct=index.index.filter(e=>e.Code===code).map(e=>e.Code);return direct.length?direct:((index.aliases||{})[code]||{}).products||[];}
  const spellings=new Map(targets.map(t=>[t.Code,[{name:t.DisplayName,year:t.year,sport:t.sport}]]));
  legacy.index.forEach(e=>codes(e.Code).forEach(code=>{if(spellings.has(code))spellings.get(code).push({name:e.DisplayName,year:e.year,sport:e.sport});}));
  (policy.reviewed_mappings||[]).forEach(r=>{if(spellings.has(r.canonical_code))spellings.get(r.canonical_code).push({name:r.source.DisplayName,year:r.source.year,sport:r.source.sport});});
  function matches(r,t){return spellings.get(t.Code).some(n=>fold(n.name)===fold(r.displayname||r.display_name)&&fold(n.sport)===fold(r.sport)&&(!text(r.year)||text(n.year)===text(r.year)));}
  function target(r,resolved){
   let candidates=targets.filter(t=>codes(resolved||text(r.code)).includes(t.Code)&&matches(r,t));
   if(!candidates.length)candidates=targets.filter(t=>matches(r,t));
   return candidates.length===1?candidates[0]:null;
  }
  const fields={displayname:'DisplayName',year:'year',sport:'sport',manufacturer:'manufacturer',product:'product'};
  tabs.forEach(tab=>tables[tab].forEach((r,i)=>{
   const t=target(r,tab==='Products'?before.products[i].code:r.code);if(!t)return;
   seen.add(t.Code);report[tab==='Index'?'matched_index_rows':'matched_product_rows']++;
   report.source_aliases.push({source_code:text(r.code),canonical_code:t.Code});
   const rowPlanStart=plan.length;
   Object.keys(fields).forEach(field=>{
    const col=headers[tab].indexOf(field);if(col<0)throw Error('Missing source metadata column '+tab+'/'+field);
    const old=values[tab][i+1][col],next=String(t[fields[field]]);
    const originalFormula=formulas[tab][i+1][col];let nextFormula='';
    if(originalFormula){
     const row=i+2,quote=s=>'"'+String(s).replace(/"/g,'""')+'"';
     const prefix='=IF(AND($A'+row+'='+quote(r.code)+',TO_TEXT($D'+row+')='+quote(t.year)+'),'+quote(t.DisplayName)+',';
     if(field==='displayname'&&originalFormula.indexOf(prefix)===0)nextFormula=originalFormula;
     else if(field==='displayname'&&originalFormula==='=IF(D'+row+'="","",TEXTJOIN(" ",TRUE,D'+row+',F'+row+',G'+row+',E'+row+'))')nextFormula=prefix+'('+originalFormula.slice(1)+'))';
     else throw Error('Unrecognized metadata formula preserved; review '+tab+'!'+a1(row,col+1));
    }
    if(String(old==null?'':old)===next&&(!originalFormula||originalFormula===nextFormula)){report.unchanged_cells++;return;}
    plan.push({ss:ssId,tab:tab,row:i+2,col:col+1,before:old,after:next,format:formats[tab][i+1][col],canonical_code:t.Code,formula_before:originalFormula||'',formula_after:nextFormula});
   });
   // Codes may themselves be formulas over year/manufacturer/family/sport.
   // Preserve their current identifier while the reviewed metadata is present,
   // and retain the original expression as a fallback for future source edits.
   const row=i+2,codeCol=headers[tab].indexOf('code'),codeFormula=formulas[tab][i+1][codeCol];
   if(codeFormula&&plan.slice(rowPlanStart).some(p=>['year','sport','manufacturer','product'].includes(headers[tab][p.col-1]))){
    const quote=v=>'"'+String(v).replace(/"/g,'""')+'"';
    const expected='=IF(D'+row+'="","",LOWER(REGEXREPLACE(TEXTJOIN("_",TRUE,D'+row+',F'+row+',G'+row+',E'+row+'),"[^A-Za-z0-9]+","_")))';
    if(codeCol!==0||codeFormula!==expected)throw Error('Unrecognized source code formula preserved; review '+tab+'!'+a1(row,codeCol+1));
    const guard=['TO_TEXT($D'+row+')='+quote(t.year),'$E'+row+'='+quote(t.sport),'$F'+row+'='+quote(t.manufacturer),'$G'+row+'='+quote(t.product)].join(',');
    plan.push({ss:ssId,tab:tab,row:row,col:codeCol+1,before:values[tab][i+1][codeCol],after:String(r.code),format:formats[tab][i+1][codeCol],canonical_code:t.Code,formula_before:codeFormula,formula_after:'=IF(AND('+guard+'),'+quote(r.code)+',('+codeFormula.slice(1)+'))'});
   }
  }));
  // Simulate the complete metadata patch before touching a cell. Exported row
  // routing and every non-metadata source value must remain byte-for-byte equal.
  const simulated={Index:tables.Index.map(r=>Object.assign({},r)),Products:tables.Products.map(r=>Object.assign({},r))};
  plan.forEach(p=>{simulated[p.tab][p.row-2][headers[p.tab][p.col-1]]=p.after;});
  const preview=prvReconcileTables_(simulated.Index,simulated.Products);
  if(JSON.stringify(before.products.map(r=>r.code))!==JSON.stringify(preview.products.map(r=>r.code)))throw Error('Metadata patch would change PRV routing; source remains unchanged.');
  const immutable=rows=>JSON.stringify(rows.map(r=>Object.fromEntries(Object.keys(r).filter(k=>!Object.keys(fields).includes(k)).map(k=>[k,r[k]]))));
  if(immutable(tables.Products)!==immutable(simulated.Products))throw Error('Unexpected quantity/code change; source remains unchanged.');
  // Four separately reviewed CV source metadata repairs.
  const cv=[['baseball','2024','2024_Bowmans_Best_Baseball','manufacturer',"Bomwan's",'Bowman'],['baseball','2025','2025_topps_heritage_high_number_baseball','product','Hertitage High Number','Heritage High Number'],['baseball','2024','2024_Topps_Chrome_Sapphire_Baseball','product','Chrome Logofractor','Chrome Sapphire'],['football','2026','2026_bowman_football','product','','Football']];
  cv.forEach(p=>{
   const book=SpreadsheetApp.openById(CM_CHECKLIST_DB_MAP[p[0]][p[1]]),sh=book.getSheetByName('Products'),v=sh.getDataRange().getValues(),h=v[0].map(normalizeHeader_);
   const matches=v.slice(1).map((r,i)=>({r:r,row:i+2})).filter(x=>text(x.r[h.indexOf('code')])===p[2]);
   if(matches.length!==1)throw Error('CV metadata target is not unique: '+p[2]);
   const col=h.indexOf(p[3]);if(col<0)throw Error('Missing CV metadata column');
   const old=matches[0].r[col];if(text(old)===p[5])return;if(text(old)!==p[4])throw Error('CV source changed; review '+p[2]);
   const cell=sh.getRange(matches[0].row,col+1);if(cell.getFormula())throw Error('CV metadata formula preserved');
   plan.push({ss:book.getId(),tab:'Products',row:matches[0].row,col:col+1,before:old,after:p[5],format:cell.getNumberFormat(),canonical_code:p[2]});report.cv_changes++;
  });
  report.changes=plan.length;report.source_aliases=Array.from(new Map(report.source_aliases.map(a=>[a.source_code+'|'+a.canonical_code,a])).values());
  report.derived_or_unmatched=index.index.filter(e=>!seen.has(e.Code)).map(e=>e.Code);
  if(apply&&plan.length){
   const snapshot=JSON.stringify({review:'registry-source-metadata-2026-10-25',source_revision:index.source_revision,created_at:new Date().toISOString(),cells:plan,aliases:report.source_aliases});
   const file=DriveApp.createFile('registry-source-metadata-backup-'+Date.now()+'.json',snapshot,MimeType.PLAIN_TEXT);
   if(file.getBlob().getDataAsString()!==snapshot)throw Error('Backup verification failed; source remains unchanged.');report.backup_id=file.getId();PropertiesService.getScriptProperties().setProperty('CM_REGISTRY_SOURCE_LAST_BACKUP',report.backup_id);
   const books=new Map([[ssId,ss]]);plan.forEach(p=>{if(!books.has(p.ss))books.set(p.ss,SpreadsheetApp.openById(p.ss));});
   function grids(){const out=new Map();plan.forEach(p=>{const k=p.ss+'|'+p.tab;if(!out.has(k))out.set(k,books.get(p.ss).getSheetByName(p.tab).getDataRange().getValues());});return out;}
   // Recheck every touched value before starting. Use small homogeneous range
   // batches so untouched rows and formulas are never rewritten.
   const current=grids();if(plan.some(p=>current.get(p.ss+'|'+p.tab)[p.row-1][p.col-1]!==p.before))throw Error('Source changed during preflight; source remains unchanged.');
   const written=[];
   try{
    const groups=new Map();plan.filter(p=>!p.formula_after).forEach(p=>{const key=JSON.stringify([p.ss,p.tab,p.col,p.after]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);});
    groups.forEach(group=>{for(let n=0;n<group.length;n+=150){const batch=group.slice(n,n+150),sh=books.get(batch[0].ss).getSheetByName(batch[0].tab);written.push(...batch);sh.getRangeList(batch.map(p=>a1(p.row,p.col))).setNumberFormat('@').setValue(batch[0].after);}});
    writeFormulas(plan.filter(p=>p.formula_after),'formula_after',true);
    SpreadsheetApp.flush();
    const verified=grids(),bad=plan.find(p=>String(verified.get(p.ss+'|'+p.tab)[p.row-1][p.col-1])!==p.after);if(bad)throw Error('Source write verification failed: '+JSON.stringify({tab:bad.tab,row:bad.row,col:bad.col,expected:bad.after,actual:verified.get(bad.ss+'|'+bad.tab)[bad.row-1][bad.col-1],formula:bad.formula_after||''}));
    const after=prvSourceTables_(ss);
    if(JSON.stringify(before.products.map(r=>r.code))!==JSON.stringify(after.products.map(r=>r.code)))throw Error('Source routing changed after write');
    if(immutable(tables.Products)!==immutable(sheetObjects_(ss.getSheetByName('Products'))))throw Error('Non-metadata cells changed');
   }catch(err){const undo=new Map();written.filter(p=>!p.formula_before).forEach(p=>{const k=JSON.stringify([p.ss,p.tab,p.col,p.before,p.format]);if(!undo.has(k))undo.set(k,[]);undo.get(k).push(p);});undo.forEach(group=>{for(let n=0;n<group.length;n+=150){const batch=group.slice(n,n+150);books.get(batch[0].ss).getSheetByName(batch[0].tab).getRangeList(batch.map(p=>a1(p.row,p.col))).setNumberFormat(batch[0].format).setValue(batch[0].before);}});writeFormulas(written.filter(p=>p.formula_before),'formula_before',false);SpreadsheetApp.flush();throw err;}
   function writeFormulas(items,field,track){
    const sorted=items.slice().sort((a,b)=>a.ss.localeCompare(b.ss)||a.tab.localeCompare(b.tab)||a.col-b.col||a.row-b.row);
    for(let n=0;n<sorted.length;){let end=n+1;while(end<sorted.length&&sorted[end].ss===sorted[n].ss&&sorted[end].tab===sorted[n].tab&&sorted[end].col===sorted[n].col&&sorted[end].row===sorted[end-1].row+1)end++;
     const batch=sorted.slice(n,end);if(track)written.push(...batch);
     books.get(batch[0].ss).getSheetByName(batch[0].tab).getRange(batch[0].row,batch[0].col,batch.length,1).setFormulas(batch.map(p=>[p[field]]));n=end;
    }
   }
  }
  PropertiesService.getScriptProperties().setProperty('CM_REGISTRY_SOURCE_LAST_AUDIT',JSON.stringify({at:new Date().toISOString(),mode:report.mode,changes:report.changes,backup_id:report.backup_id,derived_or_unmatched:report.derived_or_unmatched}));
  Logger.log('Registry source maintenance: '+JSON.stringify({mode:report.mode,active_products:report.active_products,matched_index_rows:report.matched_index_rows,matched_product_rows:report.matched_product_rows,source_targets:seen.size,changes:report.changes,cv_changes:report.cv_changes,unchanged_cells:report.unchanged_cells,source_alias_count:report.source_aliases.length,derived_or_unmatched:report.derived_or_unmatched,backup_id:report.backup_id}));return report;
 }finally{lock.releaseLock();}
}
