(function () {
  const DATA_BASE = "https://app.chasingmajors.com/data/v1";
  const RELEASE_URL = "https://app.chasingmajors.com/data/v2/releases/schedule.json";
  const SPORTS = ["baseball", "basketball", "football", "hockey", "soccer"];
  const BLOCKED_SOURCE_TERMS = ["mma", "ufc", "wwe", "wrestling", "racing", "nascar", "f1", "formula 1", "pokemon", "marvel", "disney", "star wars"];
  const APPROVAL_KEY = "cm_command_center_opportunity_status_v1";
  const TASK_KEY = "cm_command_center_operator_tasks_v1";
  const OPERATOR_ENDPOINT_KEY = "cm_command_center_operator_endpoint_v1";
  const OPERATOR_WRITE_KEY = "cm_command_center_operator_write_key_v1";

  const state = {
    opportunities: [],
    audit: null,
    approvals: readApprovals(),
    tasks: readTasks()
  };

  const els = {
    refreshBtn: document.getElementById("refreshBtn"),
    clearDoneBtn: document.getElementById("clearDoneBtn"),
    sourceCheckBtn: document.getElementById("sourceCheckBtn"),
    sourceWatchQuickBtn: document.getElementById("sourceWatchQuickBtn"),
    sourceWatchDeepBtn: document.getElementById("sourceWatchDeepBtn"),
    saveEndpointBtn: document.getElementById("saveEndpointBtn"),
    sourceTitleInput: document.getElementById("sourceTitleInput"),
    sourceSportInput: document.getElementById("sourceSportInput"),
    operatorEndpointInput: document.getElementById("operatorEndpointInput"),
    operatorKeyInput: document.getElementById("operatorKeyInput"),
    typeFilter: document.getElementById("typeFilter"),
    systemState: document.getElementById("systemState"),
    opportunityCount: document.getElementById("opportunityCount"),
    criticalCount: document.getElementById("criticalCount"),
    lastAudit: document.getElementById("lastAudit"),
    nextActionList: document.getElementById("nextActionList"),
    operatorTaskList: document.getElementById("operatorTaskList"),
    sourceCheckResult: document.getElementById("sourceCheckResult"),
    briefList: document.getElementById("briefList"),
    opportunityList: document.getElementById("opportunityList"),
    dataHealthStats: document.getElementById("dataHealthStats"),
    edgeSignals: document.getElementById("edgeSignals"),
    buildTargets: document.getElementById("buildTargets")
  };

  function readApprovals() {
    try {
      return JSON.parse(localStorage.getItem(APPROVAL_KEY) || "{}");
    } catch (err) {
      return {};
    }
  }

  function writeApprovals() {
    try {
      localStorage.setItem(APPROVAL_KEY, JSON.stringify(state.approvals));
    } catch (err) {}
  }

  function readTasks() {
    try {
      return JSON.parse(localStorage.getItem(TASK_KEY) || "[]");
    } catch (err) {
      return [];
    }
  }

  function writeTasks() {
    try {
      localStorage.setItem(TASK_KEY, JSON.stringify(state.tasks));
    } catch (err) {}
  }

  function readOperatorEndpoint() {
    try {
      return String(localStorage.getItem(OPERATOR_ENDPOINT_KEY) || "").trim();
    } catch (err) {
      return "";
    }
  }

  function writeOperatorEndpoint(value) {
    try {
      localStorage.setItem(OPERATOR_ENDPOINT_KEY, String(value || "").trim());
    } catch (err) {}
  }

  function readOperatorKey() {
    try {
      return String(localStorage.getItem(OPERATOR_WRITE_KEY) || "").trim();
    } catch (err) {
      return "";
    }
  }

  function writeOperatorKey(value) {
    try {
      localStorage.setItem(OPERATOR_WRITE_KEY, String(value || "").trim());
    } catch (err) {}
  }

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^\w\s'-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function titleCase(value) {
    return String(value || "").replace(/\b\w/g, c => c.toUpperCase());
  }

  function formatNumber(value) {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n.toLocaleString("en-US") : String(value || "");
  }

  function getProductCode(item) {
    return item && (item.Code || item.code || "");
  }

  function getProductName(item) {
    return item && (item.DisplayName || item.displayName || item.display_name || item.name || "");
  }

  function getProductSport(item) {
    return normalize(item && item.sport);
  }

  function getProductSearchText(item) {
    return normalize([
      item && (item.DisplayName || item.displayName || item.display_name || item.name),
      item && (item.Keywords || item.keywords),
      item && (item.Code || item.code)
    ].filter(Boolean).join(" "));
  }

  function isAllowedSport(value) {
    return SPORTS.includes(normalize(value));
  }

  function hasBlockedSourceTerm(value) {
    const text = normalize(value);
    return BLOCKED_SOURCE_TERMS.some(term => text.includes(normalize(term)));
  }

  async function fetchJson(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  }

  async function fetchProductBundles() {
    const manifests = {};
    const productsBySport = {};
    const errors = [];

    await Promise.all(SPORTS.map(async sport => {
      try {
        const manifest = await fetchJson(`${DATA_BASE}/checklists/products/${sport}.json`);
        manifests[sport] = manifest;
        productsBySport[sport] = {};

        const shardNames = Array.from(new Set(Object.values(manifest.product_map || manifest.productMap || {}))).filter(Boolean);
        const shardResults = await Promise.allSettled(shardNames.map(async shard => {
          const data = await fetchJson(`${DATA_BASE}/checklists/products/${shard}`);
          return { shard, data };
        }));

        shardResults.forEach(result => {
          if (result.status === "fulfilled") {
            Object.assign(productsBySport[sport], result.value.data.products || {});
          } else {
            errors.push({
              sport,
              message: result.reason && result.reason.message ? result.reason.message : String(result.reason)
            });
          }
        });
      } catch (err) {
        manifests[sport] = null;
        productsBySport[sport] = {};
        errors.push({ sport, message: err.message || String(err) });
      }
    }));

    return { manifests, productsBySport, errors };
  }

  async function fetchVaultProducts() {
    const manifest = await fetchJson(`${DATA_BASE}/vault/products/all.json`);
    const productMap = manifest.product_map || manifest.productMap || {};
    const products = {};
    const errors = [];
    const shardNames = Array.from(new Set(Object.values(productMap))).filter(Boolean);

    const results = await Promise.allSettled(shardNames.map(async shard => {
      const data = await fetchJson(`${DATA_BASE}/vault/products/${shard}`);
      return { shard, data };
    }));

    results.forEach(result => {
      if (result.status === "fulfilled") {
        Object.assign(products, result.value.data.products || {});
      } else {
        errors.push(result.reason && result.reason.message ? result.reason.message : String(result.reason));
      }
    });

    return { manifest, products, errors };
  }

  function makeOpportunity(input) {
    const id = [
      input.type,
      input.code || "",
      input.title || ""
    ].map(normalize).join("|");

    return {
      id,
      type: input.type || "info",
      severity: input.severity || "info",
      title: input.title || "Opportunity",
      why: input.why || "",
      evidence: input.evidence || [],
      suggestedAction: input.suggestedAction || "",
      confidence: input.confidence || "Medium",
      risk: input.risk || "Low",
      code: input.code || "",
      meta: input.meta || []
    };
  }

  function auditChecklistProducts(index, bundleData) {
    const opportunities = [];
    const missingManifest = [];
    const missingBundle = [];
    const emptyRows = [];
    const noParallels = [];

    index.forEach(item => {
      const code = getProductCode(item);
      const sport = getProductSport(item);
      if (!code || !sport || !SPORTS.includes(sport)) return;

      const manifest = bundleData.manifests[sport] || {};
      const productMap = manifest.product_map || manifest.productMap || {};
      const shard = productMap[code];
      const product = bundleData.productsBySport[sport] && bundleData.productsBySport[sport][code];

      if (!shard) {
        missingManifest.push(item);
        opportunities.push(makeOpportunity({
          type: "data_gap",
          severity: "critical",
          title: `Checklist product is indexed but missing bundle mapping: ${getProductName(item)}`,
          why: "Users can discover this product, but the ChatBot/CV product loader may not be able to open rows from static JSON.",
          evidence: [`Sport: ${titleCase(sport)}`, `Code: ${code}`],
          suggestedAction: "Republish this checklist source and rebuild the checklist index from product bundles.",
          confidence: "High",
          risk: "Medium",
          code
        }));
        return;
      }

      if (!product) {
        missingBundle.push(item);
        opportunities.push(makeOpportunity({
          type: "data_gap",
          severity: "critical",
          title: `Checklist bundle missing product payload: ${getProductName(item)}`,
          why: "The manifest points to a shard, but the shard does not include the product record.",
          evidence: [`Shard: ${shard}`, `Code: ${code}`],
          suggestedAction: "Republish the affected checklist product shard and retest the product query.",
          confidence: "High",
          risk: "Medium",
          code
        }));
        return;
      }

      const rows = Array.isArray(product.rows) ? product.rows : [];
      const parallels = Array.isArray(product.parallels) ? product.parallels : [];

      if (!rows.length) {
        emptyRows.push(item);
        opportunities.push(makeOpportunity({
          type: "data_gap",
          severity: "critical",
          title: `Checklist product has no rows: ${getProductName(item)}`,
          why: "Users can find the product, but full checklist results will be empty.",
          evidence: [`Sport: ${titleCase(sport)}`, `Code: ${code}`, `Shard: ${shard}`],
          suggestedAction: "Check the source spreadsheet rows for this code, republish that source, then run the product query in sandbox.",
          confidence: "High",
          risk: "Low",
          code
        }));
      }

      if (rows.length && !parallels.length && /topps|bowman|panini|prizm|chrome|finest/i.test(getProductName(item))) {
        noParallels.push(item);
      }
    });

    if (noParallels.length) {
      opportunities.push(makeOpportunity({
        type: "data_gap",
        severity: "warning",
        title: `${formatNumber(noParallels.length)} checklist products have rows but no parallel data`,
        why: "Parallel searches are high-value collector queries. Missing parallels weakens ChatBot, CV, rarity, and future buy-signal answers.",
        evidence: noParallels.slice(0, 5).map(getProductName),
        suggestedAction: "Prioritize missing parallel imports for the products with recent searches or release schedule relevance.",
        confidence: "Medium",
        risk: "Low"
      }));
    }

    return {
      opportunities,
      stats: {
        missingManifest: missingManifest.length,
        missingBundle: missingBundle.length,
        emptyRows: emptyRows.length,
        noParallels: noParallels.length
      }
    };
  }

  function auditReleaseSchedule(releases, checklistIndex, vaultIndex) {
    const opportunities = [];
    const checklistNames = new Map();
    const vaultNames = new Map();

    checklistIndex.forEach(item => checklistNames.set(normalize(getProductName(item)), item));
    vaultIndex.forEach(item => vaultNames.set(normalize(getProductName(item)), item));

    const recentOrUpcoming = releases.filter(row => {
      const status = normalize(row.status);
      return status === "upcoming" || status === "announced" || String(row.releaseDate || "").slice(0, 4) >= "2025";
    });

    const missingChecklist = [];
    const missingVault = [];

    recentOrUpcoming.forEach(row => {
      const name = row.setName || [row.releaseDate && String(row.releaseDate).slice(0, 4), row.manufacturer, row.product, row.sport].filter(Boolean).join(" ");
      const key = normalize(name);
      if (key && !checklistNames.has(key)) missingChecklist.push(row);
      if (key && !vaultNames.has(key) && /topps|bowman/i.test(name)) missingVault.push(row);
    });

    if (missingChecklist.length) {
      opportunities.push(makeOpportunity({
        type: "data_gap",
        severity: "warning",
        title: `${missingChecklist.length} release schedule products do not have exact Checklist Vault matches`,
        why: "Release Schedule should route users into CV cleanly. Missing matches create dead ends and weak ChatBot answers.",
        evidence: missingChecklist.slice(0, 6).map(row => row.setName || row.product || "Unnamed release"),
        suggestedAction: "Review release names, add missing checklist products, or improve release-to-product matching aliases.",
        confidence: "Medium",
        risk: "Low"
      }));
    }

    if (missingVault.length) {
      opportunities.push(makeOpportunity({
        type: "data_gap",
        severity: "warning",
        title: `${missingVault.length} Topps/Bowman release products do not have exact PRV matches`,
        why: "These are likely candidates for print-run monitoring and future WaxMetrix comparison.",
        evidence: missingVault.slice(0, 6).map(row => row.setName || row.product || "Unnamed release"),
        suggestedAction: "Queue these products for PRV source watch and print-run validation.",
        confidence: "Medium",
        risk: "Medium"
      }));
    }

    return {
      opportunities,
      stats: {
        recentOrUpcoming: recentOrUpcoming.length,
        missingChecklist: missingChecklist.length,
        missingVault: missingVault.length
      }
    };
  }

  function buildIntentOpportunities() {
    const intents = [
      "psa 10",
      "rookie auto",
      "1/1",
      "superfractor",
      "numbered rookie cards",
      "gold refractor /50",
      "case hit",
      "hobby box",
      "auction ending soon"
    ];

    return [
      makeOpportunity({
        type: "chatbot_intent",
        severity: "opportunity",
        title: "Teach ChatBot eBay-style collector search language",
        why: "eBay autosuggest shows collectors search by grade, card type, rarity, format, and timing. Chasing Majors should translate those phrases into checklist, PRV, and Edge answers.",
        evidence: intents,
        suggestedAction: "Add sandbox intent tests and responses for these phrases before promoting to live.",
        confidence: "High",
        risk: "Low"
      })
    ];
  }

  function buildSourceWatchOpportunities() {
    return [
      makeOpportunity({
        type: "source_watch",
        severity: "opportunity",
        title: "Connect WaxMetrix watch queue for PRV validation",
        why: "Print-run data is one of the highest-value differentiators. The system should detect source mentions, compare against PRV, and ask for approval before updates.",
        evidence: ["Watch trusted source posts", "Compare against PRV product rows", "Flag major discrepancies"],
        suggestedAction: "Build a source-watch connector that creates review items, not automatic live edits.",
        confidence: "Medium",
        risk: "Medium"
      }),
      makeOpportunity({
        type: "source_watch",
        severity: "opportunity",
        title: "Connect Checklist Center watch queue for new checklists and parallels",
        why: "Checklist gaps are currently discoverable only after a user searches or you manually notice missing data.",
        evidence: ["Detect new checklist pages", "Detect parallel updates", "Create approval-ready spreadsheet changes"],
        suggestedAction: "Start with review-only detection and manual approval before any spreadsheet write.",
        confidence: "Medium",
        risk: "Medium"
      })
    ];
  }

  function buildEdgeOpportunities(earlySignals) {
    const signals = Array.isArray(earlySignals.signals) ? earlySignals.signals : Array.isArray(earlySignals.players) ? earlySignals.players : [];
    const top = signals.slice(0, 6);

    if (!top.length) {
      return [];
    }

    return [
      makeOpportunity({
        type: "trend_signal",
        severity: "opportunity",
        title: "MLB Early Edge candidates are ready for card-target mapping",
        why: "Recent RC players with stat momentum should be mapped to rookie autos, low-numbered cards, and product priority before prices fully react.",
        evidence: top.map(player => player.playerName || player.name || player.player || "Unnamed player"),
        suggestedAction: "Build Edge detail cards that connect each player to RC year, rookie autos, SSPs, and low-numbered checklist targets.",
        confidence: "Medium",
        risk: "Low"
      })
    ];
  }

  function summarizeBrief(opportunities, audit) {
    const critical = opportunities.filter(o => o.severity === "critical");
    const trend = opportunities.find(o => o.type === "trend_signal");
    const source = opportunities.find(o => o.type === "source_watch");

    const items = [];

    if (critical.length) {
      items.push({
        title: `${critical.length} critical data issues need review`,
        detail: "These can affect user-facing answers or product result loading."
      });
    } else {
      items.push({
        title: "No critical data-loader issues detected",
        detail: "Core static product mappings are mostly healthy in this audit."
      });
    }

    if (audit.releaseStats.missingVault) {
      items.push({
        title: `${audit.releaseStats.missingVault} release products need PRV review`,
        detail: "These should feed the future WaxMetrix/source-watch queue."
      });
    }

    if (trend) {
      items.push({
        title: "Early Edge opportunity queue is available",
        detail: "Use MLB trend signals to drive RC and low-numbered target recommendations."
      });
    }

    if (source) {
      items.push({
        title: "Source-watch connectors are the next automation layer",
        detail: "WaxMetrix and Checklist Center should create approval-ready tasks."
      });
    }

    return items;
  }

  function getActionStatus(id) {
    return state.approvals[id] || "new";
  }

  function makeNextAction(input) {
    const id = [
      "next",
      input.kind || "",
      input.title || ""
    ].map(normalize).join("|");

    return {
      id,
      rank: input.rank || 99,
      kind: input.kind || "operator",
      title: input.title || "Next action",
      summary: input.summary || "",
      why: input.why || "",
      now: input.now || "",
      approval: input.approval || "",
      afterApproval: input.afterApproval || "",
      relatedType: input.relatedType || "",
      severity: input.severity || "info"
    };
  }

  function buildNextActions(opportunities, audit) {
    const critical = opportunities.filter(o => o.severity === "critical");
    const missingMappings = audit && audit.checklistStats ? Number(audit.checklistStats.missingManifest || 0) : 0;
    const emptyRows = audit && audit.checklistStats ? Number(audit.checklistStats.emptyRows || 0) : 0;
    const missingVault = audit && audit.releaseStats ? Number(audit.releaseStats.missingVault || 0) : 0;
    const missingChecklist = audit && audit.releaseStats ? Number(audit.releaseStats.missingChecklist || 0) : 0;
    const edgeSignals = audit && audit.earlySignals
      ? (Array.isArray(audit.earlySignals.signals) ? audit.earlySignals.signals : Array.isArray(audit.earlySignals.players) ? audit.earlySignals.players : [])
      : [];

    const actions = [];

    if (critical.length) {
      actions.push(makeNextAction({
        rank: 1,
        kind: "operator",
        severity: "critical",
        title: "Fix user-facing data gaps first",
        summary: `${critical.length} critical product-loader issues can break searches or checklist answers.`,
        why: "These issues can affect live UX. Fixing them should come before adding new features.",
        now: `Review the first ${Math.min(critical.length, 5)} critical items in the Opportunity Engine.`,
        approval: "Approve a repair pass for the affected checklist products.",
        afterApproval: "Republish the affected checklist source files, rebuild the product index, and retest the exact product queries in sandbox.",
        relatedType: "data_gap"
      }));
    } else {
      actions.push(makeNextAction({
        rank: 1,
        kind: "operator",
        severity: "opportunity",
        title: "Core data loader is healthy enough for the next build",
        summary: "No critical product-loader issues were detected in this audit.",
        why: "That gives us room to work on higher-value discovery and decision features.",
        now: "Move to source monitoring or Early Edge card-target mapping.",
        approval: "Approve the next feature lane you want prioritized.",
        afterApproval: "Build in sandbox, run known-query tests, then promote only after review.",
        relatedType: "trend_signal"
      }));
    }

    if (missingMappings || emptyRows) {
      actions.push(makeNextAction({
        rank: 2,
        kind: "data steward",
        severity: "warning",
        title: "Rebuild checklist publishing confidence",
        summary: `${missingMappings} missing bundle mappings and ${emptyRows} empty checklist products were found.`,
        why: "This is exactly the kind of issue that causes users to find a product but not get useful results.",
        now: "Use this list as the publish QA queue after spreadsheet updates.",
        approval: "Approve turning this into a repeatable pre-live checklist audit.",
        afterApproval: "Add a one-click report that says which publish function to run and which products to retest.",
        relatedType: "data_gap"
      }));
    }

    if (missingVault || missingChecklist) {
      actions.push(makeNextAction({
        rank: 3,
        kind: "scout",
        severity: "warning",
        title: "Clean up release schedule routing gaps",
        summary: `${missingChecklist} releases need Checklist review and ${missingVault} likely PRV candidates need review.`,
        why: "Release Schedule should become a discovery engine that routes users into the right tool without dead ends.",
        now: "Prioritize upcoming Topps/Bowman products first.",
        approval: "Approve a release-to-product matching pass.",
        afterApproval: "Create aliases or missing product rows, publish data, and retest release links.",
        relatedType: "data_gap"
      }));
    }

    if (edgeSignals.length) {
      const names = edgeSignals.slice(0, 3).map(p => p.playerName || p.name || p.player).filter(Boolean).join(", ");
      actions.push(makeNextAction({
        rank: 4,
        kind: "analyst",
        severity: "opportunity",
        title: "Turn Early Edge into card-buy targets",
        summary: `${edgeSignals.length} MLB Early Edge signals are available${names ? `, led by ${names}` : ""}.`,
        why: "The tool should not only show a hot player. It should tell collectors which RC autos and low-numbered cards to research first.",
        now: "Map each signal to RC year, rookie autos, SSP/low-numbered cards, and matching product pages.",
        approval: "Approve an Early Edge detail-card prototype.",
        afterApproval: "Build the sandbox view, validate with known young players, then decide whether to add it to ChatBot.",
        relatedType: "trend_signal"
      }));
    }

    actions.push(makeNextAction({
      rank: 5,
      kind: "assistant",
      severity: "opportunity",
      title: "Teach the ChatBot buyer-language searches",
      summary: "Add eBay-style collector queries like PSA 10, rookie auto, 1/1, Superfractor, case hit, and numbered rookies.",
      why: "Users will not always ask database-perfect questions. The assistant needs to translate collector language into Chasing Majors data paths.",
      now: "Build the sandbox query test set before touching live ChatBot files.",
      approval: "Approve the buyer-intent training pass.",
      afterApproval: "Add responses, run regression tests, and promote only when product, player, and checklist searches still pass.",
      relatedType: "chatbot_intent"
    }));

    actions.push(makeNextAction({
      rank: 6,
      kind: "scout",
      severity: "opportunity",
      title: "Start source-watch as review-only",
      summary: "WaxMetrix and Checklist Center should create approval items before anything edits Sheets or GitHub.",
      why: "This moves you toward AI operations without risking unauthorized live-data changes.",
      now: "Create a watch queue that records source, product, claimed data, and confidence.",
      approval: "Approve source-watch design work only. No automatic live edits yet.",
      afterApproval: "Build review cards, then later connect spreadsheet writes behind explicit approval.",
      relatedType: "source_watch"
    }));

    return actions.sort((a, b) => a.rank - b.rank).slice(0, 6);
  }

  function buildTaskSteps(action) {
    const type = action.relatedType || action.kind || "";

    if (type === "data_gap") {
      return [
        "Identify the affected product codes from the audit evidence.",
        "Confirm the source Google Sheet has matching product codes and row data.",
        "Run the correct publish function for the affected sport/year/source.",
        "Rebuild the checklist index if products were added or renamed.",
        "Retest the exact product query in the sandbox ChatBot and live tool after propagation."
      ];
    }

    if (type === "trend_signal") {
      return [
        "Open the latest MLB Early Edge JSON and identify the top player signals.",
        "Map each player to RC years and checklist products.",
        "Find rookie autos, SSP tags, and serial-numbered cards under /100.",
        "Build a sandbox detail card for one player before expanding the model.",
        "Review the result before adding any user-facing ChatBot answer."
      ];
    }

    if (type === "chatbot_intent") {
      return [
        "Create a sandbox test list for PSA 10, rookie auto, 1/1, Superfractor, case hit, and numbered rookie queries.",
        "Map each buyer phrase to the right data path: checklist rows, parallels, PRV, or guidance.",
        "Run product, player, and checklist regression searches after every change.",
        "Keep live ChatBot untouched until the sandbox passes known-good searches.",
        "Prepare a short promotion checklist before moving files live."
      ];
    }

    if (type === "source_watch") {
      return [
        "Define trusted source fields: source, product, sport, claim, date, confidence, and link.",
        "Create review-only source-watch cards in the Command Center.",
        "Compare source claims against current PRV or Checklist Vault data.",
        "Require admin approval before writing to Sheets or publishing JSON.",
        "Log every approved change for later audit."
      ];
    }

    return [
      "Clarify the desired outcome.",
      "Build the smallest safe sandbox version.",
      "Test known user flows.",
      "Ask for admin approval before live promotion."
    ];
  }

  function createOperatorTask(action) {
    const existing = state.tasks.find(task => task.sourceId === action.id);
    if (existing) {
      existing.status = existing.status === "done" ? "queued" : existing.status;
      existing.updatedAt = new Date().toISOString();
      writeTasks();
      return existing;
    }

    const task = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sourceId: action.id,
      title: action.title,
      kind: action.kind,
      severity: action.severity,
      status: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      why: action.why,
      objective: action.afterApproval || action.now,
      steps: buildTaskSteps(action),
      guardrail: "Sandbox/review-only. Do not update live Sheets, GitHub, or Apps Script without a separate approval path."
    };

    state.tasks.unshift(task);
    writeTasks();
    return task;
  }

  function createSourceImportTask(sourceTitle, sport) {
    const action = {
      id: `source|${normalize(sport)}|${normalize(sourceTitle)}`,
      title: `Import missing source product: ${sourceTitle}`,
      kind: "operator",
      severity: "warning",
      relatedType: "data_gap",
      why: "A supported source product was not found in the current Chasing Majors static checklist data.",
      now: "Review the source page, import rows into the correct Google Sheet, publish JSON, and retest search.",
      afterApproval: `Prepare an import task for the ${titleCase(sport)} checklist source and validate the product after publishing.`
    };

    return createOperatorTask(action);
  }

  function findSourceProductMatch(sourceTitle, sport) {
    if (!state.audit || !Array.isArray(state.audit.checklistIndex)) return null;

    const sourceNorm = normalize(sourceTitle);
    const sourceCompact = sourceNorm.replace(/\s+/g, "");
    const candidates = state.audit.checklistIndex
      .filter(item => getProductSport(item) === normalize(sport))
      .map(item => {
        const text = getProductSearchText(item);
        const display = getProductName(item);
        const displayNorm = normalize(display);
        const displayCompact = displayNorm.replace(/\s+/g, "");
        let score = 0;

        if (displayNorm === sourceNorm) score += 200;
        if (displayCompact === sourceCompact) score += 180;
        if (text.includes(sourceNorm)) score += 120;
        if (sourceNorm.includes(displayNorm) && displayNorm.length > 8) score += 80;

        sourceNorm.split(" ").filter(Boolean).forEach(token => {
          if (text.includes(token)) score += 4;
        });

        return { item, score };
      })
      .filter(result => result.score >= 70)
      .sort((a, b) => b.score - a.score);

    return candidates[0] || null;
  }

  function getChecklistProductPayload(code, sport) {
    const productsBySport = state.audit && state.audit.productsBySport;
    return productsBySport && productsBySport[sport] && productsBySport[sport][code];
  }

  function validateSourceProduct() {
    const sourceTitle = String(els.sourceTitleInput.value || "").trim();
    const sport = normalize(els.sourceSportInput.value || "");

    if (!state.audit || !Array.isArray(state.audit.checklistIndex)) {
      renderSourceCheckMessage("Audit still loading", "Wait for System to show Ready, then validate the source again.", "warning");
      return;
    }

    if (!sourceTitle) {
      renderSourceCheckMessage("Missing source title", "Enter the product title from the source page.", "warning");
      return;
    }

    if (!isAllowedSport(sport)) {
      renderSourceCheckMessage("Unsupported sport", "Only baseball, football, basketball, hockey, and soccer are supported.", "critical");
      return;
    }

    if (hasBlockedSourceTerm(sourceTitle)) {
      renderSourceCheckMessage("Ignored source category", "This looks like MMA, WWE, racing, entertainment, or another blocked category. No task created.", "warning");
      return;
    }

    const match = findSourceProductMatch(sourceTitle, sport);

    if (match && match.item) {
      const code = getProductCode(match.item);
      const payload = getChecklistProductPayload(code, sport) || {};
      const rows = Array.isArray(payload.rows) ? payload.rows.length : 0;
      const parallels = Array.isArray(payload.parallels) ? payload.parallels.length : 0;

      els.sourceCheckResult.innerHTML = `
        <div class="source-result-card covered">
          <div class="opp-top">
            <div>
              <h3>Already covered</h3>
              <p>${escapeHtml(getProductName(match.item))}</p>
            </div>
            <span class="badge opportunity">covered</span>
          </div>
          <div class="opp-meta">
            <span class="pill">Sport: ${escapeHtml(titleCase(sport))}</span>
            <span class="pill">Code: ${escapeHtml(code)}</span>
            <span class="pill">Rows: ${formatNumber(rows)}</span>
            <span class="pill">Parallels: ${formatNumber(parallels)}</span>
          </div>
          <p>No Google Sheet update is needed unless the source has newer rows or parallel details than Chasing Majors currently has.</p>
        </div>
      `;
      return;
    }

    const task = createSourceImportTask(sourceTitle, sport);
    renderOperatorTasks();

    els.sourceCheckResult.innerHTML = `
      <div class="source-result-card missing">
        <div class="opp-top">
          <div>
            <h3>Missing from Chasing Majors</h3>
            <p>${escapeHtml(sourceTitle)}</p>
          </div>
          <span class="badge warning">task created</span>
        </div>
        <p>This supported product was not found in live checklist data. I created an Operator Task for review and import planning.</p>
        <div class="opp-meta">
          <span class="pill">Sport: ${escapeHtml(titleCase(sport))}</span>
          <span class="pill">Task: ${escapeHtml(task.status)}</span>
        </div>
      </div>
    `;
  }

  async function validateSourceProductWithBackend() {
    const endpoint = readOperatorEndpoint();
    if (!endpoint) {
      validateSourceProduct();
      return;
    }

    const title = String(els.sourceTitleInput.value || "").trim();
    const sport = normalize(els.sourceSportInput.value || "");

    if (!title) {
      renderSourceCheckMessage("Missing source title", "Enter the product title from the source page.", "warning");
      return;
    }

    renderSourceCheckMessage("Validating source", "Calling the Operator Backend now.", "info");

    try {
      const url = endpoint
        + (endpoint.indexOf("?") > -1 ? "&" : "?")
        + "action=validateSourceProduct"
        + "&title=" + encodeURIComponent(title)
        + "&sport=" + encodeURIComponent(sport);
      const data = await fetchJson(url);
      renderBackendValidationResult(data);
    } catch (err) {
      renderSourceCheckMessage("Backend validation failed", err && err.message ? err.message : String(err), "critical");
    }
  }

  async function runSourceWatchWithBackend(mode) {
    const endpoint = readOperatorEndpoint();
    const auditMode = mode === "quick_json" ? "quick_json" : "deep_sheets";
    const modeLabel = auditMode === "quick_json" ? "Quick JSON Source Watch" : "Deep Sheets Source Watch";

    if (!endpoint) {
      renderSourceCheckMessage(
        "Operator Backend needed",
        "Paste and save the Apps Script Operator Backend URL before running Source Watch. Single-product Source Check still works without it.",
        "warning"
      );
      return;
    }

    renderSourceCheckMessage(
      `Running ${modeLabel}`,
      auditMode === "quick_json"
        ? "The Operator Backend is checking recent Checklistcenter items against public JSON files."
        : "The Operator Backend is checking recent Checklistcenter items against source Google Sheets.",
      "info"
    );

    try {
      const url = endpoint
        + (endpoint.indexOf("?") > -1 ? "&" : "?")
        + "action=sourceWatch"
        + "&mode=" + encodeURIComponent(auditMode);
      const data = await fetchJson(url);
      renderSourceWatchResults(data);
    } catch (err) {
      renderSourceCheckMessage("Source watch failed", err && err.message ? err.message : String(err), "critical");
    }
  }

  async function previewSourceImport(sourceUrl, sport) {
    const endpoint = readOperatorEndpoint();

    if (!endpoint) {
      renderSourceCheckMessage("Operator Backend needed", "Save the Apps Script Operator Backend URL before previewing imports.", "warning");
      return;
    }

    renderSourceCheckMessage("Building import preview", "The Operator Backend is parsing the source page into Chasing Majors rows.", "info");

    try {
      const url = endpoint
        + (endpoint.indexOf("?") > -1 ? "&" : "?")
        + "action=previewSourceImport"
        + "&sourceUrl=" + encodeURIComponent(sourceUrl)
        + "&sport=" + encodeURIComponent(sport || "");
      const data = await fetchJson(url);
      renderImportPreview(data);
    } catch (err) {
      renderSourceCheckMessage("Import preview failed", err && err.message ? err.message : String(err), "critical");
    }
  }

  async function executeSourceImport(sourceUrl, sport) {
    const endpoint = readOperatorEndpoint();
    const key = readOperatorKey();

    if (!endpoint) {
      renderSourceCheckMessage("Operator Backend needed", "Save the Apps Script Operator Backend URL before writing to Sheets.", "warning");
      return;
    }

    if (!key) {
      renderSourceCheckMessage("Admin write key needed", "Enter and save the admin write key before writing to Google Sheets.", "warning");
      return;
    }

    renderSourceCheckMessage("Writing to Google Sheet", "The Operator Backend is updating the mapped source sheet and validating the result.", "info");

    try {
      const url = endpoint
        + (endpoint.indexOf("?") > -1 ? "&" : "?")
        + "action=executeSourceImport"
        + "&sourceUrl=" + encodeURIComponent(sourceUrl)
        + "&sport=" + encodeURIComponent(sport || "")
        + "&key=" + encodeURIComponent(key);
      const data = await fetchJson(url);
      renderExecuteResult(data);
    } catch (err) {
      renderSourceCheckMessage("Sheet write failed", err && err.message ? err.message : String(err), "critical");
    }
  }

  function renderBackendValidationResult(data) {
    if (!data || !data.ok) {
      renderSourceCheckMessage("Validation failed", data && data.error ? data.error : "Unknown backend response.", "critical");
      return;
    }

    if (data.status === "covered") {
      els.sourceCheckResult.innerHTML = `
        <div class="source-result-card covered">
          <div class="opp-top">
            <div>
              <h3>Already covered</h3>
              <p>${escapeHtml(data.matched_name || data.title || "")}</p>
            </div>
            <span class="badge opportunity">covered</span>
          </div>
          <div class="opp-meta">
            <span class="pill">Sport: ${escapeHtml(titleCase(data.sport || ""))}</span>
            <span class="pill">Code: ${escapeHtml(data.matched_code || "")}</span>
            <span class="pill">Score: ${escapeHtml(data.match_score || "")}</span>
          </div>
          <p>${escapeHtml(data.recommended_action || "No import needed unless source details are newer.")}</p>
        </div>
      `;
      return;
    }

    if (data.status === "missing") {
      const task = createSourceImportTask(data.title || els.sourceTitleInput.value, data.sport || els.sourceSportInput.value);
      renderOperatorTasks();
      els.sourceCheckResult.innerHTML = `
        <div class="source-result-card missing">
          <div class="opp-top">
            <div>
              <h3>Missing from Chasing Majors</h3>
              <p>${escapeHtml(data.title || "")}</p>
            </div>
            <span class="badge warning">task created</span>
          </div>
          <p>${escapeHtml(data.recommended_action || "Review source and prepare import.")}</p>
          <div class="opp-meta">
            <span class="pill">Sport: ${escapeHtml(titleCase(data.sport || ""))}</span>
            <span class="pill">Task: ${escapeHtml(task.status)}</span>
          </div>
        </div>
      `;
      return;
    }

    renderSourceCheckMessage(titleCase(data.status || "Needs review"), data.reason || data.recommended_action || "Review source match.", data.status === "ignored" ? "warning" : "info");
  }

  function renderSourceWatchResults(data) {
    if (!data || !data.ok) {
      renderSourceCheckMessage("Source watch failed", data && data.error ? data.error : "Unknown backend response.", "critical");
      return;
    }

    const items = Array.isArray(data.items) ? data.items : [];
    const actionable = items.filter(item => item.status === "missing" || item.status === "needs_review" || item.status === "possible_update");

    els.sourceCheckResult.innerHTML = `
      <div class="source-watch-summary">
        <div class="opp-top">
          <div>
            <h3>${escapeHtml(data.mode === "quick_json" ? "Quick JSON Source Watch Complete" : "Deep Sheets Source Watch Complete")}</h3>
            <p>${escapeHtml(data.fetched_count || 0)} source items checked. ${escapeHtml(actionable.length)} need review.</p>
          </div>
          <span class="badge info">review</span>
        </div>
        <div class="opp-meta">
          <span class="pill">Coverage: ${escapeHtml(data.coverage_source || "unknown")}</span>
          ${Object.keys(data.summary || {}).map(key => `<span class="pill">${escapeHtml(key)}: ${escapeHtml(data.summary[key])}</span>`).join("")}
        </div>
        ${data.next_step ? `<p>${escapeHtml(data.next_step)}</p>` : ""}
      </div>
      <div class="source-watch-list">
        ${items.slice(0, 20).map(renderSourceWatchItem).join("")}
      </div>
    `;

    els.sourceCheckResult.querySelectorAll("[data-source-task]").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.sourceTask || -1);
        const item = items[idx];
        if (!item) return;
        createSourceImportTask(item.title || "Untitled source item", item.sport || "");
        renderOperatorTasks();
        btn.textContent = "Task Created";
        btn.disabled = true;
      });
    });

    els.sourceCheckResult.querySelectorAll("[data-preview-import]").forEach(btn => {
      btn.addEventListener("click", () => {
        previewSourceImport(btn.dataset.previewImport, btn.dataset.previewSport || "");
      });
    });
  }

  function renderSourceWatchItem(item, idx) {
    const status = item.status || "needs_review";
    const badgeClass = status === "covered"
      ? "opportunity"
      : status === "missing"
        ? "warning"
        : status === "ignored"
          ? "info"
          : "warning";
    const canTask = status === "missing" || status === "needs_review" || status === "possible_update";

    return `
      <article class="source-watch-item">
        <div class="opp-top">
          <div>
            <h3>${escapeHtml(item.title || "Untitled")}</h3>
            <p>${escapeHtml(item.recommended_action || item.reason || item.matched_name || "")}</p>
          </div>
          <span class="badge ${badgeClass}">${escapeHtml(status)}</span>
        </div>
        <div class="opp-meta">
          <span class="pill">Sport: ${escapeHtml(titleCase(item.sport || ""))}</span>
          ${item.matched_code ? `<span class="pill">Code: ${escapeHtml(item.matched_code)}</span>` : ""}
          ${item.discovery_source ? `<span class="pill">Found: ${escapeHtml(item.discovery_source)}</span>` : ""}
          ${item.comparison_source ? `<span class="pill">Checked: ${escapeHtml(item.comparison_source)}</span>` : ""}
          ${typeof item.sheet_row_count !== "undefined" ? `<span class="pill">Rows: ${formatNumber(item.sheet_row_count)}</span>` : ""}
          ${typeof item.sheet_parallel_count !== "undefined" ? `<span class="pill">Parallels: ${formatNumber(item.sheet_parallel_count)}</span>` : ""}
          ${item.source_url ? `<a class="pill source-link" href="${escapeHtml(item.source_url)}" target="_blank" rel="noopener noreferrer">Source</a>` : ""}
        </div>
        ${canTask ? `
          <div class="opp-actions">
            <button class="action-btn approve" type="button" data-preview-import="${escapeHtml(item.source_url || "")}" data-preview-sport="${escapeHtml(item.sport || "")}">Preview Import</button>
            <button class="action-btn" type="button" data-source-task="${idx}">Create Operator Task</button>
          </div>
        ` : ""}
      </article>
    `;
  }

  function renderImportPreview(data) {
    if (!data || !data.ok) {
      renderSourceCheckMessage("Preview failed", data && data.error ? data.error : "Unknown backend response.", "critical");
      return;
    }

    if (data.status === "ignored") {
      renderSourceCheckMessage("Ignored source", data.reason || "Unsupported source.", "warning");
      return;
    }

    const product = data.product || {};
    const rows = Array.isArray(data.sample_rows) ? data.sample_rows : [];
    const parallels = Array.isArray(data.sample_parallels) ? data.sample_parallels : [];
    const warnings = Array.isArray(data.warnings) ? data.warnings : [];

    els.sourceCheckResult.innerHTML = `
      <div class="import-preview-card">
        <div class="opp-top">
          <div>
            <h3>Import Preview</h3>
            <p>${escapeHtml(product.display_name || "Untitled product")}</p>
          </div>
          <span class="badge ${data.status === "preview_ready" ? "opportunity" : "warning"}">${escapeHtml(data.status || "preview")}</span>
        </div>
        <div class="opp-meta">
          <span class="pill">Code: ${escapeHtml(product.code || "")}</span>
          <span class="pill">Sport: ${escapeHtml(titleCase(product.sport || ""))}</span>
          <span class="pill">Year: ${escapeHtml(product.year || "")}</span>
          <span class="pill">Rows: ${formatNumber(data.row_count || 0)}</span>
          <span class="pill">Parallels: ${formatNumber(data.parallel_count || 0)}</span>
          <span class="pill">Target: ${escapeHtml(product.target_bucket || "")}</span>
        </div>
        ${warnings.length ? `
          <div class="task-guardrail">${warnings.map(escapeHtml).join(" ")}</div>
        ` : ""}
        <div class="preview-grid">
          <div>
            <h4>Sample Rows</h4>
            ${rows.length ? rows.map(renderPreviewRow).join("") : `<p>No sample rows parsed.</p>`}
          </div>
          <div>
            <h4>Sample Parallels</h4>
            ${parallels.length ? parallels.map(renderPreviewParallel).join("") : `<p>No sample parallels parsed.</p>`}
          </div>
        </div>
        <div class="task-guardrail">Review the sample rows before writing. This action updates matching rows for this product code and appends new rows. It does not delete unrelated sheet data.</div>
        <div class="opp-actions">
          <button class="action-btn approve" type="button" data-execute-import="${escapeHtml(data.source_url || "")}" data-execute-sport="${escapeHtml(product.sport || "")}">Write to Google Sheet</button>
        </div>
      </div>
    `;

    els.sourceCheckResult.querySelectorAll("[data-execute-import]").forEach(btn => {
      btn.addEventListener("click", () => {
        executeSourceImport(btn.dataset.executeImport, btn.dataset.executeSport || "");
      });
    });
  }

  function renderExecuteResult(data) {
    if (!data || !data.ok) {
      renderSourceCheckMessage("Sheet write failed", data && data.error ? data.error : "Unknown backend response.", "critical");
      return;
    }

    const product = data.product || {};
    const validation = data.validation || {};
    const publish = data.publish || {};
    const publishValidation = publish.validation || {};
    const githubValidation = publishValidation.github || {};
    const publicValidation = publishValidation.public || {};
    const checklistVault = publishValidation.checklist_vault || {};
    const chatbot = publishValidation.chatbot || {};
    const publicPassed = !!(checklistVault.ok && chatbot.ok);

    els.sourceCheckResult.innerHTML = `
      <div class="source-result-card covered">
        <div class="opp-top">
          <div>
            <h3>${publish.ok ? "Sheet Updated, JSON Published" : "Google Sheet Updated"}</h3>
            <p>${escapeHtml(product.display_name || "")}</p>
          </div>
          <span class="badge ${(validation.ok && publish.ok && publicPassed) ? "opportunity" : "warning"}">${(validation.ok && publish.ok && publicPassed) ? "validated" : "review"}</span>
        </div>
        <div class="opp-meta">
          <span class="pill">Target: ${escapeHtml(data.target_bucket || "")}</span>
          <span class="pill">Product rows: ${formatNumber(validation.product_rows || 0)}</span>
          <span class="pill">Checklist rows: ${formatNumber(validation.checklist_rows || 0)}</span>
          <span class="pill">Parallels: ${formatNumber(validation.parallel_rows || 0)}</span>
        </div>
        <div class="opp-meta">
          <span class="pill">GitHub publish: ${publish.ok ? "Complete" : "Needs review"}</span>
          <span class="pill">GitHub rows: ${formatNumber(githubValidation.row_count || 0)}</span>
          <span class="pill">GitHub parallels: ${formatNumber(githubValidation.parallel_count || 0)}</span>
          <span class="pill">Public rows: ${formatNumber(publicValidation.row_count || 0)}</span>
          <span class="pill">Public parallels: ${formatNumber(publicValidation.parallel_count || 0)}</span>
          <span class="pill">CV: ${checklistVault.ok ? "Passed" : "Review"}</span>
          <span class="pill">ChatBot: ${chatbot.ok ? "Passed" : "Review"}</span>
        </div>
        ${publish.error ? `<div class="task-guardrail">${escapeHtml(publish.error)}</div>` : ""}
        ${(publish.ok && !publicPassed) ? `<div class="task-guardrail">GitHub JSON is published. GitHub Pages may still be deploying, so public CV and ChatBot validation can lag behind the repo by a few minutes.</div>` : ""}
        <p>${escapeHtml(data.next_step || "Validate Checklist Vault and ChatBot search.")}</p>
        <div class="opp-actions">
          ${publish.checklist_url ? `<a class="action-btn approve" href="${escapeHtml(publish.checklist_url)}" target="_blank" rel="noopener noreferrer">Open Checklist Vault Test</a>` : ""}
          ${publish.chatbot_url ? `<a class="action-btn" href="${escapeHtml(publish.chatbot_url)}" target="_blank" rel="noopener noreferrer">Open ChatBot Test</a>` : ""}
        </div>
      </div>
    `;
  }

  function renderPreviewRow(row) {
    return `
      <div class="preview-row">
        <strong>${escapeHtml(row.card_no || "")}</strong>
        <span>${escapeHtml(row.player || "")}</span>
        <em>${escapeHtml(row.team || "")}</em>
      </div>
    `;
  }

  function renderPreviewParallel(row) {
    return `
      <div class="preview-row">
        <strong>${escapeHtml(row.parallel_name || "")}</strong>
        <span>${escapeHtml(row.applies_to_subset || "")}</span>
        <em>${escapeHtml(row.serial_no || "")}</em>
      </div>
    `;
  }

  function renderSourceCheckMessage(title, detail, severity) {
    const badgeClass = severity === "critical" ? "critical" : severity === "warning" ? "warning" : "info";
    els.sourceCheckResult.innerHTML = `
      <div class="source-result-card">
        <div class="opp-top">
          <div>
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(detail)}</p>
          </div>
          <span class="badge ${badgeClass}">${escapeHtml(severity || "info")}</span>
        </div>
      </div>
    `;
  }

  function setTaskStatus(taskId, status) {
    const task = state.tasks.find(item => item.id === taskId);
    if (!task) return;
    task.status = status;
    task.updatedAt = new Date().toISOString();
    writeTasks();
    renderOperatorTasks();
  }

  function clearDoneTasks() {
    state.tasks = state.tasks.filter(task => task.status !== "done");
    writeTasks();
    renderOperatorTasks();
  }

  async function runAudit() {
    setLoading();

    try {
      const [
        checklistIndexPayload,
        bundleData,
        vaultData,
        releasePayload,
        earlySignalsPayload
      ] = await Promise.all([
        fetchJson(`${DATA_BASE}/checklists/index.json`),
        fetchProductBundles(),
        fetchVaultProducts(),
        fetchJson(RELEASE_URL),
        fetchJson(`${DATA_BASE}/players/mlb-early-signals.json`).catch(() => ({ signals: [] }))
      ]);

      const checklistIndex = checklistIndexPayload.index || checklistIndexPayload.rows || [];
      const releaseRows = releasePayload.rows || [];
      const vaultIndex = Object.keys(vaultData.products || {}).map(code => {
        const product = vaultData.products[code] || {};
        const meta = product.meta || product;
        return {
          code,
          name: meta.displayName || meta.display_name || meta.name || product.displayName || product.name || code,
          sport: meta.sport || product.sport || ""
        };
      });

      const checklistAudit = auditChecklistProducts(checklistIndex, bundleData);
      const releaseAudit = auditReleaseSchedule(releaseRows, checklistIndex, vaultIndex);
      const intentOpportunities = buildIntentOpportunities();
      const sourceOpportunities = buildSourceWatchOpportunities();
      const edgeOpportunities = buildEdgeOpportunities(earlySignalsPayload);

      const opportunities = [
        ...checklistAudit.opportunities,
        ...releaseAudit.opportunities,
        ...intentOpportunities,
        ...sourceOpportunities,
        ...edgeOpportunities
      ];

      const audit = {
        generatedAt: new Date(),
        checklistCount: checklistIndex.length,
        vaultCount: vaultIndex.length,
        releaseCount: releaseRows.length,
        checklistIndex,
        productsBySport: bundleData.productsBySport,
        bundleErrors: bundleData.errors.length,
        vaultErrors: vaultData.errors.length,
        checklistStats: checklistAudit.stats,
        releaseStats: releaseAudit.stats,
        earlySignals: earlySignalsPayload
      };

      state.opportunities = opportunities;
      state.audit = audit;
      render();
    } catch (err) {
      renderError(err);
    }
  }

  function setLoading() {
    els.systemState.textContent = "Auditing";
    els.opportunityCount.textContent = "-";
    els.criticalCount.textContent = "-";
    els.lastAudit.textContent = "-";
    els.nextActionList.innerHTML = `<div class="skeleton-card"></div>`;
    els.briefList.innerHTML = `<div class="skeleton-line"></div><div class="skeleton-line short"></div>`;
    els.opportunityList.innerHTML = `<div class="skeleton-card"></div><div class="skeleton-card"></div>`;
  }

  function renderError(err) {
    els.systemState.textContent = "Error";
    els.briefList.innerHTML = `
      <div class="brief-item">
        <strong>Audit could not complete</strong>
        <span>${escapeHtml(err && err.message ? err.message : String(err))}</span>
      </div>
    `;
    els.opportunityList.innerHTML = "";
  }

  function getVisibleOpportunities() {
    const filter = els.typeFilter.value || "all";
    if (filter === "all") return state.opportunities;
    if (filter === "critical") return state.opportunities.filter(o => o.severity === "critical");
    return state.opportunities.filter(o => o.type === filter);
  }

  function render() {
    const opportunities = state.opportunities;
    const critical = opportunities.filter(o => o.severity === "critical");

    els.systemState.textContent = "Ready";
    els.opportunityCount.textContent = formatNumber(opportunities.length);
    els.criticalCount.textContent = formatNumber(critical.length);
    els.lastAudit.textContent = state.audit.generatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

    renderBrief();
    renderNextActions();
    renderOperatorTasks();
    renderOpportunities();
    renderDataHealth();
    renderEdgeSignals();
    renderBuildTargets();
  }

  function renderNextActions() {
    const actions = buildNextActions(state.opportunities, state.audit);

    els.nextActionList.innerHTML = actions.map(action => {
      const status = getActionStatus(action.id);
      const badgeClass = action.severity === "critical"
        ? "critical"
        : action.severity === "warning"
          ? "warning"
          : action.severity === "opportunity"
            ? "opportunity"
            : "info";

      return `
        <article class="next-action-card">
          <div class="next-rank">${action.rank}</div>
          <div class="next-body">
            <div class="opp-top">
              <div>
                <div class="next-kind">${escapeHtml(action.kind)}</div>
                <h3>${escapeHtml(action.title)}</h3>
                <p>${escapeHtml(action.summary)}</p>
              </div>
              <span class="badge ${badgeClass}">${escapeHtml(action.severity)}</span>
            </div>
            <div class="next-plan">
              <div>
                <strong>Why it matters</strong>
                <span>${escapeHtml(action.why)}</span>
              </div>
              <div>
                <strong>Do now</strong>
                <span>${escapeHtml(action.now)}</span>
              </div>
              <div>
                <strong>Needs your approval</strong>
                <span>${escapeHtml(action.approval)}</span>
              </div>
              <div>
                <strong>After approval</strong>
                <span>${escapeHtml(action.afterApproval)}</span>
              </div>
            </div>
            <div class="opp-meta">
              <span class="pill">Status: ${escapeHtml(titleCase(status))}</span>
              ${action.relatedType ? `<span class="pill">Queue: ${escapeHtml(action.relatedType)}</span>` : ""}
            </div>
            <div class="opp-actions">
              <button class="action-btn approve" type="button" data-id="${escapeHtml(action.id)}" data-action="approved">Approve Next Step</button>
              <button class="action-btn" type="button" data-id="${escapeHtml(action.id)}" data-action="review">Needs Review</button>
              <button class="action-btn ignore" type="button" data-id="${escapeHtml(action.id)}" data-action="ignored">Skip For Now</button>
            </div>
          </div>
        </article>
      `;
    }).join("");

    els.nextActionList.querySelectorAll("[data-action]").forEach(btn => {
      btn.addEventListener("click", () => {
        state.approvals[btn.dataset.id] = btn.dataset.action;
        if (btn.dataset.action === "approved") {
          const action = actions.find(item => item.id === btn.dataset.id);
          if (action) createOperatorTask(action);
        }
        writeApprovals();
        renderNextActions();
        renderOperatorTasks();
      });
    });
  }

  function renderOperatorTasks() {
    if (!state.tasks.length) {
      els.operatorTaskList.innerHTML = `
        <div class="brief-item">
          <strong>No approved tasks yet</strong>
          <span>Approve a next step to create the first operator task.</span>
        </div>
      `;
      return;
    }

    els.operatorTaskList.innerHTML = state.tasks.map(task => {
      const badgeClass = task.status === "done"
        ? "opportunity"
        : task.status === "ready"
          ? "warning"
          : "info";

      return `
        <article class="operator-task-card">
          <div class="opp-top">
            <div>
              <div class="next-kind">${escapeHtml(task.kind || "operator")}</div>
              <h3>${escapeHtml(task.title)}</h3>
              <p>${escapeHtml(task.objective || "")}</p>
            </div>
            <span class="badge ${badgeClass}">${escapeHtml(task.status)}</span>
          </div>
          <div class="task-guardrail">${escapeHtml(task.guardrail)}</div>
          <div class="task-steps">
            ${task.steps.map((step, idx) => `
              <div class="task-step">
                <strong>${idx + 1}</strong>
                <span>${escapeHtml(step)}</span>
              </div>
            `).join("")}
          </div>
          <div class="opp-actions">
            <button class="action-btn" type="button" data-task-id="${escapeHtml(task.id)}" data-task-status="ready">Mark Ready For Build</button>
            <button class="action-btn approve" type="button" data-task-id="${escapeHtml(task.id)}" data-task-status="done">Mark Done</button>
            <button class="action-btn ignore" type="button" data-task-id="${escapeHtml(task.id)}" data-task-status="queued">Back To Queue</button>
          </div>
        </article>
      `;
    }).join("");

    els.operatorTaskList.querySelectorAll("[data-task-status]").forEach(btn => {
      btn.addEventListener("click", () => {
        setTaskStatus(btn.dataset.taskId, btn.dataset.taskStatus);
      });
    });
  }

  function renderBrief() {
    const items = summarizeBrief(state.opportunities, state.audit);
    els.briefList.innerHTML = items.map(item => `
      <div class="brief-item">
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.detail)}</span>
      </div>
    `).join("");
  }

  function renderOpportunities() {
    const visible = getVisibleOpportunities();

    if (!visible.length) {
      els.opportunityList.innerHTML = `
        <div class="brief-item">
          <strong>No matching opportunities</strong>
          <span>Change the filter or rerun the audit.</span>
        </div>
      `;
      return;
    }

    els.opportunityList.innerHTML = visible.map(renderOpportunityCard).join("");
    els.opportunityList.querySelectorAll("[data-action]").forEach(btn => {
      btn.addEventListener("click", () => {
        state.approvals[btn.dataset.id] = btn.dataset.action;
        writeApprovals();
        renderOpportunities();
      });
    });
  }

  function renderOpportunityCard(item) {
    const status = state.approvals[item.id] || "new";
    const badgeClass = item.severity === "critical"
      ? "critical"
      : item.severity === "warning"
        ? "warning"
        : item.severity === "opportunity"
          ? "opportunity"
          : "info";

    return `
      <article class="opportunity-card">
        <div class="opp-top">
          <div>
            <h3>${escapeHtml(item.title)}</h3>
            <p>${escapeHtml(item.why)}</p>
          </div>
          <span class="badge ${badgeClass}">${escapeHtml(item.severity)}</span>
        </div>
        <div class="opp-meta">
          <span class="pill">Type: ${escapeHtml(item.type)}</span>
          <span class="pill">Confidence: ${escapeHtml(item.confidence)}</span>
          <span class="pill">Risk: ${escapeHtml(item.risk)}</span>
          <span class="pill">Status: ${escapeHtml(titleCase(status))}</span>
        </div>
        ${item.evidence && item.evidence.length ? `
          <div>
            <p><strong>Evidence</strong></p>
            <p>${item.evidence.slice(0, 8).map(escapeHtml).join(" | ")}</p>
          </div>
        ` : ""}
        <div>
          <p><strong>Suggested action</strong></p>
          <p>${escapeHtml(item.suggestedAction)}</p>
        </div>
        <div class="opp-actions">
          <button class="action-btn approve" type="button" data-id="${escapeHtml(item.id)}" data-action="approved">Approve Idea</button>
          <button class="action-btn" type="button" data-id="${escapeHtml(item.id)}" data-action="review">Needs Review</button>
          <button class="action-btn ignore" type="button" data-id="${escapeHtml(item.id)}" data-action="ignored">Ignore</button>
        </div>
      </article>
    `;
  }

  function renderDataHealth() {
    const audit = state.audit;
    const rows = [
      ["Checklist products", audit.checklistCount],
      ["PRV products", audit.vaultCount],
      ["Release rows", audit.releaseCount],
      ["Missing bundle mappings", audit.checklistStats.missingManifest],
      ["Empty checklist products", audit.checklistStats.emptyRows],
      ["Products without parallels", audit.checklistStats.noParallels]
    ];

    els.dataHealthStats.innerHTML = rows.map(([label, value]) => `
      <div class="metric-row">
        <span>${escapeHtml(label)}</span>
        <strong>${formatNumber(value)}</strong>
      </div>
    `).join("");
  }

  function renderEdgeSignals() {
    const payload = state.audit.earlySignals || {};
    const signals = Array.isArray(payload.signals) ? payload.signals : Array.isArray(payload.players) ? payload.players : [];

    if (!signals.length) {
      els.edgeSignals.innerHTML = `
        <div class="signal-row">
          <strong>No Early Edge data loaded</strong>
          <span>Run MLB stats publish to regenerate early signals.</span>
        </div>
      `;
      return;
    }

    els.edgeSignals.innerHTML = signals.slice(0, 6).map(signal => {
      const name = signal.playerName || signal.name || signal.player || "Unnamed player";
      const reason = signal.summary || signal.reason || signal.signal || "Recent RC player signal available.";
      return `
        <div class="signal-row">
          <strong>${escapeHtml(name)}</strong>
          <span>${escapeHtml(reason)}</span>
        </div>
      `;
    }).join("");
  }

  function renderBuildTargets() {
    const targets = [
      ["Query failure loop", "Pull Master Logger failures into this approval queue."],
      ["WaxMetrix connector", "Detect PRV source updates and compare against current rows."],
      ["Checklist Center connector", "Detect new checklist and parallel source pages."],
      ["Auto-retest", "Run fixed queries in sandbox before live promotion."],
      ["Edge detail pages", "Turn player momentum into card target recommendations."]
    ];

    els.buildTargets.innerHTML = targets.map(([title, detail]) => `
      <div class="target-row">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(detail)}</span>
      </div>
    `).join("");
  }

  els.refreshBtn.addEventListener("click", runAudit);
  els.clearDoneBtn.addEventListener("click", clearDoneTasks);
  els.sourceCheckBtn.addEventListener("click", validateSourceProductWithBackend);
  els.sourceWatchQuickBtn.addEventListener("click", () => runSourceWatchWithBackend("quick_json"));
  els.sourceWatchDeepBtn.addEventListener("click", () => runSourceWatchWithBackend("deep_sheets"));
  els.saveEndpointBtn.addEventListener("click", () => {
    writeOperatorEndpoint(els.operatorEndpointInput.value || "");
    writeOperatorKey(els.operatorKeyInput.value || "");
    renderSourceCheckMessage("Endpoint saved", "Command Center will use this Operator Backend URL and admin key for approved operator actions.", "info");
  });
  els.sourceTitleInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      validateSourceProductWithBackend();
    }
  });
  els.operatorEndpointInput.value = readOperatorEndpoint();
  els.operatorKeyInput.value = readOperatorKey();
  els.typeFilter.addEventListener("change", renderOpportunities);
  runAudit();
})();
