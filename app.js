const CHECKLIST_EXEC_URL = "https://script.google.com/macros/s/AKfycbxl2JnZGnEtmUes6UXjz6upyEd6tj20yMeX1X0bnseKo1ISaBHjWILVrp9ZyYqk-rpE_w/exec";
const VAULT_EXEC_URL = "https://script.google.com/macros/s/AKfycbx_1rqxgSCu6aqDc7jEnETYC-KcNxHEf208GWXM23FR7hDT0ey8Y1SZ2i4U1VmXOZgpAg/exec";
const LOG_EXEC_URL = "https://script.google.com/macros/s/AKfycbyuTmGksD9ZF89Ij0VmnUeJqP0OcFL5qCe-MUjN0JonJ8QTlfpMsf0XRKZzCwLdFdiF/exec";

const CHECKLIST_BASE_URL = "/checklists/";
const VAULT_BASE_URL = "/vault/";

const CL_INDEX_KEY = "cm_chat_cl_index_v9";
const PRV_INDEX_KEY = "cm_chat_prv_index_v9";
const CL_INDEX_TS_KEY = "cm_chat_cl_index_ts_v9";
const PRV_INDEX_TS_KEY = "cm_chat_prv_index_ts_v9";
const INDEX_TTL_MS = 1000 * 60 * 30;

const EXAMPLES = [
  "Show me 2026 Topps Series 1 print run",
  "Show me the 2026 Topps Chrome Black baseball checklist",
  "What baseball sets are trending?",
  "Find Roman Anthony cards"
];

const STOP_WORDS = new Set([
  "show","me","find","give","need","want","pull","get","for","the","a","an","of","to",
  "please","can","you","i","looking","look","up","tell","about","what","whats","what's",
  "is","are","my","some","data","info","information","on","do","have","in","your","database",
  "how","about","see"
]);

const INTENT_PRINT_RUN_WORDS = [
  "print run","print-run","copies","production","produced","how many copies","run size","estimated print run"
];

const INTENT_CHECKLIST_WORDS = [
  "checklist","check list","cards in set","full set","entire checklist","base checklist","insert checklist","autograph checklist","auto checklist","relic checklist","variation checklist","parallel checklist","parallels"
];

const INTENT_TRENDING_WORDS = [
  "trending","popular","hot","top searched","most searched"
];

const SPORT_WORDS = ["baseball","basketball","football","soccer","hockey"];

const NON_TOPPS_PRINTRUN_BRANDS = [
  "panini","donruss","score","leaf","wild card","wildcard","upper deck","fleer"
];

const CHECKLIST_SECTION_LABELS = {
  all: "Entire Checklist",
  base: "Base",
  inserts: "Inserts",
  autographs: "Autographs",
  relics: "Relics",
  variations: "Variations",
  parallels: "Parallels"
};

const ALL_CHECKLIST_SECTION_KEYS = ["all", "base", "inserts", "autographs", "relics", "variations", "parallels"];

const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");
const examplePills = document.getElementById("examplePills");

let checklistIndex = [];
let printRunIndex = [];
let bootPromise = null;
let awaitingCatalogSport = false;
let pendingProductChoice = null;
let pendingChecklistChoice = null;

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
    "trending",
    "how about",
    "entire checklist"
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
  return SPORT_WORDS.includes(normalize(text));
}

function isOnlyPrintRunReply(text) {
  const n = normalize(text);
  return n === "print run" || n === "printrun" || n === "print-run";
}

function isOnlyChecklistReply(text) {
  const n = normalize(text);
  return n === "checklist" || n === "check list";
}

function isChecklistSectionReply(text) {
  const n = normalize(text);
  return Object.keys(CHECKLIST_SECTION_LABELS).includes(n) ||
    Object.values(CHECKLIST_SECTION_LABELS).map(normalize).includes(n);
}

function resolveChecklistSection(text) {
  const n = normalize(text);
  if (Object.keys(CHECKLIST_SECTION_LABELS).includes(n)) return n;
  for (const [key, label] of Object.entries(CHECKLIST_SECTION_LABELS)) {
    if (normalize(label) === n) return key;
  }
  return null;
}

function detectChecklistSectionIntent(query) {
  const n = normalize(query);

  if (/\bparallels?\b/.test(n)) return "parallels";
  if (/\bautographs?\b/.test(n) || /\bautos?\b/.test(n) || /\bauto\b/.test(n)) return "autographs";
  if (/\brelics?\b/.test(n)) return "relics";
  if (/\bvariations?\b/.test(n)) return "variations";
  if (/\binserts?\b/.test(n)) return "inserts";
  if (/\bbase\b/.test(n)) return "base";
  if (/\bentire checklist\b/.test(n) || /\bfull checklist\b/.test(n)) return "all";

  return null;
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

function getSampleCurrentSetsForSport(sport, limit = 8) {
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
  if (!examplePills) return;

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

  chatMessages.innerHTML += `
    <div class="message-row assistant">
      <div class="answer-card">
        <div class="answer-badge">${escapeHtml(r.badge || "Answer")}</div>
        <div class="answer-title">${escapeHtml(r.title || "Result")}</div>
        <div class="answer-summary">${escapeHtml(r.summary || "")}</div>
        ${metaHtml}
        ${followupsHtml}
      </div>
    </div>
  `;

  bindFollowups();
  scroll();
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
        <div class="answer-summary">If you are looking for print run data, checklist search, limited player lookups, and Universal POP data, you are in the right place. For the best experience, include the sport and year in your search.</div>
      </div>
    </div>
  ` + chatMessages.innerHTML;

  scroll();
}

function startLoadingBubble(messages, intervalMs = 2000) {
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

  const buildRowsHtml = (list) => list.map(r => `
    <tr class="prv-chat-tr">
      <td class="prv-chat-td prv-chat-td-left">
        <div class="prv-chat-cell-main">${escapeHtml(r.label || "")}</div>
      </td>
      <td class="prv-chat-td prv-chat-td-right">${escapeHtml(r.value || "")}</td>
      <td class="prv-chat-td prv-chat-td-setsize">${escapeHtml(r.setSize || "")}</td>
    </tr>
  `).join("");

  const chipsHtml = chips.length
    ? `<div class="prv-chat-chips">${chips.map(c => `<div class="prv-chat-chip">${escapeHtml(c)}</div>`).join("")}</div>`
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
      };
    }
  }

  bindFollowups();
  scroll();
}

function addChecklistResultCard(result) {
  const product = result.product || {};
  const rows = result.rows || [];
  const chips = result.metadata || [];
  const followups = result.followups || [];
  const sectionLabel = result.sectionLabel || "Checklist";

  const headers = result.columns || ["Subset", "Card No.", "Player", "Team", "Tag"];
  const headHtml = headers.map(h => `<th>${escapeHtml(h)}</th>`).join("");

  const bodyHtml = rows.map(row => `
    <tr class="prv-chat-tr">
      ${(row.cells || []).map((cell, idx) => `
        <td class="prv-chat-td ${idx === row.cells.length - 1 ? "prv-chat-td-checklist-last" : ""}">
          <div class="prv-chat-cell-main">${escapeHtml(cell || "")}</div>
        </td>
      `).join("")}
    </tr>
  `).join("");

  const chipsHtml = chips.length
    ? `<div class="prv-chat-chips">${chips.map(c => `<div class="prv-chat-chip">${escapeHtml(c)}</div>`).join("")}</div>`
    : "";

  const sectionOptions = (result.sectionOptions || [])
    .map(opt => `<button class="followup-btn" data-followup="${escapeHtml(opt)}">${escapeHtml(opt)}</button>`)
    .join("");

  chatMessages.innerHTML += `
    <div class="message-row assistant">
      <div class="prv-chat-card">
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

async function getChecklistSummary(code) {
  const data = await postJson(CHECKLIST_EXEC_URL, {
    action: "checklist_summary",
    code
  });
  return data || {};
}

async function getChecklistSection(code, section) {
  const data = await postJson(CHECKLIST_EXEC_URL, {
    action: "checklist_section",
    code,
    section
  });
  return data || {};
}

async function getChecklistParallels(code) {
  const data = await postJson(CHECKLIST_EXEC_URL, {
    action: "parallels",
    code
  });
  return data || {};
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

function getCombinedBestMatches(query) {
  const cl = findBestProduct(checklistIndex, query, "checklist");
  const prv = findBestProduct(printRunIndex, query, "print_run");
  const options = [cl, prv].filter(Boolean).sort((a, b) => (b.score || 0) - (a.score || 0));

  return {
    checklist: cl,
    printRun: prv,
    winner: options[0] || null
  };
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
  return rows.map(r => {
    const setType = r.setType || "";
    const setLine = r.setLine || "";
    const label = [setType, setLine].filter(Boolean).join(" ").trim() || "Row";
    const value = formatNumber(r.printRun || "");
    const setSize = formatNumber(r.subSetSize || "");
    return { label, value, setSize };
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
  const available = Array.isArray(summary?.available_sections) ? summary.available_sections : ["all"];
  return available
    .map(key => CHECKLIST_SECTION_LABELS[key])
    .filter(Boolean);
}

function formatChecklistTable(sectionKey, data) {
  const section = normalize(sectionKey);

  if (section === "parallels") {
    return {
      columns: data.columns || ["Applies To", "Parallel", "Serial No."],
      rows: (data.rows || []).map(r => ({
        cells: Array.isArray(r) ? r : [r.applies_to || "", r.parallel_name || "", r.serial_no || ""]
      }))
    };
  }

  return {
    columns: data.columns || ["Subset", "Card No.", "Player", "Team", "Tag"],
    rows: (data.rows || []).map(r => ({
      cells: Array.isArray(r) ? r : [r.subset || "", r.card_no || "", r.player || "", r.team || "", r.tag || ""]
    }))
  };
}

/* ------------------ RESPONSES ------------------ */

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

function buildClarifyProductTypeResponse(productName, query) {
  pendingProductChoice = { query, productName };
  pendingChecklistChoice = null;

  return {
    type: "standard",
    badge: "Clarify",
    title: productName,
    summary: "Are you looking for print run or checklist data?",
    followups: ["Print run", "Checklist"]
  };
}

async function buildPrintRunResponse(query) {
  if (mentionsRestrictedPrintRunBrand(query)) {
    return buildRestrictedBrandPrintRunResponse();
  }

  const product =
    findBestProduct(printRunIndex, query, "print_run") ||
    findBestProduct(printRunIndex, stripIntentWords(query), "print_run");

  pendingProductChoice = null;
  pendingChecklistChoice = null;

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
    findBestProduct(checklistIndex, query, "checklist") ||
    findBestProduct(checklistIndex, stripIntentWords(query), "checklist");

  pendingProductChoice = null;

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
    sectionOptions: checklistSectionOptionsFromSummary(pendingChecklistChoice.summary),
    followups: [
      `Show me ${product.name} print run`
    ]
  };
}

async function buildSearchResponse(query) {
  if (isCatalogCoverageQuestion(query)) return buildAskSportResponse();
  if (isPricingQuestion(query)) return buildPricingResponse();
  if (isDataSourceQuestion(query)) return buildDataSourceResponse();

  const matches = getCombinedBestMatches(query);

  if (!matches.winner) {
    pendingProductChoice = null;
    pendingChecklistChoice = null;

    return {
      type: "standard",
      badge: "Try",
      title: "Try another search",
      summary: "Ask for a print run, checklist, trending set, pricing, or a player/set search."
    };
  }

  return buildClarifyProductTypeResponse(matches.winner.name, query);
}

async function buildResponse(query) {
  if (awaitingCatalogSport && isOnlySportReply(query)) {
    return buildCatalogSportResponse(normalize(query));
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

  if (isPricingQuestion(query)) return buildPricingResponse();
  if (isDataSourceQuestion(query)) return buildDataSourceResponse();

  const intent = detectIntent(query);

  if (intent === "trending") return buildTrendingResponse();
  if (intent === "print_run") return buildPrintRunResponse(query);
  if (intent === "checklist") return buildChecklistSummaryResponse(query);

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
  ], 2000);

  try {
    await bootstrapData();
    const res = await buildResponse(val);

    loader.remove();

    if (res.type === "prv") {
      addPrvResultCard(res);
    } else if (res.type === "checklist_table") {
      addChecklistResultCard(res);
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
        (res.badge || ""),
      route_target:
        res.type === "prv" ? "vault" :
        res.type === "checklist_table" ? "checklists" : ""
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
  requestAnimationFrame(() => addWelcomeMessage(true));
  bootstrapData();
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
