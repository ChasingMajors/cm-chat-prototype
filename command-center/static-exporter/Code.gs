/*******************************************************
 * Chasing Majors — Static Data Exporter
 *
 * Purpose:
 * - Keep Google Sheets as the source of truth.
 * - Generate fast static JSON files for GitHub Pages under /data/v1.
 * - Let the live app use static JSON first and Apps Script as fallback.
 *
 * How to use:
 * 1. Paste this into a standalone Apps Script project or your admin script.
 * 2. Run exportAllStaticData().
 * 3. Copy the generated Drive folder contents into GitHub at /data/v1.
 * 4. Optional: add a time trigger for exportAllStaticData daily/hourly.
 *******************************************************/

const CM_EXPORT_ROOT_FOLDER = "CM Static Data Export";
const CM_EXPORT_VERSION = "2026-10-15-exporter-pipeline-v2";
const CM_DRIVE_WRITE_RETRIES = 5;
const CM_DRIVE_WRITE_PAUSE_MS = 250;
const CM_DRIVE_WRITE_THROTTLE_EVERY = 20;
const CM_WRITE_PER_PRODUCT_FILES = false;
const CM_WRITE_PER_POP_FILES = false;
const CM_WRITE_MERGED_SEARCH_FILE = false;
const CM_MAX_JSON_SHARD_CHARS = 4000000;
const CM_GITHUB_API_RETRIES = 5;
const CM_GITHUB_API_RETRY_PAUSE_MS = 750;
const CM_MLB_STATS_PAGE_SIZE = 500;
const CM_MLB_PEOPLE_BATCH_SIZE = 100;
const CM_EARLY_SIGNAL_RC_YEARS = [2024, 2025, 2026];
const CM_EARLY_SIGNAL_MAX_PLAYERS = 50;
const CM_OPERATOR_KEY_PROPERTY = "CM_OPERATOR_KEY";
const CM_PUBLIC_DATA_BASE = "https://app.chasingmajors.com/data/v1";
const CM_PUBLIC_VALIDATION_RETRIES = 6;
const CM_PUBLIC_VALIDATION_PAUSE_MS = 2500;
// Escalate a job stuck in published_pages_pending (GitHub commit succeeded but
// public propagation unconfirmed) after this many ms. Well under the 24h hard-fail.
const CM_PUBLISHED_PAGES_PENDING_MAX_AGE_MS = 6 * 60 * 60 * 1000;
// Same Script Property name the Operator backend reads; the Exporter reuses it
// to deliver stale-publish alerts via its own minimal UrlFetchApp POST.
const CM_SENTINEL_ALERT_WEBHOOK_URL_PROPERTY = "CM_SENTINEL_ALERT_WEBHOOK_URL";

let CM_DRIVE_WRITE_COUNT = 0;

const CM_CHECKLIST_SPORT_SHEETS = {
  baseball: { id: "1ULp5r2i3D4oBfzEHb9Migk8DuJAxyt6h2aNL-jDXL40", enabled: true },
  basketball: { id: "1YMCAyDCr88yMQoQeqyVj744uoDB9BHRYYVDKo61kbiI", enabled: true },
  football: { id: "153ng5aY9p0MHAGJigdb5HxuzdesExW3a-SJ_6Q0-fUE", enabled: true },
  hockey: { id: "1S3JnuieEEJo5U_yt3g98EgvC6Bu4uHLL2JOlOSveXMc", enabled: true },
  soccer: { id: "1NoRIQxy7tA72bGifQHoSfImClcsReM1z8giKCVW2XKI", enabled: true }
};

const CM_ACTIVE_CURRENT_KEYS = {
  baseball: "2026",
  football: "2026",
  basketball: "2025-26",
  hockey: "2025",
  soccer: "2025-26"
};

const CM_CHECKLIST_DB_MAP = {
  baseball: {
    "1950s": "1jthufiRIqqYe6CdqXBSBr7gtKHrN0fGszi2baBZpAE4",
    current: "1knoZy155nQOw-_9o5ragmoBS_FaxwoZ3lEQ4YGgeSeg",
    "2025": "1-oJ8JqCuxuxtbBVpVfa9NM4BS5GUSzZel_glGOreewM",
    "2024": "1jpjTuuB2nrXlcM9mXlAAO1V3nM0EMNL4WHIURHSCjSw",
    "2023": "11usGtSRq61ohj5ok3gde1yDS4dROuOUl6nNIeEC2Cjg",
    "2022": "1F-Zl1Ts12HPzg7iPrBlpBFsRml3HmnhEKH1KkN5BT00",
    "2021": "1qOsq-zu5qDbESJtSjb4-RYmicjs6BFFIXkmmmd4PNr0",
    "2020": "1HE6ZV7XkjSOJ8TVA4QoBkRx_dHtA65L0H0DHCT76k8s",
    "2019": "1HTBMx9ml1-LQvlb8zhorzB2SmyEDugmLHZx13rzVC4M",
    "2018": "1kWESwMoFYOlOH5Y-rfSWE6m8pHm7-pZZKey27pCP8I0",
    "2017": "1NglNmuUWuKgbZRpqvvU7AeTN4FKwaLt4imVdw_EwnYQ",
    "2016": "1xfzStBiQhrnGs2GYVbDdaKzVMaLkfqd_rIZ1mILjMKw"
  },
  football: {
    current: "1Sj0nui8PkfDCyGq5L_6ctWnoNt9L2T4MXSU1U4ZM70U",
    "2026": "1Sj0nui8PkfDCyGq5L_6ctWnoNt9L2T4MXSU1U4ZM70U",
    "2025": "1bHkBThVdfRb5YpzGXkr696I-biTYfc9CuwHQrpYFR9M",
    "2024": "1h1jAF3fda-wIii4-N7b4TbrAkSDxxAldm_2L2ogr9Ic",
    "2023": "19i4PTO2aAgmBPEAocfqSL5B33BLMOhC3oSsR7F3bQ1U"
  },
  basketball: {
    current: "1VbBlGrQILiwBYP1J81pNiFwYxJju3cMWWEVkCxgcHFM",
    "2025-26": "1VbBlGrQILiwBYP1J81pNiFwYxJju3cMWWEVkCxgcHFM",
    "2024-25": "1H3ult43T-iBwUtevPizUwVHgul0yAS4kGo6j8U6Nsh0",
    "2023-24": "12PxOlX8rCARVFujvud00arXOaTSixydHQhyk5ylC24I"
  },
  hockey: {
    current: "16eT73CzM7JQMZcaEI3Zc0elX5lzzMtrvX8TGr1aKYKc",
    "2025": "16eT73CzM7JQMZcaEI3Zc0elX5lzzMtrvX8TGr1aKYKc",
    "2024": "1164NTKL3HyxCqY5WSpY87cAc10HDm1LG06usP2LlbvQ",
    "2023": "1riKx-h-ChEpA-UK4e7UmnWd6OcpPsqFx0oSrxYvcA74"
  },
  soccer: {
    current: "1G90AI7ZhIsTyHDmqdiZ26_ZgWRm4RRaDzdED3CzEG3g",
    "2026": "1G90AI7ZhIsTyHDmqdiZ26_ZgWRm4RRaDzdED3CzEG3g",
    "2025-26": "1G90AI7ZhIsTyHDmqdiZ26_ZgWRm4RRaDzdED3CzEG3g",
    "2024-25": "14JWdRdT9xsjVbWGUQszbiBgtMNJCxtrMV1yINm_edcE",
    "2023-24": "1k_7N09xelDEcVUGhIFRSFBKa9NHK3xFCW2urvHYxEZw"
  }
};

const CM_CHECKLIST_DB_SHEETS = {
  PRODUCTS: "Products",
  CHECKLIST: "ChecklistRows",
  PARALLELS: "Parallels"
};

const CM_VAULT_SPREADSHEET_ID = "1Rmo0R46j_MdK7oQX-Z00PfOsRsoiHNgNTkNS3PbMeuE";
const CM_PLAYERREF_SPREADSHEET_ID = "1Kg9wpAiqayZQshmL_v3lp4-Q0EVIrkE1H9EzeZMUdfc";
const CM_PLAYERREF_SHEET_STATS = "PlayerStats";
const CM_RELEASE_SCHEDULE_SPREADSHEET_ID = "1pjxdH4TdUuENGWU7f9Z-7G8e_KvznZvBU-GBKFxEbUE";
const CM_RELEASE_SCHEDULE_SHEET = "ReleaseSchedule";
const CM_RELEASE_SPORT_ORDER = ["Baseball", "Football", "Basketball", "Soccer", "Hockey"];

const CM_POP_DB = {
  baseball: "1eVCAuBvaetRCri4ZvaGz5FNzJwhSOz4_LNiQuiIh7t8",
  basketball: "1mbxBiLq41DFliIqcMBw8qzAIA0msCGsnTeY3LH1UBtc",
  football: "1k1qaeg1DrtJJo3sRtyQBDj86C9D0xDvvO_EiVH0fJPA",
  soccer: "1X-m-fG7iigf_zQVDBbkIccOOPDbJbeV5pnNZA9aTLdo",
  hockey: "1nWa46ip-dbmMz2uROmfwiljnSKqez39o1NYflHbFhV8"
};

function doGet(e) {
  try {
    const p = (e && e.parameter) ? e.parameter : {};
    const action = value_(p.action);

    if (action === "health") {
      return cmJsonOutput_({
        ok: true,
        service: "cm_static_data_exporter",
        queue_version: "2026-10-18-verification-v8",
        supported_actions: ["health", "publishChecklistAfterImport", "publishVaultStaticDataToGitHub"],
        updated_at: new Date().toISOString()
      });
    }

    if (action === "publishChecklistAfterImport") {
      return cmJsonOutput_({
        ok: false,
        error: "This admin action requires POST. Keys are not accepted in query strings.",
        action: action
      });
    }

    if (action === "publishVaultStaticDataToGitHub") {
      return cmJsonOutput_({
        ok: false,
        error: "This admin action requires POST. Keys are not accepted in query strings.",
        action: action
      });
    }

    return cmJsonOutput_({
      ok: false,
      error: "Unknown action",
      supported_actions: ["health", "publishChecklistAfterImport", "publishVaultStaticDataToGitHub"]
    });
  } catch (err) {
    return cmJsonOutput_({
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  }
}

function doPost(e) {
  try {
    const body = parseCmJsonBody_(e);
    const action = value_(body.action);

    if (action === "health") {
      return cmJsonOutput_({
        ok: true,
        service: "cm_static_data_exporter",
        queue_version: "2026-10-18-verification-v8",
        supported_actions: ["health", "publishChecklistAfterImport", "publishVaultStaticDataToGitHub"],
        updated_at: new Date().toISOString()
      });
    }

    if (action === "publishChecklistAfterImport") {
      return cmJsonOutput_(publishChecklistAfterImport_(body));
    }

    if (action === "publishVaultStaticDataToGitHub") {
      return cmJsonOutput_(publishVaultStaticDataToGitHub_(body));
    }

    return cmJsonOutput_({
      ok: false,
      error: "Unknown action",
      supported_actions: ["publishChecklistAfterImport", "publishVaultStaticDataToGitHub"]
    });
  } catch (err) {
    return cmJsonOutput_({
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  }
}

function exportAllStaticData() {
  CM_DRIVE_WRITE_COUNT = 0;
  const root = resetExportRoot_();
  const dataRoot = ensureFolderPath_(root, ["data", "v1"]);
  const now = new Date();
  const version = Utilities.formatDate(now, "UTC", "yyyy-MM-dd'T'HH:mm:ss'Z'");

  exportChecklistStaticData_(dataRoot);
  exportVaultStaticData_(dataRoot);
  exportPlayerStatsStaticData_(dataRoot);

  writeJsonFile_(dataRoot, "manifest.json", {
    ok: true,
    version: version,
    checklists_version: version,
    vault_version: version,
    players_version: version,
    generated_at: version,
    schema: CM_EXPORT_VERSION
  });

  Logger.log("Static export complete: " + root.getUrl());
}

function exportChecklistStaticData_(dataRoot) {
  const checklistRoot = ensureFolderPath_(dataRoot, ["checklists"]);
  const productRoot = ensureFolderPath_(checklistRoot, ["products"]);
  const searchRoot = ensureFolderPath_(checklistRoot, ["search-index"]);
  const mergedIndex = [];
  const mergedSearchRows = [];

  Object.keys(CM_CHECKLIST_SPORT_SHEETS).forEach(sport => {
    const cfg = CM_CHECKLIST_SPORT_SHEETS[sport];
    if (!cfg.enabled || !cfg.id) return;

    const ss = SpreadsheetApp.openById(cfg.id);
    const indexRows = sheetObjects_(ss.getSheetByName("Index")).map(r => ({
      Code: value_(r.code),
      DisplayName: value_(r.displayname || r.display_name || r.release_name),
      Keywords: value_(r.keywords),
      year: value_(r.year),
      sport: sport,
      manufacturer: value_(r.manufacturer),
      product: value_(r.product)
    })).filter(r => r.Code && r.DisplayName);

    appendRows_(mergedIndex, indexRows);

    const checklistRows = sheetObjects_(ss.getSheetByName("Checklist")).map(r => ({
      code: value_(r.code),
      displayName: value_(r.displayname || r.display_name),
      keywords: value_(r.keywords),
      year: value_(r.year),
      manufacturer: value_(r.manufacturer),
      product: value_(r.product),
      section: value_(r.section),
      subset: value_(r.subset),
      card_no: value_(r.card_no || r.cardno),
      player: value_(r.player),
      team: value_(r.team),
      tag: value_(r.tag || r.tags),
      sport: sport
    })).filter(r => r.code);

    const parallelRows = sheetObjects_(ss.getSheetByName("Parallels")).map(r => ({
      code: value_(r.code),
      applies_to_section: value_(r.applies_to_section),
      applies_to_subset: value_(r.applies_to_subset),
      parallel_name: value_(r.parallel_name),
      serial_no: value_(r.serial_no)
    })).filter(r => r.code);

    const checklistByCode = groupBy_(checklistRows, "code");
    const parallelsByCode = groupBy_(parallelRows, "code");
    const sportProductFolder = ensureFolderPath_(productRoot, [sport]);
    const sportProductBundle = {};

    indexRows.forEach(meta => {
      const productPayload = {
        ok: true,
        meta: {
          code: meta.Code,
          displayName: meta.DisplayName,
          year: meta.year,
          manufacturer: meta.manufacturer,
          product: meta.product,
          sport: sport
        },
        rows: checklistByCode[meta.Code] || [],
        parallels: parallelsByCode[meta.Code] || []
      };

      sportProductBundle[meta.Code] = productPayload;

      if (CM_WRITE_PER_PRODUCT_FILES) {
        writeJsonFile_(sportProductFolder, safeFileName_(meta.Code) + ".json", productPayload);
      }
    });

    writeShardedObjectMap_(productRoot, sport, sportProductBundle, {
      ok: true,
      sport: sport,
      kind: "checklist_products"
    });

    const searchRows = sheetObjects_(ss.getSheetByName("ChecklistSearch")).map(r => ({
      code: value_(r.code),
      displayName: value_(r.displayname || r.display_name),
      year: value_(r.year),
      product: value_(r.product),
      sport: value_(r.sport) || sport,
      section: value_(r.section),
      subset: value_(r.subset),
      card_no: value_(r.card_no || r.cardno),
      player: value_(r.player),
      team: value_(r.team),
      tag: value_(r.tag || r.tags),
      search_blob: value_(r.search_blob || r.searchblob)
    })).filter(r => r.code || r.search_blob);

    appendRows_(mergedSearchRows, searchRows);
    writeShardedRows_(searchRoot, sport, searchRows, {
      ok: true,
      sport: sport,
      kind: "checklist_search"
    });
  });

  writeJsonFile_(checklistRoot, "index.json", { ok: true, index: mergedIndex });
  if (CM_WRITE_MERGED_SEARCH_FILE) {
    writeJsonFile_(searchRoot, "all.json", { ok: true, rows: mergedSearchRows });
  }
}

/* Read-only reconciliation of PRV authoring identities. Original Sheet cells
 * and public Index identifiers are never rewritten by this adapter. */
function prvSourceTables_(ss) {
  return prvReconcileTables_(sheetObjects_(ss.getSheetByName("Index")), sheetObjects_(ss.getSheetByName("Products")));
}
function prvReconcileTables_(index, products) {
  function text(v) { return String(v == null ? "" : v).trim(); }
  function fold(v) { return text(v).toLowerCase().replace(/\s+/g, " "); }
  function name(r) { return text(r.displayname || r.display_name); }
  function identity(r) {
    const n=name(r), year=text(r.year) || (n.match(/\b(?:19|20)\d{2}(?:[-–]\d{2,4})?\b/) || [""])[0];
    return n && year && text(r.sport) ? [fold(r.sport),fold(year),fold(n)].join("|") : "";
  }
  // Reviewed authoring/publication corrections from the October 25 audit.
  // Preserve public identifiers and apply only while the source identity is
  // exact and unique. Combined article titles are retained, never given rows.
  const reviews=[
    {from:"2026_topps_cosmic_chrome_early_baseball",to:"2026_topps_cosmic_chrome_baseball_early",name:"2026 Topps Cosmic Chrome Baseball",old:"2026 Topps Cosmic Chrome Baseball Early",year:"2026",sport:"baseball"},
    {from:"2026_topps_allen_ginter_baseball",to:"2026_topps_allen_ginter_baseball",name:"2026 Topps Allen & Ginter Baseball",old:"2026 Topps Allen & Ginter",year:"2026",sport:"baseball"},
    {from:"2026_topps_tier_one_baseball",to:"2026_topps_tier_one_baseball",name:"2026 Topps Tier One Baseball",year:"2026",sport:"baseball",add:true,index_aliases:["2026_topps_tier_one"]},
    {from:"2025_topps_inception_baseball",to:"2025_topps_inception_baseball",name:"2025 Topps Inception Baseball",year:"2025",sport:"baseball",add:true},
    {from:"2025_26_topps_inception_basketball",to:"2025_26_topps_inception_basketball",name:"2025-26 Topps Inception Basketball",year:"2025-26",sport:"basketball",add:true},
    {from:"2025_26_topps_finest_uefa_club_competitions_soccer",to:"2025_26_topps_finest_uefa_club_competitions_soccer",name:"2025-26 Topps Finest UEFA Club Competitions Soccer",source_old:"2025-26 Topp Finest UEFA Club Competitions Soccer",year:"2025-26",sport:"soccer",manufacturer:"Topps",product:"Finest UEFA Club Competitions",index_aliases:["2025_26_finest_uefa_club_competitions_soccer"],catalog_only:true},
    {from:"2026_topps_pristine_premier_league_soccer",to:"2025_26_topps_pristine_premier_league_soccer",name:"2025-26 Topps Pristine Premier League Soccer",year:"2025-26",sport:"soccer",manufacturer:"Topps",product:"Pristine Premier League",index_aliases:["2026_topps_pristine_premier_league_soccer"],catalog_only:true},
    {from:"2026_merlin_premier_league_soccer",to:"2025_26_topps_merlin_premier_league",name:"2025-26 Topps Merlin Premier League Soccer",year:"2025-26",sport:"soccer",manufacturer:"Topps",product:"Merlin Premier League",index_aliases:["2026_merlin_premier_league_soccer"],catalog_only:true}
  ];
  index=index.slice();products=products.slice();
  const reviewHolds=new Map();
  reviews.forEach(rule => {
    const rows=products.filter(r=>text(r.code)===rule.from);
    const expected=identity({displayname:rule.name,year:rule.year,sport:rule.sport});
    // Reviewed source-scoped aliases must already have one catalog identity.
    // Never create metadata/coverage or normalize a different product by typo.
    if (rule.catalog_only) {
      const hold=()=>{if(rows.length)reviewHolds.set(rule.from,"HOLD: reviewed public identity is absent, ambiguous or conflicts with source metadata");};
      const oldIdentity=rule.source_old && identity({displayname:rule.source_old,year:rule.year,sport:rule.sport});
      if (rows.some(r=>(identity(r)!==expected && identity(r)!==oldIdentity) || fold(r.manufacturer)!==fold(rule.manufacturer) || fold(r.product)!==fold(rule.product))) return hold();
      const allowed=[rule.to].concat(rule.index_aliases || []);
      const candidates=index.map((r,i)=>({r:r,i:i})).filter(e=>allowed.indexOf(text(e.r.code))>=0 || identity(e.r)===expected);
      if (candidates.length!==1) return hold();
      const e=candidates[0];
      if (allowed.indexOf(text(e.r.code))<0 || identity(e.r)!==expected || fold(e.r.manufacturer)!==fold(rule.manufacturer) || fold(e.r.product)!==fold(rule.product)) return hold();
      index[e.i]=Object.assign({},e.r,{code:rule.to});
      products=products.map(r=>text(r.code)===rule.from?Object.assign({},r,{code:rule.to,displayname:rule.name}):r);
      return;
    }
    if (!rows.length || rows.some(r=>identity(r)!==expected)) return;
    const positions=[];index.forEach((r,i)=>{if(text(r.code)===rule.to)positions.push(i);});
    if (!positions.length && rule.add) {
      const sameIdentity=index.map((r,i)=>({r:r,i:i})).filter(e=>identity(e.r)===expected);
      if (sameIdentity.length) {
        if (sameIdentity.length!==1 || (rule.index_aliases || []).indexOf(text(sameIdentity[0].r.code))<0) return;
        index[sameIdentity[0].i]=Object.assign({},sameIdentity[0].r,{code:rule.to,displayname:rule.name,year:rule.year});
      } else {
      const r=rows[0];index.push({code:rule.to,displayname:rule.name,keywords:text(r.keywords)||rule.name,year:rule.year,sport:rule.sport,manufacturer:text(r.manufacturer),product:text(r.product),cmurl:text(r.cmurl || r.cm_url)});
      }
    } else if(positions.length===1) {
      const i=positions[0], r=index[i];
      if ((fold(name(r))===fold(rule.name) || rule.old && fold(name(r))===fold(rule.old)) && fold(r.sport)===rule.sport && (!text(r.year) || fold(r.year)===fold(rule.year))) index[i]=Object.assign({},r,{displayname:rule.name,year:rule.year});
      else return;
    } else return;
    products=products.map(r=>text(r.code)===rule.from?Object.assign({},r,{code:rule.to}):r);
  });
  // Owner-approved row-level Sapphire review. Never select by mutable Sheet
  // position, shared article code, keyword year, or approximate numeric values.
  const sapphireSource="2023_topps_chrome_sapphire_baseball";
  const sapphireRules=[
    {year:"2019",to:"2019_Topps_Chrome_Sapphire_Edition_Baseball",alias:"19TCSmlb",name:"2019 Topps Chrome Sapphire Edition Baseball",type:"Base",line:"[Base]",run:"1,030",size:"700",row:2076},
    {year:"2020",to:"2020_topps_chrome_sapphire_baseball",alias:"20TCSmlb",name:"2020 Topps Chrome Sapphire Baseball",type:"Base",line:"[Base]",run:"1,030",size:"700",row:682},
    {year:"2021",to:"2021_topps_chrome_sapphire_edition_baseball",alias:"21TCSmlb",name:"2021 Topps Chrome Sapphire Baseball",type:"Base",line:"[Base]",run:"1,100",size:"660",row:678},
    {year:"2023",to:sapphireSource,alias:"23TCSmlb",name:"2023 Topps Chrome Sapphire Baseball",type:"Base",line:"[Base]",run:"1,200",size:"660",row:663},
    {year:"2023",to:sapphireSource,alias:"23TCSmlb",name:"2023 Topps Chrome Sapphire Baseball",type:"Insert",line:"Sapphire Selections",run:"150",size:"10",row:664}
  ];
  sapphireRules.forEach(rule=>{
    const expected=identity({displayname:rule.name,year:rule.year,sport:"baseball"});
    const candidates=index.map((r,i)=>({r:r,i:i})).filter(e=>[rule.to,rule.alias].indexOf(text(e.r.code))>=0 || identity(e.r)===expected);
    if(candidates.length!==1) return;
    const e=candidates[0];
    if([rule.to,rule.alias].indexOf(text(e.r.code))<0 || identity(e.r)!==expected || text(e.r.manufacturer)!=="Topps" || text(e.r.product)!=="Chrome Sapphire") return;
    const matches=products.filter(r=>(text(r.code)===sapphireSource || r.prv_identity_review && r.prv_identity_review.review_id==="sapphire-five-2026-10-26") && identity(r)===expected && text(r.manufacturer)==="Topps" && text(r.product)==="Chrome Sapphire" && text(r.settype)===rule.type && text(r.setline)===rule.line && text(r.printrun).replace(/,/g, "")===rule.run.replace(/,/g, "") && text(r.subsetsize)===rule.size && ["parallel","serial","packodds","cmurl","notes"].every(k=>!text(r[k])));
    // Competing rows/codes already targeting this exact identity are held;
    // do not combine them or take ownership of an unreviewed source code.
    if(matches.length!==1 || products.some(r=>r!==matches[0] && text(r.code)!==sapphireSource && !(r.prv_identity_review && r.prv_identity_review.review_id==="sapphire-five-2026-10-26") && identity(r)===expected)) return;
    index[e.i]=Object.assign({},e.r,{code:rule.to});
    products=products.map(r=>r===matches[0]?Object.assign({},r,{code:rule.to,prv_measurement_note:"Unverified estimate; original source URL not recorded.",prv_identity_review:{review_id:"sapphire-five-2026-10-26",source_code:sapphireSource,source_sheet_row:rule.row,measurement_verified:false}}):r);
  });
  const step7=prvApplyApprovedStep7_(index,products);index=step7.index;products=step7.products;
  const codes=new Map(), names=new Map(), sourceIdentities=new Map(), targets=new Map();
  index.forEach(r => {
    const code=text(r.code), key=identity(r);
    if (!code || !name(r)) return;
    if (!codes.has(code)) codes.set(code,[]);
    codes.get(code).push(r);
    if (key) { if (!names.has(key)) names.set(key,[]); names.get(key).push(r); }
  });
  products.forEach(r => {
    const code=text(r.code), key=identity(r);
    if (!sourceIdentities.has(code)) sourceIdentities.set(code,new Set());
    sourceIdentities.get(code).add(key);
    const matches=names.get(key) || [];
    if (matches.length===1) {
      const target=text(matches[0].code);
      if (!targets.has(target)) targets.set(target,new Set());
      targets.get(target).add(code);
    }
  });
  const report={input_rows:products.length,exact_rows:0,remapped_rows:0,unmatched_rows:0,unmatched:[],mappings:[]};
  const missing=new Map(), mapped=new Map();
  const resolved=products.map(r => {
    const code=text(r.code), direct=codes.get(code) || [], key=identity(r), matches=names.get(key) || [];
    if(r.prv_identity_review && r.prv_identity_review.review_id==="sapphire-five-2026-10-26" && direct.length===1 && identity(direct[0])===key) {
      report.remapped_rows++;
      const pair=sapphireSource+"|"+code;
      if(!mapped.has(pair))mapped.set(pair,{source_code:sapphireSource,published_code:code,display_name:name(direct[0]),rows:0});
      mapped.get(pair).rows++;
      return r;
    }
    // The reviewed Index split does not establish row ownership in the old
    // combined article. Held rows are kept for diagnostics but excluded from
    // every export route, even if a stale direct-code Index entry exists.
    const combined=code==="2026_topps_pristine_premier_league_2026_merlin_premier_league_soccer";
    const sapphireHeld=code===sapphireSource || code==="2022_topps_chrome_sapphire_baseball";
    if (combined || sapphireHeld || reviewHolds.has(code)) {
      report.unmatched_rows++;
      const reason=combined?"HOLD: combined Pristine/Merlin source lacks reviewed per-row product ownership":sapphireHeld?"HOLD: Sapphire row is outside the five owner-approved exact signatures":reviewHolds.get(code);
      const k=code+"|"+reason;
      if (!missing.has(k)) missing.set(k,Object.assign({code:code,reason:reason,rows:0,held:true},combined?{candidate_public_codes:["2025_26_topps_pristine_premier_league_soccer","2025_26_topps_merlin_premier_league"]}:{}));
      missing.get(k).rows++;
      return Object.assign({},r,{prv_identity_hold:true});
    }
    if (direct.length===1) { report.exact_rows++; return r; }
    let reason=direct.length>1 ? "Duplicate Index code" : "No exact name, year and sport match in Index";
    if (!direct.length && matches.length===1) {
      const target=text(matches[0].code);
      if (sourceIdentities.get(code).size!==1 || !key) reason="Source code covers multiple or incomplete product identities";
      else if ((codes.get(target) || []).length!==1) reason="Duplicate target Index code";
      else if (targets.get(target).size!==1) reason="Multiple Products codes map to one Index identity";
      else {
        report.remapped_rows++;
        const pair=code+"|"+target;
        if (!mapped.has(pair)) mapped.set(pair,{source_code:code,published_code:target,display_name:name(matches[0]),rows:0});
        mapped.get(pair).rows++;
        return Object.assign({},r,{code:target});
      }
    } else if (!direct.length && matches.length>1) reason="Ambiguous Index name, year and sport";
    report.unmatched_rows++;
    const k=code+"|"+reason;
    if (!missing.has(k)) missing.set(k,{code:code,reason:reason,rows:0});
    missing.get(k).rows++;
    // An unresolved row keeps its original identifier. It is not silently
    // attached to a similar product or counted as successfully reconciled.
    return r;
  });
  report.unmatched=Array.from(missing.values());report.mappings=Array.from(mapped.values());
  if (typeof Logger!=="undefined") Logger.log("PRV source reconciliation: "+JSON.stringify({input_rows:report.input_rows,exact_rows:report.exact_rows,remapped_rows:report.remapped_rows,unmatched_rows:report.unmatched_rows,unmatched_codes:report.unmatched.length,mapping_count:report.mappings.length,unmatched_sample:report.unmatched.slice(0,5)}));
  return {index:index,products:resolved,report:report};
}
function auditPrvSourceIdentity() {
  const source=prvSourceTables_(getVaultSpreadsheet_());
  const wanted=["2026 Bowman Baseball","2026 Bowman Mega Box Baseball","2026 Topps Chrome Black Baseball","2026 Topps Heritage Baseball","2026 Topps Series 1 Baseball","2026 Topps Series 1 Celebration Baseball","2026 Topps Tier One Baseball"];
  const result=wanted.map(name=>{
    const matches=source.index.filter(r=>value_(r.displayname || r.display_name)===name);
    return {name:name,index_matches:matches.length,code:matches.map(r=>value_(r.code)).join(","),rows:matches.length===1?source.products.filter(r=>value_(r.code)===value_(matches[0].code)).length:null};
  });
  Logger.log("PRV REPAIR PREVIEW (read only): "+JSON.stringify(result));
  return result;
}

function exportVaultStaticData_(dataRoot) {
  const ss = getVaultSpreadsheet_();
  if (!ss) {
    Logger.log("Skipping Vault static export. Set CM_VAULT_SPREADSHEET_ID or run this script from the bound Print Run Vault spreadsheet.");
    return;
  }

  const sourceTables = prvSourceTables_(ss);
  const vaultRoot = ensureFolderPath_(dataRoot, ["vault"]);
  const productRoot = ensureFolderPath_(vaultRoot, ["products"]);
  const popRoot = ensureFolderPath_(vaultRoot, ["pop"]);

  const indexRows = sourceTables.index.map(r => ({
    Code: value_(r.code),
    DisplayName: value_(r.displayname || r.display_name),
    Keywords: value_(r.keywords),
    year: value_(r.year),
    sport: value_(r.sport),
    manufacturer: value_(r.manufacturer),
    product: value_(r.product),
    cmURL: value_(r.cmurl || r.cm_url)
  })).filter(r => r.Code && r.DisplayName);

  const productRows = sourceTables.products.filter(r=>!r.prv_identity_hold).map(r => ({
    code: value_(r.code),
    setType: value_(r.settype || r.set_type),
    setLine: value_(r.setline || r.set_line),
    ...(value_(r.parallel) ? {parallel: value_(r.parallel)} : {}),
    printRun: numberOrString_(r.printrun || r.print_run),
    ...(r.prv_identity_review && r.prv_identity_review.review_id==="step7-122-2026-10-26" && value_(r.packodds) ? {odds:value_(r.packodds)} : {}),
    serial: value_(r.serial),
    subSetSize: numberOrString_(r.subsetsize || r.sub_set_size),
    notes: prvExportNotes_(r),
    cmURL: value_(r.cmurl || r.cm_url)
  })).filter(r => r.code);

  const productByCode = groupBy_(productRows, "code");
  const productBundle = {};

  indexRows.forEach(meta => {
    const productPayload = {
      ok: true,
      meta: {
        code: meta.Code,
        displayName: meta.DisplayName,
        year: meta.year,
        sport: meta.sport,
        manufacturer: meta.manufacturer,
        product: meta.product,
        cmURL: meta.cmURL
      },
      rows: productByCode[meta.Code] || []
    };

    productBundle[meta.Code] = productPayload;

    if (CM_WRITE_PER_PRODUCT_FILES) {
      writeJsonFile_(productRoot, safeFileName_(meta.Code) + ".json", productPayload);
    }
  });

  writeShardedObjectMap_(productRoot, "all", productBundle, {
    ok: true,
    kind: "vault_products"
  });

  writeJsonFile_(vaultRoot, "index.json", { ok: true, index: indexRows });
  exportPopStaticData_(popRoot);
}

function getVaultSpreadsheet_() {
  if (CM_VAULT_SPREADSHEET_ID) {
    return SpreadsheetApp.openById(CM_VAULT_SPREADSHEET_ID);
  }

  try {
    return SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {
    return null;
  }
}

function exportPopStaticData_(popRoot) {
  Object.keys(CM_POP_DB).forEach(sport => {
    const ss = SpreadsheetApp.openById(CM_POP_DB[sport]);
    const rows = sheetObjects_(ss.getSheetByName("Set_Summary"));
    const latestByCode = {};

    rows.forEach(r => {
      const code = value_(r.cm_product_code);
      if (!code) return;

      const existing = latestByCode[code];
      const runTs = new Date(r.run_ts || 0).getTime();
      const existingTs = existing ? new Date(existing.run_ts || 0).getTime() : 0;
      if (!existing || runTs > existingTs) latestByCode[code] = r;
    });

    const sportFolder = ensureFolderPath_(popRoot, [sport]);
    const sportPopBundle = {};

    Object.keys(latestByCode).forEach(code => {
      const r = latestByCode[code];
      const popPayload = {
        ok: true,
        data: {
          cm_product_code: code,
          sport: sport,
          run_ts: r.run_ts,
          row_count: numberOrString_(r.row_count),
          total_graded: numberOrString_(r.total_graded),
          total_gems: numberOrString_(r.total_gems),
          weighted_gem_rate: formatPct_(r.weighted_gem_rate),
          graded_past_month: numberOrString_(r.graded_past_month),
          graded_prior_month: numberOrString_(r.graded_prior_month),
          top_players_json: value_(r.top_players_json),
          top_parallels_json: value_(r.top_parallels_json)
        }
      };

      sportPopBundle[code] = popPayload;

      if (CM_WRITE_PER_POP_FILES) {
        writeJsonFile_(sportFolder, safeFileName_(code) + ".json", popPayload);
      }
    });

    writeJsonFile_(popRoot, sport + ".json", {
      ok: true,
      sport: sport,
      products: sportPopBundle
    });
  });
}

function buildVaultStaticData_() {
  const ss = getVaultSpreadsheet_();
  if (!ss) throw new Error("Missing Vault spreadsheet. Set CM_VAULT_SPREADSHEET_ID.");

  const sourceTables = prvSourceTables_(ss);
  const generatedAt = new Date().toISOString();
  const indexRows = sourceTables.index.map(r => ({
    Code: value_(r.code),
    DisplayName: value_(r.displayname || r.display_name),
    Keywords: value_(r.keywords),
    year: value_(r.year),
    sport: value_(r.sport),
    manufacturer: value_(r.manufacturer),
    product: value_(r.product),
    cmURL: value_(r.cmurl || r.cm_url)
  })).filter(r => r.Code && r.DisplayName);

  const productRows = sourceTables.products.filter(r=>!r.prv_identity_hold).map(r => ({
    code: value_(r.code),
    setType: value_(r.settype || r.set_type),
    setLine: value_(r.setline || r.set_line),
    ...(value_(r.parallel) ? {parallel: value_(r.parallel)} : {}),
    printRun: numberOrString_(r.printrun || r.print_run),
    ...(r.prv_identity_review && r.prv_identity_review.review_id==="step7-122-2026-10-26" && value_(r.packodds) ? {odds:value_(r.packodds)} : {}),
    serial: value_(r.serial),
    subSetSize: numberOrString_(r.subsetsize || r.sub_set_size),
    notes: prvExportNotes_(r),
    cmURL: value_(r.cmurl || r.cm_url)
  })).filter(r => r.code);

  const productByCode = groupBy_(productRows, "code");
  const productBundle = {};

  indexRows.forEach(meta => {
    productBundle[meta.Code] = {
      ok: true,
      meta: {
        code: meta.Code,
        displayName: meta.DisplayName,
        year: meta.year,
        sport: meta.sport,
        manufacturer: meta.manufacturer,
        product: meta.product,
        cmURL: meta.cmURL
      },
      rows: productByCode[meta.Code] || []
    };
  });

  return {
    generated_at: generatedAt,
    index: indexRows,
    products: productBundle,
    pop: buildPopStaticData_()
  };
}

function buildPopStaticData_() {
  const out = {};

  Object.keys(CM_POP_DB).forEach(sport => {
    const ss = SpreadsheetApp.openById(CM_POP_DB[sport]);
    const rows = sheetObjects_(ss.getSheetByName("Set_Summary"));
    const latestByCode = {};

    rows.forEach(r => {
      const code = value_(r.cm_product_code);
      if (!code) return;

      const existing = latestByCode[code];
      const runTs = new Date(r.run_ts || 0).getTime();
      const existingTs = existing ? new Date(existing.run_ts || 0).getTime() : 0;
      if (!existing || runTs > existingTs) latestByCode[code] = r;
    });

    const sportPopBundle = {};
    Object.keys(latestByCode).forEach(code => {
      const r = latestByCode[code];
      sportPopBundle[code] = {
        ok: true,
        data: {
          cm_product_code: code,
          sport: sport,
          run_ts: r.run_ts,
          row_count: numberOrString_(r.row_count),
          total_graded: numberOrString_(r.total_graded),
          total_gems: numberOrString_(r.total_gems),
          weighted_gem_rate: formatPct_(r.weighted_gem_rate),
          graded_past_month: numberOrString_(r.graded_past_month),
          graded_prior_month: numberOrString_(r.graded_prior_month),
          top_players_json: value_(r.top_players_json),
          top_parallels_json: value_(r.top_parallels_json)
        }
      };
    });

    out[sport] = {
      ok: true,
      sport: sport,
      products: sportPopBundle
    };
  });

  return out;
}

function exportPlayerStatsStaticData_(dataRoot) {
  const playerRoot = ensureFolderPath_(dataRoot, ["players"]);
  const playerRows = getMlbPlayerStatsFromStatsApi_();

  if (playerRows.length) {
    writeJsonFile_(playerRoot, "mlb-stats.json", {
      ok: true,
      source: "MLB Stats API",
      generated_at: new Date().toISOString(),
      players: playerRows
    });
    return;
  }

  const ss = SpreadsheetApp.openById(CM_PLAYERREF_SPREADSHEET_ID);
  const fallbackRows = sheetObjects_(ss.getSheetByName(CM_PLAYERREF_SHEET_STATS)).map(r => ({
    player: value_(r.player),
    url: value_(r.url),
    sport: "baseball",
    player_type: "hitter",
    season: {
      h: value_(r.season_h),
      hr: value_(r.season_hr),
      rbi: value_(r.season_rbi),
      ba: value_(r.season_ba),
      ops: value_(r.season_ops),
      era: value_(r.season_era),
      sv: value_(r.season_sv),
      ip: value_(r.season_ip),
      so: value_(r.season_so),
      whip: value_(r.season_whip)
    },
    career: {
      h: value_(r.career_h),
      hr: value_(r.career_hr),
      rbi: value_(r.career_rbi),
      ba: value_(r.career_ba),
      ops: value_(r.career_ops),
      era: value_(r.career_era),
      sv: value_(r.career_sv),
      ip: value_(r.career_ip),
      so: value_(r.career_so),
      whip: value_(r.career_whip)
    },
    updated_at: value_(r.updated_at)
  })).filter(r => r.player);

  writeJsonFile_(playerRoot, "mlb-stats.json", {
    ok: true,
    source: "PlayerStats sheet fallback",
    generated_at: new Date().toISOString(),
    players: fallbackRows
  });
}

function getMlbPlayerStatsFromStatsApi_() {
  const season = new Date().getFullYear();
  const hittingSeasonRows = fetchMlbStats_("season", "hitting", season);
  const pitchingSeasonRows = fetchMlbStats_("season", "pitching", season);

  if (
    hittingSeasonRows === null ||
    pitchingSeasonRows === null
  ) {
    return [];
  }

  if (!hittingSeasonRows.length && !pitchingSeasonRows.length) return [];

  const playerIds = uniqueIds_(hittingSeasonRows.concat(pitchingSeasonRows).map(row => row.personId));
  const careerById = fetchMlbCareerStatsForIds_(playerIds);
  if (careerById === null) return [];

  const hitterRows = hittingSeasonRows.map(row => {
    const career = (careerById[row.personId] && careerById[row.personId].hitting) || {};
    return {
      player: row.player,
      mlb_id: row.personId,
      sport: "baseball",
      player_type: "hitter",
      season: {
        h: row.hits,
        hr: row.homeRuns,
        rbi: row.rbi,
        ba: row.avg,
        ops: row.ops
      },
      career: {
        h: career.hits || "",
        hr: career.homeRuns || "",
        rbi: career.rbi || "",
        ba: career.avg || "",
        ops: career.ops || ""
      },
      updated_at: new Date().toISOString()
    };
  }).filter(r => r.player);

  const hitterIds = {};
  hitterRows.forEach(row => {
    hitterIds[row.mlb_id] = true;
  });

  const pitcherRows = pitchingSeasonRows
    .filter(row => !hitterIds[row.personId])
    .map(row => {
      const career = (careerById[row.personId] && careerById[row.personId].pitching) || {};
      return {
        player: row.player,
        mlb_id: row.personId,
        sport: "baseball",
        player_type: "pitcher",
        season: {
          era: row.era,
          sv: row.saves,
          ip: row.inningsPitched,
          so: row.strikeOuts,
          whip: row.whip
        },
        career: {
          era: career.era || "",
          sv: career.saves || "",
          ip: career.inningsPitched || "",
          so: career.strikeOuts || "",
          whip: career.whip || ""
        },
        updated_at: new Date().toISOString()
      };
    }).filter(r => r.player);

  return hitterRows.concat(pitcherRows);
}

function fetchMlbCareerStatsForIds_(playerIds) {
  const ids = uniqueIds_(playerIds);
  const out = {};

  for (let i = 0; i < ids.length; i += CM_MLB_PEOPLE_BATCH_SIZE) {
    const batch = ids.slice(i, i + CM_MLB_PEOPLE_BATCH_SIZE);
    const url = "https://statsapi.mlb.com/api/v1/people"
      + "?personIds=" + encodeURIComponent(batch.join(","))
      + "&hydrate=" + encodeURIComponent("stats(type=career,group=[hitting,pitching])");

    try {
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
        Logger.log("MLB people career fetch failed with status " + res.getResponseCode() + ": " + url);
        return null;
      }

      const json = JSON.parse(res.getContentText());
      const people = json && json.people ? json.people : [];

      people.forEach(person => {
        if (!person || !person.id) return;
        const entry = { hitting: {}, pitching: {} };
        (person.stats || []).forEach(block => {
          const group = String(block && block.group && block.group.displayName || "").toLowerCase();
          const split = block && block.splits && block.splits[0];
          const stat = split && split.stat ? split.stat : {};
          if (group === "hitting") entry.hitting = mapMlbHittingStat_(stat);
          if (group === "pitching") entry.pitching = mapMlbPitchingStat_(stat);
        });
        out[person.id] = entry;
      });

      Utilities.sleep(100);
    } catch (e) {
      Logger.log("MLB people career fetch failed: " + e);
      return null;
    }
  }

  return out;
}

function mapMlbHittingStat_(stat) {
  return {
    hits: value_(stat.hits),
    homeRuns: value_(stat.homeRuns),
    rbi: value_(stat.rbi),
    avg: value_(stat.avg),
    ops: value_(stat.ops)
  };
}

function mapMlbPitchingStat_(stat) {
  return {
    era: value_(stat.era),
    saves: value_(stat.saves),
    inningsPitched: value_(stat.inningsPitched),
    strikeOuts: value_(stat.strikeOuts),
    whip: value_(stat.whip)
  };
}

function fetchMlbStats_(statType, group, season) {
  let offset = 0;
  let total = null;
  const out = [];

  while (total === null || offset < total) {
    const url = "https://statsapi.mlb.com/api/v1/stats"
      + "?stats=" + encodeURIComponent(statType)
      + "&group=" + encodeURIComponent(group)
      + "&playerPool=all"
      + (season ? "&season=" + encodeURIComponent(season) : "")
      + "&sportIds=1"
      + "&limit=" + encodeURIComponent(CM_MLB_STATS_PAGE_SIZE)
      + "&offset=" + encodeURIComponent(offset);

    try {
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
        Logger.log("MLB Stats API fetch failed with status " + res.getResponseCode() + ": " + url);
        return null;
      }

      const json = JSON.parse(res.getContentText());
      const statBlock = json && json.stats && json.stats[0];
      const splits = statBlock && statBlock.splits ? statBlock.splits : [];

      if (total === null) {
        total = Number(statBlock && statBlock.totalSplits) || splits.length || 0;
      }

      splits.forEach(split => {
        const stat = split.stat || {};
        const person = split.player || split.person || {};
        out.push({
          personId: person.id,
          player: person.fullName || person.name || "",
          hits: value_(stat.hits),
          homeRuns: value_(stat.homeRuns),
          rbi: value_(stat.rbi),
          avg: value_(stat.avg),
          ops: value_(stat.ops),
          era: value_(stat.era),
          saves: value_(stat.saves),
          inningsPitched: value_(stat.inningsPitched),
          strikeOuts: value_(stat.strikeOuts),
          whip: value_(stat.whip)
        });
      });

      if (!splits.length) break;
      offset += splits.length;
      Utilities.sleep(100);
    } catch (e) {
      Logger.log("MLB Stats API fetch failed: " + e);
      return null;
    }
  }

  return out.filter(r => r.personId && r.player);
}

function buildQueryString_(params) {
  return Object.keys(params).map(key => {
    return encodeURIComponent(key) + "=" + encodeURIComponent(value_(params[key]));
  }).join("&");
}

function sheetObjects_(sheet) {
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) return [];

  const headers = values[0].map(h => normalizeHeader_(h));
  return values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      if (h) obj[h] = row[i];
    });
    return obj;
  });
}

function normalizeHeader_(value) {
  return String(value == null ? "" : value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function rowHasData_(row) {
  return (row || []).some(cell => value_(cell) !== "");
}

function pickField_(obj, candidates) {
  for (let i = 0; i < candidates.length; i++) {
    const key = normalizeHeader_(candidates[i]);
    if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  }
  return "";
}

function titleCaseSafe_(value) {
  return value_(value)
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

function pad2_(n) {
  return ("0" + Number(n)).slice(-2);
}

function value_(v) {
  return String(v == null ? "" : v).trim();
}

function numberOrString_(v) {
  const s = value_(v).replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) && s !== "" ? n : value_(v);
}

function formatPct_(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return value_(v);
  return (n <= 1 ? n * 100 : n).toFixed(2) + "%";
}

function groupBy_(rows, key) {
  const out = {};
  rows.forEach(row => {
    const k = value_(row[key]);
    if (!k) return;
    if (!out[k]) out[k] = [];
    out[k].push(row);
  });
  return out;
}

function appendRows_(target, rows) {
  if (!rows || !rows.length) return;
  rows.forEach(row => target.push(row));
}

function uniqueIds_(ids) {
  const seen = {};
  const out = [];
  (ids || []).forEach(id => {
    const key = value_(id);
    if (!key || seen[key]) return;
    seen[key] = true;
    out.push(key);
  });
  return out;
}

function safeFileName_(value) {
  return encodeURIComponent(value_(value)).replace(/\*/g, "%2A");
}

function resetExportRoot_() {
  const folder = withDriveRetry_(function () {
    const existing = DriveApp.getFoldersByName(CM_EXPORT_ROOT_FOLDER);
    return existing.hasNext()
      ? existing.next()
      : DriveApp.createFolder(CM_EXPORT_ROOT_FOLDER);
  }, "get/create root export folder");

  clearFolder_(folder);
  return folder;
}

function clearFolder_(folder) {
  withDriveRetry_(function () {
    const files = folder.getFiles();
    while (files.hasNext()) files.next().setTrashed(true);
  }, "clear export files");

  withDriveRetry_(function () {
    const folders = folder.getFolders();
    while (folders.hasNext()) folders.next().setTrashed(true);
  }, "clear export folders");
}

function ensureFolderPath_(root, parts) {
  let current = root;
  parts.forEach(part => {
    current = withDriveRetry_(function () {
      const matches = current.getFoldersByName(part);
      return matches.hasNext() ? matches.next() : current.createFolder(part);
    }, "get/create folder " + part);
  });
  return current;
}

function writeJsonFile_(folder, name, obj) {
  const json = JSON.stringify(obj);
  const blob = Utilities.newBlob(json, "application/json", name);

  withDriveRetry_(function () {
    const existing = folder.getFilesByName(name);
    while (existing.hasNext()) existing.next().setTrashed(true);
    folder.createFile(blob);
  }, "write " + name);

  CM_DRIVE_WRITE_COUNT++;
  if (CM_DRIVE_WRITE_COUNT % CM_DRIVE_WRITE_THROTTLE_EVERY === 0) {
    Utilities.sleep(CM_DRIVE_WRITE_PAUSE_MS);
  }
}

function writeShardedRows_(folder, baseName, rows, basePayload) {
  const shards = [];
  let current = [];
  let currentSize = JSON.stringify(Object.assign({}, basePayload, { rows: [] })).length;

  (rows || []).forEach(row => {
    const rowSize = JSON.stringify(row).length + 1;
    if (current.length && currentSize + rowSize > CM_MAX_JSON_SHARD_CHARS) {
      shards.push(current);
      current = [];
      currentSize = JSON.stringify(Object.assign({}, basePayload, { rows: [] })).length;
    }

    current.push(row);
    currentSize += rowSize;
  });

  if (current.length || !shards.length) shards.push(current);

  const files = shards.map((shardRows, idx) => {
    const fileName = baseName + "-" + padShard_(idx + 1) + ".json";
    writeJsonFile_(folder, fileName, Object.assign({}, basePayload, {
      shard: idx + 1,
      shard_count: shards.length,
      rows: shardRows
    }));
    return fileName;
  });

  writeJsonFile_(folder, baseName + ".json", Object.assign({}, basePayload, {
    sharded: true,
    shards: files
  }));
}

function writeShardedObjectMap_(folder, baseName, objectMap, basePayload) {
  const shards = [];
  let current = {};
  let currentSize = JSON.stringify(Object.assign({}, basePayload, { products: {} })).length;

  Object.keys(objectMap || {}).forEach(key => {
    const entrySize = JSON.stringify(key).length + JSON.stringify(objectMap[key]).length + 4;
    if (Object.keys(current).length && currentSize + entrySize > CM_MAX_JSON_SHARD_CHARS) {
      shards.push(current);
      current = {};
      currentSize = JSON.stringify(Object.assign({}, basePayload, { products: {} })).length;
    }

    current[key] = objectMap[key];
    currentSize += entrySize;
  });

  if (Object.keys(current).length || !shards.length) shards.push(current);

  const files = shards.map((products, idx) => {
    const fileName = baseName + "-" + padShard_(idx + 1) + ".json";
    writeJsonFile_(folder, fileName, Object.assign({}, basePayload, {
      shard: idx + 1,
      shard_count: shards.length,
      products: products
    }));
    return fileName;
  });

  const productMap = {};
  files.forEach((fileName, idx) => {
    const products = shards[idx] || {};
    Object.keys(products).forEach(code => {
      productMap[code] = fileName;
    });
  });

  writeJsonFile_(folder, baseName + ".json", Object.assign({}, basePayload, {
    sharded: true,
    shards: files,
    product_map: productMap
  }));
}

function padShard_(n) {
  return String(n).padStart(3, "0");
}

function withDriveRetry_(fn, label) {
  let lastErr = null;

  for (let attempt = 1; attempt <= CM_DRIVE_WRITE_RETRIES; attempt++) {
    try {
      return fn();
    } catch (err) {
      lastErr = err;
      const waitMs = CM_DRIVE_WRITE_PAUSE_MS * attempt;
      Logger.log("Drive retry " + attempt + "/" + CM_DRIVE_WRITE_RETRIES + " for " + label + ": " + err);
      Utilities.sleep(waitMs);
    }
  }

  throw lastErr;
}

/* =========================
   GITHUB PUBLISH HELPERS
========================= */

function testGitHubTokenAndCommit() {
  const cfg = getGitHubConfig_();
  const path = "data/v2/automation/github-token-test.json";
  const payload = {
    ok: true,
    source: "Apps Script",
    test: "github_token_commit",
    updated_at: new Date().toISOString()
  };

  const result = putGitHubJsonFile_(path, payload, "Test Apps Script GitHub token");
  Logger.log("GitHub test commit complete: " + JSON.stringify(result));
  return Object.assign({ ok: true, path: path, repo: cfg.owner + "/" + cfg.repo }, result);
}

function publishChecklistStaticDataToGitHubReleaseBase_() {
  const built = buildChecklistStaticDataFromDbMap_();
  const published = [];

  published.push(putGitHubJsonFile_(
    "data/v1/checklists/index.json",
    { ok: true, source: "Checklist DB map", generated_at: built.generated_at, index: built.index },
    "Update checklist index data"
  ));

  Object.keys(built.productsBySport).forEach(sport => {
    published.push.apply(published, putGitHubShardedObjectMap_(
      "data/v1/checklists/products",
      sport,
      built.productsBySport[sport],
      {
        ok: true,
        sport: sport,
        kind: "checklist_products",
        source: "Checklist DB map",
        generated_at: built.generated_at
      },
      "Update " + sport + " checklist product data"
    ));
  });

  Object.keys(built.searchRowsBySport).forEach(sport => {
    published.push.apply(published, putGitHubShardedRows_(
      "data/v1/checklists/search-index",
      sport,
      built.searchRowsBySport[sport],
      {
        ok: true,
        sport: sport,
        kind: "checklist_search",
        source: "Checklist DB map",
        generated_at: built.generated_at
      },
      "Update " + sport + " checklist search data"
    ));
  });

  published.push(putGitHubJsonFile_(
    "data/v1/manifest.json",
    {
      ok: true,
      version: built.generated_at,
      checklists_version: built.generated_at,
      generated_at: built.generated_at,
      schema: CM_EXPORT_VERSION
    },
    "Update static data manifest"
  ));

  const result = {
    ok: true,
    source: "Checklist DB map",
    generated_at: built.generated_at,
    sports: Object.keys(built.productsBySport),
    product_count: built.index.length,
    search_row_count: built.searchRowCount,
    files_published: published.length,
    files: published
  };

  Logger.log("Checklist static data published: " + JSON.stringify({
    product_count: result.product_count,
    search_row_count: result.search_row_count,
    files_published: result.files_published
  }));

  return result;
}

function publishCurrentChecklistStaticDataToGitHubReleaseBase_() {
  const sports = Object.keys(CM_ACTIVE_CURRENT_KEYS);
  const results = sports.map(sport => publishCurrentChecklistSportToGitHub(sport, { skipIndex: true }));
  const indexResult = publishChecklistIndexFromProductBundlesToGitHub();
  return {
    ok: true,
    mode: "current_only_all_sports",
    results: results,
    index: indexResult
  };
}

function publishCurrentBaseballChecklistToGitHub() {
  return publishCurrentChecklistSportAndIndexToGitHub_("baseball");
}

function publishCurrentFootballChecklistToGitHub() {
  return publishCurrentChecklistSportAndIndexToGitHub_("football");
}

function publishCurrentBasketballChecklistToGitHub() {
  return publishCurrentChecklistSportAndIndexToGitHub_("basketball");
}

function publishCurrentHockeyChecklistToGitHub() {
  return publishCurrentChecklistSportAndIndexToGitHub_("hockey");
}

function publishCurrentSoccerChecklistToGitHub() {
  return publishCurrentChecklistSportAndIndexToGitHub_("soccer");
}

function publishCurrentChecklistSportAndIndexToGitHubReleaseBase_(sport) {
  const dataResult = publishCurrentChecklistSportToGitHub(sport);
  const indexResult = publishChecklistIndexFromGoogleSheetsToGitHub();
  return {
    ok: true,
    mode: "current_single_sport_google_sheets_index",
    sport: normalizeKey_(sport),
    data: dataResult,
    index: indexResult
  };
}

function publishChecklistAfterImportBase_(input) {
  requireCmOperatorKey_(input && input.key);

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    return { ok: false, status: "publish_busy", retryable: true,
      error: "Another JSON publish is still running. Wait for it to finish before retrying." };
  }
  try {
    return publishChecklistAfterImportLocked_(input);
  } finally {
    lock.releaseLock();
  }
}

function publishChecklistAfterImportLockedBase_(input) {

  const sport = normalizeKey_(input && input.sport);
  const bucket = value_(input && input.bucket);
  const code = value_(input && input.code);

  if (!sport) throw new Error("Missing sport.");
  if (!bucket) throw new Error("Missing target bucket/year.");
  if (!code) throw new Error("Missing product code.");
  if (!CM_CHECKLIST_DB_MAP[sport]) throw new Error("Unsupported sport: " + sport);

  const publishResult = publishChecklistProductAfterImportToGitHub_(sport, bucket, code);
  const validation = validatePublishedChecklistProductLite_(sport, code);

  const githubOk = !!(validation.github && validation.github.ok);
  const publicOk = !!(validation.public && validation.public.ok);

  return {
    ok: githubOk,
    status: publicOk
      ? "published_and_public_validated"
      : githubOk
        ? "published_pages_pending"
        : "published_validation_needs_review",
    mode: "approved_import_product_scoped_publish",
    sport: sport,
    bucket: bucket,
    code: code,
    publish_result: summarizePublishResult_(publishResult),
    validation: validation,
    checklist_url: "https://app.chasingmajors.com/checklists/?refresh=1&code="
      + encodeURIComponent(code)
      + "&sport=" + encodeURIComponent(sport)
      + "&type=product",
    chatbot_url: "https://app.chasingmajors.com/ChatBot/?q="
      + encodeURIComponent(code),
    updated_at: new Date().toISOString()
  };
}

function publishChecklistProductAfterImportToGitHub_(sportValue, bucketValue, codeValue) {
  const sport = normalizeKey_(sportValue);
  const bucket = value_(bucketValue);
  const code = value_(codeValue);
  const single = buildChecklistStaticDataForSingleProduct_(sport, bucket, code);
  const published = [];

  published.push.apply(published, putGitHubSingleChecklistProductBundle_(
    sport,
    code,
    single.productPayload,
    single.generated_at
  ));

  published.push(putGitHubChecklistIndexProduct_(
    single.indexRow,
    single.generated_at
  ));

  published.push.apply(published, putGitHubChecklistSearchProduct_(
    sport,
    code,
    single.searchRows,
    single.generated_at
  ));

  const existingManifest = fetchGitHubJsonFile_("data/v1/manifest.json") || {};
  published.push(putGitHubJsonFile_(
    "data/v1/manifest.json",
    Object.assign({}, existingManifest, {
      ok: true,
      version: single.generated_at,
      checklists_version: single.generated_at,
      generated_at: single.generated_at,
      schema: CM_EXPORT_VERSION
    }),
    "Update checklist manifest product " + code
  ));

  return {
    ok: true,
    mode: "product_scoped_import_publish",
    sport: sport,
    bucket: bucket,
    code: code,
    row_count: single.productPayload.rows.length,
    parallel_count: single.productPayload.parallels.length,
    search_row_count: single.searchRows.length,
    files_published: published.length,
    files: published
  };
}

function buildChecklistStaticDataForSingleProductBase_(sportValue, bucketValue, codeValue) {
  const sport = normalizeKey_(sportValue);
  const bucket = value_(bucketValue);
  const code = value_(codeValue);
  const currentKey = value_(CM_ACTIVE_CURRENT_KEYS[sport]);
  const sourceKey = resolveChecklistSourceKey_(sport, bucket === "current" ? currentKey : bucket);
  const sportMap = CM_CHECKLIST_DB_MAP[sport] || {};
  // Match the Operator's fallback: unmapped release years are written to current.
  const spreadsheetId = value_(sportMap[sourceKey] || sportMap.current);

  if (!spreadsheetId) throw new Error("No spreadsheet configured for " + sport + " " + sourceKey);

  const generatedAt = new Date().toISOString();
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const product = sheetObjects_(ss.getSheetByName(CM_CHECKLIST_DB_SHEETS.PRODUCTS))
    .map(row => normalizeChecklistProductRow_(row, sport))
    .filter(row => row.code === code && row.displayName)[0];

  if (!product) throw new Error("Product not found in source sheet: " + code);

  const rows = sheetObjects_(ss.getSheetByName(CM_CHECKLIST_DB_SHEETS.CHECKLIST))
    .map(row => normalizeChecklistCardRow_(row, sport))
    .filter(row => row.code === code);

  const parallels = sheetObjects_(ss.getSheetByName(CM_CHECKLIST_DB_SHEETS.PARALLELS))
    .map(normalizeChecklistParallelRow_)
    .filter(row => row.code === code);

  const searchRows = [buildProductSearchRow_(product)]
    .concat(rows.map(row => buildChecklistCardSearchRow_(product, row)));

  const indexRow = {
    Code: product.code,
    DisplayName: product.displayName,
    Keywords: product.keywords,
    year: product.year,
    sport: product.sport,
    manufacturer: product.manufacturer,
    product: product.product
  };

  return {
    generated_at: generatedAt,
    sport: sport,
    source_key: sourceKey,
    indexRow: indexRow,
    productPayload: {
      ok: true,
      meta: {
        code: product.code,
        displayName: product.displayName,
        keywords: product.keywords,
        source_key: sourceKey,
        year: product.year,
        manufacturer: product.manufacturer,
        product: product.product,
        sport: product.sport
      },
      rows: rows,
      parallels: parallels
    },
    searchRows: searchRows
  };
}

function putGitHubSingleChecklistProductBundle_(sport, code, productPayload, generatedAt) {
  const repoDir = "data/v1/checklists/products";
  const manifestPath = repoDir + "/" + sport + ".json";
  const manifest = fetchGitHubJsonFile_(manifestPath) || {};
  const published = [];

  if (manifest.products) {
    manifest.products[code] = productPayload;
    published.push(putGitHubJsonFile_(
      manifestPath,
      Object.assign({}, manifest, {
        ok: true,
        generated_at: generatedAt
      }),
      "Update product bundle " + code
    ));
    return published;
  }

  const productMap = manifest.product_map || {};
  const shards = Array.isArray(manifest.shards) ? manifest.shards.slice() : [];
  let shardName = value_(productMap[code]);

  if (!shardName) {
    shardName = sport + "-product-" + safeSourceKeyForFile_(code) + ".json";
    if (shards.indexOf(shardName) === -1) shards.push(shardName);
  }

  const shardPath = repoDir + "/" + shardName;
  const shard = fetchGitHubJsonFile_(shardPath) || {};
  const products = shard.products || {};
  products[code] = productPayload;

  productMap[code] = shardName;

  published.push(putGitHubJsonFile_(
    shardPath,
    Object.assign({}, shard, {
      ok: true,
      sport: sport,
      kind: "checklist_products",
      source: "Product-scoped approved import publish",
      generated_at: generatedAt,
      products: products
    }),
    "Update product bundle shard " + code
  ));

  published.push(putGitHubJsonFile_(
    manifestPath,
    Object.assign({}, manifest, {
      ok: true,
      sport: sport,
      kind: "checklist_products",
      source: "Product-scoped approved import publish",
      generated_at: generatedAt,
      sharded: true,
      shards: shards,
      product_map: productMap
    }),
    "Update product bundle manifest " + sport
  ));

  return published;
}

function putGitHubChecklistIndexProduct_(indexRow, generatedAt) {
  const existingPayload = fetchGitHubJsonFile_("data/v1/checklists/index.json") || {};
  const existingIndex = normalizeExistingChecklistIndex_(existingPayload.index || existingPayload.rows || []);
  const code = value_(indexRow.Code || indexRow.code);
  const nextIndex = existingIndex
    .filter(row => value_(row.Code || row.code) !== code)
    .concat([indexRow])
    .sort((a, b) => {
      const sportCompare = value_(a.sport).localeCompare(value_(b.sport));
      if (sportCompare !== 0) return sportCompare;
      const yearCompare = value_(b.year).localeCompare(value_(a.year));
      if (yearCompare !== 0) return yearCompare;
      return value_(a.DisplayName).localeCompare(value_(b.DisplayName));
    });

  return putGitHubJsonFile_(
    "data/v1/checklists/index.json",
    {
      ok: true,
      source: "Product-scoped approved import index update",
      generated_at: generatedAt,
      index: nextIndex
    },
    "Update checklist index product " + code
  );
}

function putGitHubChecklistSearchProduct_(sport, code, searchRows, generatedAt) {
  const repoDir = "data/v1/checklists/search-index";
  const manifestPath = repoDir + "/" + sport + ".json";
  const manifest = fetchGitHubJsonFile_(manifestPath) || {};
  const rows = Array.isArray(searchRows) ? searchRows : [];
  if (!rows.length) throw new Error("Refusing to publish an empty search index for " + code);

  if (Array.isArray(manifest.rows)) {
    return [putGitHubJsonFile_(manifestPath, Object.assign({}, manifest, {
      generated_at: generatedAt,
      rows: manifest.rows.filter(row => value_(row.code || row.Code) !== code).concat(rows)
    }), "Update checklist search product " + code)];
  }

  const published = [];
  let files = Array.isArray(manifest.shards) ? manifest.shards.slice() : [];
  const productShards = Object.assign({}, manifest.product_shards || {});
  const stamp = String(Date.now());
  const message = "Update checklist search product " + code;
  const basePayload = {
    ok: true, sport: sport, kind: "checklist_search",
    source: "Product-scoped approved import search update", generated_at: generatedAt
  };

  if (Object.prototype.hasOwnProperty.call(productShards, code)) {
    // These shards were created exclusively for this product by this publisher.
    const previous = productShards[code];
    files = files.filter(name => previous.indexOf(name) === -1);
  } else {
    // Legacy manifests have no product lookup. Read bounded batches in parallel,
    // and write only shards containing this product. Never rewrite the sport.
    const legacyFiles = files.slice();
    for (let start = 0; start < legacyFiles.length; start += 8) {
      const names = legacyFiles.slice(start, start + 8);
      const payloads = fetchGitHubJsonFiles_(names.map(name => repoDir + "/" + name));
      payloads.forEach((shard, index) => {
        if (!shard || !Array.isArray(shard.rows)) throw new Error("Invalid search shard: " + names[index]);
        const retained = shard.rows.filter(row => value_(row.code || row.Code) !== code);
        if (retained.length === shard.rows.length) return;
        const oldName = names[index];
        const replacement = oldName.replace(/\.json$/, "") + "-" + stamp + ".json";
        if (retained.length) {
          published.push(putGitHubJsonFile_(repoDir + "/" + replacement,
            Object.assign({}, shard, { generated_at: generatedAt, rows: retained }), message + " retained rows"));
        }
        files = files.flatMap(name => name === oldName ? (retained.length ? [replacement] : []) : [name]);
        Object.keys(productShards).forEach(key => {
          productShards[key] = productShards[key].flatMap(name => name === oldName ? (retained.length ? [replacement] : []) : [name]);
        });
      });
    }
  }

  const newNames = [];
  buildRowShards_(rows, basePayload).forEach((shardRows, index) => {
    const name = sport + "-product-" + safeSourceKeyForFile_(code) + "-" + stamp + "-" + padShard_(index + 1) + ".json";
    newNames.push(name);
    published.push(putGitHubJsonFile_(repoDir + "/" + name,
      Object.assign({}, basePayload, { rows: shardRows }), message + " product rows"));
  });
  productShards[code] = newNames;
  // New immutable shards become visible together when the manifest is updated.
  // A failed write leaves the previous manifest and its search data intact.
  published.push(putGitHubJsonFile_(manifestPath, Object.assign({}, manifest, basePayload, {
    sharded: true, shards: files.concat(newNames), product_shards: productShards
  }), message + " manifest"));
  return published;
}

function fetchGitHubJsonFiles_(repoPaths) {
  const cfg = getGitHubConfig_();
  const requests = repoPaths.map(path => ({
    url: "https://api.github.com/repos/" + encodeURIComponent(cfg.owner) + "/"
      + encodeURIComponent(cfg.repo) + "/contents/" + encodeGitHubPath_(path)
      + "?ref=" + encodeURIComponent(cfg.branch),
    method: "get", muteHttpExceptions: true,
    headers: { Authorization: "Bearer " + cfg.token, Accept: "application/vnd.github.raw+json" }
  }));
  return UrlFetchApp.fetchAll(requests).map((response, index) => {
    if (response.getResponseCode() !== 200) {
      const data = fetchGitHubJsonFile_(repoPaths[index]);
      if (!data) throw new Error("Missing search shard: " + repoPaths[index]);
      return data;
    }
    return JSON.parse(response.getContentText());
  });
}

function publishBaseball1950sChecklistToGitHub() {
  return publishChecklistSourceToGitHub("baseball", "1950s");
}

function publishBaseball1950sChecklistProductsToGitHub() {
  return publishChecklistSourceProductsToGitHub("baseball", "1950s");
}

function publishBaseball1950sChecklistSearchToGitHub() {
  return publishChecklistSourceSearchToGitHub("baseball", "1950s");
}

function publishBaseball1950sChecklistIndexToGitHub() {
  return publishChecklistIndexFromGoogleSheetsToGitHub();
}

function publishBaseball2016ChecklistToGitHub() {
  return publishChecklistSourceToGitHub("baseball", "2016");
}

function publishBaseball2016ChecklistProductsToGitHub() {
  return publishChecklistSourceProductsToGitHub("baseball", "2016");
}

function publishBaseball2016ChecklistSearchToGitHub() {
  return publishChecklistSourceSearchToGitHub("baseball", "2016");
}

function publishBaseball2016ChecklistIndexToGitHub() {
  return publishChecklistIndexFromGoogleSheetsToGitHub();
}

function publishBaseball2017ChecklistToGitHub() {
  return publishChecklistSourceToGitHub("baseball", "2017");
}

function publishBaseball2017ChecklistProductsToGitHub() {
  return publishChecklistSourceProductsToGitHub("baseball", "2017");
}

function publishBaseball2017ChecklistSearchToGitHub() {
  return publishChecklistSourceSearchToGitHub("baseball", "2017");
}

function publishBaseball2017ChecklistIndexToGitHub() {
  return publishChecklistIndexFromGoogleSheetsToGitHub();
}

function publishBaseball2018ChecklistToGitHub() {
  return publishChecklistSourceToGitHub("baseball", "2018");
}

function publishBaseball2018ChecklistProductsToGitHub() {
  return publishChecklistSourceProductsToGitHub("baseball", "2018");
}

function publishBaseball2018ChecklistSearchToGitHub() {
  return publishChecklistSourceSearchToGitHub("baseball", "2018");
}

function publishBaseball2018ChecklistIndexToGitHub() {
  return publishChecklistIndexFromGoogleSheetsToGitHub();
}

function publishBaseball2019ChecklistToGitHub() {
  return publishChecklistSourceToGitHub("baseball", "2019");
}

function publishBaseball2019ChecklistProductsToGitHub() {
  return publishChecklistSourceProductsToGitHub("baseball", "2019");
}

function publishBaseball2019ChecklistSearchToGitHub() {
  return publishChecklistSourceSearchToGitHub("baseball", "2019");
}

function publishBaseball2019ChecklistIndexToGitHub() {
  return publishChecklistIndexFromGoogleSheetsToGitHub();
}

function publishBaseball2020ChecklistToGitHub() {
  return publishChecklistSourceToGitHub("baseball", "2020");
}

function publishBaseball2020ChecklistProductsToGitHub() {
  return publishChecklistSourceProductsToGitHub("baseball", "2020");
}

function publishBaseball2020ChecklistSearchToGitHub() {
  return publishChecklistSourceSearchToGitHub("baseball", "2020");
}

function publishBaseball2020ChecklistIndexToGitHub() {
  return publishChecklistIndexFromGoogleSheetsToGitHub();
}

function publishBaseball2021ChecklistToGitHub() {
  return publishChecklistSourceToGitHub("baseball", "2021");
}

function publishBaseball2021ChecklistProductsToGitHub() {
  return publishChecklistSourceProductsToGitHub("baseball", "2021");
}

function publishBaseball2021ChecklistSearchToGitHub() {
  return publishChecklistSourceSearchToGitHub("baseball", "2021");
}

function publishBaseball2021ChecklistIndexToGitHub() {
  return publishChecklistIndexFromGoogleSheetsToGitHub();
}

function publishBaseball2022ChecklistToGitHub() {
  return publishChecklistSourceToGitHub("baseball", "2022");
}

function publishBaseball2022ChecklistProductsToGitHub() {
  return publishChecklistSourceProductsToGitHub("baseball", "2022");
}

function publishBaseball2022ChecklistSearchToGitHub() {
  return publishChecklistSourceSearchToGitHub("baseball", "2022");
}

function publishBaseball2022ChecklistSearchStandaloneToGitHub() {
  return publishChecklistSourceSearchStandaloneToGitHub("baseball", "2022");
}

function publishBaseball2022ChecklistIndexToGitHub() {
  return publishChecklistIndexFromGoogleSheetsToGitHub();
}

function publishBaseball2023ChecklistToGitHub() {
  return publishChecklistSourceToGitHub("baseball", "2023");
}

function publishBaseball2023ChecklistProductsToGitHub() {
  return publishChecklistSourceProductsToGitHub("baseball", "2023");
}

function publishBaseball2023ChecklistSearchToGitHub() {
  return publishChecklistSourceSearchToGitHub("baseball", "2023");
}

function publishBaseball2023ChecklistIndexToGitHub() {
  return publishChecklistIndexFromGoogleSheetsToGitHub();
}

function publishBaseball2024ChecklistToGitHub() {
  return publishChecklistSourceToGitHub("baseball", "2024");
}

function publishBaseball2024ChecklistProductsToGitHub() {
  return publishChecklistSourceProductsToGitHub("baseball", "2024");
}

function publishBaseball2024ChecklistSearchToGitHub() {
  return publishChecklistSourceSearchToGitHub("baseball", "2024");
}

function publishBaseball2024ChecklistIndexToGitHub() {
  return publishChecklistIndexFromGoogleSheetsToGitHub();
}

function publishBaseball2025ChecklistToGitHub() {
  return publishChecklistSourceToGitHub("baseball", "2025");
}

function publishBaseball2025ChecklistProductsToGitHub() {
  return publishChecklistSourceProductsToGitHub("baseball", "2025");
}

function publishBaseball2025ChecklistSearchToGitHub() {
  return publishChecklistSourceSearchToGitHub("baseball", "2025");
}

function publishBaseball2025ChecklistIndexToGitHub() {
  return publishChecklistIndexFromGoogleSheetsToGitHub();
}

function publishFootball2023ChecklistToGitHub() {
  return publishChecklistSourceToGitHub("football", "2023");
}

function publishFootball2023ChecklistProductsToGitHub() {
  return publishChecklistSourceProductsToGitHub("football", "2023");
}

function publishFootball2023ChecklistSearchToGitHub() {
  return publishChecklistSourceSearchToGitHub("football", "2023");
}

function publishFootball2023ChecklistIndexToGitHub() {
  return publishChecklistIndexFromGoogleSheetsToGitHub();
}

function publishFootball2024ChecklistToGitHub() {
  return publishChecklistSourceToGitHub("football", "2024");
}

function publishFootball2024ChecklistProductsToGitHub() {
  return publishChecklistSourceProductsToGitHub("football", "2024");
}

function publishFootball2024ChecklistSearchToGitHub() {
  return publishChecklistSourceSearchToGitHub("football", "2024");
}

function publishFootball2024ChecklistIndexToGitHub() {
  return publishChecklistIndexFromGoogleSheetsToGitHub();
}

function publishFootball2025ChecklistToGitHub() {
  return publishChecklistSourceToGitHub("football", "2025");
}

function publishFootball2025ChecklistProductsToGitHub() {
  return publishChecklistSourceProductsToGitHub("football", "2025");
}

function publishFootball2025ChecklistSearchToGitHub() {
  return publishChecklistSourceSearchToGitHub("football", "2025");
}

function publishFootball2025ChecklistIndexToGitHub() {
  return publishChecklistIndexFromGoogleSheetsToGitHub();
}

function publishBasketball2023_24ChecklistToGitHub() {
  return publishChecklistSourceToGitHub("basketball", "2023-24");
}

function publishBasketball2023_24ChecklistProductsToGitHub() {
  return publishChecklistSourceProductsToGitHub("basketball", "2023-24");
}

function publishBasketball2023_24ChecklistSearchToGitHub() {
  return publishChecklistSourceSearchToGitHub("basketball", "2023-24");
}

function publishBasketball2023_24ChecklistIndexToGitHub() {
  return publishChecklistIndexFromGoogleSheetsToGitHub();
}

function publishBasketball2024_25ChecklistToGitHub() {
  return publishChecklistSourceToGitHub("basketball", "2024-25");
}

function publishBasketball2024_25ChecklistProductsToGitHub() {
  return publishChecklistSourceProductsToGitHub("basketball", "2024-25");
}

function publishBasketball2024_25ChecklistSearchToGitHub() {
  return publishChecklistSourceSearchToGitHub("basketball", "2024-25");
}

function publishBasketball2024_25ChecklistIndexToGitHub() {
  return publishChecklistIndexFromGoogleSheetsToGitHub();
}

function publishHockey2023ChecklistToGitHub() {
  return publishChecklistSourceToGitHub("hockey", "2023");
}

function publishHockey2023ChecklistProductsToGitHub() {
  return publishChecklistSourceProductsToGitHub("hockey", "2023");
}

function publishHockey2023ChecklistSearchToGitHub() {
  return publishChecklistSourceSearchToGitHub("hockey", "2023");
}

function publishHockey2023ChecklistIndexToGitHub() {
  return publishChecklistIndexFromGoogleSheetsToGitHub();
}

function publishHockey2024ChecklistToGitHub() {
  return publishChecklistSourceToGitHub("hockey", "2024");
}

function publishHockey2024ChecklistProductsToGitHub() {
  return publishChecklistSourceProductsToGitHub("hockey", "2024");
}

function publishHockey2024ChecklistSearchToGitHub() {
  return publishChecklistSourceSearchToGitHub("hockey", "2024");
}

function publishHockey2024ChecklistIndexToGitHub() {
  return publishChecklistIndexFromGoogleSheetsToGitHub();
}

function publishSoccer2023_24ChecklistToGitHub() {
  return publishChecklistSourceToGitHub("soccer", "2023-24");
}

function publishSoccer2023_24ChecklistProductsToGitHub() {
  return publishChecklistSourceProductsToGitHub("soccer", "2023-24");
}

function publishSoccer2023_24ChecklistSearchToGitHub() {
  return publishChecklistSourceSearchToGitHub("soccer", "2023-24");
}

function publishSoccer2023_24ChecklistIndexToGitHub() {
  return publishChecklistIndexFromGoogleSheetsToGitHub();
}

function publishSoccer2024_25ChecklistToGitHub() {
  return publishChecklistSourceToGitHub("soccer", "2024-25");
}

function publishSoccer2024_25ChecklistProductsToGitHub() {
  return publishChecklistSourceProductsToGitHub("soccer", "2024-25");
}

function publishSoccer2024_25ChecklistSearchToGitHub() {
  return publishChecklistSourceSearchToGitHub("soccer", "2024-25");
}

function publishSoccer2024_25ChecklistIndexToGitHub() {
  return publishChecklistIndexFromGoogleSheetsToGitHub();
}

function publishCurrentChecklistSportToGitHubReleaseBase_(sportValue, options) {
  options = options || {};
  const sport = normalizeKey_(sportValue);
  const currentKey = value_(CM_ACTIVE_CURRENT_KEYS[sport]);
  if (!sport || !currentKey) throw new Error("No active current key configured for sport: " + sportValue);

  const current = buildCurrentChecklistStaticDataForSport_(sport);
  const published = [];
  const generatedAt = current.generated_at;

  const existingIndexPayload = fetchGitHubJsonFile_("data/v1/checklists/index.json") || {};
  const existingIndex = normalizeExistingChecklistIndex_(existingIndexPayload.index || existingIndexPayload.rows || []);
  const currentCodes = {};
  current.index.forEach(row => { currentCodes[row.Code] = true; });

  const nextIndex = existingIndex
    .filter(row => {
      const rowSport = normalizeKey_(row.sport);
      const rowYear = value_(row.year);
      if (rowSport !== sport) return true;
      if (rowYear === currentKey) return false;
      if (currentCodes[row.Code]) return false;
      return true;
    })
    .concat(current.index)
    .sort((a, b) => {
      const sportCompare = value_(a.sport).localeCompare(value_(b.sport));
      if (sportCompare !== 0) return sportCompare;
      const yearCompare = value_(b.year).localeCompare(value_(a.year));
      if (yearCompare !== 0) return yearCompare;
      return value_(a.DisplayName).localeCompare(value_(b.DisplayName));
    });

  if (!options.skipIndex) {
    published.push(putGitHubJsonFile_(
      "data/v1/checklists/index.json",
      {
        ok: true,
        source: "Checklist DB map current merge",
        generated_at: generatedAt,
        index: nextIndex
      },
      "Update checklist index current " + sport
    ));
  }

  const existingProducts = fetchExistingChecklistProductMapForSport_(sport);
  Object.keys(existingProducts).forEach(code => {
    const product = existingProducts[code] || {};
    const meta = product.meta || {};
    if (value_(meta.year) === currentKey || current.products[code]) {
      delete existingProducts[code];
    }
  });
  Object.keys(current.products).forEach(code => {
    existingProducts[code] = current.products[code];
  });

  published.push.apply(published, putGitHubShardedObjectMap_(
    "data/v1/checklists/products",
    sport,
    existingProducts,
    {
      ok: true,
      sport: sport,
      kind: "checklist_products",
      source: "Checklist DB map current merge",
      generated_at: generatedAt
    },
    "Update current " + sport + " checklist products"
  ));

  const existingSearchRows = fetchExistingChecklistSearchRowsForSport_(sport);
  const nextSearchRows = existingSearchRows
    .filter(row => {
      if (normalizeKey_(row.sport) !== sport) return true;
      if (value_(row.year) === currentKey) return false;
      if (currentCodes[value_(row.code || row.Code)]) return false;
      return true;
    })
    .concat(current.searchRows);

  published.push.apply(published, putGitHubShardedRows_(
    "data/v1/checklists/search-index",
    sport,
    nextSearchRows,
    {
      ok: true,
      sport: sport,
      kind: "checklist_search",
      source: "Checklist DB map current merge",
      generated_at: generatedAt
    },
    "Update current " + sport + " checklist search"
  ));

  const existingManifest = fetchGitHubJsonFile_("data/v1/manifest.json") || {};
  published.push(putGitHubJsonFile_(
    "data/v1/manifest.json",
    Object.assign({}, existingManifest, {
      ok: true,
      version: generatedAt,
      checklists_version: generatedAt,
      generated_at: generatedAt,
      schema: CM_EXPORT_VERSION
    }),
    "Update checklist manifest current " + sport
  ));

  const result = {
    ok: true,
    mode: "current_only",
    sport: sport,
    current_key: currentKey,
    product_count: current.index.length,
    merged_index_count: nextIndex.length,
    current_search_row_count: current.searchRows.length,
    merged_search_row_count: nextSearchRows.length,
    files_published: published.length,
    files: published
  };

  Logger.log("Current checklist data published: " + JSON.stringify({
    sport: result.sport,
    current_key: result.current_key,
    product_count: result.product_count,
    current_search_row_count: result.current_search_row_count,
    files_published: result.files_published
  }));

  return result;
}

function publishChecklistSourceToGitHubReleaseBase_(sportValue, sourceKeyValue, options) {
  options = options || {};
  const sport = normalizeKey_(sportValue);
  const sourceKey = value_(sourceKeyValue);
  if (!sport || !sourceKey) throw new Error("Missing sport or source key.");

  const productsResult = publishChecklistSourceProductsToGitHub(sport, sourceKey);
  const searchResult = publishChecklistSourceSearchStandaloneToGitHub(sport, sourceKey);
  const indexBuildResult = options.skipIndex ? null : publishChecklistIndexFromGoogleSheetsToGitHub();

  return {
    ok: true,
    mode: "targeted_source_standalone_search",
    sport: sport,
    source_key: sourceKey,
    products: productsResult,
    search: searchResult,
    index: indexBuildResult
  };

  const source = buildChecklistStaticDataForSportSource_(sport, sourceKey);
  const published = [];
  const generatedAt = source.generated_at;
  const sourceCodes = {};
  source.index.forEach(row => { sourceCodes[row.Code] = true; });

  const existingProducts = fetchExistingChecklistProductMapForSport_(sport);
  Object.keys(existingProducts).forEach(code => {
    const product = existingProducts[code] || {};
    const meta = product.meta || {};
    if (sourceCodes[code] || value_(meta.source_key) === sourceKey) {
      delete existingProducts[code];
    }
  });
  Object.keys(source.products).forEach(code => {
    existingProducts[code] = source.products[code];
  });

  published.push.apply(published, putGitHubShardedObjectMap_(
    "data/v1/checklists/products",
    sport,
    existingProducts,
    {
      ok: true,
      sport: sport,
      kind: "checklist_products",
      source: "Checklist DB map targeted source merge",
      source_key: sourceKey,
      generated_at: generatedAt
    },
    "Update " + sport + " " + sourceKey + " checklist products"
  ));

  const existingSearchRows = fetchExistingChecklistSearchRowsForSport_(sport);
  const nextSearchRows = existingSearchRows
    .filter(row => {
      if (normalizeKey_(row.sport) !== sport) return true;
      if (sourceCodes[value_(row.code || row.Code)]) return false;
      if (value_(row.source_key) === sourceKey) return false;
      return true;
    })
    .concat(source.searchRows);

  published.push.apply(published, putGitHubShardedRows_(
    "data/v1/checklists/search-index",
    sport,
    nextSearchRows,
    {
      ok: true,
      sport: sport,
      kind: "checklist_search",
      source: "Checklist DB map targeted source merge",
      source_key: sourceKey,
      generated_at: generatedAt
    },
    "Update " + sport + " " + sourceKey + " checklist search"
  ));

  let indexResult = null;
  if (!options.skipIndex) {
    indexResult = publishChecklistIndexFromProductBundlesToGitHub();
  }

  const existingManifest = fetchGitHubJsonFile_("data/v1/manifest.json") || {};
  published.push(putGitHubJsonFile_(
    "data/v1/manifest.json",
    Object.assign({}, existingManifest, {
      ok: true,
      version: generatedAt,
      checklists_version: generatedAt,
      generated_at: generatedAt,
      schema: CM_EXPORT_VERSION
    }),
    "Update checklist manifest " + sport + " " + sourceKey
  ));

  const result = {
    ok: true,
    mode: "targeted_source",
    sport: sport,
    source_key: sourceKey,
    product_count: source.index.length,
    source_search_row_count: source.searchRows.length,
    merged_search_row_count: nextSearchRows.length,
    files_published: published.length + (indexResult ? 1 : 0),
    index: indexResult,
    files: published
  };

  Logger.log("Targeted checklist data published: " + JSON.stringify({
    sport: result.sport,
    source_key: result.source_key,
    product_count: result.product_count,
    source_search_row_count: result.source_search_row_count,
    files_published: result.files_published
  }));

  return result;
}

function publishChecklistSourceProductsToGitHubReleaseBase_(sportValue, sourceKeyValue) {
  const sport = normalizeKey_(sportValue);
  const sourceKey = value_(sourceKeyValue);
  if (!sport || !sourceKey) throw new Error("Missing sport or source key.");

  const source = buildChecklistStaticDataForSportSource_(sport, sourceKey);
  const published = [];
  const generatedAt = source.generated_at;
  const sourceCodes = {};
  source.index.forEach(row => { sourceCodes[row.Code] = true; });

  const existingProducts = fetchExistingChecklistProductMapForSport_(sport);
  Object.keys(existingProducts).forEach(code => {
    const product = existingProducts[code] || {};
    const meta = product.meta || {};
    if (sourceCodes[code] || value_(meta.source_key) === sourceKey) {
      delete existingProducts[code];
    }
  });
  Object.keys(source.products).forEach(code => {
    existingProducts[code] = source.products[code];
  });

  published.push.apply(published, putGitHubShardedObjectMap_(
    "data/v1/checklists/products",
    sport,
    existingProducts,
    {
      ok: true,
      sport: sport,
      kind: "checklist_products",
      source: "Checklist DB map targeted source products merge",
      source_key: sourceKey,
      generated_at: generatedAt
    },
    "Update " + sport + " " + sourceKey + " checklist products"
  ));

  const existingManifest = fetchGitHubJsonFile_("data/v1/manifest.json") || {};
  published.push(putGitHubJsonFile_(
    "data/v1/manifest.json",
    Object.assign({}, existingManifest, {
      ok: true,
      version: generatedAt,
      checklists_version: generatedAt,
      generated_at: generatedAt,
      schema: CM_EXPORT_VERSION
    }),
    "Update checklist manifest " + sport + " " + sourceKey + " products"
  ));

  const result = {
    ok: true,
    mode: "targeted_source_products_only",
    sport: sport,
    source_key: sourceKey,
    product_count: source.index.length,
    files_published: published.length,
    files: published
  };

  Logger.log("Targeted checklist products published: " + JSON.stringify({
    sport: result.sport,
    source_key: result.source_key,
    product_count: result.product_count,
    files_published: result.files_published
  }));

  return result;
}

function publishChecklistSourceSearchToGitHubReleaseBase_(sportValue, sourceKeyValue) {
  return publishChecklistSourceSearchStandaloneToGitHub(sportValue, sourceKeyValue);

  const sport = normalizeKey_(sportValue);
  const sourceKey = value_(sourceKeyValue);
  if (!sport || !sourceKey) throw new Error("Missing sport or source key.");

  const source = buildChecklistStaticDataForSportSource_(sport, sourceKey);
  const published = [];
  const generatedAt = source.generated_at;
  const sourceCodes = {};
  source.index.forEach(row => { sourceCodes[row.Code] = true; });

  const existingSearchRows = fetchExistingChecklistSearchRowsForSport_(sport);
  const nextSearchRows = existingSearchRows
    .filter(row => {
      if (normalizeKey_(row.sport) !== sport) return true;
      if (sourceCodes[value_(row.code || row.Code)]) return false;
      if (value_(row.source_key) === sourceKey) return false;
      return true;
    })
    .concat(source.searchRows);

  published.push.apply(published, putGitHubShardedRows_(
    "data/v1/checklists/search-index",
    sport,
    nextSearchRows,
    {
      ok: true,
      sport: sport,
      kind: "checklist_search",
      source: "Checklist DB map targeted source search merge",
      source_key: sourceKey,
      generated_at: generatedAt
    },
    "Update " + sport + " " + sourceKey + " checklist search"
  ));

  const existingManifest = fetchGitHubJsonFile_("data/v1/manifest.json") || {};
  published.push(putGitHubJsonFile_(
    "data/v1/manifest.json",
    Object.assign({}, existingManifest, {
      ok: true,
      version: generatedAt,
      checklists_version: generatedAt,
      generated_at: generatedAt,
      schema: CM_EXPORT_VERSION
    }),
    "Update checklist manifest " + sport + " " + sourceKey + " search"
  ));

  const result = {
    ok: true,
    mode: "targeted_source_search_only",
    sport: sport,
    source_key: sourceKey,
    source_search_row_count: source.searchRows.length,
    merged_search_row_count: nextSearchRows.length,
    files_published: published.length,
    files: published
  };

  Logger.log("Targeted checklist search published: " + JSON.stringify({
    sport: result.sport,
    source_key: result.source_key,
    source_search_row_count: result.source_search_row_count,
    merged_search_row_count: result.merged_search_row_count,
    files_published: result.files_published
  }));

  return result;
}

function publishChecklistSourceSearchStandaloneToGitHubReleaseBase_(sportValue, sourceKeyValue) {
  const sport = normalizeKey_(sportValue);
  const sourceKey = value_(sourceKeyValue);
  if (!sport || !sourceKey) throw new Error("Missing sport or source key.");

  const source = buildChecklistStaticDataForSportSource_(sport, sourceKey);
  const generatedAt = source.generated_at;
  const safeSourceKey = safeSourceKeyForFile_(sourceKey);
  const baseName = sport + "-" + safeSourceKey;
  const published = [];

  published.push.apply(published, putGitHubShardedRows_(
    "data/v1/checklists/search-index/sources",
    baseName,
    source.searchRows,
    {
      ok: true,
      sport: sport,
      kind: "checklist_search_source",
      source: "Checklist DB map standalone source search",
      source_key: sourceKey,
      generated_at: generatedAt
    },
    "Update " + sport + " " + sourceKey + " standalone checklist search"
  ));

  const registry = fetchGitHubJsonFile_("data/v1/checklists/search-index/sources.json") || {};
  const nextRegistry = normalizeSearchSourceRegistry_(registry);
  if (!nextRegistry.sources[sport]) nextRegistry.sources[sport] = [];

  nextRegistry.sources[sport] = nextRegistry.sources[sport]
    .filter(item => value_(item.source_key) !== sourceKey);

  nextRegistry.sources[sport].push({
    source_key: sourceKey,
    path: "sources/" + baseName + ".json",
    generated_at: generatedAt
  });

  nextRegistry.sources[sport].sort((a, b) => value_(a.source_key).localeCompare(value_(b.source_key)));
  nextRegistry.generated_at = generatedAt;

  published.push(putGitHubJsonFile_(
    "data/v1/checklists/search-index/sources.json",
    nextRegistry,
    "Update checklist search source registry"
  ));

  const existingManifest = fetchGitHubJsonFile_("data/v1/manifest.json") || {};
  published.push(putGitHubJsonFile_(
    "data/v1/manifest.json",
    Object.assign({}, existingManifest, {
      ok: true,
      version: generatedAt,
      checklists_version: generatedAt,
      generated_at: generatedAt,
      schema: CM_EXPORT_VERSION
    }),
    "Update checklist manifest " + sport + " " + sourceKey + " standalone search"
  ));

  const result = {
    ok: true,
    mode: "targeted_source_search_standalone",
    sport: sport,
    source_key: sourceKey,
    source_search_row_count: source.searchRows.length,
    files_published: published.length,
    files: published
  };

  Logger.log("Standalone checklist search published: " + JSON.stringify({
    sport: result.sport,
    source_key: result.source_key,
    source_search_row_count: result.source_search_row_count,
    files_published: result.files_published
  }));

  return result;
}

function normalizeSearchSourceRegistry_(registry) {
  const sources = registry && registry.sources && typeof registry.sources === "object"
    ? registry.sources
    : {};

  return {
    ok: true,
    kind: "checklist_search_source_registry",
    generated_at: value_(registry && registry.generated_at) || new Date().toISOString(),
    sources: sources
  };
}

function safeSourceKeyForFile_(sourceKey) {
  return value_(sourceKey)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "source";
}

function publishChecklistIndexFromProductBundlesToGitHubReleaseBase_() {
  const generatedAt = new Date().toISOString();
  const indexRows = [];

  Object.keys(CM_CHECKLIST_DB_MAP).forEach(sport => {
    const products = fetchExistingChecklistProductMapForSport_(sport);

    Object.keys(products || {}).forEach(code => {
      const product = products[code] || {};
      const meta = product.meta || {};
      const displayName = value_(meta.displayName || meta.DisplayName);
      if (!code || !displayName) return;

      indexRows.push({
        Code: value_(meta.code || code),
        DisplayName: displayName,
        Keywords: value_(meta.keywords || meta.Keywords),
        year: value_(meta.year),
        sport: value_(meta.sport || sport),
        manufacturer: value_(meta.manufacturer),
        product: value_(meta.product)
      });
    });
  });

  indexRows.sort((a, b) => {
    const sportCompare = value_(a.sport).localeCompare(value_(b.sport));
    if (sportCompare !== 0) return sportCompare;
    const yearCompare = value_(b.year).localeCompare(value_(a.year));
    if (yearCompare !== 0) return yearCompare;
    return value_(a.DisplayName).localeCompare(value_(b.DisplayName));
  });

  const result = putGitHubJsonFile_(
    "data/v1/checklists/index.json",
    {
      ok: true,
      source: "Checklist product bundle rebuild",
      generated_at: generatedAt,
      index: indexRows
    },
    "Rebuild checklist index from product bundles"
  );

  Logger.log("Checklist index rebuilt from product bundles: " + JSON.stringify({
    product_count: indexRows.length,
    path: result.path
  }));

  return Object.assign({ ok: true, product_count: indexRows.length }, result);
}

function publishChecklistIndexFromGoogleSheetsToGitHubReleaseBase_() {
  const generatedAt = new Date().toISOString();
  const indexRows = [];
  const seenCodes = {};

  Object.keys(CM_CHECKLIST_DB_MAP).forEach(sport => {
    const spreadsheetIds = getChecklistSpreadsheetIdsForSport_(sport);

    spreadsheetIds.forEach(spreadsheetId => {
      const ss = SpreadsheetApp.openById(spreadsheetId);
      sheetObjects_(ss.getSheetByName(CM_CHECKLIST_DB_SHEETS.PRODUCTS))
        .map(row => normalizeChecklistProductRow_(row, sport))
        .filter(row => row.code && row.displayName)
        .forEach(product => {
          if (seenCodes[product.code]) return;
          seenCodes[product.code] = true;

          indexRows.push({
            Code: product.code,
            DisplayName: product.displayName,
            Keywords: product.keywords,
            year: product.year,
            sport: product.sport,
            manufacturer: product.manufacturer,
            product: product.product
          });
        });
    });
  });

  indexRows.sort((a, b) => {
    const sportCompare = value_(a.sport).localeCompare(value_(b.sport));
    if (sportCompare !== 0) return sportCompare;
    const yearCompare = value_(b.year).localeCompare(value_(a.year));
    if (yearCompare !== 0) return yearCompare;
    return value_(a.DisplayName).localeCompare(value_(b.DisplayName));
  });

  const result = putGitHubJsonFile_(
    "data/v1/checklists/index.json",
    {
      ok: true,
      source: "Checklist Google Sheets Products rebuild",
      generated_at: generatedAt,
      index: indexRows
    },
    "Rebuild checklist index from Google Sheets Products"
  );

  Logger.log("Checklist index rebuilt from Google Sheets Products: " + JSON.stringify({
    product_count: indexRows.length,
    path: result.path
  }));

  return Object.assign({ ok: true, product_count: indexRows.length }, result);
}

function publishMlbStatsToGitHub() {
  const previousPayload = fetchGitHubJsonFile_("data/v1/players/mlb-stats.json");
  const previousRows = normalizeMlbStatsRows_(previousPayload);
  const playerRows = getMlbPlayerStatsFromStatsApi_();
  if (!playerRows.length) {
    throw new Error("MLB Stats API returned no rows. Nothing was published.");
  }

  const generatedAt = new Date().toISOString();
  const payload = {
    ok: true,
    source: "MLB Stats API",
    generated_at: generatedAt,
    players: playerRows
  };

  let previousResult = null;
  if (previousRows.length) {
    previousResult = putGitHubJsonFile_(
      "data/v1/players/mlb-stats-previous.json",
      Object.assign({}, previousPayload || {}, {
        ok: true,
        snapshot_role: "previous_for_early_signals",
        archived_at: generatedAt
      }),
      "Archive previous MLB player stats snapshot"
    );
  }

  const earlySignalsPayload = buildMlbEarlySignalsPayload_(playerRows, previousRows, generatedAt);

  const result = putGitHubJsonFile_(
    "data/v1/players/mlb-stats.json",
    payload,
    "Update MLB player stats data"
  );

  const earlySignalsResult = putGitHubJsonFile_(
    "data/v1/players/mlb-early-signals.json",
    earlySignalsPayload,
    "Update MLB early signals data"
  );

  Logger.log("MLB stats published: " + JSON.stringify({
    player_count: playerRows.length,
    path: result.path,
    commit: result.commit,
    early_signals_count: earlySignalsPayload.signals.length,
    early_signals_path: earlySignalsResult.path
  }));

  return Object.assign({
    ok: true,
    player_count: playerRows.length,
    previous_snapshot_path: previousResult ? previousResult.path : "",
    early_signals_count: earlySignalsPayload.signals.length,
    early_signals_path: earlySignalsResult.path
  }, result);
}

function publishMlbEarlySignalsToGitHub() {
  const currentPayload = fetchGitHubJsonFile_("data/v1/players/mlb-stats.json");
  const previousPayload = fetchGitHubJsonFile_("data/v1/players/mlb-stats-previous.json");
  const currentRows = normalizeMlbStatsRows_(currentPayload);
  const previousRows = normalizeMlbStatsRows_(previousPayload);

  if (!currentRows.length) {
    throw new Error("No current MLB stats found at data/v1/players/mlb-stats.json.");
  }

  const generatedAt = new Date().toISOString();
  const earlySignalsPayload = buildMlbEarlySignalsPayload_(currentRows, previousRows, generatedAt);
  const result = putGitHubJsonFile_(
    "data/v1/players/mlb-early-signals.json",
    earlySignalsPayload,
    "Update MLB early signals data"
  );

  Logger.log("MLB early signals published: " + JSON.stringify({
    signal_count: earlySignalsPayload.signals.length,
    path: result.path
  }));

  return Object.assign({
    ok: true,
    signal_count: earlySignalsPayload.signals.length
  }, result);
}

function buildMlbEarlySignalsPayload_(currentRows, previousRows, generatedAt) {
  const currentPlayers = normalizeMlbStatsRows_(currentRows);
  const previousPlayers = normalizeMlbStatsRows_(previousRows);
  const rcIndex = buildRecentBaseballRcPlayerIndex_();
  const currentLeaderboards = buildMlbLeaderboards_(currentPlayers);
  const previousLeaderboards = buildMlbLeaderboards_(previousPlayers);
  const previousById = indexMlbRowsById_(previousPlayers);
  const previousByName = indexMlbRowsByName_(previousPlayers);
  const signals = [];

  currentPlayers.forEach(player => {
    const key = normalizePersonNameForSignal_(player.player);
    const rc = rcIndex[key];
    if (!rc) return;

    const signal = buildMlbEarlySignalForPlayer_(
      player,
      rc,
      previousById[value_(player.mlb_id)] || previousByName[key] || null,
      currentLeaderboards,
      previousLeaderboards
    );

    if (signal && signal.score > 0) signals.push(signal);
  });

  signals.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return value_(a.player).localeCompare(value_(b.player));
  });

  return {
    ok: true,
    kind: "mlb_early_signals",
    source: "MLB Stats API + Checklist RC tags",
    generated_at: generatedAt || new Date().toISOString(),
    rc_years: CM_EARLY_SIGNAL_RC_YEARS,
    snapshot_status: previousPlayers.length ? "compared_to_previous_snapshot" : "baseline_no_previous_snapshot",
    methodology: {
      summary: "Recent RC players are matched from Checklist Vault RC tags, ranked against MLB leaderboards, and compared with the previous MLB stats snapshot when available.",
      primary_focus: "2024, 2025, and 2026 baseball RC players",
      hitter_stats: ["HR", "RBI", "H", "OPS", "BA"],
      pitcher_stats: ["SO", "SV", "IP", "ERA", "WHIP"],
      guardrail: "This is a research signal, not buying advice."
    },
    counts: {
      mlb_players: currentPlayers.length,
      previous_mlb_players: previousPlayers.length,
      rc_players_matched: Object.keys(rcIndex).length,
      signals: Math.min(signals.length, CM_EARLY_SIGNAL_MAX_PLAYERS)
    },
    signals: signals.slice(0, CM_EARLY_SIGNAL_MAX_PLAYERS)
  };
}

function buildMlbEarlySignalForPlayer_(player, rc, previousPlayer, currentLeaderboards, previousLeaderboards) {
  const type = value_(player.player_type) === "pitcher" ? "pitcher" : "hitter";
  const statKeys = type === "pitcher"
    ? ["so", "sv", "ip", "era", "whip"]
    : ["hr", "rbi", "h", "ops", "ba"];
  const labels = {
    h: "H",
    hr: "HR",
    rbi: "RBI",
    ba: "BA",
    ops: "OPS",
    era: "ERA",
    sv: "SV",
    ip: "IP",
    so: "SO",
    whip: "WHIP"
  };
  const currentStats = player.season || {};
  const previousStats = previousPlayer && previousPlayer.season ? previousPlayer.season : {};
  const leaderboard = [];
  const climbing = [];
  let score = 0;

  statKeys.forEach(statKey => {
    const currentRank = getLeaderboardRank_(currentLeaderboards, type, statKey, player);
    const previousRank = previousPlayer
      ? getLeaderboardRank_(previousLeaderboards, type, statKey, previousPlayer)
      : null;
    const currentValue = value_(currentStats[statKey]);
    const previousValue = value_(previousStats[statKey]);

    if (currentRank) {
      const rankPoints = scoreLeaderboardRank_(currentRank, statKey);
      score += rankPoints;
      leaderboard.push({
        stat: labels[statKey] || statKey.toUpperCase(),
        value: currentValue,
        rank: currentRank,
        previous_rank: previousRank || "",
        rank_change: previousRank ? previousRank - currentRank : "",
        leaderboard_points: rankPoints
      });
    }

    if (previousPlayer && currentRank && previousRank && previousRank > currentRank) {
      const climb = previousRank - currentRank;
      const climbPoints = scoreRankClimb_(climb);
      score += climbPoints;
      climbing.push({
        stat: labels[statKey] || statKey.toUpperCase(),
        from_rank: previousRank,
        to_rank: currentRank,
        climb: climb,
        climb_points: climbPoints
      });
    }

    const delta = statDelta_(statKey, currentValue, previousValue);
    if (delta.points > 0) {
      score += delta.points;
      climbing.push({
        stat: labels[statKey] || statKey.toUpperCase(),
        previous_value: previousValue,
        current_value: currentValue,
        change: delta.change,
        climb_points: delta.points
      });
    }
  });

  const rcPoints = scoreRcOpportunity_(rc);
  score += rcPoints;

  const reasonParts = [];
  const topRanks = leaderboard
    .filter(item => item.rank <= 50)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 3);
  topRanks.forEach(item => {
    reasonParts.push("Top " + item.rank + " in " + item.stat);
  });
  if (climbing.length) reasonParts.push("Climbing in " + climbing.slice(0, 2).map(item => item.stat).join(" and "));
  if (rc.autograph_count) reasonParts.push("RC autograph checklist data found");
  if (rc.low_numbered_count) reasonParts.push("Low-numbered RC checklist data found");

  if (!leaderboard.length && !climbing.length) return null;

  return {
    player: player.player,
    mlb_id: player.mlb_id || "",
    player_type: type,
    score: Math.round(score),
    signal_level: score >= 90 ? "high" : (score >= 55 ? "medium" : "watch"),
    summary: reasonParts.length ? reasonParts.join(". ") + "." : "Recent RC player appearing on MLB leaderboards.",
    season: currentStats,
    leaderboard: leaderboard
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 6),
    climbing: climbing
      .sort((a, b) => Number(b.climb_points || 0) - Number(a.climb_points || 0))
      .slice(0, 6),
    rc_profile: {
      rc_years: rc.rc_years,
      rc_card_count: rc.rc_card_count,
      product_count: rc.product_count,
      autograph_count: rc.autograph_count,
      low_numbered_count: rc.low_numbered_count,
      sample_products: rc.sample_products
    },
    suggested_searches: [
      player.player + " rookie cards",
      player.player + " rookie autographs",
      player.player + " numbered parallels"
    ],
    app_links: {
      checklist_search: "https://app.chasingmajors.com/checklists/?q=" + encodeURIComponent(player.player + " rookie cards"),
      chatbot_search: "https://app.chasingmajors.com/ChatBot/?q=" + encodeURIComponent("Show me " + player.player + " rookie cards")
    }
  };
}

function buildRecentBaseballRcPlayerIndex_() {
  const rows = fetchExistingChecklistSearchRowsForSport_("baseball");
  const out = {};

  rows.forEach(row => {
    const player = value_(row.player);
    if (!player || !isLikelySinglePlayerSignalName_(player)) return;
    if (!isRcTag_(row.tag)) return;

    const year = extractChecklistYearForSignal_(row);
    if (CM_EARLY_SIGNAL_RC_YEARS.indexOf(year) === -1) return;

    const key = normalizePersonNameForSignal_(player);
    if (!key) return;

    if (!out[key]) {
      out[key] = {
        player: player,
        rc_years_map: {},
        products_map: {},
        sample_products: [],
        rc_card_count: 0,
        autograph_count: 0,
        low_numbered_count: 0
      };
    }

    out[key].rc_years_map[year] = true;
    out[key].products_map[value_(row.code)] = value_(row.displayName);
    out[key].rc_card_count += 1;

    if (/auto|autograph/i.test(value_(row.section) + " " + value_(row.subset) + " " + value_(row.tag))) {
      out[key].autograph_count += 1;
    }

    const serial = parseSerialLimitForSignal_(row.tag);
    if (serial > 0 && serial <= 100) {
      out[key].low_numbered_count += 1;
    }
  });

  Object.keys(out).forEach(key => {
    const item = out[key];
    item.rc_years = Object.keys(item.rc_years_map)
      .map(y => Number(y))
      .sort((a, b) => a - b);
    item.sample_products = Object.keys(item.products_map)
      .map(code => item.products_map[code])
      .filter(Boolean)
      .slice(0, 6);
    item.product_count = Object.keys(item.products_map).length;
    delete item.rc_years_map;
    delete item.products_map;
  });

  return out;
}

function buildMlbLeaderboards_(players) {
  const hitters = players.filter(p => value_(p.player_type) !== "pitcher");
  const pitchers = players.filter(p => value_(p.player_type) === "pitcher");
  return {
    hitter: {
      h: rankMlbPlayers_(hitters, "h", "desc"),
      hr: rankMlbPlayers_(hitters, "hr", "desc"),
      rbi: rankMlbPlayers_(hitters, "rbi", "desc"),
      ba: rankMlbPlayers_(hitters, "ba", "desc"),
      ops: rankMlbPlayers_(hitters, "ops", "desc")
    },
    pitcher: {
      era: rankMlbPlayers_(pitchers, "era", "asc"),
      sv: rankMlbPlayers_(pitchers, "sv", "desc"),
      ip: rankMlbPlayers_(pitchers, "ip", "desc"),
      so: rankMlbPlayers_(pitchers, "so", "desc"),
      whip: rankMlbPlayers_(pitchers, "whip", "asc")
    }
  };
}

function rankMlbPlayers_(players, statKey, direction) {
  const scored = players
    .map(player => ({
      id: value_(player.mlb_id),
      name_key: normalizePersonNameForSignal_(player.player),
      value: parseBaseballStatForSignal_(player && player.season ? player.season[statKey] : "")
    }))
    .filter(item => Number.isFinite(item.value));

  scored.sort((a, b) => direction === "asc" ? a.value - b.value : b.value - a.value);

  const ranks = {};
  let lastValue = null;
  let rank = 0;

  scored.forEach((item, idx) => {
    if (lastValue === null || item.value !== lastValue) rank = idx + 1;
    lastValue = item.value;
    if (item.id) ranks["id:" + item.id] = rank;
    if (item.name_key) ranks["name:" + item.name_key] = rank;
  });

  return ranks;
}

function getLeaderboardRank_(leaderboards, playerType, statKey, player) {
  const board = leaderboards && leaderboards[playerType] && leaderboards[playerType][statKey];
  if (!board) return null;
  return board["id:" + value_(player.mlb_id)] || board["name:" + normalizePersonNameForSignal_(player.player)] || null;
}

function normalizeMlbStatsRows_(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.players)) return payload.players;
  if (payload && Array.isArray(payload.rows)) return payload.rows;
  return [];
}

function indexMlbRowsById_(rows) {
  const out = {};
  rows.forEach(row => {
    const id = value_(row.mlb_id);
    if (id) out[id] = row;
  });
  return out;
}

function indexMlbRowsByName_(rows) {
  const out = {};
  rows.forEach(row => {
    const key = normalizePersonNameForSignal_(row.player);
    if (key) out[key] = row;
  });
  return out;
}

function scoreLeaderboardRank_(rank, statKey) {
  if (!rank) return 0;
  if (rank <= 5) return 34;
  if (rank <= 10) return 28;
  if (rank <= 25) return 20;
  if (rank <= 50) return 12;
  if (rank <= 100) return 5;
  return 0;
}

function scoreRankClimb_(climb) {
  const n = Number(climb) || 0;
  if (n >= 50) return 28;
  if (n >= 25) return 20;
  if (n >= 10) return 12;
  if (n >= 5) return 7;
  if (n >= 1) return 3;
  return 0;
}

function scoreRcOpportunity_(rc) {
  let score = 8;
  score += Math.min(Number(rc.product_count || 0), 10) * 2;
  score += Math.min(Number(rc.autograph_count || 0), 5) * 5;
  score += Math.min(Number(rc.low_numbered_count || 0), 5) * 4;
  return score;
}

function statDelta_(statKey, currentValue, previousValue) {
  const current = parseBaseballStatForSignal_(currentValue);
  const previous = parseBaseballStatForSignal_(previousValue);
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return { change: "", points: 0 };

  const change = current - previous;
  if (change <= 0) return { change: change, points: 0 };

  if (statKey === "hr" && change >= 2) return { change: change, points: 10 };
  if (statKey === "rbi" && change >= 5) return { change: change, points: 8 };
  if (statKey === "h" && change >= 8) return { change: change, points: 8 };
  if (statKey === "so" && change >= 10) return { change: change, points: 8 };
  if (statKey === "sv" && change >= 2) return { change: change, points: 8 };
  if ((statKey === "ops" || statKey === "ba") && change >= 0.05) return { change: Number(change.toFixed(3)), points: 6 };
  return { change: Number(change.toFixed(3)), points: 0 };
}

function parseBaseballStatForSignal_(value) {
  const raw = value_(value).replace(/,/g, "");
  if (!raw || raw === "-" || raw === ".---") return NaN;
  if (/^\.\d+$/.test(raw)) return Number("0" + raw);
  return Number(raw);
}

function normalizePersonNameForSignal_(name) {
  return value_(name)
    .toLowerCase()
    .replace(/[^\w\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelySinglePlayerSignalName_(player) {
  const raw = value_(player);
  if (!raw) return false;
  const lower = raw.toLowerCase();
  const blocked = [" / ", " & ", " and ", " with ", " vs ", " versus "];
  for (let i = 0; i < blocked.length; i++) {
    if (lower.indexOf(blocked[i]) !== -1) return false;
  }
  const parts = raw.replace(/[."']/g, "").split(/\s+/).filter(Boolean);
  return parts.length >= 2 && parts.length <= 5;
}

function isRcTag_(tag) {
  return /\bRC\b/i.test(value_(tag));
}

function extractChecklistYearForSignal_(row) {
  const hay = [row.year, row.displayName, row.code, row.search_blob].map(value_).join(" ");
  const m = hay.match(/\b(2024|2025|2026)(?:-\d{2})?\b/);
  return m ? Number(m[1]) : 0;
}

function parseSerialLimitForSignal_(value) {
  const raw = value_(value);
  let m = raw.match(/\/\s*(\d{1,6})\b/);
  if (m) return Number(m[1]) || 0;
  m = raw.match(/\b(?:sn|serial|numbered|#)\s*[-:]?\s*(\d{1,6})\b/i);
  if (m) return Number(m[1]) || 0;
  return 0;
}

function publishVaultStaticDataToGitHubFullBase_() {
  const built = buildVaultStaticData_();
  const published = [];

  published.push(putGitHubJsonFile_(
    "data/v1/vault/index.json",
    {
      ok: true,
      source: "Print Run Vault spreadsheet",
      generated_at: built.generated_at,
      index: built.index
    },
    "Update vault index data"
  ));

  published.push.apply(published, putGitHubShardedObjectMap_(
    "data/v1/vault/products",
    "all",
    built.products,
    {
      ok: true,
      kind: "vault_products",
      source: "Print Run Vault spreadsheet",
      generated_at: built.generated_at
    },
    "Update vault product data"
  ));

  Object.keys(built.pop).forEach(sport => {
    published.push(putGitHubJsonFile_(
      "data/v1/vault/pop/" + sport + ".json",
      Object.assign({}, built.pop[sport], {
        source: "Print Run Vault pop spreadsheet",
        generated_at: built.generated_at
      }),
      "Update vault pop data " + sport
    ));
  });

  const existingManifest = fetchGitHubJsonFile_("data/v1/manifest.json") || {};
  published.push(putGitHubJsonFile_(
    "data/v1/manifest.json",
    Object.assign({}, existingManifest, {
      ok: true,
      version: built.generated_at,
      vault_version: built.generated_at,
      generated_at: built.generated_at,
      schema: CM_EXPORT_VERSION
    }),
    "Update vault manifest"
  ));

  const result = {
    ok: true,
    source: "Print Run Vault spreadsheet",
    product_count: built.index.length,
    files_published: published.length,
    generated_at: built.generated_at,
    files: published
  };

  Logger.log("Vault static data published: " + JSON.stringify({
    product_count: result.product_count,
    files_published: result.files_published
  }));

  return result;
}

function publishVaultStaticDataToGitHubScheduledBase_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    const skipped = {
      ok: false,
      skipped: true,
      reason: "Another PRV static data publish is already running.",
      updated_at: new Date().toISOString()
    };
    Logger.log("Vault static data publish skipped: " + JSON.stringify(skipped));
    return skipped;
  }

  try {
    return publishVaultStaticDataToGitHub();
  } catch (err) {
    const failed = {
      ok: false,
      error: err && err.message ? err.message : String(err),
      stack: err && err.stack ? String(err.stack).slice(0, 2000) : "",
      updated_at: new Date().toISOString()
    };
    Logger.log("Scheduled vault static data publish failed: " + JSON.stringify(failed));
    return failed;
  } finally {
    lock.releaseLock();
  }
}

function publishVaultStaticDataToGitHubBase_(input) {
  requireCmOperatorKey_(input && input.key);

  const code = value_(input && input.code);
  const result = publishVaultStaticDataToGitHub();
  const validation = code ? validatePublishedVaultProductLite_(code) : validatePublishedVaultManifestLite_();

  return {
    ok: !!result.ok,
    status: validation.ok ? "published_and_public_validated" : "published_validation_needs_review",
    mode: "approved_prv_publish",
    code: code,
    publish: result,
    validation: validation,
    updated_at: new Date().toISOString()
  };
}

function validatePublishedVaultProductLite_(code) {
  const targetCode = value_(code);
  if (!targetCode) return { ok: false, error: "Missing PRV product code." };

  try {
    const manifest = JSON.parse(UrlFetchApp.fetch("https://app.chasingmajors.com/data/v1/vault/products/all.json", {
      method: "get",
      muteHttpExceptions: true
    }).getContentText());
    const productMap = manifest.product_map || manifest.productMap || {};
    const shard = productMap[targetCode];
    if (!shard) {
      return {
        ok: false,
        code: targetCode,
        row_count: 0,
        error: "Product code not found in public PRV product manifest yet."
      };
    }

    const shardData = JSON.parse(UrlFetchApp.fetch("https://app.chasingmajors.com/data/v1/vault/products/" + shard, {
      method: "get",
      muteHttpExceptions: true
    }).getContentText());
    const products = shardData && shardData.products
      ? shardData.products
      : shardData && shardData.data && shardData.data.products
        ? shardData.data.products
        : {};
    const product = products[targetCode] || null;
    const rows = product && Array.isArray(product.rows) ? product.rows : [];

    return {
      ok: rows.length > 0,
      code: targetCode,
      shard: shard,
      row_count: rows.length
    };
  } catch (err) {
    return {
      ok: false,
      code: targetCode,
      row_count: 0,
      error: err && err.message ? err.message : String(err)
    };
  }
}

function validatePublishedVaultManifestLite_() {
  try {
    const manifest = JSON.parse(UrlFetchApp.fetch("https://app.chasingmajors.com/data/v1/vault/products/all.json", {
      method: "get",
      muteHttpExceptions: true
    }).getContentText());
    const productMap = manifest.product_map || manifest.productMap || {};
    const shardNames = uniqueIds_(Object.keys(productMap).map(code => productMap[code]));
    let publicRows = 0;
    let productCount = 0;

    shardNames.forEach(shard => {
      if (!shard) return;
      const shardData = JSON.parse(UrlFetchApp.fetch("https://app.chasingmajors.com/data/v1/vault/products/" + shard, {
        method: "get",
        muteHttpExceptions: true
      }).getContentText());
      const products = shardData && shardData.products
        ? shardData.products
        : shardData && shardData.data && shardData.data.products
          ? shardData.data.products
          : {};
      Object.keys(products || {}).forEach(code => {
        productCount++;
        const rows = products[code] && Array.isArray(products[code].rows) ? products[code].rows : [];
        publicRows += rows.length;
      });
    });

    return {
      ok: productCount > 0,
      kind: "vault_manifest",
      product_count: productCount,
      shard_count: shardNames.length,
      row_count: publicRows
    };
  } catch (err) {
    return {
      ok: false,
      kind: "vault_manifest",
      product_count: 0,
      shard_count: 0,
      row_count: 0,
      error: err && err.message ? err.message : String(err)
    };
  }
}

function publishCoreStaticDataToGitHub() {
  const checklist = publishCurrentChecklistStaticDataToGitHub();
  const vault = publishVaultStaticDataToGitHub();
  const mlbStats = publishMlbStatsToGitHub();
  const releases = publishReleaseScheduleToGitHub();

  return {
    ok: true,
    checklist: {
      mode: checklist.mode,
      results: checklist.results.map(result => ({
        sport: result.sport,
        product_count: result.product_count,
        current_search_row_count: result.current_search_row_count,
        files_published: result.files_published
      }))
    },
    vault: {
      product_count: vault.product_count,
      files_published: vault.files_published
    },
    mlb_stats: {
      player_count: mlbStats.player_count,
      path: mlbStats.path,
      early_signals_count: mlbStats.early_signals_count,
      early_signals_path: mlbStats.early_signals_path
    },
    releases: {
      row_count: releases.row_count,
      path: releases.path
    }
  };
}

function installCoreStaticDataGitHubTriggers() {
  deleteCoreStaticDataGitHubTriggers();

  ScriptApp.newTrigger("publishCoreStaticDataToGitHub")
    .timeBased()
    .everyDays(1)
    .atHour(23)
    .create();

  return {
    ok: true,
    installed: true,
    function_name: "publishCoreStaticDataToGitHub",
    timezone: Session.getScriptTimeZone() || "America/Denver",
    schedule: "daily_11pm"
  };
}

function deleteCoreStaticDataGitHubTriggers() {
  let deleted = 0;

  ScriptApp.getProjectTriggers().forEach(trigger => {
    const fn = trigger.getHandlerFunction && trigger.getHandlerFunction();
    if (fn === "publishCoreStaticDataToGitHub") {
      ScriptApp.deleteTrigger(trigger);
      deleted++;
    }
  });

  return {
    ok: true,
    deleted: deleted,
    function_name: "publishCoreStaticDataToGitHub"
  };
}

function installVaultStaticDataGitHubTriggers() {
  deleteVaultStaticDataGitHubTriggers();

  [9, 12, 15, 23].forEach(hour => {
    ScriptApp.newTrigger("publishVaultStaticDataToGitHubScheduled")
      .timeBased()
      .everyDays(1)
      .atHour(hour)
      .create();
  });

  return {
    ok: true,
    installed: true,
    function_name: "publishVaultStaticDataToGitHubScheduled",
    timezone: Session.getScriptTimeZone() || "America/Denver",
    hours: [9, 12, 15, 23],
    labels: ["9am", "Noon", "3pm", "11pm EOD"]
  };
}

function deleteVaultStaticDataGitHubTriggers() {
  let deleted = 0;

  ScriptApp.getProjectTriggers().forEach(trigger => {
    const fn = trigger.getHandlerFunction && trigger.getHandlerFunction();
    if (fn === "publishVaultStaticDataToGitHub" || fn === "publishVaultStaticDataToGitHubScheduled") {
      ScriptApp.deleteTrigger(trigger);
      deleted++;
    }
  });

  return {
    ok: true,
    deleted: deleted,
    function_name: "publishVaultStaticDataToGitHubScheduled"
  };
}

function publishReleaseScheduleToGitHub() {
  const rows = buildReleaseScheduleRows_();
  const payload = {
    ok: true,
    source: "Release Schedule spreadsheet",
    spreadsheet_id: CM_RELEASE_SCHEDULE_SPREADSHEET_ID,
    generated_at: new Date().toISOString(),
    row_count: rows.length,
    rows: rows
  };

  const result = putGitHubJsonFile_(
    "data/v2/releases/schedule.json",
    payload,
    "Update release schedule data"
  );

  Logger.log("Release schedule published: " + JSON.stringify(result));
  return Object.assign({ ok: true, row_count: rows.length }, result);
}

function installReleaseScheduleGitHubTriggers() {
  deleteReleaseScheduleGitHubTriggers();

  [9, 12, 15, 23].forEach(hour => {
    ScriptApp.newTrigger("publishReleaseScheduleToGitHub")
      .timeBased()
      .everyDays(1)
      .atHour(hour)
      .create();
  });

  return {
    ok: true,
    installed: true,
    function_name: "publishReleaseScheduleToGitHub",
    timezone: Session.getScriptTimeZone() || "America/Denver",
    hours: [9, 12, 15, 23],
    labels: ["9am", "Noon", "3pm", "11pm EOD"]
  };
}

function deleteReleaseScheduleGitHubTriggers() {
  let deleted = 0;

  ScriptApp.getProjectTriggers().forEach(trigger => {
    const fn = trigger.getHandlerFunction && trigger.getHandlerFunction();
    if (fn === "publishReleaseScheduleToGitHub") {
      ScriptApp.deleteTrigger(trigger);
      deleted++;
    }
  });

  return {
    ok: true,
    deleted: deleted,
    function_name: "publishReleaseScheduleToGitHub"
  };
}

function buildReleaseScheduleRows_() {
  const ss = SpreadsheetApp.openById(CM_RELEASE_SCHEDULE_SPREADSHEET_ID);
  const sh = ss.getSheetByName(CM_RELEASE_SCHEDULE_SHEET);
  if (!sh) throw new Error("Missing release schedule sheet: " + CM_RELEASE_SCHEDULE_SHEET);

  const values = sh.getDataRange().getValues();
  if (!values || values.length < 2) return [];

  const headers = values[0].map(normalizeHeader_);
  const rows = values.slice(1)
    .filter(rowHasData_)
    .map(row => mapReleaseScheduleRow_(headers, row))
    .filter(Boolean);

  rows.sort(compareReleaseScheduleRows_);
  return rows;
}

function mapReleaseScheduleRow_(headers, row) {
  const obj = {};
  headers.forEach((header, i) => {
    obj[header] = row[i];
  });

  const releaseDateRaw = pickField_(obj, [
    "releasedate",
    "release_date",
    "date",
    "streetdate",
    "street_date"
  ]);

  const sport = titleCaseSafe_(pickField_(obj, ["sport"]));
  const manufacturer = titleCaseSafe_(pickField_(obj, ["manufacturer", "brand"]));
  const product = value_(pickField_(obj, ["product", "release", "line"]));
  const setNameRaw = value_(pickField_(obj, [
    "setname",
    "set_name",
    "displayname",
    "display_name",
    "fullname",
    "full_name",
    "producttitle",
    "product_title"
  ]));
  const format = titleCaseSafe_(pickField_(obj, ["format", "boxformat", "box_format", "configuration"]));
  const statusRaw = value_(pickField_(obj, ["status"]));
  const checklistUrlRaw = value_(pickField_(obj, ["checklisturl", "checklist_url"]));
  const vaultUrlRaw = value_(pickField_(obj, ["vaulturl", "vault_url", "printrunurl", "print_run_url"]));

  const releaseDate = formatReleaseDateForApi_(releaseDateRaw);
  const setName = setNameRaw || buildReleaseSetName_(releaseDate, manufacturer, product, sport);
  const status = statusRaw || deriveReleaseStatus_(releaseDate);
  const checklistUrl = checklistUrlRaw || buildReleaseChecklistUrl_(setName);
  const vaultUrl = vaultUrlRaw || buildReleaseVaultUrl_(setName);

  if (!releaseDate && !sport && !manufacturer && !product && !setName) return null;

  return {
    releaseDate: releaseDate,
    sport: sport,
    manufacturer: manufacturer,
    product: product,
    setName: setName,
    format: format,
    status: status,
    checklistUrl: checklistUrl,
    vaultUrl: vaultUrl
  };
}

function compareReleaseScheduleRows_(a, b) {
  const aSportRank = getReleaseSportRank_(a.sport);
  const bSportRank = getReleaseSportRank_(b.sport);

  if (aSportRank !== bSportRank) return aSportRank - bSportRank;

  const aAnnounced = isAnnouncedReleaseDate_(a.releaseDate);
  const bAnnounced = isAnnouncedReleaseDate_(b.releaseDate);

  if (aAnnounced !== bAnnounced) return aAnnounced ? 1 : -1;

  const aDate = value_(a.releaseDate);
  const bDate = value_(b.releaseDate);

  if (aDate && bDate && aDate !== bDate && !aAnnounced && !bAnnounced) {
    return aDate.localeCompare(bDate);
  }

  const aName = value_(a.setName || a.product);
  const bName = value_(b.setName || b.product);
  return aName.localeCompare(bName);
}

function formatReleaseDateForApi_(value) {
  if (!value) return "";

  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone() || "America/Denver", "yyyy-MM-dd");
  }

  const raw = value_(value);
  if (!raw) return "";
  if (/^announced$/i.test(raw)) return "Announced";
  if (/^tbd$/i.test(raw)) return "TBD";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return us[3] + "-" + pad2_(us[1]) + "-" + pad2_(us[2]);

  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, Session.getScriptTimeZone() || "America/Denver", "yyyy-MM-dd");
  }

  return raw;
}

function buildReleaseSetName_(releaseDate, manufacturer, product, sport) {
  const year = releaseDate && /^\d{4}-/.test(releaseDate) ? releaseDate.slice(0, 4) : "";
  return [year, manufacturer, product, sport].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function deriveReleaseStatus_(releaseDate) {
  const raw = value_(releaseDate);
  if (!raw) return "";
  if (/^announced$/i.test(raw) || /^tbd$/i.test(raw)) return "Announced";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "America/Denver", "yyyy-MM-dd");
  return raw >= today ? "Upcoming" : "Released";
}

function buildReleaseChecklistUrl_(setName) {
  return setName ? "/checklists/?q=" + encodeURIComponent(setName) : "";
}

function buildReleaseVaultUrl_(setName) {
  return setName ? "/vault/?q=" + encodeURIComponent(setName) : "";
}

function getReleaseSportRank_(sport) {
  const idx = CM_RELEASE_SPORT_ORDER.indexOf(titleCaseSafe_(sport));
  return idx === -1 ? 999 : idx;
}

function isAnnouncedReleaseDate_(releaseDate) {
  const raw = value_(releaseDate).toLowerCase();
  return raw === "" || raw === "announced" || raw === "tbd";
}

function buildChecklistStaticDataFromDbMap_() {
  const generatedAt = new Date().toISOString();
  const mergedIndex = [];
  const productsBySport = {};
  const searchRowsBySport = {};
  let searchRowCount = 0;

  Object.keys(CM_CHECKLIST_DB_MAP).forEach(sport => {
    const spreadsheetIds = getChecklistSpreadsheetIdsForSport_(sport);
    const productsByCode = {};
    const checklistRowsByCode = {};
    const parallelRowsByCode = {};
    const sportSearchRows = [];

    spreadsheetIds.forEach(spreadsheetId => {
      const ss = SpreadsheetApp.openById(spreadsheetId);
      const products = sheetObjects_(ss.getSheetByName(CM_CHECKLIST_DB_SHEETS.PRODUCTS))
        .map(row => normalizeChecklistProductRow_(row, sport))
        .filter(row => row.code && row.displayName);

      products.forEach(product => {
        if (!productsByCode[product.code]) productsByCode[product.code] = product;
      });

      const checklistRows = sheetObjects_(ss.getSheetByName(CM_CHECKLIST_DB_SHEETS.CHECKLIST))
        .map(row => normalizeChecklistCardRow_(row, sport))
        .filter(row => row.code);

      checklistRows.forEach(row => {
        if (!checklistRowsByCode[row.code]) checklistRowsByCode[row.code] = [];
        checklistRowsByCode[row.code].push(row);
      });

      const parallelRows = sheetObjects_(ss.getSheetByName(CM_CHECKLIST_DB_SHEETS.PARALLELS))
        .map(normalizeChecklistParallelRow_)
        .filter(row => row.code);

      parallelRows.forEach(row => {
        if (!parallelRowsByCode[row.code]) parallelRowsByCode[row.code] = [];
        parallelRowsByCode[row.code].push(row);
      });
    });

    const sportProducts = {};

    Object.keys(productsByCode)
      .sort((a, b) => a.localeCompare(b))
      .forEach(code => {
        const product = productsByCode[code];
        const rows = checklistRowsByCode[code] || [];
        const parallels = parallelRowsByCode[code] || [];

        mergedIndex.push({
          Code: product.code,
          DisplayName: product.displayName,
          Keywords: product.keywords,
          year: product.year,
          sport: product.sport,
          manufacturer: product.manufacturer,
          product: product.product
        });

        sportProducts[code] = {
          ok: true,
          meta: {
            code: product.code,
            displayName: product.displayName,
            keywords: product.keywords,
            year: product.year,
            manufacturer: product.manufacturer,
            product: product.product,
            sport: product.sport
          },
          rows: rows,
          parallels: parallels
        };

        sportSearchRows.push(buildProductSearchRow_(product));
        rows.forEach(row => sportSearchRows.push(buildChecklistCardSearchRow_(product, row)));
      });

    productsBySport[sport] = sportProducts;
    searchRowsBySport[sport] = sportSearchRows;
    searchRowCount += sportSearchRows.length;
  });

  mergedIndex.sort((a, b) => {
    const sportCompare = value_(a.sport).localeCompare(value_(b.sport));
    if (sportCompare !== 0) return sportCompare;
    const yearCompare = value_(b.year).localeCompare(value_(a.year));
    if (yearCompare !== 0) return yearCompare;
    return value_(a.DisplayName).localeCompare(value_(b.DisplayName));
  });

  return {
    generated_at: generatedAt,
    index: mergedIndex,
    productsBySport: productsBySport,
    searchRowsBySport: searchRowsBySport,
    searchRowCount: searchRowCount
  };
}

function buildCurrentChecklistStaticDataForSport_(sportValue) {
  const sport = normalizeKey_(sportValue);
  const currentKey = value_(CM_ACTIVE_CURRENT_KEYS[sport]);
  const sportMap = CM_CHECKLIST_DB_MAP[sport] || {};
  const spreadsheetId = value_(sportMap.current || sportMap[currentKey]);

  if (!spreadsheetId) throw new Error("No current spreadsheet configured for " + sport);

  return buildChecklistStaticDataForSpreadsheet_(sport, currentKey, spreadsheetId);
}

function buildChecklistStaticDataForSportSource_(sportValue, sourceKeyValue) {
  const sport = normalizeKey_(sportValue);
  const sourceKey = resolveChecklistSourceKey_(sport, sourceKeyValue);
  const sportMap = CM_CHECKLIST_DB_MAP[sport] || {};
  const spreadsheetId = value_(sportMap[sourceKey]);

  if (!spreadsheetId) throw new Error("No spreadsheet configured for " + sport + " " + sourceKey);

  return buildChecklistStaticDataForSpreadsheet_(sport, sourceKey, spreadsheetId);
}

function buildChecklistStaticDataForSpreadsheet_(sport, sourceKey, spreadsheetId) {
  const generatedAt = new Date().toISOString();
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const productsByCode = {};
  const checklistRowsByCode = {};
  const parallelRowsByCode = {};
  const index = [];
  const products = {};
  const searchRows = [];

  sheetObjects_(ss.getSheetByName(CM_CHECKLIST_DB_SHEETS.PRODUCTS))
    .map(row => normalizeChecklistProductRow_(row, sport))
    .filter(row => row.code && row.displayName)
    .forEach(product => {
      productsByCode[product.code] = product;
    });

  sheetObjects_(ss.getSheetByName(CM_CHECKLIST_DB_SHEETS.CHECKLIST))
    .map(row => normalizeChecklistCardRow_(row, sport))
    .filter(row => row.code)
    .forEach(row => {
      if (!checklistRowsByCode[row.code]) checklistRowsByCode[row.code] = [];
      checklistRowsByCode[row.code].push(row);
    });

  sheetObjects_(ss.getSheetByName(CM_CHECKLIST_DB_SHEETS.PARALLELS))
    .map(normalizeChecklistParallelRow_)
    .filter(row => row.code)
    .forEach(row => {
      if (!parallelRowsByCode[row.code]) parallelRowsByCode[row.code] = [];
      parallelRowsByCode[row.code].push(row);
    });

  Object.keys(productsByCode)
    .sort((a, b) => a.localeCompare(b))
    .forEach(code => {
      const product = productsByCode[code];
      const rows = checklistRowsByCode[code] || [];
      const parallels = parallelRowsByCode[code] || [];

      index.push({
        Code: product.code,
        DisplayName: product.displayName,
        Keywords: product.keywords,
        year: product.year,
        sport: product.sport,
        manufacturer: product.manufacturer,
        product: product.product
      });

      products[code] = {
        ok: true,
        meta: {
          code: product.code,
          displayName: product.displayName,
          keywords: product.keywords,
          source_key: sourceKey,
          year: product.year,
          manufacturer: product.manufacturer,
          product: product.product,
          sport: product.sport
        },
        rows: rows,
        parallels: parallels
      };

      searchRows.push(buildProductSearchRow_(product));
      rows.forEach(row => searchRows.push(buildChecklistCardSearchRow_(product, row)));
    });

  return {
    generated_at: generatedAt,
    sport: sport,
    current_key: value_(CM_ACTIVE_CURRENT_KEYS[sport]),
    source_key: sourceKey,
    spreadsheet_id: spreadsheetId,
    index: index,
    products: products,
    searchRows: searchRows
  };
}

function getChecklistSpreadsheetIdsForSport_(sport) {
  const sportMap = CM_CHECKLIST_DB_MAP[sport] || {};
  const seen = {};
  const ids = [];

  Object.keys(sportMap).forEach(key => {
    const id = value_(sportMap[key]);
    if (!id || seen[id]) return;
    seen[id] = true;
    ids.push(id);
  });

  return ids;
}

function resolveChecklistSourceKey_(sportValue, sourceKeyValue) {
  const sport = normalizeKey_(sportValue);
  const sourceKey = value_(sourceKeyValue);
  if (sport === "soccer" && sourceKey === "2026") return "2025-26";
  return sourceKey;
}

function normalizeChecklistProductRow_(row, sport) {
  return {
    code: value_(pickField_(row, ["code"])),
    displayName: value_(pickField_(row, ["display_name", "displayname", "release_name", "name"])),
    year: value_(pickField_(row, ["year"])),
    sport: value_(pickField_(row, ["sport"])) || sport,
    manufacturer: value_(pickField_(row, ["manufacturer", "brand"])),
    product: value_(pickField_(row, ["product", "release", "line"])),
    keywords: value_(pickField_(row, ["keywords", "search_keywords"]))
  };
}

function normalizeChecklistCardRow_(row, sport) {
  return {
    code: value_(pickField_(row, ["code"])),
    sport: value_(pickField_(row, ["sport"])) || sport,
    section: value_(pickField_(row, ["section"])),
    subset: value_(pickField_(row, ["subset"])),
    card_no: value_(pickField_(row, ["card_no", "cardno", "card_number", "cardnumber"])),
    player: value_(pickField_(row, ["player", "player_name", "name"])),
    team: value_(pickField_(row, ["team"])),
    tag: value_(pickField_(row, ["tag", "tags"]))
  };
}

function normalizeChecklistParallelRow_(row) {
  return {
    code: value_(pickField_(row, ["code"])),
    applies_to_section: value_(pickField_(row, ["applies_to_section", "section"])),
    applies_to_subset: value_(pickField_(row, ["applies_to_subset", "subset"])),
    parallel_name: value_(pickField_(row, ["parallel_name", "parallel"])),
    serial_no: value_(pickField_(row, ["serial_no", "serial", "serial_number"]))
  };
}

function buildProductSearchRow_(product) {
  const displayName = value_(product.displayName);
  return {
    term: displayName,
    type: "product",
    sport: product.sport,
    code: product.code,
    displayName: displayName,
    year: product.year,
    manufacturer: product.manufacturer,
    product: product.product,
    section: "",
    subset: "",
    card_no: "",
    player: "",
    team: "",
    tag: "",
    search_blob: [
      displayName,
      product.keywords,
      product.year,
      product.sport,
      product.manufacturer,
      product.product,
      product.code
    ].filter(Boolean).join(" ")
  };
}

function buildChecklistCardSearchRow_(product, row) {
  return {
    term: row.player || product.displayName,
    type: "card",
    sport: row.sport || product.sport,
    code: row.code,
    displayName: product.displayName,
    year: product.year,
    manufacturer: product.manufacturer,
    product: product.product,
    section: row.section,
    subset: row.subset,
    card_no: row.card_no,
    player: row.player,
    team: row.team,
    tag: row.tag,
    search_blob: [
      product.displayName,
      product.keywords,
      product.year,
      product.sport,
      product.manufacturer,
      product.product,
      row.section,
      row.subset,
      row.card_no,
      row.player,
      row.team,
      row.tag,
      row.code
    ].filter(Boolean).join(" ")
  };
}

function normalizeExistingChecklistIndex_(rows) {
  return (Array.isArray(rows) ? rows : []).map(row => ({
    Code: value_(row.Code || row.code),
    DisplayName: value_(row.DisplayName || row.displayName || row.display_name),
    Keywords: value_(row.Keywords || row.keywords),
    year: value_(row.year),
    sport: value_(row.sport),
    manufacturer: value_(row.manufacturer),
    product: value_(row.product)
  })).filter(row => row.Code && row.DisplayName);
}

function fetchExistingChecklistProductMapForSport_(sport) {
  const basePath = "data/v1/checklists/products/" + sport + ".json";
  const manifest = fetchGitHubJsonFile_(basePath);
  if (!manifest) return {};

  if (manifest.products) return manifest.products;
  if (!manifest.sharded || !Array.isArray(manifest.shards)) return {};

  return manifest.shards.reduce((out, fileName) => {
    const shard = fetchGitHubJsonFile_("data/v1/checklists/products/" + fileName) || {};
    const products = shard.products || {};
    Object.keys(products).forEach(code => {
      out[code] = products[code];
    });
    return out;
  }, {});
}

function fetchExistingChecklistSearchRowsForSport_(sport) {
  const basePath = "data/v1/checklists/search-index/" + sport + ".json";
  const manifest = fetchGitHubJsonFile_(basePath);
  if (!manifest) return [];

  if (Array.isArray(manifest.rows)) return manifest.rows;
  if (!manifest.sharded || !Array.isArray(manifest.shards)) return [];

  return manifest.shards.reduce((out, fileName) => {
    const shard = fetchGitHubJsonFile_("data/v1/checklists/search-index/" + fileName) || {};
    const rows = Array.isArray(shard.rows) ? shard.rows : [];
    rows.forEach(row => out.push(row));
    return out;
  }, []);
}

function normalizeKey_(value) {
  return value_(value).toLowerCase().replace(/\s+/g, "_");
}

function requireCmOperatorKey_(providedKey) {
  const expected = PropertiesService.getScriptProperties().getProperty(CM_OPERATOR_KEY_PROPERTY);
  if (!expected) {
    throw new Error("Missing Script Property: " + CM_OPERATOR_KEY_PROPERTY);
  }

  if (value_(providedKey) !== value_(expected)) {
    throw new Error("Invalid operator key.");
  }
}

function parseCmJsonBody_(e) {
  try {
    return JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return {};
  }
}

function cmJsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function summarizePublishResult_(result) {
  const out = {
    ok: !!(result && result.ok),
    mode: result && result.mode ? result.mode : "",
    sport: result && result.sport ? result.sport : "",
    source_key: result && result.source_key ? result.source_key : "",
    current_key: result && result.current_key ? result.current_key : ""
  };

  if (result && result.data) {
    out.data = {
      ok: !!result.data.ok,
      mode: result.data.mode || "",
      product_count: result.data.product_count || 0,
      files_published: result.data.files_published || 0
    };
  }

  if (result && result.index) {
    out.index = {
      ok: !!result.index.ok,
      product_count: result.index.product_count || 0,
      path: result.index.path || ""
    };
  }

  if (result && result.products) {
    out.products = {
      ok: !!result.products.ok,
      product_count: result.products.product_count || 0,
      files_published: result.products.files_published || 0
    };
  }

  if (result && result.search) {
    out.search = {
      ok: !!result.search.ok,
      row_count: result.search.row_count || 0,
      files_published: result.search.files_published || 0
    };
  }

  return out;
}

function validatePublishedChecklistProduct_(sport, code) {
  const githubValidation = validateGitHubChecklistProduct_(sport, code);
  const publicValidation = validatePublicChecklistProductWithRetries_(sport, code);

  return {
    ok: githubValidation.ok && publicValidation.ok,
    github: githubValidation,
    public: publicValidation,
    checklist_vault: {
      ok: publicValidation.index_has_product && publicValidation.product_has_rows && !!publicValidation.search_row_count,
      reason: "Checklist Vault uses the public checklist index, product bundle JSON, and search index."
    },
    chatbot: {
      ok: publicValidation.index_has_product && publicValidation.product_has_rows && !!publicValidation.search_row_count,
      reason: "ChatBot uses the same public checklist index, product bundle JSON, and search index."
    }
  };
}

function validatePublishedChecklistProductLite_(sport, code) {
  const githubValidation = validateGitHubChecklistProductLite_(sport, code);
  let publicValidation;
  try {
    publicValidation = validatePublicChecklistProductLite_(sport, code);
  } catch (err) {
    publicValidation = { ok: false, error: String(err && err.message || err) };
  }

  return {
    ok: githubValidation.ok && publicValidation.ok,
    github: githubValidation,
    public: publicValidation,
    checklist_vault: {
      ok: publicValidation.index_has_product && publicValidation.product_has_rows && !!publicValidation.search_row_count,
      reason: "Checklist Vault uses the public checklist index, product bundle JSON, and search index."
    },
    chatbot: {
      ok: publicValidation.index_has_product && publicValidation.product_has_rows && !!publicValidation.search_row_count,
      reason: "ChatBot uses the same public checklist index, product bundle JSON, and search index."
    }
  };
}

function validateGitHubChecklistProductLite_(sport, code) {
  const indexPayload = fetchGitHubJsonFile_("data/v1/checklists/index.json") || {};
  const indexRows = indexPayload.index || indexPayload.rows || [];
  const indexHit = indexRows.some(row => value_(row.Code || row.code) === code);
  const product = fetchGitHubChecklistProduct_(sport, code);
  const searchRowCount = countGitHubChecklistSearchRows_(sport, code);

  return {
    ok: !!(indexHit && product && Array.isArray(product.rows) && product.rows.length && searchRowCount),
    index_has_product: indexHit,
    product_has_rows: !!(product && Array.isArray(product.rows) && product.rows.length),
    row_count: product && Array.isArray(product.rows) ? product.rows.length : 0,
    parallel_count: product && Array.isArray(product.parallels) ? product.parallels.length : 0,
    search_row_count: searchRowCount,
    validation_mode: "product_bundle_and_search"
  };
}

function validatePublicChecklistProductLite_(sport, code) {
  const indexPayload = fetchPublicJson_("checklists/index.json") || {};
  const indexRows = indexPayload.index || indexPayload.rows || [];
  const indexHit = indexRows.some(row => value_(row.Code || row.code) === code);
  const product = fetchPublicChecklistProduct_(sport, code);
  const searchRowCount = countPublicChecklistSearchRows_(sport, code, true);

  return {
    ok: !!(indexHit && product && Array.isArray(product.rows) && product.rows.length && searchRowCount),
    index_has_product: indexHit,
    product_has_rows: !!(product && Array.isArray(product.rows) && product.rows.length),
    row_count: product && Array.isArray(product.rows) ? product.rows.length : 0,
    parallel_count: product && Array.isArray(product.parallels) ? product.parallels.length : 0,
    search_row_count: searchRowCount,
    validation_mode: "product_bundle_and_search"
  };
}

function validateGitHubChecklistProduct_(sport, code) {
  const indexPayload = fetchGitHubJsonFile_("data/v1/checklists/index.json") || {};
  const indexRows = indexPayload.index || indexPayload.rows || [];
  const indexHit = indexRows.some(row => value_(row.Code || row.code) === code);
  const products = fetchExistingChecklistProductMapForSport_(sport);
  const product = products[code] || null;
  const searchRows = fetchExistingChecklistSearchRowsForSport_(sport);
  const searchRowCount = searchRows.filter(row => value_(row.code || row.Code) === code).length;

  return {
    ok: !!(indexHit && product && Array.isArray(product.rows) && product.rows.length && searchRowCount),
    index_has_product: indexHit,
    product_has_rows: !!(product && Array.isArray(product.rows) && product.rows.length),
    row_count: product && Array.isArray(product.rows) ? product.rows.length : 0,
    parallel_count: product && Array.isArray(product.parallels) ? product.parallels.length : 0,
    search_row_count: searchRowCount
  };
}

function validatePublicChecklistProductWithRetries_(sport, code) {
  let last = null;

  for (let attempt = 1; attempt <= CM_PUBLIC_VALIDATION_RETRIES; attempt++) {
    last = validatePublicChecklistProduct_(sport, code);
    last.attempt = attempt;
    if (last.ok) return last;
    Utilities.sleep(CM_PUBLIC_VALIDATION_PAUSE_MS);
  }

  return last || {
    ok: false,
    index_has_product: false,
    product_has_rows: false,
    row_count: 0,
    parallel_count: 0,
    search_row_count: 0,
    attempt: 0
  };
}

function validatePublicChecklistProduct_(sport, code) {
  const indexPayload = fetchPublicJson_("checklists/index.json") || {};
  const indexRows = indexPayload.index || indexPayload.rows || [];
  const indexHit = indexRows.some(row => value_(row.Code || row.code) === code);
  const product = fetchPublicChecklistProduct_(sport, code);
  const searchRowCount = countPublicChecklistSearchRows_(sport, code);

  return {
    ok: !!(indexHit && product && Array.isArray(product.rows) && product.rows.length && searchRowCount),
    index_has_product: indexHit,
    product_has_rows: !!(product && Array.isArray(product.rows) && product.rows.length),
    row_count: product && Array.isArray(product.rows) ? product.rows.length : 0,
    parallel_count: product && Array.isArray(product.parallels) ? product.parallels.length : 0,
    search_row_count: searchRowCount
  };
}

function fetchPublicChecklistProduct_(sport, code) {
  const manifest = fetchPublicJson_("checklists/products/" + sport + ".json");
  if (!manifest) return null;
  if (manifest.products && manifest.products[code]) return manifest.products[code];

  if (manifest.product_map && manifest.product_map[code]) {
    const shard = fetchPublicJson_("checklists/products/" + manifest.product_map[code]) || {};
    return shard.products && shard.products[code] || null;
  }
  if (manifest.product_map) return null;

  const shards = Array.isArray(manifest.shards) ? manifest.shards : [];
  for (let i = 0; i < shards.length; i++) {
    const shard = fetchPublicJson_("checklists/products/" + shards[i]) || {};
    if (shard.products && shard.products[code]) return shard.products[code];
  }

  return null;
}

function countPublicChecklistSearchRows_(sport, code, productScoped) {
  const manifest = fetchPublicJson_("checklists/search-index/" + sport + ".json");
  if (!manifest) return 0;

  if (Array.isArray(manifest.rows)) {
    return manifest.rows.filter(row => value_(row.code || row.Code) === code).length;
  }

  // Public Pages can still serve the previous manifest. Report pending instead
  // of scanning every legacy shard and exhausting the publishing time budget.
  const shards = manifest.product_shards && manifest.product_shards[code]
    || (productScoped ? [] : Array.isArray(manifest.shards) ? manifest.shards : []);
  return shards.reduce((count, fileName) => {
    const shard = fetchPublicJson_("checklists/search-index/" + fileName) || {};
    const rows = Array.isArray(shard.rows) ? shard.rows : [];
    return count + rows.filter(row => value_(row.code || row.Code) === code).length;
  }, 0);
}

function countGitHubChecklistSearchRows_(sport, code) {
  const dir = "data/v1/checklists/search-index/";
  const manifest = fetchGitHubJsonFile_(dir + sport + ".json") || {};
  if (Array.isArray(manifest.rows)) {
    return manifest.rows.filter(row => value_(row.code || row.Code) === code).length;
  }
  const names = manifest.product_shards && manifest.product_shards[code];
  if (!Array.isArray(names)) {
    return fetchExistingChecklistSearchRowsForSport_(sport).filter(row => value_(row.code || row.Code) === code).length;
  }
  return names.reduce((count, name) => {
    const shard = fetchGitHubJsonFile_(dir + name) || {};
    return count + (shard.rows || []).filter(row => value_(row.code || row.Code) === code).length;
  }, 0);
}

function fetchGitHubChecklistProduct_(sport, code) {
  const dir = "data/v1/checklists/products/";
  const manifest = fetchGitHubJsonFile_(dir + sport + ".json") || {};
  if (manifest.products) return manifest.products[code] || null;
  const name = manifest.product_map && manifest.product_map[code];
  if (name) {
    const shard = fetchGitHubJsonFile_(dir + name) || {};
    return shard.products && shard.products[code] || null;
  }
  if (manifest.product_map) return null;
  return fetchExistingChecklistProductMapForSport_(sport)[code] || null;
}

function fetchPublicJson_(path) {
  const cleanPath = value_(path).replace(/^\/+/, "");
  const url = CM_PUBLIC_DATA_BASE + "/" + cleanPath + "?cb=" + encodeURIComponent(String(Date.now()));
  const res = UrlFetchApp.fetch(url, {
    method: "get",
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  if (code === 404) return null;
  if (code < 200 || code >= 300) {
    throw new Error("Public JSON fetch failed with " + code + " for " + cleanPath + ": " + res.getContentText());
  }

  const text = res.getContentText();
  return text ? JSON.parse(text) : null;
}

function getGitHubConfigBase_() {
  const props = PropertiesService.getScriptProperties();
  const token = value_(props.getProperty("GITHUB_TOKEN"));
  const owner = value_(props.getProperty("GITHUB_OWNER")) || "ChasingMajors";
  const repo = value_(props.getProperty("GITHUB_REPO")) || "chasing-majors-app";
  const branch = value_(props.getProperty("GITHUB_BRANCH")) || "main";

  if (!token) throw new Error("Missing Script Property: GITHUB_TOKEN");
  if (!owner) throw new Error("Missing Script Property: GITHUB_OWNER");
  if (!repo) throw new Error("Missing Script Property: GITHUB_REPO");
  if (!branch) throw new Error("Missing Script Property: GITHUB_BRANCH");

  return { token: token, owner: owner, repo: repo, branch: branch };
}

function githubRequest_(method, path, payload, muteHttpExceptions) {
  const cfg = getGitHubConfig_();
  const url = "https://api.github.com" + path;
  const options = {
    method: method,
    muteHttpExceptions: muteHttpExceptions !== false,
    headers: {
      Authorization: "Bearer " + cfg.token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    }
  };

  if (payload !== undefined && payload !== null) {
    options.contentType = "application/json";
    options.payload = JSON.stringify(payload);
  }

  let lastErr = null;

  for (let attempt = 1; attempt <= CM_GITHUB_API_RETRIES; attempt++) {
    try {
      const res = UrlFetchApp.fetch(url, options);
      const code = res.getResponseCode();
      const text = res.getContentText();
      let json = {};
      try { json = text ? JSON.parse(text) : {}; } catch (e) { json = { raw: text }; }

      if (code >= 200 && code < 300) return json;

      const transient = code === 429 || code === 500 || code === 502 || code === 503 || code === 504;
      const err = new Error("GitHub API " + method + " " + path + " failed with " + code + ": " + text);

      if (!transient) {
        err.nonRetryable = true;
        throw err;
      }
      if (attempt === CM_GITHUB_API_RETRIES) throw err;

      lastErr = err;
      const waitMs = CM_GITHUB_API_RETRY_PAUSE_MS * attempt;
      Logger.log("GitHub retry " + attempt + "/" + CM_GITHUB_API_RETRIES + " for " + method + " " + path + ": " + err.message);
      Utilities.sleep(waitMs);
    } catch (err) {
      lastErr = err;
      if (err && err.nonRetryable) throw err;
      if (attempt === CM_GITHUB_API_RETRIES) break;

      const waitMs = CM_GITHUB_API_RETRY_PAUSE_MS * attempt;
      Logger.log("GitHub retry " + attempt + "/" + CM_GITHUB_API_RETRIES + " for " + method + " " + path + ": " + err);
      Utilities.sleep(waitMs);
    }
  }

  throw lastErr;
}

function getGitHubFileSha_(repoPath) {
  const cfg = getGitHubConfig_();
  const path = "/repos/" + encodeURIComponent(cfg.owner)
    + "/" + encodeURIComponent(cfg.repo)
    + "/contents/" + encodeGitHubPath_(repoPath)
    + "?ref=" + encodeURIComponent(cfg.branch);

  try {
    const data = githubRequest_("get", path, null, true);
    return data && data.sha ? data.sha : "";
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    if (msg.indexOf(" 404:") !== -1 || msg.indexOf("Not Found") !== -1) return "";
    throw err;
  }
}

function fetchGitHubJsonFileBase_(repoPath) {
  const cfg = getGitHubConfig_();
  // Read current branch contents through the API, avoiding stale raw CDN data.
  const url = "https://api.github.com/repos/"
    + encodeURIComponent(cfg.owner)
    + "/" + encodeURIComponent(cfg.repo)
    + "/contents/" + encodeGitHubPath_(repoPath)
    + "?ref=" + encodeURIComponent(cfg.branch);

  const res = UrlFetchApp.fetch(url, {
    method: "get",
    muteHttpExceptions: true,
    headers: {
      Authorization: "Bearer " + cfg.token,
      Accept: "application/vnd.github.raw+json"
    }
  });

  const code = res.getResponseCode();
  if (code === 404) return null;
  if (code < 200 || code >= 300) {
    throw new Error("GitHub content fetch failed with " + code + " for " + repoPath + ": " + res.getContentText());
  }

  const text = res.getContentText();
  return text ? JSON.parse(text) : null;
}

function putGitHubJsonFileBase_(repoPath, obj, message) {
  const cfg = getGitHubConfig_();
  const prettyJson = JSON.stringify(obj, null, 2) + "\n";
  const path = "/repos/" + encodeURIComponent(cfg.owner)
    + "/" + encodeURIComponent(cfg.repo)
    + "/contents/" + encodeGitHubPath_(repoPath);

  let lastErr = null;

  for (let attempt = 1; attempt <= CM_GITHUB_API_RETRIES; attempt++) {
    try {
      const sha = getGitHubFileSha_(repoPath);
      const payload = {
        message: message || ("Update " + repoPath),
        content: Utilities.base64Encode(prettyJson, Utilities.Charset.UTF_8),
        branch: cfg.branch
      };

      if (sha) payload.sha = sha;

      const data = githubRequest_("put", path, payload, true);

      return {
        path: repoPath,
        sha: data && data.content && data.content.sha ? data.content.sha : "",
        commit: data && data.commit && data.commit.sha ? data.commit.sha : ""
      };
    } catch (err) {
      lastErr = err;
      const msg = String(err && err.message ? err.message : err);
      const isShaConflict = msg.indexOf(" failed with 409:") !== -1 || msg.indexOf('"status":"409"') !== -1;

      if (!isShaConflict || attempt === CM_GITHUB_API_RETRIES) throw err;

      const waitMs = CM_GITHUB_API_RETRY_PAUSE_MS * attempt;
      Logger.log("GitHub SHA conflict retry " + attempt + "/" + CM_GITHUB_API_RETRIES + " for " + repoPath + ": " + msg);
      Utilities.sleep(waitMs);
    }
  }

  throw lastErr;
}

function putGitHubShardedRows_(repoDir, baseName, rows, basePayload, message) {
  const shards = buildRowShards_(rows, basePayload);
  const published = [];
  const files = [];

  shards.forEach((shardRows, idx) => {
    const fileName = baseName + "-" + padShard_(idx + 1) + ".json";
    files.push(fileName);
    published.push(putGitHubJsonFile_(
      repoDir + "/" + fileName,
      Object.assign({}, basePayload, {
        shard: idx + 1,
        shard_count: shards.length,
        rows: shardRows
      }),
      message + " shard " + (idx + 1)
    ));
  });

  published.push(putGitHubJsonFile_(
    repoDir + "/" + baseName + ".json",
    Object.assign({}, basePayload, {
      sharded: true,
      shards: files
    }),
    message + " manifest"
  ));

  return published;
}

function putGitHubShardedObjectMap_(repoDir, baseName, objectMap, basePayload, message) {
  const shards = buildObjectMapShards_(objectMap, basePayload);
  const published = [];
  const files = [];
  const productMap = {};

  shards.forEach((products, idx) => {
    const fileName = baseName + "-" + padShard_(idx + 1) + ".json";
    files.push(fileName);

    Object.keys(products || {}).forEach(code => {
      productMap[code] = fileName;
    });

    published.push(putGitHubJsonFile_(
      repoDir + "/" + fileName,
      Object.assign({}, basePayload, {
        shard: idx + 1,
        shard_count: shards.length,
        products: products
      }),
      message + " shard " + (idx + 1)
    ));
  });

  published.push(putGitHubJsonFile_(
    repoDir + "/" + baseName + ".json",
    Object.assign({}, basePayload, {
      sharded: true,
      shards: files,
      product_map: productMap
    }),
    message + " manifest"
  ));

  return published;
}

function buildRowShards_(rows, basePayload) {
  const shards = [];
  let current = [];
  let currentSize = JSON.stringify(Object.assign({}, basePayload, { rows: [] })).length;

  (rows || []).forEach(row => {
    const rowSize = JSON.stringify(row).length + 1;
    if (current.length && currentSize + rowSize > CM_MAX_JSON_SHARD_CHARS) {
      shards.push(current);
      current = [];
      currentSize = JSON.stringify(Object.assign({}, basePayload, { rows: [] })).length;
    }

    current.push(row);
    currentSize += rowSize;
  });

  if (current.length || !shards.length) shards.push(current);
  return shards;
}

function buildObjectMapShards_(objectMap, basePayload) {
  const shards = [];
  let current = {};
  let currentSize = JSON.stringify(Object.assign({}, basePayload, { products: {} })).length;

  Object.keys(objectMap || {}).forEach(key => {
    const entrySize = JSON.stringify(key).length + JSON.stringify(objectMap[key]).length + 4;
    if (Object.keys(current).length && currentSize + entrySize > CM_MAX_JSON_SHARD_CHARS) {
      shards.push(current);
      current = {};
      currentSize = JSON.stringify(Object.assign({}, basePayload, { products: {} })).length;
    }

    current[key] = objectMap[key];
    currentSize += entrySize;
  });

  if (Object.keys(current).length || !shards.length) shards.push(current);
  return shards;
}

function encodeGitHubPath_(repoPath) {
  return String(repoPath || "")
    .split("/")
    .map(part => encodeURIComponent(part))
    .join("/");
}

function prepareUpcomingChecklistSheets() {
  const definitions = [
    ["baseball", "2027", "Baseball 2027"],
    ["football", "2027", "Football 2027"],
    ["basketball", "2026-27", "Basketball 2026-27"],
    ["basketball", "2027", "WNBA 2027"],
    ["hockey", "2026-27", "Hockey 2026-27"],
    ["soccer", "2026-27", "Soccer 2026-27"]
  ];
  const properties = PropertiesService.getScriptProperties();
  const result = [];
  definitions.forEach(function(definition) {
    const sport = definition[0], season = definition[1];
    const property = "CM_CHECKLIST_SEASON_" + sport + "_" + season;
    let id = properties.getProperty(property);
    const source = SpreadsheetApp.openById(CM_CHECKLIST_DB_MAP[sport].current);
    const target = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.create("CM Checklist DB - " + definition[2]);
    if (!id) {
      id = target.getId();
      properties.setProperty(property, id);
      target.getSheets()[0].setName("Products");
    }
    ["Products", "ChecklistRows", "Parallels"].forEach(function(name) {
      const template = source.getSheetByName(name);
      if (!template) throw new Error("Template tab missing: " + sport + " " + name);
      const headers = template.getRange(1, 1, 1, template.getLastColumn()).getValues();
      const sheet = target.getSheetByName(name) || target.insertSheet(name);
      if (sheet.getLastRow() === 0) {
        sheet.getRange(1, 1, 1, headers[0].length).setValues(headers).setFontWeight("bold");
        sheet.setFrozenRows(1);
      }
      const actual = sheet.getRange(1, 1, 1, headers[0].length).getValues();
      if (JSON.stringify(actual) !== JSON.stringify(headers)) throw new Error("Season header mismatch: " + name);
    });
    result.push({ sport: sport, season: season, id: id, url: target.getUrl() });
  });
  result.forEach(function(row) { Logger.log(JSON.stringify(row)); });
  return result;
}

// Explicit transition-season sources; historical and current aliases stay intact.
const CM_UPCOMING_CHECKLIST_SOURCES = {
  "baseball": {
    "2027": "1S5hGR027EOL2oVztNrTpsBkextVs8JYk_pQcpMbgQTI"
  },
  "football": {
    "2027": "1xXN0W3bV84QZ79rwo5a8FuUwgA8mmVjzdX_YO3ujIkU"
  },
  "basketball": {
    "2026-27": "1oWXGj7UR8labT48x2jIHpDjApbySSAnsHu2V-3PgZX4",
    "2027": "1NzwBCfYp7UphIl5GgmHqHGgtX9NYIcuQrfk7933VQuA"
  },
  "hockey": {
    "2026-27": "1adQbzgv77VdkE_md_XbIUnlCaQFzas2i58p789Cz_80"
  },
  "soccer": {
    "2026-27": "1MMfGfJiEx33ijaS7X3fxxWnpXCEU8KzRSnr1Fcro92M"
  }
};
Object.keys(CM_UPCOMING_CHECKLIST_SOURCES).forEach(function(sport) {
  Object.assign(CM_CHECKLIST_DB_MAP[sport], CM_UPCOMING_CHECKLIST_SOURCES[sport]);
});

/* Pipeline v2: one commit per release, exact verification, durable jobs. */
let CM_GITHUB_TRANSACTION = null;
let CM_CURRENT_PUBLISH_JOB = null;

function stablePipelineJson_(value) {
  if (Array.isArray(value)) return "[" + value.map(stablePipelineJson_).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => JSON.stringify(k) + ":" + stablePipelineJson_(value[k])).join(",") + "}";
  return JSON.stringify(value);
}

function pipelineHash_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, stablePipelineJson_(value), Utilities.Charset.UTF_8)
    .map(n => (n & 255).toString(16).padStart(2, "0")).join("");
}

function productContentHash_(product) {
  const meta = Object.assign({}, product && product.meta || {});
  ["release_id", "content_sha256", "expected_rows", "expected_parallels"].forEach(k => delete meta[k]);
  const data = {meta:meta, rows:product && product.rows || []};
  if (product && Array.isArray(product.parallels)) data.parallels = product.parallels;
  return pipelineHash_(data);
}

function assertSourceImportComplete_(ss, code) {
  const sheet = ss.getSheetByName("CMImportStatus");
  if (!sheet) return;
  const status = sheet.getDataRange().getValues().slice(1).find(row => value_(row[0]) === code);
  if (status && status[1] === "writing") throw new Error("Source import is incomplete for " + code + ". Resume the import before publishing.");
}

function buildChecklistStaticDataForSingleProduct_(sport, bucket, code) {
  const sourceKey = resolveChecklistSourceKey_(sport, bucket === "current" ? CM_ACTIVE_CURRENT_KEYS[sport] : bucket);
  const map = CM_CHECKLIST_DB_MAP[sport] || {};
  assertSourceImportComplete_(SpreadsheetApp.openById(map[sourceKey] || map.current), code);
  const single = buildChecklistStaticDataForSingleProductBase_(sport, bucket, code);
  if (!single.productPayload.rows.length) throw new Error("Refusing to publish a checklist without rows.");
  const release = CM_CURRENT_PUBLISH_JOB ? CM_CURRENT_PUBLISH_JOB.data.id : Utilities.getUuid();
  single.productPayload.meta.content_sha256 = productContentHash_(single.productPayload);
  single.productPayload.meta.release_id = release;
  single.expected = {release_id:release, content_sha256:single.productPayload.meta.content_sha256,
    row_count:single.productPayload.rows.length, parallel_count:single.productPayload.parallels.length,
    search_row_count:single.searchRows.length, search_sha256:pipelineHash_(single.searchRows), index_sha256:pipelineHash_(single.indexRow)};
  if (CM_GITHUB_TRANSACTION) CM_GITHUB_TRANSACTION.expected = single.expected;
  return single;
}

function getGitHubConfig_() {
  const cfg = getGitHubConfigBase_();
  if (CM_GITHUB_TRANSACTION) cfg.branch = CM_GITHUB_TRANSACTION.base_commit;
  return cfg;
}

function fetchGitHubJsonFile_(path) {
  if (CM_GITHUB_TRANSACTION && Object.prototype.hasOwnProperty.call(CM_GITHUB_TRANSACTION.files, path)) {
    return JSON.parse(CM_GITHUB_TRANSACTION.files[path]);
  }
  return fetchGitHubJsonFileBase_(path);
}

function putGitHubJsonFile_(path, data, message) {
  if (!CM_GITHUB_TRANSACTION) return putGitHubJsonFileBase_(path, data, message);
  const text = JSON.stringify(data, null, 2) + "\n";
  CM_GITHUB_TRANSACTION.files[path] = text;
  return {path:path, staged:true};
}

function githubRepoPath_() {
  const cfg = getGitHubConfigBase_();
  return "/repos/" + encodeURIComponent(cfg.owner) + "/" + encodeURIComponent(cfg.repo);
}

function runAtomicGitHubPublish_(operation, message) {
  if (CM_GITHUB_TRANSACTION) throw new Error("Nested GitHub release staging is not supported.");
  const cfg = getGitHubConfigBase_();
  const repo = githubRepoPath_();
  const refPath = repo + "/git/ref/heads/" + encodeGitHubPath_(cfg.branch);
  const base = githubRequest_("get", refPath);
  const commit = githubRequest_("get", repo + "/git/commits/" + base.object.sha);
  const tx = {base_commit:base.object.sha, files:{}, expected:null};
  CM_GITHUB_TRANSACTION = tx;
  let result;
  try { result = operation(); }
  finally { CM_GITHUB_TRANSACTION = null; }
  const paths = Object.keys(tx.files);
  if (!paths.length) throw new Error("No files were staged for this release.");
  const treeEntries = paths.map(path => ({path:path, mode:"100644", type:"blob", content:tx.files[path]}));
  if (Utilities.newBlob(JSON.stringify(treeEntries)).getBytes().length > 40000000) throw new Error("Staged release exceeds the safe request size. Split the source update before retrying.");
  // Do not overwrite a branch advanced by a different publisher.
  if (githubRequest_("get", refPath).object.sha !== tx.base_commit) throw new Error("Publish conflict: GitHub changed during staging. No files were published; retry from the latest revision.");
  if (CM_CURRENT_PUBLISH_JOB) {
    CM_CURRENT_PUBLISH_JOB.data.expected = tx.expected;
    CM_CURRENT_PUBLISH_JOB.data.stage = "committing";
    savePipelineJob_(CM_CURRENT_PUBLISH_JOB);
  }
  const tree = githubRequest_("post", repo + "/git/trees", {base_tree:commit.tree.sha, tree:treeEntries});
  const next = githubRequest_("post", repo + "/git/commits", {message:message, tree:tree.sha, parents:[tx.base_commit]});
  // Save the candidate before moving the ref, so a lost HTTP response is recoverable.
  if (CM_CURRENT_PUBLISH_JOB) {
    CM_CURRENT_PUBLISH_JOB.data.commit = next.sha;
    savePipelineJob_(CM_CURRENT_PUBLISH_JOB);
  }
  githubRequest_("patch", repo + "/git/refs/heads/" + encodeGitHubPath_(cfg.branch), {sha:next.sha, force:false});
  if (CM_CURRENT_PUBLISH_JOB) {
    CM_CURRENT_PUBLISH_JOB.data.stage = "committed";
    savePipelineJob_(CM_CURRENT_PUBLISH_JOB);
  }
  return Object.assign({}, result, {ok:true, commit:next.sha, expected:tx.expected, files_published:paths.length,
    files:paths.map(path => ({path:path,commit:next.sha}))});
}

function checklistSearchRowsForVerification_(sport, code, read) {
  const dir = "checklists/search-index/";
  const manifest = read(dir + sport + ".json") || {};
  if (Array.isArray(manifest.rows)) return manifest.rows.filter(row => value_(row.code || row.Code) === code);
  const names = manifest.product_shards && manifest.product_shards[code] || [];
  return names.reduce((rows, name) => rows.concat((read(dir + name) || {}).rows || []), [])
    .filter(row => value_(row.code || row.Code) === code);
}

function verifyChecklistRelease_(sport, code, expected, isPublic) {
  const read = path => isPublic ? fetchPublicJson_(path) : fetchGitHubJsonFile_("data/v1/" + path);
  try {
    const index = (read("checklists/index.json") || {}).index || [];
    const row = index.find(item => value_(item.Code || item.code) === code);
    const manifest = read("checklists/products/" + sport + ".json") || {};
    const shardName = manifest.product_map && manifest.product_map[code];
    const products = manifest.products || shardName && (read("checklists/products/" + shardName) || {}).products || {};
    const product = products[code];
    const search = checklistSearchRowsForVerification_(sport, code, read);
    const actualHash = product ? productContentHash_(product) : "";
    const result = {ok:false, index_has_product:!!row, product_has_rows:!!(product && product.rows && product.rows.length),
      row_count:product && product.rows && product.rows.length || 0, parallel_count:product && product.parallels && product.parallels.length || 0,
      search_row_count:search.length, release_id:product && product.meta && product.meta.release_id || "",
      content_sha256:actualHash, validation_mode:"exact_content_and_release"};
    result.ok = !!(expected && row && product && result.release_id === expected.release_id && actualHash === expected.content_sha256 &&
      result.row_count === expected.row_count && result.parallel_count === expected.parallel_count && search.length === expected.search_row_count &&
      pipelineHash_(search) === expected.search_sha256 && pipelineHash_(row) === expected.index_sha256);
    return result;
  } catch (err) { return {ok:false,error:String(err && err.message || err),validation_mode:"exact_content_and_release"}; }
}

function verifyChecklistReleaseBoth_(sport, code, expected) {
  const github = verifyChecklistRelease_(sport, code, expected, false);
  const publicResult = verifyChecklistRelease_(sport, code, expected, true);
  return {ok:github.ok && publicResult.ok, github:github, public:publicResult,
    checklist_vault:{ok:publicResult.ok,reason:"Exact public product, index and search content verification."},
    chatbot:{ok:publicResult.ok,reason:"Exact public product, index and search content verification; visual test remains separate."}};
}

function publishChecklistAfterImportLocked_(input) {
  const sport = normalizeKey_(input && input.sport), bucket = value_(input && input.bucket), code = value_(input && input.code);
  if (!sport || !bucket || !code || !CM_CHECKLIST_DB_MAP[sport]) throw new Error("Missing or unsupported checklist publish target.");
  const result = runAtomicGitHubPublish_(() => publishChecklistProductAfterImportToGitHub_(sport, bucket, code), "Publish complete checklist release " + code);
  const validation = verifyChecklistReleaseBoth_(sport, code, result.expected);
  return {ok:validation.github.ok, status:validation.public.ok ? "published_and_public_validated" : validation.github.ok ? "published_pages_pending" : "published_validation_needs_review",
    mode:"atomic_product_release",sport:sport,bucket:bucket,code:code,publish_result:result,validation:validation,updated_at:new Date().toISOString()};
}

function publishChecklistAfterImport_(input) {
  requireCmOperatorKey_(input && input.key);
  if (input.job_id) return getPipelineJobStatus_(input.job_id);
  if (String(input.async) === "1") return enqueuePipelineJob_("checklist", input);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return {ok:false,status:"publish_busy",error:"Another release is running."};
  try { return publishChecklistAfterImportLocked_(input); } finally { lock.releaseLock(); }
}

function buildPrvProductRelease_(code) {
  const ss = getVaultSpreadsheet_();
  assertSourceImportComplete_(ss, code);
  const sourceTables = prvSourceTables_(ss);
  const meta = sourceTables.index.find(row => value_(row.code) === code);
  if (!meta) throw new Error("PRV source product not found: " + code);
  const index = {Code:code, DisplayName:value_(meta.displayname || meta.display_name), Keywords:value_(meta.keywords),year:value_(meta.year),
    sport:value_(meta.sport),manufacturer:value_(meta.manufacturer),product:value_(meta.product),cmURL:value_(meta.cmurl || meta.cm_url)};
  const rows = sourceTables.products.filter(row => !row.prv_identity_hold && value_(row.code) === code).map(row => ({code:code,
    setType:value_(row.settype || row.set_type),setLine:value_(row.setline || row.set_line),...(value_(row.parallel) ? {parallel:value_(row.parallel)} : {}),printRun:numberOrString_(row.printrun || row.print_run),
    ...(row.prv_identity_review && row.prv_identity_review.review_id==="step7-122-2026-10-26" && value_(row.packodds) ? {odds:value_(row.packodds)} : {}),
    serial:value_(row.serial),subSetSize:numberOrString_(row.subsetsize || row.sub_set_size),notes:prvExportNotes_(row),cmURL:value_(row.cmurl || row.cm_url)}));
  if (!rows.length) throw new Error("Refusing to publish PRV without rows.");
  const product = {ok:true,meta:{code:code,displayName:index.DisplayName,year:index.year,sport:index.sport,manufacturer:index.manufacturer,product:index.product,cmURL:index.cmURL},rows:rows};
  product.meta.content_sha256 = productContentHash_(product);
  product.meta.release_id = CM_CURRENT_PUBLISH_JOB ? CM_CURRENT_PUBLISH_JOB.data.id : Utilities.getUuid();
  const expected = {release_id:product.meta.release_id,content_sha256:product.meta.content_sha256,row_count:rows.length,index_sha256:pipelineHash_(index)};
  return {index:index,product:product,expected:expected};
}

function publishPrvProductAtomic_(code) {
  const result = runAtomicGitHubPublish_(() => {
    const built = buildPrvProductRelease_(code), now = new Date().toISOString();
    CM_GITHUB_TRANSACTION.expected = built.expected;
    const dir = "data/v1/vault/", manifest = fetchGitHubJsonFile_(dir + "products/all.json") || {};
    const map = Object.assign({}, manifest.product_map || {});
    const name = "product-" + safeSourceKeyForFile_(code) + "-" + safeSourceKeyForFile_(built.expected.release_id) + ".json";
    const previous = map[code];
    if (previous && Object.keys(map).some(key => key !== code && map[key] === previous)) {
      const old = fetchGitHubJsonFile_(dir + "products/" + previous) || {};
      const retained = Object.assign({}, old.products || {});
      delete retained[code];
      putGitHubJsonFile_(dir + "products/" + previous, Object.assign({}, old, {products:retained,generated_at:now}), "Remove migrated PRV product from shared shard");
    }
    // Only replace this product. Old grouped shards remain available to other codes.
    map[code] = name;
    const shards = Array.from(new Set(Object.keys(map).map(key => map[key])));
    putGitHubJsonFile_(dir + "products/" + name, {ok:true,products:{[code]:built.product},generated_at:now}, "Update PRV product");
    putGitHubJsonFile_(dir + "products/all.json", Object.assign({},manifest,{ok:true,sharded:true,shards:shards,product_map:map,generated_at:now}), "Update PRV product lookup");
    const index = fetchGitHubJsonFile_(dir + "index.json") || {};
    putGitHubJsonFile_(dir + "index.json", Object.assign({},index,{ok:true,index:(index.index || []).filter(row => value_(row.Code || row.code) !== code).concat([built.index]),generated_at:now}), "Update PRV index");
    const root = fetchGitHubJsonFile_("data/v1/manifest.json") || {};
    putGitHubJsonFile_("data/v1/manifest.json", Object.assign({},root,{vault_version:now,version:now,generated_at:now,schema:CM_EXPORT_VERSION}), "Update PRV version");
    return {ok:true,code:code,mode:"atomic_prv_product_release",row_count:built.product.rows.length};
  }, "Publish complete PRV release " + code);
  const validation = verifyPrvReleaseBoth_(code, result.expected);
  return {ok:validation.github.ok,status:validation.public.ok ? "published_and_public_validated" : validation.github.ok ? "published_pages_pending" : "published_validation_needs_review",code:code,publish:result,validation:validation};
}

function verifyPrvReleaseBoth_(code, expected) {
  function check(isPublic) {
    const read = path => isPublic ? fetchPublicJson_(path) : fetchGitHubJsonFile_("data/v1/" + path);
    try {
      const manifest = read("vault/products/all.json") || {}, name = manifest.product_map && manifest.product_map[code];
      const product = name && ((read("vault/products/" + name) || {}).products || {})[code];
      const row = ((read("vault/index.json") || {}).index || []).find(row => value_(row.Code || row.code) === code);
      return {ok:!!(product && expected && row && product.meta.release_id === expected.release_id && productContentHash_(product) === expected.content_sha256 && product.rows.length === expected.row_count && pipelineHash_(row) === expected.index_sha256),
        row_count:product && product.rows.length || 0,release_id:product && product.meta.release_id || "",validation_mode:"exact_content_and_release"};
    } catch (err) { return {ok:false,error:String(err && err.message || err)}; }
  }
  return {github:check(false),public:check(true)};
}

function publishVaultStaticDataToGitHub_(input) {
  requireCmOperatorKey_(input && input.key);
  if (input.job_id) return getPipelineJobStatus_(input.job_id);
  if (String(input.async) === "1") return enqueuePipelineJob_("prv", input);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return {ok:false,status:"publish_busy",error:"Another release is running."};
  try {
    if (input.code && !input.fullSync && String(input.full_sync) !== "1" && input.scope !== "full") return publishPrvProductAtomic_(value_(input.code));
    const result = runAtomicGitHubPublish_(() => publishVaultStaticDataToGitHubFullBase_(), "Publish complete Vault release");
    return {ok:true,status:"published_pages_pending",publish:result,validation:{ok:false,reason:"Full Vault committed; public deployment requires verification."}};
  } finally { lock.releaseLock(); }
}

function publishVaultStaticDataToGitHub() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error("Another release is running.");
  try { return runAtomicGitHubPublish_(() => publishVaultStaticDataToGitHubFullBase_(), "Publish complete Vault release"); }
  finally { lock.releaseLock(); }
}

function publishVaultStaticDataToGitHubScheduled() {
  try { return publishVaultStaticDataToGitHub(); }
  catch (err) { return {ok:false,error:String(err && err.message || err)}; }
}

function pipelineJobFolder_() {
  const props = PropertiesService.getScriptProperties(), id = props.getProperty("CM_PUBLISH_JOBS_FOLDER");
  if (id) return DriveApp.getFolderById(id);
  const folder = DriveApp.createFolder("Sentinel Publish Jobs");
  props.setProperty("CM_PUBLISH_JOBS_FOLDER", folder.getId());
  return folder;
}

function readPipelineJob_(id) {
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(value_(id))) throw new Error("Invalid publish job ID.");
  const files = pipelineJobFolder_().getFilesByName(id + ".json");
  if (!files.hasNext()) throw new Error("Publish job not found: " + id);
  const file = files.next();
  return {file:file,data:JSON.parse(file.getBlob().getDataAsString())};
}

function savePipelineJobInitial_(job) {
  job.data.updated_at = new Date().toISOString();
  job.file.setContent(JSON.stringify(job.data));
}

function ensurePipelineWorker_() {
  if (!ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === "runSentinelPublishJobs")) {
    ScriptApp.newTrigger("runSentinelPublishJobs").timeBased().everyMinutes(1).create();
  }
}

function enqueuePipelineJobInitial_(kind, input) {
  const id = value_(input.request_id);
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id)) throw new Error("A stable request_id is required to queue publishing.");
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return {ok:false,status:"publish_busy",error:"Publisher is busy; reuse the same request ID to check again."};
  try {
    let existing = null;
    const folder = pipelineJobFolder_(), files = folder.getFilesByName(id + ".json");
    if (files.hasNext()) { const file = files.next(); existing = {file:file,data:JSON.parse(file.getBlob().getDataAsString())}; }
    if (existing) {
      if (existing.data.kind !== kind || existing.data.code !== value_(input.code) || existing.data.sport !== value_(input.sport) || existing.data.bucket !== value_(input.bucket)) throw new Error("Request ID is already used for a different publish target.");
      return publicPipelineJob_(existing, false);
    }
    ensurePipelineWorker_();
    const data = {id:id,kind:kind,sport:value_(input.sport),bucket:value_(input.bucket),code:value_(input.code),stage:"queued",attempts:0,created_at:new Date().toISOString()};
    if (!data.code || kind === "checklist" && (!data.sport || !data.bucket || !CM_CHECKLIST_DB_MAP[data.sport])) throw new Error("Invalid queued publish target.");
    if (activePipelineJobIds_().length >= 50) throw new Error("The publish queue is full. Resolve existing jobs before adding another.");
    const file = folder.createFile(id + ".json",JSON.stringify(data),MimeType.PLAIN_TEXT);
    const job = {file:file,data:data};
    savePipelineJob_(job);
    return publicPipelineJob_(job, false);
  } finally { lock.releaseLock(); }
}

// Pure decision seam (no side effects, never throws): a published_pages_pending
// job whose age reference is older than thresholdMs must be escalated.
function shouldEscalatePendingJob_(data, nowMs, thresholdMs) {
  if (!data || data.stage !== "published_pages_pending") return false;
  const ref = Date.parse(data.verification_started_at || data.updated_at || data.created_at);
  return Number.isFinite(ref) && (nowMs - ref) >= thresholdMs;
}

// Transition a stale pending job into the explicit, recoverable escalated state
// published_pages_timeout, preserving all receipt evidence, and attempt one alert.
// The GitHub commit succeeded; only public propagation is unconfirmed, so this is
// NOT a hard failure. Called at most once per job (the stage leaves the pending
// selection list, so later ticks do not re-escalate or re-alert).
function escalatePendingPublishJob_(job, nowMs) {
  const data = job.data;
  const ref = Date.parse(data.verification_started_at || data.updated_at || data.created_at);
  const ageMs = Number.isFinite(ref) ? nowMs - ref : null;
  data.stage = "published_pages_timeout";
  data.escalated = true;
  data.escalated_at = new Date(nowMs).toISOString();
  data.error = "The GitHub commit succeeded, but public GitHub Pages propagation could not be confirmed within the escalation threshold. The job is escalated for attention; a manual Resume/Verify can still re-check it and promote it to complete if Pages later propagates.";
  savePipelineJob_(job);
  // The worker must never break if alert delivery fails.
  try { sendExporterStalePublishAlert_(data, ageMs); } catch (err) {}
}

// Minimal webhook sender mirroring the Operator's postSentinelAlertWebhook_.
// Safe-by-default: with no webhook property configured, no network call is made
// and nothing throws. Admin keys are never included in the payload.
function sendExporterStalePublishAlert_(data, ageMs) {
  const url = String(PropertiesService.getScriptProperties().getProperty(CM_SENTINEL_ALERT_WEBHOOK_URL_PROPERTY) || "").trim();
  if (!url) return {ok:true,status:"skipped_no_destination"};
  const payload = {
    app: "CM Sentinel Exporter",
    severity: "needs_review",
    title: "Publish stuck in published_pages_pending",
    job_id: data.id,
    code: data.code || "",
    kind: data.kind || "",
    state: "published_pages_timeout",
    age_ms: Number.isFinite(ageMs) ? ageMs : null,
    commit: data.commit || "",
    timestamp: data.escalated_at || new Date().toISOString()
  };
  try {
    const res = UrlFetchApp.fetch(url, {method:"post",contentType:"application/json",muteHttpExceptions:true,payload:JSON.stringify(payload)});
    const status = res.getResponseCode();
    if (status < 200 || status >= 300) return {ok:false,error:"HTTP " + status + ": " + res.getContentText().slice(0,240)};
    return {ok:true,status:status};
  } catch (err) {
    return {ok:false,error:err && err.message ? err.message : String(err)};
  }
}

function publicPipelineJob_(job, refresh) {
  const data = job.data;
  // Verification is read-only and can safely run after a browser reconnect.
  if (refresh && data.expected && ["committing","committed","verifying","published_pages_pending","published_pages_timeout"].includes(data.stage)) {
    const validation = data.kind === "prv" ? verifyPrvReleaseBoth_(data.code,data.expected) : verifyChecklistReleaseBoth_(data.sport,data.code,data.expected);
    const now = new Date().toISOString();
    data.verification_started_at = data.verification_started_at || data.updated_at || now;
    data.verification_checked_at = now;
    data.verification_checks = Number(data.verification_checks || 0) + 1;
    data.result = Object.assign({},data.result || {},{validation:validation});
    if (validation.github.ok && validation.public.ok) {
      data.result.ok = true;
      data.result.status = "published_and_public_validated";
      data.stage = "complete";
      data.error = "";
    } else if (Date.now() - Date.parse(data.verification_started_at) >= 24 * 60 * 60 * 1000) {
      data.stage = "failed";
      data.error = "The expected release could not be verified within 24 hours. It may have been replaced by a newer release or deployment may have failed. Inspect the saved commit and validation before explicitly retrying; no upload was repeated.";
      data.result.ok = false;
    } else if (data.escalated) {
      // An escalated job stays escalated on an unsuccessful manual re-check; only
      // a confirmed propagation (handled above) can promote it to complete.
      data.stage = "published_pages_timeout";
      data.result.ok = false;
      data.result.status = "published_pages_timeout";
    } else {
      data.stage = validation.github.ok ? "published_pages_pending" : "verifying";
      data.result.ok = validation.github.ok;
      data.result.status = validation.github.ok ? "published_pages_pending" : "publish_verifying";
    }
    // Persist unsuccessful checks too, so one unavailable release cannot monopolize verification.
    savePipelineJob_(job);
  }
  const result = data.result || {};
  return Object.assign({},result,{ok:data.stage === "complete" || data.stage === "published_pages_pending",status:data.stage === "complete" ? "published_and_public_validated" : data.stage === "published_pages_pending" ? "published_pages_pending" : data.stage === "published_pages_timeout" ? "published_pages_timeout" : data.stage === "failed" ? "publish_failed" : "publish_" + data.stage,
    error:data.error || result.error || "",job:{id:data.id,stage:data.stage,attempts:data.attempts,commit:data.commit || "",created_at:data.created_at,updated_at:data.updated_at || data.created_at}});
}

function runSentinelPublishJobsInitial_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const files = pipelineJobFolder_().getFiles();
    let next = null, pending = null;
    while (files.hasNext()) {
      const file = files.next();
      if (!/\.json$/.test(file.getName())) continue;
      const data = JSON.parse(file.getBlob().getDataAsString());
      if (["running","committing","committed","verifying"].includes(data.stage) && Date.now() - new Date(data.updated_at || data.created_at).getTime() > 600000) {
        const job = {file:file,data:data};
        // Interrupted jobs never automatically repeat uncertain file writes.
        const checked = data.expected ? publicPipelineJob_(job,true) : null;
        if (!checked || !checked.ok) { data.stage="failed"; data.error="Previous worker was interrupted. Inspect this job before explicitly retrying."; savePipelineJob_(job); }
      }
      if (data.stage === "published_pages_pending" && !pending) pending = {file:file,data:data};
      if (data.stage === "queued" && (!next || data.created_at < next.data.created_at)) next = {file:file,data:data};
    }
    if (!next) { if (pending) publicPipelineJob_(pending,true); return; }
    CM_CURRENT_PUBLISH_JOB = next;
    next.data.stage="running"; next.data.attempts++; savePipelineJob_(next);
    try {
      const result = next.data.kind === "prv" ? publishPrvProductAtomic_(next.data.code) : publishChecklistAfterImportLocked_(next.data);
      next.data.result = result;
      next.data.stage = result.ok ? result.status === "published_and_public_validated" ? "complete" : "published_pages_pending" : "verifying";
      savePipelineJob_(next);
    } catch (err) {
      // A candidate commit/expected hash may already have reached GitHub.
      if (next.data.expected && next.data.commit) {
        next.data.stage="committing";
        const checked = publicPipelineJob_(next,true);
        if (checked.ok) return;
      }
      next.data.stage="failed"; next.data.error=String(err && err.message || err); savePipelineJob_(next);
    }
  } finally { CM_CURRENT_PUBLISH_JOB = null; lock.releaseLock(); }
}

function getPipelineJobStatus_(id) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return publicPipelineJob_(readPipelineJob_(id), false);
  try { return publicPipelineJob_(readPipelineJob_(id), true); }
  finally { lock.releaseLock(); }
}

// Owner-only editor smoke test: republish existing source data through the queue.
function runSentinelPipelineSmokeTest() {
  const id = "pipeline-smoke-" + new Date().toISOString().replace(/[^0-9]/g, "");
  const queued = enqueuePipelineJob_("checklist", {request_id:id,sport:"basketball",bucket:"2026",code:"2026_donruss_wnba_basketball"});
  Logger.log(JSON.stringify(queued));
  runSentinelPublishJobs();
  Logger.log(JSON.stringify(getPipelineJobStatus_(id)));
}

function runLegacyReleaseAtomically_(operation, label) {
  if (CM_GITHUB_TRANSACTION) return operation();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error("Another release is running.");
  try { return runAtomicGitHubPublish_(operation, label); }
  finally { lock.releaseLock(); }
}

function publishChecklistStaticDataToGitHub() {
  return runLegacyReleaseAtomically_(() => publishChecklistStaticDataToGitHubReleaseBase_(), "Publish complete publishChecklistStaticDataToGitHub");
}

function publishCurrentChecklistStaticDataToGitHub() {
  return runLegacyReleaseAtomically_(() => publishCurrentChecklistStaticDataToGitHubReleaseBase_(), "Publish complete publishCurrentChecklistStaticDataToGitHub");
}

function publishCurrentChecklistSportAndIndexToGitHub_(sport) {
  return runLegacyReleaseAtomically_(() => publishCurrentChecklistSportAndIndexToGitHubReleaseBase_(sport), "Publish complete publishCurrentChecklistSportAndIndexToGitHub_");
}

function publishCurrentChecklistSportToGitHub(sportValue, options) {
  return runLegacyReleaseAtomically_(() => publishCurrentChecklistSportToGitHubReleaseBase_(sportValue, options), "Publish complete publishCurrentChecklistSportToGitHub");
}

function publishChecklistSourceToGitHub(sportValue, sourceKeyValue, options) {
  return runLegacyReleaseAtomically_(() => publishChecklistSourceToGitHubReleaseBase_(sportValue, sourceKeyValue, options), "Publish complete publishChecklistSourceToGitHub");
}

function publishChecklistSourceProductsToGitHub(sportValue, sourceKeyValue) {
  return runLegacyReleaseAtomically_(() => publishChecklistSourceProductsToGitHubReleaseBase_(sportValue, sourceKeyValue), "Publish complete publishChecklistSourceProductsToGitHub");
}

function publishChecklistSourceSearchToGitHub(sportValue, sourceKeyValue) {
  return runLegacyReleaseAtomically_(() => publishChecklistSourceSearchToGitHubReleaseBase_(sportValue, sourceKeyValue), "Publish complete publishChecklistSourceSearchToGitHub");
}

function publishChecklistSourceSearchStandaloneToGitHub(sportValue, sourceKeyValue) {
  return runLegacyReleaseAtomically_(() => publishChecklistSourceSearchStandaloneToGitHubReleaseBase_(sportValue, sourceKeyValue), "Publish complete publishChecklistSourceSearchStandaloneToGitHub");
}

function publishChecklistIndexFromProductBundlesToGitHub() {
  return runLegacyReleaseAtomically_(() => publishChecklistIndexFromProductBundlesToGitHubReleaseBase_(), "Publish complete publishChecklistIndexFromProductBundlesToGitHub");
}

function publishChecklistIndexFromGoogleSheetsToGitHub() {
  return runLegacyReleaseAtomically_(() => publishChecklistIndexFromGoogleSheetsToGitHubReleaseBase_(), "Publish complete publishChecklistIndexFromGoogleSheetsToGitHub");
}

function zzRunSentinelPipelineSmokeTest() {
  return runSentinelPipelineSmokeTest();
}


function activePipelineJobIds_() {
  const props = PropertiesService.getScriptProperties(), raw = props.getProperty("CM_ACTIVE_PUBLISH_JOBS");
  if (raw) return JSON.parse(raw);
  // One-time migration of existing receipts. Future ticks read only active jobs.
  const ids = [], folderId = props.getProperty("CM_PUBLISH_JOBS_FOLDER");
  if (folderId) {
    const files = DriveApp.getFolderById(folderId).getFiles();
    while (files.hasNext()) {
      const file = files.next();
      if (!/\.json$/.test(file.getName())) continue;
      const data = JSON.parse(file.getBlob().getDataAsString());
      if (!["complete","failed"].includes(data.stage)) ids.push(data.id);
    }
  }
  props.setProperty("CM_ACTIVE_PUBLISH_JOBS",JSON.stringify(ids));
  return ids;
}

function trackPipelineJob_(job) {
  const ids = activePipelineJobIds_().filter(id => id !== job.data.id);
  if (!["complete","failed"].includes(job.data.stage)) ids.push(job.data.id);
  PropertiesService.getScriptProperties().setProperty("CM_ACTIVE_PUBLISH_JOBS",JSON.stringify(ids));
}

function savePipelineJob_(job) {
  job.data.updated_at = new Date().toISOString();
  job.file.setContent(JSON.stringify(job.data));
  trackPipelineJob_(job);
}

function runSentinelPublishJobs() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const ids = activePipelineJobIds_();
    if (!ids.length) return;
    let next = null, pending = null;
    ids.forEach(id => {
      const job = readPipelineJob_(id), data = job.data;
      if (["running","committing","committed","verifying"].includes(data.stage) && Date.now() - new Date(data.updated_at || data.created_at).getTime() > 600000) {
        if (!data.expected) { data.stage="failed"; data.error="Previous worker was interrupted. Inspect this job before explicitly retrying."; savePipelineJob_(job); }
      }
      // A job stuck in published_pages_pending past the max age escalates once to
      // published_pages_timeout (recoverable, not a failure) with a single alert;
      // it is not selected for the opportunistic re-check on the escalating tick.
      if (shouldEscalatePendingJob_(data, Date.now(), CM_PUBLISHED_PAGES_PENDING_MAX_AGE_MS)) { escalatePendingPublishJob_(job, Date.now()); return; }
      if (data.expected && ["committing","committed","verifying","published_pages_pending"].includes(data.stage) && (!pending || (data.verification_checked_at || data.updated_at || data.created_at) < (pending.data.verification_checked_at || pending.data.updated_at || pending.data.created_at))) pending=job;
      if (data.stage === "queued" && (!next || data.created_at < next.data.created_at)) next=job;
    });
    // Check one pending release every tick, even while uploads remain queued.
    if (pending) publicPipelineJob_(pending,true);
    if (!next) return;
    CM_CURRENT_PUBLISH_JOB = next;
    next.data.stage="running"; next.data.attempts++; savePipelineJob_(next);
    try {
      const result = next.data.kind === "prv" ? publishPrvProductAtomic_(next.data.code) : publishChecklistAfterImportLocked_(next.data);
      next.data.result=result;
      next.data.stage=result.ok ? result.status === "published_and_public_validated" ? "complete" : "published_pages_pending" : "verifying";
      savePipelineJob_(next);
    } catch (err) {
      if (next.data.expected && next.data.commit) {
        next.data.stage="committing";
        if (publicPipelineJob_(next,true).ok) return;
      }
      next.data.stage="failed"; next.data.error=String(err && err.message || err); savePipelineJob_(next);
    }
  } finally { CM_CURRENT_PUBLISH_JOB=null; lock.releaseLock(); }
}

function enqueuePipelineJob_(kind, input) {
  const id = value_(input.request_id);
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id)) throw new Error("A stable request_id is required to queue publishing.");
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return {ok:false,status:"publish_busy",error:"Publisher is busy; reuse the same request ID to check again."};
  try {
    let existing = null;
    const folder = pipelineJobFolder_(), files = folder.getFilesByName(id + ".json");
    if (files.hasNext()) { const file = files.next(); existing = {file:file,data:JSON.parse(file.getBlob().getDataAsString())}; }
    if (existing) {
      if (existing.data.kind !== kind || existing.data.code !== value_(input.code) || existing.data.sport !== value_(input.sport) || existing.data.bucket !== value_(input.bucket)) throw new Error("Request ID is already used for a different publish target.");
      return publicPipelineJob_(existing, false);
    }
    ensurePipelineWorker_();
    const data = {id:id,kind:kind,sport:value_(input.sport),bucket:value_(input.bucket),code:value_(input.code),stage:"queued",attempts:0,created_at:new Date().toISOString()};
    if (!data.code || kind === "checklist" && (!data.sport || !data.bucket || !CM_CHECKLIST_DB_MAP[data.sport])) throw new Error("Invalid queued publish target.");
    if (activePipelineJobIds_().length >= 50) throw new Error("The publish queue is full. Resolve existing jobs before adding another.");
    const file = folder.createFile(id + ".json",JSON.stringify(data),MimeType.PLAIN_TEXT);
    const job = {file:file,data:data};
    savePipelineJob_(job);
    return publicPipelineJob_(job, false);
  } finally { lock.releaseLock(); }
}

function prvExportNotes_(row) {
  return [value_(row.notes),value_(row.prv_measurement_note)].filter(Boolean).join(" ");
}


function auditApprovedSapphireRelease() {
  const source=prvSourceTables_(getVaultSpreadsheet_());
  const targets=[
    ["2019_Topps_Chrome_Sapphire_Edition_Baseball",1],
    ["2020_topps_chrome_sapphire_baseball",1],
    ["2021_topps_chrome_sapphire_edition_baseball",1],
    ["2023_topps_chrome_sapphire_baseball",2],
    ["2025_26_topps_finest_uefa_club_competitions_soccer",32]
  ];
  if(source.report.input_rows!==8414 || source.report.unmatched_rows!==3633)throw new Error("Source snapshot changed; publication held.");
  const approved=source.products.filter(r=>r.prv_identity_review && !r.prv_identity_hold);
  const held=source.products.filter(r=>r.prv_identity_hold && /sapphire/i.test(r.code));
  if(approved.length!==5 || held.length!==5)throw new Error("Approved/held Sapphire counts changed.");
  const built=buildVaultStaticData_();
  targets.forEach(t=>{
    const p=built.products[t[0]];
    if(!p || p.rows.length!==t[1])throw new Error("Release count mismatch: "+t[0]);
    if(t[0].indexOf("sapphire")>=0 || /Sapphire/.test(t[0]))p.rows.forEach(r=>{
      if(!/Unverified estimate/.test(r.notes) || r.cmURL)throw new Error("Unverified qualifier/source changed.");
      if(r.setLine==="Autograph")throw new Error("Held autograph leaked.");
    });
  });
  Logger.log("APPROVED RELEASE PREFLIGHT "+JSON.stringify({input_rows:source.report.input_rows,unmatched_rows:source.report.unmatched_rows,unmatched_groups:source.report.unmatched.length,approved_sapphire_rows:approved.length,held_sapphire_rows:held.length,targets:targets,sheet_writes:false,d1_queries:false}));
}

function prvStep7Signature_(row, sourceCode) {
  const fields=["code","displayname","year","sport","manufacturer","product","settype","setline","parallel","printrun","serial","subsetsize","packodds","notes","cmurl"];
  return JSON.stringify(fields.map(k=>{
    const v=k==="code"?sourceCode:row[k], s=String(v==null?"":v).trim();
    if(k==="printrun" || k==="subsetsize") {const n=s.replace(/,/g,"");return /^\d+(\.\d+)?$/.test(n)?String(Number(n)):s;}
    return s;
  }));
}

function prvApplyApprovedStep7_(index, products) {
  index=index.slice();products=products.slice();
  const text=v=>String(v==null?"":v).trim(), fold=v=>text(v).toLowerCase().replace(/\s+/g," ");
  const identity=r=>[fold(r.sport),fold(r.year),fold(r.displayname || r.display_name)].join("|");
  const digest=s=>{if(typeof Utilities==="undefined" || !Utilities.computeDigest)return null;return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,s,Utilities.Charset.UTF_8).map(x=>(x<0?x+256:x).toString(16).padStart(2,"0")).join("");};
  prvApprovedStep7Manifest_().forEach(rule=>{
    const entries=products.map((r,i)=>({r:r,i:i})).filter(e=>text(e.r.code)===rule.source || e.r.prv_identity_review && e.r.prv_identity_review.review_id==="step7-122-2026-10-26" && e.r.prv_identity_review.source_code===rule.source);
    if(!entries.length)return;
    const target=index.map((r,i)=>({r:r,i:i})).filter(e=>text(e.r.code)===rule.target || identity(e.r)===identity(rule.meta));
    const competing=products.some(r=>text(r.code)===rule.target && !entries.some(e=>e.r===r));
    const signatures=entries.map(e=>prvStep7Signature_(e.r,rule.source)).sort();
    const valid=entries.length===rule.count && digest(JSON.stringify(signatures))===rule.sha256 && !competing && (target.length===0 || target.length===1 && text(target[0].r.code)===rule.target && identity(target[0].r)===identity(rule.meta));
    if(!valid){entries.forEach(e=>{products[e.i]=Object.assign({},e.r,{prv_identity_hold:true,prv_step7_hold_reason:"Approved Step 7 source signature/catalog changed; renewed review required"});});return;}
    if(!target.length)index.push(Object.assign({},rule.meta));
    entries.forEach(e=>{products[e.i]=Object.assign({},e.r,{code:rule.target,prv_measurement_note:"Unverified estimate; source URL not recorded.",prv_identity_review:{review_id:"step7-122-2026-10-26",source_code:rule.source,source_sheet_row:e.i+2,measurement_verified:false}});});
  });
  return {index:index,products:products};
}

function prvApprovedStep7Manifest_() {
  return [{"source":"2022_topps_chrome_update_baseball","target":"2022_topps_chrome_update_baseball","meta":{"code":"2022_topps_chrome_update_baseball","displayname":"2022 Topps Chrome Update Baseball","year":"2022","sport":"baseball","manufacturer":"Topps","product":"Chrome Update","keywords":"2022 Topps Chrome Update Baseball, 2022 Topps Chrome Update, 2022 Chrome Update Baseball, 2022 Chrome Update, 22 Topps Chrome Update Baseball, 22 Topps Chrome Update, 22 Chrome Update Baseball, 22 Chrome Update, Topps Chrome Update Baseball, Topps Chrome Update, Chrome Update Baseball, Chrome Update, Topps Chrome Update checklist, Chrome Update checklist, Topps Chrome Update baseball checklist, 2022 Topps Chrome Update checklist, 2022 Chrome Update checklist","cmurl":""},"count":8,"sha256":"75becbd305109f328022ecc10d5436b00f28a9f5a59e03f75838424c0d140d00"},{"source":"2022_topps_stadium_club_baseball","target":"2022_topps_stadium_club_baseball","meta":{"code":"2022_topps_stadium_club_baseball","displayname":"2022 Topps Stadium Club Baseball","year":"2022","sport":"baseball","manufacturer":"Topps","product":"Stadium Club","keywords":"2022 Topps Stadium Club Baseball, Topps Stadium Club Baseball 2022, 2022 Topps Stadium Club cards, Stadium Club baseball cards 2022, 2022 Topps Stadium Club MLB cards, Topps Stadium Club hobby box 2022, Stadium Club rookie cards 2022, Topps Stadium Club rookies 2022, Julio Rodriguez Stadium Club rookie cards 2022, Bobby Witt Jr Stadium Club rookie cards 2022, Topps Stadium Club autos 2022, Stadium Club autographs baseball 2022, premium photography baseball cards 2022, full bleed baseball cards Topps 2022, Beam Team inserts 2022, Stadium Club parallels 2022, collectible baseball photography cards 2022, Topps Stadium Club inserts 2022, Topps Stadium Club Baseball checklist 2022, Stadium Club checklist","cmurl":""},"count":15,"sha256":"e8e15ab5f0e04e8e59ee7c404420f808f18487ee144531f7cb3756f88bd9e393"},{"source":"2022_topps_heritage_baseball","target":"2022_topps_heritage_baseball","meta":{"code":"2022_topps_heritage_baseball","displayname":"2022 Topps Heritage Baseball","year":"2022","sport":"baseball","manufacturer":"Topps","product":"Heritage","keywords":"2022 Topps Heritage Baseball, 2022 Topps Heritage, 2022 Heritage Baseball, 2022 Heritage, 22 Topps Heritage Baseball, 22 Topps Heritage, 22 Heritage Baseball, 22 Heritage, Topps Heritage Baseball, Topps Heritage, Heritage Baseball, Heritage, Topps Heritage checklist, Heritage checklist, Topps Heritage baseball checklist, 2022 Topps Heritage checklist, 2022 Heritage checklist","cmurl":""},"count":13,"sha256":"9e1375590dcdfe706c5948e7098a73d4b753e9b26cac69bb16741836db4a2bd4"},{"source":"2022_topps_stadium_club_chrome_baseball","target":"2022_topps_stadium_club_chrome_baseball","meta":{"code":"2022_topps_stadium_club_chrome_baseball","displayname":"2022 Topps Stadium Club Chrome Baseball","year":"2022","sport":"baseball","manufacturer":"Topps","product":"Stadium Club Chrome","keywords":"2022 Topps Stadium Club Chrome Baseball, Topps Stadium Club Chrome Baseball 2022, 2022 Topps Stadium Club Chrome cards, Stadium Club Chrome baseball cards 2022, 2022 Topps Stadium Club Chrome MLB cards, Topps Stadium Club Chrome hobby box 2022, Stadium Club Chrome rookie cards 2022, Topps Stadium Club Chrome rookies 2022, Topps Stadium Club Chrome autos 2022, Stadium Club Chrome autographs baseball 2022, Topps Stadium Club Chrome parallels 2022, Stadium Club Chrome refractors 2022, premium photography baseball cards 2022, full bleed chrome baseball cards Topps 2022, Stadium Club Chrome inserts 2022, Beam Team chrome inserts 2022, chromium baseball cards Topps 2022, Topps Stadium Club Chrome Baseball checklist 2022, Stadium Club Chrome checklist","cmurl":""},"count":14,"sha256":"70f916c9b5c5b8cdc352ad245b5e32853c6a0ac80c3c3edebf5c9ec5dc0526ac"},{"source":"2022_topps_fire_baseball","target":"2022_topps_fire_baseball","meta":{"code":"2022_topps_fire_baseball","displayname":"2022 Topps Fire Baseball","year":"2022","sport":"baseball","manufacturer":"Topps","product":"Fire","keywords":"2022 Topps Fire Baseball, Topps Fire Baseball 2022, 2022 Topps Fire cards, Fire baseball cards 2022, 2022 Topps Fire MLB cards, Topps Fire rookie cards 2022, Fire rookies baseball 2022, Julio Rodriguez Fire rookie cards 2022, Bobby Witt Jr Fire rookie cards 2022, Topps Fire autos 2022, Fire autographs baseball 2022, colorful baseball cards Topps 2022, flame design baseball cards 2022, artistic baseball cards Topps 2022, retail exclusive baseball cards Topps 2022, Topps Fire parallels 2022, collectible modern baseball cards 2022, Topps Fire inserts 2022, Topps Fire Baseball checklist 2022, Fire checklist","cmurl":""},"count":16,"sha256":"1d9a231e5828c1bb22017e7bf6fd7950a8c8bc5f55b1aac694c1cf6bec2f2627"},{"source":"2022_topps_chrome_black_baseball","target":"2022_topps_chrome_black_baseball","meta":{"code":"2022_topps_chrome_black_baseball","displayname":"2022 Topps Chrome Black Baseball","year":"2022","sport":"baseball","manufacturer":"Topps","product":"Chrome Black","keywords":"2022 Topps Chrome Black Baseball, Topps Chrome Black Baseball 2022, 2022 Topps Chrome Black cards, Chrome Black baseball cards 2022, 2022 Topps Chrome Black MLB cards, Topps Chrome Black hobby box 2022, Chrome Black rookie cards 2022, Topps Chrome Black rookies 2022, Topps Chrome Black autos 2022, Chrome Black autographs baseball 2022, encased autograph baseball cards 2022, Topps Chrome Black parallels 2022, black chrome baseball cards Topps 2022, premium chrome baseball cards 2022, chromium baseball cards Topps 2022, luxury baseball cards Topps 2022, Topps Chrome Black inserts 2022, collectible encased autos baseball 2022, Topps Chrome Black Baseball checklist 2022, Chrome Black checklist","cmurl":""},"count":3,"sha256":"fe4a432d1ffb8465e4b3774cd27607097b08f6e1ff95129c26db4e3f76e0717c"},{"source":"2022_topps_pristine_baseball","target":"2022_topps_pristine_baseball","meta":{"code":"2022_topps_pristine_baseball","displayname":"2022 Topps Pristine Baseball","year":"2022","sport":"baseball","manufacturer":"Topps","product":"Pristine","keywords":"2022 Topps Pristine Baseball, Topps Pristine Baseball 2022, 2022 Topps Pristine cards, Pristine baseball cards 2022, 2022 Topps Pristine MLB cards, Topps Pristine rookie cards 2022, Pristine rookies baseball 2022, Julio Rodriguez Pristine rookie cards 2022, Bobby Witt Jr Pristine rookie cards 2022, Topps Pristine autos 2022, Pristine autographs baseball 2022, encased baseball cards Topps 2022, premium chrome baseball cards 2022, refractor baseball cards Topps 2022, luxury baseball cards Topps 2022, collectible chromium baseball cards 2022, Topps Pristine parallels 2022, Topps Pristine inserts 2022, Topps Pristine Baseball checklist 2022, Pristine checklist","cmurl":""},"count":6,"sha256":"8fffb1b13edf24c379768e2fdee58066169673470509b3b9d864ec1f1c4c35a6"},{"source":"2021_topps_bowman_heritage_baseball","target":"2021_bowman_heritage_baseball","meta":{"code":"2021_bowman_heritage_baseball","displayname":"2021 Bowman Heritage Baseball","year":"2021","sport":"baseball","manufacturer":"Bowman","product":"Heritage","keywords":"2021 Bowman Heritage Baseball, Bowman Heritage Baseball 2021, 2021 Bowman Heritage cards, Bowman Heritage baseball cards 2021, 2021 Bowman Heritage MLB cards, retro prospect baseball cards 2021, vintage Bowman baseball cards 2021, Bowman Heritage rookie cards 2021, 1st Bowman Heritage cards 2021, Wander Franco Bowman Heritage cards 2021, top MLB prospect cards 2021, Bowman Heritage autos 2021, Bowman Heritage autographs 2021, throwback prospect baseball cards 2021, collectible retro baseball cards 2021, minor league prospect baseball cards 2021, Bowman Heritage parallels 2021, nostalgic baseball card designs 2021, Bowman Heritage Baseball checklist 2021, Bowman Heritage checklist","cmurl":""},"count":5,"sha256":"5b427b1ef9dbd45596b65f6ebaa13c1b8711dff8af8cceeacff545d059ce11c6"},{"source":"2022_topps_uk_edition_baseball","target":"2022_topps_baseball_uk_edition_baseball","meta":{"code":"2022_topps_baseball_uk_edition_baseball","displayname":"2022 Topps UK Edition Baseball","year":"2022","sport":"baseball","manufacturer":"Topps","product":"UK Edition","keywords":"2022 Topps UK Edition Baseball, Topps UK Edition Baseball 2022, 2022 Topps UK cards, UK Edition baseball cards 2022, 2022 Topps UK MLB cards, Topps UK Edition rookie cards 2022, UK Edition rookies 2022, Julio Rodriguez UK Edition rookie cards 2022, Bobby Witt Jr UK Edition rookie cards 2022, Topps UK Edition parallels 2022, British baseball cards Topps 2022, international baseball cards Topps 2022, Topps online exclusive baseball cards 2022, UK exclusive baseball cards 2022, Topps UK Edition inserts 2022, flagship baseball cards Topps 2022, collectible UK baseball cards 2022, Topps UK Edition Baseball checklist 2022, UK Edition checklist","cmurl":""},"count":5,"sha256":"960f9b4ef80b1c2403dd93daa8008ee15e062f84fa7dce2ae2854943d8b82dd7"},{"source":"2022_topps_mini_baseball","target":"2022_topps_mini_baseball","meta":{"code":"2022_topps_mini_baseball","displayname":"2022 Topps Mini Baseball","year":"2022","sport":"baseball","manufacturer":"Topps","product":"Mini","keywords":"2022 Topps Mini Baseball, Topps Mini Baseball 2022, 2022 Topps Mini cards, mini baseball cards Topps 2022, 2022 Topps Mini MLB cards, collectible mini baseball cards 2022, small format baseball cards 2022, Topps Mini rookie cards 2022, Topps Mini rookies baseball 2022, Topps Mini autos 2022, mini autographs baseball 2022, retro mini baseball cards 2022, novelty baseball cards Topps 2022, miniature baseball cards collectible 2022, Topps Mini parallels 2022, unique baseball card formats 2022, collectible baseball minis 2022, Topps Mini Baseball checklist 2022, Topps Mini checklist","cmurl":""},"count":3,"sha256":"d53587e73e14e477e8f2ecd7df4f5b67e575282f3e2c047855b486c7cf5e0d7a"},{"source":"2022_topps_series_1_baseball","target":"2022_topps_series_1_baseball","meta":{"code":"2022_topps_series_1_baseball","displayname":"2022 Topps Series 1 Baseball","year":"2022","sport":"baseball","manufacturer":"Topps","product":"Series 1","keywords":"2022 Topps Series 1 Baseball, 2022 Topps Series 1, 2022 Series 1 Baseball, 2022 Series 1, 22 Topps Series 1 Baseball, 22 Topps Series 1, 22 Series 1 Baseball, 22 Series 1, Topps Series 1 Baseball, Topps Series 1, Series 1 Baseball, Series 1, Topps Series 1 checklist, Series 1 checklist, 2022 Topps Series 1 checklist, 2022 Series 1 checklist, Topps Series 1 2022 checklist, Topps Series One Baseball, 2022 Topps Series One, 2022 Series One, Series One Baseball, Series One","cmurl":""},"count":2,"sha256":"a5d01667ce65a2b2b979c4031f75debf05c21f7a38b460d48e23f9e21cb86e81"},{"source":"2021_topps_series_1_baseball","target":"2021_topps_series_1_baseball","meta":{"code":"2021_topps_series_1_baseball","displayname":"2021 Topps Series 1 Baseball","year":"2021","sport":"baseball","manufacturer":"Topps","product":"Series 1","keywords":"2021 Topps Series 1 Baseball, 2021 Topps Series 1, 2021 Series 1 Baseball, 2021 Series 1, 21 Topps Series 1 Baseball, 21 Topps Series 1, 21 Series 1 Baseball, 21 Series 1, Topps Series 1 Baseball, Topps Series 1, Series 1 Baseball, Series 1, Topps Series One Baseball, Topps Series One, Series One Baseball, Series One, Topps Series 1 checklist, Series 1 checklist, 2021 Topps Series 1 checklist, 2021 Series 1 checklist","cmurl":""},"count":1,"sha256":"727c499b357244522cd7e7dcfc691cccb969029487fbe776e57daebdc6073bc7"},{"source":"2019_topps_series_1_baseball","target":"2019_Topps_Series_1_Baseball_Cards","meta":{"code":"2019_Topps_Series_1_Baseball_Cards","displayname":"2019 Topps Series 1 Baseball","year":"2019","sport":"baseball","manufacturer":"Topps","product":"Series 1","keywords":"2019 Topps Series 1 Baseball, Topps Series 1 Baseball 2019, 2019 Topps Series 1 cards, Topps Series 1 baseball cards 2019, 2019 Topps flagship baseball cards, flagship baseball cards Topps 2019, rookie baseball cards Topps 2019, Topps Series 1 rookie cards 2019, Vladimir Guerrero Jr rookie cards 2019, Eloy Jimenez rookie cards 2019, Fernando Tatis Jr rookie cards 2019, Pete Alonso rookie cards 2019, Topps Series 1 autos 2019, Topps Series 1 autographs baseball 2019, rainbow foil baseball cards 2019, gold parallel baseball cards 2019, vintage stock baseball cards 2019, collectible flagship baseball cards 2019, Topps Series 1 Baseball checklist 2019, Topps Series 1 checklist","cmurl":""},"count":1,"sha256":"f682e4e61518c11a21a3a439dc648df1cc9dbf47fc8ba0c9d8bd99ac6eaf382c"},{"source":"2020_topps_series_1_baseball","target":"2020_topps_series_1_baseball","meta":{"code":"2020_topps_series_1_baseball","displayname":"2020 Topps Series 1 Baseball","year":"2020","sport":"baseball","manufacturer":"Topps","product":"Series 1","keywords":"2020 Topps Series 1 Baseball, Topps Series 1 Baseball 2020, 2020 Topps Series 1 cards, Topps Series 1 baseball cards 2020, 2020 Topps flagship baseball cards, flagship baseball cards Topps 2020, 2020 Topps MLB cards, Topps Series 1 rookie cards 2020, Bo Bichette rookie cards 2020, Yordan Alvarez rookie cup cards 2020, Topps Series 1 parallels 2020, rainbow foil baseball cards 2020, gold foil baseball cards 2020, advanced stats baseball cards 2020, short print baseball cards 2020, vintage stock baseball cards 2020, turkey red baseball cards 2020, home run challenge baseball cards 2020, Topps Series 1 Baseball checklist 2020, Topps Series 1 checklist","cmurl":""},"count":1,"sha256":"5df0e62dfa328788fa7c6d72a6c997469984f7431d7a0a37b77fa491e5474979"},{"source":"2023_topps_update_series_baseball","target":"2023_topps_update_series_baseball","meta":{"code":"2023_topps_update_series_baseball","displayname":"2023 Topps Update Series baseball","year":"2023","sport":"baseball","manufacturer":"Topps","product":"Update Series","keywords":"2023 Topps Update Series Baseball, Topps Update Series Baseball 2023, 2023 Topps Update cards, Update Series baseball cards 2023, 2023 Topps Update MLB cards, Topps Update hobby box 2023, Update Series rookie cards 2023, Topps Update rookies 2023, Topps Update debut cards 2023, MLB All Star Game cards 2023, Topps Update autos 2023, Update autographs baseball 2023, Topps Update parallels 2023, rainbow foil baseball cards 2023, gold parallel baseball cards Topps 2023, Topps Update inserts 2023, Topps Update short prints 2023, flagship baseball cards Topps 2023, Topps Update Series Baseball checklist 2023, Update Series checklist","cmurl":""},"count":1,"sha256":"6e2ec84f7443e39ac4b0fa6162a364591dfe270e6866d40446d459a59165f47d"},{"source":"2021_topps_series_2_baseball","target":"2021_topps_series_2_baseball","meta":{"code":"2021_topps_series_2_baseball","displayname":"2021 Topps Series 2 Baseball","year":"2021","sport":"baseball","manufacturer":"Topps","product":"Series 2","keywords":"2021 Topps Series 2 Baseball, 2021 Topps Series 2, 2021 Series 2 Baseball, 2021 Series 2, 21 Topps Series 2 Baseball, 21 Topps Series 2, 21 Series 2 Baseball, 21 Series 2, Topps Series 2 Baseball, Topps Series 2, Series 2 Baseball, Series 2, Topps Series Two Baseball, Topps Series Two, Series Two Baseball, Series Two, Topps Series 2 checklist, Series 2 checklist, 2021 Topps Series 2 checklist, 2021 Series 2 checklist","cmurl":""},"count":1,"sha256":"96c9f49c86bd755d72e9c9f436a63d97ef73ba26abe29b40bd778c5b7f0a7b74"},{"source":"2018_topps_series_1_baseball","target":"2018_Topps_Series_1_Baseball","meta":{"code":"2018_Topps_Series_1_Baseball","displayname":"2018 Topps Series 1 Baseball","year":"2018","sport":"baseball","manufacturer":"Topps","product":"Series 1","keywords":"2018 Topps Series 1 Baseball, 2018 Topps Series 1, 2018 Topps Series One Baseball, 2018 Series 1 Baseball, 2018 Topps Series 1 cards, 2018 Series 1 baseball cards, 2018 Topps Series 1 rookies, 2018 Topps Series 1 rookie cards, Topps Series 1 Baseball 2018, Topps Series 1 2018, Series 1 Baseball cards 2018, Series 1 Baseball, Topps Series 1 baseball cards, Series 1 parallels 2018, Series 1 short prints 2018, Topps Series 1 Baseball checklist, Series 1 checklist 2018","cmurl":""},"count":1,"sha256":"bb88da65e8a65ceac3dbf0f0ce8f6ba7f3279f1f0ccb91dbc3694443d903a506"},{"source":"2017_topps_series_1_baseball","target":"2017_Topps_Series_1_Baseball","meta":{"code":"2017_Topps_Series_1_Baseball","displayname":"2017 Topps Series 1 Baseball","year":"2017","sport":"baseball","manufacturer":"Topps","product":"Series 1","keywords":"2017 Topps Series 1 Baseball","cmurl":""},"count":1,"sha256":"65f7dbd4ed5b36c1df744943aad330fcef646d699fc047b1efe76c3e149aebda"},{"source":"2020_topps_series_2_baseball","target":"2020_topps_series_2_baseball","meta":{"code":"2020_topps_series_2_baseball","displayname":"2020 Topps Series 2 Baseball","year":"2020","sport":"baseball","manufacturer":"Topps","product":"Series 2","keywords":"2020 Topps Series 2 Baseball, Topps Series 2 Baseball 2020, 2020 Topps Series 2 cards, Topps Series 2 baseball cards 2020, 2020 Topps flagship baseball cards, flagship baseball cards Topps 2020, 2020 Topps MLB cards, Topps Series 2 rookie cards 2020, Luis Robert rookie cards 2020, Yordan Alvarez rookie cup cards 2020, Topps Series 2 parallels 2020, rainbow foil baseball cards 2020, gold foil baseball cards 2020, advanced stats baseball cards 2020, short print baseball cards 2020, vintage stock baseball cards 2020, Topps Series 2 inserts 2020, home run challenge baseball cards 2020, Topps Series 2 Baseball checklist 2020, Topps Series 2 checklist","cmurl":""},"count":1,"sha256":"465dbc9a0942dabb3ac36db727e96ad1538226707c771331e2c7c717a7bfa33f"},{"source":"2019_topps_series_2_baseball","target":"2019_Topps_Series_2_Baseball","meta":{"code":"2019_Topps_Series_2_Baseball","displayname":"2019 Topps Series 2 Baseball","year":"2019","sport":"baseball","manufacturer":"Topps","product":"Series 2","keywords":"2019 Topps Series 2 Baseball, Topps Series 2 Baseball 2019, 2019 Topps Series 2 cards, Topps Series 2 baseball cards 2019, 2019 Topps flagship baseball cards, flagship baseball cards Topps 2019, rookie baseball cards Topps 2019, Topps Series 2 rookie cards 2019, Fernando Tatis Jr Topps rookie cards 2019, Vladimir Guerrero Jr Topps rookie cards 2019, Pete Alonso Topps rookie cards 2019, Eloy Jimenez Topps rookie cards 2019, Topps Series 2 autos 2019, Topps Series 2 autographs baseball 2019, rainbow foil baseball cards 2019, gold parallel baseball cards 2019, vintage stock baseball cards 2019, collectible flagship baseball cards 2019, Topps Series 2 Baseball checklist 2019, Topps Series 2 checklist","cmurl":""},"count":1,"sha256":"c7f19bb28af200130a1b34e96ad5d44749e5ef5594e9ae8bf0dd746d72e2dd3d"},{"source":"2018_topps_series_2_baseball","target":"2018_Topps_Series_2_Baseball","meta":{"code":"2018_Topps_Series_2_Baseball","displayname":"2018 Topps Series 2 Baseball","year":"2018","sport":"baseball","manufacturer":"Topps","product":"Series 2","keywords":"2018 Topps Series 2 Baseball, 2018 Topps Series 2, 2018 Series 2 Baseball, 2018 Series 2, 18 Topps Series 2 Baseball, 18 Topps Series 2, 18 Series 2 Baseball, 18 Series 2, Topps Series 2 Baseball, Topps Series 2, Series 2 Baseball, Series 2, Topps Series 2, Series 2, 2018 Topps Series 2, 2018 Series 2, Topps Series 2 2018, Topps Series Two Baseball, 2018 Topps Series Two, 2018 Series Two, Series Two Baseball, Series Two","cmurl":""},"count":1,"sha256":"e8fb6d7dd991df5d381a8d64c89c617b67aca8fa1d7e656387deaab1adc5acd0"},{"source":"2021_topps_chrome_baseball","target":"2021_topps_chrome_baseball","meta":{"code":"2021_topps_chrome_baseball","displayname":"2021 Topps Chrome Baseball","year":"2021","sport":"baseball","manufacturer":"Topps","product":"Chrome","keywords":"2021 Topps Chrome Baseball, 2021 Topps Chrome, 2021 Chrome Baseball, 2021 Chrome, 21 Topps Chrome Baseball, 21 Topps Chrome, 21 Chrome Baseball, 21 Chrome, Topps Chrome Baseball, Topps Chrome, Chrome Baseball, Chrome, Topps Chrome checklist, Chrome checklist, Topps Chrome baseball checklist, 2021 Topps Chrome checklist, 2021 Chrome checklist","cmurl":""},"count":1,"sha256":"669b3e6b8fd9388299d8dbf3ab444957e7f215eb9f7574e5171a2c3d2b00342d"},{"source":"2020_topps_chrome_baseball","target":"2020_topps_chrome_baseball","meta":{"code":"2020_topps_chrome_baseball","displayname":"2020 Topps Chrome Baseball","year":"2020","sport":"baseball","manufacturer":"Topps","product":"Chrome","keywords":"2020 Topps Chrome Baseball, 2020 Topps Chrome, 2020 Chrome Baseball, 2020 Chrome, 20 Topps Chrome Baseball, 20 Topps Chrome, 20 Chrome Baseball, 20 Chrome, Topps Chrome Baseball, Topps Chrome, Chrome Baseball, Chrome, Topps Chrome checklist, Chrome checklist, Topps Chrome baseball checklist, 2020 Topps Chrome checklist, 2020 Chrome checklist","cmurl":""},"count":3,"sha256":"80315049e157446e8b5cb6d69729521df091a172fcec53900c1ad6afdb840f92"},{"source":"2020_topps_chrome_update_baseball","target":"2020_topps_chrome_update_baseball","meta":{"code":"2020_topps_chrome_update_baseball","displayname":"2020 Topps Chrome Update Baseball","year":"2020","sport":"baseball","manufacturer":"Topps","product":"Chrome Update","keywords":"2020 Topps Chrome Update Baseball, 2020 Topps Chrome Update, 2020 Chrome Update Baseball, 2020 Chrome Update, 20 Topps Chrome Update Baseball, 20 Topps Chrome Update, 20 Chrome Update Baseball, 20 Chrome Update, Topps Chrome Update Baseball, Topps Chrome Update, Chrome Update Baseball, Chrome Update, Topps Chrome Update checklist, Chrome Update checklist, Topps Chrome Update baseball checklist, 2020 Topps Chrome Update checklist, 2020 Chrome Update checklist","cmurl":""},"count":1,"sha256":"e3044902e83d6215ed524726fd484e310a887a31a9458dc2b317d3910b3992bf"},{"source":"2021_topps_chrome_update_baseball","target":"2021_topps_chrome_update_baseball","meta":{"code":"2021_topps_chrome_update_baseball","displayname":"2021 Topps Chrome Update Baseball","year":"2021","sport":"baseball","manufacturer":"Topps","product":"Chrome Update","keywords":"2021 Topps Chrome Update Baseball, 2021 Topps Chrome Update, 2021 Chrome Update Baseball, 2021 Chrome Update, 21 Topps Chrome Update Baseball, 21 Topps Chrome Update, 21 Chrome Update Baseball, 21 Chrome Update, Topps Chrome Update Baseball, Topps Chrome Update, Chrome Update Baseball, Chrome Update, Topps Chrome Update checklist, Chrome Update checklist, Topps Chrome Update baseball checklist, 2021 Topps Chrome Update checklist, 2021 Chrome Update checklist","cmurl":""},"count":1,"sha256":"54f31f5904084bbe9659abd4a9975faa1146ec1ad0ecbcb53012897c2be4147e"},{"source":"2021_topps_gypsy_queen_baseball","target":"2021_topps_gypsy_queen_baseball","meta":{"code":"2021_topps_gypsy_queen_baseball","displayname":"2021 Topps Gypsy Queen Baseball","year":"2021","sport":"baseball","manufacturer":"Topps","product":"Gypsy Queen","keywords":"2021 Topps Gypsy Queen Baseball, Topps Gypsy Queen Baseball 2021, 2021 Topps Gypsy Queen cards, Gypsy Queen baseball cards 2021, 2021 Topps Gypsy Queen MLB cards, vintage style baseball cards 2021, artistic baseball cards Topps 2021, tarot style baseball cards 2021, Topps Gypsy Queen rookie cards 2021, Jonathan India Gypsy Queen rookie cards 2021, Jarred Kelenic Gypsy Queen rookie cards 2021, Topps Gypsy Queen autos 2021, Gypsy Queen autographs baseball 2021, bazooka back baseball cards 2021, missing nameplate baseball cards 2021, logo swap baseball cards 2021, collectible retro baseball cards 2021, Topps Gypsy Queen parallels 2021, Topps Gypsy Queen Baseball checklist 2021, Gypsy Queen checklist","cmurl":""},"count":1,"sha256":"7f14033c7324f286c5cb0884eae460c5ec6c7c2f212b47dd9ebf89358586a37d"},{"source":"2021_topps_archives_baseball","target":"2021_topps_archives_baseball","meta":{"code":"2021_topps_archives_baseball","displayname":"2021 Topps Archives Baseball","year":"2021","sport":"baseball","manufacturer":"Topps","product":"Archives","keywords":"2021 Topps Archives Baseball, Topps Archives Baseball 2021, 2021 Topps Archives cards, Archives baseball cards 2021, 2021 Topps Archives MLB cards, retro baseball cards Topps 2021, vintage baseball card designs 2021, throwback baseball cards 2021, Topps Archives rookie cards 2021, Jonathan India Archives rookie cards 2021, Topps Archives autos 2021, Archives autographs baseball 2021, fan favorites autographs baseball 2021, 1957 Topps baseball cards 2021, 1961 Topps baseball cards 2021, 1991 Topps baseball cards 2021, collectible retro baseball cards 2021, Topps Archives parallels 2021, Topps Archives Baseball checklist 2021, Archives checklist","cmurl":""},"count":1,"sha256":"8771e3d74da581c793f57a9d76ea7f9a0f7ae91b84fa8b5bde5454b070387888"},{"source":"2018_topps_chrome_update_baseball","target":"2018_Topps_Chrome_Update","meta":{"code":"2018_Topps_Chrome_Update","displayname":"2018 Topps Chrome Update Baseball","year":"2018","sport":"baseball","manufacturer":"Topps","product":"Chrome Update","keywords":"2018 Topps Chrome Update Baseball, 2018 Topps Chrome Update, 2018 Chrome Update Baseball, 2018 Chrome Update, 18 Topps Chrome Update Baseball, 18 Topps Chrome Update, 18 Chrome Update Baseball, 18 Chrome Update, Topps Chrome Update Baseball, Topps Chrome Update, Chrome Update Baseball, Chrome Update, Topps Chrome Update, Chrome Update, 2018 Topps Chrome Update, 2018 Chrome Update, Topps Chrome Update 2018","cmurl":""},"count":1,"sha256":"fa88b3bd8fd035dc43ab3a9552f94d56d1f38ad7484f8c90ca9683d3eb9fd4fd"},{"source":"2021_topps_gallery_baseball","target":"2021_topps_gallery_baseball","meta":{"code":"2021_topps_gallery_baseball","displayname":"2021 Topps Gallery Baseball","year":"2021","sport":"baseball","manufacturer":"Topps","product":"Gallery","keywords":"2021 Topps Gallery Baseball, Topps Gallery Baseball 2021, 2021 Topps Gallery cards, Gallery baseball cards 2021, 2021 Topps Gallery MLB cards, artistic baseball cards Topps 2021, retail exclusive baseball cards 2021, Topps Gallery rookie cards 2021, Jonathan India Gallery rookie cards 2021, Topps Gallery autos 2021, Gallery autographs baseball 2021, modern artists baseball cards 2021, gallery private issue baseball cards 2021, master strokes baseball cards 2021, collectible art baseball cards 2021, colorful baseball parallels 2021, Topps Gallery parallels 2021, premium retail baseball cards 2021, Topps Gallery Baseball checklist 2021, Gallery checklist","cmurl":""},"count":2,"sha256":"091651c27aac7b208ae4e4b700d20bc36977f8a5dfa3def4667273ffe8b5c6a1"},{"source":"2021_topps_fire_baseball","target":"2021_topps_fire_baseball","meta":{"code":"2021_topps_fire_baseball","displayname":"2021 Topps Fire Baseball","year":"2021","sport":"baseball","manufacturer":"Topps","product":"Fire","keywords":"2021 Topps Fire Baseball, Topps Fire Baseball 2021, 2021 Topps Fire cards, Fire baseball cards 2021, 2021 Topps Fire MLB cards, colorful baseball cards Topps 2021, artistic baseball card designs 2021, Topps Fire rookie cards 2021, Jonathan India Fire rookie cards 2021, Jarred Kelenic Fire rookie cards 2021, Topps Fire autos 2021, Fire autographs baseball 2021, flame parallel baseball cards 2021, gold minted baseball cards 2021, collectible retail baseball cards 2021, foil baseball cards Topps 2021, modern baseball card artwork 2021, Topps Fire parallels 2021, Topps Fire Baseball checklist 2021, Fire checklist","cmurl":""},"count":2,"sha256":"7de41fd666c8dbf374d6d42167dfa3511ba4820ea9d02e992c963ae46bc14318"},{"source":"2022_topps_japan_edition_baseball","target":"2022_topps_baseball_japan_edition_baseball","meta":{"code":"2022_topps_baseball_japan_edition_baseball","displayname":"2022 Topps Japan Edition Baseball","year":"2022","sport":"baseball","manufacturer":"Topps","product":"Japan Edition","keywords":"2022 Topps Japan Edition Baseball, Topps Japan Edition Baseball 2022, 2022 Topps Japan cards, Japan Edition baseball cards 2022, 2022 Topps Japan MLB cards, Japanese baseball cards Topps 2022, Topps Japan Edition rookie cards 2022, Japan Edition rookies 2022, Shohei Ohtani Japan Edition cards 2022, Seiya Suzuki Japan Edition rookie cards 2022, Topps Japan Edition parallels 2022, cherry blossom parallels 2022, international baseball cards Topps 2022, Japanese exclusive baseball cards 2022, Topps Japan Edition inserts 2022, collectible Japanese baseball cards 2022, flagship baseball cards Topps 2022, Topps Japan Edition Baseball checklist 2022, Japan Edition checklist","cmurl":""},"count":3,"sha256":"23e87bbf96f4316847a72bc8dd4da753b3c67678fc79d48e732071cf6cd99ed3"},{"source":"2022_topps_allen_ginter_baseball","target":"2022_topps_allen_ginter_baseball","meta":{"code":"2022_topps_allen_ginter_baseball","displayname":"2022 Topps Allen & Ginter Baseball","year":"2022","sport":"baseball","manufacturer":"Topps","product":"Allen & Ginter","keywords":"2022 Topps Allen & Ginter Baseball, Topps Allen & Ginter Baseball 2022, 2022 Allen and Ginter cards, Allen & Ginter baseball cards 2022, 2022 Topps Allen & Ginter MLB cards, Topps Allen & Ginter rookie cards 2022, Allen & Ginter rookies 2022, Topps Allen & Ginter autos 2022, Allen & Ginter autographs baseball 2022, mini baseball cards Topps 2022, quirky baseball cards 2022, non sports cards Allen & Ginter 2022, celebrity cards Allen & Ginter 2022, relic cards Allen & Ginter 2022, rip cards Allen & Ginter 2022, Topps Allen & Ginter parallels 2022, collectible mini cards baseball 2022, vintage style baseball cards Topps 2022, Topps Allen & Ginter Baseball checklist 2022, Allen & Ginter checklist","cmurl":""},"count":10,"sha256":"fc1f291fa35ed2caf3961a759bf45e650dd0dabd76955a577f7adb74a7584b33"},{"source":"2021_topps_gold_label_baseball","target":"2021_topps_gold_label_baseball_card_checklsit","meta":{"code":"2021_topps_gold_label_baseball_card_checklsit","displayname":"2021 Topps Gold Label Baseball","year":"2021","sport":"baseball","manufacturer":"Topps","product":"Gold Label","keywords":"2021 Topps Gold Label Baseball, Topps Gold Label Baseball 2021, 2021 Topps Gold Label cards, Gold Label baseball cards 2021, 2021 Topps Gold Label MLB cards, premium baseball cards Topps 2021, class 1 class 2 class 3 baseball cards 2021, Topps Gold Label rookie cards 2021, Jonathan India Gold Label rookie cards 2021, Topps Gold Label autos 2021, Gold Label autographs baseball 2021, framed autograph baseball cards 2021, black parallel baseball cards 2021, collectible premium baseball cards 2021, gold framed baseball autographs 2021, luxury baseball cards Topps 2021, colorful foil baseball cards 2021, Topps Gold Label parallels 2021, Topps Gold Label Baseball checklist 2021, Gold Label checklist","cmurl":""},"count":6,"sha256":"8a367cff452ec937142ef95af754d8a1e2bcc642008dbf7312493adff677eb19"},{"source":"2018_topps_archives_baseball","target":"2018_Topps_Archives_Baseball","meta":{"code":"2018_Topps_Archives_Baseball","displayname":"2018 Topps Archives Baseball","year":"2018","sport":"baseball","manufacturer":"Topps","product":"Archives","keywords":"2018 Topps Archives Baseball, 2018 Topps Archives, 2018 Archives Baseball, 2018 Topps Archives cards, 2018 Archives baseball cards, 2018 Topps Archives rookies, 2018 Topps Archives rookie cards, Topps Archives Baseball 2018, Topps Archives 2018, Archives Baseball cards 2018, Archives Baseball, Topps Archives baseball cards, Archives inserts 2018, Archives parallels 2018, Topps Archives Baseball checklist, Archives checklist 2018","cmurl":""},"count":2,"sha256":"ae12dc163c6805fce0525a2f82a232cfb0ab5f747c3465a847da83b0d70c8041"},{"source":"2022_topps_allen_ginter_chrome_baseball","target":"2022_topps_allen_ginter_chrome_baseball","meta":{"code":"2022_topps_allen_ginter_chrome_baseball","displayname":"2022 Topps Allen & Ginter Chrome Baseball","year":"2022","sport":"baseball","manufacturer":"Topps","product":"Allen & Ginter Chrome","keywords":"2022 Topps Allen & Ginter Chrome Baseball, Topps Allen & Ginter Chrome Baseball 2022, 2022 Allen and Ginter Chrome cards, Allen & Ginter Chrome baseball cards 2022, 2022 Topps Allen & Ginter Chrome MLB cards, Topps Allen & Ginter Chrome hobby box 2022, Allen & Ginter Chrome rookie cards 2022, Topps Allen & Ginter Chrome rookies 2022, Allen & Ginter Chrome autos 2022, Allen & Ginter Chrome autographs baseball 2022, Topps Allen & Ginter Chrome parallels 2022, Allen & Ginter Chrome refractors 2022, chrome mini baseball cards 2022, quirky chrome baseball cards Topps 2022, non sports chrome cards Allen & Ginter 2022, Allen & Ginter Chrome inserts 2022, chromium baseball cards Topps 2022, Topps Allen & Ginter Chrome Baseball checklist 2022, Allen & Ginter Chrome checklist","cmurl":""},"count":7,"sha256":"2bda9338be9f599b5118e37c514e100d77d5bc21b06a4f532e6db4394f5d56a8"},{"source":"2021_topps_allen_ginter_chrome_baseball","target":"2021_topps_allen_ginter_chrome_baseball","meta":{"code":"2021_topps_allen_ginter_chrome_baseball","displayname":"2021 Topps Allen & Ginter Chrome Baseball","year":"2021","sport":"baseball","manufacturer":"Topps","product":"Allen & Ginter Chrome","keywords":"2021 Topps Allen & Ginter Chrome Baseball, Topps Allen & Ginter Chrome Baseball 2021, 2021 Topps Allen and Ginter Chrome cards, Allen and Ginter Chrome baseball cards 2021, 2021 Topps Allen & Ginter Chrome MLB cards, chrome vintage baseball cards 2021, retro chrome baseball cards Topps 2021, Topps Allen & Ginter Chrome rookie cards 2021, Jonathan India Allen & Ginter Chrome rookie cards 2021, Topps Allen & Ginter Chrome autos 2021, Allen & Ginter Chrome autographs baseball 2021, refractor baseball cards Topps 2021, mini chrome baseball cards 2021, x-fractor baseball cards 2021, collectible chrome baseball cards 2021, quirky baseball inserts 2021, Topps Allen & Ginter Chrome parallels 2021, collectible retro chrome baseball cards 2021, Topps Allen & Ginter Chrome Baseball checklist 2021, Allen & Ginter Chrome checklist","cmurl":""},"count":1,"sha256":"97e894cb687d178c1459e1be244497b136b5dbd1943e88b9c724e934d1ab6e62"},{"source":"2022_topps_tribute_baseball","target":"2022_topps_tribute_baseball","meta":{"code":"2022_topps_tribute_baseball","displayname":"2022 Topps Tribute Baseball","year":"2022","sport":"baseball","manufacturer":"Topps","product":"Tribute","keywords":"2022 Topps Tribute Baseball, Topps Tribute Baseball 2022, 2022 Topps Tribute cards, Tribute baseball cards 2022, 2022 Topps Tribute MLB cards, Topps Tribute rookie cards 2022, Tribute rookies baseball 2022, Topps Tribute autos 2022, Tribute autographs baseball 2022, Topps Tribute patch autos 2022, premium baseball cards Topps 2022, luxury baseball cards Topps 2022, high end baseball cards Topps 2022, collectible memorabilia baseball cards 2022, jumbo patch baseball cards 2022, framed autograph baseball cards 2022, Topps Tribute parallels 2022, Topps Tribute inserts 2022, Topps Tribute Baseball checklist 2022, Tribute checklist","cmurl":""},"count":1,"sha256":"99dd31507f53550a7096f2e4e73a9aff7616d6404fa9e778661dd8d0b1e8e66a"},{"source":"2020_topps_tribute_baseball","target":"2020_topps_tribute_baseball","meta":{"code":"2020_topps_tribute_baseball","displayname":"2020 Topps Tribute Baseball","year":"2020","sport":"baseball","manufacturer":"Topps","product":"Tribute","keywords":"2020 Topps Tribute Baseball, Topps Tribute Baseball 2020, 2020 Topps Tribute cards, Tribute baseball cards 2020, 2020 Topps Tribute MLB cards, premium baseball cards Topps 2020, luxury memorabilia baseball cards 2020, Topps Tribute rookie cards 2020, Luis Robert Tribute rookie cards 2020, Topps Tribute autos 2020, Tribute autographs baseball 2020, Topps Tribute patch autos 2020, tribute to the past baseball cards 2020, dual relic baseball cards 2020, collectible high end baseball cards 2020, premium autograph baseball cards 2020, Topps Tribute parallels 2020, framed autograph baseball cards 2020, Topps Tribute Baseball checklist 2020, Tribute checklist","cmurl":""},"count":1,"sha256":"66b2bb0727f277e53f7d811fd8dd9354123936e81dadb9d0ed688c6a83761cde"},{"source":"2021_topps_tribute_baseball","target":"2021_topps_tribute_baseball","meta":{"code":"2021_topps_tribute_baseball","displayname":"2021 Topps Tribute Baseball","year":"2021","sport":"baseball","manufacturer":"Topps","product":"Tribute","keywords":"2021 Topps Tribute Baseball, Topps Tribute Baseball 2021, 2021 Topps Tribute cards, Tribute baseball cards 2021, 2021 Topps Tribute MLB cards, luxury baseball cards Topps 2021, premium memorabilia baseball cards 2021, Topps Tribute rookie cards 2021, Jonathan India Tribute rookie cards 2021, Topps Tribute autos 2021, Tribute autographs baseball 2021, tribute to the stars baseball cards 2021, jumbo patch baseball cards 2021, stamp of approval baseball cards 2021, tribute dual relic baseball cards 2021, collectible high end baseball cards 2021, premium patch autograph baseball cards 2021, Topps Tribute parallels 2021, Topps Tribute Baseball checklist 2021, Tribute checklist","cmurl":""},"count":1,"sha256":"49ba3acc4d33f31c82e1d4392c5bedb30df80fd310eab98d5e4afd56af2e3d30"},{"source":"2019_topps_tribute_baseball","target":"2019_Topps_Tribute_Baseball","meta":{"code":"2019_Topps_Tribute_Baseball","displayname":"2019 Topps Tribute Baseball","year":"2019","sport":"baseball","manufacturer":"Topps","product":"Tribute","keywords":"2019 Topps Tribute Baseball, Topps Tribute Baseball 2019, 2019 Topps Tribute cards, Tribute baseball cards 2019, 2019 Topps Tribute MLB cards, luxury baseball cards Topps 2019, premium memorabilia baseball cards 2019, Topps Tribute rookie cards 2019, Fernando Tatis Jr Tribute rookie cards 2019, Vladimir Guerrero Jr Tribute rookie cards 2019, Pete Alonso Tribute rookie cards 2019, Eloy Jimenez Tribute rookie cards 2019, Topps Tribute autos 2019, Tribute autographs baseball 2019, tribute to the stars baseball cards 2019, jumbo patch baseball cards 2019, stamp of approval baseball cards 2019, collectible high end baseball cards 2019, Topps Tribute Baseball checklist 2019, Tribute checklist","cmurl":""},"count":1,"sha256":"92e4a7a9d8bd0166e040546df603bd5769e4c7bc0f205807095e7c59b78e1e3c"},{"source":"2018_topps_tribute_baseball","target":"2018_Topps_Tribute_Baseball","meta":{"code":"2018_Topps_Tribute_Baseball","displayname":"2018 Topps Tribute Baseball","year":"2018","sport":"baseball","manufacturer":"Topps","product":"Tribute","keywords":"2018 Topps Tribute Baseball, 2018 Topps Tribute, 2018 Tribute Baseball, 2018 Tribute, 2018 Topps Tribute cards, 2018 Tribute baseball cards, 2018 Topps Tribute autos, 2018 Tribute autographs, Topps Tribute Baseball 2018, Topps Tribute 2018, Tribute Baseball cards 2018, Tribute Baseball, Topps Tribute baseball cards, Tribute relic cards 2018, Tribute patch autos 2018, Topps Tribute Baseball checklist, Tribute checklist 2018","cmurl":""},"count":1,"sha256":"0221ac8e15cea2b72ecf57d7bef9a8fee9a26587dbb8f05a2f9a37b7cf41fb31"},{"source":"2021_topps_bowman_inception_baseball","target":"2021_bowman_inception_baseball","meta":{"code":"2021_bowman_inception_baseball","displayname":"2021 Bowman Inception Baseball","year":"2021","sport":"baseball","manufacturer":"Bowman","product":"Inception","keywords":"2021 Bowman Inception Baseball, Bowman Inception Baseball 2021, 2021 Bowman Inception cards, Bowman Inception baseball cards 2021, 2021 Bowman Inception MLB cards, premium prospect baseball cards 2021, colorful prospect baseball cards 2021, Bowman Inception rookie cards 2021, Wander Franco Bowman Inception cards 2021, Julio Rodriguez Bowman Inception cards 2021, top MLB prospect cards 2021, Bowman Inception autos 2021, Bowman Inception autographs 2021, prospect patch autograph baseball cards 2021, chromium prospect baseball cards 2021, collectible prospect autograph cards 2021, futuristic baseball card designs 2021, Bowman Inception parallels 2021, Bowman Inception Baseball checklist 2021, Bowman Inception checklist","cmurl":""},"count":1,"sha256":"053bd12ffe5f0a7f53e452b77830aa973be9c0e97d51ab3ef01c2d728add1992"},{"source":"2017_topps_tribute_baseball","target":"2017_Topps_Tribute_Baseball","meta":{"code":"2017_Topps_Tribute_Baseball","displayname":"2017 Topps Tribute Baseball","year":"2017","sport":"baseball","manufacturer":"Topps","product":"Tribute","keywords":"2017 Topps Tribute Baseball","cmurl":""},"count":1,"sha256":"1867c18d0fa7302be7e6da92503bce3896a825de345e59eb788f236fb1f9d693"},{"source":"2022_topps_finest_flashbacks_baseball","target":"2022_topps_finest_flashbacks_baseball","meta":{"code":"2022_topps_finest_flashbacks_baseball","displayname":"2022 Topps Finest Flashbacks Baseball","year":"2022","sport":"baseball","manufacturer":"Topps","product":"Finest Flashbacks","keywords":"2022 Topps Finest Flashbacks Baseball, Topps Finest Flashbacks Baseball 2022, 2022 Topps Finest Flashbacks cards, Finest Flashbacks baseball cards 2022, 2022 Topps Finest Flashbacks MLB cards, retro chrome baseball cards 2022, vintage Finest baseball cards Topps 2022, Topps Finest Flashbacks rookie cards 2022, Finest Flashbacks rookies baseball 2022, Topps Finest Flashbacks autos 2022, Finest Flashbacks autographs baseball 2022, chromium baseball cards Topps 2022, refractor baseball cards Topps 2022, nostalgic baseball cards Topps 2022, retro style chrome baseball cards 2022, Topps Finest Flashbacks parallels 2022, collectible retro baseball cards 2022, Topps Finest Flashbacks Baseball checklist 2022, Finest Flashbacks checklist","cmurl":""},"count":1,"sha256":"c23cad3a95bef3e2f012a43ece375e6db07b054f25a921341b1a652ddbe1960e"},{"source":"2022_topps_topps_allen_ginter_x_baseball","target":"2022_topps_allen_ginter_x_baseball","meta":{"code":"2022_topps_allen_ginter_x_baseball","displayname":"2022 Topps Allen & Ginter X Baseball","year":"2022","sport":"baseball","manufacturer":"Topps","product":"Allen & Ginter X","keywords":"2022 Topps Allen & Ginter X Baseball, Topps Allen & Ginter X Baseball 2022, 2022 Allen and Ginter X cards, Allen & Ginter X baseball cards 2022, 2022 Topps Allen & Ginter X MLB cards, black border baseball cards Topps 2022, Topps Allen & Ginter X rookie cards 2022, Allen & Ginter X rookies 2022, Topps Allen & Ginter X autos 2022, Allen & Ginter X autographs baseball 2022, online exclusive baseball cards Topps 2022, mini baseball cards Topps 2022, quirky baseball cards 2022, non sports baseball cards Topps 2022, Topps Allen & Ginter X parallels 2022, collectible mini cards baseball 2022, dark themed baseball cards Topps 2022, Topps Allen & Ginter X Baseball checklist 2022, Allen & Ginter X checklist","cmurl":""},"count":1,"sha256":"c79c23a16c2e5e36b0fd3b38d95e20f86c63f5a3ddf93ca43eb2a397406b7e05"},{"source":"2022_topps_topps_archives_snapshots_baseball","target":"2022_topps_archives_snapshots_baseball","meta":{"code":"2022_topps_archives_snapshots_baseball","displayname":"2022 Topps Archives Snapshots Baseball","year":"2022","sport":"baseball","manufacturer":"Topps","product":"Archives Snapshots","keywords":"2022 Topps Archives Snapshots Baseball, Topps Archives Snapshots Baseball 2022, 2022 Topps Archives Snapshots cards, Archives Snapshots baseball cards 2022, 2022 Topps Snapshots MLB cards, Topps online exclusive baseball cards 2022, Archives Snapshots rookie cards 2022, Topps Archives Snapshots rookies 2022, Topps Archives Snapshots autos 2022, Snapshots autographs baseball 2022, black and white baseball cards Topps 2022, artistic baseball photography cards 2022, retro photography baseball cards 2022, Topps Archives Snapshots parallels 2022, premium photography baseball cards 2022, collectible baseball photo cards 2022, Archives Snapshots inserts 2022, Topps Archives Snapshots Baseball checklist 2022, Archives Snapshots checklist","cmurl":""},"count":1,"sha256":"c41f416b1be7d72b4ac6e65d7cea175ac81b64292e09728b089b1a637a88935e"},{"source":"2022_topps_topps_black_white_baseball","target":"2022_topps_black_white_baseball","meta":{"code":"2022_topps_black_white_baseball","displayname":"2022 Topps Black & White Baseball","year":"2022","sport":"baseball","manufacturer":"Topps","product":"Black & White","keywords":"2022 Topps Black & White Baseball, Topps Black & White Baseball 2022, 2022 Topps Black and White cards, Black & White baseball cards 2022, 2022 Topps Black & White MLB cards, monochrome baseball cards Topps 2022, artistic baseball photography cards 2022, Topps Black & White rookie cards 2022, Black & White rookies baseball 2022, Topps Black & White autos 2022, Black & White autographs baseball 2022, online exclusive baseball cards Topps 2022, premium photography baseball cards 2022, collectible black and white baseball cards 2022, limited edition baseball cards Topps 2022, Topps Black & White parallels 2022, modern art baseball cards 2022, Topps Black & White Baseball checklist 2022, Black & White checklist","cmurl":""},"count":1,"sha256":"df7b40e77623d043be9476823a7ccf2406b2d4a1407f4145c218db458e40b91c"},{"source":"2022_topps_topps_clearly_authentic_baseball","target":"2022_topps_clearly_authentic_baseball","meta":{"code":"2022_topps_clearly_authentic_baseball","displayname":"2022 Topps Clearly Authentic Baseball","year":"2022","sport":"baseball","manufacturer":"Topps","product":"Clearly Authentic","keywords":"2022 Topps Clearly Authentic Baseball, Topps Clearly Authentic Baseball 2022, 2022 Topps Clearly Authentic cards, Clearly Authentic baseball cards 2022, 2022 Topps Clearly Authentic MLB cards, acetate baseball cards Topps 2022, clear baseball cards 2022, Topps Clearly Authentic rookie cards 2022, Clearly Authentic rookies baseball 2022, Topps Clearly Authentic autos 2022, Clearly Authentic autographs baseball 2022, encased autograph baseball cards 2022, premium autograph baseball cards Topps 2022, one hit baseball cards Topps 2022, luxury baseball cards Topps 2022, collectible acetate baseball cards 2022, Topps Clearly Authentic parallels 2022, Topps Clearly Authentic Baseball checklist 2022, Clearly Authentic checklist","cmurl":""},"count":1,"sha256":"ad2b64ee3ee8a25a7534a9a23b8421010bee7ae9b9ee542b948199a87bb61905"},{"source":"2022_topps_topps_five_star_baseball","target":"2022_topps_five_star_baseball","meta":{"code":"2022_topps_five_star_baseball","displayname":"2022 Topps Five Star Baseball","year":"2022","sport":"baseball","manufacturer":"Topps","product":"Five Star","keywords":"2022 Topps Five Star Baseball, Topps Five Star Baseball 2022, 2022 Topps Five Star cards, Five Star baseball cards 2022, 2022 Topps Five Star MLB cards, Topps Five Star hobby box 2022, Five Star rookie cards 2022, Topps Five Star rookies 2022, Topps Five Star autos 2022, Five Star autographs baseball 2022, Topps Five Star patch autos 2022, premium autograph baseball cards 2022, luxury baseball cards Topps 2022, high end baseball cards Topps 2022, silver signature baseball cards 2022, one of one autograph baseball cards 2022, Topps Five Star inserts 2022, collectible framed autos baseball 2022, Topps Five Star Baseball checklist 2022, Five Star checklist","cmurl":""},"count":1,"sha256":"66b8829d737650d40512547d595c7c54156f8a2f4e9d3331632732fc498b84b3"},{"source":"2022_topps_topps_museum_collection_baseball","target":"2022_topps_museum_collection_baseball","meta":{"code":"2022_topps_museum_collection_baseball","displayname":"2022 Topps Museum Collection Baseball","year":"2022","sport":"baseball","manufacturer":"Topps","product":"Museum Collection","keywords":"2022 Topps Museum Collection Baseball, Topps Museum Collection Baseball 2022, 2022 Topps Museum Collection cards, Museum Collection baseball cards 2022, 2022 Topps Museum MLB cards, Topps Museum Collection rookie cards 2022, Museum Collection rookies baseball 2022, Topps Museum Collection autos 2022, Museum Collection autographs baseball 2022, Topps Museum Collection patch autos 2022, jumbo patch baseball cards 2022, premium baseball cards Topps 2022, luxury baseball cards Topps 2022, high end baseball cards Topps 2022, framed autograph baseball cards 2022, collectible memorabilia baseball cards 2022, Topps Museum Collection parallels 2022, Topps Museum Collection inserts 2022, Topps Museum Collection Baseball checklist 2022, Museum Collection checklist","cmurl":""},"count":1,"sha256":"3caed545f4750f4305aeca05acbcc7b4a161c40f2c2213f854ec7d3404e6edf4"},{"source":"2022_topps_topps_opening_day_baseball","target":"2022_topps_opening_day_baseball","meta":{"code":"2022_topps_opening_day_baseball","displayname":"2022 Topps Opening Day Baseball","year":"2022","sport":"baseball","manufacturer":"Topps","product":"Opening Day","keywords":"2022 Topps Opening Day Baseball, Topps Opening Day Baseball 2022, 2022 Topps Opening Day cards, Opening Day baseball cards 2022, 2022 Topps Opening Day MLB cards, Topps Opening Day rookie cards 2022, Opening Day rookies baseball 2022, affordable baseball cards Topps 2022, mascot baseball cards 2022, family friendly baseball cards 2022, Topps Opening Day inserts 2022, Opening Day autographs baseball 2022, stadium themed baseball cards 2022, collectible mascot cards 2022, entry level baseball cards 2022, fun baseball inserts Topps 2022, Topps Opening Day parallels 2022, collectible MLB baseball cards 2022, Topps Opening Day Baseball checklist 2022, Opening Day checklist","cmurl":""},"count":1,"sha256":"45484e7430dc772af80df7c08fdaf92f3748cc0a97e46ef8af5130e48e0a8ca6"},{"source":"2022_topps_topps_triple_threads_baseball","target":"2022_topps_triple_threads_baseball","meta":{"code":"2022_topps_triple_threads_baseball","displayname":"2022 Topps Triple Threads Baseball","year":"2022","sport":"baseball","manufacturer":"Topps","product":"Triple Threads","keywords":"2022 Topps Triple Threads Baseball, Topps Triple Threads Baseball 2022, 2022 Topps Triple Threads cards, Triple Threads baseball cards 2022, 2022 Topps Triple Threads MLB cards, Topps Triple Threads hobby box 2022, Triple Threads rookie cards 2022, Topps Triple Threads rookies 2022, Topps Triple Threads autos 2022, Triple Threads autographs baseball 2022, Topps Triple Threads patch autos 2022, relic autograph baseball cards 2022, jumbo patch baseball cards 2022, luxury baseball cards Topps 2022, high end baseball cards Topps 2022, booklet baseball cards 2022, Topps Triple Threads parallels 2022, collectible memorabilia baseball cards 2022, Topps Triple Threads Baseball checklist 2022, Triple Threads checklist","cmurl":""},"count":1,"sha256":"3e79bf3ce594c493a55629e7959439ddf013b5975873a5bec62b08014d77a287"},{"source":"2021_topps_stadium_club_baseball","target":"2021_topps_stadium_club_baseball","meta":{"code":"2021_topps_stadium_club_baseball","displayname":"2021 Topps Stadium Club Baseball","year":"2021","sport":"baseball","manufacturer":"Topps","product":"Stadium Club","keywords":"2021 Topps Stadium Club Baseball, Topps Stadium Club Baseball 2021, 2021 Topps Stadium Club cards, Stadium Club baseball cards 2021, 2021 Topps Stadium Club MLB cards, photography baseball cards Topps 2021, premium photo baseball cards 2021, Topps Stadium Club rookie cards 2021, Jonathan India Stadium Club rookie cards 2021, Topps Stadium Club autos 2021, Stadium Club autographs baseball 2021, chrome style photography baseball cards 2021, stadium club beam team cards 2021, stadium club instavision cards 2021, collectible baseball photography cards 2021, black foil baseball cards 2021, Topps Stadium Club parallels 2021, artistic baseball photography cards 2021, Topps Stadium Club Baseball checklist 2021, Stadium Club checklist","cmurl":""},"count":7,"sha256":"7f08614c6381e13571e6f9a00d1640733c73ec98231b05e6356c0f67829a8212"},{"source":"2021_topps_stadium_club_chrome_baseball","target":"2021_topps_stadium_club_chrome_baseball","meta":{"code":"2021_topps_stadium_club_chrome_baseball","displayname":"2021 Topps Stadium Club Chrome Baseball","year":"2021","sport":"baseball","manufacturer":"Topps","product":"Stadium Club Chrome","keywords":"2021 Topps Stadium Club Chrome Baseball, Topps Stadium Club Chrome Baseball 2021, 2021 Topps Stadium Club Chrome cards, Stadium Club Chrome baseball cards 2021, 2021 Topps Stadium Club Chrome MLB cards, chrome photography baseball cards 2021, premium chrome baseball cards Topps 2021, Topps Stadium Club Chrome rookie cards 2021, Jonathan India Stadium Club Chrome rookie cards 2021, Topps Stadium Club Chrome autos 2021, Stadium Club Chrome autographs baseball 2021, refractor baseball cards Topps 2021, beam team chrome baseball cards 2021, superfractor baseball cards 2021, collectible chromium baseball cards 2021, premium baseball photography cards 2021, Topps Stadium Club Chrome parallels 2021, artistic chrome baseball cards 2021, Topps Stadium Club Chrome Baseball checklist 2021, Stadium Club Chrome checklist","cmurl":""},"count":1,"sha256":"b16c898eb40421494f1005d7f4903b2fa8440c22fae6e65a0a058432ef54e4b9"},{"source":"2020_topps_stadium_club_chrome_baseball","target":"2020_topps_stadium_club_chrome_baseball","meta":{"code":"2020_topps_stadium_club_chrome_baseball","displayname":"2020 Topps Stadium Club Chrome Baseball","year":"2020","sport":"baseball","manufacturer":"Topps","product":"Stadium Club Chrome","keywords":"2020 Topps Stadium Club Chrome Baseball, Topps Stadium Club Chrome Baseball 2020, 2020 Topps Stadium Club Chrome cards, Stadium Club Chrome baseball cards 2020, 2020 Topps Stadium Club Chrome MLB cards, chrome photography baseball cards 2020, premium baseball photography cards 2020, Topps Stadium Club Chrome rookie cards 2020, Luis Robert Stadium Club Chrome rookie cards 2020, Topps Stadium Club Chrome autos 2020, Stadium Club Chrome autographs baseball 2020, refractor baseball cards Topps 2020, chromium baseball cards Topps 2020, collectible chrome baseball cards 2020, artistic baseball photography cards 2020, Topps Stadium Club Chrome parallels 2020, beam team chrome baseball cards 2020, Topps Stadium Club Chrome Baseball checklist 2020, Stadium Club Chrome checklist","cmurl":""},"count":1,"sha256":"2bfac3567a7c76ffb598d793d525588e87d40950bb1b9829d50d31ae65619cbe"},{"source":"2023_topps_musuem_collection_baseball","target":"2023_topps_museum_collection_baseball","meta":{"code":"2023_topps_museum_collection_baseball","displayname":"2023 Topps Museum Collection baseball","year":"2023","sport":"baseball","manufacturer":"Topps","product":"Museum Collection","keywords":"2023 Topps Museum Collection Baseball, Topps Museum Collection Baseball 2023, 2023 Topps Museum Collection cards, Museum Collection baseball cards 2023, 2023 Topps Museum Collection MLB cards, Topps Museum Collection hobby box 2023, Museum Collection rookie cards 2023, Topps Museum Collection rookies 2023, Topps Museum Collection autos 2023, Museum Collection autographs baseball 2023, Topps Museum Collection patch autos 2023, Museum Collection relic cards 2023, framed autograph cards Topps 2023, Topps Museum Collection parallels 2023, premium baseball cards Topps 2023, high end baseball cards Topps 2023, Topps Museum Collection inserts 2023, luxury baseball cards Topps 2023, Topps Museum Collection Baseball checklist 2023, Museum Collection checklist","cmurl":""},"count":1,"sha256":"19a76307f30f41d77b1cbb35b7aafb3d58ed8ae869f4e9da6e3a236bb499fed7"},{"source":"2025_donruss_wnba_basketball","target":"2025_Donruss_WNBA_basketball","meta":{"code":"2025_Donruss_WNBA_basketball","displayname":"2025 Donruss WNBA Basketball","year":"2025","sport":"basketball","manufacturer":"Donruss","product":"WNBA","keywords":"2025 Donruss WNBA Basketball, 2025 Donruss WNBA, 2025 Donruss WNBA cards, 2025 Donruss Basketball WNBA, 25 Donruss WNBA Basketball, 25 Donruss WNBA, Donruss WNBA Basketball 2025, Donruss WNBA 2025, Donruss WNBA Basketball, Donruss WNBA, WNBA Donruss Basketball, WNBA Donruss, Panini Donruss WNBA Basketball, Panini Donruss WNBA, Donruss WNBA checklist, WNBA checklist, 2025 Donruss WNBA checklist, 2025 WNBA checklist","cmurl":""},"count":164,"sha256":"1bba3b06533f40910628afb32ca2e5b922f53db808d4fde55bb0ae660c0450ca"},{"source":"2025_panini_impeccable_wnba_basketball","target":"2025_Panini_Impeccable WNBA_basketball","meta":{"code":"2025_Panini_Impeccable WNBA_basketball","displayname":"2025 Panini Impeccable WNBA Basketball","year":"2025","sport":"basketball","manufacturer":"Panini","product":"Impeccable WNBA","keywords":"2025 Panini Impeccable WNBA Basketball, 2025 Panini Impeccable WNBA, 2025 Panini Impeccable WNBA cards, 2025 Impeccable WNBA Basketball, 2025 Impeccable WNBA, 25 Panini Impeccable WNBA Basketball, 25 Panini Impeccable WNBA, Panini Impeccable WNBA Basketball 2025, Panini Impeccable WNBA 2025, Panini Impeccable WNBA Basketball, Panini Impeccable WNBA, Impeccable WNBA Basketball, Impeccable WNBA, Panini Impeccable WNBA checklist, Impeccable WNBA checklist, 2025 Panini Impeccable WNBA checklist, 2025 Impeccable WNBA checklist","cmurl":""},"count":43,"sha256":"29c1316dc6ffe3dcc76f05f70066f249166371a3690d667bd6aacfdf42d32f2a"},{"source":"2025_panini_prizm_wnba_basketball","target":"2025_Panini_Prizm WNBA_basketball","meta":{"code":"2025_Panini_Prizm WNBA_basketball","displayname":"2025 Panini Prizm WNBA Basketball","year":"2025","sport":"basketball","manufacturer":"Panini","product":"Prizm WNBA","keywords":"2025 Panini Prizm WNBA Basketball, 2025 Panini Prizm WNBA, 2025 Panini Prizm WNBA cards, 2025 Prizm WNBA Basketball, 2025 Prizm WNBA, 25 Panini Prizm WNBA Basketball, 25 Panini Prizm WNBA, Panini Prizm WNBA Basketball 2025, Panini Prizm WNBA 2025, Panini Prizm WNBA Basketball, Panini Prizm WNBA, Prizm WNBA Basketball, Prizm WNBA, Panini Prizm WNBA checklist, Prizm WNBA checklist, 2025 Panini Prizm WNBA checklist, 2025 Prizm WNBA checklist","cmurl":""},"count":146,"sha256":"7646f7ef372347c8d5abdad8eace02d59af56287defe5d2a496597fa56296663"},{"source":"2025_26_panini_contenders_euroleague_basketball","target":"2025_26_panini_contenders_euroleague_basketball","meta":{"code":"2025_26_panini_contenders_euroleague_basketball","displayname":"2025-26 Panini Contenders EuroLeague Basketball","year":"2025-26","sport":"basketball","manufacturer":"Panini","product":"Contenders EuroLeague","keywords":"2025-26 Panini Contenders EuroLeague Basketball, 2025 26 Panini Contenders EuroLeague Basketball, 2025-26 Panini Contenders EuroLeague, 2025-26 Panini Contenders EuroLeague cards, 2025 Panini Contenders EuroLeague Basketball, 2026 Panini Contenders EuroLeague Basketball, 25-26 Panini Contenders EuroLeague Basketball, 25 26 Panini Contenders EuroLeague Basketball, Panini Contenders EuroLeague Basketball, Panini Contenders EuroLeague, Contenders EuroLeague Basketball, Contenders EuroLeague, EuroLeague Contenders Basketball, Panini Contenders EuroLeague checklist, Contenders EuroLeague checklist, EuroLeague checklist, 2025-26 Panini Contenders EuroLeague checklist, 2025 Panini Contenders EuroLeague checklist, 2026 Panini Contenders EuroLeague checklist","cmurl":""},"count":74,"sha256":"90df4969a23198ee0310243c34dd02a59b8b0225d10dbb2497a8462c61f7c2c2"},{"source":"2025_26_topps_holiday_basketball","target":"2025_26_topps_holiday_basketball","meta":{"code":"2025_26_topps_holiday_basketball","displayname":"2025-26 Topps Holiday Basketball","year":"2025-26","sport":"basketball","manufacturer":"Topps","product":"Holiday","keywords":"2025-26 Topps Holiday Basketball, 2025 Topps Holiday Basketball, 2026 Topps Holiday Basketball, Topps Holiday Basketball 2025-26, Topps Holiday Basketball 2025, Topps Holiday Basketball 2026, 2025-26 Topps Holiday cards, Topps Holiday basketball cards 2025, Topps Holiday basketball cards 2026, Holiday basketball cards 2025-26, Topps Holiday rookies basketball 2025-26, Topps Holiday rookie cards basketball 2025, Topps Holiday autos basketball 2025-26, Topps Holiday parallels basketball 2025-26, Topps Holiday inserts basketball 2025-26, Topps Holiday Basketball checklist 2025-26, Topps Holiday checklist","cmurl":""},"count":32,"sha256":"b610299a9693283497599a5cff514b47acc3999a7abacdff382b27588c3bb76b"},{"source":"2025_panini_select_wnba_basketball","target":"2025_panini_select_wnba_basketball","meta":{"code":"2025_panini_select_wnba_basketball","displayname":"2025 Panini Select WNBA Basketball","year":"2025","sport":"basketball","manufacturer":"Panini","product":"Select WNBA","keywords":"2025 Panini Select WNBA Basketball, 2025 Select WNBA Basketball, Panini Select WNBA Basketball 2025, Select WNBA Basketball 2025, 2025 Panini Select WNBA cards, Select WNBA basketball cards 2025, Panini Select WNBA cards 2025, Select WNBA hobby box 2025, Select WNBA retail 2025, Select WNBA rookies 2025, Select WNBA rookie cards 2025, Select WNBA autos 2025, Select WNBA autographs 2025, Select WNBA patch autos 2025, Select WNBA parallels 2025, Select WNBA prizm parallels 2025, Select WNBA inserts 2025, Panini Select WNBA Basketball checklist 2025, Select WNBA checklist","cmurl":""},"count":232,"sha256":"cd66bd8d4e3dd9400657094be7386e58634d0bf5656aa5e7baa6126e4579219f"},{"source":"1992_93_fleer_basketball","target":"1992_93_Fleer_Basketball","meta":{"code":"1992_93_Fleer_Basketball","displayname":"1992-93 Fleer Basketball","year":"1992-93","sport":"basketball","manufacturer":"Fleer","product":"Basketball","keywords":"1992-93 Fleer Basketball, 1992-93 Fleer Basketball checklist, 1992-93 Fleer Basketball cards, 1992-93 Fleer Basketball autographs","cmurl":""},"count":3,"sha256":"3779e03ec3078cb9cd485f8011d28de7e93414c78ebf5a28667903b152343b82"},{"source":"1992_93_hoops_basketball","target":"1992_93_Hoops_Basketball","meta":{"code":"1992_93_Hoops_Basketball","displayname":"1992-93 Hoops Basketball","year":"1992-93","sport":"basketball","manufacturer":"Hoops","product":"Basketball","keywords":"1992-93 Hoops Basketball, 1992-93 Hoops Basketball checklist, 1992-93 Hoops Basketball cards, 1992-93 Hoops Basketball autographs","cmurl":""},"count":2,"sha256":"5344b73ea35131a957470127ef6bf6a0c87b92c50b1d364248381aeae3b8d5e3"},{"source":"1992_93_skybox_basketball","target":"1992_93_Skybox_Basketball","meta":{"code":"1992_93_Skybox_Basketball","displayname":"1992-93 Skybox Basketball","year":"1992-93","sport":"basketball","manufacturer":"Skybox","product":"Basketball","keywords":"1992-93 Skybox Basketball, 1992-93 Skybox Basketball checklist, 1992-93 Skybox Basketball cards, 1992-93 Skybox Basketball autographs","cmurl":""},"count":1,"sha256":"4452fd8144e066acbb6cff1deb8ae5d88e209a262525d9a617942eef7b3cb07d"},{"source":"1993_94_fleer_basketball","target":"1993_94_Fleer_Basketball","meta":{"code":"1993_94_Fleer_Basketball","displayname":"1993-94 Fleer Basketball","year":"1993-94","sport":"basketball","manufacturer":"Fleer","product":"Basketball","keywords":"1993-94 Fleer Basketball, 1993-94 Fleer Basketball checklist, 1993-94 Fleer Basketball cards, 1993-94 Fleer Basketball autographs","cmurl":""},"count":1,"sha256":"93eb5e09326f09beadd081cc0d9cc78fc8dc7c6805923088024ead02701eca5b"},{"source":"1993_94_upper_deck_special_edition_basketball","target":"1993_94_Upper_Deck_Special_Edition_Basketball","meta":{"code":"1993_94_Upper_Deck_Special_Edition_Basketball","displayname":"1993-94 Upper Deck Special Edition Basketball","year":"1993-94","sport":"basketball","manufacturer":"Upper","product":"Deck Special Edition","keywords":"1993-94 Upper Deck Special Edition Basketball, 1993-94 Upper Deck Special Edition Basketball checklist, 1993-94 Upper Deck Special Edition Basketball cards, 1993-94 Upper Deck Special Edition Basketball autographs","cmurl":""},"count":2,"sha256":"1f9a1b659f437a7bbdc355db1eb0540c5aadc816421f4e24d8ee6dc9418d0cf8"},{"source":"1994_95_upper_deck_basketball","target":"1994_95_Upper_Deck_Basketball","meta":{"code":"1994_95_Upper_Deck_Basketball","displayname":"1994-95 Upper Deck Basketball","year":"1994-95","sport":"basketball","manufacturer":"Upper","product":"Deck","keywords":"1994-95 Upper Deck Basketball, 1994-95 Upper Deck Basketball checklist, 1994-95 Upper Deck Basketball cards, 1994-95 Upper Deck Basketball autographs","cmurl":""},"count":1,"sha256":"6a4efa4f3024654b5dbbc047232ec4f41fd6d8dc50418301a55c3d00b73e787f"},{"source":"1996_97_topps_chrome_basketball","target":"1996_97_Topps_Chrome_Basketball","meta":{"code":"1996_97_Topps_Chrome_Basketball","displayname":"1996-97 Topps Chrome Basketball","year":"1996-97","sport":"basketball","manufacturer":"Topps","product":"Chrome","keywords":"1996-97 Topps Chrome Basketball, 1996-97 Topps Chrome Basketball checklist, 1996-97 Topps Chrome Basketball cards, 1996-97 Topps Chrome Basketball autographs","cmurl":""},"count":6,"sha256":"09010e786e4050b04420f9876f15d85dddacf96aa97c036bb66e38682c08e142"},{"source":"1997_98_topps_chrome_basketball","target":"1997_98_Topps_Chrome_Basketball","meta":{"code":"1997_98_Topps_Chrome_Basketball","displayname":"1997-98 Topps Chrome Basketball","year":"1997-98","sport":"basketball","manufacturer":"Topps","product":"Chrome","keywords":"1997-98 Topps Chrome Basketball, 1997-98 Topps Chrome Basketball checklist, 1997-98 Topps Chrome Basketball cards, 1997-98 Topps Chrome Basketball autographs","cmurl":""},"count":8,"sha256":"39ee85a943ae6d808ce97438550ffe3b5f35a9544ea7605778a89cb30bf508bf"},{"source":"1998_99_skybox_premium_basketball","target":"1998_99_Skybox_Premium_Basketball","meta":{"code":"1998_99_Skybox_Premium_Basketball","displayname":"1998-99 Skybox Premium Basketball","year":"1998-99","sport":"basketball","manufacturer":"Skybox","product":"Premium","keywords":"1998-99 Skybox Premium Basketball, 1998-99 Skybox Premium Basketball checklist, 1998-99 Skybox Premium Basketball cards, 1998-99 Skybox Premium Basketball autographs","cmurl":""},"count":13,"sha256":"83d226f2067101106e9cd507c85f3b174530423001146039b8da77172c926351"},{"source":"1998_99_topps_chrome_basketball","target":"1998_99_Topps_Chrome_Basketball","meta":{"code":"1998_99_Topps_Chrome_Basketball","displayname":"1998-99 Topps Chrome Basketball","year":"1998-99","sport":"basketball","manufacturer":"Topps","product":"Chrome","keywords":"1998-99 Topps Chrome Basketball, 1998-99 Topps Chrome Basketball checklist, 1998-99 Topps Chrome Basketball cards, 1998-99 Topps Chrome Basketball autographs","cmurl":""},"count":12,"sha256":"3f3a35b9ae452c64d93c28245a1c043c055fbc96fb643e6abb1bb929ccc9393b"},{"source":"2003_04_topps_chrome_basketball","target":"2003_04_Topps_Chrome_Basketball","meta":{"code":"2003_04_Topps_Chrome_Basketball","displayname":"2003-04 Topps Chrome Basketball","year":"2003-04","sport":"basketball","manufacturer":"Topps","product":"Chrome","keywords":"2003-04 Topps Chrome Basketball, 2003-04 Topps Chrome Basketball checklist, 2003-04 Topps Chrome Basketball cards, 2003-04 Topps Chrome Basketball autographs","cmurl":""},"count":1,"sha256":"43fc970f8b6561c6fd3f91162dc4ae153b0b1a4d06ed77a6b9c201b5e1c9b43c"},{"source":"1998_99_fleer_brilliants_basketball","target":"1998_99_Fleer_Brilliants_Basketball","meta":{"code":"1998_99_Fleer_Brilliants_Basketball","displayname":"1998-99 Fleer Brilliants Basketball","year":"1998-99","sport":"basketball","manufacturer":"Fleer","product":"Brilliants","keywords":"1998-99 Fleer Brilliants Basketball, 1998-99 Fleer Brilliants Basketball checklist, 1998-99 Fleer Brilliants Basketball cards, 1998-99 Fleer Brilliants Basketball autographs","cmurl":""},"count":4,"sha256":"8f8d902deaa467761f7b48059becbba046470e11712daa7bf689045e64a9c1db"},{"source":"1998_99_metal_universe_basketball","target":"1998_99_Metal_Universe_Basketball","meta":{"code":"1998_99_Metal_Universe_Basketball","displayname":"1998-99 Metal Universe Basketball","year":"1998-99","sport":"basketball","manufacturer":"Metal","product":"Universe","keywords":"1998-99 Metal Universe Basketball, 1998-99 Metal Universe Basketball checklist, 1998-99 Metal Universe Basketball cards, 1998-99 Metal Universe Basketball autographs","cmurl":""},"count":6,"sha256":"0cfe21081e5165883d3e357ce51b7e9c32845d40faf312d6c25f689a441aad37"},{"source":"1998_99_skybox_thunder_basketball","target":"1998_99_Skybox_Thunder_Basketball","meta":{"code":"1998_99_Skybox_Thunder_Basketball","displayname":"1998-99 Skybox Thunder Basketball","year":"1998-99","sport":"basketball","manufacturer":"Skybox","product":"Thunder","keywords":"1998-99 Skybox Thunder Basketball, 1998-99 Skybox Thunder Basketball checklist, 1998-99 Skybox Thunder Basketball cards, 1998-99 Skybox Thunder Basketball autographs","cmurl":""},"count":6,"sha256":"b3a2448e4a831376ea78b156b56df89213ddcac17e6e1a8a1bfdbc93ddd2f8c2"},{"source":"1998_99_sp_authentic_basketball","target":"1998_99_Sp_Authentic_Basketball","meta":{"code":"1998_99_Sp_Authentic_Basketball","displayname":"1998-99 Sp Authentic Basketball","year":"1998-99","sport":"basketball","manufacturer":"Sp","product":"Authentic","keywords":"1998-99 Sp Authentic Basketball, 1998-99 Sp Authentic Basketball checklist, 1998-99 Sp Authentic Basketball cards, 1998-99 Sp Authentic Basketball autographs","cmurl":""},"count":7,"sha256":"e458871cd8f5e2f0885d729b00029c38d7918871da6ceca2b5d65ff0a5ba1516"},{"source":"1998_99_topps_basketball","target":"1998_99_Topps_Basketball","meta":{"code":"1998_99_Topps_Basketball","displayname":"1998-99 Topps Basketball","year":"1998-99","sport":"basketball","manufacturer":"Topps","product":"Basketball","keywords":"1998-99 Topps Basketball, 1998-99 Topps Basketball checklist, 1998-99 Topps Basketball cards, 1998-99 Topps Basketball autographs","cmurl":""},"count":20,"sha256":"93f2386dc8951ede1c15c8f9d49e9b7c918cc569c71d48f71274ee88e3cc5fdb"},{"source":"1998_99_upper_deck_basketball","target":"1998_99_Upper_Deck_Basketball","meta":{"code":"1998_99_Upper_Deck_Basketball","displayname":"1998-99 Upper Deck Basketball","year":"1998-99","sport":"basketball","manufacturer":"Upper","product":"Deck","keywords":"1998-99 Upper Deck Basketball, 1998-99 Upper Deck Basketball checklist, 1998-99 Upper Deck Basketball cards, 1998-99 Upper Deck Basketball autographs","cmurl":""},"count":9,"sha256":"b83d52c19bd867e87ad90e4e2a8c2852adfeacffd86ee9284d824e5f83307404"},{"source":"1998_99_upper_deck_century_legends_basketball","target":"1998_99_Upper_Deck_Century_Legends_Basketball","meta":{"code":"1998_99_Upper_Deck_Century_Legends_Basketball","displayname":"1998-99 Upper Deck Century Legends Basketball","year":"1998-99","sport":"basketball","manufacturer":"Upper","product":"Deck Century Legends","keywords":"1998-99 Upper Deck Century Legends Basketball, 1998-99 Upper Deck Century Legends Basketball checklist, 1998-99 Upper Deck Century Legends Basketball cards, 1998-99 Upper Deck Century Legends Basketball autographs","cmurl":""},"count":6,"sha256":"e6ea243068dc815179f0a90e602bc900881f79330227edfc4baafc29efae9555"},{"source":"1998_99_upper_deck_encore_basketball","target":"1998_99_Upper_Deck_Encore_Basketball","meta":{"code":"1998_99_Upper_Deck_Encore_Basketball","displayname":"1998-99 Upper Deck Encore Basketball","year":"1998-99","sport":"basketball","manufacturer":"Upper","product":"Deck Encore","keywords":"1998-99 Upper Deck Encore Basketball, 1998-99 Upper Deck Encore Basketball checklist, 1998-99 Upper Deck Encore Basketball cards, 1998-99 Upper Deck Encore Basketball autographs","cmurl":""},"count":5,"sha256":"560f246e46e77d3b7410080fdac79d0854026d756791a3dbdb37ffa127d441b4"},{"source":"1998_99_upper_deck_ionix_basketball","target":"1998_99_Upper_Deck_Ionix_Basketball","meta":{"code":"1998_99_Upper_Deck_Ionix_Basketball","displayname":"1998-99 Upper Deck Ionix Basketball","year":"1998-99","sport":"basketball","manufacturer":"Upper","product":"Deck Ionix","keywords":"1998-99 Upper Deck Ionix Basketball, 1998-99 Upper Deck Ionix Basketball checklist, 1998-99 Upper Deck Ionix Basketball cards, 1998-99 Upper Deck Ionix Basketball autographs","cmurl":""},"count":6,"sha256":"d170c942449874184a6362a50a582fb44e78bbfd521a25afb29a907aedd7e1ac"},{"source":"1998_99_upper_deck_ovation_basketball","target":"1998_99_Upper_Deck_Ovation_Basketball","meta":{"code":"1998_99_Upper_Deck_Ovation_Basketball","displayname":"1998-99 Upper Deck Ovation Basketball","year":"1998-99","sport":"basketball","manufacturer":"Upper","product":"Deck Ovation","keywords":"1998-99 Upper Deck Ovation Basketball, 1998-99 Upper Deck Ovation Basketball checklist, 1998-99 Upper Deck Ovation Basketball cards, 1998-99 Upper Deck Ovation Basketball autographs","cmurl":""},"count":4,"sha256":"2488a25a882626947aeeb8c767b3a96f58f81ffeb1b02f990e254fbe965570c3"},{"source":"1997_98_flair_showcase_basketball","target":"1997_98_Flair_Showcase_Basketball","meta":{"code":"1997_98_Flair_Showcase_Basketball","displayname":"1997-98 Flair Showcase Basketball","year":"1997-98","sport":"basketball","manufacturer":"Flair","product":"Showcase","keywords":"1997-98 Flair Showcase Basketball, 1997-98 Flair Showcase Basketball checklist, 1997-98 Flair Showcase Basketball cards, 1997-98 Flair Showcase Basketball autographs","cmurl":""},"count":1,"sha256":"e781d93844765fc59a4268a8656c4a58e5c2cf0078b1ad0fcd9606c44a366a3f"},{"source":"1997_98_fleer_basketball","target":"1997_98_Fleer_Basketball","meta":{"code":"1997_98_Fleer_Basketball","displayname":"1997-98 Fleer Basketball","year":"1997-98","sport":"basketball","manufacturer":"Fleer","product":"Basketball","keywords":"1997-98 Fleer Basketball, 1997-98 Fleer Basketball checklist, 1997-98 Fleer Basketball cards, 1997-98 Fleer Basketball autographs","cmurl":""},"count":19,"sha256":"29d42cc85c1646772848ced7588f33766ae9cd842539df2f7130afbee4e9f508"},{"source":"1997_98_metal_universe_basketball","target":"1997_98_Metal_Universe_Basketball","meta":{"code":"1997_98_Metal_Universe_Basketball","displayname":"1997-98 Metal Universe Basketball","year":"1997-98","sport":"basketball","manufacturer":"Metal","product":"Universe","keywords":"1997-98 Metal Universe Basketball, 1997-98 Metal Universe Basketball checklist, 1997-98 Metal Universe Basketball cards, 1997-98 Metal Universe Basketball autographs","cmurl":""},"count":9,"sha256":"aef126bb0aabce9802cc3074975d9e159fd7109f34da28f318a9def368b71894"},{"source":"1997_98_metal_universe_championship_basketball","target":"1997_98_Metal_Universe_Championship_Basketball","meta":{"code":"1997_98_Metal_Universe_Championship_Basketball","displayname":"1997-98 Metal Universe Championship Basketball","year":"1997-98","sport":"basketball","manufacturer":"Metal","product":"Universe Championship","keywords":"1997-98 Metal Universe Championship Basketball, 1997-98 Metal Universe Championship Basketball checklist, 1997-98 Metal Universe Championship Basketball cards, 1997-98 Metal Universe Championship Basketball autographs","cmurl":""},"count":5,"sha256":"06b7a7186c4d15eabd5d45ae4d15f26c8faf1c0be9a2da838f47351405cc8347"},{"source":"1997_98_skybox_premium_basketball","target":"1997_98_Skybox_Premium_Basketball","meta":{"code":"1997_98_Skybox_Premium_Basketball","displayname":"1997-98 Skybox Premium Basketball","year":"1997-98","sport":"basketball","manufacturer":"Skybox","product":"Premium","keywords":"1997-98 Skybox Premium Basketball, 1997-98 Skybox Premium Basketball checklist, 1997-98 Skybox Premium Basketball cards, 1997-98 Skybox Premium Basketball autographs","cmurl":""},"count":12,"sha256":"97fc35114d3789081f8260c95dbef8473dea8a0927b5d0ff0c02c48b4bf6c320"},{"source":"1997_98_sp_authentic_basketball","target":"1997_98_Sp_Authentic_Basketball","meta":{"code":"1997_98_Sp_Authentic_Basketball","displayname":"1997-98 Sp Authentic Basketball","year":"1997-98","sport":"basketball","manufacturer":"Sp","product":"Authentic","keywords":"1997-98 Sp Authentic Basketball, 1997-98 Sp Authentic Basketball checklist, 1997-98 Sp Authentic Basketball cards, 1997-98 Sp Authentic Basketball autographs","cmurl":""},"count":9,"sha256":"692022fa2cca0bb1c3d77d88fdc103c969f4d74e412047bc369ccd66c10cda4a"},{"source":"1997_98_spx_basketball","target":"1997_98_Spx_Basketball","meta":{"code":"1997_98_Spx_Basketball","displayname":"1997-98 SPX Basketball","year":"1997-98","sport":"basketball","manufacturer":"Spx","product":"Basketball","keywords":"1997-98 SPX Basketball, 1997-98 SPX Basketball checklist, 1997-98 SPX Basketball cards, 1997-98 SPX Basketball autographs","cmurl":""},"count":7,"sha256":"b7573cf3246e5c0ef6bb90ae7606943b88b867d6f8ca837b6c71289a9633138e"},{"source":"1997_98_topps_stadium_club_basketball","target":"1997_98_Stadium_Club_Basketball","meta":{"code":"1997_98_Stadium_Club_Basketball","displayname":"1997-98 Stadium Club Basketball","year":"1997-98","sport":"basketball","manufacturer":"Stadium","product":"Club","keywords":"1997-98 Stadium Club Basketball, 1997-98 Stadium Club Basketball checklist, 1997-98 Stadium Club Basketball cards, 1997-98 Stadium Club Basketball autographs","cmurl":""},"count":13,"sha256":"7491cd789e4c0e3fa5adedee5725bf80ee83261c43290babb91dba35b681d5eb"},{"source":"1997_98_topps_basketball","target":"1997_98_Topps_Basketball","meta":{"code":"1997_98_Topps_Basketball","displayname":"1997-98 Topps Basketball","year":"1997-98","sport":"basketball","manufacturer":"Topps","product":"Basketball","keywords":"1997-98 Topps Basketball, 1997-98 Topps Basketball checklist, 1997-98 Topps Basketball cards, 1997-98 Topps Basketball autographs","cmurl":""},"count":16,"sha256":"027796060b7457620dc4bbc02a0d96f4711b1e44f5746eeefd6d886cd064081b"},{"source":"1997_98_fleer_ultra_basketball","target":"1997_98_Ultra_Basketball","meta":{"code":"1997_98_Ultra_Basketball","displayname":"1997-98 Ultra Basketball","year":"1997-98","sport":"basketball","manufacturer":"Ultra","product":"Basketball","keywords":"1997-98 Ultra Basketball, 1997-98 Ultra Basketball checklist, 1997-98 Ultra Basketball cards, 1997-98 Ultra Basketball autographs","cmurl":""},"count":19,"sha256":"9c33bb21747462aa2efec7c360cc917be9a09ce39c4603de1bf9e7f5399e611f"},{"source":"1997_98_upper_deck_basketball","target":"1997_98_Upper_Deck_Basketball","meta":{"code":"1997_98_Upper_Deck_Basketball","displayname":"1997-98 Upper Deck Basketball","year":"1997-98","sport":"basketball","manufacturer":"Upper","product":"Deck","keywords":"1997-98 Upper Deck Basketball, 1997-98 Upper Deck Basketball checklist, 1997-98 Upper Deck Basketball cards, 1997-98 Upper Deck Basketball autographs","cmurl":""},"count":12,"sha256":"b8cfac533b560afd82b40b11d8e17edccd95c19a82210a5c76a32497d398ac08"},{"source":"1997_98_upper_deck_diamond_vision_basketball","target":"1997_98_Upper_Deck_Diamond_Vision_Basketball","meta":{"code":"1997_98_Upper_Deck_Diamond_Vision_Basketball","displayname":"1997-98 Upper Deck Diamond Vision Basketball","year":"1997-98","sport":"basketball","manufacturer":"Upper","product":"Deck Diamond Vision","keywords":"1997-98 Upper Deck Diamond Vision Basketball, 1997-98 Upper Deck Diamond Vision Basketball checklist, 1997-98 Upper Deck Diamond Vision Basketball cards, 1997-98 Upper Deck Diamond Vision Basketball autographs","cmurl":""},"count":2,"sha256":"76e849b334a6c226a3da6f85b214c0ac40561b026ed26274b9f5a61031b341ce"},{"source":"1997_98_upper_deck_ud3_basketball","target":"1997_98_Upper_Deck_Ud3_Basketball","meta":{"code":"1997_98_Upper_Deck_Ud3_Basketball","displayname":"1997-98 Upper Deck Ud3 Basketball","year":"1997-98","sport":"basketball","manufacturer":"Upper","product":"Deck Ud3","keywords":"1997-98 Upper Deck Ud3 Basketball, 1997-98 Upper Deck Ud3 Basketball checklist, 1997-98 Upper Deck Ud3 Basketball cards, 1997-98 Upper Deck Ud3 Basketball autographs","cmurl":""},"count":2,"sha256":"cad11bd101fe8f83ceb4b99ff2ddf00387104310d686c22ea7025d078520b28e"},{"source":"1996_97_topps_finest_basketball","target":"1996_97_Finest_Basketball","meta":{"code":"1996_97_Finest_Basketball","displayname":"1996-97 Finest Basketball","year":"1996-97","sport":"basketball","manufacturer":"Finest","product":"Basketball","keywords":"1996-97 Finest Basketball, 1996-97 Finest Basketball checklist, 1996-97 Finest Basketball cards, 1996-97 Finest Basketball autographs","cmurl":""},"count":1,"sha256":"023b801f85592d0bd4cae1f387262162cc508fe2d8bafcb17f42d26895707baf"},{"source":"1996_97_flair_showcase_basketball","target":"1996_97_Flair_Showcase_Basketball","meta":{"code":"1996_97_Flair_Showcase_Basketball","displayname":"1996-97 Flair Showcase Basketball","year":"1996-97","sport":"basketball","manufacturer":"Flair","product":"Showcase","keywords":"1996-97 Flair Showcase Basketball, 1996-97 Flair Showcase Basketball checklist, 1996-97 Flair Showcase Basketball cards, 1996-97 Flair Showcase Basketball autographs","cmurl":""},"count":7,"sha256":"eace29c6d0f8f66c7bfd45ae9d4f2b35778ec4c1751e2bada5dfea9717919514"},{"source":"1996_97_fleer_basketball","target":"1996_97_Fleer_Basketball","meta":{"code":"1996_97_Fleer_Basketball","displayname":"1996-97 Fleer Basketball","year":"1996-97","sport":"basketball","manufacturer":"Fleer","product":"Basketball","keywords":"1996-97 Fleer Basketball, 1996-97 Fleer Basketball checklist, 1996-97 Fleer Basketball cards, 1996-97 Fleer Basketball autographs","cmurl":""},"count":12,"sha256":"1e1dec66fe37d773876935d86ba313b408a400e9b78d05c16898a3b3ef72dc6c"},{"source":"1996_97_nba_hoops_hoops_basketball","target":"1996_97_Hoops_Basketball","meta":{"code":"1996_97_Hoops_Basketball","displayname":"1996-97 Hoops Basketball","year":"1996-97","sport":"basketball","manufacturer":"Hoops","product":"Basketball","keywords":"1996-97 Hoops Basketball, 1996-97 Hoops Basketball checklist, 1996-97 Hoops Basketball cards, 1996-97 Hoops Basketball autographs","cmurl":""},"count":13,"sha256":"dee843e7db6f69f9d4a47e9a78ab62eda5adaf2f3820c0c2304c5c3711991853"},{"source":"1996_97_skybox_premium_basketball","target":"1996_97_Skybox_Premium_Basketball","meta":{"code":"1996_97_Skybox_Premium_Basketball","displayname":"1996-97 Skybox Premium Basketball","year":"1996-97","sport":"basketball","manufacturer":"Skybox","product":"Premium","keywords":"1996-97 Skybox Premium Basketball, 1996-97 Skybox Premium Basketball checklist, 1996-97 Skybox Premium Basketball cards, 1996-97 Skybox Premium Basketball autographs","cmurl":""},"count":16,"sha256":"93618227a78aafeb44388b08fb5490717f24c23b1d7a597d57b4be30c4a1f123"},{"source":"1996_97_sp_basketball","target":"1996_97_Sp_Basketball","meta":{"code":"1996_97_Sp_Basketball","displayname":"1996-97 Sp Basketball","year":"1996-97","sport":"basketball","manufacturer":"Sp","product":"Basketball","keywords":"1996-97 Sp Basketball, 1996-97 Sp Basketball checklist, 1996-97 Sp Basketball cards, 1996-97 Sp Basketball autographs","cmurl":""},"count":4,"sha256":"edf16a08eba5d47d0c57fa979aface9802fd3cdda81a38fa42262d07e53d51d8"},{"source":"1996_97_topps_stadium_club_basketball","target":"1996_97_Stadium_Club_Basketball","meta":{"code":"1996_97_Stadium_Club_Basketball","displayname":"1996-97 Stadium Club Basketball","year":"1996-97","sport":"basketball","manufacturer":"Stadium","product":"Club","keywords":"1996-97 Stadium Club Basketball, 1996-97 Stadium Club Basketball checklist, 1996-97 Stadium Club Basketball cards, 1996-97 Stadium Club Basketball autographs","cmurl":""},"count":14,"sha256":"6a2da60150813177094f324c5c8631e238c6fe7ba653ed9f29b07f8a51a6fc84"},{"source":"1996_97_topps_basketball","target":"1996_97_Topps_Basketball","meta":{"code":"1996_97_Topps_Basketball","displayname":"1996-97 Topps Basketball","year":"1996-97","sport":"basketball","manufacturer":"Topps","product":"Basketball","keywords":"1996-97 Topps Basketball, 1996-97 Topps Basketball checklist, 1996-97 Topps Basketball cards, 1996-97 Topps Basketball autographs","cmurl":""},"count":15,"sha256":"72bfab341a0eb9b6333cb7627aa0b5c9428b954078ed05aa91602a1c94209cad"},{"source":"1996_97_topps_stars_basketball","target":"1996_97_Topps_Stars_Basketball","meta":{"code":"1996_97_Topps_Stars_Basketball","displayname":"1996-97 Topps Stars Basketball","year":"1996-97","sport":"basketball","manufacturer":"Topps","product":"Stars","keywords":"1996-97 Topps Stars Basketball, 1996-97 Topps Stars Basketball checklist, 1996-97 Topps Stars Basketball cards, 1996-97 Topps Stars Basketball autographs","cmurl":""},"count":6,"sha256":"74279fc03d0460b1afdc32b6d0f5f0f358048102adf77f4edae08a1746918d90"},{"source":"1996_97_fleer_ultra_basketball","target":"1996_97_Ultra_Basketball","meta":{"code":"1996_97_Ultra_Basketball","displayname":"1996-97 Ultra Basketball","year":"1996-97","sport":"basketball","manufacturer":"Ultra","product":"Basketball","keywords":"1996-97 Ultra Basketball, 1996-97 Ultra Basketball checklist, 1996-97 Ultra Basketball cards, 1996-97 Ultra Basketball autographs","cmurl":""},"count":15,"sha256":"c12950fd67af2625277ce054d27a5fd53177f7691b907fde715ee42551fc9295"},{"source":"1996_97_upper_deck_basketball","target":"1996_97_Upper_Deck_Basketball","meta":{"code":"1996_97_Upper_Deck_Basketball","displayname":"1996-97 Upper Deck Basketball","year":"1996-97","sport":"basketball","manufacturer":"Upper","product":"Deck","keywords":"1996-97 Upper Deck Basketball, 1996-97 Upper Deck Basketball checklist, 1996-97 Upper Deck Basketball cards, 1996-97 Upper Deck Basketball autographs","cmurl":""},"count":13,"sha256":"4a710bcee800ce3a12bf540f6b59862712610ab9c40d0e1db8cfe5fe45f4446b"},{"source":"1996_97_upper_deck_ud3_basketball","target":"1996_97_Upper_Deck_Ud3_Basketball","meta":{"code":"1996_97_Upper_Deck_Ud3_Basketball","displayname":"1996-97 Upper Deck Ud3 Basketball","year":"1996-97","sport":"basketball","manufacturer":"Upper","product":"Deck Ud3","keywords":"1996-97 Upper Deck Ud3 Basketball, 1996-97 Upper Deck Ud3 Basketball checklist, 1996-97 Upper Deck Ud3 Basketball cards, 1996-97 Upper Deck Ud3 Basketball autographs","cmurl":""},"count":3,"sha256":"0e0fb32419bb079b62b0353d417fc3ab750f9ae8f6c3df67d2690634e5c8380c"},{"source":"1995_96_topps_finest_basketball","target":"1995_96_Finest_Basketball","meta":{"code":"1995_96_Finest_Basketball","displayname":"1995-96 Finest Basketball","year":"1995-96","sport":"basketball","manufacturer":"Finest","product":"Basketball","keywords":"1995-96 Finest Basketball, 1995-96 Finest Basketball checklist, 1995-96 Finest Basketball cards, 1995-96 Finest Basketball autographs","cmurl":""},"count":7,"sha256":"e2c67bc38a90f37de673de702ad3e0f896a82817b7065ac7497d8c976ee4d1d6"},{"source":"1995_96_flair_basketball","target":"1995_96_Flair_Basketball","meta":{"code":"1995_96_Flair_Basketball","displayname":"1995-96 Flair Basketball","year":"1995-96","sport":"basketball","manufacturer":"Flair","product":"Basketball","keywords":"1995-96 Flair Basketball, 1995-96 Flair Basketball checklist, 1995-96 Flair Basketball cards, 1995-96 Flair Basketball autographs","cmurl":""},"count":9,"sha256":"3139d30abf5144a54eed893d06e3c1526722d9b2f03fb2a102652d5bdfae1db6"},{"source":"1995_96_fleer_basketball","target":"1995_96_Fleer_Basketball","meta":{"code":"1995_96_Fleer_Basketball","displayname":"1995-96 Fleer Basketball","year":"1995-96","sport":"basketball","manufacturer":"Fleer","product":"Basketball","keywords":"1995-96 Fleer Basketball, 1995-96 Fleer Basketball checklist, 1995-96 Fleer Basketball cards, 1995-96 Fleer Basketball autographs","cmurl":""},"count":14,"sha256":"a4926b05d0433fa5040f129cb7c039419f271d2a2b233565a453998524f9025e"},{"source":"1995_96_nba_hoops_hoops_basketball","target":"1995_96_Hoops_Basketball","meta":{"code":"1995_96_Hoops_Basketball","displayname":"1995-96 Hoops Basketball","year":"1995-96","sport":"basketball","manufacturer":"Hoops","product":"Basketball","keywords":"1995-96 Hoops Basketball, 1995-96 Hoops Basketball checklist, 1995-96 Hoops Basketball cards, 1995-96 Hoops Basketball autographs","cmurl":""},"count":17,"sha256":"7af512b8376f3ff76144384ee52adf39ae0e53edc1f73b1562d2c2a83da74040"},{"source":"1995_96_fleer_metal_basketball","target":"1995_96_Metal_Basketball","meta":{"code":"1995_96_Metal_Basketball","displayname":"1995-96 Metal Basketball","year":"1995-96","sport":"basketball","manufacturer":"Metal","product":"Basketball","keywords":"1995-96 Metal Basketball, 1995-96 Metal Basketball checklist, 1995-96 Metal Basketball cards, 1995-96 Metal Basketball autographs","cmurl":""},"count":10,"sha256":"6890c13a31b607d3ee8c8f848d96fae54eb494ae61c9c63da88648a878f682c9"},{"source":"1995_96_skybox_premium_basketball","target":"1995_96_Skybox_Premium_Basketball","meta":{"code":"1995_96_Skybox_Premium_Basketball","displayname":"1995-96 Skybox Premium Basketball","year":"1995-96","sport":"basketball","manufacturer":"Skybox","product":"Premium","keywords":"1995-96 Skybox Premium Basketball, 1995-96 Skybox Premium Basketball checklist, 1995-96 Skybox Premium Basketball cards, 1995-96 Skybox Premium Basketball autographs","cmurl":""},"count":16,"sha256":"c344760c9590991ec789f52f41f5622f2f85f60b52287d57de60d7ecadfbdb94"},{"source":"1995_96_sp_basketball","target":"1995_96_Sp_Basketball","meta":{"code":"1995_96_Sp_Basketball","displayname":"1995-96 Sp Basketball","year":"1995-96","sport":"basketball","manufacturer":"Sp","product":"Basketball","keywords":"1995-96 Sp Basketball, 1995-96 Sp Basketball checklist, 1995-96 Sp Basketball cards, 1995-96 Sp Basketball autographs","cmurl":""},"count":6,"sha256":"240e69ed2a28eba792f5dac294700229c726605ce08d7238002ed8e3f95dc320"},{"source":"1995_96_sp_championship_basketball","target":"1995_96_Sp_Championship_Basketball","meta":{"code":"1995_96_Sp_Championship_Basketball","displayname":"1995-96 Sp Championship Basketball","year":"1995-96","sport":"basketball","manufacturer":"Sp","product":"Championship","keywords":"1995-96 Sp Championship Basketball, 1995-96 Sp Championship Basketball checklist, 1995-96 Sp Championship Basketball cards, 1995-96 Sp Championship Basketball autographs","cmurl":""},"count":4,"sha256":"26dbe2aa238c09d30dcc2a0e7619bb57b3520f0550f2d111c4e8eb138d286194"},{"source":"1995_96_topps_stadium_club_basketball","target":"1995_96_Stadium_Club_Basketball","meta":{"code":"1995_96_Stadium_Club_Basketball","displayname":"1995-96 Stadium Club Basketball","year":"1995-96","sport":"basketball","manufacturer":"Stadium","product":"Club","keywords":"1995-96 Stadium Club Basketball, 1995-96 Stadium Club Basketball checklist, 1995-96 Stadium Club Basketball cards, 1995-96 Stadium Club Basketball autographs","cmurl":""},"count":10,"sha256":"a88b1d1c19f1734238143eea95e5f770863c363a2fd0c488a9d2f6a58f77d8a1"},{"source":"1995_96_topps_basketball","target":"1995_96_Topps_Basketball","meta":{"code":"1995_96_Topps_Basketball","displayname":"1995-96 Topps Basketball","year":"1995-96","sport":"basketball","manufacturer":"Topps","product":"Basketball","keywords":"1995-96 Topps Basketball, 1995-96 Topps Basketball checklist, 1995-96 Topps Basketball cards, 1995-96 Topps Basketball autographs","cmurl":""},"count":13,"sha256":"405f301dee6f1c6b2a0b93aba034d8344360bf09834a27f146a1cbe760b23656"},{"source":"1995_96_topps_gallery_basketball","target":"1995_96_Topps_Gallery_Basketball","meta":{"code":"1995_96_Topps_Gallery_Basketball","displayname":"1995-96 Topps Gallery Basketball","year":"1995-96","sport":"basketball","manufacturer":"Topps","product":"Gallery","keywords":"1995-96 Topps Gallery Basketball, 1995-96 Topps Gallery Basketball checklist, 1995-96 Topps Gallery Basketball cards, 1995-96 Topps Gallery Basketball autographs","cmurl":""},"count":3,"sha256":"d345379f0d02d6ef45ca4600a030b116bc8a5a973a8a661849a5e86c269ec78a"},{"source":"1995_96_fleer_ultra_basketball","target":"1995_96_Ultra_Basketball","meta":{"code":"1995_96_Ultra_Basketball","displayname":"1995-96 Ultra Basketball","year":"1995-96","sport":"basketball","manufacturer":"Ultra","product":"Basketball","keywords":"1995-96 Ultra Basketball, 1995-96 Ultra Basketball checklist, 1995-96 Ultra Basketball cards, 1995-96 Ultra Basketball autographs","cmurl":""},"count":20,"sha256":"2990d3fb7fae69462adb7fd23b1b837a04c29c9fb31bad1f80be74b7c76e29af"},{"source":"1995_96_upper_deck_basketball","target":"1995_96_Upper_Deck_Basketball","meta":{"code":"1995_96_Upper_Deck_Basketball","displayname":"1995-96 Upper Deck Basketball","year":"1995-96","sport":"basketball","manufacturer":"Upper","product":"Deck","keywords":"1995-96 Upper Deck Basketball, 1995-96 Upper Deck Basketball checklist, 1995-96 Upper Deck Basketball cards, 1995-96 Upper Deck Basketball autographs","cmurl":""},"count":12,"sha256":"9462579ba7a486e3161fb31ae73a72deb223a3734003aefad28c63fde08c407a"},{"source":"2001_02_fleer_premium_basketball","target":"2001_02_Fleer_Premium_Basketball","meta":{"code":"2001_02_Fleer_Premium_Basketball","displayname":"2001-02 Fleer Premium Basketball","year":"2001-02","sport":"basketball","manufacturer":"Fleer","product":"Premium","keywords":"2001-02 Fleer Premium Basketball, 2001-02 Fleer Premium Basketball checklist, 2001-02 Fleer Premium Basketball cards, 2001-02 Fleer Premium Basketball autographs","cmurl":""},"count":11,"sha256":"93325f19da85142da6a94e48eec027d003f64e51fd47a0a197951c326600e11c"}];
}

function auditApprovedStep7Release() {
  const source=prvSourceTables_(getVaultSpreadsheet_());
  const rows=source.products.filter(r=>r.prv_identity_review && r.prv_identity_review.review_id==="step7-122-2026-10-26" && !r.prv_identity_hold);
  if(source.report.input_rows!==8414 || source.report.unmatched_rows!==2254 || source.report.unmatched.length!==305 || rows.length!==1379 || new Set(rows.map(r=>r.code)).size!==122)throw new Error("Step 7 source/catalog preflight failed; publication held.");
  const built=buildVaultStaticData_();
  prvApprovedStep7Manifest_().forEach(rule=>{
    const p=built.products[rule.target];if(!p || p.rows.length!==rule.count)throw new Error("Step 7 release row mismatch: "+rule.target);
    p.rows.forEach(r=>{if(!/Unverified estimate/.test(r.notes) || /^https?:/i.test(r.cmURL))throw new Error("Step 7 measurement qualification changed");});
  });
  Logger.log("APPROVED STEP7 PREFLIGHT "+JSON.stringify({input_rows:source.report.input_rows,unmatched_rows:source.report.unmatched_rows,unmatched_groups:source.report.unmatched.length,approved_groups:122,approved_rows:rows.length,sheet_writes:false,d1_queries:false}));
}
