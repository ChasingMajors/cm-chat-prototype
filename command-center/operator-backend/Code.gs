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

    if (action === "previewSourceImport") {
      return json_(previewSourceImport_({
        sourceUrl: p.sourceUrl || p.url || "",
        sport: p.sport || ""
      }));
    }

    return json_({
      ok: false,
      error: "Unknown action",
      supported_actions: ["health", "sourceWatch", "validateSourceProduct", "previewSourceImport"]
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

    return json_({
      ok: false,
      error: "Unknown action",
      supported_actions: ["sourceWatch", "validateSourceProduct", "previewSourceImport"]
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
