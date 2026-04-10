const CHECKLIST_EXEC_URL = "https://script.google.com/macros/s/AKfycbxVsOvACvcgwf8igVdlRcGVqTa0KciCO_w23GCHzVXp4dQrUE-4hx1Uut5o_KrCLXYL/exec";
const VAULT_EXEC_URL = "https://script.google.com/macros/s/AKfycbx_1rqxgSCu6aqDc7jEnETYC-KcNxHEf208GWXM23FR7hDT0ey8Y1SZ2i4U1VmXOZgpAg/exec";
const LOG_EXEC_URL = "https://script.google.com/macros/s/AKfycbyuTmGksD9ZF89Ij0VmnUeJqP0OcFL5qCe-MUjN0JonJ8QTlfpMsf0XRKZzCwLdFdiF/exec";

const CHECKLIST_BASE_URL = "/checklists/";
const VAULT_BASE_URL = "/vault/";

const CL_INDEX_KEY = "cm_chat_cl_index_v4";
const PRV_INDEX_KEY = "cm_chat_prv_index_v4";
const CL_INDEX_TS_KEY = "cm_chat_cl_index_ts_v4";
const PRV_INDEX_TS_KEY = "cm_chat_prv_index_ts_v4";
const INDEX_TTL_MS = 1000 * 60 * 30;

const EXAMPLES = [
  "Show me 2026 Topps Series 1 print run",
  "Find the checklist for 2025 Topps Chrome Football",
  "What baseball sets are trending?",
  "Find Roman Anthony cards"
];

const STOP_WORDS = new Set([
  "show","me","find","give","need","want","pull","get","for","the","a","an","of","to",
  "please","can","you","i","looking","look","up","tell","about","what","whats","what's",
  "is","are","my","some","data","info","information","on","do","have","in","your","database"
]);

const INTENT_PRINT_RUN_WORDS = [
  "print run","print-run","copies","production","produced","how many copies","run size","estimated print run"
];

const INTENT_CHECKLIST_WORDS = [
  "checklist","check list","cards in set","full set","set checklist"
];

const INTENT_TRENDING_WORDS = [
  "trending","popular","hot","top searched","most searched"
];

const SPORT_WORDS = ["baseball","basketball","football","soccer","hockey"];

const NON_TOPPS_PRINTRUN_BRANDS = [
  "panini","donruss","score","leaf","wild card","wildcard","upper deck","fleer"
];

const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");
const examplePills = document.getElementById("examplePills");

let checklistIndex = [];
let printRunIndex = [];
let bootPromise = null;
let awaitingCatalogSport = false;

/* ------------------ UTIL ------------------ */

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\w\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function titleCase(str) {
  return String(str || "").replace(/\b\w/g, c => c.toUpperCase());
}

function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function tokenize(text) {
  return normalize(text)
    .split(" ")
    .map(t => t.trim())
    .filter(Boolean);
}

function meaningfulTokens(text) {
  return tokenize(text).filter(t => !STOP_WORDS.has(t) && t.length > 1);
}

function extractYear(text) {
  const m = String(text || "").match(/\b(19|20)\d{2}(?:-\d{2})?\b/);
  return m ? m[0] : "";
}

function extractSport(text) {
  const n = normalize(text);
  return SPORT_WORDS.find(s => n.includes(s)) || "";
}

function stripIntentWords(text) {
  let out = normalize(text);

  [
    "show me",
    "find me",
    "give me",
    "tell me",
    "i want",
    "i need",
    "can you",
    "please",
    "print run",
    "print-run",
    "checklist",
    "check list",
    "what baseball sets are trending",
    "what sets are trending",
    "trending"
  ].forEach(p => {
    out = out.replace(new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), " ");
  });

  return out.replace(/\s+/g, " ").trim();
}

function includesAny(haystack, needles) {
  const h = normalize(haystack);
  return needles.some(n => h.includes(normalize(n)));
}

function formatNumber(val) {
  if (val === null || val === undefined || val === "") return "";
  const n = Number(String(val).replace(/,/g, ""));
  if (Number.isFinite(n)) return n.toLocaleString("en-US");
  return String(val);
}

function isOnlySportReply(text) {
  const n = normalize(text);
  return SPORT_WORDS.includes(n);
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

function getAllProductsForSport(sport) {
  const s = normalize(sport);
  const items = [];

  checklistIndex.forEach(item => {
    const p = mapProduct(item);
    if (normalize(p.sport) === s) items.push(p);
  });

  printRunIndex.forEach(item => {
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

function getSampleCurrentSetsForSport(sport, limit = 10) {
  const s = normalize(sport);
  const latestYears = getLatestYearsForSport(s);
  const latestYear = latestYears[0] || "";

  const seen = new Set();
  const results = [];

  [...checklistIndex, ...printRunIndex].forEach(item => {
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

/* ------------------ UI ------------------ */

function renderExamples() {
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
  scroll();
}

function addAssistantBubble(text) {
  chatMessages.innerHTML += `
    <div class="message-row assistant">
      <div class="message-bubble">${escapeHtml(text)}</div>
    </div>
  `;
  scroll();
}

function addWelcomeMessage() {
  const hasSeenWelcome = sessionStorage.getItem("cm_chat_welcome_seen_v1");
  if (hasSeenWelcome) return;

  addStandardAnswerCard({
    badge: "Welcome",
    title: "Welcome to Chasing Majors Chat",
    summary:
      "If you are looking for print run data, checklist search, limited player lookups, and Universal POP data, you are in the right place. For the best experience, include the sport and year in your search.",
    followups: [
      "Show me 2026 Topps Series 1 print run",
      "Find the checklist for 2025 Topps Chrome Football",
      "What sets do you have?"
    ]
  });

  sessionStorage.setItem("cm_chat_welcome_seen_v1", "1");
}

function startLoadingBubble(messages, intervalMs = 1000) {
  const id = `loading_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const safeMessages = Array.isArray(messages) && messages.length
    ? messages
    : ["Thinking..."];

  chatMessages.innerHTML += `
    <div class="message-row assistant" id="${id}">
      <div class="message-bubble" data-loading-bubble>${escapeHtml(safeMessages[0])}</div>
    </div>
  `;
  scroll();

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
  }, 800);

  return {
    remove() {
      if (delayedStart) clearTimeout(delayedStart);
      if (timer) clearInterval(timer);
      if (row && row.parentNode) row.parentNode.removeChild(row);
    }
  };
}

function addStandardAnswerCard(r) {
  const metaHtml = (r.metadata || []).length
    ? `<div class="answer-meta">${(r.metadata || []).map(m => `<div class="answer-meta-chip">${escapeHtml(m)}</div>`).join("")}</div>`
    : "";

  const actionsHtml = (r.actions || []).length
    ? `<div class="answer-actions">${(r.actions || []).map(a => {
        const cls = a.secondary ? "answer-action secondary" : "answer-action";
        return `<a class="${cls}" href="${escapeHtml(a.href)}">${escapeHtml(a.label)}</a>`;
      }).join("")}</div>`
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

  chatMessages.innerHTML += `
    <div class="message-row assistant">
      <div class="answer-card">
        <div class="answer-badge">${escapeHtml(r.badge || "Answer")}</div>
        <div class="answer-title">${escapeHtml(r.title || "Result")}</div>
        <div class="answer-summary">${escapeHtml(r.summary || "")}</div>
        ${metaHtml}
        ${actionsHtml}
        ${followupsHtml}
      </div>
    </div>
  `;

  bindFollowups();
  scroll();
}

function addPrvResultCard(result) {
  const product = result.product || {};
  const rows = result.rows || [];
  const chips = result.metadata || [];
  const followups = result.followups || [];
  const initialRows = rows.slice(0, 8);
  const hasMore = rows.length > 8;

  const buildRowsHtml = (list) => list.map(r => `
    <tr class="prv-chat-tr">
      <td class="prv-chat-td prv-chat-td-left">
        <div class="prv-chat-cell-main">${escapeHtml(r.label || "")}</div>
        ${r.sub ? `<div class="prv-chat-cell-sub">${escapeHtml(r.sub)}</div>` : ""}
      </td>
      <td class="prv-chat-td prv-chat-td-right">${escapeHtml(r.value || "")}</td>
    </tr>
  `).join("");

  const chipsHtml = chips.length
    ? `<div class="prv-chat-chips">${chips.map(c => `<div class="prv-chat-chip">${escapeHtml(c)}</div>`).join("")}</div>`
    : "";

  const actionsHtml = `
    <div class="answer-actions">
      <a class="answer-action" href="${escapeHtml(`${VAULT_BASE_URL}?q=${encodeURIComponent(product.name || product.code || "")}`)}">Open Print Run Vault</a>
      <a class="answer-action secondary" href="${escapeHtml(`${CHECKLIST_BASE_URL}?q=${encodeURIComponent(product.name || product.code || "")}`)}">Open Checklist Vault</a>
    </div>
  `;

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
              </tr>
            </thead>
            <tbody data-prv-body>
              ${buildRowsHtml(initialRows)}
            </tbody>
          </table>
        </div>

        ${hasMore ? `
          <div class="prv-chat-more">
            <button class="prv-chat-more-btn" type="button" data-prv-expand="false">
              Show ${rows.length - initialRows.length} More Rows
            </button>
          </div>
        ` : ""}

        ${actionsHtml}
        ${followupsHtml}
      </div>
    </div>
  `;

  const card = document.getElementById(cardId);

  if (card) {
    const body = card.querySelector("[data-prv-body]");
    const toggleBtn = card.querySelector("[data-prv-expand]");

    if (toggleBtn && body) {
      toggleBtn.onclick = () => {
        const expanded = toggleBtn.getAttribute("data-prv-expand") === "true";

        if (!expanded) {
          body.innerHTML = buildRowsHtml(rows);
          toggleBtn.setAttribute("data-prv-expand", "true");
          toggleBtn.textContent = "Show Less";
        } else {
          body.innerHTML = buildRowsHtml(initialRows);
          toggleBtn.setAttribute("data-prv-expand", "false");
          toggleBtn.textContent = `Show ${rows.length - initialRows.length} More Rows`;
          card.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      };
    }
  }

  bindFollowups();
  scroll();
}

function bindFollowups() {
  chatMessages.querySelectorAll("[data-followup]").forEach(btn => {
    btn.onclick = () => submitQuery(btn.dataset.followup);
  });
}

function scroll() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

/* ------------------ CACHE ------------------ */

function getCached(key, tsKey) {
  try {
    const raw = localStorage.getItem(key);
    const ts = +localStorage.getItem(tsKey);
    if (!raw || !ts || Date.now() - ts > INDEX_TTL_MS) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setCached(key, tsKey, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
    localStorage.setItem(tsKey, String(Date.now()));
  } catch (err) {
    console.warn("Cache write failed", err);
  }
}

/* ------------------ API ------------------ */

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body || {})
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function logEvent(payload) {
  try {
    await postJson(LOG_EXEC_URL, {
      action: "logEvent",
      payload: payload || {}
    });
  } catch (err) {
    console.warn("Log failed", err);
  }
}

async function getPrintRunData(code, sport) {
  try {
    const data = await postJson(VAULT_EXEC_URL, {
      action: "getRowsByCode",
      payload: { code, sport }
    });
    return Array.isArray(data?.rows) ? data.rows : [];
  } catch (err) {
    console.warn("getPrintRunData failed", err);
    return [];
  }
}

async function getHomeFeed() {
  try {
    const res = await fetch(`${LOG_EXEC_URL}?action=getHomeFeed`);
    const data = await res.json();
    return Array.isArray(data?.rows) ? data.rows : [];
  } catch (err) {
    console.warn("getHomeFeed failed", err);
    return [];
  }
}

/* ------------------ INDEX LOAD ------------------ */

async function loadChecklistIndex() {
  const cached = getCached(CL_INDEX_KEY, CL_INDEX_TS_KEY);
  if (cached) {
    checklistIndex = cached;
    return checklistIndex;
  }

  const data = await postJson(CHECKLIST_EXEC_URL, { action: "index" });
  checklistIndex = Array.isArray(data?.index) ? data.index : [];
  setCached(CL_INDEX_KEY, CL_INDEX_TS_KEY, checklistIndex);
  return checklistIndex;
}

async function loadPrintRunIndex() {
  const cached = getCached(PRV_INDEX_KEY, PRV_INDEX_TS_KEY);
  if (cached) {
    printRunIndex = cached;
    return printRunIndex;
  }

  const data = await postJson(VAULT_EXEC_URL, { action: "index" });
  printRunIndex = Array.isArray(data?.index) ? data.index : (Array.isArray(data?.products) ? data.products : []);
  setCached(PRV_INDEX_KEY, PRV_INDEX_TS_KEY, printRunIndex);
  return printRunIndex;
}

async function bootstrapData() {
  if (!bootPromise) {
    bootPromise = Promise.all([
      loadChecklistIndex(),
      loadPrintRunIndex()
    ]);
  }
  return bootPromise;
}

/* ------------------ INDEX HELPERS ------------------ */

function mapProduct(item) {
  const name = item.DisplayName || item.displayName || item.name || "";
  const keywords = item.Keywords || item.keywords || "";
  const code = item.Code || item.code || "";
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

  if (qNorm.includes(nameNorm)) score += 120;
  if (cleanedNorm && nameNorm.includes(cleanedNorm)) score += 60;
  if (cleanedNorm && product.haystack.includes(cleanedNorm)) score += 50;
  if (codeNorm && qNorm.includes(codeNorm)) score += 80;

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

  if (qTokens.length && overlap === 0 && !qNorm.includes(nameNorm)) score -= 25;

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

/* ------------------ INTENT ------------------ */

function detectIntent(q) {
  const n = normalize(q);

  if (includesAny(n, INTENT_PRINT_RUN_WORDS)) return "print_run";
  if (includesAny(n, INTENT_CHECKLIST_WORDS)) return "checklist";
  if (includesAny(n, INTENT_TRENDING_WORDS)) return "trending";
  return "search";
}

/* ------------------ FORMATTERS ------------------ */

function buildPrvRows(rows) {
  return rows.slice(0, 12).map(r => {
    const setType = r.setType || "";
    const setLine = r.setLine || "";
    const label = [setType, setLine].filter(Boolean).join(" ").trim() || "Row";
    const value = formatNumber(r.printRun || "");
    const subset = r.subSetSize ? `Subset size: ${formatNumber(r.subSetSize)}` : "";
    return {
      label,
      value,
      sub: subset
    };
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

/* ------------------ RESPONSES ------------------ */

async function buildTrendingResponse() {
  const rows = await getHomeFeed();

  const trendingChecklistRows = rows.filter(r => r[0] === "trending_checklists").slice(0, 3);
  const trendingVaultRows = rows.filter(r => r[0] === "trending_print_runs").slice(0, 3);

  const chunks = [];

  if (trendingChecklistRows.length) {
    chunks.push(`Checklist trending: ${trendingChecklistRows.map(r => r[2]).join(" • ")}`);
  }

  if (trendingVaultRows.length) {
    chunks.push(`Print run trending: ${trendingVaultRows.map(r => r[2]).join(" • ")}`);
  }

  return {
    type: "standard",
    badge: "Trending",
    title: "What collectors are searching right now",
    summary: chunks.length ? chunks.join(" | ") : "No trending data is available yet.",
    followups: [
      "Show me 2026 Topps Series 1 print run",
      "Find the checklist for 2025 Topps Chrome Football"
    ]
  };
}

function buildRestrictedBrandPrintRunResponse() {
  return {
    type: "standard",
    badge: "Print Run",
    title: "Topps products only",
    summary: "Due to limited and unreliable pack odds data, print run search is currently available only for Topps products.",
    followups: [
      "Show me 2026 Topps Series 1 print run",
      "Show me 2026 Bowman Baseball print run",
      "Find the checklist for 2025 Panini Prizm Football"
    ]
  };
}

function buildAskSportResponse() {
  awaitingCatalogSport = true;
  return {
    type: "standard",
    badge: "Database",
    title: "Which sport are you looking for?",
    summary: "Choose one: baseball, football, basketball, hockey, or soccer.",
    followups: [
      "Baseball",
      "Football",
      "Basketball",
      "Hockey",
      "Soccer"
    ]
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
    summary: `We have hundreds of ${sport} sets in the database. The most current year I found is ${latestYear}.${sampleSets.length ? ` Here are a few examples: ${sampleSets.join(" • ")}` : ""}`,
    followups: [
      `Show me ${latestYear} ${titleCase(sport)} print run`,
      `Find the checklist for ${latestYear} ${titleCase(sport)}`,
      `What ${sport} sets are trending?`
    ]
  };
}

async function buildPrintRunResponse(query) {
  if (mentionsRestrictedPrintRunBrand(query)) {
    return buildRestrictedBrandPrintRunResponse();
  }

  const product =
    findBestProduct(printRunIndex, query, "print_run") ||
    findBestProduct(printRunIndex, stripIntentWords(query), "print_run");

  if (!product) {
    return {
      type: "standard",
      badge: "Print Run",
      title: "I could not match that set",
      summary: "Try using the year and product name, like 2026 Topps Series 1 print run.",
      followups: [
        "Show me 2026 Topps Series 1 print run",
        "Show me 2026 Bowman Baseball print run",
        "Show me 2025 Topps Chrome Football print run"
      ]
    };
  }

  const rows = await getPrintRunData(product.code, product.sport);

  if (!rows.length) {
    return {
      type: "standard",
      badge: "Print Run",
      title: product.name,
      summary: "I found the product in the vault index, but no print run rows were returned yet.",
      metadata: uniq([
        product.year ? `Year: ${product.year}` : "",
        product.sport ? `Sport: ${titleCase(product.sport)}` : "",
        product.code ? `Code: ${product.code}` : ""
      ]),
      actions: [
        { label: "Open Print Run Vault", href: `${VAULT_BASE_URL}?q=${encodeURIComponent(product.name || product.code || "")}` },
        { label: "Open Checklist Vault", href: `${CHECKLIST_BASE_URL}?q=${encodeURIComponent(product.name || product.code || "")}`, secondary: true }
      ],
      followups: [
        `Find the checklist for ${product.name}`,
        `Show me more details for ${product.name}`
      ]
    };
  }

  return {
    type: "prv",
    product,
    rows: buildPrvRows(rows),
    metadata: buildPrvMetadata(product, rows),
    followups: [
      `Find the checklist for ${product.name}`,
      `Show me ${product.name} print run`,
      `What parallels are in ${product.name}`
    ]
  };
}

async function buildChecklistResponse(query) {
  const product =
    findBestProduct(checklistIndex, query, "checklist") ||
    findBestProduct(checklistIndex, stripIntentWords(query), "checklist");

  if (!product) {
    return {
      type: "standard",
      badge: "Checklist",
      title: "I could not match that checklist",
      summary: "Try using the year and set name, like 2025 Topps Chrome Football checklist.",
      followups: [
        "Find the checklist for 2025 Topps Chrome Football",
        "Find the checklist for 2026 Topps Series 1",
        "Find Roman Anthony cards"
      ]
    };
  }

  return {
    type: "standard",
    badge: "Checklist",
    title: product.name,
    summary: "I found a matching checklist. Open it in Checklist Vault for the full card list, sections, and parallels.",
    metadata: uniq([
      product.year ? `Year: ${product.year}` : "",
      product.sport ? `Sport: ${titleCase(product.sport)}` : "",
      product.code ? `Code: ${product.code}` : ""
    ]),
    actions: [
      { label: "Open Checklist Vault", href: `${CHECKLIST_BASE_URL}?q=${encodeURIComponent(product.name || product.code || "")}` },
      { label: "Open Print Run Vault", href: `${VAULT_BASE_URL}?q=${encodeURIComponent(product.name || product.code || "")}`, secondary: true }
    ],
    followups: [
      `Show me ${product.name} print run`,
      `What parallels are in ${product.name}`
    ]
  };
}

async function buildSearchResponse(query) {
  if (isCatalogCoverageQuestion(query)) {
    return buildAskSportResponse();
  }

  const cl = findBestProduct(checklistIndex, query, "checklist");
  const prv = findBestProduct(printRunIndex, query, "print_run");

  const winner = [cl, prv]
    .filter(Boolean)
    .sort((a, b) => (b.score || 0) - (a.score || 0))[0];

  if (!winner) {
    return {
      type: "standard",
      badge: "Try",
      title: "Try another search",
      summary: "Ask for a print run, checklist, trending set, or a player/set search.",
      followups: [
        "Show me 2026 Topps Series 1 print run",
        "Find the checklist for 2025 Topps Chrome Football",
        "What baseball sets are trending?"
      ]
    };
  }

  return {
    type: "standard",
    badge: "Match",
    title: winner.name,
    summary: "I found a likely product match. Choose a vault below.",
    metadata: uniq([
      winner.year ? `Year: ${winner.year}` : "",
      winner.sport ? `Sport: ${titleCase(winner.sport)}` : "",
      winner.code ? `Code: ${winner.code}` : ""
    ]),
    actions: [
      { label: "Open Checklist Vault", href: `${CHECKLIST_BASE_URL}?q=${encodeURIComponent(winner.name || winner.code || "")}` },
      { label: "Open Print Run Vault", href: `${VAULT_BASE_URL}?q=${encodeURIComponent(winner.name || winner.code || "")}`, secondary: true }
    ],
    followups: [
      `Show me ${winner.name} print run`,
      `Find the checklist for ${winner.name}`
    ]
  };
}

async function buildResponse(query) {
  if (awaitingCatalogSport && isOnlySportReply(query)) {
    return buildCatalogSportResponse(normalize(query));
  }

  const intent = detectIntent(query);

  if (intent === "trending") return buildTrendingResponse();
  if (intent === "print_run") return buildPrintRunResponse(query);
  if (intent === "checklist") return buildChecklistResponse(query);

  return buildSearchResponse(query);
}

/* ------------------ MAIN ------------------ */

async function submitQuery(text) {
  const val = String(text || chatInput.value || "").trim();
  if (!val) return;

  addUserMessage(val);
  chatInput.value = "";

  const loader = startLoadingBubble([
    "Thinking...",
    "Finding match...",
    "Pulling Chasing Majors data...",
    "Formatting results..."
  ], 1000);

  try {
    await bootstrapData();
    const res = await buildResponse(val);

    loader.remove();

    if (res.type === "prv") {
      addPrvResultCard(res);
    } else {
      addStandardAnswerCard(res);
    }

    logEvent({
      app: "chat_demo",
      page: "fake_chatbot",
      event_type: "chat_query",
      query: val,
      selected_name: res.product?.name || res.title || "",
      selected_type: res.type === "prv" ? "Print Run" : (res.badge || ""),
      route_target: res.type === "prv" ? "vault" : ""
    });
  } catch (err) {
    console.error(err);

    loader.remove();

    addStandardAnswerCard({
      badge: "Error",
      title: "Something went wrong",
      summary: "The chat could not load data right now. Please try again.",
      followups: [
        "Show me 2026 Topps Series 1 print run",
        "Find the checklist for 2025 Topps Chrome Football"
      ]
    });
  }
}

/* ------------------ INIT ------------------ */

sendBtn.onclick = () => submitQuery();
chatInput.onkeydown = e => {
  if (e.key === "Enter") submitQuery();
};

renderExamples();
bootstrapData().then(() => {
  addWelcomeMessage();
});
chatInput.focus();
