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
 *
 * Current safety:
 * - Review-only. This file does not write to Google Sheets yet.
 * - The next phase is explicit approved execution actions.
 *******************************************************/

const CM_OPERATOR_VERSION = "2026-05-15-operator-v1";
const CM_APP_DATA_BASE = "https://app.chasingmajors.com/data/v1";
const CM_CHECKLISTCENTER_HOME = "https://www.checklistcenter.com/";
const CM_ALLOWED_SPORTS = ["baseball", "football", "basketball", "hockey", "soccer"];
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

    return json_({
      ok: false,
      error: "Unknown action",
      supported_actions: ["health", "sourceWatch", "validateSourceProduct"]
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

    return json_({
      ok: false,
      error: "Unknown action",
      supported_actions: ["sourceWatch", "validateSourceProduct"]
    });
  } catch (err) {
    return json_({
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  }
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
    const title = normalizeTitleFromLink_(link.text || link.href || "");
    const sport = inferSport_(title + " " + link.href);
    const key = normalize_(title + "|" + link.href);

    if (!title || deduped[key]) return;
    deduped[key] = {
      title: title,
      sport: sport,
      url: absoluteChecklistCenterUrl_(link.href),
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

    if (!/checklist/i.test(combined)) continue;
    if (!/card|baseball|basketball|football|hockey|soccer|topps|panini|upper deck|bowman/i.test(combined)) continue;

    out.push({
      href: href,
      text: text
    });
  }

  return out;
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
  let best = null;

  (indexRows || []).forEach(function(row) {
    const rowSport = normalize_(row.sport || row.Sport || "");
    if (rowSport !== sport) return;

    const name = safeString_(row.DisplayName || row.displayName || row.display_name || row.name || "");
    const code = safeString_(row.Code || row.code || "");
    const keywords = safeString_(row.Keywords || row.keywords || "");
    const nameNorm = normalize_(name);
    const nameCompact = nameNorm.replace(/\s+/g, "");
    const hay = normalize_([name, code, keywords].join(" "));
    let score = 0;

    if (nameNorm === titleNorm) score += 220;
    if (nameCompact === titleCompact) score += 200;
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

function fetchChecklistIndex_() {
  const data = JSON.parse(fetchText_(CM_APP_DATA_BASE + "/checklists/index.json"));
  return data.index || data.rows || [];
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
  return safeString_(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/&#8212;|&mdash;/g, "-")
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
