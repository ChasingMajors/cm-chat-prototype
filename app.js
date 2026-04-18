const { config, utils, api, cache, store, ui } = window.CMChat;

const {
  SEARCH_HELP_EXAMPLES,
  EXAMPLES,
  INTENT_PRINT_RUN_WORDS,
  INTENT_CHECKLIST_WORDS,
  INTENT_TRENDING_WORDS,
  NON_TOPPS_PRINTRUN_BRANDS,
  CHECKLIST_SECTION_LABELS,
  PLAYER_SEARCH_NON_NAME_WORDS,
  PLAYER_SEARCH_FILLER_WORDS
} = config;

const {
  normalize,
  escapeHtml,
  titleCase,
  uniq,
  tokenize,
  meaningfulTokens,
  extractYear,
  extractSelectedYear,
  extractSport,
  stripIntentWords,
  includesAny,
  formatNumber,
  isOnlySportReply,
  isOnlyPrintRunReply,
  isOnlyChecklistReply,
  isChecklistSectionReply,
  resolveChecklistSection,
  detectChecklistSectionIntent,
  isOnlyPlayerStatsReply,
  isOnlyPlayerChecklistReply,
  isLikelyPlayerNameToken,
  parseDateSafe,
  formatReleaseDate,
  getParallelRarityTag
} = utils;

const {
  logEvent,
  getPrintRunData,
  getHomeFeed,
  getChecklistSummary,
  getChecklistSection,
  getChecklistParallels,
  getPlayerCards,
  getAdvancedPlayerSerialCards,
  getPlayerYears
} = api;

const {
  preloadPlayerDataInBackground,
  preloadReleaseScheduleInBackground,
  prefetchPlayerData,
  prefetchChecklistData,
  prefetchPrintRunData,
  getPlayerMetaEntry,
  getPlayerStatsEntry,
  bootstrapData,
  ensurePlayerDataLoaded,
  ensureReleaseScheduleLoaded,
  loadPlayerMeta
} = store;

const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");

let awaitingCatalogSport = false;
let pendingProductChoice = null;
let pendingChecklistChoice = null;
let pendingPlayerChoice = null;
let pendingNumberedChoice = null;

const RELEASE_SPORT_ORDER = ["baseball", "football", "basketball", "soccer", "hockey"];

function getChecklistIndex() {
  return store.checklistIndex || [];
}

function getPrintRunIndex() {
  return store.printRunIndex || [];
}

function getReleaseScheduleData() {
  return store.releaseScheduleData || [];
}

/* ------------------ DIRECT RELEASE ACTIONS ------------------ */

function isDirectReleaseActionQuery(query) {
  return String(query || "").startsWith("__release_action__|");
}

function safeDecodeComponent(value) {
  try {
    return decodeURIComponent(value || "");
  } catch (err) {
    return "";
  }
}

function parseDirectReleaseActionQuery(query) {
  const raw = String(query || "");
  const parts = raw.split("|");

  return {
    kind: parts[1] || "",
    name: safeDecodeComponent(parts[2]),
    code: safeDecodeComponent(parts[3]),
    sport: safeDecodeComponent(parts[4])
  };
}

function getDirectReleaseActionDisplayText(action) {
  const name = action.name || "that product";

  if (action.kind === "checklist") return `Open ${name} checklist`;
  if (action.kind === "print_run") return `Open ${name} print run`;

  return `Open ${name}`;
}

function findProductByCode(list, code) {
  const targetCode = String(code || "").trim();
  if (!targetCode) return null;

  const item = (list || []).find(p => String(p.code || p.Code || "").trim() === targetCode);
  return item ? mapProduct(item) : null;
}

async function buildDirectChecklistResponse(action) {
  let product = {
    name: action.name || "",
    code: action.code || "",
    sport: action.sport || ""
  };

  awaitingCatalogSport = false;
  pendingProductChoice = null;
  pendingPlayerChoice = null;
  pendingNumberedChoice = null;

  if (!product.code) {
    pendingChecklistChoice = null;

    return {
      type: "standard",
      badge: "Checklist",
      title: "Checklist not available",
      summary: "I could not open that checklist directly from the release schedule."
    };
  }

  const indexedProduct = findProductByCode(getChecklistIndex(), product.code);

  if (!indexedProduct) {
    pendingChecklistChoice = null;

    return {
      type: "standard",
      badge: "Checklist",
      title: "Checklist not available",
      summary: "I could not verify that checklist from the release schedule."
    };
  }

  if (action.name && normalize(action.name) !== normalize(indexedProduct.name)) {
    pendingChecklistChoice = null;

    return {
      type: "standard",
      badge: "Checklist",
      title: "Checklist match needs review",
      summary: "That release schedule shortcut pointed to a different checklist than expected, so I stopped before opening the wrong set."
    };
  }

  product = {
    ...indexedProduct,
    name: indexedProduct.name,
    sport: indexedProduct.sport
  };

  const summary = await getChecklistSummary(product.code);

  product.name = product.name || summary.name || "";
  product.year = product.year || summary.year || "";
  product.sport = product.sport || summary.sport || "";

  pendingChecklistChoice = {
    product,
    summary
  };

  const countsLine = summarizeChecklistCounts(summary);

  return {
    type: "standard",
    badge: "Checklist",
    title: product.name,
    summary: `I found the exact checklist.${countsLine ? ` ${countsLine}.` : ""} Are you looking for the entire checklist or a checklist for base, inserts, autographs, relics, variations, or parallels?`,
    metadata: uniq([
      summary.counts?.all ? `Rows: ${formatNumber(summary.counts.all)}` : "",
      product.year ? `Year: ${product.year}` : "",
      product.sport ? `Sport: ${titleCase(product.sport)}` : "",
      product.code ? `Code: ${product.code}` : ""
    ]),
    followups: checklistSectionOptionsFromSummary(summary)
  };
}

async function buildDirectPrintRunResponse(action) {
  let product = {
    name: action.name || "",
    code: action.code || "",
    sport: action.sport || ""
  };

  awaitingCatalogSport = false;
  pendingProductChoice = null;
  pendingChecklistChoice = null;
  pendingPlayerChoice = null;
  pendingNumberedChoice = null;

  if (!product.code) {
    return {
      type: "standard",
      badge: "Print Run",
      title: "Print run not available",
      summary: "I could not open that print run result directly from the release schedule."
    };
  }

  const indexedProduct = findProductByCode(getPrintRunIndex(), product.code);

  if (!indexedProduct) {
    return {
      type: "standard",
      badge: "Print Run",
      title: "Print run not available",
      summary: "I could not verify that print run result from the release schedule."
    };
  }

  if (action.name && normalize(action.name) !== normalize(indexedProduct.name)) {
    return {
      type: "standard",
      badge: "Print Run",
      title: "Print run match needs review",
      summary: "That release schedule shortcut pointed to a different print run result than expected, so I stopped before opening the wrong set."
    };
  }

  product = {
    ...indexedProduct,
    name: indexedProduct.name,
    sport: indexedProduct.sport
  };

  const rawRows = await getPrintRunData(product.code, product.sport);

  if (!rawRows.length) {
    return {
      type: "standard",
      badge: "Print Run",
      title: product.name || "Print Run",
      summary: "I found the exact product, but no print run rows were returned yet.",
      metadata: uniq([
        product.year ? `Year: ${product.year}` : "",
        product.sport ? `Sport: ${titleCase(product.sport)}` : "",
        product.code ? `Code: ${product.code}` : ""
      ])
    };
  }

  return {
    type: "prv",
    product,
    rawRows,
    rows: buildPrvRows(rawRows),
    metadata: buildPrvMetadata(product, rawRows),
    followups: [
      `Show me the ${product.name} checklist`,
      `What parallels are in ${product.name}`
    ]
  };
}

/* ------------------ SEARCH / QUERY HELPERS ------------------ */

function splitPlayerSearchQuery(query) {
  const year = extractYear(query);
  const sport = extractSport(query);

  const rawTokens = String(query || "").trim().split(/\s+/).filter(Boolean);
  if (!rawTokens.length) return null;

  const cleanedRawTokens = rawTokens.filter(t => {
    const n = normalize(t);
    return n && !PLAYER_SEARCH_FILLER_WORDS.has(n);
  });

  if (!cleanedRawTokens.length) return null;

  const candidateTokens = cleanedRawTokens.filter(t => {
    const n = normalize(t);
    if (!n) return false;
    if (year && n === normalize(year)) return false;
    if (sport && n === normalize(sport)) return false;
    return true;
  });

  if (!candidateTokens.length) return null;

  const candidateNorms = candidateTokens.map(t => normalize(t));

  if (!isLikelyPlayerNameToken(candidateNorms[0])) return null;

  let stopIdx = candidateNorms.length;
  for (let i = 0; i < candidateNorms.length; i++) {
    if (PLAYER_SEARCH_NON_NAME_WORDS.has(candidateNorms[i])) {
      stopIdx = i;
      break;
    }
  }

  let playerTokens = candidateTokens.slice(0, stopIdx).filter(Boolean);

  if (!playerTokens.length) return null;
  if (playerTokens.some(t => !isLikelyPlayerNameToken(t))) return null;
  if (playerTokens.length > 3) playerTokens = playerTokens.slice(0, 3);

  return {
    playerName: titleCase(playerTokens.join(" ")),
    year: year || "",
    sport: sport || "baseball",
    remainder: candidateTokens.slice(stopIdx).join(" ").trim()
  };
}

function looksLikeStandaloneYearQuery(parts) {
  if (!parts?.year) return false;

  const rem = normalize(parts.remainder || "");
  if (!rem) return true;

  const tokens = tokenize(rem);
  const productishCount = tokens.filter(t => PLAYER_SEARCH_NON_NAME_WORDS.has(t)).length;
  return productishCount === 0;
}

function findBestProductFromRemainder(remainder) {
  const cleaned = stripIntentWords(remainder || "");
  if (!cleaned) return null;

  const candidate = findBestProduct(getChecklistIndex(), cleaned, "checklist");
  if (!candidate) return null;

  const productTokens = new Set([
    ...meaningfulTokens(candidate.name),
    ...meaningfulTokens(candidate.keywords),
    ...meaningfulTokens(candidate.code)
  ]);

  const queryTokens = meaningfulTokens(cleaned);
  const overlap = queryTokens.filter(t => productTokens.has(t)).length;

  if (overlap < 1) return null;
  if ((candidate.score || 0) < 45) return null;

  return candidate;
}

function detectPlayerSearchRequest(query) {
  const parts = splitPlayerSearchQuery(query);
  if (!parts) return null;

  const { playerName, sport, year, remainder } = parts;

  if (looksLikeStandaloneYearQuery(parts)) {
    return {
      playerName,
      sport: sport || "baseball",
      year: year || "",
      code: "",
      productName: "",
      mode: year ? "player_year" : "player_only"
    };
  }

  const product = findBestProductFromRemainder(remainder);

  if (product) {
    return {
      playerName,
      sport: product.sport || sport || "baseball",
      year: product.year || year || "",
      code: product.code || "",
      productName: product.name || "",
      mode: "player_product"
    };
  }

  if (year) {
    return {
      playerName,
      sport: sport || "baseball",
      year,
      code: "",
      productName: "",
      mode: "player_year"
    };
  }

  return {
    playerName,
    sport: sport || "baseball",
    year: "",
    code: "",
    productName: "",
    mode: "player_only"
  };
}

function extractNumberedThreshold(query) {
  const n = normalize(query);

  const strictMatch = n.match(/\b(?:under|less than|below|lower than)\s*\/?\s*(\d{1,4})\b/);
  if (strictMatch) {
    const num = Number(strictMatch[1]);
    return Number.isFinite(num) && num > 1 ? num - 1 : null;
  }

  const inclusiveMatch = n.match(/\b(?:at most|max|maximum|up to|or less|and less)\s*\/?\s*(\d{1,4})\b/);
  if (inclusiveMatch) {
    const num = Number(inclusiveMatch[1]);
    return Number.isFinite(num) && num > 0 ? num : null;
  }

  const slashMatch = String(query || "").match(/\/\s*(\d{1,4})\b/);
  if (slashMatch) {
    const num = Number(slashMatch[1]);
    return Number.isFinite(num) && num > 0 ? num : null;
  }

  if (
    n.includes("low print run") ||
    n.includes("low numbered") ||
    n.includes("low serial") ||
    n.includes("short print") ||
    n.includes("ssp")
  ) {
    return 100;
  }

  return null;
}

function isNumberedSearchQuery(query) {
  const n = normalize(query);

  return (
    n.includes("serial numbered") ||
    n.includes("serial-numbered") ||
    n.includes("serial number") ||
    n.includes("numbered under") ||
    n.includes("numbered less than") ||
    n.includes("numbered below") ||
    n.includes("numbered /") ||
    n.includes("low numbered") ||
    n.includes("low serial") ||
    n.includes("short print") ||
    n.includes("ssp") ||
    /\bnumbered\s+\d{1,4}\b/.test(n) ||
    /\/\s*\d{1,4}\b/.test(String(query || ""))
  );
}

function stripNumberedSearchWords(query) {
  let out = normalize(query || "");

  [
    "serial numbered",
    "serial-numbered",
    "serial number",
    "serial numbers",
    "serial",
    "numbered",
    "number",
    "numbers",
    "low print run",
    "print run",
    "low numbered",
    "low serial",
    "short print",
    "ssp",
    "under",
    "less than",
    "below",
    "lower than",
    "at most",
    "maximum",
    "max",
    "up to",
    "or less",
    "and less"
  ].forEach(phrase => {
    out = out.replace(new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), " ");
  });

  out = out.replace(/\/\s*\d{1,4}\b/g, " ");
  out = out.replace(/\b\d{1,3}\b/g, " ");

  return out.replace(/\s+/g, " ").trim();
}

function detectNumberedPlayerSearchRequest(query) {
  if (!isNumberedSearchQuery(query)) return null;

  const serialMax = extractNumberedThreshold(query);
  if (!serialMax) return null;

  const parts = splitPlayerSearchQuery(stripNumberedSearchWords(query));
  if (!parts?.playerName) return null;

  return {
    mode: "player_serial",
    playerName: parts.playerName,
    sport: parts.sport || "baseball",
    year: parts.year || "",
    serialMax,
    originalQuery: query
  };
}

function isAllCardsReply(query) {
  const n = normalize(query);
  return n === "all cards" || n === "all" || n === "all years";
}

function stripPrintRunThresholdWords(query) {
  let out = normalize(query || "");

  [
    "low print run",
    "print run",
    "print-run",
    "all",
    "low",
    "cards",
    "card",
    "under",
    "less than",
    "below",
    "lower than",
    "at most",
    "maximum",
    "max",
    "up to",
    "or less",
    "and less"
  ].forEach(phrase => {
    out = out.replace(new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), " ");
  });

  out = out.replace(/\b(19|20)\d{2}\b/g, " ");
  out = out.replace(/\b\d{1,3}\b/g, " ");
  out = stripIntentWords(out);

  return out.replace(/\s+/g, " ").trim();
}

function hasSpecificProductClue(query) {
  const year = extractYear(query);
  const sport = extractSport(query);

  const tokens = meaningfulTokens(stripPrintRunThresholdWords(query)).filter(t => {
    if (year && t === normalize(year)) return false;
    if (sport && t === normalize(sport)) return false;
    return !["all", "low", "print", "run", "card", "cards"].includes(t);
  });

  return tokens.length > 0;
}

function extractPrintRunThreshold(query) {
  const n = normalize(query);
  if (!n.includes("print run") && !n.includes("print-run") && !n.includes("low print run")) {
    return null;
  }

  const threshold = extractNumberedThreshold(query);
  return threshold && threshold > 0 ? threshold : null;
}

function getThresholdLabel(query, threshold) {
  const n = normalize(query);

  if (/\b(?:under|less than|below|lower than)\s*\/?\s*\d{1,4}\b/.test(n)) {
    return `Less than ${threshold + 1}`;
  }

  return `${threshold} or less`;
}

function getPrintRunValue(row) {
  const raw = String(row?.printRun || "").trim();
  const num = Number(raw.replace(/[^\d.]/g, ""));
  return Number.isFinite(num) ? num : 0;
}

function buildPrintRunProductFollowupsForYear(year, query, threshold) {
  const y = String(year || "").trim();
  const sport = extractSport(query);
  const thresholdText = getThresholdLabel(query, threshold).toLowerCase();

  const products = getPrintRunIndex()
    .map(mapProduct)
    .filter(p => p.name)
    .filter(p => !y || String(p.year || "") === y)
    .filter(p => !sport || normalize(p.sport) === sport)
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 5);

  return uniq([
    ...products.map(p => `Show ${p.name} print run ${thresholdText}`),
    y ? `Show ${y} baseball products` : "",
    y ? `Show ${y} release schedule` : "Show the release schedule"
  ].filter(Boolean));
}

function mentionsRestrictedPrintRunBrand(query) {
  const n = normalize(query);
  return NON_TOPPS_PRINTRUN_BRANDS.some(b => n.includes(normalize(b)));
}

function isCatalogCoverageQuestion(query) {
  const n = normalize(query);
  return (
    n.includes("what sets do you have") ||
    n.includes("what products do you have") ||
    n.includes("what checklists do you have") ||
    n.includes("what print runs do you have") ||
    n.includes("what do you have") ||
    n.includes("what is in your database") ||
    n.includes("what's in your database") ||
    n.includes("what sets are in your database") ||
    n.includes("what products are in your database") ||
    n.includes("what can i search") ||
    n.includes("what can you search")
  );
}

function isSpecificYearLineupQuestion(query) {
  const n = normalize(query);
  const year = extractYear(query);
  const sport = extractSport(query);

  if (!year || !sport) return false;

  return (
    n.includes("what products do you have") ||
    n.includes("what sets do you have") ||
    n.includes("what products are in") ||
    n.includes("what sets are in") ||
    n.includes("show me") ||
    n.includes("what do you have")
  );
}

function isPricingQuestion(query) {
  const n = normalize(query);
  return (
    n.includes("pricing") ||
    n.includes("price comps") ||
    n.includes("price comp") ||
    n.includes("recent sales") ||
    n.includes("sales data") ||
    n.includes("comps") ||
    n.includes("price data") ||
    n.includes("psa 10") ||
    n.includes("psa 9")
  );
}

function isDataSourceQuestion(query) {
  const n = normalize(query);
  return (
    n.includes("where does your data come from") ||
    n.includes("where does your data com from") ||
    n.includes("where does the data come from") ||
    n.includes("where do you get your data") ||
    n.includes("how do you source your data") ||
    n.includes("where is the data from") ||
    n.includes("where do the data come from") ||
    n.includes("data source") ||
    n.includes("data sources")
  );
}

function isSearchHelpRequest(query) {
  const n = normalize(query);
  return (
    n === "see the best way search" ||
    n === "best way search" ||
    n === "best way to search" ||
    n === "search help" ||
    n === "how should i search" ||
    n === "how do i search" ||
    n === "search examples"
  );
}

function isReleaseScheduleQuestion(query) {
  const n = normalize(query);
  return (
    n.includes("release schedule") ||
    n.includes("release schedules") ||
    n.includes("release calendar") ||
    n.includes("release calendars") ||
    n.includes("upcoming releases") ||
    n.includes("upcoming products") ||
    n.includes("new products") ||
    n.includes("new product") ||
    n.includes("coming out") ||
    n.includes("coming soon") ||
    n.includes("what releases are coming") ||
    n.includes("what products are coming") ||
    n.includes("what comes out") ||
    n.includes("what is coming out") ||
    n.includes("what's coming out") ||
    n.includes("releasing soon") ||
    n.includes("release date") ||
    n.includes("when does") ||
    n.includes("when is") ||
    n.includes("when will") ||
    n === "schedule" ||
    n === "calendar" ||
    n.includes("upcoming baseball releases") ||
    n.includes("upcoming basketball releases") ||
    n.includes("upcoming football releases") ||
    n.includes("upcoming hockey releases") ||
    n.includes("upcoming soccer releases")
  );
}

function normalizeReleaseRow(row) {
  return {
    releaseDate: row.releaseDate || "",
    sport: row.sport || "",
    manufacturer: row.manufacturer || "",
    product: row.product || "",
    setName: row.setName || "",
    format: row.format || "",
    status: row.status || "",
    checklistUrl: row.checklistUrl || "",
    vaultUrl: row.vaultUrl || ""
  };
}

function filterReleaseScheduleRows(rows, query) {
  const n = normalize(query);
  const sport = extractSport(query);
  const year = extractYear(query);

  let filtered = (rows || []).map(normalizeReleaseRow);

  if (sport) {
    filtered = filtered.filter(r => normalize(r.sport) === sport);
  }

  if (year) {
    filtered = filtered.filter(r => {
      const releaseYear = String(r.releaseDate || "").slice(0, 4);
      const setYear = String(extractYear(r.setName || r.product || "") || "").slice(0, 4);
      return releaseYear === String(year).slice(0, 4) || setYear === String(year).slice(0, 4);
    });
  }

  if (
    n.includes("upcoming") ||
    n.includes("coming") ||
    n.includes("new") ||
    n.includes("release schedule") ||
    n.includes("release calendar") ||
    n.includes("releasing soon") ||
    n === "schedule" ||
    n === "calendar"
  ) {
    filtered = filtered.filter(r => {
      const status = normalize(r.status);
      return status === "upcoming" || status === "announced" || status === "scheduled" || !status;
    });
  }

  return sortReleaseScheduleRows(filtered, sport || "");
}

function getAllProductsForSport(sport) {
  const s = normalize(sport);
  const items = [];

  getChecklistIndex().forEach(item => {
    const p = mapProduct(item);
    if (normalize(p.sport) === s) items.push(p);
  });

  getPrintRunIndex().forEach(item => {
    const p = mapProduct(item);
    if (normalize(p.sport) === s) items.push(p);
  });

  return items;
}

function getLatestYearsForSport(sport) {
  const products = getAllProductsForSport(sport);
  const years = uniq(
    products
      .map(p => String(p.year || ""))
      .filter(y => /\b(19|20)\d{2}(?:-\d{2})?\b/.test(y))
  );

  return years.sort((a, b) => {
    const aStart = parseInt(a.slice(0, 4), 10);
    const bStart = parseInt(b.slice(0, 4), 10);
    return bStart - aStart;
  });
}

function getSampleCurrentSetsForSport(sport, limit = 8) {
  const s = normalize(sport);
  const latestYears = getLatestYearsForSport(sport);
  const latestYear = latestYears[0] || "";

  const seen = new Set();
  const results = [];

  [...getChecklistIndex(), ...getPrintRunIndex()].forEach(item => {
    const p = mapProduct(item);
    if (normalize(p.sport) !== s) return;
    if (latestYear && String(p.year) !== latestYear) return;

    const key = normalize(p.name);
    if (!key || seen.has(key)) return;

    seen.add(key);
    results.push(p.name);
  });

  return results.sort((a, b) => a.localeCompare(b)).slice(0, limit);
}

function getProductsForSportYear(sport, year) {
  const s = normalize(sport);
  const y = String(year || "").trim();

  const seen = new Set();
  const results = [];

  [...getChecklistIndex(), ...getPrintRunIndex()].forEach(item => {
    const p = mapProduct(item);
    if (normalize(p.sport) !== s) return;
    if (String(p.year) !== y) return;

    const key = normalize(p.name);
    if (!key || seen.has(key)) return;

    seen.add(key);
    results.push(p);
  });

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------ RELEASE SCHEDULE HELPERS ------------------ */

function getReleaseSportRank(sport) {
  const idx = RELEASE_SPORT_ORDER.indexOf(normalize(sport));
  return idx === -1 ? 999 : idx;
}

function isAnnouncedReleaseValue(val) {
  const n = normalize(val);
  return !val || n === "announced" || n === "tbd" || n === "to be announced";
}

function isBroadReleaseScheduleQuery(query) {
  const n = normalize(query);
  return (
    n.includes("release schedule") ||
    n.includes("release schedules") ||
    n.includes("release calendar") ||
    n.includes("release calendars") ||
    n.includes("upcoming releases") ||
    n.includes("upcoming products") ||
    n.includes("what releases are coming") ||
    n.includes("what products are coming") ||
    n.includes("what comes out") ||
    n.includes("what is coming out") ||
    n.includes("what's coming out") ||
    n.includes("releasing soon") ||
    n === "schedule" ||
    n === "calendar"
  );
}

function isSpecificReleaseDateQuestion(query) {
  const n = normalize(query);
  return (
    n.includes("when does") ||
    n.includes("when is") ||
    n.includes("when will") ||
    n.includes("release date") ||
    n.includes("come out")
  );
}

function stripReleaseQuestionWords(query) {
  let out = normalize(query || "");

  [
    "when does",
    "when is",
    "when will",
    "release date",
    "come out",
    "what is the release date for",
    "what's the release date for",
    "release schedule",
    "release calendar",
    "schedule",
    "calendar",
    "upcoming releases",
    "upcoming products",
    "releasing soon",
    "what releases are coming",
    "what products are coming"
  ].forEach(p => {
    out = out.replace(new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), " ");
  });

  return out.replace(/\s+/g, " ").trim();
}

function buildOtherSportReleaseFollowups(currentSport) {
  return RELEASE_SPORT_ORDER
    .filter(s => s !== normalize(currentSport))
    .map(s => `Show ${titleCase(s)} release schedule`);
}

function sortReleaseScheduleRows(rows, sportOnly = "") {
  const sportFilter = normalize(sportOnly);

  return [...(rows || [])].sort((a, b) => {
    const aSport = normalize(a.sport);
    const bSport = normalize(b.sport);

    if (!sportFilter) {
      const sportDiff = getReleaseSportRank(aSport) - getReleaseSportRank(bSport);
      if (sportDiff !== 0) return sportDiff;
    }

    const aAnnounced = isAnnouncedReleaseValue(a.releaseDate);
    const bAnnounced = isAnnouncedReleaseValue(b.releaseDate);

    if (aAnnounced !== bAnnounced) return aAnnounced ? 1 : -1;

    const aDate = parseDateSafe(a.releaseDate);
    const bDate = parseDateSafe(b.releaseDate);

    if (aDate && bDate) {
      const diff = aDate - bDate;
      if (diff !== 0) return diff;
    }

    return normalize(a.setName || a.product).localeCompare(normalize(b.setName || b.product));
  });
}

function findExactReleaseProduct(list, row) {
  const releaseNames = uniq([
    row.setName || "",
    row.product || ""
  ])
    .map(v => String(v || "").trim())
    .filter(Boolean);

  if (!releaseNames.length) return null;

  const releaseSport = normalize(row.sport || "");
  const releaseYear =
    extractYear(row.setName || row.product || "") ||
    String(row.releaseDate || "").slice(0, 4);

  const mapped = (list || [])
    .map(mapProduct)
    .filter(p => p.name && p.code);

  for (const releaseName of releaseNames) {
    const releaseNorm = normalize(releaseName);

    const exact = mapped.find(product => {
      const productNameNorm = normalize(product.name || "");
      const productSport = normalize(product.sport || "");
      const productYear = String(product.year || "").trim();

      if (productNameNorm !== releaseNorm) return false;
      if (releaseSport && productSport && productSport !== releaseSport) return false;
      if (releaseYear && productYear && productYear !== String(releaseYear)) return false;

      return true;
    });

    if (exact) {
      return {
        ...exact,
        score: 999,
        matchType: "exact"
      };
    }
  }

  return null;
}


function enrichReleaseRowForUi(row) {
  const checklistMatch = findExactReleaseProduct(
    getChecklistIndex(),
    row
  );

  const vaultMatch = findExactReleaseProduct(
    getPrintRunIndex(),
    row
  );

  const hasChecklist = !!checklistMatch;
  const hasVault = !!vaultMatch;

  return {
    ...row,
    hasChecklist,
    hasVault,

    checklistMatchName: hasChecklist ? checklistMatch.name : "",
    checklistMatchCode: hasChecklist ? checklistMatch.code : "",
    checklistMatchSport: hasChecklist ? checklistMatch.sport : "",

    vaultMatchName: hasVault ? vaultMatch.name : "",
    vaultMatchCode: hasVault ? vaultMatch.code : "",
    vaultMatchSport: hasVault ? vaultMatch.sport : "",

    checklistUrl: hasChecklist
      ? `/checklists/?q=${encodeURIComponent(checklistMatch.name)}`
      : "",
    vaultUrl: hasVault
      ? `/vault/?q=${encodeURIComponent(vaultMatch.name)}`
      : ""
  };
}


function scoreReleaseRowMatch(row, query) {
  const cleaned = stripReleaseQuestionWords(query);
  if (!cleaned) return 0;

  const qNorm = normalize(cleaned);
  const qTokens = meaningfulTokens(qNorm);

  const nameNorm = normalize(row.setName || row.product || "");
  const haystack = normalize([
    row.setName || "",
    row.product || "",
    row.manufacturer || "",
    row.sport || "",
    row.releaseDate || ""
  ].join(" "));

  let score = 0;

  if (qNorm && nameNorm && qNorm.includes(nameNorm)) score += 120;
  if (qNorm && nameNorm && nameNorm.includes(qNorm)) score += 80;
  if (qNorm && haystack.includes(qNorm)) score += 45;

  const rowTokens = new Set(meaningfulTokens(haystack));
  let overlap = 0;

  qTokens.forEach(t => {
    if (rowTokens.has(t)) overlap += 1;
  });

  score += overlap * 14;

  if (qTokens.length) score += Math.round((overlap / qTokens.length) * 35);

  const sport = extractSport(query);
  if (sport && normalize(row.sport) === sport) score += 10;

  return score;
}

function findBestReleaseRow(rows, query) {
  let best = null;
  let bestScore = -9999;

  (rows || []).forEach(row => {
    const score = scoreReleaseRowMatch(row, query);
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  });

  if (!best || bestScore < 34) return null;
  return { row: best, score: bestScore };
}

/* ------------------ INDEX HELPERS ------------------ */

function mapProduct(item) {
  const name = item.name || item.DisplayName || item.displayName || item.product || "";
  const keywords = item.keywords || item.Keywords || "";
  const code = item.code || item.Code || "";
  const sport = item.sport || "";
  const year = item.year || extractYear(name) || "";

  return {
    raw: item,
    name,
    keywords,
    code,
    sport,
    year,
    haystack: normalize([name, keywords, code, sport, year].join(" "))
  };
}

function scoreProduct(item, query, targetIntent) {
  const qNorm = normalize(query);
  const cleaned = stripIntentWords(query);
  const cleanedNorm = normalize(cleaned);
  const qTokens = meaningfulTokens(cleanedNorm);
  const product = mapProduct(item);

  if (!product.name) return 0;

  let score = 0;
  const nameNorm = normalize(product.name);
  const codeNorm = normalize(product.code);
  const sport = extractSport(query);
  const year = extractYear(query);

  if (qNorm === nameNorm || cleanedNorm === nameNorm) score += 300;
  if (qNorm.includes(nameNorm)) score += 140;
  if (cleanedNorm && nameNorm.includes(cleanedNorm)) score += 70;
  if (cleanedNorm && product.haystack.includes(cleanedNorm)) score += 50;
  if (codeNorm && qNorm.includes(codeNorm)) score += 120;

  if (year && String(product.year) === year) score += 25;
  if (sport && normalize(product.sport) === sport) score += 18;
  if (sport && product.haystack.includes(sport)) score += 8;

  const nameTokens = meaningfulTokens(product.name);
  const keywordTokens = meaningfulTokens(product.keywords);
  const codeTokens = meaningfulTokens(product.code);
  const allTokens = new Set([...nameTokens, ...keywordTokens, ...codeTokens]);

  let overlap = 0;
  qTokens.forEach(t => {
    if (allTokens.has(t)) overlap += 1;
  });

  score += overlap * 12;

  if (qTokens.length > 0) {
    const overlapRatio = overlap / qTokens.length;
    score += Math.round(overlapRatio * 30);
  }

  if (targetIntent === "print_run" && product.haystack.includes("print")) score += 2;
  if (targetIntent === "checklist" && product.haystack.includes("checklist")) score += 2;

  if (!qNorm.includes("celebration") && nameNorm.includes("celebration")) score -= 30;

  const missingCoreTokens = qTokens.filter(t => !nameNorm.includes(t) && !codeNorm.includes(t)).length;
  score -= missingCoreTokens * 8;

  return score;
}

function findBestProduct(list, query, targetIntent) {
  const cleaned = stripIntentWords(query || "");
  const cleanedNorm = normalize(cleaned);
  const qNorm = normalize(query || "");
  const sport = extractSport(query);
  const year = extractYear(query);

  let best = null;
  let bestScore = -9999;

  const mapped = (list || []).map(mapProduct).filter(p => p.name);

  const exact = mapped.find(product => {
    const nameNorm = normalize(product.name);
    if (cleanedNorm !== nameNorm && qNorm !== nameNorm && !qNorm.includes(nameNorm)) return false;
    if (sport && normalize(product.sport) && normalize(product.sport) !== sport) return false;
    if (year && String(product.year || "") && String(product.year || "") !== String(year)) return false;
    return true;
  });

  if (exact) return { ...exact, score: 999, matchType: "exact" };

  mapped.forEach(item => {
    const s = scoreProduct(item.raw || item, query, targetIntent);
    if (s > bestScore) {
      bestScore = s;
      best = item;
    }
  });

  if (!best || bestScore < 24) return null;
  return { ...best, score: bestScore, matchType: "fuzzy" };
}

function getCombinedBestMatches(query) {
  const cl = findBestProduct(getChecklistIndex(), query, "checklist");
  const prv = findBestProduct(getPrintRunIndex(), query, "print_run");
  const options = [cl, prv].filter(Boolean).sort((a, b) => (b.score || 0) - (a.score || 0));

  return {
    checklist: cl,
    printRun: prv,
    winner: options[0] || null
  };
}

/* ------------------ PLAYER HELPERS ------------------ */

function cleanStatValue(val) {
  let s = String(val ?? "").trim();
  if (!s) return "-";
  s = s.replace(/^\.\./, ".");
  s = s.replace(/^-\.$/, "-");
  return s;
}

function hasRealStatValue(val) {
  const s = cleanStatValue(val);
  return s && s !== "-";
}

function getPlayerYearOptions(playerName, fallbackYears = []) {
  const meta = getPlayerMetaEntry(playerName);

  if (meta && Array.isArray(meta.checklist_years) && meta.checklist_years.length) {
    const normalized = meta.checklist_years
      .map(y => {
        if (typeof y === "object" && y !== null) {
          const year = String(y.year || "").trim();
          if (!year) return null;
          return {
            year,
            label: String(y.label || year).trim(),
            isRcYear: !!y.is_rc_year
          };
        }

        const year = String(y || "").trim();
        if (!year) return null;

        const isRcYear = String(meta.rc_year || "") === year;
        return {
          year,
          label: isRcYear ? `${year} (RC)` : year,
          isRcYear
        };
      })
      .filter(Boolean);

    if (normalized.length) return normalized;
  }

  return (fallbackYears || []).map(y => ({
    year: String(y),
    label: String(y),
    isRcYear: false
  }));
}

function buildPlayerFollowups(playerName, fallbackYears = [], includeStats = true, includeAllCards = true) {
  const yearOptions = getPlayerYearOptions(playerName, fallbackYears);
  const labels = yearOptions.map(y => y.label);

  const out = [];
  if (includeStats) out.push("Stats");
  labels.forEach(l => out.push(l));
  if (includeAllCards) out.push("All Cards");

  return uniq(out);
}

function buildStatEntries(card, keys) {
  return keys.map(key => ({
    label: key,
    value: cleanStatValue(card?.[key])
  }));
}

function buildCurrentSeasonSummary(playerName, currentSeason) {
  if (!currentSeason || !currentSeason.stat_card) {
    return `${playerName} does not have current season stats available yet.`;
  }

  const c = currentSeason.stat_card;
  const bits = [];

  if (hasRealStatValue(c.HR)) bits.push(`${cleanStatValue(c.HR)} home runs`);
  if (hasRealStatValue(c.BA)) bits.push(`${cleanStatValue(c.BA)} batting average`);
  if (hasRealStatValue(c.H)) bits.push(`${cleanStatValue(c.H)} hits`);
  if (hasRealStatValue(c.RBI)) bits.push(`${cleanStatValue(c.RBI)} RBI`);
  if (hasRealStatValue(c.SB)) bits.push(`${cleanStatValue(c.SB)} stolen bases`);

  if (!bits.length) return `${playerName} has current season stats available.`;
  return `${playerName}'s current season includes ${bits.join(", ")}.`;
}

function buildCareerSummary(playerName, career) {
  if (!career || !career.stat_card) {
    return `${playerName} does not have career summary stats available yet.`;
  }

  const c = career.stat_card;
  const bits = [];

  if (hasRealStatValue(c.HR)) bits.push(`${cleanStatValue(c.HR)} home runs`);
  if (hasRealStatValue(c.H)) bits.push(`${cleanStatValue(c.H)} hits`);
  if (hasRealStatValue(c.BA)) bits.push(`${cleanStatValue(c.BA)} batting average`);
  if (hasRealStatValue(c.OPS)) bits.push(`${cleanStatValue(c.OPS)} OPS`);

  if (!bits.length) return `${playerName} has career stats available.`;
  return `${playerName}'s career line includes ${bits.join(", ")}.`;
}

/* ------------------ FORMATTERS ------------------ */

function detectIntent(q) {
  const n = normalize(q);

  if (includesAny(n, INTENT_PRINT_RUN_WORDS)) return "print_run";
  if (includesAny(n, INTENT_CHECKLIST_WORDS)) return "checklist";
  if (includesAny(n, INTENT_TRENDING_WORDS)) return "trending";

  return "search";
}

function buildPrvRows(rows) {
  return rows.map(r => {
    const setType = r.setType || "";
    const setLine = r.setLine || "";
    const label = [setType, setLine].filter(Boolean).join(" ").trim() || "Row";
    const value = formatNumber(r.printRun || "");
    const rarity = utils.getRarityTag ? utils.getRarityTag(r.printRun) : "";
    const setSize = formatNumber(r.subSetSize || "");

    return { label, value, rarity, setSize };
  });
}

function buildPrvMetadata(product, rows) {
  const types = uniq(rows.map(r => r.setType).filter(Boolean));

  return uniq([
    `Rows: ${rows.length}`,
    types.length ? `Types: ${types.length}` : "",
    product.year ? `Year: ${product.year}` : "",
    product.sport ? `Sport: ${titleCase(product.sport)}` : "",
    product.code ? `Code: ${product.code}` : ""
  ]);
}

function summarizeChecklistCounts(summary) {
  const c = summary.counts || {};
  const parts = [];

  if (c.all) parts.push(`${formatNumber(c.all)} total rows`);
  if (c.base) parts.push(`${formatNumber(c.base)} base`);
  if (c.inserts) parts.push(`${formatNumber(c.inserts)} inserts`);
  if (c.autographs) parts.push(`${formatNumber(c.autographs)} autographs`);
  if (c.relics) parts.push(`${formatNumber(c.relics)} relics`);
  if (c.variations) parts.push(`${formatNumber(c.variations)} variations`);
  if (c.parallels) parts.push(`${formatNumber(c.parallels)} parallels`);

  return parts.join(" • ");
}

function checklistSectionOptionsFromSummary(summary) {
  const available = Array.isArray(summary?.available_sections)
    ? summary.available_sections
    : ["all"];

  return available
    .map(key => CHECKLIST_SECTION_LABELS[key])
    .filter(Boolean);
}

function formatChecklistTable(sectionKey, data) {
  const section = normalize(sectionKey);

  if (section === "parallels") {
    return {
      columns: ["Applies To", "Parallel", "Serial / Rarity"],
      rows: (data.rows || []).map(r => {
        const appliesTo = Array.isArray(r) ? (r[0] || "") : (r.applies_to || "");
        const parallelName = Array.isArray(r) ? (r[1] || "") : (r.parallel_name || "");
        const serialNo = Array.isArray(r) ? (r[2] || "") : (r.serial_no || "");
        const tier = getParallelRarityTag(serialNo);

        const cleanedSerial = String(serialNo || "").replace(/^\s*-\s*/, "").trim();
        const serialDisplay = cleanedSerial ? `SN: ${cleanedSerial}` : "Non-Serial";

        return {
          cells: [appliesTo, parallelName, serialDisplay],
          rarity: tier || ""
        };
      })
    };
  }

  return {
    columns: data.columns || ["Subset", "Card No.", "Player", "Team", "Tag"],
    rows: (data.rows || []).map(r => ({
      cells: Array.isArray(r)
        ? r
        : [r.subset || "", r.card_no || "", r.player || "", r.team || "", r.tag || ""]
    }))
  };
}

function buildReleaseScheduleMetadata(rows) {
  const sports = uniq(rows.map(r => r.sport).filter(Boolean));

  return uniq([
    `Releases: ${rows.length}`,
    sports.length ? `Sports: ${sports.length}` : ""
  ]);
}

/* ------------------ RESPONSES ------------------ */

async function buildReleaseScheduleResponse(query) {
  await ensureReleaseScheduleLoaded();

  let rows = filterReleaseScheduleRows(getReleaseScheduleData(), query);

  pendingProductChoice = null;
  pendingChecklistChoice = null;
  pendingPlayerChoice = null;
  awaitingCatalogSport = false;

  if (!rows.length) {
    return {
      type: "standard",
      badge: "Release Schedule",
      title: "No matching releases found",
      summary: "I could not find any matching release schedule results for that search.",
      followups: [
        "Show baseball release schedule",
        "Show football release schedule",
        "Show the release schedule"
      ]
    };
  }

  const sport = extractSport(query);
  const specificReleaseDate = isSpecificReleaseDateQuestion(query);

  if (specificReleaseDate) {
    const best = findBestReleaseRow(rows, query);

    if (best?.row) {
      const row = enrichReleaseRowForUi(best.row);
      const productName = row.setName || row.product || "That product";

      if (isAnnouncedReleaseValue(row.releaseDate)) {
        return {
          type: "standard",
          badge: "Release Date",
          title: productName,
          summary: `${productName} is currently announced, but a firm release date has not been posted yet.`,
          metadata: uniq([
            row.sport ? `Sport: ${titleCase(row.sport)}` : "",
            row.status ? `Status: ${row.status}` : ""
          ]),
          followups: [
            "Show the release schedule",
            row.hasChecklist ? `Show me the ${productName} checklist` : "",
            row.hasVault ? `Show me ${productName} print run` : ""
          ].filter(Boolean)
        };
      }

      return {
        type: "standard",
        badge: "Release Date",
        title: productName,
        heroSummary: true,
        summary: `${productName} releases on ${formatReleaseDate(row.releaseDate)}.`,
        metadata: uniq([
          row.sport ? `Sport: ${titleCase(row.sport)}` : "",
          row.status ? `Status: ${row.status}` : ""
        ]),
        followups: [
          "Show the release schedule",
          row.hasChecklist ? `Show me the ${productName} checklist` : "",
          row.hasVault ? `Show me ${productName} print run` : ""
        ].filter(Boolean)
      };
    }
  }

  if (sport) {
    rows = sortReleaseScheduleRows(rows, sport).map(enrichReleaseRowForUi);

    return {
      type: "release_schedule",
      badge: "Release Schedule",
      title: `${titleCase(sport)} Release Schedule`,
      summary: `Showing upcoming ${sport} releases. Announced products without firm dates are listed after dated releases.`,
      metadata: buildReleaseScheduleMetadata(rows),
      rows,
      isSportSpecific: true,
      followups: buildOtherSportReleaseFollowups(sport).slice(0, 4)
    };
  }

  rows = sortReleaseScheduleRows(rows).map(enrichReleaseRowForUi);

  return {
    type: "release_schedule",
    badge: "Release Schedule",
    title: "Release Schedule",
    summary: "Showing the full release schedule sorted by sport. Announced products without firm dates appear after dated releases within each sport.",
    metadata: buildReleaseScheduleMetadata(rows),
    rows,
    isSportSpecific: false,
    followups: [
      "Show baseball release schedule",
      "Show football release schedule",
      "Show basketball release schedule",
      "Show soccer release schedule",
      "Show hockey release schedule"
    ]
  };
}

async function buildTrendingResponse() {
  const rows = await getHomeFeed();

  const trendingChecklistRows = rows.filter(r => r[0] === "trending_checklists").slice(0, 3);
  const trendingVaultRows = rows.filter(r => r[0] === "trending_print_runs").slice(0, 3);

  const chunks = [];
  if (trendingChecklistRows.length) chunks.push(`Checklist trending: ${trendingChecklistRows.map(r => r[2]).join(" • ")}`);
  if (trendingVaultRows.length) chunks.push(`Print run trending: ${trendingVaultRows.map(r => r[2]).join(" • ")}`);

  return {
    type: "standard",
    badge: "Trending",
    title: "What collectors are searching right now",
    summary: chunks.length ? chunks.join(" | ") : "No trending data is available yet.",
    followups: [
      "Show me 2026 Topps Series 1 print run",
      "Show me the 2026 Topps Chrome Black baseball checklist"
    ]
  };
}

function buildPricingResponse() {
  pendingProductChoice = null;
  pendingChecklistChoice = null;
  pendingPlayerChoice = null;

  return {
    type: "standard",
    badge: "Pricing",
    title: "Pricing data is coming soon",
    summary: "Pricing data, recent sales, and price comps will be added soon. This is an evolution we’ll work on in the coming weeks."
  };
}

function buildDataSourceResponse() {
  pendingProductChoice = null;
  pendingChecklistChoice = null;
  pendingPlayerChoice = null;

  return {
    type: "standard",
    badge: "Data",
    title: "About our data sourcing",
    summary: "Chasing Majors data sourcing is proprietary information and for internal Chasing Majors use only. If you have a suggestion or find an error, please let us know."
  };
}

function buildRestrictedBrandPrintRunResponse() {
  pendingProductChoice = null;
  pendingChecklistChoice = null;
  pendingPlayerChoice = null;

  return {
    type: "standard",
    badge: "Print Run",
    title: "Topps products only",
    summary: "Due to limited and unreliable pack odds data, print run search is currently available only for Topps products.",
    followups: [
      "Show me 2026 Topps Series 1 print run",
      "Show me 2026 Bowman Baseball print run",
      "Show me the 2025 Panini Prizm Football checklist"
    ]
  };
}

function buildAskSportResponse() {
  awaitingCatalogSport = true;
  pendingProductChoice = null;
  pendingChecklistChoice = null;
  pendingPlayerChoice = null;

  return {
    type: "standard",
    badge: "Database",
    title: "Which sport are you looking for?",
    summary: "Choose one: baseball, football, basketball, hockey, or soccer.",
    followups: ["Baseball", "Football", "Basketball", "Hockey", "Soccer"]
  };
}

function buildCatalogSportResponse(sport) {
  awaitingCatalogSport = false;

  const latestYears = getLatestYearsForSport(sport);
  const latestYear = latestYears[0] || "recent years";
  const sampleSets = getSampleCurrentSetsForSport(sport, 8);

  return {
    type: "standard",
    badge: "Database",
    title: `${titleCase(sport)} coverage`,
    summary: `We have hundreds of ${sport} sets in the database. The most current year I found is ${latestYear}.${sampleSets.length ? ` Here are a few examples: ${sampleSets.join(" • ")}` : ""}`
  };
}

function buildYearLineupResponse(year, sport) {
  const products = getProductsForSportYear(sport, year);

  if (!products.length) {
    return {
      type: "standard",
      badge: "Database",
      title: `${year} ${titleCase(sport)} coverage`,
      summary: `I did not find any ${sport} products for ${year} in the database.`
    };
  }

  return {
    type: "standard",
    badge: "Database",
    title: `${year} ${titleCase(sport)} coverage`,
    summary: `We currently have ${formatNumber(products.length)} ${sport} products for ${year}: ${products.map(p => p.name).join(" • ")}`,
    followups: products.slice(0, 8).map(p => `Show me the ${p.name} checklist`)
  };
}

function buildSearchHelpResponse() {
  pendingProductChoice = null;
  pendingChecklistChoice = null;
  pendingPlayerChoice = null;

  return {
    type: "standard",
    badge: "Search Help",
    title: "Best ways to search",
    summary: "The most effective searches usually include the year, full product name, and what you want to see. Player searches also work best with the year or set when you know it.",
    followups: SEARCH_HELP_EXAMPLES
  };
}

function buildClarifyProductTypeResponse(productName, query) {
  pendingProductChoice = { query, productName };
  pendingChecklistChoice = null;
  pendingPlayerChoice = null;
  pendingNumberedChoice = null;

  return {
    type: "standard",
    badge: "Clarify",
    title: productName,
    summary: "Are you looking for print run or checklist data?",
    followups: ["Print run", "Checklist"]
  };
}

async function buildPlayerSerialYearChoiceResponse(numberedReq) {
  await loadPlayerMeta();

  const meta = getPlayerMetaEntry(numberedReq.playerName);
  let fallbackYears = [];

  if (meta && Array.isArray(meta.checklist_years) && meta.checklist_years.length) {
    fallbackYears = meta.checklist_years.map(y =>
      typeof y === "object" && y !== null ? String(y.year || "").trim() : String(y || "").trim()
    ).filter(Boolean);
  } else {
    fallbackYears = await getPlayerYears(numberedReq.playerName, numberedReq.sport || "baseball");
  }

  const yearOptions = getPlayerYearOptions(numberedReq.playerName, fallbackYears);

  pendingNumberedChoice = {
    ...numberedReq,
    availableYears: yearOptions
  };

  pendingProductChoice = null;
  pendingChecklistChoice = null;
  pendingPlayerChoice = null;
  awaitingCatalogSport = false;

  const yearFollowups = yearOptions.slice(0, 6).map(y => y.label || y.year);

  return {
    type: "standard",
    badge: "Serial Numbered",
    title: numberedReq.playerName,
    summary: `Which year should I search for ${numberedReq.playerName} serial-numbered cards under /${numberedReq.serialMax + 1}?`,
    metadata: uniq([
      numberedReq.sport ? `Sport: ${titleCase(numberedReq.sport)}` : "",
      `Serial: Under /${numberedReq.serialMax + 1}`
    ]),
    followups: uniq([
      ...yearFollowups,
      "All Cards"
    ])
  };
}

async function buildPlayerSerialCardsResponse(numberedReq) {
  pendingNumberedChoice = null;
  pendingProductChoice = null;
  pendingChecklistChoice = null;
  pendingPlayerChoice = null;
  awaitingCatalogSport = false;

  const data = await getAdvancedPlayerSerialCards(
    numberedReq.playerName,
    numberedReq.sport || "baseball",
    numberedReq.year || "",
    numberedReq.serialMax
  );

  if (data?.ok === false) {
    return {
      type: "standard",
      badge: "Serial Numbered",
      title: "Serial search is not ready yet",
      summary: "The chat recognized that search, but the checklist backend does not have the serial-numbered card search endpoint deployed yet."
    };
  }

  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const rowCount = Number(data?.row_count || rows.length || 0);
  const serialDisplay = numberedReq.serialMax + 1;

  if (!rowCount) {
    return {
      type: "standard",
      badge: "Serial Numbered",
      title: numberedReq.playerName,
      summary: numberedReq.year
        ? `I did not find ${numberedReq.playerName} ${numberedReq.year} cards serial numbered under /${serialDisplay}.`
        : `I did not find ${numberedReq.playerName} cards serial numbered under /${serialDisplay}.`,
      followups: [
        numberedReq.year ? `Show all ${numberedReq.year} ${numberedReq.playerName} cards` : `Show all ${numberedReq.playerName} cards`,
        `Show ${numberedReq.playerName} numbered under 100`,
        `Show ${numberedReq.playerName} numbered less than 50`
      ]
    };
  }

  const displayRows = rows.map(r => {
    if (!Array.isArray(r)) return r;
    return [
      r[0] || "",
      r[1] || "",
      r[2] || "",
      r[3] || "",
      r[4] || "",
      r[6] || "",
      r[7] || ""
    ];
  });

  return {
    type: "checklist_table",
    badge: "Serial Numbered",
    product: { name: data.resolved_player || numberedReq.playerName },
    sectionKey: "player_serial",
    sectionLabel: numberedReq.year
      ? `${numberedReq.year} Serial Numbered Under /${serialDisplay}`
      : `All Years Serial Numbered Under /${serialDisplay}`,
    rows: displayRows.map(r => ({ cells: r })),
    columns: [
      "Year",
      "Product",
      "Subset",
      "Card No.",
      "Player",
      "Parallel",
      "Serial No."
    ],
    metadata: uniq([
      `Rows: ${formatNumber(rowCount)}`,
      numberedReq.year ? `Year: ${numberedReq.year}` : "Years: All",
      numberedReq.sport ? `Sport: ${titleCase(numberedReq.sport)}` : "",
      `Serial: Under /${serialDisplay}`
    ]),
    sectionOptions: [],
    followups: [
      numberedReq.year ? `Show all ${numberedReq.year} ${numberedReq.playerName} cards` : `Show all ${numberedReq.playerName} cards`,
      numberedReq.serialMax !== 49 ? `Show ${numberedReq.playerName} numbered less than 50` : "",
      numberedReq.serialMax !== 99 ? `Show ${numberedReq.playerName} numbered under 100` : ""
    ].filter(Boolean)
  };
}

async function buildPlayerChoiceResponse(playerReq) {
  await loadPlayerMeta();

  const meta = getPlayerMetaEntry(playerReq.playerName);
  let fallbackYears = [];

  if (meta && Array.isArray(meta.checklist_years) && meta.checklist_years.length) {
    fallbackYears = meta.checklist_years.map(y =>
      typeof y === "object" && y !== null ? String(y.year || "").trim() : String(y || "").trim()
    ).filter(Boolean);
  } else {
    fallbackYears = await getPlayerYears(playerReq.playerName, playerReq.sport || "baseball");
  }

  const followups = buildPlayerFollowups(playerReq.playerName, fallbackYears, true, true);

  pendingPlayerChoice = {
    ...playerReq,
    availableYears: getPlayerYearOptions(playerReq.playerName, fallbackYears)
  };

  pendingProductChoice = null;
  pendingChecklistChoice = null;

  prefetchPlayerData(playerReq);

  return {
    type: "standard",
    badge: "Player",
    title: playerReq.playerName,
    summary: "Choose stats, jump to a checklist year, or open all cards for this player.",
    followups
  };
}

async function buildPlayerStatsPlaceholderResponse(playerReq) {
  await ensurePlayerDataLoaded();

  const stats = getPlayerStatsEntry(playerReq.playerName);
  const meta = getPlayerMetaEntry(playerReq.playerName);

  let fallbackYears = [];
  if (meta && Array.isArray(meta.checklist_years) && meta.checklist_years.length) {
    fallbackYears = meta.checklist_years.map(y =>
      typeof y === "object" && y !== null ? String(y.year || "").trim() : String(y || "").trim()
    ).filter(Boolean);
  } else {
    fallbackYears = await getPlayerYears(playerReq.playerName, playerReq.sport || "baseball");
  }

  const followups = buildPlayerFollowups(playerReq.playerName, fallbackYears, false, true);

  pendingPlayerChoice = {
    ...playerReq,
    availableYears: getPlayerYearOptions(playerReq.playerName, fallbackYears)
  };

  if (!stats) {
    return {
      type: "standard",
      badge: "Player Stats",
      title: playerReq.playerName,
      summary: "Player stats are not available for that player yet.",
      followups
    };
  }

  const currentStats = buildStatEntries(
    stats.current_season?.stat_card,
    ["AB", "H", "HR", "BA", "R", "RBI", "SB", "OBP", "SLG", "OPS"]
  );

  const careerStats = buildStatEntries(
    stats.career?.stat_card,
    ["H", "HR", "BA", "R", "RBI", "SB", "OBP", "SLG", "OPS"]
  );

  return {
    type: "player_stats",
    badge: "Player Stats",
    title: stats.player_name || playerReq.playerName,
    summary: meta?.rc_year
      ? `${stats.player_name || playerReq.playerName} has checklist coverage beginning in ${meta.rc_year}, which is currently tagged as the RC year.`
      : `${stats.player_name || playerReq.playerName} has player stats and checklist year coverage loaded.`,
    metadata: uniq([
      stats.team ? `Team: ${stats.team}` : "",
      meta?.rc_year ? `RC Year: ${meta.rc_year}` : "",
      Array.isArray(meta?.checklist_years) ? `Checklist Years: ${meta.checklist_years.length}` : ""
    ]),
    currentTitle: stats.current_season ? `${stats.current_season.season} Season` : "",
    currentSummary: buildCurrentSeasonSummary(stats.player_name || playerReq.playerName, stats.current_season),
    currentStats,
    careerTitle: "Career",
    careerSummary: buildCareerSummary(stats.player_name || playerReq.playerName, stats.career),
    careerStats,
    followups
  };
}

async function buildPlayerChecklistResponse(playerReq) {
  await loadPlayerMeta();

  pendingProductChoice = null;
  pendingChecklistChoice = null;

  const meta = getPlayerMetaEntry(playerReq.playerName);
  let fallbackYears = [];

  if (meta && Array.isArray(meta.checklist_years) && meta.checklist_years.length) {
    fallbackYears = meta.checklist_years.map(y =>
      typeof y === "object" && y !== null ? String(y.year || "").trim() : String(y || "").trim()
    ).filter(Boolean);
  } else {
    fallbackYears = await getPlayerYears(playerReq.playerName, playerReq.sport || "baseball");
  }

  const yearOptions = getPlayerYearOptions(playerReq.playerName, fallbackYears);

  pendingPlayerChoice = {
    ...playerReq,
    availableYears: yearOptions
  };

  const data = await getPlayerCards(
    playerReq.playerName,
    playerReq.sport || "baseball",
    playerReq.year || "",
    playerReq.code || ""
  );

  const rowCount = Array.isArray(data?.rows) ? data.rows.length : 0;

  let sectionLabel = "Checklist Info";
  if (playerReq.code && playerReq.productName) sectionLabel = playerReq.productName;
  else if (playerReq.year) {
    const matchYear = yearOptions.find(y => String(y.year) === String(playerReq.year));
    sectionLabel = matchYear ? matchYear.label : `${playerReq.year} Cards`;
  } else {
    sectionLabel = "All Checklist Results";
  }

  if (!rowCount) {
    return {
      type: "standard",
      badge: "Player",
      title: playerReq.playerName,
      summary: "No matching checklist rows were found for that player search.",
      followups: buildPlayerFollowups(playerReq.playerName, fallbackYears, true, true)
    };
  }

  return {
    type: "checklist_table",
    product: { name: playerReq.playerName },
    sectionKey: "player",
    sectionLabel,
    rows: (data.rows || []).map(r => ({ cells: r })),
    columns: data.columns || [],
    metadata: uniq([
      `Rows: ${formatNumber(rowCount)}`,
      playerReq.sport ? `Sport: ${titleCase(playerReq.sport)}` : "",
      playerReq.year ? `Year: ${playerReq.year}` : ""
    ]),
    sectionOptions: [],
    followups: playerReq.code
      ? []
      : buildPlayerFollowups(playerReq.playerName, fallbackYears, true, true)
  };
}

async function buildPrintRunResponse(query) {
  if (mentionsRestrictedPrintRunBrand(query)) return buildRestrictedBrandPrintRunResponse();

  const printRunThreshold = extractPrintRunThreshold(query);
  const hasProductClue = hasSpecificProductClue(query);

  pendingProductChoice = null;
  pendingChecklistChoice = null;
  pendingPlayerChoice = null;
  pendingNumberedChoice = null;

  if (printRunThreshold && !hasProductClue) {
    const year = extractYear(query);
    const yearText = year ? ` for ${year}` : "";

    return {
      type: "standard",
      badge: "Low Print Run",
      title: "Which product should I search?",
      summary: `I can search print-run rows ${getThresholdLabel(query, printRunThreshold).toLowerCase()}${yearText}, but I need a product name first.`,
      followups: buildPrintRunProductFollowupsForYear(year, query, printRunThreshold)
    };
  }

  const productQuery = printRunThreshold ? stripPrintRunThresholdWords(query) : query;
  const product =
    (printRunThreshold && hasProductClue
      ? findBestProduct(getPrintRunIndex(), productQuery, "print_run")
      : null) ||
    findBestProduct(getPrintRunIndex(), query, "print_run") ||
    findBestProduct(getPrintRunIndex(), stripIntentWords(query), "print_run");

  if (!product) {
    return {
      type: "standard",
      badge: "Print Run",
      title: "I could not match that set",
      summary: "Try using the year and product name, like 2026 Topps Series 1 print run."
    };
  }

  const rawRows = await getPrintRunData(product.code, product.sport);
  const thresholdLabel = printRunThreshold ? getThresholdLabel(query, printRunThreshold) : "";

  if (!rawRows.length) {
    return {
      type: "standard",
      badge: "Print Run",
      title: product.name,
      summary: "I found the product in the vault index, but no print run rows were returned yet.",
      metadata: uniq([
        product.year ? `Year: ${product.year}` : "",
        product.sport ? `Sport: ${titleCase(product.sport)}` : "",
        product.code ? `Code: ${product.code}` : ""
      ])
    };
  }

  if (printRunThreshold) {
    const filteredRows = rawRows.filter(r => {
      const value = getPrintRunValue(r);
      return value > 0 && value <= printRunThreshold;
    });

    if (!filteredRows.length) {
      return {
        type: "standard",
        badge: "Low Print Run",
        title: product.name,
        summary: `I found the product, but no print-run rows were ${thresholdLabel.toLowerCase()}.`,
        metadata: uniq([
          `Filter: ${thresholdLabel}`,
          product.year ? `Year: ${product.year}` : "",
          product.sport ? `Sport: ${titleCase(product.sport)}` : "",
          product.code ? `Code: ${product.code}` : ""
        ]),
        followups: [
          `Show full ${product.name} print run`,
          `Show me the ${product.name} checklist`
        ]
      };
    }

    return {
      type: "prv",
      badge: "Low Print Run",
      product,
      rawRows: filteredRows,
      rows: buildPrvRows(filteredRows),
      metadata: uniq([
        `Rows: ${filteredRows.length}`,
        `Filter: ${thresholdLabel}`,
        product.year ? `Year: ${product.year}` : "",
        product.sport ? `Sport: ${titleCase(product.sport)}` : ""
      ]),
      followups: [
        `Show full ${product.name} print run`,
        `Show me the ${product.name} checklist`
      ]
    };
  }

  return {
    type: "prv",
    product,
    rawRows,
    rows: buildPrvRows(rawRows),
    metadata: buildPrvMetadata(product, rawRows),
    followups: [
      `Show me the ${product.name} checklist`,
      `What parallels are in ${product.name}`
    ]
  };
}

async function buildChecklistSummaryResponse(query) {
  const product =
    findBestProduct(getChecklistIndex(), query, "checklist") ||
    findBestProduct(getChecklistIndex(), stripIntentWords(query), "checklist");

  pendingProductChoice = null;
  pendingPlayerChoice = null;

  if (!product) {
    pendingChecklistChoice = null;

    return {
      type: "standard",
      badge: "Checklist",
      title: "I could not match that checklist",
      summary: "Try using the year and set name, like 2026 Topps Chrome Black baseball checklist."
    };
  }

  const summary = await getChecklistSummary(product.code);

  pendingChecklistChoice = {
    product,
    summary
  };

  const directSection = detectChecklistSectionIntent(query);
  if (directSection) return buildChecklistSectionResponse(directSection);

  const countsLine = summarizeChecklistCounts(summary);

  return {
    type: "standard",
    badge: "Checklist",
    title: product.name,
    summary: `I found a matching checklist.${countsLine ? ` ${countsLine}.` : ""} Are you looking for the entire checklist or a checklist for base, inserts, autographs, relics, variations, or parallels?`,
    metadata: uniq([
      summary.counts?.all ? `Rows: ${formatNumber(summary.counts.all)}` : "",
      product.year ? `Year: ${product.year}` : "",
      product.sport ? `Sport: ${titleCase(product.sport)}` : ""
    ]),
    followups: checklistSectionOptionsFromSummary(summary)
  };
}

async function buildChecklistSectionResponse(sectionKey) {
  if (!pendingChecklistChoice?.product) {
    return {
      type: "standard",
      badge: "Checklist",
      title: "Checklist selection expired",
      summary: "Search for a checklist again and I’ll load the section you want."
    };
  }

  const product = pendingChecklistChoice.product;
  const section = sectionKey || "all";

  const data = section === "parallels"
    ? await getChecklistParallels(product.code)
    : await getChecklistSection(product.code, section);

  const formatted = formatChecklistTable(section, data);

  return {
    type: "checklist_table",
    product,
    sectionKey: section,
    sectionLabel: CHECKLIST_SECTION_LABELS[section] || "Checklist",
    rows: formatted.rows,
    columns: formatted.columns,
    metadata: uniq([
      Array.isArray(data?.rows) ? `Rows: ${formatNumber(data.rows.length)}` : "",
      product.year ? `Year: ${product.year}` : "",
      product.sport ? `Sport: ${titleCase(product.sport)}` : ""
    ]),
    insights: section === "parallels" ? utils.buildParallelInsights(data?.rows || []) : [],
    sectionOptions: checklistSectionOptionsFromSummary(pendingChecklistChoice.summary),
    followups: [
      `Show me ${product.name} print run`
    ]
  };
}

async function buildSearchResponse(query) {
  if (isSearchHelpRequest(query)) return buildSearchHelpResponse();

  if (isSpecificYearLineupQuestion(query)) {
    return buildYearLineupResponse(extractYear(query), extractSport(query));
  }

  if (isReleaseScheduleQuestion(query)) return buildReleaseScheduleResponse(query);
  if (isCatalogCoverageQuestion(query)) return buildAskSportResponse();
  if (isPricingQuestion(query)) return buildPricingResponse();
  if (isDataSourceQuestion(query)) return buildDataSourceResponse();

  const numberedReq = detectNumberedPlayerSearchRequest(query);
  if (numberedReq) {
    if (!numberedReq.year) {
      return buildPlayerSerialYearChoiceResponse(numberedReq);
    }

    return buildPlayerSerialCardsResponse(numberedReq);
  }

  const playerReq = detectPlayerSearchRequest(query);
  if (playerReq) {
    prefetchPlayerData(playerReq);

    if (playerReq.mode === "player_product" || playerReq.mode === "player_year") {
      return buildPlayerChecklistResponse(playerReq);
    }

    return buildPlayerChoiceResponse(playerReq);
  }

  const matches = getCombinedBestMatches(query);

  if (!matches.winner) {
    pendingProductChoice = null;
    pendingChecklistChoice = null;
    pendingPlayerChoice = null;

    return {
      type: "standard",
      badge: "Try",
      title: "Try another search",
      summary: "Ask for a print run, checklist, release schedule, year + sport product lineup, trending set, player search, pricing, or a set search.",
      followups: ["See the best way search", "Show the release schedule"]
    };
  }

  if (matches.winner.code && matches.winner.score >= 50) {
    prefetchChecklistData(matches.winner);
    prefetchPrintRunData(matches.winner);
  }

  return buildClarifyProductTypeResponse(matches.winner.name, query);
}

async function buildResponse(query) {
  if (isDirectReleaseActionQuery(query)) {
    const action = parseDirectReleaseActionQuery(query);

    if (action.kind === "checklist") return buildDirectChecklistResponse(action);
    if (action.kind === "print_run") return buildDirectPrintRunResponse(action);

    return {
      type: "standard",
      badge: "Release Schedule",
      title: "Action not available",
      summary: "I could not open that release schedule action."
    };
  }

  if (pendingNumberedChoice) {
    if (isAllCardsReply(query)) {
      return buildPlayerSerialCardsResponse({
        ...pendingNumberedChoice,
        year: ""
      });
    }

    const selectedYear = extractSelectedYear(query);
    const normalizedQuery = normalize(query);
    const allowedYearLabels = (pendingNumberedChoice.availableYears || []).map(y =>
      normalize(y.label || y.year || "")
    );

    if (
      selectedYear &&
      (
        normalizedQuery === normalize(selectedYear) ||
        allowedYearLabels.includes(normalizedQuery)
      )
    ) {
      return buildPlayerSerialCardsResponse({
        ...pendingNumberedChoice,
        year: selectedYear
      });
    }
  }

  if (awaitingCatalogSport && isOnlySportReply(query)) {
    return buildCatalogSportResponse(normalize(query));
  }

  if (pendingPlayerChoice && isOnlyPlayerStatsReply(query)) {
    return buildPlayerStatsPlaceholderResponse(pendingPlayerChoice);
  }

  if (pendingPlayerChoice && isOnlyPlayerChecklistReply(query)) {
    return buildPlayerChecklistResponse({
      ...pendingPlayerChoice,
      year: "",
      code: ""
    });
  }

  if (pendingPlayerChoice) {
    const selectedYear = extractSelectedYear(query);
    const normalizedQuery = normalize(query);
    const allowedYearLabels = (pendingPlayerChoice.availableYears || []).map(y =>
      normalize(y.label || y.year || "")
    );

    if (
      selectedYear &&
      (
        normalizedQuery === normalize(selectedYear) ||
        allowedYearLabels.includes(normalizedQuery)
      )
    ) {
      return buildPlayerChecklistResponse({
        ...pendingPlayerChoice,
        year: selectedYear,
        code: ""
      });
    }
  }

  if (pendingChecklistChoice && isChecklistSectionReply(query)) {
    return buildChecklistSectionResponse(resolveChecklistSection(query));
  }

  if (pendingProductChoice && isOnlyPrintRunReply(query)) {
    return buildPrintRunResponse(pendingProductChoice.query);
  }

  if (pendingProductChoice && isOnlyChecklistReply(query)) {
    return buildChecklistSummaryResponse(pendingProductChoice.query);
  }

  if (isSearchHelpRequest(query)) return buildSearchHelpResponse();
  if (isPricingQuestion(query)) return buildPricingResponse();
  if (isDataSourceQuestion(query)) return buildDataSourceResponse();
  if (isReleaseScheduleQuestion(query)) return buildReleaseScheduleResponse(query);

  const intent = detectIntent(query);

  if (intent === "trending") return buildTrendingResponse();
  if (intent === "print_run") return buildPrintRunResponse(query);
  if (intent === "checklist") return buildChecklistSummaryResponse(query);

  return buildSearchResponse(query);
}

/* ------------------ MAIN ------------------ */

async function submitQuery(text) {
  const val = String(text || chatInput?.value || "").trim();
  if (!val) return;

  if (isDirectReleaseActionQuery(val)) {
    ui.addUserMessage(getDirectReleaseActionDisplayText(parseDirectReleaseActionQuery(val)));
  } else {
    ui.addUserMessage(val);
  }

  if (chatInput) chatInput.value = "";

  const loader = ui.startLoadingBubble([
    "Thinking...",
    "Finding match...",
    "Pulling Chasing Majors data...",
    "Formatting results..."
  ], 1500);

  try {
    await bootstrapData();
    const res = await buildResponse(val);

    loader.remove();

    if (res.type === "prv") {
      ui.addPrvResultCard(res);
    } else if (res.type === "checklist_table") {
      ui.addChecklistResultCard(res);
    } else if (res.type === "player_stats") {
      ui.addPlayerStatsCard(res);
    } else if (res.type === "release_schedule") {
      ui.addReleaseScheduleCard(res);
    } else {
      ui.addStandardAnswerCard(res);
    }

    logEvent({
      app: "chat_demo",
      page: "fake_chatbot",
      event_type: "chat_query",
      query: isDirectReleaseActionQuery(val)
        ? getDirectReleaseActionDisplayText(parseDirectReleaseActionQuery(val))
        : val,
      selected_name: res.product?.name || res.title || "",
      selected_type:
        res.type === "prv" ? "Print Run" :
        res.type === "checklist_table" ? "Checklist" :
        res.type === "player_stats" ? "Player Stats" :
        res.type === "release_schedule" ? "Release Schedule" :
        (res.badge || ""),
      route_target:
        res.type === "prv" ? "vault" :
        res.type === "checklist_table" ? "checklists" :
        res.type === "release_schedule" ? "release_schedule" : ""
    });
  } catch (err) {
    console.error(err);

    loader.remove();

    ui.addStandardAnswerCard({
      badge: "Error",
      title: "Something went wrong",
      summary: "The chat could not load data right now. Please try again."
    });
  }
}

/* ------------------ INIT ------------------ */

function initChat() {
  ui.renderExamples(EXAMPLES);
  ui.setSubmitHandler(submitQuery);

  requestAnimationFrame(() => ui.addWelcomeMessage(true));

  bootstrapData().catch(err => console.warn("Bootstrap failed", err));

  setTimeout(() => {
    preloadPlayerDataInBackground();
    preloadReleaseScheduleInBackground();
  }, 0);

  ui.initJumpNav();

  if (chatInput) chatInput.focus();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initChat);
} else {
  initChat();
}

if (sendBtn) {
  sendBtn.onclick = () => submitQuery();
}

if (chatInput) {
  chatInput.onkeydown = e => {
    if (e.key === "Enter") submitQuery();
  };
}
