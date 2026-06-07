/*******************************************************
 * Chasing Majors Command Center - Operator Backend
 *
 * Purpose:
 * - Run source-watch work from Apps Script, where we can safely use
 *   URLFetchApp, Google Sheets access, Script Properties, and later
 *   approved publish functions.
 * - Keep the public GitHub Pages Command Center free of secrets.
 *œ
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
 * - runScheduledAgentSweep
 *
 * Current safety:
 * - Sheet writes require Script Property CM_OPERATOR_KEY.
 * - GitHub workflow dispatch requires CM_OPERATOR_KEY and CM_GITHUB_TOKEN.
 * - Source import writes are idempotent by product code.
 *******************************************************/

const CM_OPERATOR_VERSION = "2026-06-07-operator-cc97-deep-backend-audit";
const CM_APP_DATA_BASE = "https://app.chasingmajors.com/data/v1";
const CM_CHECKLISTCENTER_HOME = "https://www.checklistcenter.com/";
const CM_CHECKLISTCENTER_POSTS_API = "https://www.checklistcenter.com/wp-json/wp/v2/posts?per_page=20&_fields=link,title,date,slug";
const CM_SLABSQUATCH_ARCHIVE_API = "https://slabsquatch.substack.com/api/v1/archive?sort=new&search=&offset=0&limit=20";
const CM_ALLOWED_SPORTS = ["baseball", "football", "basketball", "hockey", "soccer"];
const CM_PRODUCTS_SHEET = "Products";
const CM_CHECKLIST_ROWS_SHEET = "ChecklistRows";
const CM_PARALLELS_SHEET = "Parallels";
const CM_PRV_INDEX_SHEET = "Index";
const CM_VAULT_SPREADSHEET_ID_PROPERTY = "CM_VAULT_SPREADSHEET_ID";
const CM_VAULT_SPREADSHEET_ID_FALLBACK = "1Rmo0R46j_MdK7oQX-Z00PfOsRsoiHNgNTkNS3PbMeuE";
const CM_OPERATOR_KEY_PROPERTY = "CM_OPERATOR_KEY";
const CM_STATIC_EXPORTER_URL_PROPERTY = "CM_STATIC_EXPORTER_URL";
const CM_GITHUB_TOKEN_PROPERTY = "CM_GITHUB_TOKEN";
const CM_VISUAL_TEST_CHATBOT_BASE_PROPERTY = "CM_VISUAL_TEST_CHATBOT_BASE";
const CM_VISUAL_TEST_CHECKLIST_BASE_PROPERTY = "CM_VISUAL_TEST_CHECKLIST_BASE";
const CM_VISUAL_TEST_OWNER = "ChasingMajors";
const CM_VISUAL_TEST_REPO = "cm-chat-prototype";
const CM_APP_DATA_OWNER = "ChasingMajors";
const CM_APP_DATA_REPO = "chasing-majors-app";
const CM_VISUAL_TEST_WORKFLOW = "visual-product-test.yml";
const CM_SENTINEL_TEST_WORKFLOW = "sentinel-command-center-test.yml";
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
    "2025-26": "16eT73CzM7JQMZcaEI3Zc0elX5lzzMtrvX8TGr1aKYKc",
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
      sport_inference: getSportInferenceSelfTest_(),
      updated_at: new Date().toISOString()
    });

    if (action === "sourceWatch") return json_(runSourceWatch_(p.mode || ""));

    if (action === "runDeepBackendAudit") return json_(runDeepBackendAudit_(p));

    if (action === "prvSourceWatch") return json_(runPrvSourceWatch_(p.mode || ""));

    if (action === "previewPrvSource") {
      return json_(previewPrvSource_({
        sourceUrl: p.sourceUrl || p.url || "",
        sport: p.sport || ""
      }));
    }

    if (action === "executePrvSourceImport") {
      return json_(executePrvSourceImport_({
        sourceUrl: p.sourceUrl || p.url || "",
        sport: p.sport || "",
        key: p.key || ""
      }));
    }

    if (action === "validateSourceProduct") {
      return json_(validateSourceProduct_({
        title: p.title || "",
        sport: p.sport || "",
        mode: p.mode || ""
      }));
    }

    if (action === "previewSourceImport") {
      return json_(previewSourceImport_({
        sourceUrl: p.sourceUrl || p.url || "",
        sport: p.sport || ""
      }));
    }

    if (action === "findChecklistCenterSource") {
      return json_(findChecklistCenterSource_({
        title: p.title || p.product || "",
        sport: p.sport || ""
      }));
    }

    if (action === "executeSourceImport") {
      return json_(executeSourceImport_({
        sourceUrl: p.sourceUrl || p.url || "",
        sport: p.sport || "",
        key: p.key || "",
        publish: p.publish || ""
      }));
    }

    if (action === "publishImportedChecklist") {
      return json_(publishImportedChecklist_({
        sport: p.sport || "",
        bucket: p.bucket || p.year || "",
        code: p.code || "",
        key: p.key || ""
      }));
    }

    if (action === "publishPrvVaultStaticData") {
      return json_(publishPrvVaultStaticData_({
        code: p.code || "",
        key: p.key || ""
      }));
    }

    if (action === "validatePrvVaultProduct") {
      return json_(validatePrvVaultProduct_({
        code: p.code || ""
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

    if (action === "dispatchSentinelSelfTest") {
      return json_(dispatchSentinelSelfTest_({
        commandCenterUrl: p.commandCenterUrl || p.command_center_url || "",
        key: p.key || ""
      }));
    }

    if (action === "getSentinelSelfTestStatus") {
      return json_(getSentinelSelfTestStatus_({
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

    if (action === "runScheduledPrvSync") {
      return json_(runScheduledPrvSync_({
        key: p.key || ""
      }));
    }

    if (action === "runScheduledAgentSweep") {
      return json_(runScheduledAgentSweep_({
        mode: p.mode || "",
        key: p.key || ""
      }));
    }

    return json_({
      ok: false,
      error: "Unknown action",
      supported_actions: ["health", "sourceWatch", "runDeepBackendAudit", "prvSourceWatch", "previewPrvSource", "executePrvSourceImport", "publishPrvVaultStaticData", "validatePrvVaultProduct", "validateSourceProduct", "previewSourceImport", "findChecklistCenterSource", "executeSourceImport", "publishImportedChecklist", "dispatchVisualProductTest", "getVisualProductTestStatus", "dispatchSentinelSelfTest", "getSentinelSelfTestStatus", "loadAgentMemory", "saveAgentMemory", "runScheduledSourceWatch", "runScheduledPrvSync", "runScheduledAgentSweep"]
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

    if (action === "runDeepBackendAudit") return json_(runDeepBackendAudit_(body));

    if (action === "prvSourceWatch") return json_(runPrvSourceWatch_(body.mode || ""));

    if (action === "previewPrvSource") {
      return json_(previewPrvSource_(body));
    }

    if (action === "executePrvSourceImport") {
      return json_(executePrvSourceImport_(body));
    }

    if (action === "validateSourceProduct") {
      return json_(validateSourceProduct_(body));
    }

    if (action === "previewSourceImport") {
      return json_(previewSourceImport_(body));
    }

    if (action === "findChecklistCenterSource") {
      return json_(findChecklistCenterSource_(body));
    }

    if (action === "executeSourceImport") {
      return json_(executeSourceImport_(body));
    }

    if (action === "publishImportedChecklist") {
      return json_(publishImportedChecklist_(body));
    }

    if (action === "publishPrvVaultStaticData") {
      return json_(publishPrvVaultStaticData_(body));
    }

    if (action === "validatePrvVaultProduct") {
      return json_(validatePrvVaultProduct_(body));
    }

    if (action === "dispatchVisualProductTest") {
      return json_(dispatchVisualProductTest_(body));
    }

    if (action === "getVisualProductTestStatus") {
      return json_(getVisualProductTestStatus_(body));
    }

    if (action === "dispatchSentinelSelfTest") {
      return json_(dispatchSentinelSelfTest_(body));
    }

    if (action === "getSentinelSelfTestStatus") {
      return json_(getSentinelSelfTestStatus_(body));
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

    if (action === "runScheduledPrvSync") {
      return json_(runScheduledPrvSync_(body));
    }

    if (action === "runScheduledAgentSweep") {
      return json_(runScheduledAgentSweep_(body));
    }

    return json_({
      ok: false,
      error: "Unknown action",
      supported_actions: ["sourceWatch", "runDeepBackendAudit", "prvSourceWatch", "previewPrvSource", "executePrvSourceImport", "publishPrvVaultStaticData", "validatePrvVaultProduct", "validateSourceProduct", "previewSourceImport", "findChecklistCenterSource", "executeSourceImport", "publishImportedChecklist", "dispatchVisualProductTest", "getVisualProductTestStatus", "dispatchSentinelSelfTest", "getSentinelSelfTestStatus", "loadAgentMemory", "saveAgentMemory", "runScheduledSourceWatch", "runScheduledPrvSync", "runScheduledAgentSweep"]
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

function findChecklistCenterSource_(input) {
  const title = safeString_(input && (input.title || input.product)).trim();
  const sport = normalize_(input && input.sport);

  if (!title) {
    return {
      ok: false,
      error: "Missing title"
    };
  }

  if (!isAllowedSport_(sport)) {
    return {
      ok: false,
      error: "Unsupported sport"
    };
  }

  const url = "https://www.checklistcenter.com/wp-json/wp/v2/search?per_page=10&search="
    + encodeURIComponent(title);
  const items = JSON.parse(fetchText_(url));
  const candidates = (Array.isArray(items) ? items : [])
    .map(function(item) {
      const sourceTitle = normalizeTitleFromLink_(item && item.title ? item.title : titleFromChecklistCenterHref_(item && item.url));
      const sourceUrl = absoluteChecklistCenterUrl_(item && item.url);
      const sourceSport = inferSport_(sourceTitle + " " + sourceUrl);

      return {
        title: sourceTitle,
        sport: sourceSport,
        source_url: sourceUrl,
        score: scoreSourceTitleMatch_(title, sourceTitle, sport, sourceSport)
      };
    })
    .filter(function(item) {
      return item.source_url &&
        item.sport === sport &&
        isProductChecklistHref_(item.source_url) &&
        !hasBlockedTerm_(item.title) &&
        item.score >= 80;
    })
    .sort(function(a, b) { return b.score - a.score; });

  if (!candidates.length) {
    return {
      ok: false,
      status: "not_found",
      title: title,
      sport: sport,
      error: "No matching Checklistcenter source page found."
    };
  }

  return {
    ok: true,
    status: "found",
    title: title,
    sport: sport,
    match: candidates[0],
    candidates: candidates.slice(0, 5)
  };
}

function scoreSourceTitleMatch_(targetTitle, sourceTitle, targetSport, sourceSport) {
  const targetNorm = normalize_(targetTitle);
  const sourceNorm = normalize_(sourceTitle);
  const targetLoose = looseProductKey_(targetTitle);
  const sourceLoose = looseProductKey_(sourceTitle);
  let score = targetSport === sourceSport ? 40 : 0;

  if (targetNorm === sourceNorm) score += 300;
  if (targetLoose && targetLoose === sourceLoose) score += 240;
  if (sourceNorm.includes(targetNorm)) score += 160;
  if (targetNorm.includes(sourceNorm) && sourceNorm.length > 10) score += 120;

  targetNorm.split(" ").filter(Boolean).forEach(function(token) {
    if (sourceNorm.includes(token)) score += 8;
  });

  return score;
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
  const shouldPublish = shouldPublishAfterImport_(input && input.publish);
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

  const publishResult = shouldPublish
    ? publishChecklistAfterImport_(product, input && input.key)
    : {
      ok: false,
      skipped: true,
      reason: "Publish skipped for phased import. Run publishImportedChecklist next."
    };

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

function shouldPublishAfterImport_(value) {
  const raw = safeString_(value).trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "no" || raw === "skip");
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

function runDeepBackendAudit_(input) {
  const startedAt = new Date();
  const sourceRows = fetchChecklistSourceRows_();
  const publicRows = fetchChecklistPublicJsonRows_();
  const issues = [];
  const stats = {
    sheet_products: sourceRows.length,
    public_products: publicRows.length,
    duplicate_codes: 0,
    missing_public_json: 0,
    stale_public_json: 0,
    empty_sheet_products: 0,
    missing_required_fields: 0,
    public_without_source: 0,
    warnings: 0,
    errors: 0
  };

  const sourceByKey = {};
  const publicByKey = {};
  const sourceCodeBuckets = {};

  sourceRows.forEach(function(row) {
    const sport = normalize_(row.sport || "");
    const code = safeString_(row.Code || row.code || "").trim();
    const key = sport + "|" + code;
    if (!sport || !code) return;

    if (!sourceByKey[key]) sourceByKey[key] = [];
    sourceByKey[key].push(row);

    const codeKey = sport + "|" + code;
    if (!sourceCodeBuckets[codeKey]) sourceCodeBuckets[codeKey] = [];
    sourceCodeBuckets[codeKey].push(row);
  });

  publicRows.forEach(function(row) {
    const sport = normalize_(row.sport || "");
    const code = safeString_(row.Code || row.code || "").trim();
    if (!sport || !code) return;
    publicByKey[sport + "|" + code] = row;
  });

  Object.keys(sourceCodeBuckets).forEach(function(key) {
    const rows = sourceCodeBuckets[key] || [];
    if (rows.length < 2) return;
    stats.duplicate_codes += 1;
    pushBackendAuditIssue_(issues, {
      type: "duplicate_product_code",
      severity: "high",
      status: "needs_admin",
      product: rows[0].DisplayName || rows[0].displayName || rows[0].Code || "",
      sport: rows[0].sport || "",
      code: rows[0].Code || "",
      bucket: rows.map(function(row) { return row.source_key || row.year || ""; }).filter(Boolean).join(", "),
      title: "Duplicate product code in source Sheets",
      detail: "The same product code appears " + rows.length + " times in source Google Sheets. This can confuse JSON publish and search.",
      recommended_action: "Review duplicate Product rows and keep one source-of-truth row before publishing."
    });
  });

  sourceRows.forEach(function(row) {
    const sport = normalize_(row.sport || "");
    const code = safeString_(row.Code || row.code || "").trim();
    const key = sport + "|" + code;
    if (!sport || !code) return;

    const displayName = safeString_(row.DisplayName || row.displayName || "").trim();
    const publicRow = publicByKey[key] || null;
    const sourceRowCount = Number(row.row_count || 0);
    const sourceParallelCount = Number(row.parallel_count || 0);
    const publicRowCount = publicRow ? Number(publicRow.row_count || 0) : 0;
    const publicParallelCount = publicRow ? Number(publicRow.parallel_count || 0) : 0;

    const missingFields = [];
    if (!displayName) missingFields.push("DisplayName");
    if (!row.year) missingFields.push("Year");
    if (!sport) missingFields.push("Sport");
    if (!safeString_(row.Keywords || row.keywords || "").trim()) missingFields.push("Keywords");

    if (missingFields.length) {
      stats.missing_required_fields += 1;
      pushBackendAuditIssue_(issues, {
        type: "missing_product_metadata",
        severity: missingFields.indexOf("DisplayName") > -1 ? "high" : "medium",
        status: "needs_admin",
        product: displayName || code,
        sport: sport,
        code: code,
        bucket: row.source_key || row.year || "",
        title: "Product row needs metadata",
        detail: "Missing: " + missingFields.join(", ") + ". Search and routing quality may suffer.",
        recommended_action: "Fill missing metadata in the Products tab, then publish the affected checklist JSON."
      });
    }

    if (sourceRowCount === 0) {
      stats.empty_sheet_products += 1;
      pushBackendAuditIssue_(issues, {
        type: "product_has_no_checklist_rows",
        severity: "medium",
        status: "needs_admin",
        product: displayName || code,
        sport: sport,
        code: code,
        bucket: row.source_key || row.year || "",
        title: "Product has no checklist rows",
        detail: "The Products tab has this product, but ChecklistRows has 0 rows for the code.",
        recommended_action: "Add checklist rows or confirm this is a shell product that should stay unpublished."
      });
    }

    if (!publicRow) {
      stats.missing_public_json += 1;
      pushBackendAuditIssue_(issues, {
        type: "missing_public_json",
        severity: "high",
        status: "needs_admin",
        product: displayName || code,
        sport: sport,
        code: code,
        bucket: row.source_key || row.year || "",
        title: "Source product missing from public JSON",
        detail: "Google Sheets has " + sourceRowCount + " checklist rows and " + sourceParallelCount + " parallels, but public JSON index does not list this product.",
        recommended_action: "Run the product/year publish function, rebuild checklist index if this is new, then validate CV and ChatBot."
      });
      return;
    }

    if (publicRowCount < sourceRowCount || publicParallelCount < sourceParallelCount) {
      stats.stale_public_json += 1;
      pushBackendAuditIssue_(issues, {
        type: "stale_public_json",
        severity: "high",
        status: "pending_public_validation",
        product: displayName || publicRow.DisplayName || code,
        sport: sport,
        code: code,
        bucket: row.source_key || row.year || "",
        title: "Public JSON appears stale",
        detail: "Sheets show " + sourceRowCount + " rows / " + sourceParallelCount + " parallels. Public JSON index shows " + publicRowCount + " rows / " + publicParallelCount + " parallels.",
        recommended_action: "Publish the product/year JSON and let Sentinel recheck public validation.",
        expected_row_count: sourceRowCount,
        expected_parallel_count: sourceParallelCount,
        public_row_count: publicRowCount,
        public_parallel_count: publicParallelCount
      });
    }

    if (sourceRowCount > 100 && sourceParallelCount === 0) {
      pushBackendAuditIssue_(issues, {
        type: "missing_or_unparsed_parallels",
        severity: "low",
        status: "needs_admin",
        product: displayName || code,
        sport: sport,
        code: code,
        bucket: row.source_key || row.year || "",
        title: "Large checklist has no parallels",
        detail: "This can be valid, but it is worth review for modern products.",
        recommended_action: "Confirm the source has no parallels. If it does, import or add them before publish."
      });
    }
  });

  Object.keys(publicByKey).forEach(function(key) {
    if (sourceByKey[key]) return;
    const row = publicByKey[key] || {};
    stats.public_without_source += 1;
    pushBackendAuditIssue_(issues, {
      type: "public_json_without_source_product",
      severity: "medium",
      status: "needs_admin",
      product: row.DisplayName || row.displayName || row.Code || "",
      sport: row.sport || "",
      code: row.Code || row.code || "",
      bucket: row.year || "",
      title: "Public JSON product not found in source Sheets",
      detail: "The public checklist index has this product, but the configured source Google Sheets did not return a matching Product row.",
      recommended_action: "Confirm the source sheet mapping and product code. Do not delete public data until the source-of-truth row is found."
    });
  });

  issues.forEach(function(issue) {
    if (issue.severity === "high") stats.errors += 1;
    else stats.warnings += 1;
  });

  const durationMs = new Date().getTime() - startedAt.getTime();
  return {
    ok: true,
    status: issues.length ? "needs_review" : "validated",
    mode: "deep_backend_audit",
    read_only: true,
    coverage_source: "google_sheets_vs_public_json",
    summary: stats,
    issue_count: issues.length,
    issues: issues.slice(0, 150),
    next_step: issues.length
      ? "Review audit issues in the Agent Action Queue. Safe publish-validation items can be handled by Run Agent Cycle; metadata or duplicate issues need admin review."
      : "No backend source-vs-public JSON issues found.",
    duration_ms: durationMs,
    updated_at: new Date().toISOString()
  };
}

function pushBackendAuditIssue_(issues, input) {
  issues.push({
    id: [
      "backend_audit",
      normalize_(input.type || "issue"),
      normalize_(input.sport || ""),
      safeString_(input.code || "").trim() || normalize_(input.product || "")
    ].filter(Boolean).join("|"),
    type: input.type || "backend_data_issue",
    target_tool: "checklist",
    discovery_source: "deep_backend_audit",
    status: input.status || "needs_admin",
    severity: input.severity || "medium",
    title: input.title || "Backend data issue",
    product: input.product || "",
    matched_name: input.product || "",
    sport: input.sport || "",
    code: input.code || "",
    matched_code: input.code || "",
    bucket: input.bucket || "",
    detail: input.detail || "",
    reason: input.detail || "",
    recommended_action: input.recommended_action || "Review and fix the source data, then publish and validate.",
    expected_row_count: Number(input.expected_row_count || 0),
    expected_parallel_count: Number(input.expected_parallel_count || 0),
    public_row_count: Number(input.public_row_count || 0),
    public_parallel_count: Number(input.public_parallel_count || 0),
    source_url: "",
    url: ""
  });
}

function runPrvSourceWatch_(mode) {
  const auditMode = normalizeSourceWatchMode_(mode || "quick_json");
  const vaultRows = fetchVaultPublicIndexRows_();
  const sourceItems = fetchRecentSlabSquatchItems_();

  const results = sourceItems.map(function(item) {
    const classified = classifyPrvSourceItem_(item, vaultRows);
    return markLockedPrvSourceIssue_(classified);
  });

  const summary = results.reduce(function(out, item) {
    out[item.status] = (out[item.status] || 0) + 1;
    return out;
  }, {});

  return {
    ok: true,
    mode: auditMode,
    coverage_source: "public_vault_json",
    source: "slabsquatch",
    source_url: "https://substack.com/@slabsquatch",
    fetched_count: sourceItems.length,
    supported_count: results.filter(function(r) { return r.status !== "ignored"; }).length,
    summary: summary,
    items: results,
    next_step: "Review SlabSquatch posts against Print Run Vault. Missing or possible_update items should become PRV review tasks before any sheet write.",
    updated_at: new Date().toISOString()
  };
}

function previewPrvSource_(input) {
  const sourceUrl = safeString_(input && (input.sourceUrl || input.url)).trim();
  const requestedSport = normalize_(input && input.sport);

  if (!sourceUrl) {
    return {
      ok: false,
      error: "Missing sourceUrl"
    };
  }

  if (!/^https:\/\/slabsquatch\.substack\.com\/p\//i.test(sourceUrl)) {
    return {
      ok: false,
      error: "Only SlabSquatch Substack post URLs are supported in PRV preview."
    };
  }

  const html = fetchText_(sourceUrl);
  const title = extractSubstackPostTitle_(html) || extractPageTitle_(html) || titleFromSubstackUrl_(sourceUrl);
  const productName = normalizePrvSourceTitle_(title);
  const sport = requestedSport || inferSport_(productName + " " + sourceUrl);

  if (!isAllowedSport_(sport)) {
    return {
      ok: true,
      status: "ignored",
      title: productName,
      sport: sport,
      source_url: sourceUrl,
      reason: "Unsupported sport."
    };
  }

  if (hasBlockedTerm_(productName)) {
    return {
      ok: true,
      status: "ignored",
      title: productName,
      sport: sport,
      source_url: sourceUrl,
      reason: "Blocked category term detected."
    };
  }

  const bodyHtml = extractSubstackBodyHtml_(html);
  const rows = parseSlabSquatchPrintRunRows_(bodyHtml, sourceUrl);
  const product = buildPrvProductPreview_(productName, sport, sourceUrl);
  const paywalled = isSubstackPostPaywalled_(html, bodyHtml);

  return {
    ok: true,
    mode: "prv_preview_only",
    status: rows.length ? "preview_ready" : "needs_review",
    source_url: sourceUrl,
    product: product,
    row_count: rows.length,
    rows: rows.slice(0, 200),
    sample_rows: rows.slice(0, 12),
    warnings: rows.length
      ? []
      : [paywalled
        ? "Source post appears paid/locked. Public HTML does not expose writable print-run rows."
        : "No print-run rows were parsed from the source post."],
    next_step: "Review PRV preview rows. Sheet write is intentionally not enabled yet."
  };
}

function executePrvSourceImport_(input) {
  requireOperatorKey_(input && input.key);

  const preview = previewPrvSource_(input);
  if (!preview || !preview.ok) return preview;

  if (preview.status !== "preview_ready") {
    return {
      ok: false,
      status: preview.status || "not_ready",
      error: "PRV source preview is not ready for write.",
      preview: preview
    };
  }

  const product = preview.product || {};
  const rows = Array.isArray(preview.rows) ? preview.rows : [];
  if (!product.code || !product.display_name || !rows.length) {
    return {
      ok: false,
      status: "not_ready",
      error: "Missing PRV product metadata or print-run rows.",
      preview: preview
    };
  }

  const ss = SpreadsheetApp.openById(getVaultSpreadsheetId_());
  upsertPrvIndex_(ss, product);
  replaceRowsByCode_(ss, CM_PRODUCTS_SHEET, product.code, rows.map(function(row) {
    return prvRowToSheetObject_(product, row);
  }), [
    "code", "display_name", "keywords", "year", "sport", "manufacturer", "product", "setType", "setLine", "printRun", "serial", "subSetSize", "notes", "cmURL"
  ]);

  const validation = validateWrittenPrvProduct_(ss, product.code);

  return {
    ok: true,
    status: validation.ok ? "written_needs_publish" : "written_needs_review",
    mode: "prv_sheet_write_review_only",
    source_url: input.sourceUrl || input.url || "",
    target_spreadsheet_id: getVaultSpreadsheetId_(),
    product: product,
    wrote: {
      index: 1,
      rows: rows.length
    },
    validation: validation,
    publish: {
      ok: false,
      skipped: true,
      reason: "PRV JSON publish is intentionally not wired to this preview write yet. Run publishVaultStaticDataToGitHub after review."
    },
    next_step: "PRV Google Sheet was updated for this product only. Review the Products rows, then run publishVaultStaticDataToGitHub when ready.",
    updated_at: new Date().toISOString()
  };
}

function getVaultSpreadsheetId_() {
  const configured = PropertiesService.getScriptProperties().getProperty(CM_VAULT_SPREADSHEET_ID_PROPERTY);
  return safeString_(configured || CM_VAULT_SPREADSHEET_ID_FALLBACK).trim();
}

function upsertPrvIndex_(ss, product) {
  const sh = ensureSheetWithHeaders_(ss, CM_PRV_INDEX_SHEET, [
    "code", "display_name", "year", "sport", "manufacturer", "product", "keywords", "cmURL"
  ]);
  const headers = getHeaders_(sh);
  const obj = {
    code: product.code || "",
    display_name: product.display_name || "",
    displayname: product.display_name || "",
    year: product.year || "",
    sport: product.sport || "",
    manufacturer: product.manufacturer || "",
    product: product.product || "",
    keywords: product.keywords || buildPrvKeywordString_(product),
    cmURL: product.source_url || "",
    cmurl: product.source_url || ""
  };
  const rowValues = headers.map(function(header) {
    return safeString_(objectValueForHeader_(obj, header));
  });
  const values = sh.getDataRange().getValues();
  let rowIndex = -1;

  for (let i = 1; i < values.length; i++) {
    if (safeString_(values[i][0]).trim() === product.code) {
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex > -1) {
    sh.getRange(rowIndex, 1, 1, rowValues.length).setNumberFormat("@");
    sh.getRange(rowIndex, 1, 1, rowValues.length).setValues([rowValues]);
  } else {
    sh.appendRow(rowValues);
  }
}

function prvRowToSheetObject_(product, row) {
  return {
    code: product.code || "",
    display_name: product.display_name || "",
    displayname: product.display_name || "",
    keywords: product.keywords || buildPrvKeywordString_(product),
    year: product.year || "",
    sport: titleCase_(product.sport || ""),
    manufacturer: product.manufacturer || "",
    product: product.product || "",
    setType: row.setType || "",
    settype: row.setType || "",
    setLine: row.setLine || "",
    setline: row.setLine || "",
    printRun: row.printRun || "",
    printrun: row.printRun || "",
    serial: row.serial || "",
    subSetSize: row.subSetSize || "",
    subsetsize: row.subSetSize || "",
    notes: row.notes || "",
    cmURL: row.cmURL || "",
    cmurl: row.cmURL || ""
  };
}

function validateWrittenPrvProduct_(ss, code) {
  const indexCount = countRowsByFirstColumn_(ss.getSheetByName(CM_PRV_INDEX_SHEET), code);
  const rowCount = countRowsByFirstColumn_(ss.getSheetByName(CM_PRODUCTS_SHEET), code);

  return {
    index_rows: indexCount,
    product_rows: rowCount,
    ok: indexCount === 1 && rowCount > 0
  };
}

function buildPrvKeywordString_(product) {
  const name = safeString_(product && product.display_name);
  const year = safeString_(product && product.year);
  const manufacturer = safeString_(product && product.manufacturer);
  const line = safeString_(product && product.product);
  const sport = titleCase_(product && product.sport);
  const shortYear = year.match(/^\d{4}$/) ? year.slice(2) : "";
  const sportAlias = sport === "Football" ? "NFL" :
    sport === "Baseball" ? "MLB" :
    sport === "Basketball" ? "NBA" :
    sport === "Hockey" ? "NHL" : sport;

  return [
    name,
    [year, manufacturer, line, sport].filter(Boolean).join(" "),
    [year, manufacturer, line, sportAlias].filter(Boolean).join(" "),
    [year, line, sport].filter(Boolean).join(" "),
    [year, line, sportAlias].filter(Boolean).join(" "),
    [shortYear, manufacturer, line, sport].filter(Boolean).join(" "),
    [shortYear, manufacturer, line, sportAlias].filter(Boolean).join(" "),
    [manufacturer, line, sport].filter(Boolean).join(" "),
    [manufacturer, line, sportAlias].filter(Boolean).join(" "),
    [line, sport].filter(Boolean).join(" "),
    [line, sportAlias].filter(Boolean).join(" "),
    name + " print run",
    name + " production",
    name + " odds",
    name + " PRV",
    name + " checklist",
    [manufacturer, line, "checklist"].filter(Boolean).join(" ")
  ].filter(Boolean).join(" ");
}

function extractSubstackBodyHtml_(html) {
  const raw = safeString_(html);
  const patterns = [
    /\\"body_html\\":\\"([\s\S]*?)\\",\\"truncated_body_text\\"/,
    /"body_html":"([\s\S]*?)","truncated_body_text"/
  ];
  let match = null;

  for (let i = 0; i < patterns.length; i++) {
    match = raw.match(patterns[i]);
    if (match) break;
  }

  if (!match) {
    const marker = raw.search(/Part\\?u003c?\/?strong\\?u003e?:?\s*The\s*Print\s*Runs|Part\s*5:\s*The\s*Print\s*Runs/i);
    if (marker < 0) return "";

    const tail = raw.slice(marker, marker + 30000);
    return tail
      .replace(/\\"/g, "\"")
      .replace(/\\n/g, "\n")
      .replace(/\\u003c/g, "<")
      .replace(/\\u003e/g, ">")
      .replace(/\\u0026/g, "&");
  }

  try {
    return JSON.parse("\"" + match[1] + "\"");
  } catch (err) {
    return match[1]
      .replace(/\\"/g, "\"")
      .replace(/\\n/g, "\n")
      .replace(/\\u003c/g, "<")
      .replace(/\\u003e/g, ">")
      .replace(/\\u0026/g, "&");
  }
}

function extractSubstackPostTitle_(html) {
  const raw = safeString_(html);
  const og = raw.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    raw.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  if (og && og[1]) return cleanProductTitle_(og[1]);

  const jsonLd = raw.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/i);
  if (jsonLd && jsonLd[1]) {
    try {
      const parsed = JSON.parse(stripHtml_(jsonLd[1]));
      if (parsed && parsed.headline) return cleanProductTitle_(parsed.headline);
    } catch (err) {}
  }

  const postH1 = raw.match(/<h1[^>]+class=["'][^"']*post-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i);
  if (postH1 && postH1[1]) return cleanProductTitle_(stripHtml_(postH1[1]));

  return "";
}

function isSubstackPostPaywalled_(html, bodyHtml) {
  const raw = safeString_(html);
  const body = safeString_(bodyHtml);
  return /"audience"\s*:\s*"only_paid"/i.test(raw) ||
    /data-testid=["']paywall["']/i.test(raw) ||
    /class=["'][^"']*paywall/i.test(raw) ||
    /subscription-widget/i.test(body) && !/~\s*[\d,]+\s*ea/i.test(body);
}

function parseSlabSquatchPrintRunRows_(bodyHtml, sourceUrl) {
  const rows = [];
  const sectionBlocks = [];
  const html = decodeEntities_(safeString_(bodyHtml));
  const marker = html.search(/Part\s*5:\s*The\s*Print\s*Runs/i);
  const target = marker > -1 ? html.slice(marker) : html;
  const directParagraphRe = /<p>\s*(?:<strong>)?([^<]*?):\s*~\s*([\d,]+)\s*ea(?:<\/strong>)?\s*<\/p>/gi;
  const re = /<p>\s*(?:<strong>)?([\s\S]*?):\s*(?:<\/strong>)?\s*<\/p>\s*<ul>([\s\S]*?)<\/ul>/gi;
  let match;

  while ((match = directParagraphRe.exec(target)) !== null) {
    const heading = stripHtml_(match[1]).replace(/:$/, "").trim();
    const setType = normalizePrvSetType_(heading);
    const parsed = parseSlabSquatchPrintRunLine_("~" + match[2] + " ea", heading, setType, sourceUrl);
    if (parsed) rows.push(parsed);
  }

  while ((match = re.exec(target)) !== null) {
    sectionBlocks.push({
      heading: stripHtml_(match[1]),
      listHtml: match[2]
    });
  }

  sectionBlocks.forEach(function(block) {
    const setType = normalizePrvSetType_(block.heading);
    const items = extractListTextItems_(block.listHtml);

    items.forEach(function(text) {
      const parsed = parseSlabSquatchPrintRunLine_(text, block.heading, setType, sourceUrl);
      if (parsed) rows.push(parsed);
    });
  });

  return inferMissingPrvSubsetSizes_(rows);
}

function extractListTextItems_(html) {
  const out = [];
  const re = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let match;

  while ((match = re.exec(safeString_(html))) !== null) {
    const text = stripHtml_(match[1])
      .replace(/\s+/g, " ")
      .trim();
    if (text) out.push(text);
  }

  return out;
}

function parseSlabSquatchPrintRunLine_(line, heading, setType, sourceUrl) {
  const text = safeString_(line).replace(/\s+/g, " ").trim();
  if (!text) return null;

  const runMatch = text.match(/~\s*([\d,]+)\s*ea/i);
  if (!runMatch) return null;

  const cardListMatch = text.match(/\((\d+)\s*card\s*CL\)/i) ||
    safeString_(heading).match(/\((\d+)\s*card\s*CL\)/i);
  let setLine = text
    .replace(/\s*-\s*~\s*[\d,]+\s*ea.*$/i, "")
    .replace(/^~\s*[\d,]+\s*ea.*$/i, "")
    .replace(/\(\d+\s*card\s*CL\)/i, "")
    .trim();

  if (!setLine) setLine = safeString_(heading).replace(/\(\d+\s*card\s*CL\)/i, "").replace(/:$/, "").trim();

  return {
    setType: setType,
    setLine: setLine,
    printRun: Number(runMatch[1].replace(/,/g, "")),
    serial: "",
    subSetSize: cardListMatch ? Number(cardListMatch[1]) : "",
    notes: "Source: SlabSquatch. Review before PRV write. " + sourceUrl,
    cmURL: sourceUrl
  };
}

function inferMissingPrvSubsetSizes_(rows) {
  const sizeByBaseLine = {};

  (rows || []).forEach(function(row) {
    const size = Number(row && row.subSetSize || 0);
    if (!row || !row.setLine || !size) return;

    const baseKey = normalizePrvSetLineBase_(row.setLine);
    if (!baseKey) return;
    if (!sizeByBaseLine[baseKey]) sizeByBaseLine[baseKey] = size;
  });

  return (rows || []).map(function(row) {
    if (!row || row.subSetSize) return row;

    const baseKey = normalizePrvSetLineBase_(row.setLine);
    const inferredSize = baseKey ? sizeByBaseLine[baseKey] : 0;
    if (!inferredSize) return row;

    const out = shallowClone_(row);
    out.subSetSize = inferredSize;
    out.notes = safeString_(out.notes)
      + " Inferred CL " + inferredSize + " from matching base set name.";
    return out;
  });
}

function normalizePrvSetLineBase_(value) {
  return normalize_(value)
    .replace(/\b(refractors?|shimmers?|xfractors?|x fractors?|prisms?|silver|gold|blue|green|purple|orange|red|black|pink|aqua|atomic|mojo|wave|ice|speckle|sparkle|parallel|parallels)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePrvSetType_(heading) {
  const h = normalize_(heading);
  if (h.indexOf("auto") > -1) return "Auto";
  if (h.indexOf("insert") > -1) return "Insert";
  if (h.indexOf("parallel") > -1) return "Parallel";
  if (h.indexOf("base") > -1) return "Base";
  return titleCase_(heading).replace(/\s*\(\d+\s*Card\s*Cl\)\s*$/i, "");
}

function buildPrvProductPreview_(productName, sport, sourceUrl) {
  const year = extractPrvProductYear_(productName);
  const cleaned = safeString_(productName).replace(/\bNFL\b/gi, "Football").trim();
  const manufacturer = inferManufacturer_(cleaned);
  const productLine = cleaned
    .replace(year, "")
    .replace(new RegExp("\\b" + manufacturer + "\\b", "i"), "")
    .replace(new RegExp("\\b" + titleCase_(sport) + "\\b", "i"), "")
    .replace(/\s+/g, " ")
    .trim();
  const product = {
    code: buildPrvProductCode_(cleaned, sport),
    display_name: cleaned,
    year: year,
    sport: sport,
    manufacturer: manufacturer,
    product: productLine,
    source_url: sourceUrl
  };
  product.keywords = buildPrvKeywordString_(product);

  return product;
}

function extractPrvProductYear_(value) {
  const raw = safeString_(value);
  const season = raw.match(/\b(19|20)\d{2}\s*[-/]\s*\d{2}\b/);
  if (season) return normalizeSeasonYear_(season[0]);
  const year = raw.match(/\b(19|20)\d{2}\b/);
  return year ? year[0] : "";
}

function normalizeSeasonYear_(value) {
  return safeString_(value)
    .replace(/\b((?:19|20)\d{2})\s*\/\s*(\d{2})\b/g, "$1-$2")
    .replace(/\b((?:19|20)\d{2})\s*-\s*(\d{2})\b/g, "$1-$2")
    .trim();
}

function buildPrvProductCode_(name, sport) {
  const rawName = safeString_(name);
  const s = normalize_(sport);
  const base = normalize_(rawName).indexOf(s) > -1 ? rawName : rawName + " " + sport;
  return safeString_(base)
    .toLowerCase()
    .replace(/\b(19|20)(\d{2})-(\d{2})\b/g, "$1$2_$3")
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function titleFromSubstackUrl_(url) {
  const slug = safeString_(url).split("/p/")[1] || "";
  return slug.split("?")[0]
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fetchRecentSlabSquatchItems_() {
  try {
    const posts = JSON.parse(fetchText_(CM_SLABSQUATCH_ARCHIVE_API));
    if (!Array.isArray(posts)) return [];

    return posts.map(function(post) {
      const title = decodeEntities_(safeString_(post && post.title)).trim();
      const url = safeString_(post && (post.canonical_url || post.url || post.post_url)).trim();
      const sport = inferSport_(title + " " + safeString_(post && post.subtitle));

      return {
        title: normalizePrvSourceTitle_(title),
        raw_title: title,
        sport: sport,
        url: url,
        source_url: url,
        source_text: safeString_(post && post.subtitle),
        discovery_source: "slabsquatch_substack",
        published_at: safeString_(post && post.post_date),
        target_tool: "prv"
      };
    }).filter(isUsablePrvSourceItem_);
  } catch (err) {
    return [];
  }
}

function isUsablePrvSourceItem_(item) {
  if (!item || !item.title || !item.url) return false;
  if (!isAllowedSport_(item.sport)) return false;
  if (hasBlockedTerm_(item.title)) return false;
  const text = normalize_(item.title + " " + item.source_text);
  return /analysis|deep dive|odds|print run|numbers|base|value|mega|sapphire|chrome|bowman|topps|panini|donruss|prizm|finest/.test(text);
}

function classifyPrvSourceItem_(item, vaultRows) {
  const title = safeString_(item && item.title).trim();
  const sport = normalize_(item && item.sport);

  if (!isAllowedSport_(sport)) {
    return {
      status: "ignored",
      title: title,
      sport: sport,
      source_url: item.url || "",
      target_tool: "prv",
      reason: "Unsupported or unknown sport."
    };
  }

  const match = findVaultIndexMatch_(title, sport, vaultRows);
  if (match && match.score >= 140) {
    if (Number(match.row_count || 0) > 0) {
      return {
        status: "covered",
        title: title,
        sport: sport,
        source_url: item.url || "",
        matched_name: match.name,
        matched_code: match.code,
        match_score: match.score,
        public_rows: Number(match.row_count || 0),
        comparison_source: "public_vault_json",
        discovery_source: item.discovery_source || "slabsquatch_substack",
        target_tool: "prv",
        published_at: item.published_at || "",
        recommended_action: "PRV public JSON already has rows for this product. No queue action needed unless admin wants to manually compare source numbers."
      };
    }

    return {
      status: "possible_update",
      title: title,
      sport: sport,
      source_url: item.url || "",
      matched_name: match.name,
      matched_code: match.code,
      match_score: match.score,
      comparison_source: "public_vault_json",
      discovery_source: item.discovery_source || "slabsquatch_substack",
      target_tool: "prv",
      published_at: item.published_at || "",
      recommended_action: "SlabSquatch has a recent print-run/odds analysis for a PRV-covered product. Compare source numbers against PRV and flag discrepancies before updating."
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
      comparison_source: "public_vault_json",
      discovery_source: item.discovery_source || "slabsquatch_substack",
      target_tool: "prv",
      published_at: item.published_at || "",
      recommended_action: "Review naming/alias match before using this SlabSquatch post for PRV validation."
    };
  }

  return {
    status: "missing",
    title: title,
    sport: sport,
    source_url: item.url || "",
    discovery_source: item.discovery_source || "slabsquatch_substack",
    target_tool: "prv",
    published_at: item.published_at || "",
    recommended_action: "PRV does not appear to have this product. Review SlabSquatch post and decide whether to build Print Run Vault data."
  };
}

function markLockedPrvSourceIssue_(item) {
  const status = safeString_(item && item.status).trim().toLowerCase();
  const sourceUrl = safeString_(item && item.source_url).trim();
  if (!item || !sourceUrl) return item;
  if (status !== "missing" && status !== "needs_review" && status !== "possible_update") return item;

  const lock = inspectPrvSourceLock_(sourceUrl);
  if (!lock.locked) return item;

  return Object.assign({}, item, {
    status: "known_issue",
    blocked_reason: lock.reason,
    recommended_action: "Source post appears paid/locked. Public HTML does not expose writable print-run rows. Keep as known issue unless admin has another source."
  });
}

function inspectPrvSourceLock_(sourceUrl) {
  try {
    const html = fetchText_(sourceUrl);
    const bodyHtml = extractSubstackBodyHtml_(html);
    const rows = parseSlabSquatchPrintRunRows_(bodyHtml, sourceUrl);
    const locked = isSubstackPostPaywalled_(html, bodyHtml) && !rows.length;

    return {
      locked: locked,
      row_count: rows.length,
      reason: locked
        ? "Source post appears paid/locked. Public HTML does not expose writable print-run rows."
        : ""
    };
  } catch (err) {
    return {
      locked: false,
      row_count: 0,
      reason: err && err.message ? err.message : String(err)
    };
  }
}

function fetchVaultPublicIndexRows_() {
  const payload = JSON.parse(fetchText_(CM_APP_DATA_BASE + "/vault/index.json"));
  const rows = payload && (payload.index || payload.rows);
  const rowCounts = fetchVaultPublicRowCounts_();

  return (Array.isArray(rows) ? rows : []).map(function(row) {
    const code = safeString_(row.Code || row.code);
    return {
      code: code,
      name: safeString_(row.DisplayName || row.displayName || row.display_name),
      keywords: safeString_(row.Keywords || row.keywords),
      year: safeString_(row.year),
      sport: normalize_(row.sport),
      manufacturer: safeString_(row.manufacturer),
      product: safeString_(row.product),
      row_count: Number(rowCounts[code] || 0)
    };
  }).filter(function(row) {
    return row.code && row.name;
  });
}

function fetchVaultPublicRowCounts_() {
  const out = {};

  try {
    const manifest = JSON.parse(fetchText_(CM_APP_DATA_BASE + "/vault/products/all.json"));
    const productMap = manifest.product_map || manifest.productMap || {};
    const seenShards = {};
    const shards = Object.keys(productMap).map(function(code) {
      return productMap[code];
    }).filter(Boolean).filter(function(shard) {
      if (seenShards[shard]) return false;
      seenShards[shard] = true;
      return true;
    });

    shards.forEach(function(shard) {
      try {
        const shardPayload = JSON.parse(fetchText_(CM_APP_DATA_BASE + "/vault/products/" + shard));
        const products = shardPayload && shardPayload.products
          ? shardPayload.products
          : shardPayload && shardPayload.data && shardPayload.data.products
            ? shardPayload.data.products
            : {};

        Object.keys(products || {}).forEach(function(code) {
          const product = products[code] || {};
          const rows = Array.isArray(product.rows) ? product.rows : [];
          out[code] = rows.length;
        });
      } catch (err) {}
    });
  } catch (err) {}

  return out;
}

function validatePrvVaultProduct_(input) {
  const code = safeString_(input && input.code).trim();
  if (!code) {
    return {
      ok: false,
      error: "Missing PRV product code."
    };
  }

  try {
    const manifest = JSON.parse(fetchText_(CM_APP_DATA_BASE + "/vault/products/all.json"));
    const productMap = manifest.product_map || manifest.productMap || {};
    const shard = productMap[code];
    if (!shard) {
      return {
        ok: false,
        code: code,
        row_count: 0,
        error: "Product code not found in public PRV product manifest yet."
      };
    }

    const shardPayload = JSON.parse(fetchText_(CM_APP_DATA_BASE + "/vault/products/" + shard));
    const products = shardPayload && shardPayload.products
      ? shardPayload.products
      : shardPayload && shardPayload.data && shardPayload.data.products
        ? shardPayload.data.products
        : {};
    const product = products[code] || null;
    const rows = product && Array.isArray(product.rows) ? product.rows : [];

    return {
      ok: rows.length > 0,
      code: code,
      shard: shard,
      row_count: rows.length,
      display_name: product && product.meta ? product.meta.displayName || product.meta.display_name || "" : "",
      updated_at: new Date().toISOString()
    };
  } catch (err) {
    return {
      ok: false,
      code: code,
      row_count: 0,
      error: err && err.message ? err.message : String(err),
      updated_at: new Date().toISOString()
    };
  }
}

function findVaultIndexMatch_(title, sport, rows) {
  const titleNorm = normalize_(title);
  const titleLoose = looseProductKey_(title);
  let best = null;

  (rows || []).forEach(function(row) {
    if (normalize_(row.sport) !== sport) return;

    const nameNorm = normalize_(row.name);
    const text = normalize_([
      row.name,
      row.keywords,
      row.year,
      row.sport,
      row.manufacturer,
      row.product,
      row.code
    ].join(" "));
    const nameLoose = looseProductKey_(row.name);
    let score = 0;

    if (nameNorm === titleNorm) score += 240;
    if (nameLoose && titleLoose && nameLoose === titleLoose) score += 220;
    if (text.indexOf(titleNorm) > -1) score += 140;
    if (titleNorm.indexOf(nameNorm) > -1 && nameNorm.length > 8) score += 120;

    titleNorm.split(" ").filter(Boolean).forEach(function(token) {
      if (text.indexOf(token) > -1) score += 6;
    });

    if (!best || score > best.score) {
      best = {
        code: row.code,
        name: row.name,
        score: score,
        row_count: Number(row.row_count || 0)
      };
    }
  });

  return best;
}

function normalizePrvSourceTitle_(title) {
  return safeString_(title)
    .replace(/\b((?:19|20)\d{2})\s*\/\s*(\d{2})\b/g, "$1-$2")
    .replace(/\b((?:19|20)\d{2})\s*-\s*(\d{2})\b/g, "$1-$2")
    .replace(/\bNFL\b/gi, "Football")
    .replace(/\bNBA\b/gi, "Basketball")
    .replace(/\bMLB\b/gi, "Baseball")
    .replace(/\bNHL\b/gi, "Hockey")
    .replace(/\s+Analysis(?:\s*(?:&|and)\s*Deep Dive)?\s*$/i, "")
    .replace(/\s+Baby Deep Dive\s*$/i, "")
    .replace(/\s+(?:&|and)\s*Deep Dive\s*$/i, "")
    .replace(/\s+Deep Dive\s*$/i, "")
    .replace(/\s+Baby\s*$/i, "")
    .replace(/\s+and Updated Base Numbers\s*$/i, "")
    .replace(/\s+Value Boxes Analysis\s*$/i, " Value Box")
    .replace(/\s+/g, " ")
    .trim();
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
  const auditMode = normalizeSourceWatchMode_(input && input.mode ? input.mode : "quick_json");

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

  const indexRows = fetchChecklistIndex_(auditMode);
  const item = {
    title: title,
    sport: sport,
    url: ""
  };
  const classified = classifySourceItem_(item, indexRows);

  if (auditMode === "quick_json" && classified && classified.matched_code) {
    const counts = fetchPublicChecklistProductCounts_(sport, classified.matched_code);
    if (counts && counts.found) {
      classified.sheet_row_count = counts.row_count;
      classified.sheet_parallel_count = counts.parallel_count;
      classified.public_row_count = counts.row_count;
      classified.public_parallel_count = counts.parallel_count;
      classified.public_shard = counts.shard;
    }
  }

  return Object.assign({
    ok: true,
    mode: auditMode,
    coverage_source: auditMode === "quick_json" ? "public_json" : "google_sheets"
  }, classified);
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
    .replace(/\bworld\s+cup\s+26\b/g, "worldcup")
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

function fetchPublicChecklistProductCounts_(sport, code) {
  const s = normalize_(sport);
  const c = safeString_(code).trim();
  if (!s || !c) return null;

  try {
    const manifest = JSON.parse(fetchText_(CM_APP_DATA_BASE + "/checklists/products/" + encodeURIComponent(s) + ".json"));
    const productMap = manifest.product_map || manifest.productMap || {};
    const shard = productMap[c];
    if (!shard) return null;

    const shardData = JSON.parse(fetchText_(CM_APP_DATA_BASE + "/checklists/products/" + encodeURIComponent(shard)));
    const products = shardData.products || {};
    const product = products[c] || null;
    if (!product) return null;

    return {
      found: true,
      source: "app_public_json",
      shard: shard,
      row_count: Array.isArray(product.rows) ? product.rows.length : 0,
      parallel_count: Array.isArray(product.parallels) ? product.parallels.length : 0
    };
  } catch (err) {
    return fetchGitHubChecklistProductCounts_(s, c);
  }
}

function fetchPublishedChecklistProductCounts_(sport, code) {
  const publicCounts = fetchPublicChecklistProductCounts_(sport, code);
  if (publicCounts && publicCounts.found) return publicCounts;

  const githubCounts = fetchGitHubChecklistProductCounts_(sport, code);
  if (githubCounts && githubCounts.found) return githubCounts;

  return publicCounts || githubCounts || null;
}

function fetchGitHubChecklistProductCounts_(sport, code) {
  const s = normalize_(sport);
  const c = safeString_(code).trim();
  if (!s || !c) return null;

  const token = PropertiesService.getScriptProperties().getProperty(CM_GITHUB_TOKEN_PROPERTY);
  if (!token) {
    return {
      found: false,
      source: "github_main_json",
      row_count: 0,
      parallel_count: 0,
      error: "Missing Script Property " + CM_GITHUB_TOKEN_PROPERTY + " for canonical GitHub JSON validation."
    };
  }

  try {
    const manifest = JSON.parse(getGitHubRepoContentText_(CM_APP_DATA_OWNER, CM_APP_DATA_REPO, "data/v1/checklists/products/" + s + ".json", token, CM_VISUAL_TEST_BRANCH));
    const productMap = manifest.product_map || manifest.productMap || {};
    const shard = productMap[c];
    if (!shard) {
      return {
        found: false,
        source: "github_main_json",
        row_count: 0,
        parallel_count: 0,
        error: "Product code not found in GitHub main checklist manifest."
      };
    }

    const shardData = JSON.parse(getGitHubRepoContentText_(CM_APP_DATA_OWNER, CM_APP_DATA_REPO, "data/v1/checklists/products/" + shard, token, CM_VISUAL_TEST_BRANCH));
    const products = shardData.products || {};
    const product = products[c] || null;
    if (!product) {
      return {
        found: false,
        source: "github_main_json",
        shard: shard,
        row_count: 0,
        parallel_count: 0,
        error: "Product code not found in GitHub main checklist shard."
      };
    }

    return {
      found: true,
      source: "github_main_json",
      shard: shard,
      row_count: Array.isArray(product.rows) ? product.rows.length : 0,
      parallel_count: Array.isArray(product.parallels) ? product.parallels.length : 0
    };
  } catch (err) {
    return {
      found: false,
      source: "github_main_json",
      row_count: 0,
      parallel_count: 0,
      error: err && err.message ? err.message : String(err)
    };
  }
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
    return safeString_(objectValueForHeader_(productObj, header));
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
      return safeString_(objectValueForHeader_(obj, header));
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

function objectValueForHeader_(obj, header) {
  const source = obj || {};
  const direct = safeString_(header);
  if (Object.prototype.hasOwnProperty.call(source, direct)) return source[direct];

  const normalized = normalizeHeader_(direct);
  if (Object.prototype.hasOwnProperty.call(source, normalized)) return source[normalized];

  const keys = Object.keys(source);
  for (let i = 0; i < keys.length; i++) {
    if (normalizeHeader_(keys[i]) === normalized) return source[keys[i]];
  }

  return "";
}

function getPublishRecommendation_(sport, bucket) {
  const s = normalize_(sport);
  const b = safeString_(bucket || "").trim();
  if (s === "soccer" && b === "2025-26") return "publishCurrentSoccerChecklistToGitHub";
  if (s === "basketball" && b === "2025-26") return "publishCurrentBasketballChecklistToGitHub";
  if (s === "football" && b === "2026") return "publishCurrentFootballChecklistToGitHub";
  if (s === "baseball" && b === "2026") return "publishCurrentBaseballChecklistToGitHub";
  if (s === "hockey" && (b === "2025" || b === "2025-26")) return "publishCurrentHockeyChecklistToGitHub";

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
    + "&bucket=" + encodeURIComponent(getPublishBucketForChecklist_(product.sport, product.target_bucket || product.year || ""))
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

function getPublishBucketForChecklist_(sport, bucket) {
  const s = normalize_(sport);
  const b = safeString_(bucket || "").trim();
  if (s === "hockey" && b === "2025-26") return "2025";
  return b;
}

function publishImportedChecklist_(input) {
  requireOperatorKey_(input && input.key);

  const product = {
    sport: normalize_(input && input.sport),
    target_bucket: safeString_(input && (input.bucket || input.year)).trim(),
    year: safeString_(input && (input.bucket || input.year)).trim(),
    code: safeString_(input && input.code).trim()
  };

  if (!product.sport || !product.target_bucket || !product.code) {
    return {
      ok: false,
      error: "Missing sport, bucket, or code for publishImportedChecklist."
    };
  }

  const publish = publishChecklistAfterImport_(product, input && input.key);
  return {
    ok: !!(publish && publish.ok),
    status: publish && publish.ok ? "published" : "publish_needs_review",
    product: product,
    publish: publish,
    updated_at: new Date().toISOString()
  };
}

function summarizePublishResult_(publish) {
  if (!publish) return "No publish response.";
  if (publish.ok) {
    return "Publish returned ok" + (publish.commit ? " commit " + publish.commit : "") + ".";
  }
  if (publish.error) return publish.error;
  if (publish.status || publish.status_code) {
    return "Publish returned " + (publish.status || publish.status_code) + ".";
  }
  if (publish.response && publish.response.error) return publish.response.error;
  if (publish.response && publish.response.message) return publish.response.message;
  if (publish.response && publish.response.raw) return safeString_(publish.response.raw).slice(0, 220);
  if (publish.raw) return safeString_(publish.raw).slice(0, 220);
  try {
    return JSON.stringify(publish).slice(0, 220);
  } catch (err) {
    return "Publish response was not readable.";
  }
}

function publishPrvVaultStaticData_(input) {
  requireOperatorKey_(input && input.key);

  const code = safeString_(input && input.code).trim();
  const exporterUrl = PropertiesService.getScriptProperties().getProperty(CM_STATIC_EXPORTER_URL_PROPERTY);
  if (!exporterUrl) {
    return {
      ok: false,
      skipped: true,
      error: "Missing Script Property " + CM_STATIC_EXPORTER_URL_PROPERTY + ". PRV sheet write completed, but publish was not run."
    };
  }

  const url = exporterUrl
    + (exporterUrl.indexOf("?") > -1 ? "&" : "?")
    + "action=publishVaultStaticDataToGitHub"
    + "&code=" + encodeURIComponent(code)
    + "&key=" + encodeURIComponent(input && input.key || "");

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
      error: "Static Data Exporter PRV publish call failed with " + status,
      response: data
    };
  }

  return {
    ok: !!(data && data.ok),
    status: data && data.status ? data.status : data && data.ok ? "published" : "publish_needs_review",
    mode: "approved_prv_publish",
    code: code,
    publish: data,
    updated_at: new Date().toISOString()
  };
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

function dispatchSentinelSelfTest_(input) {
  requireOperatorKey_(input && input.key);

  const commandCenterUrl = safeString_(input && (input.commandCenterUrl || input.command_center_url)).trim()
    || "https://chasingmajors.github.io/cm-chat-prototype/command-center/";
  const startedAt = new Date().toISOString();

  const token = PropertiesService.getScriptProperties().getProperty(CM_GITHUB_TOKEN_PROPERTY);
  if (!token) {
    return {
      ok: false,
      error: "Missing Script Property " + CM_GITHUB_TOKEN_PROPERTY + ". Add a GitHub token with Actions workflow permission."
    };
  }

  const apiUrl = githubApiUrl_("/actions/workflows/" + encodeURIComponent(CM_SENTINEL_TEST_WORKFLOW) + "/dispatches");
  const payload = {
    ref: CM_VISUAL_TEST_BRANCH,
    inputs: {
      command_center_url: commandCenterUrl
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
      error: "GitHub Sentinel workflow dispatch failed with " + status,
      response: response
    };
  }

  const workflowUrl = "https://github.com/"
    + CM_VISUAL_TEST_OWNER
    + "/"
    + CM_VISUAL_TEST_REPO
    + "/actions/workflows/"
    + CM_SENTINEL_TEST_WORKFLOW;

  return {
    ok: true,
    status: "queued",
    started_at: startedAt,
    command_center_url: commandCenterUrl,
    workflow_url: workflowUrl,
    actions_url: "https://github.com/" + CM_VISUAL_TEST_OWNER + "/" + CM_VISUAL_TEST_REPO + "/actions",
    note: "Sentinel command center test queued. GitHub may take a few seconds to show the new run."
  };
}

function getSentinelSelfTestStatus_(input) {
  requireOperatorKey_(input && input.key);

  const startedAt = safeString_(input && (input.startedAt || input.started_at)).trim();
  const token = PropertiesService.getScriptProperties().getProperty(CM_GITHUB_TOKEN_PROPERTY);
  if (!token) {
    return {
      ok: false,
      error: "Missing Script Property " + CM_GITHUB_TOKEN_PROPERTY + ". Add a GitHub token with Actions workflow permission."
    };
  }

  const apiUrl = githubApiUrl_("/actions/workflows/" + encodeURIComponent(CM_SENTINEL_TEST_WORKFLOW) + "/runs?event=workflow_dispatch&per_page=25");
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
      error: "GitHub Sentinel workflow status lookup failed with " + status,
      response: data
    };
  }

  const run = findSentinelSelfTestRun_(data.workflow_runs || [], startedAt);
  if (!run) {
    return {
      ok: true,
      status: "queued",
      conclusion: "",
      result: "queued",
      note: "No matching Sentinel GitHub run is visible yet."
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
    run_id: run.id || "",
    run_number: run.run_number || "",
    run_url: run.html_url || "",
    created_at: run.created_at || "",
    updated_at: run.updated_at || "",
    head_sha: run.head_sha || "",
    display_title: run.display_title || run.name || ""
  };
}

function findSentinelSelfTestRun_(runs, startedAt) {
  const startedMs = startedAt ? Date.parse(startedAt) : 0;
  const matches = (runs || []).filter(function(run) {
    const title = normalize_(run.display_title || run.name || "");
    if (title.indexOf("sentinel command center test") === -1) return false;

    if (startedMs) {
      const createdMs = Date.parse(run.created_at || "");
      if (Number.isFinite(createdMs) && createdMs < startedMs - 120000) return false;
    }

    return true;
  });

  return matches.length ? matches[0] : null;
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

  const fastSweep = shouldUseFastAgentSweep_(input);
  const mode = fastSweep ? "quick_json" : (input && input.mode ? input.mode : "deep_sheets");
  const watch = runSourceWatch_(mode);
  const memory = loadOrCreateAgentMemoryForSchedule_(input && input.key);
  const sourceIgnores = memory.source_ignores || {};
  const skippedIgnored = (watch.items || []).filter(function(item) {
    return isMemorySourceIgnored_(item, sourceIgnores);
  }).length;
  const actionable = (watch.items || []).filter(function(item) {
    if (isMemorySourceIgnored_(item, sourceIgnores)) return false;
    return item.status === "missing" || item.status === "needs_review" || item.status === "possible_update";
  });
  const now = new Date().toISOString();

  memory.agent_actions = mergeScheduledSourceActions_(memory.agent_actions || [], actionable, now, watch.mode);
  memory.activity_log = prependMemoryActivity_(memory.activity_log || [], {
    id: "log_" + Date.now(),
    ts: now,
    type: "source_watch",
    title: "Scheduled Source Watch complete",
    detail: actionable.length + " actionable source items found from " + watch.coverage_source + "." + (skippedIgnored ? " " + skippedIgnored + " admin-ignored source item(s) skipped." : ""),
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

function runPrvSyncPublishForSchedule_(key) {
  let publish = {};
  let publishOk = false;
  let detail = "";

  try {
    publish = publishPrvVaultStaticData_({
      key: key,
      code: ""
    });
    publishOk = !!(publish && publish.ok);
    detail = publishOk
      ? "Scheduled PRV JSON sync completed."
      : publish && publish.error
        ? publish.error
        : "Scheduled PRV JSON sync returned a review response.";
  } catch (err) {
    publish = {
      ok: false,
      error: err && err.message ? err.message : String(err),
      stack: err && err.stack ? String(err.stack).slice(0, 2000) : ""
    };
    detail = publish.error;
  }

  return {
    ok: publishOk,
    status: publishOk ? "validated" : "failed",
    publish: publish,
    detail: detail
  };
}

function applyScheduledPrvSyncResultToMemory_(memory, sync, now) {
  const incidentId = "prv_sync_incident_full_vault";
  const actions = Array.isArray(memory.agent_actions) ? memory.agent_actions.slice() : [];
  let existing = null;
  const publishOk = !!(sync && sync.ok);
  const detail = sync && sync.detail ? sync.detail : "";

  actions.forEach(function(action) {
    if (action && action.id === incidentId) existing = action;
  });

  if (publishOk) {
    if (existing) {
      existing.status = "validated";
      existing.executionResult = "Scheduled PRV full JSON sync completed through Static Data Exporter.";
      existing.validationResult = detail;
      existing.recommendedAction = "No admin action needed unless a specific PRV product fails public validation.";
      existing.updatedAt = now;
    }
  } else {
    const patch = {
      id: incidentId,
      type: "prv_sync_incident",
      source: "scheduled_prv_sync",
      product: "Print Run Vault JSON Sync",
      sport: "",
      code: "prv_full_sync",
      riskLevel: "high",
      status: "failed",
      recommendedAction: "Run Agent Cycle to let Sentinel retry PRV JSON sync once. If it fails again, inspect Static Data Exporter logs and GitHub publish permissions.",
      adminDecision: "",
      executionResult: "Scheduled PRV full JSON sync failed.",
      validationResult: detail,
      runUrl: "",
      sourceUrl: "",
      createdAt: existing && existing.createdAt ? existing.createdAt : now,
      updatedAt: now
    };
    if (existing) Object.assign(existing, patch);
    else actions.unshift(patch);
  }

  memory.agent_actions = actions.slice(0, 80);
  memory.activity_log = prependMemoryActivity_(memory.activity_log || [], {
    id: "log_" + Date.now(),
    ts: now,
    type: "prv_sync",
    title: publishOk ? "Scheduled PRV sync complete" : "Scheduled PRV sync failed",
    detail: detail,
    status: publishOk ? "validated" : "failed",
    product: "Print Run Vault",
    source: "operator_backend"
  });
  memory.saved_at = now;
  return memory;
}

function runScheduledPrvSync_(input) {
  requireOperatorKey_(input && input.key);

  const now = new Date().toISOString();
  const sync = runPrvSyncPublishForSchedule_(input && input.key);
  const memory = applyScheduledPrvSyncResultToMemory_(
    loadOrCreateAgentMemoryForSchedule_(input && input.key),
    sync,
    now
  );

  let saveResult = {};
  try {
    saveResult = saveAgentMemory_({
      key: input && input.key,
      memory: memory
    });
  } catch (err) {
    saveResult = {
      ok: false,
      error: err && err.message ? err.message : String(err)
    };
  }

  return {
    ok: sync.ok,
    status: sync.status,
    publish: sync.publish,
    incident_created: !sync.ok,
    memory_path: saveResult.path || "",
    memory_sha: saveResult.sha || "",
    memory_error: saveResult.error || "",
    updated_at: now
  };
}

function runScheduledAgentSweep_(input) {
  requireOperatorKey_(input && input.key);

  const now = new Date().toISOString();
  const fastSweep = shouldUseFastAgentSweep_(input);
  const mode = fastSweep ? "quick_json" : (input && input.mode ? input.mode : "deep_sheets");
  let checklistWatch = {};
  let prvWatch = {};
  let prvSync = {};
  let checklistError = "";
  let prvError = "";

  try {
    checklistWatch = runSourceWatch_(mode);
  } catch (err) {
    checklistError = err && err.message ? err.message : String(err);
    checklistWatch = {
      ok: false,
      mode: mode,
      coverage_source: mode === "quick_json" ? "public_json" : "google_sheets",
      fetched_count: 0,
      summary: {},
      items: [],
      error: checklistError
    };
  }

  try {
    prvWatch = runPrvSourceWatch_("quick_json");
  } catch (err) {
    prvError = err && err.message ? err.message : String(err);
    prvWatch = {
      ok: false,
      mode: "quick_json",
      coverage_source: "public_vault_json",
      fetched_count: 0,
      summary: {},
      items: [],
      error: prvError
    };
  }

  const skipPrvSync = shouldSkipAgentSweepPrvSync_(input);
  prvSync = skipPrvSync
    ? {
      ok: true,
      status: "skipped",
      detail: "PRV sync skipped for fast agent sweep. Use Sync PRV JSON or scheduled PRV sync for full PRV publish validation.",
      publish: {
        ok: true,
        skipped: true
      }
    }
    : runPrvSyncPublishForSchedule_(input && input.key);

  const memory = loadOrCreateAgentMemoryForSchedule_(input && input.key);
  const sourceIgnores = memory.source_ignores || {};
  const checklistItems = checklistWatch.items || [];
  const prvItems = prvWatch.items || [];
  const skippedChecklistIgnored = checklistItems.filter(function(item) {
    return isMemorySourceIgnored_(item, sourceIgnores);
  }).length;
  const skippedPrvIgnored = prvItems.filter(function(item) {
    return isMemorySourceIgnored_(item, sourceIgnores);
  }).length;
  const checklistActionable = checklistItems.filter(function(item) {
    if (isMemorySourceIgnored_(item, sourceIgnores)) return false;
    return item.status === "missing" || item.status === "needs_review" || item.status === "possible_update";
  });
  const prvActionable = prvItems.filter(function(item) {
    if (isMemorySourceIgnored_(item, sourceIgnores)) return false;
    return item.status === "missing" || item.status === "needs_review" || item.status === "possible_update" || item.status === "known_issue";
  });

  memory.agent_actions = mergeScheduledSourceActions_(memory.agent_actions || [], checklistActionable, now, checklistWatch.mode || mode);
  memory.agent_actions = mergeScheduledPrvActions_(memory.agent_actions || [], prvActionable, now, prvWatch.mode || "quick_json");
  applyScheduledPrvSyncResultToMemory_(memory, prvSync, now);

  const autoResult = maybeRunScheduledAutoActions_(
    memory,
    input && input.key,
    now,
    getScheduledAutoActionLimit_(input)
  );

  const detailParts = [
    "Checklist: " + checklistActionable.length + " actionable from " + (checklistWatch.fetched_count || 0) + " checked.",
    "PRV: " + prvActionable.length + " actionable from " + (prvWatch.fetched_count || 0) + " checked.",
    "PRV sync: " + (prvSync.status === "skipped" ? "skipped for fast sweep." : (prvSync.ok ? "passed." : "failed."))
  ];
  const sportInference = getSportInferenceSelfTest_();
  if (!sportInference.ok) {
    detailParts.push("Sport inference guard failed: " + sportInference.failed.map(function(item) {
      return item.title + " expected " + item.expected + " got " + item.actual;
    }).join("; "));
  }
  if (skippedChecklistIgnored || skippedPrvIgnored) {
    detailParts.push((skippedChecklistIgnored + skippedPrvIgnored) + " admin-ignored source item(s) skipped.");
  }
  if (autoResult && autoResult.ran) {
    detailParts.push("Auto actions: " + autoResult.count + " run. " + autoResult.summary + (autoResult.queue_count ? " Queue remaining: " + (autoResult.queue_remaining || 0) + "." : ""));
  } else if (autoResult && autoResult.reason) {
    detailParts.push("Auto action: " + autoResult.reason + (autoResult.queue_count ? " Queue count: " + autoResult.queue_count + "." : ""));
  }
  if (checklistError) detailParts.push("Checklist error: " + checklistError);
  if (prvError) detailParts.push("PRV source error: " + prvError);

  memory.activity_log = prependMemoryActivity_(memory.activity_log || [], {
    id: "log_" + Date.now(),
    ts: now,
    type: "agent_sweep",
    title: "Scheduled Agent Sweep complete",
    detail: detailParts.join(" "),
    status: checklistActionable.length || prvActionable.length || !prvSync.ok || !sportInference.ok ? "needs_review" : "validated",
    product: "",
    source: "operator_backend"
  });
  memory.saved_at = now;

  let saveResult = {};
  try {
    saveResult = saveAgentMemory_({
      key: input && input.key,
      memory: memory
    });
  } catch (err) {
    saveResult = {
      ok: false,
      error: err && err.message ? err.message : String(err)
    };
  }

  return {
    ok: !checklistError && !prvError && !!prvSync.ok && sportInference.ok,
    status: checklistActionable.length || prvActionable.length || !prvSync.ok || !sportInference.ok ? "needs_review" : "validated",
    mode: checklistWatch.mode || mode,
    checklist: {
      ok: !!checklistWatch.ok,
      coverage_source: checklistWatch.coverage_source || "",
      fetched_count: checklistWatch.fetched_count || 0,
      actionable_count: checklistActionable.length,
      ignored_count: skippedChecklistIgnored,
      summary: checklistWatch.summary || {},
      error: checklistError
    },
    prv: {
      ok: !!prvWatch.ok,
      coverage_source: prvWatch.coverage_source || "",
      fetched_count: prvWatch.fetched_count || 0,
      actionable_count: prvActionable.length,
      ignored_count: skippedPrvIgnored,
      summary: prvWatch.summary || {},
      error: prvError
    },
    prv_sync: {
      ok: !!prvSync.ok,
      status: prvSync.status,
      detail: prvSync.detail,
      publish: prvSync.publish
    },
    auto_action: autoResult && autoResult.primary ? autoResult.primary : autoResult,
    auto_actions: autoResult,
    sport_inference: sportInference,
    memory_path: saveResult.path || "",
    memory_sha: saveResult.sha || "",
    memory_error: saveResult.error || "",
    updated_at: now
  };
}

function runScheduledPrvSyncTrigger() {
  const key = PropertiesService.getScriptProperties().getProperty(CM_OPERATOR_KEY_PROPERTY);
  if (!key) {
    const result = {
      ok: false,
      error: "Missing Script Property " + CM_OPERATOR_KEY_PROPERTY + ". Scheduled PRV sync did not run.",
      updated_at: new Date().toISOString()
    };
    Logger.log(JSON.stringify(result));
    return result;
  }

  try {
    return runScheduledPrvSync_({ key: key });
  } catch (err) {
    const result = {
      ok: false,
      error: err && err.message ? err.message : String(err),
      stack: err && err.stack ? String(err.stack).slice(0, 2000) : "",
      updated_at: new Date().toISOString()
    };
    Logger.log("Scheduled PRV sync trigger failed: " + JSON.stringify(result));
    return result;
  }
}

function shouldSkipAgentSweepPrvSync_(input) {
  const raw = safeString_(input && (input.skipPrvSync || input.skip_prv_sync || input.fast || input.fastMode || input.fast_mode)).trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "fast";
}

function shouldUseFastAgentSweep_(input) {
  const raw = safeString_(input && (input.fast || input.fastMode || input.fast_mode)).trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "fast";
}

function runScheduledAgentSweepTrigger() {
  const key = PropertiesService.getScriptProperties().getProperty(CM_OPERATOR_KEY_PROPERTY);
  if (!key) {
    const result = {
      ok: false,
      error: "Missing Script Property " + CM_OPERATOR_KEY_PROPERTY + ". Scheduled Agent Sweep did not run.",
      updated_at: new Date().toISOString()
    };
    Logger.log(JSON.stringify(result));
    return result;
  }

  try {
    return runScheduledAgentSweep_({
      key: key,
      mode: "deep_sheets",
      maxAutoActions: 6
    });
  } catch (err) {
    const result = {
      ok: false,
      error: err && err.message ? err.message : String(err),
      stack: err && err.stack ? String(err.stack).slice(0, 2000) : "",
      updated_at: new Date().toISOString()
    };
    Logger.log("Scheduled Agent Sweep trigger failed: " + JSON.stringify(result));
    return result;
  }
}

function getScheduledAutoActionLimit_(input) {
  const raw = Number(input && (input.maxAutoActions || input.max_auto_actions || input.autoLimit || input.auto_limit || 1));
  if (!raw || raw < 1) return 1;
  return Math.min(10, Math.floor(raw));
}

function maybeRunScheduledAutoActions_(memory, key, now, maxActions) {
  const mode = safeString_(memory && memory.autonomy_mode).trim() || "approval_required";
  const limit = Math.max(1, Math.min(10, Number(maxActions || 1)));
  const queuedIds = normalizeAgentRunQueue_(memory);

  if (mode !== "full_auto" && mode !== "guarded_auto") {
    return {
      ran: false,
      count: 0,
      mode: mode,
      queue_count: queuedIds.length,
      results: [],
      reason: "Auto execution is off."
    };
  }

  const results = [];
  for (let i = 0; i < limit; i++) {
    const result = maybeRunScheduledAutoAction_(memory, key, now);
    if (!result || !result.ran) {
      if (!results.length) {
        return {
          ran: false,
          count: 0,
          mode: mode,
          queue_count: queuedIds.length,
          results: [],
          reason: result && result.reason ? result.reason : "No safe auto-executable action found."
        };
      }
      break;
    }

    results.push(result);

    removeResolvedAgentRunQueueItems_(memory);
    const hasMoreQueuedWork = normalizeAgentRunQueue_(memory).some(function(id) {
      return !!findMemoryActionById_(memory.agent_actions || [], id);
    });
    if (result.status !== "validated" && !hasMoreQueuedWork) break;
  }

  removeResolvedAgentRunQueueItems_(memory);
  return {
    ran: results.length > 0,
    count: results.length,
    mode: mode,
    queue_count: queuedIds.length,
    queue_remaining: normalizeAgentRunQueue_(memory).length,
    primary: results[0] || null,
    results: results,
    summary: results.map(function(result) {
      const detail = safeString_(result.validationResult || result.executionResult || "").slice(0, 120);
      return (result.product || result.type || "action") + " -> " + (result.status || "completed") + (detail ? " (" + detail + ")" : "");
    }).join("; "),
    reason: results.length ? "" : "No safe auto-executable action found."
  };
}

function maybeRunScheduledAutoAction_(memory, key, now) {
  const mode = safeString_(memory && memory.autonomy_mode).trim() || "approval_required";
  if (mode !== "full_auto" && mode !== "guarded_auto") {
    return {
      ran: false,
      mode: mode,
      reason: "Auto execution is off."
    };
  }

  const actions = Array.isArray(memory.agent_actions) ? memory.agent_actions : [];
  normalizeQueuedSourceImportActions_(actions, now);
  const action = findNextScheduledAutoAction_(actions, memory);
  if (!action) {
    return {
      ran: false,
      mode: mode,
      queue_count: normalizeAgentRunQueue_(memory).length,
      reason: normalizeAgentRunQueue_(memory).length
        ? "Queued actions exist, but none have a safe executable next step yet."
        : "No safe auto-executable action found."
    };
  }

  applyRunQueueApprovalToMemoryAction_(memory, action, now);
  const actionStatus = safeString_(action.status).trim().toLowerCase();
  const wasPendingPublicValidation = actionStatus === "pending_public_validation";
  const wasPendingVisualValidation = actionStatus === "pending_visual_validation";
  const wasVisualInFlight = (actionStatus === "queued" || actionStatus === "running" || actionStatus === "in_progress") &&
    safeString_(action.validationResult).toLowerCase().indexOf("visual") > -1;
  const isCoverageOnlyAudit = (action.type === "backend_data_issue" || action.source === "deep_backend_audit") &&
    !!safeString_(action.code).trim();
  if (mode === "guarded_auto" && actionStatus !== "pending_public_validation" && !wasPendingVisualValidation && !wasVisualInFlight) {
    return {
      ran: false,
      mode: mode,
      action_id: action.id,
      product: action.product || "",
      reason: "Guarded auto only self-heals pending public or visual validation. Switch to Full auto for approved writes."
    };
  }

  const safety = validateScheduledAutoActionSafety_(action);
  if (!safety.ok) {
    patchMemoryAction_(actions, action.id, {
      status: "known_issue",
      executionResult: "Full-auto guardrail blocked execution.",
      validationResult: safety.reason,
      updatedAt: now
    });
    memory.activity_log = prependMemoryActivity_(memory.activity_log || [], {
      id: "log_" + Date.now(),
      ts: now,
      type: "auto_action",
      title: "Full-auto action blocked",
      detail: (action.product || action.type || "Action") + ": " + safety.reason,
      status: "needs_review",
      product: action.product || "",
      source: "operator_backend"
    });
    return {
      ran: false,
      mode: mode,
      action_id: action.id,
      product: action.product || "",
      reason: safety.reason
    };
  }

  patchMemoryAction_(actions, action.id, {
    status: "running",
    executionResult: "Full-auto execution started.",
    validationResult: "Running product-scoped write, publish, and published JSON validation.",
    updatedAt: now
  });

  let result = {};
  try {
    if (wasPendingVisualValidation || wasVisualInFlight) {
      result = runScheduledVisualAutoAction_(action, key);
    } else if (isCoverageOnlyAudit || (action.type === "source_import" && wasPendingPublicValidation)) {
      result = runScheduledChecklistPendingValidationAction_(action, key);
    } else if (action.type === "source_import") {
      result = runScheduledChecklistAutoAction_(action, key);
    } else if (action.type === "prv_source_review") {
      result = runScheduledPrvAutoAction_(action, key);
    } else {
      result = {
        ok: false,
        status: "needs_review",
        error: "Unsupported full-auto action type: " + action.type
      };
    }
  } catch (err) {
    result = {
      ok: false,
      status: "failed",
      error: err && err.message ? err.message : String(err),
      stack: err && err.stack ? String(err.stack).slice(0, 1200) : ""
    };
  }

  const resultStatus = safeString_(result.status).trim().toLowerCase();
  const finalStatus = result.ok && result.pendingVisualValidation
    ? "pending_visual_validation"
    : result.ok && result.validated
    ? "validated"
    : resultStatus === "queued" || resultStatus === "running" || resultStatus === "in_progress"
      ? resultStatus
    : resultStatus === "pending_public_validation"
      ? "pending_public_validation"
    : result.ok
      ? "needs_admin"
      : resultStatus === "known_issue" || resultStatus === "needs_admin" || resultStatus === "blocked"
        ? resultStatus
        : "failed";
  const executionResult = result.executionResult || result.error || "Full-auto action completed.";
  const validationResult = result.validationResult || result.error || "Validation needs review.";

  patchMemoryAction_(actions, action.id, {
    status: finalStatus,
    sport: result.sport || action.sport || "",
    code: result.code || action.code || "",
    targetBucket: result.targetBucket || action.targetBucket || "",
    pendingValidationAttempts: result.pendingValidationAttempts || action.pendingValidationAttempts || 0,
    executionResult: executionResult,
    validationResult: validationResult,
    visualStartedAt: result.visualStartedAt || action.visualStartedAt || "",
    visualRunUrl: result.runUrl || action.visualRunUrl || "",
    runUrl: result.runUrl || action.runUrl || "",
    autoExecutedAt: now,
    updatedAt: now
  });

  memory.activity_log = prependMemoryActivity_(memory.activity_log || [], {
    id: "log_" + Date.now(),
    ts: now,
    type: "auto_action",
    title: finalStatus === "validated" ? "Full-auto action completed" : finalStatus === "failed" ? "Full-auto action failed" : finalStatus === "pending_public_validation" ? "Full-auto action pending public validation" : finalStatus === "pending_visual_validation" ? "Full-auto action pending visual validation" : "Full-auto action needs review",
    detail: (action.product || action.type || "Action") + ": " + executionResult + " " + validationResult,
    status: finalStatus,
    product: action.product || "",
    source: "operator_backend"
  });

  return {
    ran: true,
    mode: mode,
    from_run_queue: isActionQueuedForAgent_(memory, action.id),
    action_id: action.id,
    product: action.product || "",
    type: action.type || "",
    status: finalStatus,
    ok: !!result.ok,
    validated: !!result.validated,
    pendingVisualValidation: !!result.pendingVisualValidation,
    executionResult: executionResult,
    validationResult: validationResult
  };
}

function normalizeAgentRunQueue_(memory) {
  const seen = {};
  const out = [];
  const queue = Array.isArray(memory && memory.agent_run_queue) ? memory.agent_run_queue : [];
  queue.forEach(function(id) {
    id = safeString_(id).trim();
    if (!id || seen[id]) return;
    seen[id] = true;
    out.push(id);
  });
  if (memory) memory.agent_run_queue = out;
  return out;
}

function findMemoryActionById_(actions, id) {
  id = safeString_(id).trim();
  if (!id || !Array.isArray(actions)) return null;
  for (let i = 0; i < actions.length; i++) {
    if (actions[i] && actions[i].id === id) return actions[i];
  }
  return null;
}

function isMemoryActionResolved_(action) {
  const status = safeString_(action && action.status).trim().toLowerCase();
  return status === "validated" || status === "done" || status === "ignored";
}

function isActionQueuedForAgent_(memory, id) {
  id = safeString_(id).trim();
  if (!id) return false;
  return normalizeAgentRunQueue_(memory).indexOf(id) > -1;
}

function removeResolvedAgentRunQueueItems_(memory) {
  const actions = Array.isArray(memory && memory.agent_actions) ? memory.agent_actions : [];
  const before = normalizeAgentRunQueue_(memory);
  const after = before.filter(function(id) {
    const action = findMemoryActionById_(actions, id);
    return !!(action && !isMemoryActionResolved_(action));
  });
  if (memory) memory.agent_run_queue = after;
  return before.length - after.length;
}

function findNextQueuedScheduledAutoAction_(actions, memory) {
  const queue = normalizeAgentRunQueue_(memory);
  for (let i = 0; i < queue.length; i++) {
    const action = findMemoryActionById_(actions, queue[i]);
    if (!action || isMemoryActionResolved_(action)) continue;
    const status = safeString_(action.status).trim().toLowerCase();
    const validation = safeString_(action.validationResult).toLowerCase();
    if ((status === "running" || status === "queued" || status === "in_progress") && validation.indexOf("visual") === -1) continue;
    if (action.type !== "source_import" && action.type !== "checklist_publish" && action.type !== "prv_source_review" && action.type !== "backend_data_issue") continue;
    return action;
  }
  return null;
}

function isRunQueueApprovalEligibleMemoryAction_(action) {
  const type = safeString_(action && action.type).trim().toLowerCase();
  if (type !== "source_import" && type !== "checklist_publish" && type !== "prv_source_review" && type !== "prv_publish" && type !== "backend_data_issue") return false;
  return !!(safeString_(action && action.product).trim() || safeString_(action && action.code).trim());
}

function applyRunQueueApprovalToMemoryAction_(memory, action, now) {
  if (!action || !isActionQueuedForAgent_(memory, action.id)) return action;
  if (!isRunQueueApprovalEligibleMemoryAction_(action)) return action;

  const status = safeString_(action.status).trim().toLowerCase();
  if (status !== "needs_admin" && status !== "approval_required" && status !== "ready") return action;

  action.status = "approved";
  action.adminDecision = "run_queue_approved";
  action.executionResult = action.executionResult || "Admin Run Queue approval recorded.";
  action.validationResult = action.validationResult || "Sentinel may attempt the next product-scoped safe step.";
  action.updatedAt = now;

  memory.activity_log = prependMemoryActivity_(memory.activity_log || [], {
    id: "log_" + Date.now(),
    ts: now,
    type: "agent_run_queue",
    title: "Run Queue approval applied",
    detail: (action.product || action.code || action.type || "Action") + " was approved because admin flagged it for the run queue.",
    status: "approved",
    product: action.product || "",
    source: "operator_backend"
  });

  return action;
}

function findNextScheduledAutoAction_(actions, memory) {
  const queued = findNextQueuedScheduledAutoAction_(actions, memory);
  if (queued) return queued;

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i] || {};
    const status = safeString_(action.status).trim().toLowerCase();
    if (status !== "pending_visual_validation") continue;
    if (action.type !== "source_import" && action.type !== "checklist_publish" && action.type !== "prv_source_review" && action.type !== "backend_data_issue") continue;
    return action;
  }

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i] || {};
    const status = safeString_(action.status).trim().toLowerCase();
    const validation = safeString_(action.validationResult).toLowerCase();
    if (status !== "queued" && status !== "running" && status !== "in_progress") continue;
    if (validation.indexOf("visual") === -1) continue;
    if (action.type !== "source_import" && action.type !== "checklist_publish" && action.type !== "prv_source_review") continue;
    return action;
  }

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i] || {};
    const status = safeString_(action.status).trim().toLowerCase();
    if (status !== "pending_public_validation") continue;
    if (action.type !== "source_import" && action.type !== "prv_source_review") continue;
    return action;
  }

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i] || {};
    const status = safeString_(action.status).trim().toLowerCase();
    if (status !== "approval_required" && status !== "needs_admin" && status !== "approved") continue;
    if (action.type !== "source_import" && action.type !== "prv_source_review") continue;
    if (safeString_(action.executionResult).toLowerCase().indexOf("full-auto execution started") > -1) continue;
    return action;
  }
  return null;
}

function validateScheduledAutoActionSafety_(action) {
  const sport = normalize_(action && action.sport);
  const sourceUrl = safeString_(action && (action.sourceUrl || action.runUrl)).trim();
  const product = safeString_(action && action.product).trim();
  const code = safeString_(action && action.code).trim();
  const status = safeString_(action && action.status).trim().toLowerCase();
  const isPendingPublicValidation = status === "pending_public_validation";
  const isPendingVisualValidation = status === "pending_visual_validation";
  const isVisualInFlight = (status === "queued" || status === "running" || status === "in_progress") &&
    safeString_(action && action.validationResult).toLowerCase().indexOf("visual") > -1;
  const isCoverageOnlyAudit = (safeString_(action && action.type).trim().toLowerCase() === "backend_data_issue" || safeString_(action && action.source).trim().toLowerCase() === "deep_backend_audit") &&
    !!code;

  if (!product) return { ok: false, reason: "Missing product name." };
  if (!isAllowedSport_(sport)) return { ok: false, reason: "Unsupported or missing sport." };
  if (hasBlockedTerm_(product)) return { ok: false, reason: "Blocked product category term detected." };
  if (isPendingPublicValidation && !code) return { ok: false, reason: "Pending validation is missing product code." };
  if (!isPendingPublicValidation && !isPendingVisualValidation && !isVisualInFlight && !isCoverageOnlyAudit && !sourceUrl) return { ok: false, reason: "Missing source URL." };

  if (!isPendingPublicValidation && !isPendingVisualValidation && !isVisualInFlight && !isCoverageOnlyAudit && action.type === "source_import" && !/^https:\/\/www\.checklistcenter\.com\//i.test(sourceUrl)) {
    return { ok: false, reason: "Checklist auto-import only supports Checklist Center URLs." };
  }

  if (!isPendingPublicValidation && !isPendingVisualValidation && !isVisualInFlight && !isCoverageOnlyAudit && action.type === "prv_source_review" && !/^https:\/\/slabsquatch\.substack\.com\/p\//i.test(sourceUrl)) {
    return { ok: false, reason: "PRV auto-import only supports SlabSquatch post URLs." };
  }

  return { ok: true, reason: "" };
}

function normalizeQueuedSourceImportActions_(actions, now) {
  if (!Array.isArray(actions)) return;

  actions.forEach(function(action) {
    if (!action || action.type !== "source_import") return;

    const sourceText = [
      action.product || "",
      action.sourceUrl || "",
      action.runUrl || "",
      action.code || ""
    ].join(" ");
    const inferredSport = inferSport_(sourceText);

    if (inferredSport && inferredSport !== normalize_(action.sport)) {
      action.previousSport = action.sport || "";
      action.sport = inferredSport;
      action.id = buildScheduledSourceActionId_({
        sport: inferredSport,
        matched_code: action.code || "",
        title: action.product || "",
        url: action.sourceUrl || action.runUrl || ""
      });
      action.updatedAt = now;
      action.validationResult = "Sport corrected from " + action.previousSport + " to " + inferredSport + " before execution.";
    }
  });

  const seen = {};
  actions.forEach(function(action) {
    if (!action || action.type !== "source_import") return;
    const key = buildScheduledActionDedupeKey_(action);
    if (!key) return;

    const existing = seen[key];
    if (!existing) {
      seen[key] = action;
      return;
    }

    const keep = choosePreferredScheduledAction_(existing, action);
    const drop = keep === existing ? action : existing;
    seen[key] = keep;

    drop.status = "validated";
    drop.adminDecision = "auto_deduped";
    drop.executionResult = "Duplicate queued action collapsed into " + (keep.id || "the active action") + ".";
    drop.validationResult = "Same source/product already handled by the active queue item.";
    drop.updatedAt = now;
  });
}

function buildScheduledActionDedupeKey_(action) {
  const source = normalize_(action && (action.sourceUrl || action.runUrl || ""));
  const product = normalize_(action && action.product);
  const code = normalize_(action && action.code);
  return source || code || product;
}

function choosePreferredScheduledAction_(a, b) {
  const aStatus = safeString_(a && a.status).toLowerCase();
  const bStatus = safeString_(b && b.status).toLowerCase();
  if (aStatus === "validated" && bStatus !== "validated") return a;
  if (bStatus === "validated" && aStatus !== "validated") return b;
  if (normalize_(a && a.sport) === "soccer" && normalize_(b && b.sport) !== "soccer") return a;
  if (normalize_(b && b.sport) === "soccer" && normalize_(a && a.sport) !== "soccer") return b;
  return a;
}

function runScheduledChecklistAutoAction_(action, key) {
  const write = executeSourceImport_({
    sourceUrl: action.sourceUrl || action.runUrl || "",
    sport: action.sport || "",
    key: key,
    publish: "1"
  });

  if (!write || !write.ok) {
    return {
      ok: false,
      status: "failed",
      error: write && write.error ? write.error : "Checklist sheet write failed.",
      executionResult: "Checklist sheet write failed.",
      validationResult: write && write.error ? write.error : "No validation proof."
    };
  }

  const product = write.product || {};
  const publishAttempt = ensureChecklistPublishAfterAutoWrite_(write, product, key);
  const publicValidation = waitForPublicChecklistProduct_(product.sport || action.sport || "", product.code || action.code || "");
  const publicRows = Number(publicValidation && publicValidation.row_count || 0);
  const publishOk = !!(publishAttempt.publish && publishAttempt.publish.ok);
  const validated = publicRows > 0;
  const publishDetail = summarizePublishResult_(publishAttempt.publish);
  const productDetail = "Checked " + (product.sport || action.sport || "unknown sport")
    + " " + (product.target_bucket || product.year || "unknown bucket")
    + " code " + (product.code || action.code || "unknown code") + ".";

  return {
    ok: true,
    validated: validated,
    status: validated ? "pending_visual_validation" : "pending_public_validation",
    sport: product.sport || action.sport || "",
    code: product.code || action.code || "",
    targetBucket: product.target_bucket || product.year || action.targetBucket || "",
    pendingValidationAttempts: validated ? 0 : 1,
    executionResult: publishOk
      ? "Checklist sheet write and JSON publish completed for " + (product.code || action.code || "product") + "."
      : "Checklist sheet write completed; published JSON validation is pending for " + (product.code || action.code || "product") + ".",
    validationResult: validated
      ? "Published checklist JSON validated with " + publicRows + " rows. CV/ChatBot visual validation is pending."
      : "Checklist write completed, but published JSON is not visible yet. The agent will retry publish validation on the next sweep. " + publishDetail + " " + productDetail + " Recheck: " + summarizePublicChecklistValidation_(publicValidation)
    ,
    pendingVisualValidation: validated
  };
}

function runScheduledChecklistPendingValidationAction_(action, key) {
  const sport = normalize_(action && action.sport);
  const code = safeString_(action && action.code).trim();
  const targetBucket = safeString_(action && (action.targetBucket || action.bucket || action.year)).trim();
  const attempts = Number(action && action.pendingValidationAttempts || 0) + 1;

  if (!sport || !code) {
    return {
      ok: false,
      status: "needs_admin",
      error: "Pending validation is missing sport or product code.",
      executionResult: "Public JSON validation could not run.",
      validationResult: "Missing sport or product code for pending validation recheck."
    };
  }

  let publicValidation = waitForPublicChecklistProduct_(sport, code);
  let publicRows = Number(publicValidation && publicValidation.row_count || 0);
  let publicParallels = Number(publicValidation && publicValidation.parallel_count || 0);
  const expectedRows = Number(action && (action.expectedRowCount || action.expected_row_count) || 0);
  const expectedParallels = Number(action && (action.expectedParallelCount || action.expected_parallel_count) || 0);
  const publicIsShort = (expectedRows > 0 && publicRows < expectedRows) ||
    (expectedParallels > 0 && publicParallels < expectedParallels);
  let publish = null;

  if ((publicRows <= 0 || publicIsShort) && attempts <= 3) {
    publish = publishChecklistAfterImport_({
      sport: sport,
      target_bucket: targetBucket,
      year: targetBucket,
      code: code
    }, key);
    publicValidation = waitForPublicChecklistProduct_(sport, code);
    publicRows = Number(publicValidation && publicValidation.row_count || 0);
    publicParallels = Number(publicValidation && publicValidation.parallel_count || 0);
  }

  const meetsExpectedRows = expectedRows <= 0 || publicRows >= expectedRows;
  const meetsExpectedParallels = expectedParallels <= 0 || publicParallels >= expectedParallels;
  const validated = publicRows > 0 && meetsExpectedRows && meetsExpectedParallels;
  const detail = "Checked " + sport + " " + (targetBucket || "current") + " code " + code + ".";

  return {
    ok: true,
    validated: validated,
    status: validated ? "pending_visual_validation" : attempts >= 3 ? "needs_review" : "pending_public_validation",
    sport: sport,
    code: code,
    targetBucket: targetBucket,
    pendingValidationAttempts: validated ? 0 : attempts,
    executionResult: validated
      ? "Pending checklist publish validation completed for " + code + "."
      : "Pending checklist publish validation rechecked for " + code + ".",
    validationResult: validated
      ? "Published checklist JSON validated with " + publicRows + " rows and " + publicParallels + " parallels. CV/ChatBot visual validation is pending."
      : "Published checklist JSON is still pending or stale after " + attempts + " check(s). Expected " + (expectedRows || "any") + " rows / " + (expectedParallels || "any") + " parallels; found " + publicRows + " rows / " + publicParallels + " parallels. " + (publish ? summarizePublishResult_(publish) + " " : "") + detail + " Recheck: " + summarizePublicChecklistValidation_(publicValidation)
    ,
    pendingVisualValidation: validated
  };
}

function ensureChecklistPublishAfterAutoWrite_(write, product, key) {
  const firstPublish = write && write.publish ? write.publish : null;
  if (firstPublish && firstPublish.ok) {
    return {
      publish: firstPublish,
      retried: false
    };
  }

  const retryPublish = publishChecklistAfterImport_(product || {}, key);
  if (retryPublish && retryPublish.ok) {
    return {
      publish: retryPublish,
      retried: true,
      first_publish: firstPublish
    };
  }

  return {
    publish: retryPublish || firstPublish,
    retried: true,
    first_publish: firstPublish
  };
}

function waitForPublicChecklistProduct_(sport, code) {
  const attempts = [0, 1500, 3000, 6000, 10000];
  let last = null;

  for (let i = 0; i < attempts.length; i++) {
    if (attempts[i]) Utilities.sleep(attempts[i]);
    last = fetchPublishedChecklistProductCounts_(sport, code);
    if (last && last.found && Number(last.row_count || 0) > 0) return last;
  }

  return last || {
    found: false,
    row_count: 0,
    parallel_count: 0,
    error: "Product code not found in public checklist JSON yet."
  };
}

function summarizePublicChecklistValidation_(result) {
  if (!result) return "No public validation response.";
  if (result.found) {
    return "Found " + Number(result.row_count || 0) + " rows and " + Number(result.parallel_count || 0) + " parallels in " + (result.source || "published_json") + " " + (result.shard || "checklist JSON") + ".";
  }
  return result.error || "Product code not found in public checklist JSON yet.";
}

function runScheduledPrvAutoAction_(action, key) {
  const preview = previewPrvSource_({
    sourceUrl: action.sourceUrl || action.runUrl || "",
    sport: action.sport || ""
  });

  if (!preview || !preview.ok || preview.status !== "preview_ready") {
    const warning = preview && preview.warnings && preview.warnings.length
      ? preview.warnings.join(" ")
      : preview && preview.error
        ? preview.error
        : "PRV source preview is not ready for write.";
    return {
      ok: false,
      status: "known_issue",
      error: warning,
      executionResult: "PRV source preview did not produce writable rows.",
      validationResult: warning
    };
  }

  const write = executePrvSourceImport_({
    sourceUrl: action.sourceUrl || action.runUrl || "",
    sport: action.sport || "",
    key: key
  });

  if (!write || !write.ok) {
    return {
      ok: false,
      status: "failed",
      error: write && write.error ? write.error : "PRV sheet write failed.",
      executionResult: "PRV sheet write failed.",
      validationResult: write && write.error ? write.error : "No validation proof."
    };
  }

  const product = write.product || {};
  const publish = publishPrvVaultStaticData_({
    key: key,
    code: product.code || action.code || ""
  });
  const publicValidation = validatePrvVaultProduct_({
    code: product.code || action.code || ""
  });
  const publicRows = Number(publicValidation && publicValidation.row_count || 0);
  const publishOk = !!(publish && publish.ok);
  const validated = publishOk && publicRows > 0;

  return {
    ok: true,
    validated: validated,
    status: validated ? "pending_visual_validation" : "needs_review",
    executionResult: "PRV sheet write and JSON publish completed for " + (product.code || action.code || "product") + ".",
    validationResult: validated
      ? "Public PRV JSON validated with " + publicRows + " rows. Public PRV behavior validation is pending."
      : "PRV write completed, but public JSON validation needs review. " + (publishOk ? "Publish returned ok." : "Publish did not return ok.")
    ,
    pendingVisualValidation: validated
  };
}

function runScheduledVisualAutoAction_(action, key) {
  const productName = safeString_(action && action.product).trim();
  const sport = normalize_(action && action.sport);
  const code = safeString_(action && action.code).trim();
  const startedAt = safeString_(action && action.visualStartedAt).trim();

  if (!startedAt) {
    const dispatch = dispatchVisualProductTest_({
      key: key,
      productName: productName,
      sport: sport,
      code: code
    });

    if (!dispatch || !dispatch.ok) {
      return {
        ok: false,
        status: "failed",
        error: dispatch && dispatch.error ? dispatch.error : "Visual product test dispatch failed.",
        executionResult: "CV/ChatBot visual test could not be queued.",
        validationResult: dispatch && dispatch.error ? dispatch.error : "No GitHub Actions dispatch proof."
      };
    }

    return {
      ok: true,
      status: "queued",
      visualStartedAt: dispatch.started_at || new Date().toISOString(),
      runUrl: dispatch.workflow_url || dispatch.actions_url || "",
      executionResult: "CV/ChatBot visual test queued in GitHub Actions.",
      validationResult: "Visual test is queued. Sentinel will refresh the GitHub Actions result on the next sweep."
    };
  }

  const status = getVisualProductTestStatus_({
    key: key,
    productName: productName,
    sport: sport,
    code: code,
    startedAt: startedAt
  });

  if (!status || !status.ok) {
    return {
      ok: false,
      status: "failed",
      error: status && status.error ? status.error : "Visual product status lookup failed.",
      executionResult: "CV/ChatBot visual test status could not be refreshed.",
      validationResult: status && status.error ? status.error : "No GitHub Actions status proof."
    };
  }

  const result = safeString_(status.result || status.conclusion || status.status).trim().toLowerCase();
  if (result === "passed" || status.conclusion === "success") {
    return {
      ok: true,
      validated: true,
      status: "validated",
      visualStartedAt: startedAt,
      runUrl: status.run_url || action.visualRunUrl || action.runUrl || "",
      executionResult: "CV/ChatBot visual test passed.",
      validationResult: "GitHub Actions visual test passed for " + productName + "."
    };
  }

  if (result === "failed" || status.conclusion === "failure") {
    return {
      ok: false,
      status: "failed",
      visualStartedAt: startedAt,
      runUrl: status.run_url || action.visualRunUrl || action.runUrl || "",
      executionResult: "CV/ChatBot visual test failed.",
      validationResult: "GitHub Actions visual test failed for " + productName + ". Review the visual report."
    };
  }

  return {
    ok: true,
    status: "running",
    visualStartedAt: startedAt,
    runUrl: status.run_url || action.visualRunUrl || action.runUrl || "",
    executionResult: "CV/ChatBot visual test is still running.",
    validationResult: status.note || "GitHub Actions has not produced a final visual result yet."
  };
}

function patchMemoryAction_(actions, id, patch) {
  if (!id || !Array.isArray(actions)) return;
  for (let i = 0; i < actions.length; i++) {
    if (actions[i] && actions[i].id === id) {
      Object.assign(actions[i], patch || {});
      return;
    }
  }
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
    agent_run_queue: [],
    activity_log: [],
    visual_tests: {},
    known_issues: {},
    source_ignores: {},
    operator_endpoint: ""
  };
}

function buildMemorySourceIgnoreKey_(item) {
  const sport = normalize_(item && item.sport);
  const sourceUrl = normalize_(item && (item.source_url || item.url || item.sourceUrl || item.runUrl || ""));
  const product = normalize_(item && (item.matched_name || item.title || item.product || ""));
  return [sport, sourceUrl || product].filter(Boolean).join("|");
}

function isMemorySourceIgnored_(item, sourceIgnores) {
  const key = buildMemorySourceIgnoreKey_(item);
  return !!(key && sourceIgnores && sourceIgnores[key]);
}

function mergeScheduledSourceActions_(existingActions, sourceItems, now, mode) {
  const out = Array.isArray(existingActions) ? existingActions.slice() : [];
  const byId = {};
  const byDedupeKey = {};

  out.forEach(function(action) {
    if (action && action.id) byId[action.id] = action;
    const dedupeKey = buildScheduledActionDedupeKey_(action);
    if (dedupeKey && !byDedupeKey[dedupeKey]) byDedupeKey[dedupeKey] = action;
  });

  sourceItems.forEach(function(item) {
    const id = buildScheduledSourceActionId_(item);
    const dedupeKey = buildScheduledSourceDedupeKey_(item);
    const existing = byId[id] || byDedupeKey[dedupeKey];
    if (isProtectedMemoryAction_(existing)) return;
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

    if (existing) {
      Object.assign(existing, patch);
      byId[id] = existing;
      if (dedupeKey) byDedupeKey[dedupeKey] = existing;
    }
    else {
      byId[id] = patch;
      if (dedupeKey) byDedupeKey[dedupeKey] = patch;
      out.unshift(patch);
    }
  });

  return out.slice(0, 80);
}

function buildScheduledSourceActionId_(item) {
  return "source_watch|" + normalize_(item && item.sport || "") + "|" + normalize_(item && (item.matched_code || item.code || item.title || item.product || ""));
}

function buildScheduledSourceDedupeKey_(item) {
  return normalize_(item && (item.url || item.source_url || item.sourceUrl || item.runUrl || item.matched_code || item.code || item.title || item.product || ""));
}

function mergeScheduledPrvActions_(existingActions, sourceItems, now, mode) {
  const out = Array.isArray(existingActions) ? existingActions.slice() : [];
  const byId = {};

  out.forEach(function(action) {
    if (action && action.id) byId[action.id] = action;
  });

  sourceItems.forEach(function(item) {
    const id = "prv_watch|" + normalize_(item.sport || "") + "|" + normalize_(item.matched_code || item.title || "");
    const existing = byId[id];
    if (isProtectedMemoryAction_(existing)) return;
    const patch = {
      id: id,
      type: "prv_source_review",
      source: "scheduled_prv_" + mode,
      product: item.matched_name || item.title || "",
      sport: item.sport || "",
      code: item.matched_code || "",
      riskLevel: item.status === "missing" ? "medium" : "low",
      status: item.status === "known_issue" ? "known_issue" : "approval_required",
      recommendedAction: item.recommended_action || "Review SlabSquatch source, preview PRV rows, then approve product-scoped PRV write.",
      adminDecision: "",
      executionResult: item.status === "known_issue" ? "PRV source was scanned and held before auto execution." : "",
      validationResult: item.status === "known_issue" ? (item.blocked_reason || "Known PRV source issue.") : "",
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

function isProtectedMemoryAction_(action) {
  const status = safeString_(action && action.status).trim().toLowerCase();
  return status === "known_issue" ||
    status === "ignored" ||
    status === "validated" ||
    status === "done" ||
    status === "blocked";
}

function prependMemoryActivity_(activityLog, entry) {
  const out = Array.isArray(activityLog) ? activityLog.slice() : [];
  out.unshift(entry);
  return out.slice(0, 80);
}

function githubApiUrl_(path) {
  return githubRepoApiUrl_(CM_VISUAL_TEST_OWNER, CM_VISUAL_TEST_REPO, path);
}

function githubRepoApiUrl_(owner, repo, path) {
  return "https://api.github.com/repos/"
    + encodeURIComponent(owner)
    + "/"
    + encodeURIComponent(repo)
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

function getGitHubRepoContentText_(owner, repo, path, token, branch) {
  const targetBranch = safeString_(branch || CM_VISUAL_TEST_BRANCH).trim();
  const url = githubRepoApiUrl_(owner, repo, "/contents/" + path + "?ref=" + encodeURIComponent(targetBranch));
  const res = githubFetch_(url, token, { method: "get" });
  const status = res.getResponseCode();
  const text = res.getContentText();

  if (status < 200 || status >= 300) {
    throw new Error("GitHub content lookup failed for " + owner + "/" + repo + "/" + path + " with " + status + ": " + text);
  }

  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (err) {
    throw new Error("GitHub content response was not JSON for " + path + ".");
  }

  const content = safeString_(data.content || "").replace(/\s/g, "");
  const bytes = content ? Utilities.base64Decode(content) : [];
  return bytes.length ? Utilities.newBlob(bytes).getDataAsString("UTF-8") : "";
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
  const re = /<strong>\s*(?:(?:[A-Za-z0-9' -]+)\s+)?(?:Parallels|Versions):\s*<\/strong>\s*([^<]+)/gi;
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
        parallel_name: cleanParallelName_(label),
        serial_no: extractSerialText_(label)
      });
    });
  }

  return out;
}

function cleanParallelName_(label) {
  let out = safeString_(label).trim();
  out = out.replace(/\s*\([^)]*\)\s*$/g, "").trim();
  out = out.replace(/\s*\b1\s*\/\s*1\b\s*$/i, "").trim();
  out = out.replace(/\s*#?\s*\/\s*\d+\s*$/g, "").trim();
  return out || safeString_(label).trim();
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

  const soccerSignals = [
    "soccer",
    "uefa",
    "fifa",
    "premier league",
    "champions league",
    "europa league",
    "conference league",
    "club competitions",
    "world cup",
    "road to fifa",
    "efl",
    "epl",
    "mls",
    "la liga",
    "bundesliga",
    "serie a",
    "ligue 1",
    "k league",
    "merlin",
    "fc barcelona",
    "real madrid",
    "arsenal",
    "sl benfica",
    "chelsea",
    "liverpool",
    "manchester",
    "bayern",
    "psg"
  ];

  for (let i = 0; i < soccerSignals.length; i++) {
    if (text.indexOf(soccerSignals[i]) > -1) return "soccer";
  }

  if (text.indexOf("nba") > -1 || text.indexOf("wnba") > -1 || text.indexOf("euroleague") > -1) return "basketball";
  if (text.indexOf("nfl") > -1) return "football";
  if (text.indexOf("mlb") > -1) return "baseball";
  if (text.indexOf("nhl") > -1) return "hockey";

  for (let i = 0; i < CM_ALLOWED_SPORTS.length; i++) {
    if (text.indexOf(CM_ALLOWED_SPORTS[i]) > -1) return CM_ALLOWED_SPORTS[i];
  }

  return "";
}

function getSportInferenceSelfTest_() {
  const cases = [
    { title: "2025-26 Panini's Football EFL Soccer", expected: "soccer" },
    { title: "2025 Topps Finest Football", expected: "football" },
    { title: "2025 Topps Chrome Sapphire Premier League Soccer", expected: "soccer" },
    { title: "2025 Panini Prizm Football", expected: "football" },
    { title: "2025-26 Topps UEFA Japan Edition Soccer", expected: "soccer" },
    { title: "2025-26 Donruss Road To World Cup", expected: "soccer" }
  ];
  const results = cases.map(function(testCase) {
    const actual = inferSport_(testCase.title);
    return {
      title: testCase.title,
      expected: testCase.expected,
      actual: actual,
      ok: actual === testCase.expected
    };
  });
  const failed = results.filter(function(result) {
    return !result.ok;
  });

  return {
    ok: failed.length === 0,
    passed: results.length - failed.length,
    failed_count: failed.length,
    failed: failed,
    results: results
  };
}

function isAllowedSport_(sport) {
  return CM_ALLOWED_SPORTS.indexOf(normalize_(sport)) > -1;
}

function hasBlockedTerm_(value) {
  const text = normalize_(value);
  return CM_BLOCKED_TERMS.some(function(term) {
    const normalizedTerm = normalize_(term);
    if (!normalizedTerm) return false;
    return (" " + text + " ").indexOf(" " + normalizedTerm + " ") > -1;
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
