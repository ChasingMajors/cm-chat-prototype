const CHECKLIST_EXEC_URL = "https://script.google.com/macros/s/AKfycbxVsOvACvcgwf8igVdlRcGVqTa0KciCO_w23GCHzVXp4dQrUE-4hx1Uut5o_KrCLXYL/exec";
const VAULT_EXEC_URL = "https://script.google.com/macros/s/AKfycbx_1rqxgSCu6aqDc7jEnETYC-KcNxHEf208GWXM23FR7hDT0ey8Y1SZ2i4U1VmXOZgpAg/exec";
const LOG_EXEC_URL = "https://script.google.com/macros/s/AKfycbyuTmGksD9ZF89Ij0VmnUeJqP0OcFL5qCe-MUjN0JonJ8QTlfpMsf0XRKZzCwLdFdiF/exec";

const CL_INDEX_KEY = "cm_chat_cl_index_v1";
const PRV_INDEX_KEY = "cm_chat_prv_index_v1";
const CL_INDEX_TS_KEY = "cm_chat_cl_index_ts_v1";
const PRV_INDEX_TS_KEY = "cm_chat_prv_index_ts_v1";
const INDEX_TTL_MS = 1000 * 60 * 30;

const EXAMPLES = [
  "Show me 2026 Topps Series 1 print run",
  "Find the checklist for 2025 Topps Chrome Football",
  "What baseball sets are trending?",
  "Find Roman Anthony cards"
];

const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");
const examplePills = document.getElementById("examplePills");

let checklistIndex = [];
let printRunIndex = [];
let bootPromise = null;

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\w\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function includesAny(haystack, needles) {
  return needles.some((n) => haystack.includes(normalize(n)));
}

function renderExamples() {
  examplePills.innerHTML = EXAMPLES.map((example) => {
    return `<button class="example-pill" type="button" data-example="${escapeHtml(example)}">${escapeHtml(example)}</button>`;
  }).join("");

  examplePills.querySelectorAll("[data-example]").forEach((btn) => {
    btn.addEventListener("click", function () {
      submitQuery(btn.getAttribute("data-example") || "");
    });
  });
}

function scrollMessages() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addUserMessage(text) {
  const row = document.createElement("div");
  row.className = "message-row user";
  row.innerHTML = `<div class="message-bubble">${escapeHtml(text)}</div>`;
  chatMessages.appendChild(row);
  scrollMessages();
}

function addAssistantBubble(text) {
  const row = document.createElement("div");
  row.className = "message-row assistant";
  row.innerHTML = `<div class="message-bubble">${escapeHtml(text)}</div>`;
  chatMessages.appendChild(row);
  scrollMessages();
  return row;
}

function addThinkingBubble() {
  const row = document.createElement("div");
  row.className = "message-row assistant";
  row.innerHTML = `<div class="message-bubble">Thinking...</div>`;
  chatMessages.appendChild(row);
  scrollMessages();
  return row;
}

function removeNode(node) {
  if (node && node.parentNode) {
    node.parentNode.removeChild(node);
  }
}

function addAnswerCard(response) {
  const row = document.createElement("div");
  row.className = "message-row assistant";

  const metaHtml = (response.metadata || []).length
    ? `
      <div class="answer-meta">
        ${(response.metadata || []).map((item) => `<div class="answer-meta-chip">${escapeHtml(item)}</div>`).join("")}
      </div>
    `
    : "";

  const actionsHtml = (response.actions || []).length
    ? `
      <div class="answer-actions">
        ${(response.actions || []).map((action) => `
          <a class="answer-action ${action.primary ? "" : "secondary"}" href="${escapeHtml(action.href || "#")}">
            ${escapeHtml(action.label)}
          </a>
        `).join("")}
      </div>
    `
    : "";

  const followUpsHtml = (response.followUps || []).length
    ? `
      <div class="answer-followups">
        <div class="followup-label">Suggested follow-ups</div>
        <div class="followup-list">
          ${(response.followUps || []).map((item) => `
            <button class="followup-btn" type="button" data-followup="${escapeHtml(item)}">${escapeHtml(item)}</button>
          `).join("")}
        </div>
      </div>
    `
    : "";

  row.innerHTML = `
    <div class="answer-card">
      <div class="answer-badge">${escapeHtml(response.badge || "Answer")}</div>
      <div class="answer-title">${escapeHtml(response.title || "")}</div>
      <div class="answer-summary">${escapeHtml(response.summary || "")}</div>
      ${metaHtml}
      ${actionsHtml}
      ${followUpsHtml}
    </div>
  `;

  chatMessages.appendChild(row);

  row.querySelectorAll("[data-followup]").forEach((btn) => {
    btn.addEventListener("click", function () {
      submitQuery(btn.getAttribute("data-followup") || "");
    });
  });

  scrollMessages();
}

function addInitialAssistantCard() {
  addAssistantBubble("Ask me about a set, player, print run, checklist, what’s trending, or what was just added.");
  addAnswerCard({
    badge: "Ask",
    title: "Ask Chasing Majors",
    summary: "This version uses your live Chasing Majors data sources so you can test actual speed and behavior.",
    metadata: [],
    actions: [],
    followUps: EXAMPLES
  });
}

function getCachedJson(key, tsKey) {
  try {
    const raw = localStorage.getItem(key);
    const ts = Number(localStorage.getItem(tsKey) || 0);
    if (!raw || !ts) return null;
    if (Date.now() - ts > INDEX_TTL_MS) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function setCachedJson(key, tsKey, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value || []));
    localStorage.setItem(tsKey, String(Date.now()));
  } catch (e) {}
}

async function postJson(url, bodyObj) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(bodyObj)
  });
  return res.json();
}

async function getJson(url) {
  const res = await fetch(url, { method: "GET" });
  return res.json();
}

async function loadChecklistIndex() {
  const cached = getCachedJson(CL_INDEX_KEY, CL_INDEX_TS_KEY);
  if (cached && Array.isArray(cached)) {
    checklistIndex = cached;
    return cached;
  }

  const data = await postJson(CHECKLIST_EXEC_URL, {
    action: "index",
    payload: {}
  });

  if (data && data.ok && Array.isArray(data.index)) {
    checklistIndex = data.index;
    setCachedJson(CL_INDEX_KEY, CL_INDEX_TS_KEY, checklistIndex);
    return checklistIndex;
  }

  return [];
}

async function loadPrintRunIndex() {
  const cached = getCachedJson(PRV_INDEX_KEY, PRV_INDEX_TS_KEY);
  if (cached && Array.isArray(cached)) {
    printRunIndex = cached;
    return cached;
  }

  const data = await postJson(VAULT_EXEC_URL, {
    action: "index",
    payload: {}
  });

  let index = [];
  if (data && data.ok && Array.isArray(data.index)) {
    index = data.index;
  } else if (data && Array.isArray(data.products)) {
    index = data.products;
  }

  printRunIndex = index;
  setCachedJson(PRV_INDEX_KEY, PRV_INDEX_TS_KEY, printRunIndex);
  return printRunIndex;
}

async function bootstrapData() {
  if (bootPromise) return bootPromise;

  bootPromise = Promise.all([
    loadChecklistIndex(),
    loadPrintRunIndex()
  ]).catch(function () {
    return [];
  });

  return bootPromise;
}

function findChecklistProduct(query) {
  const nq = normalize(query);
  let best = null;
  let bestScore = 0;

  checklistIndex.forEach((item) => {
    const displayName = String(item.DisplayName || "");
    const keywords = String(item.Keywords || "");
    const sport = String(item.sport || "");
    const year = String(item.year || "");
    const code = String(item.Code || "");

    const hay = normalize(displayName + " " + keywords + " " + code);
    if (!hay) return;

    let score = 0;
    if (nq.includes(normalize(displayName))) score += 12;
    if (normalize(displayName).includes(nq)) score += 8;
    if (hay.includes(nq)) score += 3;
    if (year && nq.includes(year)) score += 1;
    if (sport && nq.includes(normalize(sport))) score += 1;

    if (score > bestScore) {
      bestScore = score;
      best = {
        name: displayName,
        sport: sport,
        year: year,
        code: code,
        keywords: keywords
      };
    }
  });

  return bestScore > 0 ? best : null;
}

function findPrintRunProduct(query) {
  const nq = normalize(query);
  let best = null;
  let bestScore = 0;

  printRunIndex.forEach((item) => {
    const displayName = String(item.DisplayName || item.displayName || item.name || "");
    const keywords = String(item.Keywords || item.keywords || "");
    const sport = String(item.sport || "");
    const year = String(item.year || "");
    const code = String(item.Code || item.code || "");

    const hay = normalize(displayName + " " + keywords + " " + code);
    if (!hay) return;

    let score = 0;
    if (nq.includes(normalize(displayName))) score += 12;
    if (normalize(displayName).includes(nq)) score += 8;
    if (hay.includes(nq)) score += 3;
    if (year && nq.includes(String(year))) score += 1;
    if (sport && nq.includes(normalize(sport))) score += 1;

    if (score > bestScore) {
      bestScore = score;
      best = {
        name: displayName,
        sport: sport,
        year: year,
        code: code,
        keywords: keywords
      };
    }
  });

  return bestScore > 0 ? best : null;
}

function detectIntent(query) {
  const nq = normalize(query);

  const asksPrintRun = includesAny(nq, ["print run", "print-run", "production", "how many made", "rarity"]);
  const asksChecklist = includesAny(nq, ["checklist", "check list", "card list", "full list"]);
  const asksTrending = includesAny(nq, ["trending", "hot", "popular", "what's hot", "whats hot"]);
  const asksJustAdded = includesAny(nq, ["just added", "newly added", "new stuff", "new data"]);
  const asksRelease = includesAny(nq, ["release", "release date", "releases", "coming out", "dropping next"]);
  const asksPlayer = includesAny(nq, ["player", "rookie cards", "cards for", "show me cards for"]);

  if (asksJustAdded) return "just_added";
  if (asksTrending) return "trending";
  if (asksRelease) return "release";
  if (asksPrintRun) return "print_run";
  if (asksChecklist) return "checklist";
  if (asksPlayer) return "player";
  return "search";
}

async function getHomeFeed() {
  const url = LOG_EXEC_URL + "?action=getHomeFeed&trendingLimit=3&addedLimit=4";
  return getJson(url);
}

async function searchPlayerCards(query) {
  const data = await postJson(CHECKLIST_EXEC_URL, {
    action: "searchCards",
    payload: {
      q: query,
      page: 1,
      limit: 8
    }
  });

  if (data && data.ok) {
    return data.results || [];
  }
  return [];
}

function buildChecklistUrl(product) {
  return "/checklists/?code=" + encodeURIComponent(product.code) +
    "&sport=" + encodeURIComponent(product.sport) +
    "&type=product&q=" + encodeURIComponent(product.name);
}

function buildVaultUrl(product) {
  return "/vault/?code=" + encodeURIComponent(product.code) +
    "&sport=" + encodeURIComponent(product.sport) +
    "&type=product&q=" + encodeURIComponent(product.name);
}

async function buildResponse(query) {
  const intent = detectIntent(query);
  const checklistProduct = findChecklistProduct(query);
  const printRunProduct = findPrintRunProduct(query);

  if (intent === "just_added") {
    const homeFeed = await getHomeFeed();
    const items = Array.isArray(homeFeed.justAdded) ? homeFeed.justAdded : [];

    return {
      badge: "Just Added",
      title: "Here’s what was just added",
      summary: items.length
        ? items.map((x) => x.label || x.query || "").filter(Boolean).join(" • ")
        : "I couldn’t find any just-added items right now.",
      metadata: [],
      actions: [
        { label: "Open Checklist Vault", href: "/checklists/", primary: true },
        { label: "Open Print Run Vault", href: "/vault/", primary: false }
      ],
      followUps: [
        "What baseball sets are trending?",
        "Show me 2026 Topps Series 1 print run"
      ]
    };
  }

  if (intent === "trending") {
    const homeFeed = await getHomeFeed();
    const nq = normalize(query);
    const sport = ["baseball", "football", "basketball", "soccer", "hockey"].find((s) => nq.includes(s)) || "";
    const trendItems = Array.isArray(homeFeed.trendingChecklists) ? homeFeed.trendingChecklists : [];

    let filtered = trendItems;
    if (sport) {
      filtered = trendItems.filter((x) => normalize(x.sport || "") === sport);
    }

    const labels = (filtered.length ? filtered : trendItems)
      .map((x) => x.label || x.query || "")
      .filter(Boolean)
      .slice(0, 3);

    return {
      badge: "Trending",
      title: sport ? `Trending ${sport}` : "Here’s what’s trending now",
      summary: labels.length
        ? labels.join(" • ")
        : "I couldn’t pull trending items right now.",
      metadata: [],
      actions: [
        { label: "Open Checklist Vault", href: "/checklists/", primary: true },
        { label: "Open Print Run Vault", href: "/vault/", primary: false }
      ],
      followUps: [
        "What was just added?",
        "Find Roman Anthony cards"
      ]
    };
  }

  if (intent === "release") {
    return {
      badge: "Release Schedule",
      title: "Release lookup",
      summary: "This would route to your release schedule experience. For now it can open the schedule route directly.",
      metadata: [],
      actions: [
        { label: "Open Release Schedule", href: "/schedule/", primary: true }
      ],
      followUps: [
        "What baseball sets are trending?",
        "What was just added?"
      ]
    };
  }

  if (intent === "print_run") {
    if (printRunProduct) {
      return {
        badge: "Print Run",
        title: `I found ${printRunProduct.name}`,
        summary: "Best match found in Print Run Vault.",
        metadata: [
          "Sport: " + (printRunProduct.sport || ""),
          "Year: " + (printRunProduct.year || "")
        ].filter(Boolean),
        actions: [
          { label: "Open Print Run Vault", href: buildVaultUrl(printRunProduct), primary: true },
          ...(checklistProduct ? [{ label: "Open Checklist Vault", href: buildChecklistUrl(checklistProduct), primary: false }] : [])
        ],
        followUps: [
          "Show me the checklist for " + printRunProduct.name,
          "What’s trending in " + (printRunProduct.sport || "this sport") + "?"
        ]
      };
    }

    if (checklistProduct) {
      return {
        badge: "Print Run",
        title: `I found ${checklistProduct.name}`,
        summary: "I found the product in Checklist Vault, but I could not find a matching Print Run Vault result yet.",
        metadata: [
          "Sport: " + (checklistProduct.sport || ""),
          "Year: " + (checklistProduct.year || "")
        ].filter(Boolean),
        actions: [
          { label: "Open Checklist Vault", href: buildChecklistUrl(checklistProduct), primary: true }
        ],
        followUps: [
          "What baseball sets are trending?",
          "What was just added?"
        ]
      };
    }
  }

  if (intent === "checklist" || intent === "search") {
    if (checklistProduct) {
      return {
        badge: "Checklist",
        title: `I found ${checklistProduct.name}`,
        summary: "Best match found in Checklist Vault.",
        metadata: [
          "Sport: " + (checklistProduct.sport || ""),
          "Year: " + (checklistProduct.year || "")
        ].filter(Boolean),
        actions: [
          { label: "Open Checklist Vault", href: buildChecklistUrl(checklistProduct), primary: true },
          ...(printRunProduct ? [{ label: "Open Print Run Vault", href: buildVaultUrl(printRunProduct), primary: false }] : [])
        ],
        followUps: [
          "Show me " + checklistProduct.name + " print run",
          "What’s trending in " + (checklistProduct.sport || "this sport") + "?"
        ]
      };
    }
  }

  if (intent === "player" || (!checklistProduct && !printRunProduct)) {
    const playerResults = await searchPlayerCards(query);

    if (playerResults.length) {
      const first = playerResults[0];
      const playerName = first.player || query;
      const sport = first.sport || "";
      const setNames = Array.from(new Set(playerResults.map((x) => x.displayName).filter(Boolean))).slice(0, 3);

      return {
        badge: "Player",
        title: `Player search: ${playerName}`,
        summary: setNames.length
          ? "I found matching cards in: " + setNames.join(" • ")
          : "I found matching cards for this player.",
        metadata: [
          "Sport: " + sport,
          "Matches: " + playerResults.length
        ].filter(Boolean),
        actions: [
          { label: "Search Checklist Vault", href: "/checklists/?q=" + encodeURIComponent(query), primary: true },
          { label: "Open Print Run Vault", href: "/vault/?q=" + encodeURIComponent(query), primary: false }
        ],
        followUps: [
          "What " + (sport || "baseball") + " sets are trending?",
          "What was just added?"
        ]
      };
    }
  }

  return {
    badge: "Try This",
    title: "I’m not sure yet, but I can still help",
    summary: "Try asking for a checklist, a print run, a player, what’s trending, what was just added, or a release lookup.",
    metadata: [],
    actions: [
      { label: "Open Checklist Vault", href: "/checklists/", primary: true },
      { label: "Open Print Run Vault", href: "/vault/", primary: false }
    ],
    followUps: [
      "Show me 2026 Topps Series 1 print run",
      "Find Roman Anthony cards",
      "What was just added?"
    ]
  };
}

async function submitQuery(text) {
  const value = String(text || chatInput.value || "").trim();
  if (!value) return;

  addUserMessage(value);
  chatInput.value = "";

  const thinking = addThinkingBubble();

  try {
    await bootstrapData();
    removeNode(thinking);

    const response = await buildResponse(value);
    addAssistantBubble("Here’s what I found.");
    addAnswerCard(response);
  } catch (err) {
    removeNode(thinking);
    addAssistantBubble("Something went wrong while I was searching. Try again.");
    console.error(err);
  }

  chatInput.focus();
}

sendBtn.addEventListener("click", function () {
  submitQuery();
});

chatInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter") {
    e.preventDefault();
    submitQuery();
  }
});

renderExamples();
addInitialAssistantCard();
bootstrapData();
chatInput.focus();
