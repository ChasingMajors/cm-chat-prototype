/* Product Manager: pure reconciliation and paging. No source writes. */
var PM_SPORTS = ["Baseball", "Basketball", "Football", "Hockey", "Soccer", "Other"];
var PM_STATUSES = ["Complete", "Partial", "Missing", "Sync Issue", "Not Verified"];

function pmText_(v) { return typeof v === "string" || typeof v === "number" ? String(v).trim() : ""; }
function pmSport_(raw) {
  var s = pmText_(raw).toLowerCase();
  var aliases = {mlb:"Baseball", nba:"Basketball", wnba:"Basketball", nfl:"Football", nhl:"Hockey", futbol:"Soccer", football_soccer:"Soccer"};
  if (aliases[s]) return aliases[s];
  // D1 currently contains full display names in sport. Recognize explicit sport
  // tokens for classification only; never use inferred names to merge products.
  var hits = PM_SPORTS.slice(0, 5).filter(function(x) { return new RegExp("\\b" + x.toLowerCase() + "\\b").test(s); });
  return hits.length === 1 ? hits[0] : "Other";
}
function pmCount_(v) { return Number.isSafeInteger(v) && v >= 0 ? v : null; }
function pmSportKey_(raw) { var sport=pmSport_(raw); return sport==="Other"?"Other:"+(pmText_(raw).toLowerCase() || "unclassified"):sport; }
function pmKey_(sport, code) { return pmSportKey_(sport) + "|" + code; }
function pmYear_(e) { return pmText_(e.year) || (pmText_(e.DisplayName || e.displayName).match(/\b(?:19|20)\d{2}(?:[-–]\d{2,4})?\b/) || [""])[0]; }
function pmSource_(s) { return s && Array.isArray(s.entries) ? s : {ok:false, entries:[], error:"Source not checked"}; }
function pmStale_(s, now) { return !s.observed_at || now - Date.parse(s.observed_at) > 30 * 3600000; }

function pmInventory_(snapshot, now) {
  now = now || Date.now();
  var sources = {json:pmSource_(snapshot.cv), d1:pmSource_(snapshot.d1), prv:pmSource_(snapshot.prv)};
  var groups = new Map();
  Object.keys(sources).forEach(function(source) {
    sources[source].entries.forEach(function(e, i) {
      if (!e || typeof e!=="object" || Array.isArray(e)) e={invalid_source_record:true};
      var code = pmText_(e.Code || e.code);
      var key = code ? pmKey_(e.sport, code) : source + ":unidentified:" + i;
      if (!groups.has(key)) groups.set(key, {id:key, refs:{json:[], d1:[], prv:[]}});
      groups.get(key).refs[source].push(e);
    });
  });
  var exactNames = new Map();
  groups.forEach(function(g) {
    var e=g.refs.json[0] || g.refs.prv[0] || g.refs.d1[0];
    var name=pmText_(e.DisplayName || e.displayName).toLowerCase().replace(/\s+/g," ");
    if (!name || !pmYear_(e) || !pmText_(e.Code || e.code)) return;
    var k=pmSportKey_(e.sport)+"|"+pmYear_(e)+"|"+name;
    if (!exactNames.has(k)) exactNames.set(k,[]);
    exactNames.get(k).push(g);
  });
  exactNames.forEach(function(matches) {
    if (matches.length<2) return;
    var totals={json:0,d1:0,prv:0};
    matches.forEach(function(g){Object.keys(totals).forEach(function(k){totals[k]+=g.refs[k].length;});});
    if (Object.keys(totals).some(function(k){return totals[k]>1;})) {
      matches.forEach(function(g){g.ambiguous=true;}); return;
    }
    matches.sort(function(a,b){return (a.refs.json.length?0:a.refs.prv.length?1:2)-(b.refs.json.length?0:b.refs.prv.length?1:2);});
    var target=matches[0]; target.match="Unique exact name, year, and normalized sport across sources";
    matches.slice(1).forEach(function(g){Object.keys(totals).forEach(function(k){target.refs[k]=target.refs[k].concat(g.refs[k]);}); groups.delete(g.id);});
  });
  return Array.from(groups.values()).map(function(group) {
    var refs = group.refs;
    var all = [].concat(refs.json, refs.d1, refs.prv);
    var first = refs.json[0] || refs.prv[0] || refs.d1[0];
    var code = pmText_(first.Code || first.code);
    var product = pmText_(first.DisplayName || first.displayName || first.product) || code || "Unidentified product";
    var sport = pmSport_(first.sport);
    var issues = [];
    function issue(kind, message) { issues.push({kind:kind, message:message}); }
    var duplicate = Object.keys(refs).some(function(k) { return refs[k].length > 1; });
    if (duplicate) issue("sync", "Duplicate identifier within a source; counts are not combined. Inspect each source record.");
    if (group.ambiguous) issue("identity", "Ambiguous exact-name match; products retained separately until identifiers are verified.");
    if (refs.d1.some(function(e){return e.orphan;})) issue("sync", "D1 card records have no corresponding products-table entry.");
    if (refs.d1.some(function(e){return e.other_rows>0;})) issue("count_review", "D1 contains additional row types excluded from the card count; inspect import scope.");
    if (!code) issue("sync", "Product identifier missing; record retained separately.");
    if (all.some(function(e){return e.invalid_source_record;})) issue("sync","Malformed source record retained for review.");
    var names = Array.from(new Set(all.map(function(e) { return pmText_(e.DisplayName || e.displayName).toLowerCase().replace(/\s+/g, " "); }).filter(Boolean)));
    if (names.length > 1) issue("sync", "Conflicting product names for the same sport and code.");
    var years = Array.from(new Set(all.map(pmYear_).filter(Boolean)));
    if (years.length > 1) issue("sync", "Conflicting release years.");
    var makers = Array.from(new Set(all.map(function(e) { return pmText_(e.manufacturer).toLowerCase(); }).filter(Boolean)));
    if (makers.length > 1) issue("sync", "Conflicting manufacturers.");
    if (sport === "Other") issue("classification", "Unclassified or other sport; original classification retained in source details.");
    var facts = snapshot.cv_facts || {};
    var fact = refs.json.length === 1 ? facts[pmKey_(first.sport, code)] : null;
    var j = fact && fact.state === "ok" ? pmCount_(fact.rows) : null;
    var d = refs.d1.length === 1 ? pmCount_(refs.d1[0].row_count) : null;
    var p = refs.prv.length === 1 ? pmCount_(refs.prv[0].row_count) : null;
    var cvSync = duplicate || !code || names.length > 1 || years.length > 1 || makers.length > 1 || refs.d1.some(function(e){return e.orphan;});
    var prvSync = refs.prv.length > 1;
    if (refs.prv.some(function(e){return e.status==="empty" && e.row_count>0 || e.status==="ok" && e.row_count===0;})) { prvSync=true; issue("sync","PRV index availability status conflicts with its row count."); }
    var dReliable = sources.d1.ok && !pmStale_(sources.d1, now);
    var jReliable = sources.json.ok && !pmStale_(sources.json, now);
    var pReliable = sources.prv.ok && !pmStale_(sources.prv, now);
    if (refs.json.length && !refs.d1.length && dReliable) { cvSync = true; issue("sync", "Product indexed in CV JSON but absent from the D1 inventory."); }
    if (refs.d1.length && !refs.json.length && jReliable) { cvSync = true; issue("sync", "Product in D1 but absent from the CV JSON index."); }
    if (fact && fact.state !== "ok") {
      if (fact.state!=="unavailable") cvSync=true;
      issue(fact.state==="unavailable"?"source":"sync", fact.error || "Indexed CV source could not be read.");
    }
    // D1's exact imported scope is not yet established. A difference is a review
    // signal, not proof of faulty synchronization.
    if (j !== null && d !== null && j !== d) issue("count_review", "D1 and JSON checklist row counts differ; import scope requires verification (JSON parallel definitions counted separately).");
    var cvStatus = cvSync ? "Sync Issue" : "Not Verified";
    if (!cvSync && fact && fact.invalid_rows > 0) cvStatus = "Partial";
    if (!cvSync && dReliable && jReliable && (d === null || d === 0) && (!refs.json.length || j === 0)) cvStatus = "Missing";
    var pv=refs.prv[0];
    var pvFact = pv && (snapshot.prv_facts || {})[pmKey_(pv.sport,pv.Code || pv.code)];
    var pvCurrent = !pvFact || !pvFact.revision || !sources.prv.revision || pvFact.revision===sources.prv.revision;
    if (!pvCurrent) issue("stale","PRV publication changed; file verification is pending. Previous file counts retain their original observation time.");
    if (pvCurrent && pvFact && pvFact.state !== "ok") {
      var expectedEmpty=p===0 && pvFact.state==="missing";
      if (pvFact.state!=="unavailable" && !expectedEmpty) prvSync=true;
      issue(expectedEmpty?"missing":pvFact.state==="unavailable"?"source":"sync", pvFact.error || "Indexed PRV source could not be read.");
    }
    if (pvCurrent && pvFact && pvFact.state === "ok" && p !== null && pvFact.rows !== p) { prvSync = true; issue("sync", "PRV index count differs from its published file."); }
    var prvStatus = prvSync ? "Sync Issue" : pReliable && (!refs.prv.length || p === 0) ? "Missing" : "Not Verified";
    if (!prvSync && pvCurrent && pvFact && pvFact.flagged_records > 0 && p > 0) prvStatus = "Partial";
    // No source provides a reliable full-completeness certificate. Positive
    // counts alone intentionally never produce Complete.
    if (cvStatus === "Missing") issue("missing", "No CV card records found in the checked sources.");
    if (prvStatus === "Missing") issue("missing", "No published PRV rows found.");
    Object.keys(sources).forEach(function(k) {
      if (!sources[k].ok) issue("source", k + ": " + (sources[k].error || "Unavailable"));
      else if (pmStale_(sources[k], now)) issue("stale", k + " inventory is older than 30 hours or has no observation time.");
    });
    [fact,pvFact].filter(Boolean).forEach(function(f){if(f.observed_at && pmStale_(f,now)) issue("stale","Published file verification is older than 30 hours.");});
    var authoritativeD1 = d !== null && dReliable;
    var count = authoritativeD1 ? d : j;
    var countSource = authoritativeD1 ? "D1" : j !== null ? "JSON" : null;
    if (count===null && cvStatus==="Missing") { count=0; countSource="Missing"; }
    var prvCount=p===null && !refs.prv.length && pReliable ? 0 : p;
    return {
      id:group.id, code:code, product:product, sport:sport, year:pmYear_(first), manufacturer:pmText_(first.manufacturer),
      search_text:all.map(function(e){return [e.Code,e.code,e.DisplayName,e.displayName,e.manufacturer,e.year].map(pmText_).join(" ");}).join(" ").toLowerCase(),
      cv_count:count, cv_source:countSource, cv_status:cvStatus, prv_count:prvCount, prv_source:refs.prv.length?"JSON":prvCount===0?"Missing":null, prv_status:prvStatus,
      cv_json_count:j===null && !refs.json.length && jReliable?0:j,
      d1_count:d===null && !refs.d1.length && dReliable?0:d, cv_parallel_count:fact ? pmCount_(fact.parallels) : null,
      cv_present:(d !== null && d > 0) || (j !== null && j > 0), prv_present:p !== null && p > 0,
      attention:issues.length > 0 || cvStatus === "Partial" || prvStatus === "Partial",
      issues:issues, refs:refs, identity_match:group.match || "Exact product identifier and normalized sport", cv_fact:fact || null, prv_fact:pvFact || null
    };
  });
}

function pmInput_(body) {
  var b = body || {};
  var sport = b.sport || "Baseball";
  if (PM_SPORTS.indexOf(sport) < 0) throw new Error("Invalid sport.");
  var sort = b.sort || "product";
  if (["product","sport","year","cv_count","cv_status","prv_count","prv_status"].indexOf(sort) < 0) throw new Error("Invalid sort.");
  var direction = b.direction || "asc";
  if (["asc","desc"].indexOf(direction) < 0) throw new Error("Invalid direction.");
  ["q","year","manufacturer","id"].forEach(function(k) { if (b[k] !== undefined && (typeof b[k] !== "string" || b[k].length > (k === "id" ? 400 : 150))) throw new Error("Invalid " + k + "."); });
  ["cv_status","prv_status"].forEach(function(k) { if (b[k] && PM_STATUSES.indexOf(b[k]) < 0) throw new Error("Invalid status."); });
  if (b.filter && ["attention","missing","sync"].indexOf(b.filter) < 0) throw new Error("Invalid filter.");
  var page = b.page === undefined ? 1 : Number(b.page);
  if (!Number.isInteger(page) || page < 1 || page > 100000) throw new Error("Invalid page.");
  return Object.assign({}, b, {sport:sport, sort:sort, direction:direction, page:page, page_size:40});
}
function pmPage_(snapshot, body, now) {
  var input = pmInput_(body);
  var all = pmInventory_(snapshot, now);
  if (!all.length && ![snapshot.cv,snapshot.d1,snapshot.prv].some(function(s){return s && s.ok;})) throw new Error("Inventory unavailable: no source has been verified yet.");
  var sportRows = all.filter(function(r) { return r.sport === input.sport; });
  var rows = sportRows.filter(function(r) {
    return (!input.q || r.search_text.indexOf(input.q.toLowerCase()) !== -1) &&
      (!input.year || r.year === input.year) && (!input.manufacturer || r.manufacturer === input.manufacturer) &&
      (!input.cv_status || r.cv_status === input.cv_status) && (!input.prv_status || r.prv_status === input.prv_status) &&
      (!input.filter || (input.filter === "attention" ? r.attention : input.filter === "missing" ? r.cv_status === "Missing" || r.prv_status === "Missing" : r.cv_status === "Sync Issue" || r.prv_status === "Sync Issue"));
  });
  rows.sort(function(a,b) {
    var x=a[input.sort], y=b[input.sort];
    if (x === null && y !== null) return 1;
    if (y === null && x !== null) return -1;
    var c=typeof x === "number" && typeof y === "number" ? x-y : pmText_(x).localeCompare(pmText_(y), "en", {numeric:true});
    return (input.direction === "desc" ? -c : c) || a.id.localeCompare(b.id);
  });
  var total=rows.length, page=Math.min(input.page, Math.max(1,Math.ceil(total/input.page_size)));
  return {
    ok:true, generated_at:snapshot.generated_at, sources:{json:snapshot.cv && {ok:snapshot.cv.ok, observed_at:snapshot.cv.observed_at, revision:snapshot.cv.revision, error:snapshot.cv.error},
      d1:snapshot.d1 && {ok:snapshot.d1.ok, observed_at:snapshot.d1.observed_at, error:snapshot.d1.error}, prv:snapshot.prv && {ok:snapshot.prv.ok, observed_at:snapshot.prv.observed_at, revision:snapshot.prv.revision, error:snapshot.prv.error}},
    progress:snapshot.progress || null,
    sports:PM_SPORTS.map(function(s) { return {sport:s,count:all.filter(function(r) { return r.sport===s; }).length}; }),
    summary:{total:sportRows.length,cv:sportRows.filter(function(r){return r.cv_present;}).length,prv:sportRows.filter(function(r){return r.prv_present;}).length,attention:sportRows.filter(function(r){return r.attention;}).length},
    years:Array.from(new Set(sportRows.map(function(r){return r.year;}).filter(Boolean))).sort().reverse(),
    manufacturers:Array.from(new Set(sportRows.map(function(r){return r.manufacturer;}).filter(Boolean))).sort(),
    total:total,page:page,page_size:input.page_size,
    rows:rows.slice((page-1)*input.page_size,page*input.page_size).map(function(r) { var out=Object.assign({},r); delete out.refs; delete out.cv_fact; delete out.prv_fact; delete out.search_text; return out; })
  };
}

function pmCvFact_(product, expectedCode, url, observed) {
  if (!product || !Array.isArray(product.rows)) return {state:"invalid",error:"CV payload lacks a rows array.",url:url,observed_at:observed};
  if (product.meta && product.meta.code && product.meta.code !== expectedCode) return {state:"invalid",error:"CV payload identifier differs from its index.",url:url,observed_at:observed};
  return {state:"ok", rows:product.rows.length, parallels:Array.isArray(product.parallels)?product.parallels.length:null,
    invalid_rows:product.rows.filter(function(r){return !r || typeof r !== "object" || (!pmText_(r.player) && !pmText_(r.card_no));}).length,
    url:url,observed_at:observed,validation:"Structural checks only; checklist completeness not certified."};
}
function pmPrvFact_(payload, code, url, observed) {
  if (!payload || !Array.isArray(payload.rows) || !payload.meta || payload.meta.code !== code) return {state:"invalid",error:"Invalid PRV rows or mismatched product identifier.",url:url,observed_at:observed};
  return {state:"ok",rows:payload.rows.length,flagged_records:payload.rows.filter(function(r){return !r || !pmText_(r.set_name) || Array.isArray(r.issues) && r.issues.length>0;}).length,
    url:url,observed_at:observed,revision:payload.source_revision,validation:"Published row issues and schema checked; full print-run coverage not certified."};
}
