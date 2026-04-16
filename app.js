const { config, utils, api, cache, store } = window.CMChat;

const {
  SEARCH_HELP_EXAMPLES,
  EXAMPLES,
  SPORT_WORDS,
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
  parseSerialNumber,
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
  getPlayerYears
} = api;

const {
  memCache
} = cache;

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
  loadPlayerMeta,
  loadPlayerStats
} = store;

const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");
const examplePills = document.getElementById("examplePills");

let awaitingCatalogSport = false;
let pendingProductChoice = null;
let pendingChecklistChoice = null;
let pendingPlayerChoice = null;

function getChecklistIndex() {
  return store.checklistIndex || [];
}

function getPrintRunIndex() {
  return store.printRunIndex || [];
}

function getPlayerMetaIndex() {
  return store.playerMetaIndex || [];
}

function getPlayerStatsData() {
  return store.playerStatsData || null;
}

function getReleaseScheduleData() {
  return store.releaseScheduleData || [];
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

  if (!isLikelyPlayerNameToken(candidateNorms[0])) {
    return null;
  }

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

  const playerName = titleCase(playerTokens.join(" "));
  const remainderTokens = candidateTokens.slice(stopIdx);
  const remainder = remainderTokens.join(" ").trim();

  return {
    playerName,
    year: year || "",
    sport: sport || "baseball",
    remainder
  };
}

function looksLikeStandaloneYearQuery(parts) {
  if (!parts) return false;
  if (!parts.year) return false;

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

  const score = candidate.score || 0;

  const productTokens = new Set([
    ...meaningfulTokens(candidate.name),
    ...meaningfulTokens(candidate.keywords),
    ...meaningfulTokens(candidate.code)
  ]);

  const queryTokens = meaningfulTokens(cleaned);
  const overlap = queryTokens.filter(t => productTokens.has(t)).length;

  if (overlap < 1) return null;
  if (score < 45) return null;

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
      year: year || "",
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
    n.includes("price data")
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
      const rowYear = String(r.releaseDate || "").slice(0, 4);
      return rowYear === String(year).slice(0, 4);
    });
  }

  if (n.includes("upcoming") || n.includes("coming") || n.includes("new")) {
    filtered = filtered.filter(r => {
      const status = normalize(r.status);
      return status === "upcoming" || status === "announced" || status === "scheduled" || !status;
    });
  }

  filtered.sort((a, b) => {
    const ad = parseDateSafe(a.releaseDate);
    const bd = parseDateSafe(b.releaseDate);
    if (!ad && !bd) return 0;
    if (!ad) return 1;
    if (!bd) return -1;
    return ad - bd;
  });

  return filtered;
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

/* ------------------ UI ------------------ */

function renderExamples() {
  if (!examplePills) return;

  if (!EXAMPLES.length) {
    examplePills.innerHTML = "";
    examplePills.style.display = "none";
    return;
  }

  examplePills.style.display = "";
  examplePills.innerHTML = EXAMPLES.map(e =>
    `<button class="example-pill" data-example="${escapeHtml(e)}">${escapeHtml(e)}</button>`
  ).join("");

  examplePills.querySelectorAll("[data-example]").forEach(btn => {
    btn.onclick = () => submitQuery(btn.dataset.example);
  });
}

function addUserMessage(text) {
  chatMessages.innerHTML += `
    <div class="message-row user">
      <div class="message-bubble">${escapeHtml(text)}</div>
    </div>
  `;
  scrollToBottom();
}

function scrollToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function scrollNewCardToTop(element) {
  if (!element) {
    scrollToBottom();
    return;
  }

  requestAnimationFrame(() => {
    const containerRect = chatMessages.getBoundingClientRect();
    const elRect = element.getBoundingClientRect();
    const delta = elRect.top - containerRect.top;
    chatMessages.scrollTop += delta - 8;
  });
}

function addStandardAnswerCard(r) {
  const metaHtml = (r.metadata || []).length
    ? `<div class="answer-meta">${(r.metadata || []).map(m => `<div class="answer-meta-chip">${escapeHtml(m)}</div>`).join("")}</div>`
    : "";

  const followupsHtml = (r.followups || []).length
    ? `
      <div class="answer-followups">
        <div class="followup-label">Try next</div>
        <div class="followup-list">
          ${(r.followups || []).map(f => `<button class="followup-btn" data-followup="${escapeHtml(f)}">${escapeHtml(f)}</button>`).join("")}
        </div>
      </div>
    `
    : "";

  const cardId = `standard_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  chatMessages.innerHTML += `
    <div class="message-row assistant">
      <div class="answer-card" id="${cardId}">
        <div class="answer-badge">${escapeHtml(r.badge || "Answer")}</div>
        <div class="answer-title">${escapeHtml(r.title || "Result")}</div>
        <div class="answer-summary">${escapeHtml(r.summary || "")}</div>
        ${metaHtml}
        ${followupsHtml}
      </div>
    </div>
  `;

  bindFollowups();
  scrollNewCardToTop(document.getElementById(cardId));
}

function addPlayerStatsCard(r) {
  const metaHtml = (r.metadata || []).length
    ? `<div class="answer-meta">${(r.metadata || []).map(m => `<div class="answer-meta-chip">${escapeHtml(m)}</div>`).join("")}</div>`
    : "";

  const renderStatGrid = (title, stats) => {
    if (!stats || !stats.length) return "";
    return `
      <div style="margin-top:14px;">
        <div style="font-weight:700; margin-bottom:8px;">${escapeHtml(title)}</div>
        <div style="display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px;">
          ${stats.map(s => `
            <div style="border:1px solid rgba(255,255,255,.08); border-radius:12px; padding:10px; background:rgba(255,255,255,.03);">
              <div style="font-size:11px; opacity:.7; margin-bottom:4px;">${escapeHtml(s.label)}</div>
              <div style="font-size:16px; font-weight:700;">${escapeHtml(s.value)}</div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  };

  const followupsHtml = (r.followups || []).length
    ? `
      <div class="answer-followups">
        <div class="followup-label">Try next</div>
        <div class="followup-list">
          ${(r.followups || []).map(f => `<button class="followup-btn" data-followup="${escapeHtml(f)}">${escapeHtml(f)}</button>`).join("")}
        </div>
      </div>
    `
    : "";

  const cardId = `playerstats_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  chatMessages.innerHTML += `
    <div class="message-row assistant">
      <div class="answer-card" id="${cardId}">
        <div class="answer-badge">${escapeHtml(r.badge || "Player Stats")}</div>
        <div class="answer-title">${escapeHtml(r.title || "Player Stats")}</div>
        <div class="answer-summary">${escapeHtml(r.summary || "")}</div>
        ${metaHtml}
        ${r.currentSummary ? `<div class="answer-summary" style="margin-top:12px;">${escapeHtml(r.currentSummary)}</div>` : ""}
        ${renderStatGrid(r.currentTitle || "Current Season", r.currentStats || [])}
        ${r.careerSummary ? `<div class="answer-summary" style="margin-top:12px;">${escapeHtml(r.careerSummary)}</div>` : ""}
        ${renderStatGrid(r.careerTitle || "Career", r.careerStats || [])}
        ${followupsHtml}
      </div>
    </div>
  `;

  bindFollowups();
  scrollNewCardToTop(document.getElementById(cardId));
}

function addWelcomeMessage(force = false) {
  if (!chatMessages) return;

  const alreadyHasWelcome = !!chatMessages.querySelector("[data-cm-welcome]");
  if (alreadyHasWelcome && !force) return;

  if (alreadyHasWelcome && force) {
    chatMessages.querySelector("[data-cm-welcome]")?.closest(".message-row")?.remove();
  }

  chatMessages.innerHTML = `
    <div class="message-row assistant">
      <div class="answer-card" data-cm-welcome="1">
        <div class="answer-badge">Welcome</div>
        <div class="answer-title">Welcome to Chasing Majors Chat</div>
        <div class="answer-summary">If you are looking for print run data, checklist search, player lookups, product coverage, or release schedule information, you are in the right place.</div>
        <div class="answer-followups">
          <div class="followup-label">Start here</div>
          <div class="followup-list">
            <button class="followup-btn" data-followup="See the best way search">See the best way search</button>
            <button class="followup-btn" data-followup="Show the release schedule">Show the release schedule</button>
          </div>
        </div>
      </div>
    </div>
  ` + chatMessages.innerHTML;

  bindFollowups();
  scrollToBottom();
}

function startLoadingBubble(messages, intervalMs = 1500) {
  const id = `loading_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const safeMessages = Array.isArray(messages) && messages.length
    ? messages
    : ["Thinking..."];

  chatMessages.innerHTML += `
    <div class="message-row assistant" id="${id}">
      <div class="message-bubble" data-loading-bubble>${escapeHtml(safeMessages[0])}</div>
    </div>
  `;
  scrollToBottom();

  const row = document.getElementById(id);
  const bubble = row ? row.querySelector("[data-loading-bubble]") : null;

  let idx = 0;
  let timer = null;
  let delayedStart = null;

  delayedStart = setTimeout(() => {
    timer = setInterval(() => {
      if (!bubble) return;
      idx = (idx + 1) % safeMessages.length;
      bubble.textContent = safeMessages[idx];
    }, intervalMs);
  }, 500);

  return {
    remove() {
      if (delayedStart) clearTimeout(delayedStart);
      if (timer) clearInterval(timer);
      if (row && row.parentNode) row.parentNode.removeChild(row);
    }
  };
}

function getMoreButtonLabel(total, visible) {
  if (visible < 8) return `Show ${Math.min(8, total) - visible} More Rows`;
  if (visible < 16) return `Show ${Math.min(16, total) - visible} More Rows`;
  return `Show ${total - visible} More Rows`;
}

function addPrvResultCard(result) {
  const product = result.product || {};
  const rows = result.rows || [];
  const chips = result.metadata || [];
  const followups = result.followups || [];
  let visibleCount = Math.min(8, rows.length);
const insights = utils.buildPrintRunInsights(result.rawRows || []);
  
  const buildRowsHtml = (list) => list.map(r => `
    <tr class="prv-chat-tr">
      <td class="prv-chat-td prv-chat-td-left">
        <div class="prv-chat-cell-main">${escapeHtml(r.label || "")}</div>
      </td>
<td class="prv-chat-td prv-chat-td-right">
  ${escapeHtml(r.value || "")}
  ${r.rarity ? `<div class="prv-rarity">${escapeHtml(r.rarity)}</div>` : ""}
</td>      <td class="prv-chat-td prv-chat-td-setsize">${escapeHtml(r.setSize || "")}</td>
    </tr>
  `).join("");

  const chipsHtml = chips.length
    ? `<div class="prv-chat-chips">${chips.map(c => `<div class="prv-chat-chip">${escapeHtml(c)}</div>`).join("")}</div>`
    : "";

const insightsHtml = insights.length
  ? `
    <div class="prv-chat-insights">
      <div class="prv-chat-insights-title">What this means</div>
      <ul class="prv-chat-insights-list">
        ${insights.map(i => `<li>${escapeHtml(i)}</li>`).join("")}
      </ul>
    </div>
  `
  : "";
  
  const followupsHtml = followups.length
    ? `
      <div class="answer-followups">
        <div class="followup-label">Try next</div>
        <div class="followup-list">
          ${followups.map(f => `<button class="followup-btn" data-followup="${escapeHtml(f)}">${escapeHtml(f)}</button>`).join("")}
        </div>
      </div>
    `
    : "";

  const cardId = `prv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  chatMessages.innerHTML += `
    <div class="message-row assistant">
      <div class="prv-chat-card" id="${cardId}">
        <div class="prv-chat-topline">
          <div class="answer-badge">Print Run</div>
        </div>

        <div class="prv-chat-title">${escapeHtml(product.name || "")}</div>

        ${chipsHtml}

        <div class="prv-chat-table-wrap">
          <table class="prv-chat-table">
            <thead>
              <tr>
                <th>Card / Parallel</th>
                <th>Print Run</th>
                <th>Set Size</th>
              </tr>
            </thead>
            <tbody data-prv-body>
              ${buildRowsHtml(rows.slice(0, visibleCount))}
            </tbody>
          </table>
        </div>

        ${rows.length > visibleCount ? `
          <div class="prv-chat-more">
            <button class="prv-chat-more-btn" type="button" data-prv-more>
              ${getMoreButtonLabel(rows.length, visibleCount)}
            </button>
          </div>
        ` : ""}
${insightsHtml}
        <div class="prv-chat-note">
          If you’re looking for serial numbered data ask to see serial numbered for a given set.
        </div>

        ${followupsHtml}
      </div>
    </div>
  `;

  const card = document.getElementById(cardId);
  if (card) {
    const body = card.querySelector("[data-prv-body]");
    const btn = card.querySelector("[data-prv-more]");

    if (btn && body) {
      btn.onclick = () => {
        if (visibleCount < 8) visibleCount = Math.min(8, rows.length);
        else if (visibleCount < 16) visibleCount = Math.min(16, rows.length);
        else visibleCount = rows.length;

        body.innerHTML = buildRowsHtml(rows.slice(0, visibleCount));

        if (visibleCount >= rows.length) btn.remove();
        else btn.textContent = getMoreButtonLabel(rows.length, visibleCount);

        scrollNewCardToTop(card);
      };
    }
  }

  bindFollowups();
  scrollNewCardToTop(card);
}

function addChecklistResultCard(result) {
  const product = result.product || {};
  const rows = result.rows || [];
  const chips = result.metadata || [];
  const followups = result.followups || [];
  const sectionLabel = result.sectionLabel || "Checklist";
  const insights = result.insights || [];

  const headers = result.columns || ["Subset", "Card No.", "Player", "Team", "Tag"];
  const headHtml = headers.map(h => `<th>${escapeHtml(h)}</th>`).join("");

const bodyHtml = rows.map(row => `
  <tr class="prv-chat-tr">
    ${(row.cells || []).map((cell, idx) => {
      const isParallelSerialCell = result.sectionKey === "parallels" && idx === 2;

      if (isParallelSerialCell) {
        return `
          <td class="prv-chat-td prv-chat-td-checklist-last">
            <div class="prv-chat-cell-main">${escapeHtml(cell || "")}</div>
            ${row.rarity ? `<div class="prv-rarity">${escapeHtml(row.rarity)}</div>` : ""}
          </td>
        `;
      }

      return `
        <td class="prv-chat-td ${idx === row.cells.length - 1 ? "prv-chat-td-checklist-last" : ""}">
          <div class="prv-chat-cell-main">${escapeHtml(cell || "")}</div>
        </td>
      `;
    }).join("")}
  </tr>
`).join("");

  const chipsHtml = chips.length
    ? `<div class="prv-chat-chips">${chips.map(c => `<div class="prv-chat-chip">${escapeHtml(c)}</div>`).join("")}</div>`
    : "";
  const insightsHtml = insights.length
  ? `
    <div class="prv-chat-insights">
      <div class="prv-chat-insights-title">What this means</div>
      <ul class="prv-chat-insights-list">
        ${insights.map(i => `<li>${escapeHtml(i)}</li>`).join("")}
      </ul>
    </div>
  `
  : "";

  const sectionOptions = (result.sectionOptions || [])
    .map(opt => `<button class="followup-btn" data-followup="${escapeHtml(opt)}">${escapeHtml(opt)}</button>`)
    .join("");

  const cardId = `checklist_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  chatMessages.innerHTML += `
    <div class="message-row assistant">
      <div class="prv-chat-card" id="${cardId}">
        <div class="prv-chat-topline">
          <div class="answer-badge">Checklist</div>
        </div>

        <div class="prv-chat-title">${escapeHtml(product.name || "")}</div>
        <div class="answer-summary" style="margin-bottom:14px;">${escapeHtml(sectionLabel)}</div>

        ${chipsHtml}

        <div class="prv-chat-table-wrap">
          <table class="prv-chat-table checklist-chat-table">
            <thead>
              <tr>${headHtml}</tr>
            </thead>
            <tbody>
              ${bodyHtml || `<tr><td class="prv-chat-td" colspan="${headers.length}"><div class="prv-chat-cell-main">No rows found.</div></td></tr>`}
            </tbody>
          </table>
        </div>
${insightsHtml}
        ${sectionOptions ? `
          <div class="answer-followups">
            <div class="followup-label">View another section</div>
            <div class="followup-list">${sectionOptions}</div>
          </div>
        ` : ""}

        ${followups.length ? `
          <div class="answer-followups">
            <div class="followup-label">Try next</div>
            <div class="followup-list">
              ${followups.map(f => `<button class="followup-btn" data-followup="${escapeHtml(f)}">${escapeHtml(f)}</button>`).join("")}
            </div>
          </div>
        ` : ""}
      </div>
    </div>
  `;

  const card = document.getElementById(cardId);
  bindFollowups();
  scrollNewCardToTop(card);
}

function addReleaseScheduleCard(result) {
  const rows = result.rows || [];
  const chips = result.metadata || [];
  const followups = result.followups || [];

  const chipsHtml = chips.length
    ? `<div class="prv-chat-chips">${chips.map(c => `<div class="prv-chat-chip">${escapeHtml(c)}</div>`).join("")}</div>`
    : "";

  const bodyHtml = rows.map(r => `
    <tr class="prv-chat-tr">
      <td class="prv-chat-td">
        <div class="prv-chat-cell-main">${escapeHtml(formatReleaseDate(r.releaseDate))}</div>
      </td>
      <td class="prv-chat-td">
        <div class="prv-chat-cell-main">${escapeHtml(r.sport || "")}</div>
      </td>
      <td class="prv-chat-td">
        <div class="prv-chat-cell-main">${escapeHtml(r.manufacturer || "")}</div>
      </td>
      <td class="prv-chat-td">
        <div class="prv-chat-cell-main">${escapeHtml(r.setName || r.product || "")}</div>
      </td>
      <td class="prv-chat-td">
        <div class="prv-chat-cell-main">${escapeHtml(r.status || "")}</div>
      </td>
    </tr>
  `).join("");

  const followupsHtml = followups.length
    ? `
      <div class="answer-followups">
        <div class="followup-label">Try next</div>
        <div class="followup-list">
          ${followups.map(f => `<button class="followup-btn" data-followup="${escapeHtml(f)}">${escapeHtml(f)}</button>`).join("")}
        </div>
      </div>
    `
    : "";

  const cardId = `release_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  chatMessages.innerHTML += `
    <div class="message-row assistant">
      <div class="prv-chat-card" id="${cardId}">
        <div class="prv-chat-topline">
          <div class="answer-badge">${escapeHtml(result.badge || "Release Schedule")}</div>
        </div>

        <div class="prv-chat-title">${escapeHtml(result.title || "Upcoming Releases")}</div>
        <div class="answer-summary" style="margin-bottom:14px;">${escapeHtml(result.summary || "")}</div>

        ${chipsHtml}

        <div class="prv-chat-table-wrap">
          <table class="prv-chat-table checklist-chat-table">
            <thead>
              <tr>
                <th>Release Date</th>
                <th>Sport</th>
                <th>Brand</th>
                <th>Product</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${bodyHtml}
            </tbody>
          </table>
        </div>

        ${followupsHtml}
      </div>
    </div>
  `;

  const card = document.getElementById(cardId);
  bindFollowups();
  scrollNewCardToTop(card);
}

function bindFollowups() {
  chatMessages.querySelectorAll("[data-followup]").forEach(btn => {
    btn.onclick = () => submitQuery(btn.dataset.followup);
  });
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

  if (qNorm.includes(nameNorm)) score += 140;
  if (cleanedNorm && nameNorm.includes(cleanedNorm)) score += 70;
  if (cleanedNorm && product.haystack.includes(cleanedNorm)) score += 50;
  if (codeNorm && qNorm.includes(codeNorm)) score += 90;

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
  let best = null;
  let bestScore = -9999;

  list.forEach(item => {
    const s = scoreProduct(item, query, targetIntent);
    if (s > bestScore) {
      bestScore = s;
      best = mapProduct(item);
    }
  });

  if (!best || bestScore < 24) return null;
  return { ...best, score: bestScore };
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

function cleanStatValue(val) {
  let s = String(val ?? "").trim();
  if (!s) return "—";
  s = s.replace(/^\.\./, ".");
  s = s.replace(/^-\.$/, "—");
  return s;
}

function hasRealStatValue(val) {
  const s = cleanStatValue(val);
  return s && s !== "—";
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

function detectIntent(q) {
  const n = normalize(q);

  if (includesAny(n, INTENT_PRINT_RUN_WORDS)) return "print_run";
  if (includesAny(n, INTENT_CHECKLIST_WORDS)) return "checklist";
  if (includesAny(n, INTENT_TRENDING_WORDS)) return "trending";
  return "search";
}

/* ------------------ FORMATTERS ------------------ */

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
    product.sport ? `Sport: ${titleCase(product.sport)}` : ""
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
  const manufacturers = uniq(rows.map(r => r.manufacturer).filter(Boolean));

  return uniq([
    `Releases: ${rows.length}`,
    sports.length ? `Sports: ${sports.length}` : "",
    manufacturers.length ? `Manufacturers: ${manufacturers.length}` : ""
  ]);
}

/* ------------------ RESPONSES ------------------ */

async function buildReleaseScheduleResponse(query) {
  await ensureReleaseScheduleLoaded();

  const rows = filterReleaseScheduleRows(getReleaseScheduleData(), query).slice(0, 12);

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
        "Show upcoming baseball releases",
        "Show upcoming football releases",
        "Show the release schedule"
      ]
    };
  }

  const nextRelease = rows[0];
  const summaryBits = [
    `Next up: ${nextRelease.setName || nextRelease.product || "Release"} on ${formatReleaseDate(nextRelease.releaseDate)}`
  ];

  if (nextRelease.status) summaryBits.push(`Status: ${nextRelease.status}`);

  return {
    type: "release_schedule",
    badge: "Release Schedule",
    title: "Upcoming Releases",
    summary: summaryBits.join(" • "),
    metadata: buildReleaseScheduleMetadata(rows),
    rows,
    followups: uniq(
      rows.slice(0, 4).flatMap(r => {
        const out = [];
        if (r.setName) {
          out.push(`Show me the ${r.setName} checklist`);
          out.push(`Show me ${r.setName} print run`);
        }
        return out;
      })
    ).slice(0, 6)
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

  return {
    type: "standard",
    badge: "Clarify",
    title: productName,
    summary: "Are you looking for print run or checklist data?",
    followups: ["Print run", "Checklist"]
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

  const followups = buildPlayerFollowups(
    playerReq.playerName,
    fallbackYears,
    true,
    true
  );

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
  if (playerReq.code && playerReq.productName) {
    sectionLabel = playerReq.productName;
  } else if (playerReq.year) {
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
  if (mentionsRestrictedPrintRunBrand(query)) {
    return buildRestrictedBrandPrintRunResponse();
  }

  const product =
    findBestProduct(getPrintRunIndex(), query, "print_run") ||
    findBestProduct(getPrintRunIndex(), stripIntentWords(query), "print_run");

  pendingProductChoice = null;
  pendingChecklistChoice = null;
  pendingPlayerChoice = null;

  if (!product) {
    return {
      type: "standard",
      badge: "Print Run",
      title: "I could not match that set",
      summary: "Try using the year and product name, like 2026 Topps Series 1 print run."
    };
  }

  const rawRows = await getPrintRunData(product.code, product.sport);
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

  return {
  type: "prv",
  product,
  rawRows: rawRows,
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
  if (directSection) {
    return buildChecklistSectionResponse(directSection);
  }

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
  if (!pendingChecklistChoice || !pendingChecklistChoice.product) {
    return {
      type: "standard",
      badge: "Checklist",
      title: "Checklist selection expired",
      summary: "Search for a checklist again and I’ll load the section you want."
    };
  }

  const product = pendingChecklistChoice.product;
  const section = sectionKey || "all";

  let data;
  if (section === "parallels") {
    data = await getChecklistParallels(product.code);
  } else {
    data = await getChecklistSection(product.code, section);
  }

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

  if (isReleaseScheduleQuestion(query)) {
    return buildReleaseScheduleResponse(query);
  }

  if (isCatalogCoverageQuestion(query)) return buildAskSportResponse();
  if (isPricingQuestion(query)) return buildPricingResponse();
  if (isDataSourceQuestion(query)) return buildDataSourceResponse();

  const playerReq = detectPlayerSearchRequest(query);
  if (playerReq) {
    if (playerReq.mode === "player_product") {
      prefetchPlayerData(playerReq);
      return buildPlayerChecklistResponse(playerReq);
    }
    if (playerReq.mode === "player_year") {
      prefetchPlayerData(playerReq);
      return buildPlayerChecklistResponse(playerReq);
    }
    prefetchPlayerData(playerReq);
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

  if (matches.winner.code) {
    if (matches.winner.score >= 50) {
      prefetchChecklistData(matches.winner);
      prefetchPrintRunData(matches.winner);
    }
  }

  return buildClarifyProductTypeResponse(matches.winner.name, query);
}

async function buildResponse(query) {
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

  addUserMessage(val);
  if (chatInput) chatInput.value = "";

  const loader = startLoadingBubble([
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
      addPrvResultCard(res);
    } else if (res.type === "checklist_table") {
      addChecklistResultCard(res);
    } else if (res.type === "player_stats") {
      addPlayerStatsCard(res);
    } else if (res.type === "release_schedule") {
      addReleaseScheduleCard(res);
    } else {
      addStandardAnswerCard(res);
    }

    logEvent({
      app: "chat_demo",
      page: "fake_chatbot",
      event_type: "chat_query",
      query: val,
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

    addStandardAnswerCard({
      badge: "Error",
      title: "Something went wrong",
      summary: "The chat could not load data right now. Please try again."
    });
  }
}

/* ------------------ INIT ------------------ */

function initChat() {
  renderExamples();
requestAnimationFrame(() => window.CMChat.ui.addWelcomeMessage(true));
  
  bootstrapData().catch(err => console.warn("Bootstrap failed", err));

  setTimeout(() => {
    preloadPlayerDataInBackground();
    preloadReleaseScheduleInBackground();
  }, 0);

  window.CMChat.ui.initJumpNav();

  if (chatInput) chatInput.focus();
}

if (sendBtn) {
  sendBtn.onclick = () => submitQuery();
}

if (chatInput) {
  chatInput.onkeydown = e => {
    if (e.key === "Enter") submitQuery();
  };
}
