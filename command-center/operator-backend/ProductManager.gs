/* Private, derived inventory. All CV/PRV/D1 source operations are READ ONLY.
 * Deployment/setup is separate: see PRODUCT-MANAGER.md. No public refresh route.
 */
var PM_CV_URL = "https://app.chasingmajors.com/data/v1/checklists/index.json";
var PM_PRV_URL = "https://app.chasingmajors.com/data/v2/vault/index.json";
var PM_CV_BASE = "https://app.chasingmajors.com/data/v1/checklists/products/";
var PM_PRV_BASE = "https://app.chasingmajors.com/data/v2/vault/products/";
var PM_D1_ACCOUNT = "83cd48829e92ac6e4e15a25cb60cdf80";
var PM_D1_DATABASE = "9f264f1a-5a3b-4db5-b223-2c4c33af2c0f";
var PM_D1_PRODUCTS_SQL = "WITH selected AS (SELECT code, sport, displayName, manufacturer, product FROM products ORDER BY sport, code LIMIT ? OFFSET ?) SELECT p.code, p.sport, p.displayName, p.manufacturer, p.product, COUNT(c.rowid) AS raw_row_count, COALESCE(SUM(CASE WHEN c.type = 'card' THEN 1 ELSE 0 END), 0) AS row_count, COALESCE(SUM(CASE WHEN c.type = 'product' THEN 1 ELSE 0 END), 0) AS product_rows, COALESCE(SUM(CASE WHEN c.rowid IS NOT NULL AND (c.type IS NULL OR c.type NOT IN ('card','product')) THEN 1 ELSE 0 END), 0) AS other_rows FROM selected p LEFT JOIN cards c ON c.code = p.code AND c.sport = p.sport GROUP BY p.code, p.sport ORDER BY p.sport, p.code";
var PM_D1_ORPHANS_SQL = "SELECT c.code, c.sport, COUNT(*) AS raw_row_count, SUM(CASE WHEN c.type = 'card' THEN 1 ELSE 0 END) AS row_count, SUM(CASE WHEN c.type = 'product' THEN 1 ELSE 0 END) AS product_rows, SUM(CASE WHEN c.type IS NULL OR c.type NOT IN ('card','product') THEN 1 ELSE 0 END) AS other_rows FROM cards c WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.code = c.code AND p.sport = c.sport) GROUP BY c.code, c.sport";

function pmPublicJson_(url) {
  // Only fixed publisher hosts and relative, validated paths may reach here.
  if (!/^https:\/\/app\.chasingmajors\.com\/data\/(v1\/checklists\/|v2\/vault\/)/.test(url)) throw new Error("Source URL not allowed.");
  var r=UrlFetchApp.fetch(url,{muteHttpExceptions:true,followRedirects:true});
  var code=r.getResponseCode();
  if (code<200 || code>=300) { var err=new Error("Published source returned HTTP " + code); err.statusCode=code; throw err; }
  try { return JSON.parse(r.getContentText()); } catch (_) { throw new Error("Published source contains invalid JSON."); }
}
function pmPath_(path) {
  if (typeof path!=="string" || !/^[a-zA-Z0-9_./-]+\.json$/.test(path) || path.indexOf("..")!==-1 || path[0]==="/") throw new Error("Invalid published path.");
  return path.split("/").map(encodeURIComponent).join("/");
}
function pmD1Query_(sql, params) {
  var token=PropertiesService.getScriptProperties().getProperty("CM_PM_D1_READ_TOKEN");
  if (!token) throw new Error("D1 read credential not configured.");
  // No client-controlled SQL, account, database, or endpoint.
  if ([PM_D1_PRODUCTS_SQL,PM_D1_ORPHANS_SQL].indexOf(sql)<0) throw new Error("Query not allowed.");
  var r=UrlFetchApp.fetch("https://api.cloudflare.com/client/v4/accounts/"+PM_D1_ACCOUNT+"/d1/database/"+PM_D1_DATABASE+"/query",{
    method:"post",contentType:"application/json",headers:{Authorization:"Bearer "+token},payload:JSON.stringify({sql:sql,params:params}),muteHttpExceptions:true});
  if (r.getResponseCode()!==200) throw new Error("D1 returned HTTP "+r.getResponseCode()+".");
  var data=JSON.parse(r.getContentText());
  if (!data.success || !data.result || data.result.some(function(x){return x.success===false;})) throw new Error("D1 query did not succeed.");
  return data.result[0].results;
}
function pmD1Inventory_() {
  var entries=[], batch;
  for (var offset=0;offset<10000;offset+=500) {
    batch=pmD1Query_(PM_D1_PRODUCTS_SQL,[500,offset]);
    entries=entries.concat(batch);
    if (batch.length<500) break;
  }
  if (offset>=10000) throw new Error("D1 inventory limit reached; no partial inventory accepted.");
  // Preserve card groups lacking a product-table entry; never silently drop them.
  entries=entries.concat(pmD1Query_(PM_D1_ORPHANS_SQL,[]).map(function(e){return Object.assign({},e,{displayName:e.code,orphan:true});}));
  return {ok:true,entries:entries,observed_at:new Date().toISOString(),scope:"Card records only (type=card); product-summary rows and other types excluded. Import scope equivalence to JSON remains unverified."};
}
function pmChunks_(text, size) {
  var chunks=[];
  for (var start=0;start<text.length;) {
    var end=Math.min(start+size,text.length);
    if (end<text.length && /[\uD800-\uDBFF]/.test(text[end-1])) end--;
    chunks.push(text.slice(start,end)); start=end;
  }
  return chunks;
}
function pmStorage_(id) {
  // Reuse Sentinel's existing Spreadsheet permission, rather than request broad
  // Drive access. This dedicated private workbook is an AUTOMATIC cache only.
  var book=SpreadsheetApp.openById(id);
  var pointer=book.getSheetByName("PM Cache Manifest");
  var a=book.getSheetByName("PM Cache A"), b=book.getSheetByName("PM Cache B");
  if (!pointer || !a || !b) throw new Error("Not a Product Manager cache workbook; refusing access.");
  return {
    read:function() {
      var value=pointer.getRange(1,1,1,2).getValues()[0];
      if (["PM Cache A","PM Cache B"].indexOf(value[0])<0 || !Number.isInteger(value[1]) || value[1]<1 || value[1]>1000) throw new Error("Private inventory has no complete checkpoint.");
      return book.getSheetByName(value[0]).getRange(1,1,value[1],1).getValues().map(function(r){
        if (typeof r[0]!=="string" || r[0].slice(0,3)!=="pm:") throw new Error("Invalid inventory checkpoint chunk.");
        return r[0].slice(3);
      }).join("");
    },
    write:function(text) {
      var active=pointer.getRange(1,1).getValue();
      var target=active==="PM Cache A"?b:a, chunks=pmChunks_(text,30000);
      if (chunks.length>1000) throw new Error("Inventory cache size limit exceeded.");
      if (target.getMaxRows()<chunks.length) target.insertRowsAfter(target.getMaxRows(),chunks.length-target.getMaxRows());
      target.clearContents(); // Only the inactive tab of this dedicated cache.
      // Prefix every chunk so a boundary can never turn source text into a Sheet formula.
      target.getRange(1,1,chunks.length,1).setNumberFormat("@").setValues(chunks.map(function(s){return ["pm:"+s];}));
      SpreadsheetApp.flush();
      // Commit pointer LAST. A failed write leaves the previous snapshot usable.
      pointer.getRange(1,1,1,2).setValues([[target.getName(),chunks.length]]);
    }
  };
}
function pmReadSnapshot_() {
  var cache=CacheService.getScriptCache();
  var head=cache.get("pm:snapshot:head");
  if (head) {
    try {
      var meta=JSON.parse(head), keys=[];
      for (var n=0;n<meta.parts;n++) keys.push("pm:"+meta.version+":"+n);
      var chunks=cache.getAll(keys);
      if (keys.every(function(k){return typeof chunks[k]==="string";})) {
        var cached=JSON.parse(keys.map(function(k){return chunks[k];}).join(""));
        if (cached.schema!==1) throw new Error("Invalid cached schema.");
        return cached;
      }
    } catch(_) { /* Cache eviction/corruption falls back to the private checkpoint. */ }
  }
  var props=PropertiesService.getScriptProperties();
  var id=props.getProperty("CM_PM_INVENTORY_SHEET_ID");
  if (!id) throw new Error("Product Manager is not initialized. An administrator must configure the private inventory first.");
  var snapshot=JSON.parse(pmStorage_(id).read());
  if (snapshot.schema!==1) throw new Error("Unsupported inventory schema.");
  var serialized=JSON.stringify(snapshot), version=String(Date.now())+"-"+Math.random().toString(36).slice(2), values={}, chunks=pmChunks_(serialized,16000), parts=chunks.length;
  // Stay below CacheService's per-value byte limit even with Unicode metadata.
  if (parts<500) {
    for (var i=0;i<parts;i++) values["pm:"+version+":"+i]=chunks[i];
    cache.putAll(values,300);
    cache.put("pm:snapshot:head",JSON.stringify({version:version,parts:parts}),300);
  }
  return snapshot;
}
function pmSaveSnapshot_(snapshot) {
  var props=PropertiesService.getScriptProperties(), id=props.getProperty("CM_PM_INVENTORY_SHEET_ID");
  if (!id) throw new Error("Private inventory is not initialized.");
  snapshot.generated_at=new Date().toISOString();
  pmStorage_(id).write(JSON.stringify(snapshot));
  CacheService.getScriptCache().remove("pm:snapshot:head");
}
function pmList_(body) {
  requireOperatorKey_(body.key); // Before validation, cache, private storage, or source access.
  pmInput_(body);
  return pmPage_(pmReadSnapshot_(),body);
}
function pmDetail_(body) {
  requireOperatorKey_(body.key);
  var input=pmInput_(body), snapshot=pmReadSnapshot_();
  var row=pmInventory_(snapshot).find(function(r){return r.id===input.id;});
  if (!row) return {ok:false,error:"Product not found in the current inventory."};
  // Details use the same observed inventory, not an unbounded live card query.
  return {ok:true,generated_at:snapshot.generated_at,product:row,sources:{cv:snapshot.cv && {observed_at:snapshot.cv.observed_at,revision:snapshot.cv.revision,url:PM_CV_URL,error:snapshot.cv.error},
    d1:snapshot.d1 && {observed_at:snapshot.d1.observed_at,scope:snapshot.d1.scope,error:snapshot.d1.error,url:"https://dash.cloudflare.com/"+PM_D1_ACCOUNT+"/workers/d1/databases/"+PM_D1_DATABASE+"/metrics"},
    prv:snapshot.prv && {observed_at:snapshot.prv.observed_at,revision:snapshot.prv.revision,url:PM_PRV_URL,error:snapshot.prv.error}},
    validation:"Complete is reserved for a full feature-specific validation certificate. Current checks establish availability and structural issues only.",
    freshness:"Observation times show when these published sources were checked. They are not source-authoring or D1-import timestamps; synchronization age cannot be certified."};
}

// Owner/editor-only setup; never routed through doGet/doPost. Run once ONLY after
// deployment approval. This workbook contains derived metadata, no cards, and
// reuses the existing Spreadsheet scope. Never share it or edit it as source data.
function productManagerInitialize() {
  var props=PropertiesService.getScriptProperties();
  if (props.getProperty("CM_PM_INVENTORY_SHEET_ID")) throw new Error("Inventory already configured; existing cache preserved.");
  var book=SpreadsheetApp.create("Sentinel Product Manager — derived cache (do not edit)");
  book.getSheets()[0].setName("PM Cache A"); book.insertSheet("PM Cache B"); book.insertSheet("PM Cache Manifest");
  pmStorage_(book.getId()).write(JSON.stringify({schema:1,cv_facts:{},prv_facts:{}}));
  props.setProperty("CM_PM_INVENTORY_SHEET_ID",book.getId());
  return {ok:true,cache_url:book.getUrl(),note:"Keep this cache private. Run productManagerRefresh, then optionally install a five-minute trigger for that function."};
}
function pmIndex_(url, previous) {
  try {
    var payload=pmPublicJson_(url);
    if (!Array.isArray(payload.index)) throw new Error("Published index is invalid.");
    return {ok:true,entries:payload.index.map(function(e){return e && typeof e==="object" && !Array.isArray(e)?e:{invalid_source_record:true};}),revision:payload.generated_at || payload.source_revision || "unknown",observed_at:new Date().toISOString()};
  } catch(err) {
    return Object.assign({},previous || {entries:[]},{ok:false,error:err.message});
  }
}
function pmCvJobs_(snapshot) {
  var grouped={}, errors=[];
  var sports=Array.from(new Set(snapshot.cv.entries.map(function(e){return pmText_(e.sport).toLowerCase();})));
  sports.forEach(function(sport){
    try {
      var manifest=pmPublicJson_(PM_CV_BASE+pmPath_(sport+".json"));
      if (!manifest.product_map || typeof manifest.product_map!=="object") throw new Error("CV sport manifest lacks product_map.");
      snapshot.cv.entries.filter(function(e){return pmText_(e.sport).toLowerCase()===sport;}).forEach(function(e){
        var code=pmText_(e.Code), key=pmKey_(e.sport,code), file=manifest.product_map[code];
        if (!file) { snapshot.cv_facts[key]={state:"missing",error:"CV index entry has no product-map location."}; return; }
        try {
          var url=PM_CV_BASE+pmPath_(file);
          if (!grouped[url]) grouped[url]={url:url,items:[]};
          grouped[url].items.push({key:key,code:code});
        } catch(err) { snapshot.cv_facts[key]={state:"invalid",error:err.message}; }
      });
    } catch(err) { errors.push(sport+": "+err.message); }
  });
  snapshot.manifest_errors=errors;
  return Object.keys(grouped).map(function(k){return grouped[k];});
}
function pmRefreshJobs_(snapshot, limit, deadline) {
  var now=new Date().toISOString();
  for (var i=0;i<limit && snapshot.pending_cv.length && Date.now()<deadline;i++) {
    var job=snapshot.pending_cv.shift();
    try {
      var shard=pmPublicJson_(job.url);
      job.items.forEach(function(item){snapshot.cv_facts[item.key]=pmCvFact_((shard.products || {})[item.code],item.code,job.url,now);});
    } catch(err) {
      job.items.forEach(function(item){snapshot.cv_facts[item.key]={state:err.statusCode===404?"missing":"unavailable",error:err.message,url:job.url,observed_at:now};});
    }
  }
  for (var j=0;j<limit && snapshot.pending_prv.length && Date.now()<deadline;j++) {
    var e=snapshot.pending_prv.shift(), key=pmKey_(e.sport,e.Code);
    try {
      var url=PM_PRV_BASE+pmPath_(e.file);
      snapshot.prv_facts[key]=pmPrvFact_(pmPublicJson_(url),e.Code,url,now);
    } catch(err) { snapshot.prv_facts[key]={state:err.statusCode===404?"missing":"unavailable",error:err.message,observed_at:now}; }
  }
  snapshot.progress={cv_files_remaining:snapshot.pending_cv.length,prv_files_remaining:snapshot.pending_prv.length,manifest_errors:snapshot.manifest_errors || []};
}
function pmResumeJobs_(previous, next, key) {
  var current=new Map(next.map(function(e){return [key(e),e];})), ordered=[];
  (previous || []).forEach(function(e){var k=key(e);if(current.has(k)){ordered.push(current.get(k));current.delete(k);}});
  current.forEach(function(e){ordered.push(e);});
  return ordered;
}
// Bounded refresh for an owner-installed time trigger. It modifies ONLY our
// private derived inventory. Lists/details never trigger full-source scans.
function pmRefreshLease_() {
  var lock=LockService.getScriptLock();
  if (!lock.tryLock(1000)) return null;
  try {
    var props=PropertiesService.getScriptProperties(), current=props.getProperty("CM_PM_REFRESH_LEASE");
    if (current && JSON.parse(current).until>Date.now()) return null;
    var lease={token:String(Date.now())+"-"+Math.random().toString(36).slice(2),until:Date.now()+8*60000};
    props.setProperty("CM_PM_REFRESH_LEASE",JSON.stringify(lease));
    return lease;
  } finally { lock.releaseLock(); }
}
function pmReleaseLease_(lease) {
  var lock=LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // Expiry recovers a lease if an import is busy.
  try {
    var props=PropertiesService.getScriptProperties(), current=props.getProperty("CM_PM_REFRESH_LEASE");
    if (current && JSON.parse(current).token===lease.token) props.deleteProperty("CM_PM_REFRESH_LEASE");
  } finally { lock.releaseLock(); }
}
function pmD1Due_(snapshot, now) {
  if (!snapshot.d1_checked_at) return true;
  if (snapshot.d1 && !snapshot.d1.ok) {
    // A newly configured credential must work immediately after installation,
    // rather than waiting for yesterday's "not configured" attempt to expire.
    if (/credential not configured/.test(snapshot.d1.error || "") && PropertiesService.getScriptProperties().getProperty("CM_PM_D1_READ_TOKEN")) return true;
    return now-Date.parse(snapshot.d1_checked_at)>3600000;
  }
  return now-Date.parse(snapshot.d1_checked_at)>86400000;
}
function productManagerRefresh(force) {
  var forceRead=force===true; // Only the owner wrapper passes true; trigger event objects do not.
  var lease=pmRefreshLease_();
  if (!lease) return {ok:false,busy:true};
  try {
    var snapshot=pmReadSnapshot_(), now=Date.now(), deadline=now+210000;
    if (!forceRead && snapshot.index_checked_at && now-Date.parse(snapshot.index_checked_at)<3600000 && !pmD1Due_(snapshot,now) && !(snapshot.pending_cv || []).length && !(snapshot.pending_prv || []).length) return {ok:true,unchanged:true};
    if (forceRead || !snapshot.index_checked_at || now-Date.parse(snapshot.index_checked_at)>3600000) {
      var oldCv=snapshot.cv && snapshot.cv.revision, oldPrv=snapshot.prv && snapshot.prv.revision;
      snapshot.cv=pmIndex_(PM_CV_URL,snapshot.cv);
      snapshot.prv=pmIndex_(PM_PRV_URL,snapshot.prv);
      snapshot.cv_facts=snapshot.cv_facts || {}; snapshot.prv_facts=snapshot.prv_facts || {};
      var daily=!snapshot.cycle_at || now-Date.parse(snapshot.cycle_at)>86400000;
      if (snapshot.cv.ok && (daily || oldCv!==snapshot.cv.revision)) {
        // Preserve unfinished work when another publication arrives mid-sweep.
        // Retain last-observed counts with their original file-check timestamps.
        snapshot.pending_cv=pmResumeJobs_(snapshot.pending_cv,pmCvJobs_(snapshot),function(job){return job.url;});
      }
      if (snapshot.prv.ok && (daily || oldPrv!==snapshot.prv.revision)) {
        snapshot.pending_prv=pmResumeJobs_(snapshot.pending_prv,snapshot.prv.entries,function(e){return pmKey_(e.sport,e.Code);});
      }
      if (daily) snapshot.cycle_at=new Date(now).toISOString();
      snapshot.index_checked_at=new Date(now).toISOString();
    }
    if (forceRead || pmD1Due_(snapshot,now)) {
      try { snapshot.d1=pmD1Inventory_(); }
      catch(err) { snapshot.d1=Object.assign({},snapshot.d1 || {entries:[]},{ok:false,error:err.message}); }
      snapshot.d1_checked_at=new Date(now).toISOString();
    }
    snapshot.pending_cv=snapshot.pending_cv || []; snapshot.pending_prv=snapshot.pending_prv || [];
    pmRefreshJobs_(snapshot,20,deadline);
    pmSaveSnapshot_(snapshot);
    return {ok:true,progress:snapshot.progress};
  } finally { pmReleaseLease_(lease); }
}

// Editor-only owner controls; never dispatched by doGet/doPost.
function productManagerRefreshNow() { return productManagerRefresh(true); }
function installProductManagerRefreshTrigger() {
  var existing=ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==="productManagerRefresh";});
  if (existing.length) return {ok:true,existing:existing.length};
  ScriptApp.newTrigger("productManagerRefresh").timeBased().everyMinutes(5).create();
  return {ok:true,created:true};
}
