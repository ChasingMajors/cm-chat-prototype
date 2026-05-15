(function () {
  const DATA_BASE = "https://app.chasingmajors.com/data/v1";
  const RELEASE_URL = "https://app.chasingmajors.com/data/v2/releases/schedule.json";
  const SPORTS = ["baseball", "basketball", "football", "hockey", "soccer"];
  const APPROVAL_KEY = "cm_command_center_opportunity_status_v1";

  const state = {
    opportunities: [],
    audit: null,
    approvals: readApprovals()
  };

  const els = {
    refreshBtn: document.getElementById("refreshBtn"),
    typeFilter: document.getElementById("typeFilter"),
    systemState: document.getElementById("systemState"),
    opportunityCount: document.getElementById("opportunityCount"),
    criticalCount: document.getElementById("criticalCount"),
    lastAudit: document.getElementById("lastAudit"),
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
    renderOpportunities();
    renderDataHealth();
    renderEdgeSignals();
    renderBuildTargets();
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
  els.typeFilter.addEventListener("change", renderOpportunities);
  runAudit();
})();
