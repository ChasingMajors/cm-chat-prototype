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
 * - dispatchVisualProductTest
 * - getVisualProductTestStatus
 * - loadAgentMemory
 * - saveAgentMemory
 * - runScheduledSourceWatch
 *
 * Current safety:
 * - Sheet writes require Script Property CM_OPERATOR_KEY.
 * - GitHub workflow dispatch requires CM_OPERATOR_KEY and CM_GITHUB_TOKEN.
 * - Source import writes are idempotent by product code.
 *******************************************************/

const CM_OPERATOR_VERSION = "2026-05-15-operator-v2";
const CM_APP_DATA_BASE = "https://app.chasingmajors.com/data/v1";
const CM_CHECKLISTCENTER_HOME = "https://www.checklistcenter.com/";
const CM_CHECKLISTCENTER_POSTS_API = "https://www.checklistcenter.com/wp-json/wp/v2/posts?per_page=20&_fields=link,title,date,slug";
const CM_ALLOWED_SPORTS = ["baseball", "football", "basketball", "hockey", "soccer"];
const CM_PRODUCTS_SHEET = "Products";
const CM_CHECKLIST_ROWS_SHEET = "ChecklistRows";
const CM_PARALLELS_SHEET = "Parallels";
const CM_OPERATOR_KEY_PROPERTY = "CM_OPERATOR_KEY";
const CM_STATIC_EXPORTER_URL_PROPERTY = "CM_STATIC_EXPORTER_URL";
const CM_GITHUB_TOKEN_PROPERTY = "CM_GITHUB_TOKEN";
const CM_VISUAL_TEST_CHATBOT_BASE_PROPERTY = "CM_VISUAL_TEST_CHATBOT_BASE";
const CM_VISUAL_TEST_CHECKLIST_BASE_PROPERTY = "CM_VISUAL_TEST_CHECKLIST_BASE";
const CM_VISUAL_TEST_OWNER = "ChasingMajors";
const CM_VISUAL_TEST_REPO = "cm-chat-prototype";
const CM_VISUAL_TEST_WORKFLOW = "visual-product-test.yml";
const CM_VISUAL_TEST_BRANCH = "main";
const CM_AGENT_MEMORY_BRANCH = "command-center-memory";
const CM_AGENT_MEMORY_PATH = "data/command-center/agent-memory.json";
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

    if (action === "sourceWatch") return json_(runSourceWatch_(p.mode || ""));

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

    if (action === "dispatchVisualProductTest") {
      return json_(dispatchVisualProductTest_({
        productName: p.productName || p.product_name || "",
        sport: p.sport || "",
        code: p.code || p.productCode || p.product_code || "",
        key: p.key || ""
      }));
    }

    if (action === "getVisualProductTestStatus") {
      return json_(getVisualProductTestStatus_({
        productName: p.productName || p.product_name || "",
        sport: p.sport || "",
        code: p.code || p.productCode || p.product_code || "",
        startedAt: p.startedAt || p.started_at || "",
        key: p.key || ""
      }));
    }

    if (action === "loadAgentMemory") {
      return json_(loadAgentMemory_({ key: p.key || "" }));
    }

    if (action === "runScheduledSourceWatch") {
      return json_(runScheduledSourceWatch_({
        mode: p.mode || "",
        key: p.key || ""
      }));
    }

    return json_({
      ok: false,
      error: "Unknown action",
      supported_actions: ["health", "sourceWatch", "validateSourceProduct", "previewSourceImport", "executeSourceImport", "dispatchVisualProductTest", "getVisualProductTestStatus", "loadAgentMemory", "saveAgentMemory", "runScheduledSourceWatch"]
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
    if (action === "sourceWatch") return json_(runSourceWatch_(body.mode || ""));

    if (action === "validateSourceProduct") {
      return json_(validateSourceProduct_(body));
    }

    if (action === "previewSourceImport") {
      return json_(previewSourceImport_(body));
    }

    if (action === "executeSourceImport") {
      return json_(executeSourceImport_(body));
    }

    if (action === "dispatchVisualProductTest") {
      return json_(dispatchVisualProductTest_(body));
    }

    if (action === "getVisualProductTestStatus") {
      return json_(getVisualProductTestStatus_(body));
    }

    if (action === "loadAgentMemory") {
      return json_(loadAgentMemory_(body));
    }

    if (action === "saveAgentMemory") {
      return json_(saveAgentMemory_(body));
    }

    if (action === "runScheduledSourceWatch") {
      return json_(runScheduledSourceWatch_(body));
    }

    return json_({
      ok: false,
      error: "Unknown action",
      supported_actions: ["sourceWatch", "validateSourceProduct", "previewSourceImport", "executeSourceImport", "dispatchVisualProductTest", "getVisualProductTestStatus", "loadAgentMemory", "saveAgentMemory", "runScheduledSourceWatch"]
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

function runSourceWatch_(mode) {
  const auditMode = normalizeSourceWatchMode_(mode);
  const indexRows = fetchChecklistIndex_(auditMode);
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
    mode: auditMode,
    coverage_source: auditMode === "quick_json" ? "public_json" : "google_sheets",
    source: "checklistcenter",
    source_url: CM_CHECKLISTCENTER_HOME,
    fetched_count: sourceItems.length,
    supported_count: results.filter(function(r) { return r.status !== "ignored"; }).length,
    summary: summary,
    items: results,
    next_step: auditMode === "quick_json"
      ? "Quick JSON review is for daily triage. Use Deep Sheets Audit before any approved sheet write."
      : "Deep Sheets Audit checks source Google Sheets. Missing or needs_review items should become approval tasks before any sheet write.",
    updated_at: new Date().toISOString()
  };
}

function normalizeSourceWatchMode_(mode) {
  const raw = normalize_(mode || "");
  if (raw === "quick" || raw === "json" || raw === "quick_json") return "quick_json";
  if (raw === "deep" || raw === "sheets" || raw === "google_sheets" || raw === "deep_sheets") return "deep_sheets";
  return "deep_sheets";
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
  const wpItems = fetchRecentChecklistCenterItemsFromApi_();
  const homeItems = fetchRecentChecklistCenterItemsFromHome_();
  return mergeSourceItems_(wpItems.concat(homeItems)).slice(0, 40);
}

function fetchRecentChecklistCenterItemsFromApi_() {
  try {
    const posts = JSON.parse(fetchText_(CM_CHECKLISTCENTER_POSTS_API));
    if (!Array.isArray(posts)) return [];

    return posts.map(function(post) {
      const titleRaw = post && post.title && post.title.rendered ? post.title.rendered : "";
      const title = normalizeTitleFromLink_(titleRaw || titleFromChecklistCenterHref_(post && post.link));
      const url = absoluteChecklistCenterUrl_(post && post.link);
      const sport = inferSport_(title + " " + url);

      return {
        title: title,
        sport: sport,
        url: url,
        source_text: stripHtml_(titleRaw),
        discovery_source: "wordpress_api",
        published_at: safeString_(post && post.date)
      };
    }).filter(isUsableSourceItem_);
  } catch (err) {
    return [];
  }
}

function fetchRecentChecklistCenterItemsFromHome_() {
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
      source_text: link.text || "",
      discovery_source: "homepage_html"
    };
  });

  return Object.keys(deduped)
    .map(function(key) { return deduped[key]; })
    .filter(isUsableSourceItem_)
    .slice(0, 40);
}

function mergeSourceItems_(items) {
  const deduped = {};
  (items || []).forEach(function(item) {
    const key = normalize_(item && item.url) || normalize_(item && item.title);
    if (!key || deduped[key]) return;
    deduped[key] = item;
  });
  return Object.keys(deduped).map(function(key) { return deduped[key]; });
}

function isUsableSourceItem_(item) {
  return !!(item && item.title && (isAllowedSport_(item.sport) || hasBlockedTerm_(item.title) || item.url));
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
    if (Number(match.row_count || 0) <= 0) {
      return {
        status: "needs_review",
        title: title,
        sport: sport,
        source_url: item.url || "",
        matched_name: match.name,
        matched_code: match.code,
        match_score: match.score,
        sheet_row_count: Number(match.row_count || 0),
        sheet_parallel_count: Number(match.parallel_count || 0),
        comparison_source: match.comparison_source || "google_sheets",
        discovery_source: item.discovery_source || "",
        recommended_action: "Product row exists in Google Sheets, but source Google Sheet has no checklist rows. Import or rebuild this product before calling it covered."
      };
    }

    return {
      status: "covered",
      title: title,
      sport: sport,
      source_url: item.url || "",
      matched_name: match.name,
      matched_code: match.code,
      match_score: match.score,
      sheet_row_count: Number(match.row_count || 0),
      sheet_parallel_count: Number(match.parallel_count || 0),
      comparison_source: match.comparison_source || "google_sheets",
      discovery_source: item.discovery_source || "",
      recommended_action: "No import needed unless source has newer rows/parallels than the source Google Sheet."
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
      sheet_row_count: Number(match.row_count || 0),
      sheet_parallel_count: Number(match.parallel_count || 0),
      comparison_source: match.comparison_source || "google_sheets",
      discovery_source: item.discovery_source || "",
      recommended_action: "Review naming/alias match before import."
    };
  }

  return {
    status: "missing",
    title: title,
    sport: sport,
    source_url: item.url || "",
    discovery_source: item.discovery_source || "",
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
        code: code,
        row_count: Number(row.row_count || row.checklist_row_count || 0),
        parallel_count: Number(row.parallel_count || row.parallel_row_count || 0),
        comparison_source: row.comparison_source || "google_sheets",
        spreadsheet_id: row.spreadsheet_id || "",
        source_key: row.source_key || ""
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

function fetchChecklistIndex_(mode) {
  const auditMode = normalizeSourceWatchMode_(mode || "deep_sheets");
  if (auditMode === "quick_json") return fetchChecklistPublicJsonRows_();
  return fetchChecklistSourceRows_();
}

function fetchChecklistPublicJsonRows_() {
  const data = JSON.parse(fetchText_(CM_APP_DATA_BASE + "/checklists/index.json"));
  const rows = data.index || data.rows || [];

  return rows.map(function(row) {
    return Object.assign({}, row, {
      comparison_source: "public_json",
      row_count: Number(row.row_count || row.checklist_row_count || 1),
      parallel_count: Number(row.parallel_count || row.parallel_row_count || 0)
    });
  });
}

function fetchChecklistSourceRows_() {
  const out = [];
  const seenSpreadsheets = {};

  Object.keys(CM_CHECKLIST_SOURCE_MAP || {}).forEach(function(sport) {
    const sourceMap = CM_CHECKLIST_SOURCE_MAP[sport] || {};

    Object.keys(sourceMap).forEach(function(sourceKey) {
      const spreadsheetId = sourceMap[sourceKey];
      if (!spreadsheetId || seenSpreadsheets[spreadsheetId]) return;
      seenSpreadsheets[spreadsheetId] = true;

      const ss = SpreadsheetApp.openById(spreadsheetId);
      const checklistCounts = countRowsByCodeMap_(ss.getSheetByName(CM_CHECKLIST_ROWS_SHEET));
      const parallelCounts = countRowsByCodeMap_(ss.getSheetByName(CM_PARALLELS_SHEET));
      const products = readSheetObjects_(ss.getSheetByName(CM_PRODUCTS_SHEET));

      products.forEach(function(row) {
        const code = safeString_(pickField_(row, ["code", "Code"])).trim();
        if (!code) return;

        out.push({
          Code: code,
          DisplayName: safeString_(pickField_(row, ["display_name", "displayName", "DisplayName", "name"])).trim(),
          Keywords: safeString_(pickField_(row, ["keywords", "Keywords"])).trim(),
          year: safeString_(pickField_(row, ["year", "Year"])).trim(),
          sport: normalize_(pickField_(row, ["sport", "Sport"]) || sport),
          manufacturer: safeString_(pickField_(row, ["manufacturer", "Manufacturer"])).trim(),
          product: safeString_(pickField_(row, ["product", "Product"])).trim(),
          row_count: checklistCounts[code] || 0,
          parallel_count: parallelCounts[code] || 0,
          spreadsheet_id: spreadsheetId,
          source_key: sourceKey,
          comparison_source: "google_sheets"
        });
      });
    });
  });

  return out;
}

function readSheetObjects_(sh) {
  if (!sh) return [];
  const values = sh.getDataRange().getDisplayValues();
  if (!values || values.length < 2) return [];

  const headers = values[0].map(function(header) {
    return safeString_(header).trim();
  });

  return values.slice(1)
    .filter(function(row) {
      return row.some(function(cell) {
        return safeString_(cell).trim() !== "";
      });
    })
    .map(function(row) {
      const obj = {};
      headers.forEach(function(header, index) {
        if (!header) return;
        obj[header] = row[index];
        obj[normalizeHeader_(header)] = row[index];
      });
      return obj;
    });
}

function pickField_(obj, candidates) {
  for (let i = 0; i < candidates.length; i++) {
    const key = safeString_(candidates[i]);
    const normalizedKey = normalizeHeader_(key);
    if (Object.prototype.hasOwnProperty.call(obj || {}, key)) return obj[key];
    if (Object.prototype.hasOwnProperty.call(obj || {}, normalizedKey)) return obj[normalizedKey];
  }
  return "";
}

function normalizeHeader_(header) {
  return safeString_(header)
    .trim()
    .toLowerCase()
    .replace(/[^\w]+/g, "");
}

function countRowsByCodeMap_(sh) {
  const out = {};
  if (!sh) return out;

  const values = sh.getDataRange().getDisplayValues();
  for (let i = 1; i < values.length; i++) {
    const code = safeString_(values[i][0]).trim();
    if (!code) continue;
    out[code] = (out[code] || 0) + 1;
  }

  return out;
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
  const rowsToWrite = objects.map(function(obj) {
    return headers.map(function(header) {
      return safeString_(obj[header] || "");
    });
  });

  validateSheetWriteRows_(rowsToWrite, headers.length, sheetName);

  const existingRowNumbers = getRowNumbersByFirstColumnValue_(sh, code);
  const updateCount = Math.min(existingRowNumbers.length, rowsToWrite.length);

  for (let i = 0; i < updateCount; i++) {
    sh.getRange(existingRowNumbers[i], 1, 1, headers.length).setNumberFormat("@");
    sh.getRange(existingRowNumbers[i], 1, 1, headers.length).setValues([rowsToWrite[i]]);
  }

  const rowsToAppend = rowsToWrite.slice(updateCount);
  if (rowsToAppend.length) {
    const startRow = sh.getLastRow() + 1;
    sh.getRange(startRow, 1, rowsToAppend.length, headers.length).setNumberFormat("@");
    sh.getRange(startRow, 1, rowsToAppend.length, headers.length).setValues(rowsToAppend);
  }
}

function validateSheetWriteRows_(rows, width, sheetName) {
  rows.forEach(function(row, index) {
    if (!Array.isArray(row) || row.length !== width) {
      throw new Error("Prepared row width mismatch for " + sheetName + " at row " + (index + 1) + ".");
    }
  });
}

function getRowNumbersByFirstColumnValue_(sh, code) {
  const out = [];
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return out;

  const values = sh.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (safeString_(values[i][0]).trim() === code) {
      out.push(i + 2);
    }
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

function dispatchVisualProductTest_(input) {
  requireOperatorKey_(input && input.key);

  const productName = safeString_(input && (input.productName || input.product_name)).trim();
  const sport = normalize_(input && input.sport);
  const code = safeString_(input && (input.code || input.productCode || input.product_code)).trim();
  const startedAt = new Date().toISOString();

  if (!productName) {
    return {
      ok: false,
      error: "Missing productName"
    };
  }

  if (!isAllowedSport_(sport)) {
    return {
      ok: false,
      error: "Unsupported or missing sport"
    };
  }

  const token = PropertiesService.getScriptProperties().getProperty(CM_GITHUB_TOKEN_PROPERTY);
  if (!token) {
    return {
      ok: false,
      error: "Missing Script Property " + CM_GITHUB_TOKEN_PROPERTY + ". Add a GitHub token with Actions workflow permission."
    };
  }

  const apiUrl = githubApiUrl_("/actions/workflows/" + encodeURIComponent(CM_VISUAL_TEST_WORKFLOW) + "/dispatches");

  const payload = {
    ref: CM_VISUAL_TEST_BRANCH,
    inputs: {
      product_name: productName,
      sport: sport,
      product_code: code,
      app_base: "https://app.chasingmajors.com",
      chatbot_base: getScriptPropertyWithDefault_(CM_VISUAL_TEST_CHATBOT_BASE_PROPERTY, "https://app.chasingmajors.com/ChatBot"),
      checklist_base: getScriptPropertyWithDefault_(CM_VISUAL_TEST_CHECKLIST_BASE_PROPERTY, "https://app.chasingmajors.com")
    }
  };

  const res = githubFetch_(apiUrl, token, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload)
  });

  const status = res.getResponseCode();
  const text = res.getContentText();
  let response = {};
  try {
    response = text ? JSON.parse(text) : {};
  } catch (err) {
    response = { raw: text };
  }

  if (status < 200 || status >= 300) {
    return {
      ok: false,
      status_code: status,
      error: "GitHub workflow dispatch failed with " + status,
      response: response
    };
  }

  const workflowUrl = "https://github.com/"
    + CM_VISUAL_TEST_OWNER
    + "/"
    + CM_VISUAL_TEST_REPO
    + "/actions/workflows/"
    + CM_VISUAL_TEST_WORKFLOW;

  return {
    ok: true,
    status: "queued",
    product_name: productName,
    sport: sport,
    product_code: code,
    started_at: startedAt,
    tracking_key: buildVisualProductTrackingKey_(productName, sport, code),
    workflow_url: workflowUrl,
    actions_url: "https://github.com/" + CM_VISUAL_TEST_OWNER + "/" + CM_VISUAL_TEST_REPO + "/actions",
    note: "Visual product test queued. GitHub may take a few seconds to show the new run."
  };
}

function getVisualProductTestStatus_(input) {
  requireOperatorKey_(input && input.key);

  const productName = safeString_(input && (input.productName || input.product_name)).trim();
  const sport = normalize_(input && input.sport);
  const code = safeString_(input && (input.code || input.productCode || input.product_code)).trim();
  const startedAt = safeString_(input && (input.startedAt || input.started_at)).trim();

  if (!productName) {
    return {
      ok: false,
      error: "Missing productName"
    };
  }

  const token = PropertiesService.getScriptProperties().getProperty(CM_GITHUB_TOKEN_PROPERTY);
  if (!token) {
    return {
      ok: false,
      error: "Missing Script Property " + CM_GITHUB_TOKEN_PROPERTY + ". Add a GitHub token with Actions workflow permission."
    };
  }

  const apiUrl = githubApiUrl_("/actions/workflows/" + encodeURIComponent(CM_VISUAL_TEST_WORKFLOW) + "/runs?event=workflow_dispatch&per_page=25");
  const res = githubFetch_(apiUrl, token, { method: "get" });
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
      error: "GitHub workflow status lookup failed with " + status,
      response: data
    };
  }

  const run = findVisualProductRun_(data.workflow_runs || [], productName, startedAt);
  if (!run) {
    return {
      ok: true,
      status: "queued",
      conclusion: "",
      product_name: productName,
      sport: sport,
      product_code: code,
      tracking_key: buildVisualProductTrackingKey_(productName, sport, code),
      note: "No matching GitHub run is visible yet."
    };
  }

  return {
    ok: true,
    status: run.status || "",
    conclusion: run.conclusion || "",
    result: run.conclusion === "success"
      ? "passed"
      : run.conclusion === "failure"
        ? "failed"
        : (run.status || "running"),
    product_name: productName,
    sport: sport,
    product_code: code,
    tracking_key: buildVisualProductTrackingKey_(productName, sport, code),
    run_id: run.id || "",
    run_number: run.run_number || "",
    run_url: run.html_url || "",
    created_at: run.created_at || "",
    updated_at: run.updated_at || "",
    head_sha: run.head_sha || "",
    display_title: run.display_title || run.name || ""
  };
}

function findVisualProductRun_(runs, productName, startedAt) {
  const target = normalize_(productName);
  const startedMs = startedAt ? Date.parse(startedAt) : 0;

  const matches = (runs || []).filter(function(run) {
    const title = normalize_(run.display_title || run.name || "");
    if (target && title.indexOf(target) === -1) return false;

    if (startedMs) {
      const createdMs = Date.parse(run.created_at || "");
      if (Number.isFinite(createdMs) && createdMs < startedMs - 120000) return false;
    }

    return true;
  });

  return matches.length ? matches[0] : null;
}

function buildVisualProductTrackingKey_(productName, sport, code) {
  return [
    normalize_(sport || ""),
    safeString_(code || "").trim() || normalize_(productName || "")
  ].filter(Boolean).join("|");
}

function loadAgentMemory_(input) {
  requireOperatorKey_(input && input.key);

  const token = PropertiesService.getScriptProperties().getProperty(CM_GITHUB_TOKEN_PROPERTY);
  if (!token) throw new Error("Missing Script Property " + CM_GITHUB_TOKEN_PROPERTY + ".");

  const existing = getGitHubContentFile_(CM_AGENT_MEMORY_PATH, token, CM_AGENT_MEMORY_BRANCH);
  if (!existing.exists) {
    return {
      ok: true,
      has_memory: false,
      memory: null,
      path: CM_AGENT_MEMORY_PATH,
      updated_at: new Date().toISOString()
    };
  }

  let memory = {};
  try {
    memory = JSON.parse(existing.text || "{}");
  } catch (err) {
    throw new Error("Saved agent memory JSON could not be parsed.");
  }

  return {
    ok: true,
    has_memory: true,
    memory: memory,
    path: CM_AGENT_MEMORY_PATH,
    sha: existing.sha || "",
    updated_at: new Date().toISOString()
  };
}

function saveAgentMemory_(input) {
  requireOperatorKey_(input && input.key);

  const memory = input && input.memory;
  if (!memory || memory.schema !== "agent_memory_v1") {
    throw new Error("Missing valid agent memory payload.");
  }

  const token = PropertiesService.getScriptProperties().getProperty(CM_GITHUB_TOKEN_PROPERTY);
  if (!token) throw new Error("Missing Script Property " + CM_GITHUB_TOKEN_PROPERTY + ".");

  const payload = shallowClone_(memory);
  payload.saved_at = new Date().toISOString();
  payload.saved_by = "cm_command_center_operator";

  ensureGitHubBranch_(CM_AGENT_MEMORY_BRANCH, token);
  const result = putGitHubContentJson_(CM_AGENT_MEMORY_PATH, payload, token, "Save Command Center agent memory", CM_AGENT_MEMORY_BRANCH);

  return {
    ok: true,
    path: CM_AGENT_MEMORY_PATH,
    sha: result.sha || "",
    commit: result.commit || "",
    saved_at: payload.saved_at
  };
}

function runScheduledSourceWatch_(input) {
  requireOperatorKey_(input && input.key);

  const mode = input && input.mode ? input.mode : "deep_sheets";
  const watch = runSourceWatch_(mode);
  const actionable = (watch.items || []).filter(function(item) {
    return item.status === "missing" || item.status === "needs_review" || item.status === "possible_update";
  });
  const memory = loadOrCreateAgentMemoryForSchedule_(input && input.key);
  const now = new Date().toISOString();

  memory.agent_actions = mergeScheduledSourceActions_(memory.agent_actions || [], actionable, now, watch.mode);
  memory.activity_log = prependMemoryActivity_(memory.activity_log || [], {
    id: "log_" + Date.now(),
    ts: now,
    type: "source_watch",
    title: "Scheduled Source Watch complete",
    detail: actionable.length + " actionable source items found from " + watch.coverage_source + ".",
    status: actionable.length ? "needs_review" : "clear",
    product: "",
    source: "operator_backend"
  });
  memory.saved_at = now;

  const saveResult = saveAgentMemory_({
    key: input && input.key,
    memory: memory
  });

  return {
    ok: true,
    mode: watch.mode,
    coverage_source: watch.coverage_source,
    fetched_count: watch.fetched_count,
    actionable_count: actionable.length,
    summary: watch.summary || {},
    memory_path: saveResult.path,
    memory_sha: saveResult.sha,
    updated_at: now
  };
}

function loadOrCreateAgentMemoryForSchedule_(key) {
  const loaded = loadAgentMemory_({ key: key });
  if (loaded && loaded.has_memory && loaded.memory) return loaded.memory;

  return {
    ok: true,
    app: "chasing_majors_command_center",
    schema: "agent_memory_v1",
    autonomy_mode: "approval_required",
    approvals: {},
    tasks: [],
    agent_actions: [],
    activity_log: [],
    visual_tests: {},
    known_issues: {},
    operator_endpoint: ""
  };
}

function mergeScheduledSourceActions_(existingActions, sourceItems, now, mode) {
  const out = Array.isArray(existingActions) ? existingActions.slice() : [];
  const byId = {};

  out.forEach(function(action) {
    if (action && action.id) byId[action.id] = action;
  });

  sourceItems.forEach(function(item) {
    const id = "source_watch|" + normalize_(item.sport || "") + "|" + normalize_(item.matched_code || item.title || "");
    const existing = byId[id];
    const patch = {
      id: id,
      type: "source_import",
      source: "scheduled_" + mode,
      product: item.matched_name || item.title || "",
      sport: item.sport || "",
      code: item.matched_code || "",
      riskLevel: item.status === "missing" ? "medium" : "low",
      status: "approval_required",
      recommendedAction: item.recommended_action || "Review source item, preview import, then approve product-scoped write.",
      adminDecision: "",
      executionResult: "",
      validationResult: "",
      runUrl: "",
      sourceUrl: item.url || item.source_url || "",
      createdAt: existing && existing.createdAt ? existing.createdAt : now,
      updatedAt: now
    };

    if (existing) Object.assign(existing, patch);
    else {
      byId[id] = patch;
      out.unshift(patch);
    }
  });

  return out.slice(0, 80);
}

function prependMemoryActivity_(activityLog, entry) {
  const out = Array.isArray(activityLog) ? activityLog.slice() : [];
  out.unshift(entry);
  return out.slice(0, 80);
}

function githubApiUrl_(path) {
  return "https://api.github.com/repos/"
    + encodeURIComponent(CM_VISUAL_TEST_OWNER)
    + "/"
    + encodeURIComponent(CM_VISUAL_TEST_REPO)
    + path;
}

function githubFetch_(url, token, options) {
  const opts = options || {};
  const headers = opts.headers || {};
  headers.Authorization = "Bearer " + token;
  headers.Accept = "application/vnd.github+json";
  headers["X-GitHub-Api-Version"] = "2022-11-28";

  return UrlFetchApp.fetch(url, Object.assign({}, opts, {
    muteHttpExceptions: true,
    headers: headers
  }));
}

function ensureGitHubBranch_(branch, token) {
  const targetBranch = safeString_(branch || CM_VISUAL_TEST_BRANCH).trim();
  const branchRefUrl = githubApiUrl_("/git/ref/heads/" + encodeURIComponent(targetBranch));
  const branchRes = githubFetch_(branchRefUrl, token, { method: "get" });
  if (branchRes.getResponseCode() >= 200 && branchRes.getResponseCode() < 300) return;
  if (branchRes.getResponseCode() !== 404) {
    throw new Error("GitHub branch lookup failed with " + branchRes.getResponseCode() + ": " + branchRes.getContentText());
  }

  const mainRefUrl = githubApiUrl_("/git/ref/heads/" + encodeURIComponent(CM_VISUAL_TEST_BRANCH));
  const mainRes = githubFetch_(mainRefUrl, token, { method: "get" });
  const mainStatus = mainRes.getResponseCode();
  const mainText = mainRes.getContentText();
  if (mainStatus < 200 || mainStatus >= 300) {
    throw new Error("GitHub main branch lookup failed with " + mainStatus + ": " + mainText);
  }

  const mainData = JSON.parse(mainText || "{}");
  const sha = mainData && mainData.object && mainData.object.sha;
  if (!sha) throw new Error("Could not resolve main branch SHA for memory branch.");

  const createRes = githubFetch_(githubApiUrl_("/git/refs"), token, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({
      ref: "refs/heads/" + targetBranch,
      sha: sha
    })
  });
  const createStatus = createRes.getResponseCode();
  if (createStatus < 200 || createStatus >= 300) {
    throw new Error("GitHub memory branch create failed with " + createStatus + ": " + createRes.getContentText());
  }
}

function getGitHubContentFile_(path, token, branch) {
  const targetBranch = safeString_(branch || CM_VISUAL_TEST_BRANCH).trim();
  const url = githubApiUrl_("/contents/" + path + "?ref=" + encodeURIComponent(targetBranch));
  const res = githubFetch_(url, token, { method: "get" });
  const status = res.getResponseCode();
  const text = res.getContentText();

  if (status === 404) {
    return { exists: false };
  }

  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (err) {
    data = {};
  }

  if (status < 200 || status >= 300) {
    throw new Error("GitHub content lookup failed with " + status + ": " + text);
  }

  const content = safeString_(data.content || "").replace(/\s/g, "");
  const bytes = content ? Utilities.base64Decode(content) : [];
  const decoded = bytes.length ? Utilities.newBlob(bytes).getDataAsString("UTF-8") : "";

  return {
    exists: true,
    sha: data.sha || "",
    text: decoded
  };
}

function putGitHubContentJson_(path, obj, token, message, branch) {
  return putGitHubContentJsonAttempt_(path, obj, token, message, branch, 0);
}

function putGitHubContentJsonAttempt_(path, obj, token, message, branch, attempt) {
  const targetBranch = safeString_(branch || CM_VISUAL_TEST_BRANCH).trim();
  const existing = getGitHubContentFile_(path, token, targetBranch);
  const text = JSON.stringify(obj, null, 2);
  const payload = {
    message: message || "Update " + path,
    content: Utilities.base64Encode(Utilities.newBlob(text).getBytes()),
    branch: targetBranch
  };
  if (existing.exists && existing.sha) payload.sha = existing.sha;

  const url = githubApiUrl_("/contents/" + path);
  const res = githubFetch_(url, token, {
    method: "put",
    contentType: "application/json",
    payload: JSON.stringify(payload)
  });
  const status = res.getResponseCode();
  const body = res.getContentText();
  let data = {};
  try {
    data = body ? JSON.parse(body) : {};
  } catch (err) {
    data = { raw: body };
  }

  if (status < 200 || status >= 300) {
    if (status === 409 && attempt < 2) {
      Utilities.sleep(350 * (attempt + 1));
      return putGitHubContentJsonAttempt_(path, obj, token, message, branch, attempt + 1);
    }
    throw new Error("GitHub content save failed with " + status + ": " + body);
  }

  return {
    sha: data.content && data.content.sha ? data.content.sha : "",
    commit: data.commit && data.commit.sha ? data.commit.sha : ""
  };
}

function getScriptPropertyWithDefault_(key, fallback) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  return safeString_(value).trim() || fallback;
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
    .replace(/[\u2013\u2014]/g, " - ")
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
  const raw = normalizeChecklistLineText_(line);
  if (!raw) return false;
  if (/^(Parallels?|Versions?|Hobby|Configuration|Cards?\b|Serial Numbered|Find |Checklistcenter)/i.test(raw)) return false;
  if (/^\d+\s+Cards?\b/i.test(raw)) return false;
  if (/^[A-Z]{0,8}[-A-Z0-9]*\d[A-Z0-9-]*\s+.+\s+-\s+.+/.test(raw)) return true;
  if (/^[A-Z]{1,8}-[A-Z0-9]{1,12}\s+.+\s+-\s+.+/.test(raw)) return true;
  if (isLikelyUnnumberedPlayerTeamLine_(raw)) return true;
  return /^[^-]+\s+-\s+.+(?:#\/\d+|#\/\d+\s*or\s*less|1\/1|\*)/i.test(raw);
}

function isLikelyUnnumberedPlayerTeamLine_(line) {
  const raw = normalizeChecklistLineText_(line);
  if (!raw || raw.indexOf(" - ") === -1) return false;
  if (/^(Release Date|Price|Configuration|Box Break|Parallels?|Versions?|Cards?)\b/i.test(raw)) return false;
  if (/<|>/.test(raw)) return false;

  const pieces = raw.split(/\s+-\s+/);
  if (pieces.length !== 2) return false;

  const player = pieces[0].trim();
  const team = pieces[1].trim();
  if (!player || !team) return false;
  if (player.length < 2 || team.length < 2) return false;
  if (player.length > 80 || team.length > 90) return false;
  if (/^\d/.test(player)) return false;
  if (/^(Blue|Green|Purple|Orange|Black|Red|Gold|Silver|Bronze|Pink|Aqua|Yellow|White)\b/i.test(player)) return false;
  if (/\b#?\s*\/\s*\d+\b|1\/1/i.test(team)) return false;

  return true;
}

function parseChecklistLine_(line, product, section, subset) {
  const raw = normalizeChecklistLineText_(line);
  const numbered = raw.match(/^([A-Z]{0,8}[-A-Z0-9]*\d[A-Z0-9-]*)\s+(.+?)\s+-\s+(.+)$/)
    || raw.match(/^([A-Z]{1,8}-[A-Z0-9]{1,12})\s+(.+?)\s+-\s+(.+)$/);
  const unnumbered = numbered ? null : raw.match(/^(.+?)\s+-\s+(.+)$/);
  if (!numbered && !unnumbered) return null;

  const cardNo = numbered ? numbered[1].trim() : "";
  const player = numbered ? numbered[2] : unnumbered[1];
  const team = numbered ? numbered[3] : unnumbered[2];

  return {
    code: product.code,
    sport: product.sport,
    section: section,
    subset: subset,
    card_no: cardNo,
    player: cleanPlayerName_(player),
    team: cleanTeamName_(team),
    tag: inferRowTag_(section, subset, player, team)
  };
}

function normalizeChecklistLineText_(line) {
  return decodeEntities_(safeString_(line))
    .replace(/[\u2013\u2014]/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractParallelRows_(html, product, section, subset) {
  const out = [];
  const text = decodeEntities_(safeString_(html)).replace(/\s+/g, " ");
  const re = /<strong>\s*(?:Parallels|Versions):\s*<\/strong>\s*([^<]+)/gi;
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
  if (m) return "/" + m[1];
  if (/1\/1/.test(raw)) return "/1";
  if (/one\s*of\s*one/i.test(raw)) return "/1";
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
    .replace(/\b(Baseball|Basketball|Football|Hockey|Soccer)\s+\1\b$/i, "$1")
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
  subset = subset.replace(/\s+Set\s*$/i, "");
  subset = subset.replace(/\s+/g, " ").trim();

  return subset || heading;
}

function inferChecklistSection_(heading) {
  const h = normalize_(heading);
  if (/auto|autograph|signature|scripts|ink|endorsed|spotlight signatures/.test(h)) return "Autograph";
  if (/relic|material|memorabilia|patch|jumbo|swatch/.test(h)) return "Relic";
  if (/variation|short print|ssp|sp\b/.test(h)) return "Variation";
  if (/insert|night moves|sneaker|color blast|downtown|stained glass|features|framed|vintage/.test(h)) return "Insert";
  if (/base/.test(h)) return "Base";
  return "Insert";
}

function inferRowTag_(section, subset, player, team) {
  const rawHay = [section, subset, player, team].join(" ");
  const hay = normalize_(rawHay);
  const tags = [];
  if (/rookie| rc\b/.test(hay)) tags.push("RC");
  const serial = extractSerialTag_(rawHay);
  if (serial) tags.push(serial);
  return tags.join(", ");
}

function extractSerialTag_(value) {
  const raw = decodeEntities_(safeString_(value));
  if (/\b1\s*\/\s*1\b/i.test(raw)) return "/1";

  let m = raw.match(/#?\s*\/\s*(\d+)(?:\s*or\s*less)?/i);
  if (m) {
    return raw.match(/or\s*less/i) ? "/" + m[1] + " or less" : "/" + m[1];
  }
  return "";
}

function cleanPlayerName_(value) {
  return decodeEntities_(safeString_(value)).replace(/\s+/g, " ").trim();
}

function cleanTeamName_(value) {
  return decodeEntities_(safeString_(value))
    .replace(/\b1\s*\/\s*1\b/gi, "")
    .replace(/#?\s*\/\s*\d+(?:\s*or\s*less)?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
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
    .replace(/\b(Baseball|Basketball|Football|Hockey|Soccer)\s+\1\b$/i, "$1")
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

function shallowClone_(obj) {
  const out = {};
  Object.keys(obj || {}).forEach(function(key) {
    out[key] = obj[key];
  });
  return out;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
