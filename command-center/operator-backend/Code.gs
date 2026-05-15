/*******************************************************
 * Chasing Majors Command Center - Operator Backend
 *
 * Purpose:
 * - Run source-watch work from Apps Script, where we can safely use
 *   URLFetchApp, Google Sheets access, Script Properties, and later
 *   approved publish functions.
 * - Keep the public GitHub Pages Command Center free of secrets.
 *
 * Current actions:
 * - health
 * - sourceWatch
 * - validateSourceProduct
 * - previewSourceImport
 * - executeSourceImport
 *
 * Current safety:
 * - Sheet writes require Script Property CM_OPERATOR_KEY.
 * - Source import writes are idempotent by product code.
 *******************************************************/

const CM_OPERATOR_VERSION = "2026-05-15-operator-v2";
const CM_APP_DATA_BASE = "https://app.chasingmajors.com/data/v1";
const CM_CHECKLISTCENTER_HOME = "https://www.checklistcenter.com/";
const CM_ALLOWED_SPORTS = ["baseball", "football", "basketball", "hockey", "soccer"];
const CM_PRODUCTS_SHEET = "Products";
const CM_CHECKLIST_ROWS_SHEET = "ChecklistRows";
const CM_PARALLELS_SHEET = "Parallels";
const CM_OPERATOR_KEY_PROPERTY = "CM_OPERATOR_KEY";
const CM_STATIC_EXPORTER_URL_PROPERTY = "CM_STATIC_EXPORTER_URL";
const CM_CHECKLIST_SOURCE_MAP = {
  baseball: {
    current: "1knoZy155nQOw-_9o5ragmoBS_FaxwoZ3lEQ4YGgeSeg",
    "2026": "1knoZy155nQOw-_9o5ragmoBS_FaxwoZ3lEQ4YGgeSeg",
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
    "2025-26": "1G90AI7ZhIsTyHDmqdiZ26_ZgWRm4RRaDzdED3CzEG3g",
    "2024-25": "14JWdRdT9xsjVbWGUQszbiBgtMNJCxtrMV1yINm_edcE",
    "2023-24": "1k_7N09xelDEcVUGhIFRSFBKa9NHK3xFCW2urvHYxEZw"
  }
};
const CM_BLOCKED_TERMS = [
  "mma",
  "ufc",
  "wwe",
  "wrestling",
  "racing",
  "nascar",
  "f1",
  "formula 1",
  "pokemon",
  "marvel",
  "disney",
  "star wars",
  "entertainment"
];

function doGet(e) {
  const p = (e && e.parameter) ? e.parameter : {};
  const action = safeString_(p.action).trim();

  try {
    if (action === "health") return json_({
      ok: true,
      service: "cm_command_center_operator",
      version: CM_OPERATOR_VERSION,
      mode: "review_only",
      supported_sports: CM_ALLOWED_SPORTS,
      updated_at: new Date().toISOString()
    });

    if (action === "sourceWatch") return json_(runSourceWatch_());

    if (action === "validateSourceProduct") {
      return json_(validateSourceProduct_({
        title: p.title || "",
        sport: p.sport || ""
      }));
    }

    if (action === "previewSourceImport") {
      return json_(previewSourceImport_({
        sourceUrl: p.sourceUrl || p.url || "",
        sport: p.sport || ""
      }));
    }

    if (action === "executeSourceImport") {
      return json_(executeSourceImport_({
        sourceUrl: p.sourceUrl || p.url || "",
        sport: p.sport || "",
        key: p.key || ""
      }));
    }

    return json_({
      ok: false,
      error: "Unknown action",
      supported_actions: ["health", "sourceWatch", "validateSourceProduct", "previewSourceImport", "executeSourceImport"]
    });
  } catch (err) {
    return json_({
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  }
}

function doPost(e) {
  const body = parseBody_(e);
  const action = safeString_(body.action).trim();

  try {
    if (action === "sourceWatch") return json_(runSourceWatch_());

    if (action === "validateSourceProduct") {
      return json_(validateSourceProduct_(body));
    }

    if (action === "previewSourceImport") {
      return json_(previewSourceImport_(body));
    }

    if (action === "executeSourceImport") {
      return json_(executeSourceImport_(body));
    }

    return json_({
      ok: false,
      error: "Unknown action",
      supported_actions: ["sourceWatch", "validateSourceProduct", "previewSourceImport", "executeSourceImport"]
    });
  } catch (err) {
    return json_({
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  }
}

function previewSourceImport_(input) {
  const sourceUrl = safeString_(input && (input.sourceUrl || input.url)).trim();
  const requestedSport = normalize_(input && input.sport);

  if (!sourceUrl) {
    return {
      ok: false,
      error: "Missing sourceUrl"
    };
  }

  if (!/^https:\/\/www\.checklistcenter\.com\//i.test(sourceUrl)) {
    return {
      ok: false,
      error: "Only Checklistcenter URLs are supported in this preview."
    };
  }

  const html = fetchText_(sourceUrl);
  const title = extractPageTitle_(html) || normalizeTitleFromLink_(titleFromChecklistCenterHref_(sourceUrl));
  const sport = requestedSport || inferSport_(title + " " + sourceUrl);

  if (!isAllowedSport_(sport)) {
    return {
      ok: true,
      status: "ignored",
      title: title,
      sport: sport,
      source_url: sourceUrl,
      reason: "Unsupported sport. Preview import only supports baseball, football, basketball, hockey, and soccer."
    };
  }

  if (hasBlockedTerm_(title)) {
    return {
      ok: true,
      status: "ignored",
      title: title,
      sport: sport,
      source_url: sourceUrl,
      reason: "Blocked category term detected."
    };
  }

  const product = buildProductPreview_(title, sport, sourceUrl);
  const parsed = parseChecklistCenterArticle_(html, product);

  return {
    ok: true,
    mode: "preview_only",
    status: parsed.rows.length ? "preview_ready" : "needs_review",
    source_url: sourceUrl,
    product: product,
    row_count: parsed.rows.length,
    parallel_count: parsed.parallels.length,
    sections: parsed.sections,
    sample_rows: parsed.rows.slice(0, 10),
    sample_parallels: parsed.parallels.slice(0, 10),
    rows: parsed.rows.slice(0, 500),
    parallels: parsed.parallels.slice(0, 500),
    warnings: parsed.warnings,
    next_step: "Review preview counts and samples. Sheet write is intentionally not enabled yet."
  };
}

function executeSourceImport_(input) {
  requireOperatorKey_(input && input.key);

  const preview = previewSourceImport_(input);
  if (!preview || !preview.ok) return preview;

  if (preview.status !== "preview_ready") {
    return {
      ok: false,
      status: preview.status || "not_ready",
      error: "Source import preview is not ready for write.",
      preview: preview
    };
  }

  const product = preview.product || {};
  const sport = normalize_(product.sport);
  const targetSpreadsheetId = getChecklistSpreadsheetId_(sport, product.target_bucket || product.year);
  if (!targetSpreadsheetId) {
    return {
      ok: false,
      error: "No target spreadsheet configured for " + sport + " " + (product.target_bucket || product.year || "")
    };
  }

  const ss = SpreadsheetApp.openById(targetSpreadsheetId);
  const productRow = productToSheetObject_(product);
  const fullParsed = parseFullSourceForWrite_(input.sourceUrl || input.url, sport);
  const rows = fullParsed.rows;
  const parallels = fullParsed.parallels;

  upsertProducts_(ss, product.code, productRow);
  replaceRowsByCode_(ss, CM_CHECKLIST_ROWS_SHEET, product.code, rows, [
    "code", "sport", "section", "subset", "card_no", "player", "team", "tag"
  ]);
  replaceRowsByCode_(ss, CM_PARALLELS_SHEET, product.code, parallels, [
    "code", "sport", "applies_to_section", "applies_to_subset", "parallel_name", "serial_no"
  ]);

  const validation = validateWrittenProduct_(ss, product.code);

  const publishResult = publishChecklistAfterImport_(product, input && input.key);

  return {
    ok: true,
    status: publishResult && publishResult.ok ? "written_published_validated" : "written_publish_needs_review",
    mode: "sheet_write_publish_validate",
    source_url: input.sourceUrl || input.url || "",
    target_spreadsheet_id: targetSpreadsheetId,
    target_bucket: product.target_bucket || product.year || "",
    product: product,
    wrote: {
      products: 1,
      rows: rows.length,
      parallels: parallels.length
    },
    validation: validation,
    publish: publishResult,
    publish_next: getPublishRecommendation_(sport, product.target_bucket || product.year),
    next_step: publishResult && publishResult.ok
      ? "Published and validated. Open Checklist Vault and ChatBot test links for final human review."
      : "Sheet write succeeded, but publish/live validation needs review.",
    updated_at: new Date().toISOString()
  };
}

function runSourceWatch_() {
  const indexRows = fetchChecklistIndex_();
  const sourceItems = fetchRecentChecklistCenterItems_();

  const results = sourceItems.map(function(item) {
    return classifySourceItem_(item, indexRows);
  });

  const summary = results.reduce(function(out, item) {
    out[item.status] = (out[item.status] || 0) + 1;
    return out;
  }, {});

  return {
    ok: true,
    mode: "review_only",
    source: "checklistcenter",
    source_url: CM_CHECKLISTCENTER_HOME,
    fetched_count: sourceItems.length,
    supported_count: results.filter(function(r) { return r.status !== "ignored"; }).length,
    summary: summary,
    items: results,
    next_step: "Missing or possible_update items should become approval tasks before any sheet write.",
    updated_at: new Date().toISOString()
  };
}

function validateSourceProduct_(input) {
  const title = safeString_(input && input.title).trim();
  const sport = normalize_(input && input.sport);

  if (!title) {
    return {
      ok: false,
      status: "needs_review",
      error: "Missing title"
    };
  }

  if (!isAllowedSport_(sport)) {
    return {
      ok: true,
      status: "ignored",
      title: title,
      sport: sport,
      reason: "Unsupported sport. Command Center only supports baseball, football, basketball, hockey, and soccer."
    };
  }

  if (hasBlockedTerm_(title)) {
    return {
      ok: true,
      status: "ignored",
      title: title,
      sport: sport,
      reason: "Blocked non-supported category term detected."
    };
  }

  const indexRows = fetchChecklistIndex_();
  const item = {
    title: title,
    sport: sport,
    url: ""
  };

  return Object.assign({ ok: true }, classifySourceItem_(item, indexRows));
}

function fetchRecentChecklistCenterItems_() {
  const html = fetchText_(CM_CHECKLISTCENTER_HOME);
  const links = extractChecklistCenterLinks_(html);
  const deduped = {};

  links.forEach(function(link) {
    const title = normalizeTitleFromLink_(link.text || titleFromChecklistCenterHref_(link.href) || "");
    const sport = inferSport_(title + " " + link.href);
    const url = absoluteChecklistCenterUrl_(link.href);
    const key = normalize_(url);

    if (!title || deduped[key]) return;
    deduped[key] = {
      title: title,
      sport: sport,
      url: url,
      source_text: link.text || ""
    };
  });

  return Object.keys(deduped)
    .map(function(key) { return deduped[key]; })
    .filter(function(item) {
      return item.title && (isAllowedSport_(item.sport) || hasBlockedTerm_(item.title) || item.url);
    })
    .slice(0, 40);
}

function extractChecklistCenterLinks_(html) {
  const out = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = re.exec(html)) !== null) {
    const href = safeString_(match[1]);
    const text = stripHtml_(match[2]);
    const combined = href + " " + text;

    if (!isProductChecklistHref_(href)) continue;
    if (/#respond|\/category\//i.test(href)) continue;
    if (/no comments|player card checklists|checklists$/i.test(text)) continue;
    if (!/checklist/i.test(combined)) continue;
    if (!/card|baseball|basketball|football|hockey|soccer|topps|panini|upper deck|bowman/i.test(combined)) continue;

    out.push({
      href: href,
      text: text
    });
  }

  return out;
}

function isProductChecklistHref_(href) {
  const raw = safeString_(href);
  if (!raw) return false;
  if (!/card-checklist\/?$/i.test(raw)) return false;
  if (/\/category\//i.test(raw)) return false;
  if (/#/i.test(raw)) return false;
  return true;
}

function classifySourceItem_(item, indexRows) {
  const title = safeString_(item && item.title).trim();
  const sport = normalize_(item && item.sport);

  if (!isAllowedSport_(sport)) {
    return {
      status: "ignored",
      title: title,
      sport: sport,
      source_url: item.url || "",
      reason: "Unsupported or unknown sport."
    };
  }

  if (hasBlockedTerm_(title)) {
    return {
      status: "ignored",
      title: title,
      sport: sport,
      source_url: item.url || "",
      reason: "Blocked category term."
    };
  }

  const match = findChecklistIndexMatch_(title, sport, indexRows);
  if (match && match.score >= 140) {
    return {
      status: "covered",
      title: title,
      sport: sport,
      source_url: item.url || "",
      matched_name: match.name,
      matched_code: match.code,
      match_score: match.score,
      recommended_action: "No import needed unless source has newer rows/parallels than Chasing Majors."
    };
  }

  if (match && match.score >= 85) {
    return {
      status: "needs_review",
      title: title,
      sport: sport,
      source_url: item.url || "",
      matched_name: match.name,
      matched_code: match.code,
      match_score: match.score,
      recommended_action: "Review naming/alias match before import."
    };
  }

  return {
    status: "missing",
    title: title,
    sport: sport,
    source_url: item.url || "",
    recommended_action: buildMissingRecommendedAction_(title, sport)
  };
}

function findChecklistIndexMatch_(title, sport, indexRows) {
  const titleNorm = normalize_(title);
  const titleCompact = titleNorm.replace(/\s+/g, "");
  const titleLoose = looseProductKey_(title);
  let best = null;

  (indexRows || []).forEach(function(row) {
    const rowSport = normalize_(row.sport || row.Sport || "");
    if (rowSport !== sport) return;

    const name = safeString_(row.DisplayName || row.displayName || row.display_name || row.name || "");
    const code = safeString_(row.Code || row.code || "");
    const keywords = safeString_(row.Keywords || row.keywords || "");
    const nameNorm = normalize_(name);
    const nameCompact = nameNorm.replace(/\s+/g, "");
    const nameLoose = looseProductKey_(name);
    const hayLoose = looseProductKey_([name, code, keywords].join(" "));
    const hay = normalize_([name, code, keywords].join(" "));
    let score = 0;

    if (nameNorm === titleNorm) score += 220;
    if (nameCompact === titleCompact) score += 200;
    if (nameLoose === titleLoose) score += 220;
    if (hayLoose.indexOf(titleLoose) > -1) score += 165;
    if (hay.indexOf(titleNorm) > -1) score += 140;
    if (titleNorm.indexOf(nameNorm) > -1 && nameNorm.length > 8) score += 90;

    titleNorm.split(" ").filter(Boolean).forEach(function(token) {
      if (hay.indexOf(token) > -1) score += 5;
    });

    if (!best || score > best.score) {
      best = {
        score: score,
        name: name,
        code: code
      };
    }
  });

  return best;
}

function looseProductKey_(value) {
  return normalize_(value)
    .replace(/\b(19|20)(\d{2})\s+(\d{2})\b/g, "$1$2$3")
    .replace(/\b(19|20)(\d{2})-(\d{2})\b/g, "$1$2$3")
    .replace(/\bo\s+pee\s+chee\b/g, "opeechee")
    .replace(/\beuro\s+league\b/g, "euroleague")
    .replace(/\bworld\s+cup\s+26\b/g, "worldcup26")
    .replace(/\bfifa\b/g, "fifa")
    .replace(/\buefa\b/g, "uefa")
    .replace(/\bwnba\b/g, "wnba")
    .replace(/\bnba\b/g, "nba")
    .replace(/\bmls\b/g, "mls")
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function fetchChecklistIndex_() {
  const data = JSON.parse(fetchText_(CM_APP_DATA_BASE + "/checklists/index.json"));
  return data.index || data.rows || [];
}

function parseFullSourceForWrite_(sourceUrl, sport) {
  const html = fetchText_(sourceUrl);
  const title = extractPageTitle_(html) || normalizeTitleFromLink_(titleFromChecklistCenterHref_(sourceUrl));
  const resolvedSport = normalize_(sport) || inferSport_(title + " " + sourceUrl);
  const product = buildProductPreview_(title, resolvedSport, sourceUrl);
  return parseChecklistCenterArticle_(html, product);
}

function requireOperatorKey_(providedKey) {
  const expected = PropertiesService.getScriptProperties().getProperty(CM_OPERATOR_KEY_PROPERTY);
  if (!expected) {
    throw new Error("Missing Script Property " + CM_OPERATOR_KEY_PROPERTY + ". Set it before enabling sheet writes.");
  }

  if (safeString_(providedKey) !== expected) {
    throw new Error("Invalid operator key.");
  }
}

function getChecklistSpreadsheetId_(sport, bucket) {
  const s = normalize_(sport);
  const key = safeString_(bucket || "").trim();
  const map = CM_CHECKLIST_SOURCE_MAP[s] || {};

  if (key && map[key]) return map[key];
  if (map.current) return map.current;
  return "";
}

function productToSheetObject_(product) {
  return {
    code: product.code || "",
    display_name: product.display_name || "",
    year: product.year || "",
    sport: product.sport || "",
    manufacturer: product.manufacturer || "",
    product: product.product || "",
    keywords: product.keywords || ""
  };
}

function upsertProducts_(ss, code, productObj) {
  const sh = ensureSheetWithHeaders_(ss, CM_PRODUCTS_SHEET, [
    "code", "display_name", "year", "sport", "manufacturer", "product", "keywords"
  ]);
  const headers = getHeaders_(sh);
  const values = sh.getDataRange().getValues();
  const rowValues = headers.map(function(header) {
    return safeString_(productObj[header] || "");
  });
  let rowIndex = -1;

  for (let i = 1; i < values.length; i++) {
    if (safeString_(values[i][0]).trim() === code) {
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex > -1) {
    sh.getRange(rowIndex, 1, 1, rowValues.length).setValues([rowValues]);
  } else {
    sh.appendRow(rowValues);
  }
}

function replaceRowsByCode_(ss, sheetName, code, objects, defaultHeaders) {
  const sh = ensureSheetWithHeaders_(ss, sheetName, defaultHeaders);
  const headers = getHeaders_(sh);
  const values = sh.getDataRange().getValues();
  const kept = values.length ? [fitRowToWidth_(values[0], headers.length)] : [headers];

  for (let i = 1; i < values.length; i++) {
    if (safeString_(values[i][0]).trim() !== code) {
      kept.push(fitRowToWidth_(values[i], headers.length));
    }
  }

  objects.forEach(function(obj) {
    kept.push(headers.map(function(header) {
      return safeString_(obj[header] || "");
    }));
  });

  sh.clearContents();
  sh.getRange(1, 1, kept.length, headers.length).setNumberFormat("@");
  sh.getRange(1, 1, kept.length, headers.length).setValues(kept);
}

function fitRowToWidth_(row, width) {
  const out = [];
  for (let i = 0; i < width; i++) {
    out.push(row && row[i] !== undefined ? row[i] : "");
  }
  return out;
}

function validateWrittenProduct_(ss, code) {
  const productCount = countRowsByFirstColumn_(ss.getSheetByName(CM_PRODUCTS_SHEET), code);
  const rowCount = countRowsByFirstColumn_(ss.getSheetByName(CM_CHECKLIST_ROWS_SHEET), code);
  const parallelCount = countRowsByFirstColumn_(ss.getSheetByName(CM_PARALLELS_SHEET), code);

  return {
    product_rows: productCount,
    checklist_rows: rowCount,
    parallel_rows: parallelCount,
    ok: productCount === 1 && rowCount > 0
  };
}

function countRowsByFirstColumn_(sh, code) {
  if (!sh) return 0;
  const values = sh.getDataRange().getValues();
  let count = 0;
  for (let i = 1; i < values.length; i++) {
    if (safeString_(values[i][0]).trim() === code) count++;
  }
  return count;
}

function ensureSheetWithHeaders_(ss, sheetName, defaultHeaders) {
  let sh = ss.getSheetByName(sheetName);
  if (!sh) sh = ss.insertSheet(sheetName);

  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, defaultHeaders.length).setValues([defaultHeaders]);
  }

  return sh;
}

function getHeaders_(sh) {
  const lastColumn = Math.max(sh.getLastColumn(), 1);
  return sh.getRange(1, 1, 1, lastColumn).getValues()[0].map(function(header) {
    return safeString_(header).trim();
  }).filter(Boolean);
}

function getPublishRecommendation_(sport, bucket) {
  const s = normalize_(sport);
  const b = safeString_(bucket || "").trim();
  if (s === "soccer" && b === "2025-26") return "publishCurrentSoccerChecklistToGitHub";
  if (s === "basketball" && b === "2025-26") return "publishCurrentBasketballChecklistToGitHub";
  if (s === "football" && b === "2026") return "publishCurrentFootballChecklistToGitHub";
  if (s === "baseball" && b === "2026") return "publishCurrentBaseballChecklistToGitHub";
  if (s === "hockey" && b === "2025") return "publishCurrentHockeyChecklistToGitHub";

  return "Run the matching publish function for " + s + " " + b + ", then rebuild the checklist index if this is a new product.";
}

function publishChecklistAfterImport_(product, key) {
  const exporterUrl = PropertiesService.getScriptProperties().getProperty(CM_STATIC_EXPORTER_URL_PROPERTY);
  if (!exporterUrl) {
    return {
      ok: false,
      skipped: true,
      error: "Missing Script Property " + CM_STATIC_EXPORTER_URL_PROPERTY + ". Sheet write completed, but publish was not run."
    };
  }

  const url = exporterUrl
    + (exporterUrl.indexOf("?") > -1 ? "&" : "?")
    + "action=publishChecklistAfterImport"
    + "&sport=" + encodeURIComponent(product.sport || "")
    + "&bucket=" + encodeURIComponent(product.target_bucket || product.year || "")
    + "&code=" + encodeURIComponent(product.code || "")
    + "&key=" + encodeURIComponent(key || "");

  const res = UrlFetchApp.fetch(url, {
    method: "get",
    muteHttpExceptions: true
  });

  const status = res.getResponseCode();
  const text = res.getContentText();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (err) {
    data = { raw: text };
  }

  if (status < 200 || status >= 300) {
    return {
      ok: false,
      status_code: status,
      error: "Static Data Exporter publish call failed with " + status,
      response: data
    };
  }

  return data;
}

function buildProductPreview_(title, sport, sourceUrl) {
  const cleanTitle = cleanProductTitle_(title);
  const yearMatch = cleanTitle.match(/\b(19|20)\d{2}(?:-\d{2})?\b/);
  const year = yearMatch ? yearMatch[0] : "";
  const manufacturer = inferManufacturer_(cleanTitle);
  const product = cleanTitle
    .replace(year, "")
    .replace(new RegExp("\\b" + sport + "\\b", "i"), "")
    .replace(new RegExp("\\b" + titleCase_(sport) + "\\b", "i"), "")
    .replace(new RegExp("\\b" + manufacturer + "\\b", "i"), "")
    .replace(/\s+/g, " ")
    .trim();

  return {
    code: buildProductCode_(cleanTitle, sport),
    display_name: cleanTitle,
    year: year,
    sport: sport,
    manufacturer: manufacturer,
    product: product,
    keywords: buildKeywordString_(cleanTitle, sport, manufacturer, product),
    source_url: sourceUrl,
    target_bucket: year || "current"
  };
}

function parseChecklistCenterArticle_(html, product) {
  const article = extractArticleHtml_(html);
  const chunks = splitArticleIntoH3Sections_(article);
  const rows = [];
  const parallels = [];
  const sections = [];
  const warnings = [];

  chunks.forEach(function(chunk) {
    const heading = cleanHeading_(chunk.heading);
    if (!heading || isNonChecklistHeading_(heading)) return;

    const subset = simplifySubsetName_(heading, product.display_name);
    const section = inferChecklistSection_(heading);
    const lines = htmlToLines_(chunk.html);
    const rowLines = lines.filter(isLikelyChecklistRow_);
    const sectionRows = rowLines.map(function(line) {
      return parseChecklistLine_(line, product, section, subset);
    }).filter(Boolean);
    const sectionParallels = extractParallelRows_(chunk.html, product, section, subset);

    if (sectionRows.length || sectionParallels.length) {
      sections.push({
        heading: heading,
        section: section,
        subset: subset,
        rows: sectionRows.length,
        parallels: sectionParallels.length
      });
    }

    Array.prototype.push.apply(rows, sectionRows);
    Array.prototype.push.apply(parallels, sectionParallels);
  });

  if (!rows.length) warnings.push("No checklist rows were parsed from the source page.");
  if (!parallels.length) warnings.push("No parallel rows were parsed from the source page.");

  return {
    rows: rows,
    parallels: dedupeParallelRows_(parallels),
    sections: sections,
    warnings: warnings
  };
}

function extractArticleHtml_(html) {
  const articleMatch = safeString_(html).match(/<article[\s\S]*?<\/article>/i);
  if (articleMatch) return articleMatch[0];

  const contentMatch = safeString_(html).match(/<div[^>]+class=["'][^"']*(entry-content|post-content|content)[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<footer/i);
  if (contentMatch) return contentMatch[0];

  return safeString_(html);
}

function splitArticleIntoH3Sections_(articleHtml) {
  const parts = safeString_(articleHtml).split(/<h3[^>]*>/i);
  const out = [];

  parts.slice(1).forEach(function(part) {
    const pieces = part.split(/<\/h3>/i);
    const heading = stripHtml_(pieces.shift() || "");
    const html = pieces.join("</h3>").split(/<h3[^>]*>/i)[0];
    out.push({
      heading: heading,
      html: html
    });
  });

  return out;
}

function htmlToLines_(html) {
  return decodeEntities_(safeString_(html))
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .split(/\n+/)
    .map(function(line) { return line.replace(/\s+/g, " ").trim(); })
    .filter(Boolean);
}

function isLikelyChecklistRow_(line) {
  const raw = safeString_(line).trim();
  if (!raw) return false;
  if (/^(Parallels?|Hobby|Configuration|Cards?\b|Serial Numbered|Find |Checklistcenter)/i.test(raw)) return false;
  if (/^\d+\s+Cards?\b/i.test(raw)) return false;
  return /^[A-Z]{0,8}[-A-Z0-9]*\d[A-Z0-9-]*\s+.+\s+-\s+.+/.test(raw);
}

function parseChecklistLine_(line, product, section, subset) {
  const raw = safeString_(line).trim();
  const m = raw.match(/^([A-Z]{0,8}[-A-Z0-9]*\d[A-Z0-9-]*)\s+(.+?)\s+-\s+(.+)$/);
  if (!m) return null;

  return {
    code: product.code,
    sport: product.sport,
    section: section,
    subset: subset,
    card_no: m[1].trim(),
    player: cleanPlayerName_(m[2]),
    team: cleanTeamName_(m[3]),
    tag: inferRowTag_(section, subset, m[2])
  };
}

function extractParallelRows_(html, product, section, subset) {
  const out = [];
  const text = decodeEntities_(safeString_(html)).replace(/\s+/g, " ");
  const re = /<strong>\s*Parallels:\s*<\/strong>\s*([^<]+)/gi;
  let match;

  while ((match = re.exec(text)) !== null) {
    const list = safeString_(match[1])
      .replace(/\.$/, "")
      .split(";")
      .map(function(part) { return part.trim(); })
      .filter(Boolean);

    list.forEach(function(label) {
      out.push({
        code: product.code,
        sport: product.sport,
        applies_to_section: section,
        applies_to_subset: subset,
        parallel_name: label.replace(/\s*#?\/?\d+\s*$/g, "").replace(/\s*1\/1\s*$/i, "").trim() || label,
        serial_no: extractSerialText_(label)
      });
    });
  }

  return out;
}

function dedupeParallelRows_(rows) {
  const seen = {};
  const out = [];

  rows.forEach(function(row) {
    const key = [
      row.code,
      row.applies_to_section,
      row.applies_to_subset,
      row.parallel_name,
      row.serial_no
    ].join("|");
    if (seen[key]) return;
    seen[key] = true;
    out.push(row);
  });

  return out;
}

function extractSerialText_(label) {
  const raw = safeString_(label);
  let m = raw.match(/#?\/\s*(\d+)/);
  if (m) return "#/" + m[1];
  if (/1\/1/.test(raw)) return "1/1";
  if (/one\s*of\s*one/i.test(raw)) return "1/1";
  return "";
}

function extractPageTitle_(html) {
  const h1 = safeString_(html).match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return cleanProductTitle_(stripHtml_(h1[1]));

  const title = safeString_(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) return cleanProductTitle_(stripHtml_(title[1]));

  return "";
}

function cleanProductTitle_(title) {
  return decodeEntities_(safeString_(title))
    .replace(/\s*-\s*Checklistcenter\.com\s*$/i, "")
    .replace(/\s*[-–]\s*(Baseball|Basketball|Football|Hockey|Soccer)\s*Card\s*Checklist\s*$/i, " $1")
    .replace(/\s*Card\s*Checklist\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanHeading_(heading) {
  return decodeEntities_(safeString_(heading)).replace(/\s+/g, " ").trim();
}

function isNonChecklistHeading_(heading) {
  return /configuration|box break|overview|release date/i.test(heading);
}

function simplifySubsetName_(heading, displayName) {
  let subset = safeString_(heading);
  const productBase = safeString_(displayName)
    .replace(/\b(Baseball|Basketball|Football|Hockey|Soccer)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  subset = subset.replace(productBase, "");
  subset = subset.replace(/\b(19|20)\d{2}(?:-\d{2})?\b/g, "");
  subset = subset.replace(/\bPanini\b|\bTopps\b|\bUpper Deck\b|\bBowman\b/gi, "");
  subset = subset.replace(/\bNoir\b|\bRoad to FIFA\b|\bWorld Cup 26\b|\bSoccer\b/gi, "");
  subset = subset.replace(/[–-]/g, " ");
  subset = subset.replace(/\s+/g, " ").trim();

  return subset || heading;
}

function inferChecklistSection_(heading) {
  const h = normalize_(heading);
  if (/auto|autograph|signature|scripts|ink|endorsed|spotlight signatures/.test(h)) return "Autographs";
  if (/relic|material|memorabilia|patch|jumbo|swatch/.test(h)) return "Relics";
  if (/variation|short print|ssp|sp\b/.test(h)) return "Variations";
  if (/insert|night moves|sneaker|color blast|downtown|stained glass|features|framed|vintage/.test(h)) return "Inserts";
  if (/base/.test(h)) return "Base";
  return "Inserts";
}

function inferRowTag_(section, subset, player) {
  const hay = normalize_([section, subset, player].join(" "));
  const tags = [];
  if (/rookie| rc\b/.test(hay)) tags.push("RC");
  if (/auto|autograph|signature|scripts|ink/.test(hay)) tags.push("AUTO");
  if (/relic|material|memorabilia|patch|swatch/.test(hay)) tags.push("RELIC");
  if (/ssp|short print/.test(hay)) tags.push("SSP");
  return tags.join(", ");
}

function cleanPlayerName_(value) {
  return decodeEntities_(safeString_(value)).replace(/\s+/g, " ").trim();
}

function cleanTeamName_(value) {
  return decodeEntities_(safeString_(value)).replace(/\s+/g, " ").trim();
}

function inferManufacturer_(title) {
  const raw = safeString_(title);
  if (/Topps/i.test(raw)) return "Topps";
  if (/Bowman/i.test(raw)) return "Bowman";
  if (/Panini/i.test(raw)) return "Panini";
  if (/Upper Deck/i.test(raw)) return "Upper Deck";
  if (/O-Pee-Chee|O Pee Chee/i.test(raw)) return "Upper Deck";
  return "";
}

function buildProductCode_(title, sport) {
  return normalize_(title)
    .replace(/\b(19|20)(\d{2})-(\d{2})\b/g, "$1$2_$3")
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    + (normalize_(title).indexOf(normalize_(sport)) > -1 ? "" : "_" + normalize_(sport));
}

function buildKeywordString_(title, sport, manufacturer, product) {
  return [
    title,
    title + " checklist",
    title + " cards",
    title + " parallels",
    title + " autographs",
    [manufacturer, product, sport].filter(Boolean).join(" "),
    [product, sport, "checklist"].filter(Boolean).join(" ")
  ].filter(Boolean).join(", ");
}

function fetchText_(url) {
  const res = UrlFetchApp.fetch(url, {
    method: "get",
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      "User-Agent": "ChasingMajorsCommandCenter/1.0"
    }
  });

  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error("Fetch failed " + code + " for " + url);
  }

  return res.getContentText();
}

function buildMissingRecommendedAction_(title, sport) {
  return "Create approval task: inspect source checklist, import into " + titleCase_(sport) + " source sheet, publish that source, rebuild index if product is new, then retest search.";
}

function normalizeTitleFromLink_(value) {
  let title = stripHtml_(value);
  title = title.replace(/\s+/g, " ").trim();

  if (!title || title.length < 8) return "";

  title = title
    .replace(/\s*[-–]\s*Soccer Card Checklist\s*$/i, " Soccer")
    .replace(/\s*[-–]\s*Basketball Card Checklist\s*$/i, " Basketball")
    .replace(/\s*[-–]\s*Baseball Card Checklist\s*$/i, " Baseball")
    .replace(/\s*[-–]\s*Football Card Checklist\s*$/i, " Football")
    .replace(/\s*[-–]\s*Hockey Card Checklist\s*$/i, " Hockey")
    .replace(/\s*Card Checklist\s*$/i, "")
    .replace(/\s*Checklist\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  return title;
}

function titleFromChecklistCenterHref_(href) {
  const raw = safeString_(href).split("?")[0].replace(/\/$/, "");
  const slug = raw.split("/").pop() || "";
  if (!slug || !/card-checklist$/i.test(slug)) return "";

  return slug
    .replace(/-card-checklist$/i, "")
    .split("-")
    .filter(Boolean)
    .map(function(part) {
      if (/^\d{4}$/.test(part)) return part;
      if (/^\d{2}$/.test(part)) return part;
      if (part.toLowerCase() === "nba") return "NBA";
      if (part.toLowerCase() === "wnba") return "WNBA";
      if (part.toLowerCase() === "mls") return "MLS";
      if (part.toLowerCase() === "uefa") return "UEFA";
      if (part.toLowerCase() === "fifa") return "FIFA";
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ")
    .replace(/\b26\b/g, "26")
    .replace(/\s+/g, " ")
    .trim();
}

function inferSport_(value) {
  const text = normalize_(value);
  for (let i = 0; i < CM_ALLOWED_SPORTS.length; i++) {
    if (text.indexOf(CM_ALLOWED_SPORTS[i]) > -1) return CM_ALLOWED_SPORTS[i];
  }

  if (text.indexOf("premier league") > -1 || text.indexOf("uefa") > -1 || text.indexOf("mls") > -1 || text.indexOf("soccer") > -1) return "soccer";
  if (text.indexOf("nba") > -1 || text.indexOf("wnba") > -1 || text.indexOf("euroleague") > -1) return "basketball";
  if (text.indexOf("nfl") > -1) return "football";
  if (text.indexOf("mlb") > -1) return "baseball";
  if (text.indexOf("nhl") > -1) return "hockey";

  return "";
}

function isAllowedSport_(sport) {
  return CM_ALLOWED_SPORTS.indexOf(normalize_(sport)) > -1;
}

function hasBlockedTerm_(value) {
  const text = normalize_(value);
  return CM_BLOCKED_TERMS.some(function(term) {
    return text.indexOf(normalize_(term)) > -1;
  });
}

function absoluteChecklistCenterUrl_(href) {
  const raw = safeString_(href).trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.charAt(0) === "/") return CM_CHECKLISTCENTER_HOME.replace(/\/$/, "") + raw;
  return CM_CHECKLISTCENTER_HOME + raw;
}

function stripHtml_(value) {
  return decodeEntities_(safeString_(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities_(value) {
  return safeString_(value)
    .replace(/&amp;/g, "&")
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/&#8212;|&mdash;/g, "-")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8220;|&ldquo;/g, "\"")
    .replace(/&#8221;|&rdquo;/g, "\"")
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, function(match, code) {
      return String.fromCharCode(Number(code));
    });
}

function normalize_(value) {
  return safeString_(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\w\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase_(value) {
  return safeString_(value).replace(/\b\w/g, function(c) {
    return c.toUpperCase();
  });
}

function parseBody_(e) {
  try {
    return JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return {};
  }
}

function safeString_(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
