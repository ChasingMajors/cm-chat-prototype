const PRODUCT_INDEX = [
  {
    name: "2026 Topps Series 1 Baseball",
    sport: "baseball",
    year: "2026",
    checklistCode: "2026_topps_series1",
    printRunCode: "26TS1mlb",
    aliases: ["2026 topps series 1", "topps series 1", "series 1 baseball"]
  },
  {
    name: "2026 Topps Heritage Baseball",
    sport: "baseball",
    year: "2026",
    checklistCode: "2026_Topps_Heritage",
    printRunCode: "26HertitageMLB",
    aliases: ["2026 topps heritage", "topps heritage baseball", "heritage baseball"]
  },
  {
    name: "2025 Topps Chrome Football",
    sport: "football",
    year: "2025",
    checklistCode: "2025_topps_chrome_football",
    printRunCode: "",
    aliases: ["2025 topps chrome football", "topps chrome football"]
  },
  {
    name: "2025-26 Topps Chrome UEFA Club Competitions Soccer",
    sport: "soccer",
    year: "2025-26",
    checklistCode: "2025_26_Topps_Chrome_UEFA_Club_Competitions_Soccer",
    printRunCode: "",
    aliases: ["uefa chrome soccer", "topps chrome uefa", "2025-26 topps chrome soccer"]
  },
  {
    name: "2025 Topps Transcendent Baseball",
    sport: "baseball",
    year: "2025",
    checklistCode: "2025_Topps_Transcendent_baseball",
    printRunCode: "",
    aliases: ["2025 topps transcendent", "topps transcendent baseball"]
  }
];

const PLAYER_INDEX = [
  { name: "Roman Anthony", sport: "baseball", tags: ["prospect", "rookie chase"] },
  { name: "James Wood", sport: "baseball", tags: ["rookie", "hot cards"] },
  { name: "Aaron Judge", sport: "baseball", tags: ["veteran", "slugger"] },
  { name: "Victor Wembanyama", sport: "basketball", tags: ["rookie", "basketball"] },
  { name: "Caleb Williams", sport: "football", tags: ["rookie", "football"] }
];

const TRENDING = {
  baseball: [
    "2026 Topps Series 1 Baseball",
    "2026 Topps Heritage Baseball",
    "2025 Topps Transcendent Baseball"
  ],
  football: [
    "2025 Topps Chrome Football",
    "2025 Prizm Football",
    "2025 Donruss Football"
  ],
  soccer: [
    "2025-26 Topps Chrome UEFA Club Competitions Soccer",
    "2025-26 Topps Gold UEFA Club Competitions Soccer",
    "2026 Topps Finest Premier League Soccer"
  ],
  all: [
    "2026 Topps Series 1 Baseball",
    "2026 Topps Heritage Baseball",
    "2025 Topps Chrome Football"
  ]
};

const JUST_ADDED = [
  "2025 Topps Chrome Football",
  "2025-26 Topps Chrome UEFA Club Competitions Soccer",
  "2025 Topps Transcendent Baseball",
  "2026 Topps Heritage Baseball"
];

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

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\\s'-]/g, " ")
    .replace(/\\s+/g, " ")
    .trim();
}

function includesAny(haystack, needles) {
  return needles.some((n) => haystack.includes(normalize(n)));
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function findProduct(query) {
  const nq = normalize(query);
  let best = null;
  let bestScore = 0;

  PRODUCT_INDEX.forEach((item) => {
    let score = 0;
    if (nq.includes(normalize(item.name))) score += 10;

    item.aliases.forEach((alias) => {
      if (nq.includes(normalize(alias))) score += 4;
    });

    if (String(item.year) && nq.includes(String(item.year))) score += 1;
    if (nq.includes(item.sport)) score += 1;

    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  });

  return bestScore > 0 ? best : null;
}

function findPlayer(query) {
  const nq = normalize(query);
  let best = null;
  let bestScore = 0;

  PLAYER_INDEX.forEach((item) => {
    let score = 0;
    if (nq.includes(normalize(item.name))) score += 10;
    if (nq.includes(item.sport)) score += 1;

    if (score > bestScore) {
      best = item;
      bestScore = score;
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

function buildResponse(query) {
  const intent = detectIntent(query);
  const product = findProduct(query);
  const player = findPlayer(query);
  const nq = normalize(query);

  if (intent === "just_added") {
    return {
      badge: "Just Added",
      title: "Here’s what was just added",
      summary: JUST_ADDED.join(" • "),
      metadata: [],
      actions: [
        { label: "Open Checklist Vault", href: "/checklists/", primary: true },
        { label: "Open Print Run Vault", href: "/vault/", primary: false }
      ],
      followUps: [
        "Show me baseball sets just added",
        "What print runs are trending?"
      ]
    };
  }

  if (intent === "trending") {
    const sport = ["baseball", "football", "basketball", "soccer", "hockey"].find((s) => nq.includes(s)) || "all";

    return {
      badge: "Trending",
      title: sport === "all" ? "Here’s what’s trending now" : `Trending ${sport}`,
      summary: (TRENDING[sport] || TRENDING.all).join(" • "),
      metadata: [],
      actions: [
        { label: "Open Checklist Vault", href: "/checklists/", primary: true },
        { label: "Open Print Run Vault", href: "/vault/", primary: false }
      ],
      followUps: [
        "What was just added?",
        "Show me 2026 Topps Heritage print run"
      ]
    };
  }

  if (intent === "release") {
    return {
      badge: "Release Schedule",
      title: "Release lookup",
      summary: "In the full app this would route to Release Schedule and return the best matching upcoming products by sport, brand, and date.",
      metadata: [],
      actions: [
        { label: "Open Release Schedule", href: "/schedule/", primary: true }
      ],
      followUps: [
        "What baseball sets are trending?",
        "Show me soccer releases"
      ]
    };
  }

  if (intent === "print_run" && product) {
    return {
      badge: "Print Run",
      title: `I found ${product.name}`,
      summary: product.printRunCode
        ? "This product is available in Print Run Vault."
        : "I found the product, but a print run record is not loaded in this prototype yet.",
      metadata: [`Sport: ${product.sport}`, `Year: ${product.year}`],
      actions: [
        ...(product.printRunCode
          ? [{
              label: "Open Print Run Vault",
              href: `/vault/?code=${encodeURIComponent(product.printRunCode)}&sport=${encodeURIComponent(product.sport)}&type=product&q=${encodeURIComponent(product.name)}`,
              primary: true
            }]
          : []),
        {
          label: "Open Checklist Vault",
          href: `/checklists/?code=${encodeURIComponent(product.checklistCode)}&sport=${encodeURIComponent(product.sport)}&type=product&q=${encodeURIComponent(product.name)}`,
          primary: !product.printRunCode
        }
      ],
      followUps: [
        `Show me the checklist for ${product.name}`,
        `What’s trending in ${product.sport}?`
      ]
    };
  }

  if ((intent === "checklist" || intent === "search") && product) {
    return {
      badge: "Checklist",
      title: `I found ${product.name}`,
      summary: "Best match found in Checklist Vault.",
      metadata: [`Sport: ${product.sport}`, `Year: ${product.year}`],
      actions: [
        {
          label: "Open Checklist Vault",
          href: `/checklists/?code=${encodeURIComponent(product.checklistCode)}&sport=${encodeURIComponent(product.sport)}&type=product&q=${encodeURIComponent(product.name)}`,
          primary: true
        },
        ...(product.printRunCode
          ? [{
              label: "Open Print Run Vault",
              href: `/vault/?code=${encodeURIComponent(product.printRunCode)}&sport=${encodeURIComponent(product.sport)}&type=product&q=${encodeURIComponent(product.name)}`,
              primary: false
            }]
          : [])
      ],
      followUps: [
        `Show me ${product.name} print run`,
        `What else is trending in ${product.sport}?`
      ]
    };
  }

  if ((intent === "player" || (!product && player)) && player) {
    return {
      badge: "Player",
      title: `Player search: ${player.name}`,
      summary: `I found a player match in ${player.sport}. In the full app this would route to grouped card results, player checklist hits, and related products.`,
      metadata: player.tags.map((tag) => `Tag: ${tag}`),
      actions: [
        {
          label: "Search Checklist Vault",
          href: `/checklists/?q=${encodeURIComponent(player.name)}`,
          primary: true
        },
        {
          label: "Open Print Run Vault",
          href: `/vault/?q=${encodeURIComponent(player.name)}`,
          primary: false
        }
      ],
      followUps: [
        `Find ${player.name} rookie cards`,
        `What ${player.sport} sets are trending?`
      ]
    };
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

function addUserMessage(text) {
  const row = document.createElement("div");
  row.className = "message-row user";
  row.innerHTML = `<div class="message-bubble">${escapeHtml(text)}</div>`;
  chatMessages.appendChild(row);
  scrollMessages();
}

function addAssistantIntro() {
  const row = document.createElement("div");
  row.className = "message-row assistant";
  row.innerHTML = `<div class="message-bubble">Here’s what I found.</div>`;
  chatMessages.appendChild(row);
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
      <div class="answer-title">${escapeHtml(response.title)}</div>
      <div class="answer-summary">${escapeHtml(response.summary)}</div>
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
  const response = {
    badge: "Ask",
    title: "Ask Chasing Majors",
    summary: "Ask about a checklist, print run, player, trending products, or what was just added.",
    metadata: [],
    actions: [],
    followUps: EXAMPLES
  };

  addAssistantIntro();
  addAnswerCard(response);
}

function scrollMessages() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function submitQuery(text) {
  const value = String(text || chatInput.value || "").trim();
  if (!value) return;

  addUserMessage(value);

  const response = buildResponse(value);
  addAssistantIntro();
  addAnswerCard(response);

  chatInput.value = "";
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
addInitialAssistantCard();    "2025-26 Topps Chrome UEFA Club Competitions Soccer",
    "2025-26 Topps Gold UEFA Club Competitions Soccer",
    "2026 Topps Finest Premier League Soccer"
  ],
  all: [
    "2026 Topps Series 1 Baseball",
    "2026 Topps Heritage Baseball",
    "2025 Topps Chrome Football"
  ]
};

const JUST_ADDED = [
  "2025 Topps Chrome Football",
  "2025-26 Topps Chrome UEFA Club Competitions Soccer",
  "2025 Topps Transcendent Baseball",
  "2026 Topps Heritage Baseball"
];

const EXAMPLES = [
  "Show me 2026 Topps Series 1 print run",
  "Find the checklist for 2025 Topps Chrome Football",
  "What baseball sets are trending?",
  "Find Roman Anthony cards",
  "What was just added?",
  "Show me soccer releases"
];

const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");
const examplePills = document.getElementById("examplePills");

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(haystack, needles) {
  return needles.some((n) => haystack.includes(normalize(n)));
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function findProduct(query) {
  const nq = normalize(query);
  let best = null;
  let bestScore = 0;

  PRODUCT_INDEX.forEach((item) => {
    let score = 0;

    if (nq.includes(normalize(item.name))) score += 10;

    item.aliases.forEach((alias) => {
      if (nq.includes(normalize(alias))) score += 4;
    });

    if (String(item.year) && nq.includes(String(item.year))) score += 1;
    if (nq.includes(item.sport)) score += 1;

    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  });

  return bestScore > 0 ? best : null;
}

function findPlayer(query) {
  const nq = normalize(query);
  let best = null;
  let bestScore = 0;

  PLAYER_INDEX.forEach((item) => {
    let score = 0;
    if (nq.includes(normalize(item.name))) score += 10;
    if (nq.includes(item.sport)) score += 1;

    if (score > bestScore) {
      best = item;
      bestScore = score;
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

function buildResponse(query) {
  const intent = detectIntent(query);
  const product = findProduct(query);
  const player = findPlayer(query);
  const nq = normalize(query);

  if (intent === "just_added") {
    return {
      badge: "Just Added",
      title: "Here’s what was just added",
      summary: JUST_ADDED.join(" • "),
      metadata: [],
      actions: [
        { label: "Open Checklist Vault", href: "/checklists/", primary: true },
        { label: "Open Print Run Vault", href: "/vault/", primary: false }
      ],
      followUps: [
        "Show me baseball sets just added",
        "What print runs are trending?"
      ]
    };
  }

  if (intent === "trending") {
    const sport = ["baseball", "football", "basketball", "soccer", "hockey"].find((s) => nq.includes(s)) || "all";

    return {
      badge: "Trending",
      title: sport === "all" ? "Here’s what’s trending now" : `Trending ${sport}`,
      summary: (TRENDING[sport] || TRENDING.all).join(" • "),
      metadata: [],
      actions: [
        { label: "Open Checklist Vault", href: "/checklists/", primary: true },
        { label: "Open Print Run Vault", href: "/vault/", primary: false }
      ],
      followUps: [
        "What was just added?",
        "Show me 2026 Topps Heritage print run"
      ]
    };
  }

  if (intent === "release") {
    return {
      badge: "Release Schedule",
      title: "Release lookup",
      summary: "In the full app this would route to Release Schedule and return the best matching upcoming products by sport, brand, and date.",
      metadata: [],
      actions: [
        { label: "Open Release Schedule", href: "/schedule/", primary: true }
      ],
      followUps: [
        "What baseball sets are trending?",
        "Show me soccer releases"
      ]
    };
  }

  if (intent === "print_run" && product) {
    return {
      badge: "Print Run",
      title: `I found ${product.name}`,
      summary: product.printRunCode
        ? "This product is available in Print Run Vault."
        : "I found the product, but a print run record is not loaded in this prototype yet.",
      metadata: [`Sport: ${product.sport}`, `Year: ${product.year}`],
      actions: [
        ...(product.printRunCode
          ? [{
              label: "Open Print Run Vault",
              href: `/vault/?code=${encodeURIComponent(product.printRunCode)}&sport=${encodeURIComponent(product.sport)}&type=product&q=${encodeURIComponent(product.name)}`,
              primary: true
            }]
          : []),
        {
          label: "Open Checklist Vault",
          href: `/checklists/?code=${encodeURIComponent(product.checklistCode)}&sport=${encodeURIComponent(product.sport)}&type=product&q=${encodeURIComponent(product.name)}`,
          primary: !product.printRunCode
        }
      ],
      followUps: [
        `Show me the checklist for ${product.name}`,
        `What’s trending in ${product.sport}?`
      ]
    };
  }

  if ((intent === "checklist" || intent === "search") && product) {
    return {
      badge: "Checklist",
      title: `I found ${product.name}`,
      summary: "Best match found in Checklist Vault.",
      metadata: [`Sport: ${product.sport}`, `Year: ${product.year}`],
      actions: [
        {
          label: "Open Checklist Vault",
          href: `/checklists/?code=${encodeURIComponent(product.checklistCode)}&sport=${encodeURIComponent(product.sport)}&type=product&q=${encodeURIComponent(product.name)}`,
          primary: true
        },
        ...(product.printRunCode
          ? [{
              label: "Open Print Run Vault",
              href: `/vault/?code=${encodeURIComponent(product.printRunCode)}&sport=${encodeURIComponent(product.sport)}&type=product&q=${encodeURIComponent(product.name)}`,
              primary: false
            }]
          : [])
      ],
      followUps: [
        `Show me ${product.name} print run`,
        `What else is trending in ${product.sport}?`
      ]
    };
  }

  if ((intent === "player" || (!product && player)) && player) {
    return {
      badge: "Player",
      title: `Player search: ${player.name}`,
      summary: `I found a player match in ${player.sport}. In the full app this would route to grouped card results, player checklist hits, and related products.`,
      metadata: player.tags.map((tag) => `Tag: ${tag}`),
      actions: [
        {
          label: "Search Checklist Vault",
          href: `/checklists/?q=${encodeURIComponent(player.name)}`,
          primary: true
        },
        {
          label: "Open Print Run Vault",
          href: `/vault/?q=${encodeURIComponent(player.name)}`,
          primary: false
        }
      ],
      followUps: [
        `Find ${player.name} rookie cards`,
        `What ${player.sport} sets are trending?`
      ]
    };
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

function addUserMessage(text) {
  const row = document.createElement("div");
  row.className = "message-row user";
  row.innerHTML = `<div class="message-bubble">${escapeHtml(text)}</div>`;
  chatMessages.appendChild(row);
  scrollMessages();
}

function addAssistantIntro() {
  const row = document.createElement("div");
  row.className = "message-row assistant";
  row.innerHTML = `<div class="message-bubble">Here’s what I found.</div>`;
  chatMessages.appendChild(row);
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
      <div class="answer-title">${escapeHtml(response.title)}</div>
      <div class="answer-summary">${escapeHtml(response.summary)}</div>
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
  const response = {
    badge: "Prototype",
    title: "Ask Chasing Majors",
    summary: "Try a product, player, print run, checklist, trending, just added, or release-style question.",
    metadata: [],
    actions: [],
    followUps: EXAMPLES.slice(0, 4)
  };

  addAssistantIntro();
  addAnswerCard(response);
}

function scrollMessages() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function submitQuery(text) {
  const value = String(text || chatInput.value || "").trim();
  if (!value) return;

  addUserMessage(value);

  const response = buildResponse(value);
  addAssistantIntro();
  addAnswerCard(response);

  chatInput.value = "";
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
