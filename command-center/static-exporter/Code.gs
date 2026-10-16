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

function exportVaultStaticData_(dataRoot) {
  const ss = getVaultSpreadsheet_();
  if (!ss) {
    Logger.log("Skipping Vault static export. Set CM_VAULT_SPREADSHEET_ID or run this script from the bound Print Run Vault spreadsheet.");
    return;
  }

  const vaultRoot = ensureFolderPath_(dataRoot, ["vault"]);
  const productRoot = ensureFolderPath_(vaultRoot, ["products"]);
  const popRoot = ensureFolderPath_(vaultRoot, ["pop"]);

  const indexRows = sheetObjects_(ss.getSheetByName("Index")).map(r => ({
    Code: value_(r.code),
    DisplayName: value_(r.displayname || r.display_name),
    Keywords: value_(r.keywords),
    year: value_(r.year),
    sport: value_(r.sport),
    manufacturer: value_(r.manufacturer),
    product: value_(r.product),
    cmURL: value_(r.cmurl || r.cm_url)
  })).filter(r => r.Code && r.DisplayName);

  const productRows = sheetObjects_(ss.getSheetByName("Products")).map(r => ({
    code: value_(r.code),
    setType: value_(r.settype || r.set_type),
    setLine: value_(r.setline || r.set_line),
    printRun: numberOrString_(r.printrun || r.print_run),
    serial: value_(r.serial),
    subSetSize: numberOrString_(r.subsetsize || r.sub_set_size),
    notes: value_(r.notes),
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

  const generatedAt = new Date().toISOString();
  const indexRows = sheetObjects_(ss.getSheetByName("Index")).map(r => ({
    Code: value_(r.code),
    DisplayName: value_(r.displayname || r.display_name),
    Keywords: value_(r.keywords),
    year: value_(r.year),
    sport: value_(r.sport),
    manufacturer: value_(r.manufacturer),
    product: value_(r.product),
    cmURL: value_(r.cmurl || r.cm_url)
  })).filter(r => r.Code && r.DisplayName);

  const productRows = sheetObjects_(ss.getSheetByName("Products")).map(r => ({
    code: value_(r.code),
    setType: value_(r.settype || r.set_type),
    setLine: value_(r.setline || r.set_line),
    printRun: numberOrString_(r.printrun || r.print_run),
    serial: value_(r.serial),
    subSetSize: numberOrString_(r.subsetsize || r.sub_set_size),
    notes: value_(r.notes),
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
  const meta = sheetObjects_(ss.getSheetByName("Index")).find(row => value_(row.code) === code);
  if (!meta) throw new Error("PRV source product not found: " + code);
  const index = {Code:code, DisplayName:value_(meta.displayname || meta.display_name), Keywords:value_(meta.keywords),year:value_(meta.year),
    sport:value_(meta.sport),manufacturer:value_(meta.manufacturer),product:value_(meta.product),cmURL:value_(meta.cmurl || meta.cm_url)};
  const rows = sheetObjects_(ss.getSheetByName("Products")).filter(row => value_(row.code) === code).map(row => ({code:code,
    setType:value_(row.settype || row.set_type),setLine:value_(row.setline || row.set_line),printRun:numberOrString_(row.printrun || row.print_run),
    serial:value_(row.serial),subSetSize:numberOrString_(row.subsetsize || row.sub_set_size),notes:value_(row.notes),cmURL:value_(row.cmurl || row.cm_url)}));
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

function publicPipelineJob_(job, refresh) {
  const data = job.data;
  // Verification is read-only and can safely run after a browser reconnect.
  if (refresh && data.expected && ["committing","committed","verifying","published_pages_pending"].includes(data.stage)) {
    const validation = data.kind === "prv" ? verifyPrvReleaseBoth_(data.code,data.expected) : verifyChecklistReleaseBoth_(data.sport,data.code,data.expected);
    if (validation.github.ok) {
      data.result = Object.assign({},data.result || {},{ok:true,status:validation.public.ok ? "published_and_public_validated" : "published_pages_pending",validation:validation});
      data.stage = validation.public.ok ? "complete" : "published_pages_pending";
      savePipelineJob_(job);
    }
  }
  const result = data.result || {};
  return Object.assign({},result,{ok:data.stage === "complete" || data.stage === "published_pages_pending",status:data.stage === "complete" ? "published_and_public_validated" : data.stage === "published_pages_pending" ? "published_pages_pending" : data.stage === "failed" ? "publish_failed" : "publish_" + data.stage,
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
        const checked = data.expected ? publicPipelineJob_(job,true) : null;
        if (!checked || !checked.ok) { data.stage="failed"; data.error="Previous worker was interrupted. Inspect this job before explicitly retrying."; savePipelineJob_(job); }
      }
      if (data.stage === "published_pages_pending" && (!pending || (data.updated_at || data.created_at) < (pending.data.updated_at || pending.data.created_at))) pending=job;
      if (data.stage === "queued" && (!next || data.created_at < next.data.created_at)) next=job;
    });
    if (!next) { if (pending) publicPipelineJob_(pending,true); return; }
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
