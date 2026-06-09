(function () {
  const COMMAND_CENTER_VERSION = "cc111-agentic-repair-loop-v1-2026-06-09";
  const DATA_BASE = "https://app.chasingmajors.com/data/v1";
  const RELEASE_URL = "https://app.chasingmajors.com/data/v2/releases/schedule.json";
  const SPORTS = ["baseball", "basketball", "football", "hockey", "soccer"];
  const BLOCKED_SOURCE_TERMS = ["mma", "ufc", "wwe", "wrestling", "racing", "nascar", "f1", "formula 1", "pokemon", "marvel", "disney", "star wars"];
  const APPROVAL_KEY = "cm_command_center_opportunity_status_v1";
  const TASK_KEY = "cm_command_center_operator_tasks_v1";
  const AGENT_ACTION_KEY = "cm_command_center_agent_actions_v1";
  const AGENT_RUN_QUEUE_KEY = "cm_command_center_agent_run_queue_v1";
  const ACTIVITY_LOG_KEY = "cm_command_center_activity_log_v1";
  const AUTONOMY_MODE_KEY = "cm_command_center_autonomy_mode_v1";
  const VISUAL_TEST_KEY = "cm_command_center_visual_tests_v1";
  const SENTINEL_SELF_TEST_KEY = "cm_command_center_sentinel_self_test_v1";
  const KNOWN_ISSUE_KEY = "cm_command_center_known_issues_v1";
  const SOURCE_IGNORE_KEY = "cm_command_center_source_ignores_v1";
  const OPERATOR_ENDPOINT_KEY = "cm_command_center_operator_endpoint_v1";
  const OPERATOR_WRITE_KEY = "cm_command_center_operator_write_key_v1";
  const AUTOMATION_GUARDRAILS = [
    {
      title: "Product-scoped writes only",
      detail: "Sheet writes must target one product code and may append/update matching rows only. No whole-sheet replacement."
    },
    {
      title: "No delete-first workflows",
      detail: "The agent must not clear tabs, delete unrelated rows, or rewrite entire files unless the admin explicitly approves a destructive maintenance task."
    },
    {
      title: "Source and sport filter required",
      detail: "Imports must come from approved sports-card sources and only baseball, football, basketball, hockey, or soccer."
    },
    {
      title: "Google Sheets before public JSON",
      detail: "Source-of-truth Sheets must validate row counts and section names before JSON publish is considered complete."
    },
    {
      title: "Publish must validate",
      detail: "After a write, the agent must publish JSON and validate Checklist Vault and ChatBot behavior, allowing for GitHub Pages propagation."
    },
    {
      title: "Known issues stay visible",
      detail: "Failures can be marked as known issues, but they stay in the queue until fixed or intentionally deferred."
    }
  ];

  const state = {
    opportunities: [],
    audit: null,
    approvals: readApprovals(),
    tasks: readTasks(),
    agentActions: readJsonStore(AGENT_ACTION_KEY, []),
    agentRunQueue: readJsonStore(AGENT_RUN_QUEUE_KEY, []),
    activityLog: readJsonStore(ACTIVITY_LOG_KEY, []),
    autonomyMode: readAutonomyMode(),
    visualTests: readJsonStore(VISUAL_TEST_KEY, {}),
    sentinelSelfTest: readJsonStore(SENTINEL_SELF_TEST_KEY, null),
    knownIssues: readJsonStore(KNOWN_ISSUE_KEY, {}),
    sourceIgnores: readJsonStore(SOURCE_IGNORE_KEY, {}),
    visualPollTimers: {},
    sentinelSelfTestTimer: null,
    backendMemorySaveTimer: null,
    backendMemorySaving: false,
    backendMemorySuspendAutoSave: false,
    backendMemoryAutoLoaded: false
  };

  const els = {
    refreshBtn: document.getElementById("refreshBtn"),
    clearDoneBtn: document.getElementById("clearDoneBtn"),
    syncPrvJsonBtn: document.getElementById("syncPrvJsonBtn"),
    publicToolAuditBtn: document.getElementById("publicToolAuditBtn"),
    publicToolAuditPanelBtn: document.getElementById("publicToolAuditPanelBtn"),
    sentinelSelfTestBtn: document.getElementById("sentinelSelfTestBtn"),
    clearResolvedAgentActionsBtn: document.getElementById("clearResolvedAgentActionsBtn"),
    clearActivityLogBtn: document.getElementById("clearActivityLogBtn"),
    exportMemoryBtn: document.getElementById("exportMemoryBtn"),
    importMemoryInput: document.getElementById("importMemoryInput"),
    saveBackendMemoryBtn: document.getElementById("saveBackendMemoryBtn"),
    loadBackendMemoryBtn: document.getElementById("loadBackendMemoryBtn"),
    clearSourceIgnoresBtn: document.getElementById("clearSourceIgnoresBtn"),
    clearMemoryBtn: document.getElementById("clearMemoryBtn"),
    memoryStatus: document.getElementById("memoryStatus"),
    autonomyModeSelect: document.getElementById("autonomyModeSelect"),
    sourceCheckBtn: document.getElementById("sourceCheckBtn"),
    scanSourcesBtn: document.getElementById("scanSourcesBtn"),
    scanPrvSourcesBtn: document.getElementById("scanPrvSourcesBtn"),
    agentCycleBtn: document.getElementById("agentCycleBtn"),
    backendAgentSweepBtn: document.getElementById("backendAgentSweepBtn"),
    installDailyAgentTriggerBtn: document.getElementById("installDailyAgentTriggerBtn"),
    sourceWatchQuickBtn: document.getElementById("sourceWatchQuickBtn"),
    sourceWatchDeepBtn: document.getElementById("sourceWatchDeepBtn"),
    prvSourceWatchBtn: document.getElementById("prvSourceWatchBtn"),
    saveEndpointBtn: document.getElementById("saveEndpointBtn"),
    sourceTitleInput: document.getElementById("sourceTitleInput"),
    sourceSportInput: document.getElementById("sourceSportInput"),
    operatorEndpointInput: document.getElementById("operatorEndpointInput"),
    operatorKeyInput: document.getElementById("operatorKeyInput"),
    sentinelCommandInput: document.getElementById("sentinelCommandInput"),
    sentinelCommandBtn: document.getElementById("sentinelCommandBtn"),
    sentinelNotice: document.getElementById("sentinelNotice"),
    typeFilter: document.getElementById("typeFilter"),
    systemState: document.getElementById("systemState"),
    autonomyState: document.getElementById("autonomyState"),
    autonomyReadiness: document.getElementById("autonomyReadiness"),
    buildVersion: document.getElementById("buildVersion"),
    opportunityCount: document.getElementById("opportunityCount"),
    criticalCount: document.getElementById("criticalCount"),
    lastAudit: document.getElementById("lastAudit"),
    nextActionList: document.getElementById("nextActionList"),
    agentActionList: document.getElementById("agentActionList"),
    activityLogList: document.getElementById("activityLogList"),
    runSummaryList: document.getElementById("runSummaryList"),
    readyExecuteList: document.getElementById("readyExecuteList"),
    reviewHoldList: document.getElementById("reviewHoldList"),
    guardrailList: document.getElementById("guardrailList"),
    operatorTaskList: document.getElementById("operatorTaskList"),
    sourceCheckResult: document.getElementById("sourceCheckResult"),
    publicToolAuditResult: document.getElementById("publicToolAuditResult"),
    briefList: document.getElementById("briefList"),
    opportunityList: document.getElementById("opportunityList"),
    dataHealthStats: document.getElementById("dataHealthStats"),
    edgeSignals: document.getElementById("edgeSignals"),
    buildTargets: document.getElementById("buildTargets")
  };

  if (els.buildVersion) els.buildVersion.textContent = COMMAND_CENTER_VERSION;

  window.addEventListener("error", event => {
    const detail = event && event.message ? event.message : "Unknown Command Center runtime error.";
    if (els.systemState) els.systemState.textContent = "Error";
    if (els.briefList) {
      els.briefList.innerHTML = `
        <div class="brief-item">
          <strong>Command Center runtime error</strong>
          <span>${escapeHtml(detail)}</span>
        </div>
      `;
    }
  });

  window.addEventListener("unhandledrejection", event => {
    const reason = event && event.reason;
    const detail = reason && reason.message ? reason.message : String(reason || "Unknown async error.");
    if (els.systemState) els.systemState.textContent = "Error";
    if (els.briefList) {
      els.briefList.innerHTML = `
        <div class="brief-item">
          <strong>Command Center async error</strong>
          <span>${escapeHtml(detail)}</span>
        </div>
      `;
    }
  });

  function readApprovals() {
    return readJsonStore(APPROVAL_KEY, {});
  }

  function writeApprovals() {
    try {
      localStorage.setItem(APPROVAL_KEY, JSON.stringify(state.approvals));
    } catch (err) {}
    scheduleBackendMemorySave();
  }

  function writeSentinelSelfTest() {
    try {
      localStorage.setItem(SENTINEL_SELF_TEST_KEY, JSON.stringify(state.sentinelSelfTest || null));
    } catch (err) {}
  }

  function readTasks() {
    return readJsonStore(TASK_KEY, []);
  }

  function writeTasks() {
    try {
      localStorage.setItem(TASK_KEY, JSON.stringify(state.tasks));
    } catch (err) {}
    scheduleBackendMemorySave();
  }

  function readAutonomyMode() {
    try {
      return String(localStorage.getItem(AUTONOMY_MODE_KEY) || "approval_required").trim() || "approval_required";
    } catch (err) {
      return "approval_required";
    }
  }

  function writeAutonomyMode(value) {
    state.autonomyMode = String(value || "approval_required").trim() || "approval_required";
    try {
      localStorage.setItem(AUTONOMY_MODE_KEY, state.autonomyMode);
    } catch (err) {}
    scheduleBackendMemorySave();
  }

  function readJsonStore(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    } catch (err) {
      return fallback;
    }
  }

  function writeVisualTests() {
    try {
      localStorage.setItem(VISUAL_TEST_KEY, JSON.stringify(state.visualTests));
    } catch (err) {}
    scheduleBackendMemorySave();
  }

  function writeKnownIssues() {
    try {
      localStorage.setItem(KNOWN_ISSUE_KEY, JSON.stringify(state.knownIssues));
    } catch (err) {}
    scheduleBackendMemorySave();
  }

  function writeSourceIgnores() {
    try {
      localStorage.setItem(SOURCE_IGNORE_KEY, JSON.stringify(state.sourceIgnores));
    } catch (err) {}
    scheduleBackendMemorySave();
  }

  function writeAgentActions() {
    try {
      localStorage.setItem(AGENT_ACTION_KEY, JSON.stringify(state.agentActions));
    } catch (err) {}
    scheduleBackendMemorySave();
  }

  function writeAgentRunQueue() {
    try {
      localStorage.setItem(AGENT_RUN_QUEUE_KEY, JSON.stringify(state.agentRunQueue || []));
    } catch (err) {}
    scheduleBackendMemorySave();
  }

  function writeActivityLog() {
    try {
      localStorage.setItem(ACTIVITY_LOG_KEY, JSON.stringify(state.activityLog.slice(0, 80)));
    } catch (err) {}
    scheduleBackendMemorySave();
  }

  function focusSourceCheckResult() {
    if (!els.sourceCheckResult) return;
    setTimeout(() => {
      els.sourceCheckResult.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
      els.sourceCheckResult.classList.remove("source-check-focus");
      void els.sourceCheckResult.offsetWidth;
      els.sourceCheckResult.classList.add("source-check-focus");
      setTimeout(() => {
        if (els.sourceCheckResult) els.sourceCheckResult.classList.remove("source-check-focus");
      }, 1800);
    }, 60);
  }

  function writeAllAgentMemory() {
    writeApprovals();
    writeTasks();
    writeAgentActions();
    writeAgentRunQueue();
    writeActivityLog();
    writeVisualTests();
    writeKnownIssues();
    writeSourceIgnores();
    writeAutonomyMode(state.autonomyMode);
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
      const sessionValue = String(sessionStorage.getItem(OPERATOR_WRITE_KEY) || "").trim();
      if (sessionValue) return sessionValue;

      const legacyValue = String(localStorage.getItem(OPERATOR_WRITE_KEY) || "").trim();
      if (legacyValue) {
        sessionStorage.setItem(OPERATOR_WRITE_KEY, legacyValue);
        localStorage.removeItem(OPERATOR_WRITE_KEY);
        return legacyValue;
      }
    } catch (err) {}
    return "";
  }

  function writeOperatorKey(value) {
    try {
      const nextValue = String(value || "").trim();
      if (nextValue) sessionStorage.setItem(OPERATOR_WRITE_KEY, nextValue);
      else sessionStorage.removeItem(OPERATOR_WRITE_KEY);
      localStorage.removeItem(OPERATOR_WRITE_KEY);
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

  function inferChecklistBucket(productName, sport) {
    const raw = String(productName || "");
    const season = raw.match(/\b(20\d{2})\s*-\s*(\d{2})\b/);
    if (season) return `${season[1]}-${season[2]}`;

    const year = raw.match(/\b(19|20)\d{2}\b/);
    if (year) return year[0];

    const s = normalize(sport);
    if (s === "basketball" || s === "soccer") return "";
    return "";
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

  function getVisualProductKey(planOrItem) {
    const sport = normalize(planOrItem && (planOrItem.sport || planOrItem.selected_sport || ""));
    const code = String(planOrItem && (planOrItem.code || planOrItem.Code || planOrItem.matched_code || "") || "").trim();
    const name = normalize(planOrItem && (planOrItem.productName || planOrItem.name || planOrItem.matched_name || planOrItem.title || ""));
    return [sport, code || name].filter(Boolean).join("|");
  }

  function buildSourceIgnoreKey(input) {
    const sport = normalize(input && input.sport);
    const sourceUrl = normalize(input && (input.sourceUrl || input.source_url || input.url || input.runUrl || ""));
    const product = normalize(input && (input.product || input.title || input.matched_name || ""));
    return [sport, sourceUrl || product].filter(Boolean).join("|");
  }

  function buildSourceProductIgnoreKey(input) {
    const sport = normalize(input && input.sport);
    const code = normalize(input && (input.code || input.matched_code || ""));
    const product = normalize(input && (input.product || input.title || input.matched_name || ""));
    return [sport, code || product].filter(Boolean).join("|");
  }

  function isSourceIgnored(input) {
    const key = buildSourceIgnoreKey(input);
    const productKey = buildSourceProductIgnoreKey(input);
    return !!(state.sourceIgnores && ((key && state.sourceIgnores[key]) || (productKey && state.sourceIgnores[productKey])));
  }

  function getVisualStatusLabel(record) {
    if (!record) return "Not run";
    if (record.knownIssue) return "Known issue";
    const result = String(record.result || record.conclusion || record.status || "").toLowerCase();
    if (result === "passed" || result === "success") return "Passed";
    if (result === "failed" || result === "failure") return "Failed";
    if (result === "completed") return record.conclusion ? titleCase(record.conclusion) : "Completed";
    if (result === "in_progress" || result === "running") return "Running";
    if (result === "queued") return "Queued";
    return titleCase(result || "Not run");
  }

  function getVisualStatusClass(record) {
    if (!record) return "info";
    if (record.knownIssue) return "warning";
    const result = String(record.result || record.conclusion || record.status || "").toLowerCase();
    if (result === "passed" || result === "success") return "opportunity";
    if (result === "failed" || result === "failure") return "critical";
    if (result === "queued" || result === "in_progress" || result === "running") return "info";
    return "info";
  }

  function isTerminalVisualRecord(record) {
    const result = String(record && (record.result || record.conclusion || record.status) || "").toLowerCase();
    return result === "passed" || result === "success" || result === "failed" || result === "failure";
  }

  function saveVisualRecord(plan, patch) {
    const key = getVisualProductKey(plan);
    if (!key) return null;

    const existing = state.visualTests[key] || {};
    const known = state.knownIssues[key] || null;
    const record = Object.assign({}, existing, patch || {}, {
      key,
      productName: plan.productName || existing.productName || "",
      sport: plan.sport || existing.sport || "",
      code: plan.code || existing.code || "",
      updatedAt: new Date().toISOString(),
      knownIssue: !!known,
      knownIssueNote: known ? known.note || "" : ""
    });

    state.visualTests[key] = record;
    writeVisualTests();
    return record;
  }

  function scheduleVisualStatusPoll(plan, attempt) {
    const key = getVisualProductKey(plan);
    if (!key) return;

    const record = state.visualTests[key] || {};
    if (isTerminalVisualRecord(record)) return;

    const nextAttempt = Number(attempt || 1);
    if (nextAttempt > 10) return;

    if (state.visualPollTimers[key]) {
      clearTimeout(state.visualPollTimers[key]);
    }

    const delayMs = nextAttempt === 1 ? 15000 : 25000;
    state.visualPollTimers[key] = setTimeout(() => {
      delete state.visualPollTimers[key];
      refreshAgentVisualTestStatus(plan, {
        silent: true,
        pollAttempt: nextAttempt
      });
    }, delayMs);
  }

  function getAgentActionStatusLabel(status) {
    return titleCase(String(status || "queued").replace(/_/g, " "));
  }

  function getAgentActionDisplayStatus(action) {
    const posture = getActionExecutionPosture(action);
    const status = String(action && action.status || "").toLowerCase();
    if (isPendingVisualValidationAction(action)) return "Validate";
    if (posture.label === "Validate" && status !== "validated") return "Validate";
    if (status === "fix_applied") return "Retest Needed";
    if (status === "fix_attempted") return "Fix Attempted";
    return getAgentActionStatusLabel(status || "queued");
  }

  function getAgentActionBadgeClass(action) {
    const status = String(action && action.status || "").toLowerCase();
    const posture = typeof getActionExecutionPosture === "function" ? getActionExecutionPosture(action) : null;
    if (posture && posture.label === "Validate") return "warning";
    if (status === "validated" || status === "done") return "opportunity";
    if (status === "failed" || status === "blocked") return "critical";
    if (status === "known_issue" || status === "needs_admin" || status === "approval_required" || status === "fix_queued" || status === "fix_applied" || status === "fix_attempted" || status === "pending_visual_validation") return "warning";
    return "info";
  }

  function isResolvedAgentAction(action) {
    const status = String(action && action.status || "").toLowerCase();
    return status === "validated" || status === "done" || status === "ignored";
  }

  function isPendingPublicValidationAction(action) {
    return String(action && action.status || "").toLowerCase() === "pending_public_validation";
  }

  function isPendingVisualValidationAction(action) {
    return String(action && action.status || "").toLowerCase() === "pending_visual_validation";
  }

  function getActiveAgentActions() {
    return (state.agentActions || []).filter(action => !isResolvedAgentAction(action));
  }

  function getResolvedAgentActions() {
    return (state.agentActions || []).filter(isResolvedAgentAction);
  }

  function normalizeRunQueue() {
    const seen = new Set();
    state.agentRunQueue = (Array.isArray(state.agentRunQueue) ? state.agentRunQueue : [])
      .map(id => String(id || "").trim())
      .filter(id => {
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    return state.agentRunQueue;
  }

  function isActionInRunQueue(actionId) {
    const id = String(actionId || "").trim();
    if (!id) return false;
    return normalizeRunQueue().includes(id);
  }

  function addActionToRunQueue(actionId) {
    const id = String(actionId || "").trim();
    const action = state.agentActions.find(item => item.id === id);
    if (!action || isResolvedAgentAction(action)) return null;
    normalizeRunQueue();
    if (!state.agentRunQueue.includes(id)) {
      state.agentRunQueue.unshift(id);
      writeAgentRunQueue();
    }
    logActivity({
      type: "agent_run_queue",
      status: "queued",
      product: action.product || "",
      source: "admin",
      title: "Added to Agent Run Queue",
      detail: `${action.product || action.type || "Action"} will be attempted by Run Agent Cycle. Queueing is admin intent for the next product-scoped step.`
    });
    renderAgentActions();
    renderActionLanes();
    renderActivityLog();
    updateMemoryStatus("Action added to Agent Run Queue.", "queued");
    return action;
  }

  function isRunQueueApprovalEligible(action) {
    const type = String(action && action.type || "").toLowerCase();
    if (type !== "source_import" && type !== "checklist_publish" && type !== "prv_source_review" && type !== "prv_publish" && type !== "backend_data_issue") return false;
    if (!action.product && !action.code) return false;
    return true;
  }

  function applyRunQueueApproval(action) {
    if (!action || !isRunQueueApprovalEligible(action)) return action;
    const status = String(action.status || "").toLowerCase();
    if (status !== "needs_admin" && status !== "approval_required" && status !== "ready") return action;

    const approved = updateAgentAction(action.id, {
      status: "approved",
      adminDecision: "run_queue_approved",
      executionResult: action.executionResult || "Admin Run Queue approval recorded.",
      validationResult: action.validationResult || "Sentinel may attempt the next product-scoped safe step."
    });

    logActivity({
      type: "agent_run_queue",
      status: "approved",
      product: action.product || "",
      source: "admin_run_queue",
      title: "Run Queue approval applied",
      detail: `${action.product || action.code || action.type} was approved because admin flagged it for the run queue.`
    });

    return approved || action;
  }

  function removeActionFromRunQueue(actionId, options) {
    const opts = options || {};
    const id = String(actionId || "").trim();
    const before = normalizeRunQueue().length;
    state.agentRunQueue = state.agentRunQueue.filter(item => item !== id);
    if (state.agentRunQueue.length !== before) {
      writeAgentRunQueue();
      if (!opts.silent) {
        const action = state.agentActions.find(item => item.id === id);
        logActivity({
          type: "agent_run_queue",
          status: "removed",
          product: action && action.product || "",
          source: opts.source || "admin",
          title: "Removed from Agent Run Queue",
          detail: `${action && (action.product || action.type) || "Action"} was removed from the explicit run queue.`
        });
        renderActivityLog();
      }
    }
  }

  function clearResolvedRunQueueItems() {
    const before = normalizeRunQueue().length;
    const activeIds = new Set(getActiveAgentActions().map(action => action.id));
    state.agentRunQueue = state.agentRunQueue.filter(id => activeIds.has(id));
    if (state.agentRunQueue.length !== before) writeAgentRunQueue();
  }

  function getQueuedAgentActions(limit) {
    clearResolvedRunQueueItems();
    const max = Math.max(1, Math.min(20, Number(limit || 10)));
    return normalizeRunQueue()
      .map(id => state.agentActions.find(action => action.id === id))
      .filter(action => action && !isResolvedAgentAction(action))
      .slice(0, max);
  }

  function renderAgentRunQueueSummary() {
    clearResolvedRunQueueItems();
    const queuedActions = getQueuedAgentActions(12);
    if (!queuedActions.length) return "";

    return `
      <div class="brief-item agent-run-queue-summary">
        <strong>Admin Run Queue: ${formatNumber(queuedActions.length)} flagged job${queuedActions.length === 1 ? "" : "s"}</strong>
        <span>Run Agent Cycle will attempt these first, then fall back to normal source watch and validation work.</span>
        <div class="opp-meta run-queue-meta">
          ${queuedActions.slice(0, 8).map(action => `
            <span class="pill">${escapeHtml(action.product || action.code || action.type || "Action")} · ${escapeHtml(getAgentActionDisplayStatus(action))}</span>
          `).join("")}
        </div>
      </div>
    `;
  }

  function getAutonomyLabel(mode) {
    const labels = {
      review_only: "Review only",
      approval_required: "Approval required",
      guarded_auto: "Guarded auto",
      full_auto: "Full auto"
    };
    return labels[mode] || labels.approval_required;
  }

  function buildAgentActionId(input) {
    return [
      normalize(input.type || "action"),
      normalize(input.source || ""),
      normalize(input.product || input.title || ""),
      normalize(input.code || "")
    ].filter(Boolean).join("|").slice(0, 180);
  }

  function sameProductAction(action, input) {
    if (!action || !input) return false;
    const actionSport = normalize(action.sport || "");
    const inputSport = normalize(input.sport || "");
    if (actionSport && inputSport && actionSport !== inputSport) return false;

    const actionCode = String(action.code || "").trim();
    const inputCode = String(input.code || input.matched_code || "").trim();
    if (actionCode && inputCode && actionCode === inputCode) return true;

    const actionProduct = normalize(action.product || "");
    const inputProduct = normalize(input.product || input.title || input.matched_name || "");
    return !!(actionProduct && inputProduct && actionProduct === inputProduct);
  }

  function findProductAction(input, preferredType) {
    const matches = (state.agentActions || []).filter(action => sameProductAction(action, input));
    if (preferredType) {
      const preferred = matches.find(action => action.type === preferredType);
      if (preferred) return preferred;
    }
    return matches[0] || null;
  }

  function findResolvedProductAction(input, preferredType) {
    const matches = (state.agentActions || []).filter(action => isResolvedAgentAction(action) && sameProductAction(action, input));
    if (preferredType) {
      const preferred = matches.find(action => action.type === preferredType);
      if (preferred) return preferred;
    }
    return matches[0] || null;
  }

  function pruneDuplicateProductActions(primaryAction) {
    if (!primaryAction) return;
    const primaryId = primaryAction.id;
    const before = state.agentActions.length;
    state.agentActions = (state.agentActions || []).filter(action => {
      if (!action || action.id === primaryId) return true;
      if (!sameProductAction(action, primaryAction)) return true;
      const primaryType = String(primaryAction.type || "");
      const actionType = String(action.type || "");
      return !(primaryType === "checklist_publish" && actionType === "source_import");
    });
    if (state.agentActions.length !== before) writeAgentActions();
  }

  function collapseDuplicateAgentActions() {
    const publishActions = (state.agentActions || []).filter(action => action && action.type === "checklist_publish");
    if (!publishActions.length) return;

    const before = state.agentActions.length;
    state.agentActions = state.agentActions.filter(action => {
      if (!action || action.type !== "source_import") return true;
      return !publishActions.some(publishAction => sameProductAction(publishAction, action));
    });
    if (state.agentActions.length !== before) writeAgentActions();
  }

  function upsertAgentAction(input) {
    const now = new Date().toISOString();
    const id = input.id || buildAgentActionId(input);
    const existing = state.agentActions.find(item => item.id === id) ||
      (input.type === "source_import" ? findProductAction(input, "checklist_publish") : null);
    const base = {
      id,
      type: input.type || "operator",
      source: input.source || "command_center",
      product: input.product || "",
      sport: input.sport || "",
      code: input.code || "",
      riskLevel: input.riskLevel || "medium",
      status: input.status || "queued",
      recommendedAction: input.recommendedAction || "",
      adminDecision: input.adminDecision || "",
      executionResult: input.executionResult || "",
      validationResult: input.validationResult || "",
      runUrl: input.runUrl || "",
      sourceUrl: input.sourceUrl || "",
      bucket: input.bucket || "",
      targetBucket: input.targetBucket || input.bucket || "",
      expectedRowCount: Number(input.expectedRowCount || input.expected_row_count || 0),
      expectedParallelCount: Number(input.expectedParallelCount || input.expected_parallel_count || 0),
      createdAt: now,
      updatedAt: now
    };

    if (existing && input.type === "source_import" && existing.type === "checklist_publish") {
      Object.assign(existing, {
        sourceUrl: existing.sourceUrl || input.sourceUrl || "",
        runUrl: existing.runUrl || input.runUrl || "",
        updatedAt: now
      });
      writeAgentActions();
      return existing;
    }

    if (existing) {
      Object.assign(existing, base, {
        createdAt: existing.createdAt || now,
        updatedAt: now
      });
      writeAgentActions();
      return existing;
    }

    state.agentActions.unshift(base);
    state.agentActions = state.agentActions.slice(0, 80);
    writeAgentActions();
    return base;
  }

  function queueSourceWatchActions(items, auditMode) {
    const skippedIgnored = (Array.isArray(items) ? items : []).filter(isSourceIgnored).length;
    let skippedResolved = 0;
    const actionable = (Array.isArray(items) ? items : []).filter(item => {
      if (isSourceIgnored(item)) return false;
      if (
        item.status !== "missing" &&
        item.status !== "needs_review" &&
        item.status !== "possible_update" &&
        item.status !== "known_issue"
      ) {
        return false;
      }

      const isPrv = item.target_tool === "prv";
      const input = {
        type: isPrv ? "prv_source_review" : "source_import",
        product: item.matched_name || item.title || "",
        title: item.title || "",
        sport: item.sport || "",
        code: item.matched_code || "",
        matched_code: item.matched_code || "",
        sourceUrl: item.source_url || item.url || "",
        url: item.url || ""
      };
      const resolved = findResolvedProductAction(input, isPrv ? "prv_source_review" : "");
      if (resolved) {
        skippedResolved += 1;
        return false;
      }

      return true;
    });

    let createdOrUpdated = 0;
    actionable.forEach(item => {
      const isPrv = item.target_tool === "prv";
      const action = upsertAgentAction({
        type: isPrv ? "prv_source_review" : "source_import",
        source: item.discovery_source || auditMode || "source_watch",
        product: item.matched_name || item.title || "Untitled source item",
        sport: item.sport || "",
        code: item.matched_code || "",
        riskLevel: item.status === "missing" ? "medium" : "low",
        status: item.status === "known_issue" ? "known_issue" : "approval_required",
        recommendedAction: item.recommended_action || (isPrv
          ? "Review source post, compare against PRV, then prepare update/build task if numbers are missing or stale."
          : "Preview source import, write product-scoped rows, publish JSON, validate CV/ChatBot."),
        executionResult: item.status === "known_issue" ? "Source was scanned and held before auto execution." : "",
        validationResult: item.status === "known_issue" ? (item.blocked_reason || item.reason || "Known source issue.") : "",
        sourceUrl: item.source_url || item.url || ""
      });
      if (action) createdOrUpdated += 1;
    });

    if (createdOrUpdated) {
      logActivity({
        type: "source_watch",
        status: "queued",
        source: auditMode || "source_watch",
        title: "Source Watch actions queued",
        detail: `${createdOrUpdated} findings are now visible in the Agent Action Queue for admin review.${skippedIgnored ? " " + skippedIgnored + " admin-ignored source item(s) were skipped." : ""}${skippedResolved ? " " + skippedResolved + " already-resolved item(s) were skipped." : ""}`
      });
    } else if (skippedIgnored || skippedResolved) {
      logActivity({
        type: "source_watch",
        status: skippedIgnored ? "ignored" : "validated",
        source: auditMode || "source_watch",
        title: "Source Watch skipped clean items",
        detail: `${skippedIgnored ? skippedIgnored + " admin-ignored source item(s)" : ""}${skippedIgnored && skippedResolved ? " and " : ""}${skippedResolved ? skippedResolved + " already-resolved item(s)" : ""} were omitted from the queue.`
      });
    }

    return createdOrUpdated;
  }

  function queueDeepBackendAuditIssues(issues) {
    const actionable = Array.isArray(issues) ? issues : [];
    let createdOrUpdated = 0;

    actionable.forEach(issue => {
      const staleJson = issue.type === "stale_public_json" || issue.status === "pending_public_validation";
      const action = upsertAgentAction({
        id: issue.id || "",
        type: staleJson ? "source_import" : "backend_data_issue",
        source: "deep_backend_audit",
        product: issue.product || issue.matched_name || "Backend data issue",
        sport: issue.sport || "",
        code: issue.code || issue.matched_code || "",
        bucket: issue.bucket || "",
        targetBucket: issue.bucket || "",
        riskLevel: issue.severity === "high" ? "high" : issue.severity === "low" ? "low" : "medium",
        status: staleJson ? "pending_public_validation" : "needs_admin",
        recommendedAction: issue.recommended_action || "Review the source data, fix the issue, publish JSON, and validate the public tools.",
        expectedRowCount: issue.expected_row_count || issue.expectedRowCount || 0,
        expectedParallelCount: issue.expected_parallel_count || issue.expectedParallelCount || 0,
        executionResult: staleJson
          ? "Deep backend audit found source Sheet counts ahead of public JSON."
          : issue.title || "Deep backend audit found a source-of-truth issue.",
        validationResult: issue.detail || issue.reason || "",
        sourceUrl: issue.source_url || ""
      });
      if (action) createdOrUpdated += 1;
    });

    if (createdOrUpdated) {
      logActivity({
        type: "deep_backend_audit",
        status: "queued",
        source: "operator_backend",
        title: "Backend audit issues queued",
        detail: `${createdOrUpdated} audit finding${createdOrUpdated === 1 ? "" : "s"} added to the Agent Action Queue.`
      });
    }

    return createdOrUpdated;
  }

  async function runDeepBackendAuditWithBackend(options) {
    options = options || {};
    const endpoint = readOperatorEndpoint();
    if (!endpoint) {
      renderSourceCheckMessage(
        "Operator Backend needed",
        "Save the Apps Script Operator Backend URL before running Deep Sheets Audit.",
        "warning",
        { noFocus: !!options.noFocus }
      );
      if (options.noFocus) renderSentinelNotice("Operator Backend needed", "Save the Operator Backend URL before Sentinel can audit source Sheets.", "warning");
      return { ok: false, kind: "deep_backend_audit", error: "Operator Backend URL missing." };
    }

    renderSourceCheckMessage(
      "Running Deep Sheets Audit",
      "Sentinel is comparing source Google Sheets against public JSON. This is read-only and will not write Sheets or publish files.",
      "info",
      { noFocus: !!options.noFocus }
    );
    logActivity({
      type: "deep_backend_audit",
      status: "started",
      source: "command_center",
      title: "Deep Sheets Audit started",
      detail: "Comparing configured source Google Sheets against public checklist JSON. No writes will run."
    });
    renderActivityLog();

    try {
      const data = await postOperatorJson(endpoint, {
        action: "runDeepBackendAudit"
      }, { timeoutMs: 240000 });

      if (!data || !data.ok) {
        throw new Error(data && data.error ? data.error : "Deep backend audit failed.");
      }

      const issues = Array.isArray(data.issues) ? data.issues : [];
      const queued = queueDeepBackendAuditIssues(issues);
      const summary = data.summary || {};
      const detail = `${formatNumber(summary.sheet_products || 0)} Sheet products checked against ${formatNumber(summary.public_products || 0)} public JSON products. ${formatNumber(issues.length)} issue${issues.length === 1 ? "" : "s"} found. ${formatNumber(queued)} queue card${queued === 1 ? "" : "s"} updated.`;

      renderDeepBackendAuditResults(data, queued);
      logActivity({
        type: "deep_backend_audit",
        status: issues.length ? "needs_review" : "validated",
        source: "operator_backend",
        title: "Deep Sheets Audit complete",
        detail
      });
      renderActivityLog();
      renderAgentActions();
      renderActionLanes();
      renderRunSummary();
      if (options.noFocus) {
        renderSentinelNotice("Deep Sheets Audit complete", detail, issues.length ? "warning" : "success");
      }
      return {
        ok: true,
        kind: "deep_backend_audit",
        issues: issues.length,
        queued,
        summary
      };
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      renderSourceCheckMessage("Deep Sheets Audit failed", message, "critical", { noFocus: !!options.noFocus });
      if (options.noFocus) renderSentinelNotice("Deep Sheets Audit failed", message, "critical");
      logActivity({
        type: "deep_backend_audit",
        status: "failed",
        source: "operator_backend",
        title: "Deep Sheets Audit failed",
        detail: message
      });
      renderActivityLog();
      return { ok: false, kind: "deep_backend_audit", error: message };
    }
  }

  function renderDeepBackendAuditResults(data, queuedCount) {
    if (!els.sourceCheckResult) return;
    const issues = Array.isArray(data && data.issues) ? data.issues : [];
    const summary = data && data.summary ? data.summary : {};
    const topIssues = issues.slice(0, 20);
    els.sourceCheckResult.innerHTML = `
      <div class="source-watch-summary">
        <div class="opp-top">
          <div>
            <h3>Deep Sheets Audit Complete</h3>
            <p>${escapeHtml(formatNumber(summary.sheet_products || 0))} Sheet products checked against ${escapeHtml(formatNumber(summary.public_products || 0))} public JSON products.</p>
          </div>
          <span class="badge ${issues.length ? "warning" : "opportunity"}">${issues.length ? "needs review" : "clear"}</span>
        </div>
        <div class="opp-meta">
          <span class="pill">Read-only</span>
          <span class="pill">Issues: ${escapeHtml(formatNumber(issues.length))}</span>
          <span class="pill">Queued: ${escapeHtml(formatNumber(queuedCount || 0))}</span>
          <span class="pill">Missing JSON: ${escapeHtml(formatNumber(summary.missing_public_json || 0))}</span>
          <span class="pill">Stale JSON: ${escapeHtml(formatNumber(summary.stale_public_json || 0))}</span>
          <span class="pill">Duplicates: ${escapeHtml(formatNumber(summary.duplicate_codes || 0))}</span>
          <span class="pill">Empty products: ${escapeHtml(formatNumber(summary.empty_sheet_products || 0))}</span>
        </div>
        <p>${escapeHtml(data.next_step || "Review findings in the Agent Action Queue.")}</p>
      </div>
      <div class="source-watch-list">
        ${topIssues.length ? topIssues.map(renderDeepBackendAuditIssue).join("") : `
          <div class="source-watch-item">
            <strong>No backend issues found</strong>
            <p>Source Google Sheets and public JSON are aligned for this audit pass.</p>
          </div>
        `}
      </div>
    `;
  }

  function renderDeepBackendAuditIssue(issue) {
    const severity = issue.severity === "high" ? "critical" : issue.severity === "low" ? "info" : "warning";
    return `
      <div class="source-watch-item">
        <div class="opp-top">
          <div>
            <strong>${escapeHtml(issue.product || issue.title || "Backend data issue")}</strong>
            <p>${escapeHtml(issue.title || issue.type || "Issue found")}</p>
          </div>
          <span class="badge ${severity}">${escapeHtml(issue.severity || "review")}</span>
        </div>
        <p>${escapeHtml(issue.detail || issue.reason || "")}</p>
        <div class="opp-meta">
          ${issue.sport ? `<span class="pill">Sport: ${escapeHtml(titleCase(issue.sport))}</span>` : ""}
          ${issue.code ? `<span class="pill">Code: ${escapeHtml(issue.code)}</span>` : ""}
          ${issue.bucket ? `<span class="pill">Bucket: ${escapeHtml(issue.bucket)}</span>` : ""}
        </div>
      </div>
    `;
  }

  function rememberResolvedSourceAction(action) {
    if (!action) return false;
    const keys = [buildSourceIgnoreKey(action), buildSourceProductIgnoreKey(action)].filter(Boolean);
    if (!keys.length) return false;

    keys.forEach(key => {
      state.sourceIgnores[key] = {
      product: action.product || "",
      sport: action.sport || "",
      code: action.code || "",
      sourceUrl: action.sourceUrl || action.runUrl || "",
      reason: "Resolved or validated by admin. Future source scans should not requeue this exact source/product unless source ignores are cleared.",
      ignoredAt: new Date().toISOString(),
      resolved: true
      };
    });
    return true;
  }

  function autoResolveCoveredSourceCheck(data) {
    if (!data || data.status !== "covered") return 0;

    const input = {
      type: "source_import",
      product: data.matched_name || data.title || "",
      title: data.matched_name || data.title || "",
      sport: data.sport || "",
      code: data.matched_code || "",
      matched_code: data.matched_code || "",
      sourceUrl: data.source_url || data.url || "",
      url: data.url || ""
    };

    let resolvedCount = 0;
    (state.agentActions || []).forEach(action => {
      if (!action) return;
      const type = String(action.type || "").toLowerCase();
      const status = String(action.status || "").toLowerCase();
      if (status === "validated" || status === "ignored") return;
      if (type !== "source_import" && type !== "checklist_publish") return;
      if (!sameProductAction(action, input)) return;

      Object.assign(action, {
        status: "validated",
        adminDecision: action.adminDecision || "auto_validated_covered",
        executionResult: "Source Check confirmed this product is already covered.",
        validationResult: `Already covered in Chasing Majors as ${data.matched_code || action.code || data.matched_name || action.product}. No import needed.`,
        recommendedAction: "No action needed unless the source has newer rows/parallels than Chasing Majors.",
        updatedAt: new Date().toISOString()
      });
      rememberResolvedSourceAction(action);
      resolvedCount += 1;
    });

    if (resolvedCount) {
      writeAgentActions();
      writeSourceIgnores();
      logActivity({
        type: "agent_action",
        status: "validated",
        product: data.matched_name || data.title || "",
        source: "operator_backend",
        title: "Covered product auto-resolved",
        detail: `${resolvedCount} matching queue card${resolvedCount === 1 ? "" : "s"} cleared because Source Check confirmed coverage.`
      });
      renderAgentActions();
      renderActionLanes();
      renderActivityLog();
    }

    return resolvedCount;
  }

  function removeAndRememberAgentAction(id) {
    const action = state.agentActions.find(item => item.id === id);
    if (!action) return;
    const remembered = rememberResolvedSourceAction(action);
    if (remembered) writeSourceIgnores();
    state.agentActions = state.agentActions.filter(item => item.id !== id);
    removeActionFromRunQueue(id, { silent: true, source: "admin" });
    writeAgentActions();
    logActivity({
      type: "agent_action",
      status: "removed",
      product: action.product || "",
      source: "admin",
      title: "Agent action removed",
      detail: `${action.product || action.type || "Action"} was removed and remembered so future scans do not requeue it.`
    });
    renderAgentActions();
    renderActionLanes();
    renderActivityLog();
    updateMemoryStatus("Action removed and remembered.", "admin rule");
  }

  function updateAgentAction(id, patch) {
    const action = state.agentActions.find(item => item.id === id);
    if (!action) return null;
    Object.assign(action, patch || {}, { updatedAt: new Date().toISOString() });
    writeAgentActions();
    return action;
  }

  function ignoreFutureSourceAction(id) {
    const action = state.agentActions.find(item => item.id === id);
    if (!action) return null;

    const key = buildSourceIgnoreKey(action);
    if (!key) return action;

    state.sourceIgnores[key] = {
      product: action.product || "",
      sport: action.sport || "",
      code: action.code || "",
      sourceUrl: action.sourceUrl || action.runUrl || "",
      reason: "Admin marked this exact source product as fringe or intentionally skipped.",
      ignoredAt: new Date().toISOString()
    };
    writeSourceIgnores();

    updateAgentAction(id, {
      status: "ignored",
      adminDecision: "ignored",
      executionResult: "Admin ignored this exact source product. Future Source Watch runs will omit it unless source ignores are cleared.",
      validationResult: "No app change needed."
    });

    logActivity({
      type: "source_watch",
      status: "ignored",
      product: action.product,
      source: "admin",
      title: "Source product ignored",
      detail: `${action.product || "Source product"} will be skipped in future Source Watch queues.`
    });

    return action;
  }

  function logActivity(input) {
    const entry = {
      id: "log_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
      ts: new Date().toISOString(),
      type: input.type || "info",
      title: input.title || "Agent activity",
      detail: input.detail || "",
      status: input.status || "",
      product: input.product || "",
      source: input.source || ""
    };

    state.activityLog.unshift(entry);
    state.activityLog = state.activityLog.slice(0, 80);
    writeActivityLog();
    if (!input.noAutoSave) scheduleBackendMemorySave();
    return entry;
  }

  function upsertPrvSyncIncident(detail, options) {
    const opts = options || {};
    const recovered = opts.status === "validated";
    const action = upsertAgentAction({
      id: "prv_sync_incident_full_vault",
      type: "prv_sync_incident",
      source: opts.source || "operator_backend",
      product: "Print Run Vault JSON Sync",
      sport: "",
      code: "prv_full_sync",
      riskLevel: "high",
      status: opts.status || "failed",
      recommendedAction: opts.recommendedAction || (recovered
        ? "PRV sync recovered and validated by the agent."
        : "Run Agent Cycle to let Sentinel retry PRV JSON sync once. If it fails again, check the Static Data Exporter URL, Apps Script execution log, and GitHub publish permissions."),
      executionResult: opts.executionResult || "PRV full JSON sync failed.",
      validationResult: opts.validationResult || detail || "No recovery proof yet.",
      runUrl: opts.runUrl || ""
    });

    logActivity({
      type: "prv_sync_incident",
      status: action.status || "failed",
      product: action.product,
      source: opts.source || "operator_backend",
      title: recovered ? "PRV sync incident recovered" : "PRV sync incident created",
      detail: detail || action.validationResult
    });

    renderAgentActions();
    renderActionLanes();
    renderActivityLog();
    return action;
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

  function stripYearFromProductName(value) {
    return String(value || "")
      .replace(/\b(19|20)\d{2}(?:-\d{2})?\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildShortProductQuery(name) {
    const withoutYear = stripYearFromProductName(name);
    const withoutMaker = withoutYear
      .replace(/\b(Topps|Panini|Upper Deck|Bowman|Leaf)\b/i, "")
      .replace(/\s+/g, " ")
      .trim();
    const year = String(name || "").match(/\b(19|20)\d{2}(?:-\d{2})?\b/);
    return [year ? year[0] : "", withoutMaker].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }

  function buildVisualTestPlan(item) {
    const productName = String(item.matched_name || item.productName || item.title || "").trim();
    const code = String(item.matched_code || item.code || "").trim();
    const sport = normalize(item.sport || "");
    const shortQuery = buildShortProductQuery(productName);
    const ambiguousQuery = stripYearFromProductName(productName);
    const chatbotQueries = [
      productName,
      shortQuery,
      `Show me ${productName} checklist`,
      `${productName} details`,
      ambiguousQuery
    ].filter(Boolean).filter((query, index, arr) => arr.indexOf(query) === index);
    const checklistQueries = [
      {
        label: "Checklist Vault - All Sports",
        url: `https://app.chasingmajors.com/checklists/?refresh=1&q=${encodeURIComponent(productName)}`
      },
      {
        label: `Checklist Vault - ${titleCase(sport || "Sport")} Filter`,
        url: `https://app.chasingmajors.com/checklists/?refresh=1&sport=${encodeURIComponent(sport)}&q=${encodeURIComponent(productName)}`
      }
    ];

    return {
      productName,
      code,
      sport,
      chatbotQueries,
      checklistQueries,
      expectedExact: [
        "Product Profile appears",
        productName + " appears",
        "No error card appears",
        "No stuck Thinking state"
      ],
      expectedAmbiguous: [
        "If multiple years exist, ChatBot asks which product to use",
        "Choices include the current product and nearby years when available",
        "If this is the only backend match, direct product profile is acceptable"
      ],
      expectedChecklist: [
        "Dropdown finds the product",
        "Selected product loads Checklist Vault",
        "Checklist sections appear when data exists",
        "No broken loading state or unexpected No rows found message"
      ]
    };
  }

  function buildVisualTestPlanFromAction(action) {
    const plan = buildVisualTestPlan({
      matched_name: action && action.product,
      title: action && action.product,
      matched_code: action && action.code,
      sport: action && action.sport
    });
    plan.sourceActionId = action && action.id ? action.id : "";
    return plan;
  }

  function findRelatedProductAction(plan) {
    const matches = findRelatedProductActions(plan);
    return matches.find(action => action.type === "checklist_publish") || matches[0] || null;
  }

  function findRelatedProductActions(plan) {
    let direct = null;
    if (plan && plan.sourceActionId) {
      direct = state.agentActions.find(action => action.id === plan.sourceActionId) || null;
    }

    const sport = normalize(plan && plan.sport);
    const code = String(plan && plan.code || "").trim();
    const product = normalize(plan && plan.productName);
    const matches = state.agentActions.filter(action => {
      const type = String(action.type || "").toLowerCase();
      if (type !== "source_import" && type !== "checklist_publish" && type !== "visual_test") return false;
      if (sport && normalize(action.sport) !== sport) return false;
      if (code && String(action.code || "").trim() === code) return true;
      return product && normalize(action.product) === product;
    });

    if (direct && !matches.some(action => action.id === direct.id)) matches.unshift(direct);
    return matches;
  }

  function updateRelatedProductActionFromVisual(plan, result, runUrl) {
    const actions = findRelatedProductActions(plan);
    if (!actions.length) return null;

    const normalized = String(result || "").toLowerCase();
    const isPassed = normalized === "passed" || normalized === "success";
    const isFailed = normalized === "failed" || normalized === "failure";

    actions.forEach(action => {
      const priorValidation = String(action.validationResult || "");
      const hasCoverage = priorValidation.toLowerCase().includes("public json covered");
      const pendingPrefix = hasCoverage ? priorValidation.replace(/\s*Visual CV\/ChatBot proof still pending\.?/i, "").trim() : "";

      const validationResult = isPassed
        ? `${pendingPrefix ? pendingPrefix + " " : ""}CV and ChatBot passed via visual test.`.trim()
        : isFailed
          ? `${pendingPrefix ? pendingPrefix + " " : ""}CV/ChatBot visual test failed. Review the GitHub Actions report.`
          : `${pendingPrefix ? pendingPrefix + " " : ""}CV/ChatBot visual test queued or running.`;

      updateAgentAction(action.id, {
        status: isPassed ? "validated" : isFailed ? "failed" : "queued",
        validationResult: validationResult,
        recommendedAction: isFailed
          ? "Review failed visual report, identify whether Checklist Vault or ChatBot broke, then prepare a product/query-specific fix."
          : isPassed
            ? "No action needed. Sheet write, JSON coverage, and CV/ChatBot visual validation are complete."
            : "CV/ChatBot visual test is queued or running. Sentinel will refresh it on the next Agent Cycle.",
        runUrl: runUrl || action.runUrl || ""
      });

      if (isFailed && !state.tasks.some(task => task.sourceId === action.id && task.kind === "fix")) {
        createFixTaskFromAgentAction(Object.assign({}, action, {
          status: "failed",
          validationResult,
          runUrl: runUrl || action.runUrl || ""
        }));
      }
    });

    if (isPassed) {
      logActivity({
        type: "agent_action",
        status: "validated",
        product: plan.productName || "",
        source: "github_actions",
        title: "Product action validated",
        detail: `${actions.length} matching queue item${actions.length === 1 ? "" : "s"} now have visual proof.`
      });
    } else if (isFailed) {
      logActivity({
        type: "operator_task",
        status: "queued",
        product: plan.productName || "",
        source: "github_actions",
        title: "Repair task created from visual failure",
        detail: "Sentinel created a fix task so the failed CV/ChatBot behavior has a clear repair path."
      });
    }

    return actions;
  }

  function isAllowedSport(value) {
    return SPORTS.includes(normalize(value));
  }

  function hasBlockedSourceTerm(value) {
    const text = normalize(value);
    return BLOCKED_SOURCE_TERMS.some(term => {
      const normalizedTerm = normalize(term);
      if (!normalizedTerm) return false;
      return (` ${text} `).includes(` ${normalizedTerm} `);
    });
  }

  async function fetchJson(url, options) {
    const opts = options || {};
    const controller = new AbortController();
    const timeoutMs = Number(opts.timeoutMs || 15000);
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        cache: opts.cache || "default",
        signal: controller.signal
      });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await res.json();
    } catch (err) {
      if (err && err.name === "AbortError") throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s: ${url}`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function postOperatorJson(endpoint, payload, options) {
    const opts = options || {};
    const controller = new AbortController();
    const timeoutMs = Number(opts.timeoutMs || 60000);
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload || {}),
        signal: controller.signal
      });
      if (!res.ok) throw new Error(`${res.status} ${endpoint}`);
      return await res.json();
    } catch (err) {
      if (err && err.name === "AbortError") throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s: ${endpoint}`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchProductBundles(options) {
    const opts = options || {};
    const manifests = {};
    const productsBySport = {};
    const errors = [];

    await Promise.all(SPORTS.map(async sport => {
      try {
        const manifest = await fetchJson(`${DATA_BASE}/checklists/products/${sport}.json`, { timeoutMs: 10000 });
        manifests[sport] = manifest;
        productsBySport[sport] = {};
        if (opts.manifestOnly) return;

        const shardNames = Array.from(new Set(Object.values(manifest.product_map || manifest.productMap || {}))).filter(Boolean);
        const shardResults = await Promise.allSettled(shardNames.map(async shard => {
          const data = await fetchJson(`${DATA_BASE}/checklists/products/${shard}`, { timeoutMs: 10000 });
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

    return { manifests, productsBySport, errors, manifestOnly: !!opts.manifestOnly };
  }

  async function fetchVaultProducts(options) {
    const opts = options || {};
    const manifest = await fetchJson(`${DATA_BASE}/vault/products/all.json`, { timeoutMs: 10000 });
    const productMap = manifest.product_map || manifest.productMap || {};
    const products = {};
    const errors = [];
    const shardNames = Array.from(new Set(Object.values(productMap))).filter(Boolean);

    if (opts.manifestOnly) {
      return {
        manifest,
        products,
        productMap,
        errors,
        manifestOnly: true
      };
    }

    const results = await Promise.allSettled(shardNames.map(async shard => {
      const data = await fetchJson(`${DATA_BASE}/vault/products/${shard}`, { timeoutMs: 10000 });
      return { shard, data };
    }));

    results.forEach(result => {
      if (result.status === "fulfilled") {
        Object.assign(products, result.value.data.products || {});
      } else {
        errors.push(result.reason && result.reason.message ? result.reason.message : String(result.reason));
      }
    });

    return { manifest, products, productMap, errors, manifestOnly: false };
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
      const product = bundleData.manifestOnly ? null : bundleData.productsBySport[sport] && bundleData.productsBySport[sport][code];

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

      if (bundleData.manifestOnly) return;

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
        missingBundle: bundleData.manifestOnly ? "Deep only" : missingBundle.length,
        emptyRows: bundleData.manifestOnly ? "Deep only" : emptyRows.length,
        noParallels: bundleData.manifestOnly ? "Deep only" : noParallels.length
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

    if (!audit) {
      items.push({
        title: "Fast audit starting",
        detail: "Command Center is loading lightweight index and manifest data now."
      });
      if (source) {
        items.push({
          title: "Source-watch connectors are ready",
          detail: "Use Scan New Checklists for live Checklist Center review while the dashboard audit loads."
        });
      }
      return items;
    }

    if (audit.auditErrors && audit.auditErrors.length) {
      items.push({
        title: "Fast audit loaded with partial data",
        detail: audit.auditErrors.slice(0, 2).join(" | ")
      });
    }

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

  function createFixTaskFromAgentAction(action) {
    const existing = state.tasks.find(task => task.sourceId === action.id && task.kind === "fix");
    if (existing) {
      existing.status = existing.status === "done" ? "queued" : existing.status;
      existing.updatedAt = new Date().toISOString();
      writeTasks();
      updateAgentAction(action.id, {
        status: "fix_queued",
        recommendedAction: "Fix task is queued in Operator Tasks. Complete it, then rerun validation.",
        validationResult: action.validationResult || action.executionResult || "Fix task queued."
      });
      return existing;
    }

    const fixPlan = buildAgentActionFixPlan(action);
    const task = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sourceId: action.id,
      title: `Fix: ${action.product || action.type || "agent action"}`,
      kind: "fix",
      severity: action.status === "failed" ? "critical" : "warning",
      status: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      why: action.validationResult || action.executionResult || action.recommendedAction || "Agent action needs repair before it can be validated.",
      objective: fixPlan.summary || "Repair the held action, rerun validation, and record proof.",
      steps: fixPlan.steps.length ? fixPlan.steps : [
        "Confirm the issue still reproduces.",
        "Patch the smallest safe sandbox fix.",
        "Run the affected validation again.",
        "Record proof before marking the action validated."
      ],
      guardrail: "Fix in sandbox first. Do not mark validated until JSON coverage or CV/ChatBot visual proof passes."
    };

    state.tasks.unshift(task);
    writeTasks();
    updateAgentAction(action.id, {
      status: "fix_queued",
      recommendedAction: "Fix task is queued in Operator Tasks. Complete it, then rerun validation.",
      validationResult: action.validationResult || action.executionResult || "Fix task queued."
    });
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
    logActivity({
      type: "source_check",
      status: "started",
      product: title,
      source: "admin",
      title: "Source Check started",
      detail: `Checking ${title} against ${sport ? titleCase(sport) : "all supported sports"}.`
    });
    renderActivityLog();

    try {
      const url = endpoint
        + (endpoint.indexOf("?") > -1 ? "&" : "?")
        + "action=validateSourceProduct"
        + "&title=" + encodeURIComponent(title)
        + "&sport=" + encodeURIComponent(sport)
        + "&mode=quick_json";
      const data = await fetchJson(url, { timeoutMs: 60000 });
      renderBackendValidationResult(data);
      logActivity({
        type: "source_check",
        status: data && data.status ? data.status : data && data.ok ? "completed" : "failed",
        product: data && (data.matched_name || data.title) ? (data.matched_name || data.title) : title,
        source: "operator_backend",
        title: "Source Check completed",
        detail: data && data.recommended_action ? data.recommended_action : "Source validation completed."
      });
      renderActivityLog();
    } catch (err) {
      renderSourceCheckMessage("Backend validation failed", err && err.message ? err.message : String(err), "critical");
      logActivity({
        type: "source_check",
        status: "failed",
        product: title,
        source: "operator_backend",
        title: "Source Check failed",
        detail: err && err.message ? err.message : String(err)
      });
      renderActivityLog();
    }
  }

  async function runSourceWatchWithBackend(mode, options) {
    options = options || {};
    const endpoint = readOperatorEndpoint();
    const auditMode = mode === "quick_json" ? "quick_json" : "deep_sheets";
    const modeLabel = auditMode === "quick_json" ? "Quick JSON Source Watch" : "Deep Sheets Source Watch";

    if (!endpoint) {
      renderSourceCheckMessage(
        "Operator Backend needed",
        "Paste and save the Apps Script Operator Backend URL before running Source Watch. Single-product Source Check still works without it.",
        "warning",
        { noFocus: !!options.noFocus }
      );
      if (options.noFocus) renderSentinelNotice("Operator Backend needed", "Save the Operator Backend URL before Sentinel can scan source data.", "warning");
      return { ok: false, kind: "checklist", label: modeLabel, items: 0, actionable: 0, queued: 0, error: "Operator Backend URL missing." };
    }

    renderSourceCheckMessage(
      `Running ${modeLabel}`,
      auditMode === "quick_json"
        ? "The Operator Backend is checking recent Checklistcenter items against public JSON files. This scan is read-only."
        : "The Operator Backend is checking recent Checklistcenter items against source Google Sheets. This audit is read-only.",
      "info",
      { noFocus: !!options.noFocus }
    );
    logActivity({
      type: "source_watch",
      status: "started",
      source: auditMode,
      title: `${modeLabel} started`,
      detail: auditMode === "quick_json"
        ? "Checking recent Checklistcenter items against public JSON. No writes will run."
        : "Checking recent Checklistcenter items against source Google Sheets. No writes will run."
    });
    renderActivityLog();

    try {
      const url = endpoint
        + (endpoint.indexOf("?") > -1 ? "&" : "?")
        + "action=sourceWatch"
        + "&mode=" + encodeURIComponent(auditMode);
      const data = await fetchJson(url, { timeoutMs: auditMode === "deep_sheets" ? 180000 : 60000 });
      const items = Array.isArray(data.items) ? data.items : [];
      const actionable = items.filter(item => item.status === "missing" || item.status === "needs_review" || item.status === "possible_update");
      const queuedCount = queueSourceWatchActions(items, auditMode);
      logActivity({
        type: "source_watch",
        status: data.ok ? "completed" : "failed",
        source: auditMode,
        title: `${modeLabel} complete`,
        detail: `${items.length} source items checked. ${actionable.length} need review. ${queuedCount} review cards queued. No Sheet or JSON writes were run by this audit.`
      });
      renderSourceWatchResults(data);
      if (options.noFocus) {
        renderSentinelNotice(
          "Source scan complete",
          `${items.length} source items checked. ${actionable.length} need review. ${queuedCount} review cards queued. No writes were run.`,
          actionable.length ? "warning" : "success"
        );
      }
      renderAgentActions();
      renderActionLanes();
      renderActivityLog();
      return {
        ok: !!data.ok,
        kind: "checklist",
        label: modeLabel,
        items: items.length,
        actionable: actionable.length,
        queued: queuedCount
      };
    } catch (err) {
      renderSourceCheckMessage("Source watch failed", err && err.message ? err.message : String(err), "critical", { noFocus: !!options.noFocus });
      if (options.noFocus) renderSentinelNotice("Source scan failed", err && err.message ? err.message : String(err), "critical");
      logActivity({
        type: "source_watch",
        status: "failed",
        source: auditMode,
        title: `${modeLabel} failed`,
        detail: err && err.message ? err.message : String(err)
      });
      renderActivityLog();
      return { ok: false, kind: "checklist", label: modeLabel, items: 0, actionable: 0, queued: 0, error: err && err.message ? err.message : String(err) };
    }
  }

  async function runPrvSourceWatchWithBackend(options) {
    options = options || {};
    const endpoint = readOperatorEndpoint();

    if (!endpoint) {
      renderSourceCheckMessage(
        "Operator Backend needed",
        "Paste and save the Apps Script Operator Backend URL before running PRV Source Watch.",
        "warning",
        { noFocus: !!options.noFocus }
      );
      if (options.noFocus) renderSentinelNotice("Operator Backend needed", "Save the Operator Backend URL before Sentinel can scan PRV source data.", "warning");
      return { ok: false, kind: "prv", label: "PRV Source Watch", items: 0, actionable: 0, queued: 0, error: "Operator Backend URL missing." };
    }

    renderSourceCheckMessage(
      "Running PRV Source Watch",
      "The Operator Backend is checking recent SlabSquatch Substack posts against public Print Run Vault JSON.",
      "info",
      { noFocus: !!options.noFocus }
    );
    logActivity({
      type: "prv_source_watch",
      status: "started",
      source: "slabsquatch",
      title: "PRV Source Watch started",
      detail: "Checking SlabSquatch posts against Print Run Vault coverage."
    });
    renderActivityLog();

    try {
      const url = endpoint
        + (endpoint.indexOf("?") > -1 ? "&" : "?")
        + "action=prvSourceWatch"
        + "&mode=quick_json";
      const data = await fetchJson(url, { timeoutMs: 60000 });
      const items = Array.isArray(data.items) ? data.items : [];
      const actionable = items.filter(item => item.status === "missing" || item.status === "needs_review" || item.status === "possible_update");
      const queuedCount = queueSourceWatchActions(items, "prv_source_watch");
      logActivity({
        type: "prv_source_watch",
        status: data.ok ? "completed" : "failed",
        source: "slabsquatch",
        title: "PRV Source Watch complete",
        detail: `${items.length} SlabSquatch items checked. ${actionable.length} need review. ${queuedCount} PRV review cards queued.`
      });
      renderSourceWatchResults(data);
      if (options.noFocus) {
        renderSentinelNotice(
          "PRV source scan complete",
          `${items.length} SlabSquatch items checked. ${actionable.length} need review. ${queuedCount} PRV review cards queued.`,
          actionable.length ? "warning" : "success"
        );
      }
      renderAgentActions();
      renderActionLanes();
      renderActivityLog();
      return {
        ok: !!data.ok,
        kind: "prv",
        label: "PRV Source Watch",
        items: items.length,
        actionable: actionable.length,
        queued: queuedCount
      };
    } catch (err) {
      renderSourceCheckMessage("PRV Source Watch failed", err && err.message ? err.message : String(err), "critical", { noFocus: !!options.noFocus });
      if (options.noFocus) renderSentinelNotice("PRV source scan failed", err && err.message ? err.message : String(err), "critical");
      logActivity({
        type: "prv_source_watch",
        status: "failed",
        source: "slabsquatch",
        title: "PRV Source Watch failed",
        detail: err && err.message ? err.message : String(err)
      });
      renderActivityLog();
      return { ok: false, kind: "prv", label: "PRV Source Watch", items: 0, actionable: 0, queued: 0, error: err && err.message ? err.message : String(err) };
    }
  }

  function buildDailySweepSummary(checklistScan, prvScan, activeCount) {
    const checklistText = checklistScan && checklistScan.ok
      ? `Checklist: ${formatNumber(checklistScan.items)} checked, ${formatNumber(checklistScan.queued)} queued.`
      : `Checklist: ${checklistScan && checklistScan.error ? checklistScan.error : "scan needs review"}`;
    const prvText = prvScan && prvScan.ok
      ? prvScan.queued
        ? `PRV: ${formatNumber(prvScan.items)} checked, ${formatNumber(prvScan.queued)} queued.`
        : `PRV clear: ${formatNumber(prvScan.items)} source item${Number(prvScan.items || 0) === 1 ? "" : "s"} checked, nothing new queued.`
      : `PRV: ${prvScan && prvScan.error ? prvScan.error : "scan needs review"}`;
    const queueText = activeCount
      ? `${formatNumber(activeCount)} active queue item${activeCount === 1 ? "" : "s"} need review.`
      : "No active queue items need review.";

    return `${checklistText} ${prvText} ${queueText}`;
  }

  async function runDailySentinelSweep() {
    renderSentinelNotice(
      "Running daily Sentinel sweep",
      "Checking app health, new checklist sources, and PRV source updates. Queue cards will appear only for work that needs review.",
      "info"
    );
    logActivity({
      type: "agent_cycle",
      status: "started",
      source: "command_center",
      title: "Daily Sentinel sweep started",
      detail: "Running health audit, Checklist source watch, and PRV source watch."
    });
    renderActivityLog();

    await runAudit();
    const checklistScan = await runSourceWatchWithBackend("quick_json", { noFocus: true });
    const prvScan = await runPrvSourceWatchWithBackend({ noFocus: true });

    const activeCount = getActiveAgentActions().length;
    const sweepSummary = buildDailySweepSummary(checklistScan, prvScan, activeCount);
    renderSentinelNotice(
      "Daily Sentinel sweep complete",
      sweepSummary,
      activeCount ? "warning" : "success"
    );
    logActivity({
      type: "agent_cycle",
      status: activeCount ? "needs_review" : "completed",
      source: "command_center",
      title: "Daily Sentinel sweep complete",
      detail: sweepSummary
    });
    renderActivityLog();
    renderAgentActions();
    renderActionLanes();
    renderRunSummary();
  }


  async function installDailyAgentSweepTrigger() {
    const endpoint = readOperatorEndpoint();
    const key = readOperatorKey();
    if (!endpoint || !key) {
      renderSentinelNotice("Operator Backend needed", "Save the Apps Script endpoint and admin write key before installing the daily trigger.", "warning");
      return;
    }

    logActivity({
      type: "automation",
      status: "started",
      source: "admin",
      title: "Daily Agent trigger install started",
      detail: "Requesting Apps Script trigger for runScheduledAgentSweepTrigger."
    });

    try {
      const url = endpoint
        + (endpoint.indexOf("?") > -1 ? "&" : "?")
        + "action=installDailyAgentSweepTrigger"
        + "&hour=9"
        + "&key=" + encodeURIComponent(key);
      const data = await fetchJson(url, { timeoutMs: 60000 });
      if (!data || !data.ok) throw new Error(data && data.error ? data.error : "Trigger install failed.");
      renderSentinelNotice("Daily Agent trigger ready", data.message || "runScheduledAgentSweepTrigger is scheduled daily.", "success");
      logActivity({
        type: "automation",
        status: data.status || "ready",
        source: "operator_backend",
        title: "Daily Agent trigger ready",
        detail: `${data.handler || "runScheduledAgentSweepTrigger"} • ${data.cadence || "daily"} • trigger count ${data.trigger_count || 1}`
      });
      renderActivityLog();
    } catch (err) {
      renderSentinelNotice("Daily Agent trigger failed", err && err.message ? err.message : "Could not install daily trigger.", "error");
      logActivity({
        type: "automation",
        status: "failed",
        source: "operator_backend",
        title: "Daily Agent trigger failed",
        detail: err && err.message ? err.message : "Could not install daily trigger."
      });
      renderActivityLog();
      throw err;
    }
  }

  async function runBackendAgentSweep(options) {
    options = options || {};
    const endpoint = readOperatorEndpoint();
    const key = readOperatorKey();
    if (!endpoint || !key) {
      renderSentinelNotice(
        "Backend Agent Sweep needs setup",
        "Save the Operator Backend URL and admin key before Sentinel can run unattended backend work.",
        "warning"
      );
      renderSourceCheckMessage("Operator Backend needed", "Save the Apps Script Operator Backend URL and admin key before running the backend agent sweep.", "warning");
      return null;
    }

    if (!options.silent) {
      renderSentinelNotice(
        options.wave ? `Backend Agent Sweep wave ${options.wave}` : "Backend Agent Sweep running",
        "Sentinel is checking Checklist Center, SlabSquatch PRV sources, a bounded batch of safe auto work, and backend memory. Full PRV sync runs separately.",
        "info"
      );
      renderSourceCheckMessage("Backend Agent Sweep running", "Fast sweep runs from Apps Script and writes queue findings to backend memory. Use Sync PRV JSON for a full PRV publish pass.", "info", { noFocus: true });
      logActivity({
        type: "agent_sweep",
        status: "started",
        source: "command_center",
        title: options.wave ? `Backend Agent Sweep wave ${options.wave} started` : "Backend Agent Sweep started",
        detail: "Running checklist source watch, PRV source watch, bounded safe auto work, and backend memory update."
      });
      renderActivityLog();
    }

    try {
      const data = await postOperatorJson(endpoint, {
        action: "runScheduledAgentSweep",
        key,
        mode: "quick_json",
        maxAutoActions: 10,
        skipPrvSync: true,
        fastMode: true
      }, { timeoutMs: 150000 });

      if (!data || !data.ok) {
        const stillUseful = data && (data.checklist || data.prv || data.prv_sync);
        if (!stillUseful) throw new Error(data && data.error ? data.error : "Backend Agent Sweep failed.");
      }

      const checklistCount = data && data.checklist ? Number(data.checklist.actionable_count || 0) : 0;
      const prvCount = data && data.prv ? Number(data.prv.actionable_count || 0) : 0;
      const prvSyncSkipped = !!(data && data.prv_sync && data.prv_sync.status === "skipped");
      const prvSyncOk = !!(data && data.prv_sync && data.prv_sync.ok);
      const autoAction = data && data.auto_action ? data.auto_action : null;
      const autoActions = data && data.auto_actions ? data.auto_actions : null;
      const autoText = autoActions && autoActions.ran
        ? ` Auto: ${formatNumber(autoActions.count || 0)} ran.${autoActions.queue_count ? " Queue remaining: " + formatNumber(autoActions.queue_remaining || 0) + "." : ""} ${autoActions.summary || ""}`
        : autoAction && autoAction.ran
          ? ` Auto: ${autoAction.product || autoAction.type || "action"} ${autoAction.status || "completed"}. ${autoAction.validationResult || autoAction.executionResult || ""}`
        : autoAction && autoAction.reason
          ? ` Auto: ${autoAction.reason}`
          : "";
      const detail = `Checklist: ${formatNumber(checklistCount)} action${checklistCount === 1 ? "" : "s"}. PRV: ${formatNumber(prvCount)} action${prvCount === 1 ? "" : "s"}. PRV sync: ${prvSyncSkipped ? "skipped" : (prvSyncOk ? "passed" : "needs review")}.${autoText}`;
      const severity = checklistCount || prvCount || (!prvSyncSkipped && !prvSyncOk) || (autoAction && autoAction.ran && autoAction.status !== "validated") ? "warning" : "success";

      if (!options.silent) {
        logActivity({
          type: "agent_sweep",
          status: severity === "success" ? "validated" : "needs_review",
          source: "operator_backend",
          title: options.wave ? `Backend Agent Sweep wave ${options.wave} complete` : "Backend Agent Sweep complete",
          detail
        });
        renderActivityLog();
        renderSentinelNotice("Backend Agent Sweep complete", detail, severity);
        renderSourceCheckMessage("Backend Agent Sweep complete", detail, severity, { noFocus: true });
      }
      await loadBackendAgentMemory();
      return data;
    } catch (err) {
      const detail = err && err.message ? err.message : "Backend Agent Sweep failed.";
      logActivity({
        type: "agent_sweep",
        status: "failed",
        source: "operator_backend",
        title: "Backend Agent Sweep failed",
        detail
      });
      renderActivityLog();
      renderSentinelNotice("Backend Agent Sweep failed", detail, "critical");
      renderSourceCheckMessage("Backend Agent Sweep failed", detail, "critical", { noFocus: true });
      return null;
    }
  }

  function countChecklistManifestProducts(bundleData) {
    return SPORTS.reduce((sum, sport) => {
      const manifest = bundleData && bundleData.manifests ? bundleData.manifests[sport] : null;
      const map = manifest && (manifest.product_map || manifest.productMap) ? (manifest.product_map || manifest.productMap) : {};
      return sum + Object.keys(map).length;
    }, 0);
  }

  function getPayloadRows(payload, keys) {
    for (const key of keys) {
      if (Array.isArray(payload && payload[key])) return payload[key];
    }
    return Array.isArray(payload) ? payload : [];
  }

  function buildPublicToolAuditCards(metrics) {
    const cards = [
      {
        title: "Checklist Vault",
        value: `${formatNumber(metrics.checklistProducts)} products`,
        detail: `${formatNumber(metrics.checklistIndex)} search-index rows`,
        status: metrics.checklistProducts > 0 && metrics.checklistIndex > 0 ? "pass" : "warn"
      },
      {
        title: "Print Run Vault",
        value: `${formatNumber(metrics.vaultProducts)} products`,
        detail: "Public PRV product map is reachable",
        status: metrics.vaultProducts > 0 ? "pass" : "warn"
      },
      {
        title: "Release Schedule",
        value: `${formatNumber(metrics.releaseRows)} rows`,
        detail: "Static release schedule feed",
        status: metrics.releaseRows > 0 ? "pass" : "warn"
      },
      {
        title: "Early Signals",
        value: `${formatNumber(metrics.earlySignals)} players`,
        detail: "MLB opportunity signal feed",
        status: metrics.earlySignals > 0 ? "pass" : "warn"
      },
      {
        title: "ChatBot",
        value: "Live",
        detail: "Behavior proof comes from CV/ChatBot visual tests",
        status: "review"
      },
      {
        title: "Leadership Readiness",
        value: `${metrics.score}%`,
        detail: metrics.score >= 85 ? "Public data layer looks strong" : "Review warnings before calling this ready",
        status: metrics.score >= 85 ? "pass" : "warn"
      }
    ];

    return cards;
  }

  function renderPublicToolAudit(cards, summary) {
    if (!els.publicToolAuditResult) return;
    els.publicToolAuditResult.innerHTML = `
      ${summary ? `<div class="public-tool-summary">${escapeHtml(summary)}</div>` : ""}
      ${cards.map(card => `
        <article class="public-tool-card ${escapeHtml(card.status)}">
          <div>
            <strong>${escapeHtml(card.title)}</strong>
            <span>${escapeHtml(card.detail)}</span>
          </div>
          <em>${escapeHtml(card.value)}</em>
        </article>
      `).join("")}
    `;
  }

  async function runPublicToolAudit() {
    if (els.publicToolAuditResult) {
      els.publicToolAuditResult.innerHTML = `
        <div class="public-tool-card muted">
          <strong>Auditing public tools...</strong>
          <span>Checking the public JSON feeds that power Checklist Vault, PRV, releases, and signals.</span>
        </div>
      `;
    }
    renderSentinelNotice("Public Tool Audit started", "Checking the public-facing data layer for leadership readiness.", "info");
    logActivity({
      type: "public_tool_audit",
      status: "started",
      source: "command_center",
      title: "Public Tool Audit started",
      detail: "Checking public JSON feeds for Checklist Vault, PRV, releases, and early signals."
    });
    renderActivityLog();

    const results = await Promise.allSettled([
      fetchJson(`${DATA_BASE}/checklists/index.json`, { timeoutMs: 12000, cache: "no-store" }),
      fetchProductBundles({ manifestOnly: true }),
      fetchVaultProducts({ manifestOnly: true }),
      fetchJson(RELEASE_URL, { timeoutMs: 10000, cache: "no-store" }),
      fetchJson(`${DATA_BASE}/players/mlb-early-signals.json`, { timeoutMs: 10000, cache: "no-store" })
    ]);

    const checklistIndexPayload = results[0].status === "fulfilled" ? results[0].value : {};
    const bundleData = results[1].status === "fulfilled" ? results[1].value : { manifests: {} };
    const vaultData = results[2].status === "fulfilled" ? results[2].value : { productMap: {} };
    const releasePayload = results[3].status === "fulfilled" ? results[3].value : {};
    const earlySignalsPayload = results[4].status === "fulfilled" ? results[4].value : {};
    const errors = results
      .filter(result => result.status === "rejected")
      .map(result => result.reason && result.reason.message ? result.reason.message : String(result.reason));

    const checklistIndexRows = getPayloadRows(checklistIndexPayload, ["index", "rows"]);
    const releaseRows = getPayloadRows(releasePayload, ["rows", "releases"]);
    const earlySignalRows = getPayloadRows(earlySignalsPayload, ["signals", "rows"]);
    const vaultProductMap = vaultData.productMap || vaultData.product_map || vaultData.productMap || {};
    const metrics = {
      checklistIndex: checklistIndexRows.length,
      checklistProducts: countChecklistManifestProducts(bundleData),
      vaultProducts: Object.keys(vaultProductMap).length,
      releaseRows: releaseRows.length,
      earlySignals: earlySignalRows.length,
      score: 0
    };
    const passingChecks = [
      metrics.checklistIndex > 0,
      metrics.checklistProducts > 0,
      metrics.vaultProducts > 0,
      metrics.releaseRows > 0,
      metrics.earlySignals > 0,
      !errors.length
    ].filter(Boolean).length;
    metrics.score = Math.round((passingChecks / 6) * 100);

    const cards = buildPublicToolAuditCards(metrics);
    const summary = errors.length
      ? `${errors.length} feed issue${errors.length === 1 ? "" : "s"} found. Review before calling the public tools fully ready.`
      : `Public data layer score: ${metrics.score}%. Checklist, PRV, release, and signal feeds are reachable.`;
    renderPublicToolAudit(cards, summary);
    renderSentinelNotice("Public Tool Audit complete", summary, errors.length || metrics.score < 85 ? "warning" : "success");
    logActivity({
      type: "public_tool_audit",
      status: errors.length || metrics.score < 85 ? "needs_review" : "validated",
      source: "command_center",
      title: "Public Tool Audit complete",
      detail: summary
    });
    renderActivityLog();
  }

  async function previewSourceImport(sourceUrl, sport, actionId) {
    const endpoint = readOperatorEndpoint();

    if (!endpoint) {
      renderSourceCheckMessage("Operator Backend needed", "Save the Apps Script Operator Backend URL before previewing imports.", "warning");
      return;
    }

    renderSourceCheckMessage("Building import preview", "The Operator Backend is parsing the source page into Chasing Majors rows.", "info");
    const action = actionId ? state.agentActions.find(item => item.id === actionId) : null;
    logActivity({
      type: "source_import",
      status: "started",
      product: action && action.product ? action.product : "",
      source: "admin",
      title: "Import preview started",
      detail: "Parsing source checklist rows and parallels before any sheet write."
    });
    renderActivityLog();

    try {
      const url = endpoint
        + (endpoint.indexOf("?") > -1 ? "&" : "?")
        + "action=previewSourceImport"
        + "&sourceUrl=" + encodeURIComponent(sourceUrl)
        + "&sport=" + encodeURIComponent(sport || "");
      const data = await fetchJson(url, { timeoutMs: 90000 });
      renderImportPreview(data);
      logActivity({
        type: "source_import",
        status: data && data.status ? data.status : data && data.ok ? "preview_ready" : "failed",
        product: data && data.product && data.product.display_name ? data.product.display_name : action && action.product ? action.product : "",
        source: "operator_backend",
        title: "Import preview completed",
        detail: `${formatNumber(data && data.row_count || 0)} rows and ${formatNumber(data && data.parallel_count || 0)} parallels parsed.`
      });
      renderActivityLog();
    } catch (err) {
      renderSourceCheckMessage("Import preview failed", err && err.message ? err.message : String(err), "critical");
      logActivity({
        type: "source_import",
        status: "failed",
        product: action && action.product ? action.product : "",
        source: "operator_backend",
        title: "Import preview failed",
        detail: err && err.message ? err.message : String(err)
      });
      renderActivityLog();
    }
  }

  async function previewPrvSource(sourceUrl, sport, actionId) {
    const endpoint = readOperatorEndpoint();

    if (!endpoint) {
      renderSourceCheckMessage("Operator Backend needed", "Save the Apps Script Operator Backend URL before previewing PRV sources.", "warning");
      return;
    }

    const action = actionId ? state.agentActions.find(item => item.id === actionId) : null;
    renderSourceCheckMessage("Building PRV preview", "The Operator Backend is parsing SlabSquatch print-run rows for admin review.", "info");
    logActivity({
      type: "prv_source_review",
      status: "started",
      product: action && action.product ? action.product : "",
      source: "operator_backend",
      title: "PRV preview started",
      detail: "Parsing source print-run rows before any PRV sheet write exists."
    });
    renderActivityLog();

    try {
      const url = endpoint
        + (endpoint.indexOf("?") > -1 ? "&" : "?")
        + "action=previewPrvSource"
        + "&sourceUrl=" + encodeURIComponent(sourceUrl)
        + "&sport=" + encodeURIComponent(sport || "");
      const data = await fetchJson(url, { timeoutMs: 90000 });
      renderPrvPreview(data);
      if (actionId) {
        const parsedRows = Number(data && data.row_count || 0);
        const previewReady = !!(data && data.status === "preview_ready" && parsedRows > 0);
        updateAgentAction(actionId, {
          status: previewReady ? "needs_admin" : "known_issue",
          executionResult: previewReady
            ? `PRV source preview parsed ${formatNumber(parsedRows)} print-run rows.`
            : "Source found, but the PRV parser returned 0 print-run rows.",
          validationResult: previewReady
            ? "Preview rows are ready for admin review before PRV sheet write."
            : "Parser review needed before this can write PRV sheet data.",
          recommendedAction: previewReady
            ? "Review sample rows, then write PRV temp data if the numbers look right."
            : "Open the source and review whether this post has a new layout or no extractable print-run table."
        });
        renderAgentActions();
        renderActionLanes();
      }
      logActivity({
        type: "prv_source_review",
        status: data && data.status ? data.status : data && data.ok ? "preview_ready" : "failed",
        product: data && data.product && data.product.display_name ? data.product.display_name : action && action.product ? action.product : "",
        source: "operator_backend",
        title: "PRV preview completed",
        detail: `${formatNumber(data && data.row_count || 0)} print-run rows parsed.`
      });
      renderActivityLog();
    } catch (err) {
      renderSourceCheckMessage("PRV preview failed", err && err.message ? err.message : String(err), "critical");
      logActivity({
        type: "prv_source_review",
        status: "failed",
        product: action && action.product ? action.product : "",
        source: "operator_backend",
        title: "PRV preview failed",
        detail: err && err.message ? err.message : String(err)
      });
      renderActivityLog();
    }
  }

  async function executePrvSourceImport(sourceUrl, sport, actionId) {
    const endpoint = readOperatorEndpoint();
    const key = readOperatorKey();

    if (!endpoint) {
      renderSourceCheckMessage("Operator Backend needed", "Save the Apps Script Operator Backend URL before writing PRV rows.", "warning");
      return;
    }

    if (!key) {
      renderSourceCheckMessage("Admin write key needed", "Enter and save the admin write key before writing PRV rows to Google Sheets.", "warning");
      return;
    }

    const action = actionId ? state.agentActions.find(item => item.id === actionId) : null;
    renderSourceCheckMessage("Writing PRV temp data", "The Operator Backend is updating the PRV Index and Products tabs for this product only.", "info");
    logActivity({
      type: "prv_source_review",
      status: "started",
      product: action && action.product ? action.product : "",
      source: "admin",
      title: "PRV sheet write started",
      detail: "Admin requested product-scoped PRV write from SlabSquatch preview rows."
    });
    renderActivityLog();

    if (actionId) {
      updateAgentAction(actionId, {
        status: "running",
        executionResult: "PRV sheet write started through Operator Backend."
      });
      renderAgentActions();
      renderActionLanes();
    }

    try {
      const data = await postOperatorJson(endpoint, {
        action: "executePrvSourceImport",
        sourceUrl: sourceUrl,
        sport: sport || "",
        key: key
      }, { timeoutMs: 180000 });
      renderPrvExecuteResult(data, actionId);
    } catch (err) {
      const detail = err && err.message ? err.message : String(err);
      if (actionId) {
        updateAgentAction(actionId, {
          status: "failed",
          executionResult: detail,
          validationResult: "PRV write request failed before sheet confirmation.",
          recommendedAction: "Review backend connectivity, then rerun PRV preview/write."
        });
        renderAgentActions();
        renderActionLanes();
      }
      logActivity({
        type: "prv_source_review",
        status: "failed",
        product: action && action.product ? action.product : "",
        source: "operator_backend",
        title: "PRV sheet write failed",
        detail: detail
      });
      renderActivityLog();
      renderSourceCheckMessage("PRV sheet write failed", detail, "critical");
    }
  }

  async function publishPrvVaultData(code, actionId, options) {
    options = options || {};
    const endpoint = readOperatorEndpoint();
    const key = readOperatorKey();
    const action = actionId ? state.agentActions.find(item => item.id === actionId) : null;
    const isFullSync = !!options.fullSync;

    if (!endpoint) {
      renderSourceCheckMessage("Operator Backend needed", "Save the Apps Script Operator Backend URL before publishing PRV JSON.", "warning");
      return;
    }

    if (!key) {
      renderSourceCheckMessage("Admin write key needed", "Enter and save the admin write key before publishing PRV JSON.", "warning");
      return;
    }

    if (!code && !isFullSync) {
      renderSourceCheckMessage("PRV code missing", "This PRV publish action needs a product code.", "warning");
      return;
    }

    renderSourceCheckMessage(
      isFullSync ? "Syncing PRV JSON" : "Publishing PRV JSON",
      isFullSync
        ? "The Operator Backend is publishing the full Print Run Vault JSON from the current Google Sheet data."
        : "The Operator Backend is asking Static Data Exporter to publish Print Run Vault static data.",
      "info"
    );
    logActivity({
      type: "prv_publish",
      status: "started",
      product: isFullSync ? "Print Run Vault" : action && action.product ? action.product : code,
      source: "operator_backend",
      title: isFullSync ? "Manual PRV JSON sync started" : "PRV JSON publish started",
      detail: isFullSync
        ? "Publishing Print Run Vault static JSON after manual Google Sheet changes."
        : "Publishing Print Run Vault static JSON after approved sheet write."
    });
    if (actionId) {
      updateAgentAction(actionId, {
        status: "running",
        executionResult: "PRV sheet write completed. PRV JSON publish started."
      });
      renderAgentActions();
      renderActionLanes();
    }
    renderActivityLog();

    try {
      const data = await postOperatorJson(endpoint, {
        action: "publishPrvVaultStaticData",
        code: code,
        key: key
      }, { timeoutMs: 240000 });
      renderPrvPublishResult(data, actionId, { fullSync: isFullSync });
    } catch (err) {
      const detail = err && err.message ? err.message : String(err);
      const attemptedRecovery = !!(isFullSync && (options.recovery || action && String(action.executionResult || "").toLowerCase().includes("safe recovery attempted")));
      if (actionId) {
        updateAgentAction(actionId, {
          status: attemptedRecovery ? "fix_attempted" : "needs_admin",
          executionResult: attemptedRecovery
            ? "Safe recovery attempted: PRV JSON sync was retried once and failed again."
            : "PRV sheet write completed; PRV JSON publish request failed.",
          validationResult: detail,
          recommendedAction: attemptedRecovery
            ? "Open the latest Static Data Exporter execution log. Check whether publishVaultStaticDataToGitHub timed out, hit GitHub API errors, or is missing permissions."
            : "Retry PRV publish after confirming Static Data Exporter endpoint is healthy."
        });
        renderAgentActions();
        renderActionLanes();
      }
      logActivity({
        type: "prv_publish",
        status: "failed",
        product: isFullSync ? "Print Run Vault" : action && action.product ? action.product : code,
        source: "operator_backend",
        title: isFullSync ? "Manual PRV JSON sync failed" : "PRV JSON publish failed",
        detail: detail
      });
      renderActivityLog();
      if (isFullSync) {
        upsertPrvSyncIncident(detail, {
          status: attemptedRecovery ? "fix_attempted" : "failed",
          executionResult: attemptedRecovery
            ? "Safe recovery attempted: PRV JSON sync was retried once and failed again."
            : "PRV full JSON sync failed. Safe recovery has not run yet.",
          validationResult: attemptedRecovery
            ? "Retry failed. Admin should inspect Static Data Exporter execution logs and GitHub publish permissions."
            : detail,
          recommendedAction: attemptedRecovery
            ? "Open the latest Static Data Exporter execution log. Check whether publishVaultStaticDataToGitHub timed out, hit GitHub API errors, or is missing permissions."
            : "Run Agent Cycle to retry PRV JSON sync once before admin review.",
          source: "operator_backend"
        });
      }
      renderSourceCheckMessage("PRV publish failed", detail, "critical");
    }
  }

  async function recheckPrvPublicData(code, actionId) {
    const endpoint = readOperatorEndpoint();
    const action = actionId ? state.agentActions.find(item => item.id === actionId) : null;

    if (!endpoint) {
      renderSourceCheckMessage("Operator Backend needed", "Save the Apps Script Operator Backend URL before rechecking PRV public JSON.", "warning");
      return;
    }

    if (!code) {
      renderSourceCheckMessage("PRV code missing", "This PRV recheck action needs a product code.", "warning");
      return;
    }

    renderSourceCheckMessage("Rechecking PRV JSON", "Checking the public Print Run Vault JSON for this product code.", "info");
    logActivity({
      type: "prv_publish",
      status: "started",
      product: action && action.product ? action.product : code,
      source: "operator_backend",
      title: "PRV public recheck started",
      detail: "Checking whether GitHub Pages has the product rows yet."
    });
    renderActivityLog();

    try {
      const url = endpoint
        + (endpoint.indexOf("?") > -1 ? "&" : "?")
        + "action=validatePrvVaultProduct"
        + "&code=" + encodeURIComponent(code);
      const data = await fetchJson(url, { timeoutMs: 60000 });
      renderPrvPublicValidationResult(data, actionId);
    } catch (err) {
      const detail = err && err.message ? err.message : String(err);
      logActivity({
        type: "prv_publish",
        status: "failed",
        product: action && action.product ? action.product : code,
        source: "operator_backend",
        title: "PRV public recheck failed",
        detail: detail
      });
      renderActivityLog();
      renderSourceCheckMessage("PRV public recheck failed", detail, "critical");
    }
  }

  async function findSourceAndPreviewImport(actionId) {
    const endpoint = readOperatorEndpoint();
    const action = state.agentActions.find(item => item.id === actionId);
    if (!action) return;

    if (!endpoint) {
      renderSourceCheckMessage("Operator Backend needed", "Save the Apps Script Operator Backend URL before finding the source page.", "warning");
      return;
    }

    updateAgentAction(actionId, {
      status: "running",
      executionResult: "Finding Checklist Center source page before import preview."
    });
    logActivity({
      type: "source_import",
      status: "started",
      product: action.product || "",
      source: "operator_backend",
      title: "Source lookup started",
      detail: "Finding the Checklist Center page so the agent can rebuild product-scoped rows/parallels."
    });
    renderAgentActions();
    renderActionLanes();
    renderActivityLog();
    renderSourceCheckMessage("Finding source page", "Looking up the matching Checklist Center source page, then opening an import preview.", "info");

    try {
      const url = endpoint
        + (endpoint.indexOf("?") > -1 ? "&" : "?")
        + "action=findChecklistCenterSource"
        + "&title=" + encodeURIComponent(action.product || "")
        + "&sport=" + encodeURIComponent(action.sport || "");
      const data = await fetchJson(url, { timeoutMs: 60000 });
      if (!data || !data.ok || !data.match || !data.match.source_url) {
        throw new Error(data && data.error ? data.error : "No matching Checklist Center source page found.");
      }

      updateAgentAction(actionId, {
        sourceUrl: data.match.source_url,
        runUrl: data.match.source_url,
        executionResult: "Source page found. Import preview started."
      });
      logActivity({
        type: "source_import",
        status: "found",
        product: action.product || "",
        source: "operator_backend",
        title: "Source page found",
        detail: data.match.source_url
      });
      renderAgentActions();
      renderActionLanes();
      renderActivityLog();
      previewSourceImport(data.match.source_url, action.sport || data.match.sport || "", actionId);
    } catch (err) {
      const detail = err && err.message ? err.message : String(err);
      updateAgentAction(actionId, {
        status: "needs_admin",
        executionResult: detail,
        recommendedAction: "Paste the source URL into Source Check or rerun Deep Sheets Source Watch."
      });
      logActivity({
        type: "source_import",
        status: "failed",
        product: action.product || "",
        source: "operator_backend",
        title: "Source lookup failed",
        detail: detail
      });
      renderAgentActions();
      renderActionLanes();
      renderActivityLog();
      renderSourceCheckMessage("Source lookup failed", detail, "critical");
    }
  }

  async function executeSourceImport(sourceUrl, sport, actionId) {
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
    const action = actionId ? state.agentActions.find(item => item.id === actionId) : null;
    logActivity({
      type: "source_import",
      status: "started",
      product: action && action.product ? action.product : "",
      source: "admin",
      title: "Sheet write started",
      detail: "Admin requested product-scoped write to Google Sheets."
    });
    renderActivityLog();
    if (actionId) {
      updateAgentAction(actionId, {
        status: "running",
        executionResult: "Sheet write started through Operator Backend."
      });
      renderAgentActions();
      renderActionLanes();
    }

    try {
      const data = await postOperatorJson(endpoint, {
        action: "executeSourceImport",
        sourceUrl: sourceUrl,
        sport: sport || "",
        key: key,
        publish: "0"
      }, { timeoutMs: 240000 });
      renderExecuteResult(data, actionId);
      if (data && data.ok && data.publish && data.publish.skipped) {
        publishImportedChecklist(data, actionId);
      }
    } catch (err) {
      const detail = err && err.message ? err.message : String(err);
      if (actionId) {
        updateAgentAction(actionId, {
          status: "failed",
          executionResult: detail,
          validationResult: "Import request failed before write confirmation.",
          recommendedAction: "Review backend connectivity, then rerun preview/import. Create a fix task if this repeats."
        });
        logActivity({
          type: "source_import",
          status: "failed",
          source: "operator_backend",
          title: "Import request failed",
          detail: detail
        });
        renderAgentActions();
        renderActionLanes();
        renderActivityLog();
      }
      renderSourceCheckMessage("Import request failed", detail, "critical");
    }
  }

  async function publishImportedChecklist(writeData, actionId) {
    const endpoint = readOperatorEndpoint();
    const key = readOperatorKey();
    const product = writeData && writeData.product ? writeData.product : {};

    if (!endpoint || !key || !product.code || !product.sport || !(writeData.target_bucket || product.target_bucket || product.year)) return;

    logActivity({
      type: "checklist_publish",
      status: "started",
      product: product.display_name || "",
      source: "operator_backend",
      title: "JSON publish started",
      detail: "Sheet write is complete. Publishing product-scoped JSON as a separate phase."
    });
    if (actionId) {
      updateAgentAction(actionId, {
        status: "running",
        executionResult: "Sheet write completed. JSON publish started."
      });
      renderAgentActions();
      renderActionLanes();
    }
    renderActivityLog();

    try {
      const bucket = writeData.target_bucket || product.target_bucket || product.year || "";
      const publishData = await postOperatorJson(endpoint, {
        action: "publishImportedChecklist",
        sport: product.sport || "",
        bucket: bucket,
        code: product.code || "",
        key: key
      }, { timeoutMs: 240000 });
      const merged = Object.assign({}, writeData, {
        publish: publishData && publishData.publish ? publishData.publish : publishData,
        status: publishData && publishData.ok ? "written_published_validated" : "written_publish_needs_review",
        next_step: publishData && publishData.ok
          ? "Published. Recheck coverage after GitHub Pages has propagated."
          : "Sheet write succeeded, but publish/live validation needs review."
      });
      renderExecuteResult(merged, actionId);
    } catch (err) {
      const detail = err && err.message ? err.message : String(err);
      if (actionId) {
        updateAgentAction(actionId, {
          status: "needs_admin",
          executionResult: "Sheet write completed; JSON publish request failed.",
          validationResult: detail,
          recommendedAction: "Retry publish/recheck after confirming the Static Data Exporter endpoint is healthy."
        });
        renderAgentActions();
        renderActionLanes();
      }
      logActivity({
        type: "checklist_publish",
        status: "failed",
        product: product.display_name || "",
        source: "operator_backend",
        title: "JSON publish failed",
        detail: detail
      });
      renderActivityLog();
      renderSourceCheckMessage("Publish request failed", detail, "critical");
    }
  }

  async function publishChecklistAction(actionId) {
    const action = state.agentActions.find(item => item.id === actionId);
    if (!action) return;

    const bucket = action.bucket || action.targetBucket || inferChecklistBucket(action.product || "", action.sport || "");
    if (!action.code || !action.sport || !bucket) {
      renderSourceCheckMessage("Publish details missing", "This card needs product code, sport, and year/season before JSON can be published.", "warning");
      logActivity({
        type: "checklist_publish",
        status: "failed",
        product: action.product || "",
        source: "command_center",
        title: "JSON publish blocked",
        detail: "Missing product code, sport, or year/season."
      });
      renderActivityLog();
      return;
    }

    updateAgentAction(actionId, {
      status: "running",
      executionResult: "JSON publish started from the checklist publish card."
    });
    renderAgentActions();
    renderActionLanes();

    publishImportedChecklist({
      target_bucket: bucket,
      product: {
        display_name: action.product || "",
        sport: action.sport || "",
        code: action.code || "",
        year: bucket,
        target_bucket: bucket
      },
      validation: {
        ok: true
      }
    }, actionId);
  }

  async function recheckActionCoverage(actionId) {
    const endpoint = readOperatorEndpoint();
    const action = state.agentActions.find(item => item.id === actionId);
    if (!action) return;

    if (!endpoint) {
      updateAgentAction(actionId, {
        status: "needs_admin",
        validationResult: "Coverage recheck blocked: Operator Backend URL is missing."
      });
      renderAgentActions();
      renderActionLanes();
      renderSourceCheckMessage("Operator Backend needed", "Save the Apps Script Operator Backend URL before rechecking coverage.", "warning");
      return;
    }

    if (!action.product) {
      updateAgentAction(actionId, {
        status: "needs_admin",
        validationResult: "Coverage recheck blocked: product name is missing."
      });
      renderAgentActions();
      renderActionLanes();
      renderSourceCheckMessage("Product missing", "This action does not have a product name to recheck.", "warning");
      return;
    }

    updateAgentAction(actionId, {
      status: "running",
      validationResult: "Coverage recheck started..."
    });
    logActivity({
      type: "validation",
      status: "running",
      product: action.product || "",
      source: "operator_backend",
      title: "Coverage recheck started",
      detail: "Checking current public checklist coverage for this product."
    });
    renderAgentActions();
    renderActionLanes();
    renderActivityLog();
    renderSourceCheckMessage("Rechecking public coverage", "The Operator Backend is checking the product against the current public checklist index.", "info");

    try {
      const url = endpoint
        + (endpoint.indexOf("?") > -1 ? "&" : "?")
        + "action=validateSourceProduct"
        + "&title=" + encodeURIComponent(action.product || "")
        + "&sport=" + encodeURIComponent(action.sport || "")
        + "&mode=quick_json";
      const data = await fetchJson(url, { timeoutMs: 30000 });
      const covered = data && data.ok && data.status === "covered";
      const rowCount = Number(data && data.sheet_row_count || 0);
      const parallelCount = Number(data && data.sheet_parallel_count || 0);
      const expectedRowCount = Number(action.expectedRowCount || 0);
      const expectedParallelCount = Number(action.expectedParallelCount || 0);
      const meetsExpectedRows = expectedRowCount <= 0 || rowCount >= expectedRowCount;
      const meetsExpectedParallels = expectedParallelCount <= 0 || parallelCount >= expectedParallelCount;
      const fullyCovered = covered && meetsExpectedRows && meetsExpectedParallels;

      const wasPendingPublicValidation = isPendingPublicValidationAction(action);
      updateAgentAction(actionId, {
        status: fullyCovered && wasPendingPublicValidation ? "pending_visual_validation" : "needs_admin",
        code: action.code || (data && data.matched_code) || "",
        validationResult: fullyCovered
          ? `Public JSON covered: ${formatNumber(rowCount)} rows, ${formatNumber(parallelCount)} parallels. Visual CV/ChatBot proof still pending.`
          : covered && !fullyCovered
            ? `Public JSON exists but appears stale: expected ${formatNumber(expectedRowCount || 0)} rows / ${formatNumber(expectedParallelCount || 0)} parallels; found ${formatNumber(rowCount)} rows / ${formatNumber(parallelCount)} parallels.`
          : `Coverage recheck needs review: ${(data && (data.recommended_action || data.reason || data.status)) || "unknown result"}.`
        ,
        recommendedAction: fullyCovered && wasPendingPublicValidation
          ? "Public JSON is live. Run CV/ChatBot visual validation next."
          : covered && !fullyCovered
            ? "Run Agent Cycle with backend credentials so Sentinel can publish/recheck the stale product JSON."
          : action.recommendedAction || ""
      });

      logActivity({
        type: "validation",
        status: fullyCovered ? "covered" : "needs_review",
        product: action.product || "",
        source: "operator_backend",
        title: "Coverage rechecked",
        detail: fullyCovered
          ? `${formatNumber(rowCount)} public rows and ${formatNumber(parallelCount)} parallels found.`
          : covered
            ? "Public JSON exists but row/parallel counts are still short."
            : "Public coverage still needs review."
      });

      renderBackendValidationResult(data);
      renderAgentActions();
      renderActionLanes();
      renderActivityLog();
    } catch (err) {
      updateAgentAction(actionId, {
        status: "failed",
        validationResult: err && err.message ? err.message : String(err)
      });
      logActivity({
        type: "validation",
        status: "failed",
        product: action.product || "",
        source: "operator_backend",
        title: "Coverage recheck failed",
        detail: err && err.message ? err.message : String(err)
      });
      renderAgentActions();
      renderActionLanes();
      renderActivityLog();
      renderSourceCheckMessage("Coverage recheck failed", err && err.message ? err.message : String(err), "critical");
    }
  }

  function renderBackendValidationResult(data) {
    if (!data || !data.ok) {
      renderSourceCheckMessage("Validation failed", data && data.error ? data.error : "Unknown backend response.", "critical");
      return;
    }

    if (data.status === "covered") {
      const resolvedCount = autoResolveCoveredSourceCheck(data);
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
          ${resolvedCount ? `<div class="task-guardrail">${escapeHtml(`${resolvedCount} matching Agent Action Queue card${resolvedCount === 1 ? "" : "s"} auto-resolved and remembered.`)}</div>` : ""}
        </div>
      `;
      focusSourceCheckResult();
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
      focusSourceCheckResult();
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
            <h3>${escapeHtml(data.source === "slabsquatch" ? "PRV Source Watch Complete" : data.mode === "quick_json" ? "Quick JSON Source Watch Complete" : "Deep Sheets Source Watch Complete")}</h3>
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
        const isPrv = item.target_tool === "prv";
        createSourceImportTask(item.title || "Untitled source item", item.sport || "");
        upsertAgentAction({
          type: isPrv ? "prv_source_review" : "source_import",
          source: item.discovery_source || "source_watch",
          product: item.matched_name || item.title || "Untitled source item",
          sport: item.sport || "",
          code: item.matched_code || "",
          riskLevel: item.status === "missing" ? "medium" : "low",
          status: "approval_required",
          recommendedAction: item.recommended_action || (isPrv
            ? "Review source post, compare against PRV, then prepare update/build task if numbers are missing or stale."
            : "Preview source import, write product-scoped rows, publish JSON, validate CV/ChatBot."),
          sourceUrl: item.source_url || item.url || ""
        });
        logActivity({
          type: "agent_action",
          status: "created",
          product: item.matched_name || item.title || "",
          source: item.discovery_source || "source_watch",
          title: "Agent action created from Source Watch",
          detail: item.recommended_action || item.reason || ""
        });
        renderOperatorTasks();
        renderAgentActions();
        renderActionLanes();
        renderActivityLog();
        btn.textContent = "Task Created";
        btn.disabled = true;
      });
    });

    els.sourceCheckResult.querySelectorAll("[data-preview-import]").forEach(btn => {
      btn.addEventListener("click", () => {
        previewSourceImport(btn.dataset.previewImport, btn.dataset.previewSport || "");
      });
    });

    els.sourceCheckResult.querySelectorAll("[data-visual-test]").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.visualTest || -1);
        const item = items[idx];
        if (!item) return;
        renderVisualTestPlan(item);
      });
    });
    focusSourceCheckResult();
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
    const isPrv = item.target_tool === "prv";
    const visualPlan = buildVisualTestPlan(item);
    const visualKey = getVisualProductKey(visualPlan);
    const visualRecord = state.visualTests[visualKey] || null;
    const knownIssue = state.knownIssues[visualKey] || null;
    const visualLabel = knownIssue ? "Known issue" : getVisualStatusLabel(visualRecord);
    const visualClass = knownIssue ? "warning" : getVisualStatusClass(visualRecord);

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
          <span class="pill visual-status-pill ${escapeHtml(visualClass)}">Visual: ${escapeHtml(visualLabel)}</span>
          ${item.discovery_source ? `<span class="pill">Found: ${escapeHtml(item.discovery_source)}</span>` : ""}
          ${isPrv ? `<span class="pill">Tool: PRV</span>` : ""}
          ${item.comparison_source ? `<span class="pill">Checked: ${escapeHtml(item.comparison_source)}</span>` : ""}
          ${typeof item.sheet_row_count !== "undefined" ? `<span class="pill">Rows: ${formatNumber(item.sheet_row_count)}</span>` : ""}
          ${typeof item.sheet_parallel_count !== "undefined" ? `<span class="pill">Parallels: ${formatNumber(item.sheet_parallel_count)}</span>` : ""}
          ${item.source_url ? `<a class="pill source-link" href="${escapeHtml(item.source_url)}" target="_blank" rel="noopener noreferrer">Source</a>` : ""}
        </div>
        <div class="opp-actions">
          <button class="action-btn" type="button" data-visual-test="${idx}">Test CV/ChatBot</button>
          ${canTask ? `
            ${isPrv ? "" : `<button class="action-btn approve" type="button" data-preview-import="${escapeHtml(item.source_url || "")}" data-preview-sport="${escapeHtml(item.sport || "")}">Preview Import</button>`}
            <button class="action-btn" type="button" data-source-task="${idx}">Create Operator Task</button>
          ` : ""}
        </div>
      </article>
    `;
  }

  function renderVisualTestPlan(item) {
    const plan = buildVisualTestPlan(item);
    const visualKey = getVisualProductKey(plan);
    const currentRecord = state.visualTests[visualKey] || null;
    const knownIssue = state.knownIssues[visualKey] || null;
    els.sourceCheckResult.innerHTML = `
      <div class="visual-test-card">
        <div class="opp-top">
          <div>
            <h3>CV / ChatBot Visual Test</h3>
            <p>${escapeHtml(plan.productName || "Untitled product")}</p>
          </div>
          <span class="badge ${escapeHtml(knownIssue ? "warning" : getVisualStatusClass(currentRecord))}">${escapeHtml(knownIssue ? "known issue" : getVisualStatusLabel(currentRecord))}</span>
        </div>
        <div class="opp-meta">
          ${plan.code ? `<span class="pill">Code: ${escapeHtml(plan.code)}</span>` : ""}
          ${plan.sport ? `<span class="pill">Sport: ${escapeHtml(titleCase(plan.sport))}</span>` : ""}
          <span class="pill">Run after JSON publish has propagated</span>
        </div>
        <div class="task-guardrail">This is a visual behavior check. JSON validation remains the source-of-truth data check.</div>
        ${renderVisualStatusPanel(plan, currentRecord, knownIssue)}
        <div class="opp-actions">
          <button class="action-btn approve" type="button" data-run-agent-visual="1">Run Agent Visual Test</button>
          <button class="action-btn" type="button" data-refresh-agent-visual="1">Refresh Test Status</button>
          <button class="action-btn ignore" type="button" data-known-agent-visual="1">${knownIssue ? "Clear Known Issue" : "Mark Known Issue"}</button>
        </div>
        <div class="visual-runner-copy">
          <span><strong>product_name</strong>${escapeHtml(plan.productName || "")}</span>
          <span><strong>sport</strong>${escapeHtml(plan.sport || "")}</span>
          <span><strong>product_code</strong>${escapeHtml(plan.code || "")}</span>
        </div>
        <div class="visual-test-grid">
          <div>
            <h4>ChatBot Queries</h4>
            ${plan.chatbotQueries.map((query, index) => `
              <a class="test-link" href="https://app.chasingmajors.com/ChatBot/?q=${encodeURIComponent(query)}" target="_blank" rel="noopener noreferrer">
                <strong>${escapeHtml(index === plan.chatbotQueries.length - 1 ? "Ambiguity check" : "Product check")}</strong>
                <span>${escapeHtml(query)}</span>
              </a>
            `).join("")}
          </div>
          <div>
            <h4>Checklist Vault Checks</h4>
            ${plan.checklistQueries.map(check => `
              <a class="test-link" href="${escapeHtml(check.url)}" target="_blank" rel="noopener noreferrer">
                <strong>${escapeHtml(check.label)}</strong>
                <span>${escapeHtml(plan.productName)}</span>
              </a>
            `).join("")}
          </div>
        </div>
        <div class="visual-expectations">
          <div>
            <h4>Expected ChatBot Result</h4>
            ${plan.expectedExact.map(itemText => `<span>${escapeHtml(itemText)}</span>`).join("")}
          </div>
          <div>
            <h4>Expected Ambiguity Result</h4>
            ${plan.expectedAmbiguous.map(itemText => `<span>${escapeHtml(itemText)}</span>`).join("")}
          </div>
          <div>
            <h4>Expected CV Result</h4>
            ${plan.expectedChecklist.map(itemText => `<span>${escapeHtml(itemText)}</span>`).join("")}
          </div>
        </div>
      </div>
    `;

    const runBtn = els.sourceCheckResult.querySelector("[data-run-agent-visual]");
    if (runBtn) {
      runBtn.addEventListener("click", () => runAgentVisualTest(plan));
    }

    const refreshBtn = els.sourceCheckResult.querySelector("[data-refresh-agent-visual]");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => refreshAgentVisualTestStatus(plan));
    }

    const knownBtn = els.sourceCheckResult.querySelector("[data-known-agent-visual]");
    if (knownBtn) {
      knownBtn.addEventListener("click", () => toggleKnownVisualIssue(plan));
    }
    focusSourceCheckResult();
  }

  function renderVisualStatusPanel(plan, record, knownIssue) {
    const label = knownIssue ? "Known issue" : getVisualStatusLabel(record);
    const statusClass = knownIssue ? "warning" : getVisualStatusClass(record);
    const updated = record?.updatedAt ? new Date(record.updatedAt).toLocaleString() : "Never";

    return `
      <div class="visual-status-panel ${escapeHtml(statusClass)}">
        <div>
          <strong>Agent status</strong>
          <span>${escapeHtml(label)}</span>
        </div>
        <div>
          <strong>Last checked</strong>
          <span>${escapeHtml(updated)}</span>
        </div>
        ${record?.runUrl ? `
          <div>
            <strong>GitHub run</strong>
            <a href="${escapeHtml(record.runUrl)}" target="_blank" rel="noopener noreferrer">Open report</a>
          </div>
        ` : ""}
        ${knownIssue ? `
          <div class="visual-known-note">
            <strong>Hold note</strong>
            <span>${escapeHtml(knownIssue.note || "Known issue. Hold fix for later.")}</span>
          </div>
        ` : ""}
      </div>
    `;
  }

  async function runAgentVisualTest(plan, options) {
    const opts = options || {};
    const endpoint = readOperatorEndpoint();
    const key = readOperatorKey();

    if (!endpoint) {
      renderSourceCheckMessage("Operator Backend needed", "Save the Apps Script Operator Backend URL before running agent visual tests.", "warning");
      return { ok: false, error: "Operator Backend URL missing." };
    }

    if (!key) {
      renderSourceCheckMessage("Admin write key needed", "Enter and save the admin write key before running agent visual tests.", "warning");
      return { ok: false, error: "Admin write key missing." };
    }

    if (!opts.silent) {
      renderSourceCheckMessage("Queuing agent visual test", "The Operator Backend is starting the GitHub Actions CV/ChatBot test for this product.", "info");
    }

    try {
      const url = endpoint
        + (endpoint.indexOf("?") > -1 ? "&" : "?")
        + "action=dispatchVisualProductTest"
        + "&productName=" + encodeURIComponent(plan.productName || "")
        + "&sport=" + encodeURIComponent(plan.sport || "")
        + "&code=" + encodeURIComponent(plan.code || "")
        + "&key=" + encodeURIComponent(key);

      const data = await fetchJson(url, { timeoutMs: 60000 });
      renderVisualDispatchResult(data, plan, { silentPanel: !!opts.silentPanel });
      return data;
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      if (!opts.silent) renderSourceCheckMessage("Agent visual test failed", message, "critical");
      return { ok: false, error: message };
    }
  }

  async function refreshAgentVisualTestStatus(plan, options) {
    const endpoint = readOperatorEndpoint();
    const key = readOperatorKey();
    const existing = state.visualTests[getVisualProductKey(plan)] || {};
    const opts = options || {};

    if (!endpoint) {
      renderSourceCheckMessage("Operator Backend needed", "Save the Apps Script Operator Backend URL before refreshing visual test status.", "warning");
      return;
    }

    if (!key) {
      renderSourceCheckMessage("Admin write key needed", "Enter and save the admin write key before refreshing visual test status.", "warning");
      return;
    }

    if (!opts.silent) {
      renderSourceCheckMessage("Checking visual test status", "The Operator Backend is reading the latest GitHub Actions result for this product.", "info");
    }

    try {
      const url = endpoint
        + (endpoint.indexOf("?") > -1 ? "&" : "?")
        + "action=getVisualProductTestStatus"
        + "&productName=" + encodeURIComponent(plan.productName || "")
        + "&sport=" + encodeURIComponent(plan.sport || "")
        + "&code=" + encodeURIComponent(plan.code || "")
        + "&startedAt=" + encodeURIComponent(existing.startedAt || "")
        + "&key=" + encodeURIComponent(key);

      const data = await fetchJson(url, { timeoutMs: 60000 });
      renderVisualStatusResult(data, plan);
      if (!isTerminalVisualRecord(data)) {
        scheduleVisualStatusPoll(plan, (opts.pollAttempt || 1) + 1);
      }
    } catch (err) {
      if (!opts.silent) {
        renderSourceCheckMessage("Visual status check failed", err && err.message ? err.message : String(err), "critical");
      }
    }
  }

  function getCommandCenterTestUrl() {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  async function runSentinelSelfTest(options) {
    const opts = options || {};
    const endpoint = readOperatorEndpoint();
    const key = readOperatorKey();

    if (!endpoint) {
      renderSourceCheckMessage("Operator Backend needed", "Save the Apps Script Operator Backend URL before running the Sentinel self-test.", "warning");
      return;
    }

    if (!key) {
      renderSourceCheckMessage("Admin write key needed", "Enter and save the admin write key before running the Sentinel self-test.", "warning");
      return;
    }

    renderSentinelNotice("Sentinel self-test queued", "Asking GitHub Actions to open the cockpit, click key controls, and report pass/fail.", "info");
    renderSourceCheckMessage("Queuing Sentinel self-test", "The Operator Backend is starting the GitHub Actions cockpit smoke test.", "info");
    logActivity({
      type: "sentinel_self_test",
      status: "started",
      source: "command_center",
      title: "Sentinel self-test requested",
      detail: "Queueing GitHub Actions to test CM Sentinel behavior."
    });
    renderActivityLog();

    try {
      const url = endpoint
        + (endpoint.indexOf("?") > -1 ? "&" : "?")
        + "action=dispatchSentinelSelfTest"
        + "&commandCenterUrl=" + encodeURIComponent(getCommandCenterTestUrl())
        + "&key=" + encodeURIComponent(key);

      const data = await fetchJson(url, { timeoutMs: 60000 });
      if (opts.recoveryActionId && data && data.ok) {
        const recovery = state.agentActions.find(action => action.id === opts.recoveryActionId);
        if (recovery) {
          updateAgentAction(opts.recoveryActionId, {
            executionResult: "Safe recovery attempted: reran Sentinel self-test.",
            validationResult: "Recovery retest queued; waiting for GitHub Actions result."
          });
          renderAgentActions();
          renderActionLanes();
        }
      }
      renderSentinelSelfTestDispatchResult(data);
    } catch (err) {
      const detail = err && err.message ? err.message : String(err);
      renderSourceCheckMessage("Sentinel self-test failed", detail, "critical");
      renderSentinelNotice("Sentinel self-test failed", detail, "critical");
      logActivity({
        type: "sentinel_self_test",
        status: "failed",
        source: "operator_backend",
        title: "Sentinel self-test failed",
        detail
      });
      renderActivityLog();
    }
  }

  function renderSentinelSelfTestDispatchResult(data) {
    if (!data || !data.ok) {
      const detail = data && data.error ? data.error : "Unknown backend response.";
      renderSourceCheckMessage("Sentinel self-test did not queue", detail, "critical");
      renderSentinelNotice("Sentinel self-test did not queue", detail, "critical");
      return;
    }

    state.sentinelSelfTest = {
      status: data.status || "queued",
      result: "queued",
      startedAt: data.started_at || new Date().toISOString(),
      runUrl: data.workflow_url || data.actions_url || "",
      commandCenterUrl: data.command_center_url || getCommandCenterTestUrl()
    };
    writeSentinelSelfTest();

    logActivity({
      type: "sentinel_self_test",
      status: "queued",
      source: "github_actions",
      title: "Sentinel self-test queued",
      detail: "GitHub Actions is starting the cockpit behavior test."
    });
    renderActivityLog();
    renderSentinelNotice("Sentinel self-test queued", "GitHub Actions may take a few seconds to show the new run. Sentinel will poll for the result.", "info");
    renderSourceCheckMessage("Sentinel self-test queued", data.note || "GitHub Actions may take a few seconds to show the new run.", "info");
    renderSentinelSelfTestPanel();
    scheduleSentinelSelfTestPoll(1);
  }

  function upsertSentinelIncident(data, options) {
    const opts = options || {};
    const runUrl = data && (data.run_url || data.workflow_url) ? (data.run_url || data.workflow_url) : state.sentinelSelfTest && state.sentinelSelfTest.runUrl || "";
    const status = opts.status || "failed";
    const action = upsertAgentAction({
      id: "sentinel_incident_command_center_self_test",
      type: "sentinel_incident",
      source: "github_actions",
      product: "CM Sentinel Command Center",
      sport: "",
      code: "sentinel_command_center",
      riskLevel: "high",
      status,
      recommendedAction: opts.recommendedAction || "Investigate failed Sentinel self-test. Use the GitHub report and screenshots to identify the failing control, then rerun the self-test.",
      executionResult: opts.executionResult || "Sentinel self-test failed. Safe recovery has not run yet.",
      validationResult: opts.validationResult || "Cockpit health test failed.",
      runUrl
    });
    renderAgentActions();
    renderActionLanes();
    return action;
  }

  function attemptSentinelIncidentRecovery(action) {
    updateAgentAction(action.id, {
      status: "running",
      executionResult: "Safe recovery attempted: rerunning Sentinel self-test once before admin review.",
      validationResult: "Retest queued; waiting for GitHub Actions result."
    });
    logActivity({
      type: "sentinel_incident",
      status: "started",
      product: action.product || "CM Sentinel Command Center",
      source: "command_center",
      title: "Sentinel safe recovery started",
      detail: "Agent is rerunning the Sentinel self-test once as a safe recovery step."
    });
    renderAgentActions();
    renderActionLanes();
    renderActivityLog();
    runSentinelSelfTest({ recoveryActionId: action.id });
  }

  function attemptPrvSyncIncidentRecovery(action) {
    updateAgentAction(action.id, {
      status: "running",
      executionResult: "Safe recovery attempted: retrying full PRV JSON sync once before admin review.",
      validationResult: "Retry running through Operator Backend and Static Data Exporter."
    });
    logActivity({
      type: "prv_sync_incident",
      status: "started",
      product: action.product || "Print Run Vault JSON Sync",
      source: "command_center",
      title: "PRV safe recovery started",
      detail: "Agent is rerunning the full PRV JSON sync once as a safe recovery step."
    });
    renderAgentActions();
    renderActionLanes();
    renderActivityLog();
    publishPrvVaultData("", action.id, { fullSync: true, recovery: true });
  }

  async function refreshSentinelSelfTestStatus(options) {
    const endpoint = readOperatorEndpoint();
    const key = readOperatorKey();
    const opts = options || {};

    if (!endpoint || !key || !state.sentinelSelfTest) return;

    try {
      const url = endpoint
        + (endpoint.indexOf("?") > -1 ? "&" : "?")
        + "action=getSentinelSelfTestStatus"
        + "&startedAt=" + encodeURIComponent(state.sentinelSelfTest.startedAt || "")
        + "&key=" + encodeURIComponent(key);
      const data = await fetchJson(url, { timeoutMs: 60000 });
      renderSentinelSelfTestStatusResult(data);
      if (!isTerminalSentinelSelfTest(data)) {
        scheduleSentinelSelfTestPoll((opts.pollAttempt || 1) + 1);
      }
    } catch (err) {
      if (!opts.silent) {
        const detail = err && err.message ? err.message : String(err);
        renderSourceCheckMessage("Sentinel self-test status failed", detail, "critical");
      }
    }
  }

  function renderSentinelSelfTestStatusResult(data) {
    if (!data || !data.ok) return;
    const result = data.result || data.conclusion || data.status || "queued";
    state.sentinelSelfTest = Object.assign({}, state.sentinelSelfTest || {}, {
      status: data.status || "",
      result,
      runUrl: data.run_url || data.workflow_url || (state.sentinelSelfTest && state.sentinelSelfTest.runUrl) || "",
      runNumber: data.run_number || "",
      updatedAt: data.updated_at || new Date().toISOString()
    });
    writeSentinelSelfTest();

    const passed = result === "passed" || data.conclusion === "success";
    const failed = result === "failed" || data.conclusion === "failure";
    if (passed || failed) {
      const incident = state.agentActions.find(action => action.id === "sentinel_incident_command_center_self_test");
      if (passed && incident) {
        updateAgentAction(incident.id, {
          status: "validated",
          executionResult: incident.executionResult || "Safe recovery retest completed.",
          validationResult: "Sentinel self-test passed after agent recovery/retest."
        });
      } else if (failed) {
        const hasIncident = !!incident;
        const execution = incident && incident.executionResult ? incident.executionResult : "";
        upsertSentinelIncident(data, {
          status: execution.toLowerCase().includes("safe recovery attempted") ? "fix_attempted" : "failed",
          executionResult: execution || "Sentinel self-test failed. Safe recovery has not run yet.",
          validationResult: execution.toLowerCase().includes("safe recovery attempted")
            ? "Safe recovery retest failed. Admin review required."
            : "Cockpit health test failed. Agent can attempt one safe recovery retest.",
          recommendedAction: hasIncident
            ? "Open the GitHub report/screenshots. If the failure is a code regression, create a fix task. If it is transient, rerun self-test once."
            : "Run Agent Cycle to let Sentinel attempt one safe recovery retest."
        });
      }
      logActivity({
        type: "sentinel_self_test",
        status: passed ? "validated" : "failed",
        source: "github_actions",
        title: passed ? "Sentinel self-test passed" : "Sentinel self-test failed",
        detail: passed
          ? "Cockpit behavior test passed in GitHub Actions."
          : "Cockpit behavior test failed. Open the report for screenshots and failing checks."
      });
      renderActivityLog();
      renderAgentActions();
      renderActionLanes();
      renderSentinelNotice(
        passed ? "Sentinel self-test passed" : "Sentinel self-test failed",
        passed
          ? (incident ? "Agent recovery/retest passed. The cockpit is healthy again." : "The cockpit loaded and core agent controls responded.")
          : "Incident card created. Run Agent Cycle for one safe recovery attempt, then review the report if it still fails.",
        passed ? "success" : "critical"
      );
    }

    renderSentinelSelfTestPanel();
  }

  function renderSentinelSelfTestPanel() {
    if (!els.publicToolAuditResult || !state.sentinelSelfTest) return;
    const record = state.sentinelSelfTest;
    const result = record.result || record.status || "queued";
    const statusClass = result === "passed" ? "pass" : result === "failed" ? "warn" : "review";
    els.publicToolAuditResult.innerHTML = `
      <div class="public-tool-summary">Sentinel self-test ${escapeHtml(result)}. This checks the cockpit UI, public audit button, health check, agent cycle response, and desktop/mobile overflow.</div>
      <article class="public-tool-card ${escapeHtml(statusClass)}">
        <div>
          <strong>Sentinel Self-Test</strong>
          <span>${escapeHtml(record.commandCenterUrl || getCommandCenterTestUrl())}</span>
        </div>
        <em>${escapeHtml(result)}</em>
      </article>
      <article class="public-tool-card review">
        <div>
          <strong>GitHub Report</strong>
          <span>${record.runUrl ? "Workflow run is available." : "Waiting for GitHub Actions to expose the run."}</span>
        </div>
        ${record.runUrl ? `<a href="${escapeHtml(record.runUrl)}" target="_blank" rel="noopener noreferrer">Open</a>` : "<em>queued</em>"}
      </article>
    `;
  }

  function scheduleSentinelSelfTestPoll(attempt) {
    const nextAttempt = Number(attempt || 1);
    if (nextAttempt > 12) return;
    if (state.sentinelSelfTestTimer) clearTimeout(state.sentinelSelfTestTimer);
    state.sentinelSelfTestTimer = setTimeout(() => {
      refreshSentinelSelfTestStatus({ silent: true, pollAttempt: nextAttempt });
    }, nextAttempt < 3 ? 10000 : 20000);
  }

  function isTerminalSentinelSelfTest(data) {
    const result = String(data && (data.result || data.conclusion || "") || "").toLowerCase();
    return result === "passed" || result === "failed" || result === "success" || result === "failure";
  }

  function toggleKnownVisualIssue(plan) {
    const key = getVisualProductKey(plan);
    if (!key) return;

    if (state.knownIssues[key]) {
      delete state.knownIssues[key];
      logActivity({
        type: "known_issue",
        status: "cleared",
        product: plan.productName || "",
        source: "admin",
        title: "Known issue cleared",
        detail: "Product visual test is back in the active queue."
      });
    } else {
      state.knownIssues[key] = {
        productName: plan.productName || "",
        sport: plan.sport || "",
        code: plan.code || "",
        note: "Known issue. Hold fix for later.",
        createdAt: new Date().toISOString()
      };
      upsertAgentAction({
        type: "known_issue",
        source: "admin",
        product: plan.productName || "",
        sport: plan.sport || "",
        code: plan.code || "",
        riskLevel: "medium",
        status: "known_issue",
        recommendedAction: "Hold fix for later, but keep issue visible in the queue."
      });
      logActivity({
        type: "known_issue",
        status: "held",
        product: plan.productName || "",
        source: "admin",
        title: "Known issue marked",
        detail: "Issue remains visible without blocking the current workflow."
      });
    }

    writeKnownIssues();

    if (state.visualTests[key]) {
      state.visualTests[key].knownIssue = !!state.knownIssues[key];
      state.visualTests[key].knownIssueNote = state.knownIssues[key]?.note || "";
      writeVisualTests();
    }

    renderVisualTestPlan(plan);
    renderAgentActions();
    renderActionLanes();
    renderActivityLog();
  }

  function renderVisualDispatchResult(data, plan, options) {
    const opts = options || {};
    if (!data || !data.ok) {
      renderSourceCheckMessage(
        "Agent visual test failed",
        data && data.error ? data.error : "Unknown backend response.",
        "critical"
      );
      return;
    }

    const record = saveVisualRecord(plan, {
      status: data.status || "queued",
      result: data.result || data.status || "queued",
      conclusion: data.conclusion || "",
      startedAt: data.started_at || new Date().toISOString(),
      runUrl: data.run_url || "",
      workflowUrl: data.workflow_url || "",
      actionsUrl: data.actions_url || "",
      trackingKey: data.tracking_key || getVisualProductKey(plan)
    });
    upsertAgentAction({
      type: "visual_test",
      source: "github_actions",
      product: plan.productName || data.product_name || "",
      sport: plan.sport || data.sport || "",
      code: plan.code || data.product_code || "",
      riskLevel: "low",
      status: "queued",
      recommendedAction: "Run CV and ChatBot visual checks after publish.",
      executionResult: "GitHub Actions visual test queued.",
      runUrl: data.workflow_url || data.actions_url || ""
    });
    updateRelatedProductActionFromVisual(plan, "queued", data.workflow_url || data.actions_url || "");
    logActivity({
      type: "visual_test",
      status: "queued",
      product: plan.productName || data.product_name || "",
      source: "github_actions",
      title: "Visual test queued",
      detail: "CV/ChatBot behavior check started."
    });

    if (opts.silentPanel) {
      scheduleVisualStatusPoll(plan, 1);
      renderAgentActions();
      renderActionLanes();
      renderActivityLog();
      return;
    }

    els.sourceCheckResult.innerHTML = `
      <div class="visual-test-card">
        <div class="opp-top">
          <div>
            <h3>Agent Visual Test Queued</h3>
            <p>${escapeHtml(data.product_name || plan.productName || "")}</p>
          </div>
          <span class="badge ${escapeHtml(getVisualStatusClass(record))}">${escapeHtml(getVisualStatusLabel(record))}</span>
        </div>
        <div class="opp-meta">
          <span class="pill">Sport: ${escapeHtml(titleCase(data.sport || plan.sport || ""))}</span>
          ${data.product_code || plan.code ? `<span class="pill">Code: ${escapeHtml(data.product_code || plan.code || "")}</span>` : ""}
          <span class="pill">GitHub Actions</span>
        </div>
        <p>${escapeHtml(data.note || "GitHub may take a few seconds to show the new run.")}</p>
        <div class="opp-actions">
          ${data.workflow_url ? `<a class="action-btn approve" href="${escapeHtml(data.workflow_url)}" target="_blank" rel="noopener noreferrer">Open Workflow Run</a>` : ""}
          ${data.actions_url ? `<a class="action-btn" href="${escapeHtml(data.actions_url)}" target="_blank" rel="noopener noreferrer">Open Actions</a>` : ""}
          <button class="action-btn" type="button" data-refresh-agent-visual="1">Refresh Test Status</button>
          <button class="action-btn ignore" type="button" data-known-agent-visual="1">Mark Known Issue</button>
        </div>
        <div class="task-guardrail">The artifact will include a pass/fail report and screenshots if CV or ChatBot behavior breaks.</div>
      </div>
    `;

    const refreshBtn = els.sourceCheckResult.querySelector("[data-refresh-agent-visual]");
    if (refreshBtn) refreshBtn.addEventListener("click", () => refreshAgentVisualTestStatus(plan));

    const knownBtn = els.sourceCheckResult.querySelector("[data-known-agent-visual]");
    if (knownBtn) knownBtn.addEventListener("click", () => toggleKnownVisualIssue(plan));
    scheduleVisualStatusPoll(plan, 1);
    focusSourceCheckResult();
    renderAgentActions();
    renderActionLanes();
    renderActivityLog();
  }

  function renderVisualStatusResult(data, plan) {
    if (!data || !data.ok) {
      renderSourceCheckMessage(
        "Visual status check failed",
        data && data.error ? data.error : "Unknown backend response.",
        "critical"
      );
      return;
    }

    saveVisualRecord(plan, {
      status: data.status || "",
      result: data.result || data.conclusion || data.status || "",
      conclusion: data.conclusion || "",
      runId: data.run_id || "",
      runNumber: data.run_number || "",
      runUrl: data.run_url || "",
      displayTitle: data.display_title || "",
      headSha: data.head_sha || "",
      createdAt: data.created_at || "",
      checkedAt: new Date().toISOString()
    });
    upsertAgentAction({
      type: "visual_test",
      source: "github_actions",
      product: plan.productName || data.product_name || "",
      sport: plan.sport || data.sport || "",
      code: plan.code || data.product_code || "",
      riskLevel: data.result === "failed" ? "medium" : "low",
      status: data.result === "passed" ? "validated" : data.result === "failed" ? "failed" : data.result || "running",
      recommendedAction: data.result === "failed"
        ? "Review failed visual report and prepare a product/query-specific fix."
        : "Visual validation complete.",
      validationResult: data.result || data.status || "",
      runUrl: data.run_url || ""
    });
    updateRelatedProductActionFromVisual(plan, data.result || data.conclusion || data.status || "", data.run_url || "");
    logActivity({
      type: "visual_test",
      status: data.result || data.status || "",
      product: plan.productName || data.product_name || "",
      source: "github_actions",
      title: "Visual test status updated",
      detail: data.result === "failed"
        ? "Visual test failed. Open the report and review screenshots/errors before marking validated."
        : data.run_url ? "GitHub Actions run linked in the Agent Action Queue." : "No GitHub run visible yet."
    });

    renderVisualTestPlan(plan);
    renderAgentActions();
    renderActionLanes();
    renderActivityLog();
    if (!isTerminalVisualRecord(data)) scheduleVisualStatusPoll(plan, 1);
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
    focusSourceCheckResult();
  }

  function renderPrvPreview(data) {
    if (!data || !data.ok) {
      renderSourceCheckMessage("PRV preview failed", data && data.error ? data.error : "Unknown backend response.", "critical");
      return;
    }

    if (data.status === "ignored") {
      renderSourceCheckMessage("Ignored PRV source", data.reason || "Unsupported source.", "warning");
      return;
    }

    const product = data.product || {};
    const rows = Array.isArray(data.sample_rows) ? data.sample_rows : [];
    const warnings = Array.isArray(data.warnings) ? data.warnings : [];
    const parsedRows = Number(data.row_count || 0);
    const hasRows = parsedRows > 0;
    const statusLabel = hasRows ? data.status || "preview_ready" : "parser_review";

    els.sourceCheckResult.innerHTML = `
      <div class="import-preview-card ${hasRows ? "" : "parser-review-card"}">
        <div class="opp-top">
          <div>
            <h3>${hasRows ? "PRV Source Preview" : "PRV Parser Review Needed"}</h3>
            <p>${escapeHtml(product.display_name || "Untitled product")}</p>
          </div>
          <span class="badge ${hasRows ? "opportunity" : "warning"}">${escapeHtml(statusLabel)}</span>
        </div>
        <div class="opp-meta">
          <span class="pill">Code: ${escapeHtml(product.code || "")}</span>
          <span class="pill">Sport: ${escapeHtml(titleCase(product.sport || ""))}</span>
          <span class="pill">Year: ${escapeHtml(product.year || "")}</span>
          <span class="pill">Rows parsed: ${formatNumber(parsedRows)}</span>
          <a class="pill source-link" href="${escapeHtml(data.source_url || "")}" target="_blank" rel="noopener noreferrer">Source</a>
        </div>
        ${!hasRows ? `
          <div class="parser-review-message">
            <strong>Source found. No usable PRV rows parsed.</strong>
            <span>This usually means the post uses a layout the parser does not understand yet, or the article mentions the product without a structured print-run breakdown. Do not write PRV temp data until the parser is updated or the rows are entered manually.</span>
          </div>
        ` : ""}
        ${warnings.length ? `
          <div class="task-guardrail">${warnings.map(escapeHtml).join(" ")}</div>
        ` : ""}
        <div class="preview-grid">
          <div>
            <h4>Sample PRV Rows</h4>
            ${rows.length ? rows.map(renderPrvPreviewRow).join("") : `<p>No print-run rows parsed.</p>`}
          </div>
          <div>
            <h4>Next Step</h4>
            <p>${escapeHtml(hasRows ? data.next_step || "Review these rows before PRV sheet write is enabled." : "Open the source and decide whether this needs a parser update, manual PRV entry, or should be ignored for now.")}</p>
            <div class="task-guardrail">${hasRows ? "This writes only one PRV product code. It does not delete other PRV products or publish JSON." : "Write is disabled because there are no parsed rows."}</div>
            ${hasRows && data.status === "preview_ready" ? `
              <button class="action-btn approve" type="button" data-execute-prv-import="${escapeHtml(data.source_url || "")}" data-execute-prv-sport="${escapeHtml(product.sport || "")}">Write PRV Temp Data</button>
            ` : ""}
          </div>
        </div>
      </div>
    `;
    els.sourceCheckResult.querySelectorAll("[data-execute-prv-import]").forEach(btn => {
      btn.addEventListener("click", () => {
        executePrvSourceImport(btn.dataset.executePrvImport, btn.dataset.executePrvSport || "");
      });
    });
    focusSourceCheckResult();
  }

  function renderPrvExecuteResult(data, actionId) {
    if (!data || !data.ok) {
      const detail = data && data.error ? data.error : "Unknown backend response.";
      if (actionId) {
        updateAgentAction(actionId, {
          status: "failed",
          executionResult: detail,
          validationResult: "PRV sheet write did not complete.",
          recommendedAction: "Open PRV preview, confirm rows, then retry the product-scoped write."
        });
        renderAgentActions();
        renderActionLanes();
      }
      logActivity({
        type: "prv_source_review",
        status: "failed",
        source: "operator_backend",
        title: "PRV sheet write blocked",
        detail: detail
      });
      renderActivityLog();
      renderSourceCheckMessage("PRV sheet write blocked", detail, "critical");
      return;
    }

    const product = data.product || {};
    const validation = data.validation || {};
    if (actionId) {
      updateAgentAction(actionId, {
        type: "prv_source_review",
        status: validation.ok ? "needs_admin" : "known_issue",
        product: product.display_name || "",
        sport: product.sport || "",
        code: product.code || "",
        executionResult: validation.ok ? "PRV Index and Products rows written." : "PRV write completed but validation needs review.",
          validationResult: validation.ok ? `${formatNumber(validation.product_rows || 0)} PRV rows found in Products.` : "PRV row validation did not pass.",
          recommendedAction: "Review PRV sheet rows, then publish PRV JSON when ready."
        });
      renderAgentActions();
      renderActionLanes();
    }

    logActivity({
      type: "prv_source_review",
      status: validation.ok ? "needs_review" : "failed",
      product: product.display_name || "",
      source: "operator_backend",
      title: "PRV temp data written",
      detail: `${formatNumber(validation.index_rows || 0)} Index row and ${formatNumber(validation.product_rows || 0)} Products rows validated.`
    });
    renderActivityLog();

    els.sourceCheckResult.innerHTML = `
      <div class="source-result-card ${validation.ok ? "covered" : ""}">
        <div class="opp-top">
          <div>
            <h3>PRV Temp Data Written</h3>
            <p>${escapeHtml(product.display_name || "")}</p>
          </div>
          <span class="badge ${validation.ok ? "opportunity" : "warning"}">${validation.ok ? "review" : "needs_review"}</span>
        </div>
        <div class="opp-meta">
          <span class="pill">Code: ${escapeHtml(product.code || "")}</span>
          <span class="pill">Index rows: ${formatNumber(validation.index_rows || 0)}</span>
          <span class="pill">Products rows: ${formatNumber(validation.product_rows || 0)}</span>
          <span class="pill">Publish: Manual review</span>
        </div>
        <div class="task-guardrail">${escapeHtml(data.publish && data.publish.reason ? data.publish.reason : "Review PRV sheet rows before publishing static JSON.")}</div>
        <p>${escapeHtml(data.next_step || "Review the PRV Google Sheet, then run publishVaultStaticDataToGitHub when ready.")}</p>
        <div class="opp-actions">
          <button class="action-btn approve" type="button" data-publish-prv-code="${escapeHtml(product.code || "")}">Publish PRV JSON</button>
        </div>
      </div>
    `;
    els.sourceCheckResult.querySelectorAll("[data-publish-prv-code]").forEach(btn => {
      btn.addEventListener("click", () => {
        publishPrvVaultData(btn.dataset.publishPrvCode || "", actionId);
      });
    });
    focusSourceCheckResult();
  }

  function renderPrvPublishResult(data, actionId, options) {
    options = options || {};
    const publish = data && data.publish ? data.publish : {};
    const validation = publish && publish.validation ? publish.validation : {};
    const publishOk = !!(data && data.ok);
    const ok = !!(publishOk && validation && validation.ok);
    const code = data && data.code ? data.code : publish.code || "";
    const productName = actionId ? (state.agentActions.find(item => item.id === actionId) || {}).product : "";
    const isFullSync = !!options.fullSync || !code;
    const validationDetail = validation && validation.ok
      ? isFullSync
        ? `${formatNumber(validation.product_count || 0)} public PRV products and ${formatNumber(validation.row_count || 0)} product rows validated across ${formatNumber(validation.shard_count || 0)} shard${Number(validation.shard_count || 0) === 1 ? "" : "s"}.`
        : `${formatNumber(validation.row_count || 0)} public PRV rows validated.`
      : validation && validation.error
        ? validation.error
        : publishOk
          ? isFullSync
            ? "Full PRV JSON sync completed. Product-level public validation can be run from a PRV action card when needed."
            : "PRV JSON publish completed. Public validation is pending GitHub Pages propagation."
          : data && data.error
            ? data.error
            : "Publish returned without public validation.";

    if (actionId) {
      const existingAction = state.agentActions.find(item => item.id === actionId) || {};
      const updateType = existingAction.type === "prv_sync_incident" ? "prv_sync_incident" : "prv_source_review";
      updateAgentAction(actionId, {
        type: updateType,
        status: ok ? "validated" : "needs_admin",
        executionResult: publishOk ? "PRV JSON publish request completed." : "PRV JSON publish needs review.",
        validationResult: validationDetail,
        recommendedAction: ok ? "Open PRV and confirm the product loads." : "Run PRV public recheck after GitHub Pages propagation."
      });
      renderAgentActions();
      renderActionLanes();
    }

    logActivity({
      type: "prv_publish",
      status: ok ? "validated" : "needs_review",
      product: isFullSync ? "Print Run Vault" : productName || code,
      source: "operator_backend",
      title: isFullSync
        ? publishOk ? "Manual PRV JSON sync completed" : "Manual PRV JSON sync needs review"
        : ok ? "PRV JSON published and validated" : publishOk ? "PRV JSON published, validation pending" : "PRV JSON publish needs review",
      detail: validationDetail
    });
    renderActivityLog();

    if (isFullSync) {
      if (publishOk) {
        upsertPrvSyncIncident(validationDetail, {
          status: "validated",
          executionResult: "PRV full JSON sync completed through Static Data Exporter.",
          validationResult: validationDetail,
          recommendedAction: "No admin action needed unless a specific PRV product fails public validation.",
          source: "operator_backend"
        });
      } else {
        upsertPrvSyncIncident(validationDetail, {
          status: "failed",
          executionResult: "PRV full JSON sync returned a publish review response.",
          validationResult: validationDetail,
          recommendedAction: "Run Agent Cycle to retry PRV JSON sync once before admin review.",
          source: "operator_backend"
        });
      }
    }

    els.sourceCheckResult.innerHTML = `
      <div class="source-result-card ${ok ? "covered" : ""}">
        <div class="opp-top">
          <div>
            <h3>${ok ? "PRV JSON Published" : publishOk ? "PRV Published, Recheck Needed" : "PRV Publish Needs Review"}</h3>
            <p>${escapeHtml(isFullSync ? "Full Print Run Vault sync" : productName || code)}</p>
          </div>
          <span class="badge ${ok ? "opportunity" : "warning"}">${escapeHtml(data && data.status ? data.status : ok ? "published" : "review")}</span>
        </div>
        <div class="opp-meta">
          <span class="pill">${isFullSync ? "Scope: All PRV data" : "Code: " + escapeHtml(code)}</span>
          <span class="pill">Files: ${formatNumber(publish && publish.publish ? publish.publish.files_published || 0 : 0)}</span>
          ${isFullSync ? `<span class="pill">Public products: ${formatNumber(validation && validation.product_count || 0)}</span>` : ""}
          <span class="pill">Public rows: ${formatNumber(validation && validation.row_count || 0)}</span>
          <span class="pill">Validation: ${validation && validation.ok ? "Passed" : "Review"}</span>
        </div>
        ${data && data.error ? `<div class="task-guardrail">${escapeHtml(data.error)}</div>` : ""}
        <p>${escapeHtml(validationDetail)}</p>
        ${isFullSync ? `
          <div class="task-guardrail">${validation && validation.ok
            ? "Full sync is complete. Product-level public validation can still be run from a PRV action card when needed."
            : "Full sync published files, but public validation needs review. Run Sync PRV JSON again after propagation or check Static Data Exporter logs if this repeats."}</div>
        ` : `
          <div class="opp-actions">
            <button class="action-btn approve" type="button" data-recheck-prv-code="${escapeHtml(code)}">Recheck PRV Public JSON</button>
          </div>
        `}
      </div>
    `;
    els.sourceCheckResult.querySelectorAll("[data-recheck-prv-code]").forEach(btn => {
      btn.addEventListener("click", () => {
        recheckPrvPublicData(btn.dataset.recheckPrvCode || "", actionId);
      });
    });
    focusSourceCheckResult();
  }

  function syncPrvJsonOnDemand() {
    return publishPrvVaultData("", null, { fullSync: true });
  }

  function runSentinelCommand(command) {
    const q = normalize(command || "");
    if (!q) {
      renderSourceCheckMessage("Ask Sentinel", "Type a product name or choose one of the quick prompts.", "info");
      return;
    }

    if (q.includes("prv") && (q.includes("sync") || q.includes("publish") || q.includes("json"))) {
      syncPrvJsonOnDemand();
      return;
    }

    if (q.includes("deep") || q.includes("backend") || q.includes("sheet") || q.includes("source truth") || q.includes("data issue")) {
      runDeepBackendAuditWithBackend();
      return;
    }

    if (q.includes("new checklist") || q.includes("checklist center") || q.includes("missing checklist")) {
      runSourceWatchWithBackend("quick_json");
      return;
    }

    if (q.includes("print run") || q.includes("slabsquatch") || q.includes("prv")) {
      runPrvSourceWatchWithBackend();
      return;
    }

    if (q.includes("agent") || q.includes("next")) {
      runAgentCycle();
      return;
    }

    if (q.includes("health") || q.includes("audit") || q.includes("working")) {
      runAudit();
      return;
    }

    if (els.sourceTitleInput) {
      els.sourceTitleInput.value = command;
      validateSourceProductWithBackend();
    }
  }

  function renderPrvPublicValidationResult(data, actionId) {
    const ok = !!(data && data.ok);
    const code = data && data.code ? data.code : "";
    const productName = actionId ? (state.agentActions.find(item => item.id === actionId) || {}).product : "";
    const detail = ok
      ? `${formatNumber(data.row_count || 0)} public PRV rows found.`
      : data && data.error
        ? data.error
        : "Public PRV validation did not pass yet.";

    if (actionId) {
      updateAgentAction(actionId, {
        status: ok ? "validated" : "needs_admin",
        validationResult: detail,
        recommendedAction: ok ? "PRV public JSON is live. Open PRV for final human check." : "Wait for propagation, then recheck again."
      });
      renderAgentActions();
      renderActionLanes();
    }

    logActivity({
      type: "prv_publish",
      status: ok ? "validated" : "needs_review",
      product: productName || code,
      source: "operator_backend",
      title: ok ? "PRV public validation passed" : "PRV public validation pending",
      detail: detail
    });
    renderActivityLog();

    els.sourceCheckResult.innerHTML = `
      <div class="source-result-card ${ok ? "covered" : ""}">
        <div class="opp-top">
          <div>
            <h3>${ok ? "PRV Public JSON Validated" : "PRV Public JSON Pending"}</h3>
            <p>${escapeHtml(productName || code)}</p>
          </div>
          <span class="badge ${ok ? "opportunity" : "warning"}">${ok ? "validated" : "pending"}</span>
        </div>
        <div class="opp-meta">
          <span class="pill">Code: ${escapeHtml(code)}</span>
          <span class="pill">Shard: ${escapeHtml(data && data.shard ? data.shard : "")}</span>
          <span class="pill">Public rows: ${formatNumber(data && data.row_count || 0)}</span>
        </div>
        <p>${escapeHtml(detail)}</p>
      </div>
    `;
    focusSourceCheckResult();
  }

  function renderExecuteResult(data, actionId) {
    if (!data || !data.ok) {
      const preview = data && data.preview ? data.preview : {};
      const rowCount = Number(preview.row_count || 0);
      const parallelCount = Number(preview.parallel_count || 0);
      const baseError = data && data.error ? data.error : "Unknown backend response.";
      const detail = rowCount || parallelCount
        ? `${baseError} Preview parsed ${formatNumber(rowCount)} rows and ${formatNumber(parallelCount)} parallels.`
        : `${baseError} No sheet write was made. Preview or parser review is required before import.`;
      if (actionId) {
        updateAgentAction(actionId, {
          status: "failed",
          executionResult: detail,
          validationResult: "Import did not write to Google Sheets.",
          recommendedAction: "Open Preview Import and the source page. If the parser cannot read rows, create a fix task for source parsing or import mapping."
        });
        logActivity({
          type: "source_import",
          status: "failed",
          product: preview.product && preview.product.display_name ? preview.product.display_name : "",
          source: "operator_backend",
          title: "Import blocked before sheet write",
          detail: detail
        });
        renderAgentActions();
        renderActionLanes();
        renderActivityLog();
      }
      renderSourceCheckMessage("Import blocked before sheet write", detail, "critical");
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
    let primaryAction = null;
    if (actionId) {
      primaryAction = updateAgentAction(actionId, {
        type: "checklist_publish",
        source: "operator_backend",
        status: (validation.ok && publish.ok && publicPassed) ? "validated" : "needs_admin",
        product: product.display_name || "",
        sport: product.sport || "",
        code: product.code || "",
        executionResult: publish.ok ? "Sheet write completed and JSON published." : "Sheet write completed; publish needs review.",
        validationResult: publicPassed ? "CV and ChatBot passed." : "CV/ChatBot validation needs review.",
        runUrl: publish.checklist_url || publish.chatbot_url || ""
      });
    }
    if (!primaryAction) {
      primaryAction = upsertAgentAction({
        type: "checklist_publish",
        source: "operator_backend",
        product: product.display_name || "",
        sport: product.sport || "",
        code: product.code || "",
        riskLevel: publicPassed ? "low" : "medium",
        status: (validation.ok && publish.ok && publicPassed) ? "validated" : "needs_admin",
        recommendedAction: "Product-scoped Sheet write, JSON publish, and CV/ChatBot validation.",
        executionResult: publish.ok ? "JSON published." : "Sheet write completed; publish needs review.",
        validationResult: publicPassed ? "CV and ChatBot passed." : "CV/ChatBot validation needs review.",
        runUrl: publish.checklist_url || publish.chatbot_url || ""
      });
    }
    pruneDuplicateProductActions(primaryAction);
    logActivity({
      type: "checklist_publish",
      status: (validation.ok && publish.ok && publicPassed) ? "validated" : "needs_review",
      product: product.display_name || "",
      source: "operator_backend",
      title: publish.ok ? "Checklist data written and published" : "Checklist data written",
      detail: `${formatNumber(validation.checklist_rows || 0)} checklist rows and ${formatNumber(validation.parallel_rows || 0)} parallels validated in the source sheet.`
    });
    renderAgentActions();
    renderActionLanes();
    renderActivityLog();

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
    focusSourceCheckResult();
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

  function renderPrvPreviewRow(row) {
    return `
      <div class="preview-row">
        <strong>${escapeHtml(row.setType || "")}</strong>
        <span>${escapeHtml(row.setLine || "")}</span>
        <em>${escapeHtml(row.printRun ? "~" + formatNumber(row.printRun) : "")}${row.subSetSize ? " / CL " + escapeHtml(row.subSetSize) : ""}</em>
      </div>
    `;
  }

  function renderSourceCheckMessage(title, detail, severity, options) {
    options = options || {};
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
    if (!options.noFocus) focusSourceCheckResult();
  }

  function renderSentinelNotice(title, detail, severity) {
    if (!els.sentinelNotice) return;
    const className = severity === "critical" ? "critical" : severity === "warning" ? "warning" : severity === "success" ? "success" : "info";
    els.sentinelNotice.className = `sentinel-notice ${className}`;
    els.sentinelNotice.innerHTML = `
      <strong>${escapeHtml(title || "Sentinel update")}</strong>
      <span>${escapeHtml(detail || "")}</span>
    `;
  }

  function setTaskStatus(taskId, status) {
    const task = state.tasks.find(item => item.id === taskId);
    if (!task) return;
    task.status = status;
    task.updatedAt = new Date().toISOString();
    writeTasks();

    if (task.kind === "fix" && task.sourceId) {
      if (status === "done") {
        updateAgentAction(task.sourceId, {
          status: "fix_applied",
          recommendedAction: "Fix task completed. Rerun CV/ChatBot validation before marking this complete.",
          executionResult: "Fix task completed in Operator Tasks.",
          validationResult: "Fix applied. Validation rerun required."
        });
      } else {
        updateAgentAction(task.sourceId, {
          status: "fix_queued",
          recommendedAction: "Fix task is queued in Operator Tasks. Complete it, then rerun validation."
        });
      }
    }

    logActivity({
      type: "operator_task",
      status: status,
      product: task.title || "",
      source: "admin",
      title: "Operator task updated",
      detail: `${task.title || "Task"} marked ${titleCase(status)}.`
    });
    renderOperatorTasks();
    renderAgentActions();
    renderActionLanes();
    renderActivityLog();
  }

  function clearDoneTasks() {
    state.tasks = state.tasks.filter(task => task.status !== "done");
    writeTasks();
    scheduleBackendMemorySave();
    renderOperatorTasks();
  }

  function clearResolvedAgentActions() {
    let remembered = 0;
    (state.agentActions || []).forEach(action => {
      if (isResolvedAgentAction(action) && rememberResolvedSourceAction(action)) remembered += 1;
    });
    if (remembered) writeSourceIgnores();

    state.agentActions = state.agentActions.filter(action => {
      const status = String(action.status || "").toLowerCase();
      return !(status === "validated" || status === "done" || status === "ignored");
    });
    writeAgentActions();
    logActivity({
      type: "agent_action",
      status: "cleaned",
      source: "admin",
      title: "Resolved agent actions cleared",
      detail: `Validated, done, and ignored actions were removed from the active queue.${remembered ? " " + remembered + " source/product keys were remembered so scans do not requeue them." : ""}`
    });
    renderAgentActions();
    renderActionLanes();
    renderActivityLog();
  }

  function clearActivityLog() {
    state.activityLog = [];
    writeActivityLog();
    renderActivityLog();
    updateMemoryStatus("Activity log cleared.", "cleaned");
  }

  function buildAgentMemoryPayload() {
    return {
      ok: true,
      app: "chasing_majors_command_center",
      schema: "agent_memory_v1",
      exported_at: new Date().toISOString(),
      autonomy_mode: state.autonomyMode,
      approvals: state.approvals || {},
      tasks: state.tasks || [],
      agent_actions: state.agentActions || [],
      agent_run_queue: state.agentRunQueue || [],
      activity_log: state.activityLog || [],
      visual_tests: state.visualTests || {},
      known_issues: state.knownIssues || {},
      source_ignores: state.sourceIgnores || {},
      operator_endpoint: readOperatorEndpoint()
    };
  }

  function hasLocalAgentMemory() {
    return !!(
      (state.agentActions || []).length ||
      (state.agentRunQueue || []).length ||
      (state.activityLog || []).length ||
      (state.tasks || []).length ||
      Object.keys(state.visualTests || {}).length ||
      Object.keys(state.knownIssues || {}).length ||
      Object.keys(state.sourceIgnores || {}).length
    );
  }

  function updateMemoryStatus(message, status) {
    if (!els.memoryStatus) return;
    const counts = [
      `${formatNumber((state.agentActions || []).length)} actions`,
      `${formatNumber((state.agentRunQueue || []).length)} queued jobs`,
      `${formatNumber((state.activityLog || []).length)} log entries`,
      `${formatNumber(Object.keys(state.knownIssues || {}).length)} known issues`,
      `${formatNumber(Object.keys(state.sourceIgnores || {}).length)} source ignores`,
      `${formatNumber(Object.keys(state.visualTests || {}).length)} visual statuses`
    ];
    els.memoryStatus.innerHTML = `
      <strong>${escapeHtml(message || "Local memory active")}</strong>
      <span>${escapeHtml(counts.join(" | "))}${status ? ` | ${escapeHtml(status)}` : ""} | memory branch: command-center-memory</span>
    `;
  }

  function exportAgentMemory() {
    const payload = buildAgentMemoryPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
    const a = document.createElement("a");
    a.href = url;
    a.download = `chasing-majors-agent-memory-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    logActivity({
      type: "memory",
      status: "exported",
      source: "admin",
      title: "Agent memory exported",
      detail: "Queue, log, approvals, known issues, and visual status were saved to JSON."
    });
    renderActivityLog();
    updateMemoryStatus("Agent memory exported.", "backup ready");
  }

  function importAgentMemoryPayload(payload) {
    if (!payload || payload.schema !== "agent_memory_v1") {
      throw new Error("This file is not a Command Center agent memory export.");
    }

    state.autonomyMode = payload.autonomy_mode || "approval_required";
    state.approvals = payload.approvals && typeof payload.approvals === "object" ? payload.approvals : {};
    state.tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
    state.agentActions = Array.isArray(payload.agent_actions) ? payload.agent_actions : [];
    state.agentRunQueue = Array.isArray(payload.agent_run_queue) ? payload.agent_run_queue : [];
    state.activityLog = Array.isArray(payload.activity_log) ? payload.activity_log : [];
    state.visualTests = payload.visual_tests && typeof payload.visual_tests === "object" ? payload.visual_tests : {};
    state.knownIssues = payload.known_issues && typeof payload.known_issues === "object" ? payload.known_issues : {};
    state.sourceIgnores = payload.source_ignores && typeof payload.source_ignores === "object" ? payload.source_ignores : {};

    writeAllAgentMemory();
    if (payload.operator_endpoint) writeOperatorEndpoint(payload.operator_endpoint);
    if (els.autonomyModeSelect) els.autonomyModeSelect.value = state.autonomyMode;
    if (els.operatorEndpointInput) els.operatorEndpointInput.value = readOperatorEndpoint();

    logActivity({
      type: "memory",
      status: "imported",
      source: "admin",
      title: "Agent memory imported",
      detail: "Queue, log, approvals, known issues, and visual status were restored."
    });

    render();
    updateMemoryStatus("Agent memory imported.", "restored");
  }

  function importAgentMemoryFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        importAgentMemoryPayload(JSON.parse(String(reader.result || "{}")));
      } catch (err) {
        updateMemoryStatus(err && err.message ? err.message : "Import failed.", "error");
      } finally {
        if (els.importMemoryInput) els.importMemoryInput.value = "";
      }
    };
    reader.onerror = () => {
      updateMemoryStatus("Import failed. Could not read the selected file.", "error");
      if (els.importMemoryInput) els.importMemoryInput.value = "";
    };
    reader.readAsText(file);
  }

  async function saveBackendAgentMemory() {
    return saveBackendAgentMemoryNow({ silent: false });
  }

  function scheduleBackendMemorySave() {
    if (state.backendMemorySuspendAutoSave) return;
    const endpoint = readOperatorEndpoint();
    const key = readOperatorKey();
    if (!endpoint || !key) {
      updateMemoryStatus("Backend auto-save is idle.", "endpoint/key missing");
      return;
    }

    if (state.backendMemorySaveTimer) {
      clearTimeout(state.backendMemorySaveTimer);
    }

    updateMemoryStatus("Backend memory auto-save queued.", "pending");
    state.backendMemorySaveTimer = setTimeout(() => {
      state.backendMemorySaveTimer = null;
      saveBackendAgentMemoryNow({ silent: true });
    }, 1600);
  }

  async function saveBackendAgentMemoryNow(options) {
    const opts = options || {};
    const endpoint = readOperatorEndpoint();
    const key = readOperatorKey();
    if (!endpoint || !key) {
      if (!opts.silent) updateMemoryStatus("Backend save needs Operator Backend URL and admin key.", "missing setup");
      return;
    }
    if (state.backendMemorySaving) {
      if (!opts.silent) updateMemoryStatus("Backend memory save already running.", "working");
      return;
    }

    try {
      state.backendMemorySaving = true;
      updateMemoryStatus(opts.silent ? "Backend memory auto-saving..." : "Saving backend memory...", "working");
      const data = await postOperatorJson(endpoint, {
        action: "saveAgentMemory",
        key: key,
        memory: buildAgentMemoryPayload()
      });
      if (!data || !data.ok) throw new Error(data && data.error ? data.error : "Backend save failed.");

      if (!opts.silent) {
        logActivity({
          type: "memory",
          status: "saved",
          source: "operator_backend",
          title: "Backend memory saved",
          detail: data.path ? `Saved to ${data.path}.` : "Agent memory saved through Operator Backend.",
          noAutoSave: true
        });
        renderActivityLog();
      }
      updateMemoryStatus(opts.silent ? "Backend memory auto-saved." : "Backend memory saved.", data.sha ? `sha ${String(data.sha).slice(0, 7)}` : "saved");
    } catch (err) {
      logActivity({
        type: "memory",
        status: "failed",
        source: "operator_backend",
        title: opts.silent ? "Backend memory auto-save failed" : "Backend memory save failed",
        detail: err && err.message ? err.message : "Backend memory save failed.",
        noAutoSave: true
      });
      renderActivityLog();
      updateMemoryStatus(err && err.message ? err.message : "Backend memory save failed.", "error");
    } finally {
      state.backendMemorySaving = false;
    }
  }

  async function loadBackendAgentMemory() {
    const endpoint = readOperatorEndpoint();
    const key = readOperatorKey();
    if (!endpoint || !key) {
      updateMemoryStatus("Backend load needs Operator Backend URL and admin key.", "missing setup");
      return;
    }

    try {
      updateMemoryStatus("Loading backend memory...", "working");
      const url = endpoint
        + (endpoint.indexOf("?") > -1 ? "&" : "?")
        + "action=loadAgentMemory"
        + "&key=" + encodeURIComponent(key);
      const data = await fetchJson(url, { timeoutMs: 60000 });
      if (!data || !data.ok) throw new Error(data && data.error ? data.error : "Backend load failed.");
      if (!data.has_memory || !data.memory) {
        updateMemoryStatus("No backend memory has been saved yet.", "empty");
        return;
      }

      state.backendMemorySuspendAutoSave = true;
      importAgentMemoryPayload(data.memory);
      state.backendMemorySuspendAutoSave = false;
      logActivity({
        type: "memory",
        status: "loaded",
        source: "operator_backend",
        title: "Backend memory loaded",
        detail: data.path ? `Loaded from ${data.path}.` : "Agent memory loaded from Operator Backend.",
        noAutoSave: true
      });
      renderActivityLog();
      updateMemoryStatus("Backend memory loaded.", data.sha ? `sha ${String(data.sha).slice(0, 7)}` : "loaded");
    } catch (err) {
      state.backendMemorySuspendAutoSave = false;
      updateMemoryStatus(err && err.message ? err.message : "Backend memory load failed.", "error");
    }
  }

  async function autoLoadBackendAgentMemoryIfEmpty() {
    if (state.backendMemoryAutoLoaded || hasLocalAgentMemory()) return;
    if (!readOperatorEndpoint() || !readOperatorKey()) return;

    state.backendMemoryAutoLoaded = true;
    try {
      await loadBackendAgentMemory();
      updateMemoryStatus("Backend memory auto-loaded.", "startup sync");
    } catch (err) {
      updateMemoryStatus(err && err.message ? err.message : "Backend memory auto-load failed.", "error");
    }
  }

  function clearLocalAgentMemory() {
    const confirmed = window.confirm("Clear local Command Center memory in this browser? This does not change GitHub, Google Sheets, or live app data.");
    if (!confirmed) return;

    state.backendMemorySuspendAutoSave = true;

    [
      APPROVAL_KEY,
      TASK_KEY,
      AGENT_ACTION_KEY,
      ACTIVITY_LOG_KEY,
      VISUAL_TEST_KEY,
      KNOWN_ISSUE_KEY,
      SOURCE_IGNORE_KEY,
      AGENT_RUN_QUEUE_KEY
    ].forEach(key => {
      try {
        localStorage.removeItem(key);
      } catch (err) {}
    });

    try {
      sessionStorage.removeItem(OPERATOR_WRITE_KEY);
      localStorage.removeItem(OPERATOR_WRITE_KEY);
    } catch (err) {}

    state.approvals = {};
    state.tasks = [];
    state.agentActions = [];
    state.activityLog = [];
    state.visualTests = {};
    state.knownIssues = {};
    state.sourceIgnores = {};

    logActivity({
      type: "memory",
      status: "cleared",
      source: "admin",
      title: "Local memory cleared",
      detail: "Browser-only queue, log, approvals, known issues, and visual statuses were reset.",
      noAutoSave: true
    });

    render();
    updateMemoryStatus("Local memory cleared.", "reset");
    state.backendMemorySuspendAutoSave = false;
  }

  function clearSourceIgnores() {
    const confirmed = window.confirm("Clear all Source Watch ignore rules? Previously skipped products can appear again on the next scan.");
    if (!confirmed) return;

    state.sourceIgnores = {};
    writeSourceIgnores();
    logActivity({
      type: "source_watch",
      status: "cleared",
      source: "admin",
      title: "Source ignores cleared",
      detail: "Future Source Watch scans can queue products that were previously ignored."
    });
    renderActivityLog();
    updateMemoryStatus("Source ignores cleared.", "admin rule");
  }

  async function runAudit() {
    setLoading();

    try {
      const results = await Promise.allSettled([
        fetchJson(`${DATA_BASE}/checklists/index.json`, { timeoutMs: 12000 }),
        fetchProductBundles({ manifestOnly: true }),
        fetchVaultProducts({ manifestOnly: true }),
        fetchJson(RELEASE_URL, { timeoutMs: 10000 }),
        fetchJson(`${DATA_BASE}/players/mlb-early-signals.json`, { timeoutMs: 10000 })
      ]);

      const checklistIndexPayload = results[0].status === "fulfilled" ? results[0].value : { index: [] };
      const bundleData = results[1].status === "fulfilled" ? results[1].value : { manifests: {}, productsBySport: {}, errors: [{ message: results[1].reason && results[1].reason.message ? results[1].reason.message : "Checklist manifests failed." }], manifestOnly: true };
      const vaultData = results[2].status === "fulfilled" ? results[2].value : { manifest: {}, products: {}, productMap: {}, errors: [{ message: results[2].reason && results[2].reason.message ? results[2].reason.message : "Vault manifest failed." }], manifestOnly: true };
      const releasePayload = results[3].status === "fulfilled" ? results[3].value : { rows: [] };
      const earlySignalsPayload = results[4].status === "fulfilled" ? results[4].value : { signals: [] };
      const auditErrors = results
        .filter(result => result.status === "rejected")
        .map(result => result.reason && result.reason.message ? result.reason.message : String(result.reason));

      const checklistIndex = checklistIndexPayload.index || checklistIndexPayload.rows || [];
      const releaseRows = releasePayload.rows || [];
      const vaultSource = vaultData.manifestOnly ? (vaultData.productMap || {}) : (vaultData.products || {});
      const vaultIndex = Object.keys(vaultSource).map(code => {
        const product = vaultData.manifestOnly ? {} : vaultData.products[code] || {};
        const meta = product.meta || product;
        return {
          code,
          name: meta.displayName || meta.display_name || meta.name || product.displayName || product.name || code.replace(/[_-]+/g, " "),
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
        manifestOnly: bundleData.manifestOnly,
        bundleErrors: bundleData.errors.length,
        vaultErrors: vaultData.errors.length,
        auditErrors,
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

    if (els.buildVersion) els.buildVersion.textContent = COMMAND_CENTER_VERSION;
    els.systemState.textContent = "Ready";
    els.autonomyState.textContent = getAutonomyLabel(state.autonomyMode);
    renderAutonomyReadiness();
    els.opportunityCount.textContent = formatNumber(opportunities.length);
    els.criticalCount.textContent = formatNumber(critical.length);
    els.lastAudit.textContent = state.audit && state.audit.generatedAt
      ? state.audit.generatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : "-";

    renderBrief();
    renderNextActions();
    renderAgentActions();
    renderActivityLog();
    renderRunSummary();
    updateMemoryStatus("Local memory active.", "browser storage");
    renderOperatorTasks();
    renderGuardrails();
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
          if (action) {
            createOperatorTask(action);
            upsertAgentAction({
              id: action.id,
              type: action.relatedType || action.kind || "next_action",
              source: "audit",
              product: action.title,
              riskLevel: action.severity === "critical" ? "high" : "medium",
              status: "approved",
              recommendedAction: action.afterApproval || action.now || action.summary || "",
              adminDecision: "approved"
            });
            logActivity({
              type: "approval",
              status: "approved",
              product: action.title,
              source: "audit",
              title: "Admin approved next step",
              detail: action.afterApproval || action.summary || ""
            });
          }
        }
        writeApprovals();
        renderNextActions();
        renderAgentActions();
        renderActionLanes();
        renderActivityLog();
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

  function renderGuardrails() {
    if (!els.guardrailList) return;

    els.guardrailList.innerHTML = AUTOMATION_GUARDRAILS.map((rule, idx) => `
      <div class="guardrail-card">
        <strong>${idx + 1}</strong>
        <div>
          <h3>${escapeHtml(rule.title)}</h3>
          <span>${escapeHtml(rule.detail)}</span>
        </div>
      </div>
    `).join("");
  }

  function buildValidationChecklist(action) {
    const type = String(action && action.type || "").toLowerCase();
    const status = String(action && action.status || "").toLowerCase();
    const execution = String(action && action.executionResult || "").toLowerCase();
    const validation = String(action && action.validationResult || "").toLowerCase();
    const validationPassed = hasPositiveValidationProof(action);

    const checks = [
      {
        label: "Admin state",
        ok: status === "approved" || status === "validated",
        note: status === "approved" || status === "validated" ? "Approved or validated" : "Needs approval or review"
      },
      {
        label: "Scoped target",
        ok: !!(action && (action.code || action.product)),
        note: action && action.code ? action.code : "Product name only"
      },
      {
        label: "Execution proof",
        ok: !!execution,
        note: action && action.executionResult ? action.executionResult : "No execution proof yet"
      },
      {
        label: "Validation proof",
        ok: validationPassed || isPendingPublicValidationAction(action) || isPendingVisualValidationAction(action),
        note: action && action.validationResult
          ? action.validationResult
          : isPendingPublicValidationAction(action)
            ? "Publish completed; waiting for public JSON propagation."
            : isPendingVisualValidationAction(action)
              ? "Public JSON passed; CV/ChatBot visual validation is next."
            : "No validation proof yet"
      }
    ];

    if (type === "checklist_publish" || type === "source_import") {
      checks.push({
        label: "CV / ChatBot",
        ok: validationPassed && validation.includes("cv") && validation.includes("chatbot"),
        note: validation ? action.validationResult : "Public app validation pending"
      });
    }

    if (type === "visual_test") {
      checks.push({
        label: "Visual report",
        ok: status === "validated" || validation.includes("passed"),
        note: action && action.runUrl ? "Run link available" : "No visual run link yet"
      });
    }

    if (type === "sentinel_incident") {
      checks.push({
        label: "Self-healing attempt",
        ok: execution.includes("safe recovery") || status === "validated",
        note: action && action.executionResult ? action.executionResult : "No safe recovery attempt recorded yet"
      });
      checks.push({
        label: "Retest result",
        ok: validation.includes("passed") || status === "validated",
        note: action && action.validationResult ? action.validationResult : "Retest proof pending"
      });
    }

    if (type === "prv_sync_incident") {
      checks.push({
        label: "Self-healing retry",
        ok: execution.includes("safe recovery") || status === "validated",
        note: action && action.executionResult ? action.executionResult : "No safe retry recorded yet"
      });
      checks.push({
        label: "Static JSON publish",
        ok: status === "validated" || validation.includes("completed") || validation.includes("sync completed"),
        note: action && action.validationResult ? action.validationResult : "Publish proof pending"
      });
    }

    return checks;
  }

  function renderValidationChecklist(action) {
    const checks = buildValidationChecklist(action);
    return `
      <div class="validation-checklist">
        ${checks.map(check => `
          <span class="${check.ok ? "pass" : "wait"}">
            <strong>${check.ok ? "Pass" : "Wait"}</strong>
            ${escapeHtml(check.label)}
            <em>${escapeHtml(check.note)}</em>
          </span>
        `).join("")}
      </div>
    `;
  }

  function hasPositiveValidationProof(action) {
    const status = String(action && action.status || "").toLowerCase();
    const validation = String(action && action.validationResult || "").toLowerCase();
    if (status === "validated") return true;
    if (!validation) return false;
    if (
      validation.includes("needs review") ||
      validation.includes("pending") ||
      validation.includes("failed") ||
      validation.includes("error") ||
      validation.includes("missing")
    ) {
      return false;
    }
    return (
      validation.includes("passed") ||
      validation.includes("validated") ||
      validation.includes("complete")
    );
  }

  function hasPublicCoverageProof(action) {
    const validation = String(action && action.validationResult || "").toLowerCase();
    return validation.includes("public json covered") && !(
      validation.includes("failed") ||
      validation.includes("error") ||
      validation.includes("missing")
    );
  }

  function getActionExecutionPosture(action) {
    const status = String(action && action.status || "").toLowerCase();
    const type = String(action && action.type || "").toLowerCase();
    const hasAdminApproval = status === "approved" || status === "validated";
    const hasSource = type !== "source_import" || !!(action.sourceUrl || action.runUrl);
    const hasTarget = !!(action.product || action.code);
    const coverageOnlyAudit = (type === "backend_data_issue" || String(action && action.source || "").toLowerCase() === "deep_backend_audit") && hasTarget;
    const hasExecutionProof = !!action.executionResult;
    const hasValidationProof = hasPositiveValidationProof(action);
    const hasCoverageProof = hasPublicCoverageProof(action);

    if (status === "fix_queued" || status === "fix_applied") {
      return {
        label: status === "fix_applied" ? "Retest Needed" : "Fix Queued",
        className: "review",
        detail: status === "fix_applied"
          ? "A repair task was completed. Rerun validation before marking this resolved."
          : "A repair task has been created. Complete the task, then rerun validation."
      };
    }

    if (type === "prv_sync_incident") {
      if (status === "validated") {
        return {
          label: "Recovered",
          className: "complete",
          detail: "PRV JSON sync completed and proof was recorded."
        };
      }
      if (status === "fix_attempted") {
        return {
          label: "Admin Review",
          className: "review",
          detail: "Sentinel retried PRV sync once and it still needs admin review."
        };
      }
      return {
        label: "Self-Heal Ready",
        className: "ready",
        detail: "Run Agent Cycle to retry PRV JSON sync once before manual troubleshooting."
      };
    }

    if (status === "known_issue" || status === "blocked" || status === "failed") {
      return {
        label: "Hold",
        className: "hold",
        detail: "Do not execute until the known issue or blocker is resolved."
      };
    }

    if (status === "fix_attempted") {
      return {
        label: "Admin Review",
        className: "review",
        detail: "The agent attempted a safe fix, but the retest still needs review or failed."
      };
    }

    if (isPendingPublicValidationAction(action)) {
      return {
        label: "Recheck Ready",
        className: "ready",
        detail: "Publish completed but public JSON was not visible yet. Run Agent Cycle to recheck automatically."
      };
    }

    if (isPendingVisualValidationAction(action)) {
      return {
        label: "Validate",
        className: "review",
        detail: "Public JSON is live. Run Agent Cycle to start CV/ChatBot visual validation."
      };
    }

    if ((!hasSource && !coverageOnlyAudit) || !hasTarget) {
      return {
        label: "Hold",
        className: "hold",
        detail: "Missing source or target detail. Review before approval."
      };
    }

    if (coverageOnlyAudit && !hasExecutionProof) {
      return {
        label: "Recheck Ready",
        className: "ready",
        detail: "Backend audit item has product identity. Sentinel can safely recheck public JSON without a source write."
      };
    }

    if (hasExecutionProof && hasCoverageProof && !hasValidationProof) {
      return {
        label: "Validate",
        className: "review",
        detail: "Public JSON is covered. Run CV/ChatBot visual validation or mark validated after manual proof."
      };
    }

    if (!hasAdminApproval) {
      return {
        label: "Needs Admin",
        className: "review",
        detail: "Ready for review, but no admin approval has been recorded."
      };
    }

    if (!hasExecutionProof) {
      return {
        label: "Ready",
        className: "ready",
        detail: "Approved and scoped. Execute the prepared step, then validate."
      };
    }

    if (!hasValidationProof) {
      return {
        label: "Validate",
        className: "review",
        detail: "Execution proof exists. CV/ChatBot validation still needs proof."
      };
    }

    return {
      label: "Complete",
      className: "complete",
      detail: "Execution and validation proof are recorded."
    };
  }

  function renderActionExecutionPosture(action) {
    const posture = getActionExecutionPosture(action);
    return `
      <div class="agent-posture ${escapeHtml(posture.className)}">
        <strong>${escapeHtml(posture.label)}</strong>
        <span>${escapeHtml(posture.detail)}</span>
      </div>
    `;
  }

  function getAgentActionKindLabel(action) {
    const type = String(action && action.type || "").toLowerCase();
    const status = String(action && action.status || "").toLowerCase();
    if (type === "sentinel_incident") return "Sentinel Incident";
    if (type === "prv_sync_incident") return "PRV Sync Failed";
    if (type === "prv_source_review" && status === "known_issue") return "PRV Source Held";
    if (type === "source_import") return "New Checklist Found";
    if (type === "prv_source_review") return "New Print Run Found";
    if (type === "checklist_publish") return "Checklist Publish";
    if (type === "visual_test") return "Visual Validation";
    if (type === "source_watch") return "Source Watch";
    return titleCase(String(action && action.type || "Agent Action").replace(/_/g, " "));
  }

  function getAgentActionRawType(action) {
    return String(action && action.type || "agent_action").replace(/_/g, " ");
  }

  function getActionProductName(action) {
    return String(action && (action.product || action.title || action.recommendedAction || "Unknown product"));
  }

  function getPrvKnownIssueReason(action) {
    const validation = String(action && action.validationResult || "");
    const execution = String(action && action.executionResult || "");
    const combined = `${validation} ${execution}`.toLowerCase();
    if (combined.includes("paid") || combined.includes("locked")) return "Locked source";
    if (combined.includes("no writable") || combined.includes("no print-run rows") || combined.includes("no print run rows")) return "No writable rows";
    if (combined.includes("blocked")) return "Blocked source";
    return "Needs alternate source";
  }

  function renderPrvKnownIssuePanel(action) {
    if (!action || action.type !== "prv_source_review" || String(action.status || "").toLowerCase() !== "known_issue") return "";
    const reason = getPrvKnownIssueReason(action);
    const source = action.sourceUrl || action.runUrl || "";
    return `
      <div class="known-issue-panel prv-known-issue-panel">
        <div>
          <strong>${escapeHtml(reason)}</strong>
          <span>Sentinel found a PRV source, but it is not safe to auto-write. Use another source, add PRV data manually, or ignore this product if it is not worth tracking.</span>
        </div>
        <ul>
          <li>No live write was attempted.</li>
          <li>Auto-run will not spend a worker slot on this card.</li>
          <li>${source ? "Source link is available for manual review." : "No source link is available."}</li>
        </ul>
      </div>
    `;
  }

  function getActionProgressSteps(action) {
    const type = String(action && action.type || "").toLowerCase();
    const status = String(action && action.status || "").toLowerCase();
    const execution = String(action && action.executionResult || "").toLowerCase();
    const validation = String(action && action.validationResult || "").toLowerCase();
    const hasSource = !!(action && (action.sourceUrl || action.runUrl || action.source));
    const hasPreview = /preview|parsed|rows:|parallels:|sample/i.test(String(action && (action.executionResult || action.validationResult || "")));
    const hasSheetWrite = /sheet write|google sheet|checklist data written|prv index and products rows written|temp data written|source sheet/i.test(String(action && action.executionResult || ""));
    const hasPublish = /publish|json/i.test(String(action && (action.executionResult || action.validationResult || ""))) && !/publish needs review|publish pending/i.test(String(action && (action.executionResult || action.validationResult || "")));
    const hasPublicValidation = hasPublicCoverageProof(action) || /public rows|public prv rows|public json validated|visual.*passed|all tests passed/i.test(String(action && action.validationResult || ""));
    const isComplete = status === "validated" || hasPositiveValidationProof(action);
    const isIssue = status === "failed" || status === "blocked" || status === "known_issue";

    const checklistSteps = [
      { key: "source", label: "Source found", done: hasSource || type === "checklist_publish" },
      { key: "preview", label: "Preview ready", done: hasPreview || hasSheetWrite || type === "checklist_publish" },
      { key: "sheet", label: "Sheet write", done: hasSheetWrite || type === "checklist_publish" },
      { key: "publish", label: "JSON publish", done: hasPublish || hasPublicValidation || isPendingPublicValidationAction(action) },
      { key: "validate", label: "CV / ChatBot test", done: isComplete }
    ];

    const prvSteps = [
      { key: "source", label: "Source found", done: hasSource },
      { key: "preview", label: "PRV preview", done: hasPreview || hasSheetWrite },
      { key: "sheet", label: "PRV sheet write", done: hasSheetWrite },
      { key: "publish", label: "PRV JSON publish", done: hasPublish || hasPublicValidation || isPendingPublicValidationAction(action) },
      { key: "validate", label: "Public PRV test", done: isComplete || hasPublicValidation }
    ];

    const visualSteps = [
      { key: "queue", label: "Queued", done: true },
      { key: "run", label: "GitHub run", done: !!(action && action.runUrl) },
      { key: "validate", label: "Behavior tested", done: isComplete }
    ];

    const prvSyncSteps = [
      { key: "sync", label: "Sync failed", done: true },
      { key: "retry", label: "Agent retry", done: execution.includes("safe recovery") || isComplete },
      { key: "publish", label: "JSON publish proof", done: isComplete || validation.includes("sync completed") || validation.includes("completed") },
      { key: "validate", label: "Resolved", done: isComplete }
    ];

    let steps = type === "prv_source_review"
      ? prvSteps
      : type === "prv_sync_incident"
        ? prvSyncSteps
        : type === "visual_test"
          ? visualSteps
          : checklistSteps;

    let firstOpenFound = false;
    steps = steps.map(step => {
      let state = step.done ? "done" : "wait";
      if (isIssue && !step.done && !firstOpenFound) {
        state = "issue";
        firstOpenFound = true;
      } else if (!step.done && !firstOpenFound) {
        state = "current";
        firstOpenFound = true;
      }
      return Object.assign({}, step, { state: state });
    });

    if (isComplete) {
      steps = steps.map(step => Object.assign({}, step, { state: "done", done: true }));
    }

    return steps;
  }

  function renderActionProgress(action) {
    const steps = getActionProgressSteps(action);
    return `
      <div class="action-progress" aria-label="Agent progress">
        ${steps.map((step, idx) => `
          <button class="progress-step ${escapeHtml(step.state)}" type="button" data-action-progress-step="${escapeHtml(action.id)}" data-progress-step="${escapeHtml(step.key)}" title="Run ${escapeHtml(step.label)}">
            <span class="progress-dot" aria-hidden="true">${step.state === "done" ? "✓" : step.state === "issue" ? "!" : idx + 1}</span>
            ${idx < steps.length - 1 ? `<span class="progress-line" aria-hidden="true"></span>` : ""}
            <span class="progress-label">${escapeHtml(step.label)}</span>
          </button>
        `).join("")}
      </div>
    `;
  }

  function runActionProgressStep(action, stepKey) {
    if (!action || !stepKey) return;
    const type = String(action.type || "").toLowerCase();
    const sourceUrl = action.sourceUrl || action.runUrl || "";

    if (stepKey === "source") {
      if (sourceUrl) window.open(sourceUrl, "_blank", "noopener,noreferrer");
      else renderSourceCheckMessage("Source unavailable", "This card does not have a source link.", "warning");
      return;
    }

    if (type === "prv_source_review") {
      if (stepKey === "preview") {
        if (!sourceUrl) renderSourceCheckMessage("Source URL missing", "This PRV card does not have a source URL to preview.", "warning");
        else previewPrvSource(sourceUrl, action.sport || "", action.id);
        return;
      }
      if (stepKey === "sheet") {
        if (!sourceUrl) renderSourceCheckMessage("Source URL missing", "This PRV card does not have a source URL to write.", "warning");
        else executePrvSourceImport(sourceUrl, action.sport || "", action.id);
        return;
      }
      if (stepKey === "publish") {
        if (!action.code) renderSourceCheckMessage("PRV code missing", "This PRV card needs a product code before JSON publish.", "warning");
        else publishPrvVaultData(action.code || "", action.id);
        return;
      }
      if (stepKey === "validate") {
        if (!action.code) renderSourceCheckMessage("PRV code missing", "This PRV card needs a product code before public validation.", "warning");
        else recheckPrvPublicData(action.code || "", action.id);
        return;
      }
    }

    if (type === "prv_sync_incident") {
      if (stepKey === "sync" || stepKey === "retry" || stepKey === "publish") {
        attemptPrvSyncIncidentRecovery(action);
        return;
      }
      if (stepKey === "validate") {
        renderSourceCheckMessage("PRV sync status", action.validationResult || "Run Agent Cycle to retry PRV sync or inspect the admin hold.", "info");
        return;
      }
    }

    if (type === "source_import") {
      if (stepKey === "preview") {
        if (!sourceUrl) renderSourceCheckMessage("Source URL missing", "This checklist card does not have a source URL to preview.", "warning");
        else previewSourceImport(sourceUrl, action.sport || "", action.id);
        return;
      }
      if (stepKey === "sheet") {
        if (!sourceUrl) renderSourceCheckMessage("Source URL missing", "This checklist card does not have a source URL to write.", "warning");
        else executeSourceImport(sourceUrl, action.sport || "", action.id);
        return;
      }
    }

    if (type === "checklist_publish") {
      if (stepKey === "preview") {
        findSourceAndPreviewImport(action.id);
        return;
      }
      if (stepKey === "publish" || stepKey === "sheet") {
        publishChecklistAction(action.id);
        return;
      }
    }

    if (stepKey === "validate") {
      if (type === "source_import" || type === "checklist_publish" || type === "visual_test") {
        const plan = buildVisualTestPlanFromAction(action);
        updateAgentAction(action.id, {
          status: "running",
          validationResult: "CV/ChatBot visual test requested from progress rail..."
        });
        renderAgentActions();
        renderActionLanes();
        renderActivityLog();
        renderVisualTestPlan(plan);
        runAgentVisualTest(plan);
        return;
      }
    }

    renderSourceCheckMessage("Step not ready", "That progress step is not available for this card yet.", "warning");
  }

  function renderAgentActions() {
    collapseDuplicateAgentActions();
    const activeActions = getActiveAgentActions();
    const resolvedActions = getResolvedAgentActions();

    if (!state.agentActions.length) {
      els.agentActionList.innerHTML = `
        <div class="brief-item">
          <strong>No agent actions yet</strong>
          <span>Run an audit, source watch, or approve a next step to create actions.</span>
        </div>
      `;
      return;
    }

    if (!activeActions.length) {
      els.agentActionList.innerHTML = `
        <div class="brief-item resolved-summary">
          <strong>All active actions are clear</strong>
          <span>${formatNumber(resolvedActions.length)} resolved action${resolvedActions.length === 1 ? "" : "s"} have proof recorded. Failures and new approvals will appear here.</span>
        </div>
        ${resolvedActions.slice(0, 3).map(renderResolvedActionProof).join("")}
      `;
      return;
    }

    const activeHtml = activeActions.slice(0, 12).map(action => {
      const badgeClass = getAgentActionBadgeClass(action);
      const status = String(action.status || "").toLowerCase();
      const canTestProduct = action.product && (action.type === "source_import" || action.type === "checklist_publish" || action.type === "visual_test");
      const fixPlan = buildAgentActionFixPlan(action);
      const retestNeeded = status === "fix_applied";
      const canCreateFixTask = !!fixPlan.steps.length && (status === "failed" || status === "blocked" || status === "known_issue");
      const isPrvKnownIssue = action.type === "prv_source_review" && status === "known_issue";
      const inRunQueue = isActionInRunQueue(action.id);
      const canExecuteSourceImport = action.type === "source_import" &&
        (status === "approved" || status === "ready") &&
        !!(action.sourceUrl || action.runUrl) &&
        !!(action.sport || action.code || action.product);
      return `
        <article class="agent-action-card">
          <div class="opp-top">
            <div>
              <div class="agent-action-kind-row">
                <span class="next-kind">${escapeHtml(getAgentActionKindLabel(action))}</span>
                <span class="action-raw-type">${escapeHtml(getAgentActionRawType(action))}</span>
              </div>
              <h3 class="agent-product-title">${escapeHtml(getActionProductName(action))}</h3>
              <p>${escapeHtml(action.recommendedAction || "")}</p>
            </div>
            <div class="agent-card-controls">
              <button class="agent-remove-btn" type="button" data-action-remove-request="${escapeHtml(action.id)}" aria-label="Remove action">×</button>
              <span class="badge ${badgeClass}">${escapeHtml(getAgentActionDisplayStatus(action))}</span>
            </div>
          </div>
          <div class="action-remove-confirm" hidden data-action-remove-confirm="${escapeHtml(action.id)}">
            <strong>Are you sure you want to remove?</strong>
            <span>This request will stay gone from future scans unless source ignores are cleared.</span>
            <button class="action-btn ignore" type="button" data-action-remove-yes="${escapeHtml(action.id)}">Yes</button>
            <button class="action-btn" type="button" data-action-remove-cancel="${escapeHtml(action.id)}">Cancel</button>
          </div>
          <div class="opp-meta">
            <span class="pill">Risk: ${escapeHtml(titleCase(action.riskLevel || "medium"))}</span>
            ${action.sport ? `<span class="pill">Sport: ${escapeHtml(titleCase(action.sport))}</span>` : ""}
            ${action.code ? `<span class="pill">Code: ${escapeHtml(action.code)}</span>` : ""}
            ${action.source ? `<span class="pill">Source: ${escapeHtml(action.source)}</span>` : ""}
          </div>
          ${renderActionProgress(action)}
          ${renderPrvKnownIssuePanel(action)}
          ${action.executionResult || action.validationResult ? `
            <div class="agent-action-results">
              ${action.executionResult ? `<span><strong>Execution</strong>${escapeHtml(action.executionResult)}</span>` : ""}
              ${action.validationResult ? `<span><strong>Validation</strong>${escapeHtml(action.validationResult)}</span>` : ""}
              ${action.repairProof ? `<span><strong>Repair Proof</strong>${escapeHtml(action.repairProof)}</span>` : ""}
            </div>
          ` : ""}
          ${renderActionExecutionPosture(action)}
          ${fixPlan.summary ? `
            <div class="agent-fix-plan">
              <strong>Agent fix plan</strong>
              <span>${escapeHtml(fixPlan.summary)}</span>
            </div>
          ` : ""}
          ${renderValidationChecklist(action)}
          <div class="opp-actions">
            ${inRunQueue ? `
              <button class="action-btn approve" type="button" data-action-remove-run-queue="${escapeHtml(action.id)}">Queued for Agent</button>
            ` : `
              <button class="action-btn approve primary-next" type="button" data-action-add-run-queue="${escapeHtml(action.id)}">Add to Run Queue</button>
            `}
            ${retestNeeded ? `
              <button class="action-btn approve primary-next" type="button" data-action-visual-test="${escapeHtml(action.id)}">Run Retest</button>
            ` : ""}
            ${action.type === "source_import" && (action.sourceUrl || action.runUrl) ? `
              <button class="action-btn approve" type="button" data-action-preview-import="${escapeHtml(action.id)}">Preview Import</button>
              <a class="action-btn" href="${escapeHtml(action.sourceUrl || action.runUrl)}" target="_blank" rel="noopener noreferrer">Open Source</a>
            ` : ""}
            ${action.type === "checklist_publish" && action.product ? `
              <button class="action-btn approve" type="button" data-action-find-source-preview="${escapeHtml(action.id)}">Find Source / Preview Import</button>
              <button class="action-btn approve" type="button" data-action-publish-json="${escapeHtml(action.id)}">Publish JSON</button>
            ` : ""}
            ${action.type === "prv_source_review" && (action.sourceUrl || action.runUrl) && !isPrvKnownIssue ? `
              <button class="action-btn approve" type="button" data-action-preview-prv="${escapeHtml(action.id)}">Preview PRV Source</button>
              <button class="action-btn approve" type="button" data-action-execute-prv="${escapeHtml(action.id)}">Write PRV Temp Data</button>
              ${action.code ? `<button class="action-btn approve" type="button" data-action-publish-prv="${escapeHtml(action.id)}">Publish PRV JSON</button>` : ""}
              ${action.code ? `<button class="action-btn" type="button" data-action-recheck-prv="${escapeHtml(action.id)}">Recheck PRV Public JSON</button>` : ""}
              <a class="action-btn" href="${escapeHtml(action.sourceUrl || action.runUrl)}" target="_blank" rel="noopener noreferrer">Open Source</a>
            ` : ""}
            ${isPrvKnownIssue ? `
              ${action.sourceUrl || action.runUrl ? `<a class="action-btn" href="${escapeHtml(action.sourceUrl || action.runUrl)}" target="_blank" rel="noopener noreferrer">Open Source</a>` : ""}
              <button class="action-btn approve" type="button" data-action-manual-prv="${escapeHtml(action.id)}">Add Manual PRV Data</button>
              <button class="action-btn" type="button" data-action-keep-watching="${escapeHtml(action.id)}">Keep Watching</button>
              <button class="action-btn ignore" type="button" data-action-ignore-future="${escapeHtml(action.id)}">Ignore Future</button>
            ` : ""}
            ${action.type === "prv_sync_incident" ? `
              <button class="action-btn approve primary-next" type="button" data-action-retry-prv-sync="${escapeHtml(action.id)}">Retry PRV Sync</button>
            ` : ""}
            ${canTestProduct && !retestNeeded ? `
              <button class="action-btn" type="button" data-action-visual-test="${escapeHtml(action.id)}">Test CV/ChatBot</button>
            ` : ""}
            ${action.product && (action.type === "source_import" || action.type === "checklist_publish" || action.type === "backend_data_issue") ? `
              <button class="action-btn" type="button" data-action-recheck-coverage="${escapeHtml(action.id)}">Recheck Coverage</button>
            ` : ""}
            ${canExecuteSourceImport ? `
              <button class="action-btn approve" type="button" data-action-execute-import="${escapeHtml(action.id)}">Write to Google Sheets</button>
            ` : ""}
            ${canCreateFixTask ? `
              <button class="action-btn approve" type="button" data-action-create-fix-task="${escapeHtml(action.id)}">Create Fix Task</button>
            ` : ""}
            <button class="action-btn approve" type="button" data-agent-action-id="${escapeHtml(action.id)}" data-agent-status="approved">Approve</button>
            <button class="action-btn" type="button" data-agent-action-id="${escapeHtml(action.id)}" data-agent-status="needs_admin">Needs Admin</button>
            <button class="action-btn" type="button" data-agent-action-id="${escapeHtml(action.id)}" data-agent-status="validated">Mark Validated</button>
            ${action.type === "source_import" ? `
              <button class="action-btn ignore" type="button" data-action-ignore-future="${escapeHtml(action.id)}">Ignore Future</button>
            ` : ""}
            <button class="action-btn ignore" type="button" data-agent-action-id="${escapeHtml(action.id)}" data-agent-status="known_issue">Known Issue</button>
            ${action.runUrl && action.type !== "source_import" ? `<a class="action-btn" href="${escapeHtml(action.runUrl)}" target="_blank" rel="noopener noreferrer">Open Run</a>` : ""}
          </div>
        </article>
      `;
    }).join("");

    const resolvedHtml = resolvedActions.length
      ? `
        <div class="brief-item resolved-summary">
          <strong>${formatNumber(resolvedActions.length)} resolved action${resolvedActions.length === 1 ? "" : "s"} hidden</strong>
          <span>Use Clear Resolved when you are ready to remove completed proof from active memory.</span>
        </div>
      `
      : "";

    els.agentActionList.innerHTML = renderAgentRunQueueSummary() + activeHtml + resolvedHtml;

    els.agentActionList.querySelectorAll("[data-action-progress-step]").forEach(btn => {
      btn.addEventListener("click", () => {
        const action = state.agentActions.find(item => item.id === btn.dataset.actionProgressStep);
        runActionProgressStep(action, btn.dataset.progressStep || "");
      });
    });

    els.agentActionList.querySelectorAll("[data-action-remove-request]").forEach(btn => {
      btn.addEventListener("click", () => {
        const card = btn.closest(".agent-action-card");
        if (!card) return;
        const confirmBox = card.querySelector(`[data-action-remove-confirm="${CSS.escape(btn.dataset.actionRemoveRequest || "")}"]`);
        if (confirmBox) confirmBox.hidden = false;
      });
    });

    els.agentActionList.querySelectorAll("[data-action-remove-cancel]").forEach(btn => {
      btn.addEventListener("click", () => {
        const box = btn.closest(".action-remove-confirm");
        if (box) box.hidden = true;
      });
    });

    els.agentActionList.querySelectorAll("[data-action-remove-yes]").forEach(btn => {
      btn.addEventListener("click", () => {
        removeAndRememberAgentAction(btn.dataset.actionRemoveYes);
      });
    });

    els.agentActionList.querySelectorAll("[data-action-add-run-queue]").forEach(btn => {
      btn.addEventListener("click", () => {
        addActionToRunQueue(btn.dataset.actionAddRunQueue);
      });
    });

    els.agentActionList.querySelectorAll("[data-action-remove-run-queue]").forEach(btn => {
      btn.addEventListener("click", () => {
        removeActionFromRunQueue(btn.dataset.actionRemoveRunQueue);
        renderAgentActions();
        renderActionLanes();
        updateMemoryStatus("Action removed from Agent Run Queue.", "queued");
      });
    });

    els.agentActionList.querySelectorAll("[data-action-preview-import]").forEach(btn => {
      btn.addEventListener("click", () => {
        const action = state.agentActions.find(item => item.id === btn.dataset.actionPreviewImport);
        if (!action) return;
        const sourceUrl = action.sourceUrl || action.runUrl || "";
        if (!sourceUrl) {
          renderSourceCheckMessage("Source URL missing", "This queue card does not have a source URL to preview.", "warning");
          return;
        }
        previewSourceImport(sourceUrl, action.sport || "", action.id);
      });
    });

    els.agentActionList.querySelectorAll("[data-action-preview-prv]").forEach(btn => {
      btn.addEventListener("click", () => {
        const action = state.agentActions.find(item => item.id === btn.dataset.actionPreviewPrv);
        if (!action) return;
        const sourceUrl = action.sourceUrl || action.runUrl || "";
        if (!sourceUrl) {
          renderSourceCheckMessage("Source URL missing", "This PRV review card does not have a source URL to preview.", "warning");
          return;
        }
        previewPrvSource(sourceUrl, action.sport || "", action.id);
      });
    });

    els.agentActionList.querySelectorAll("[data-action-execute-prv]").forEach(btn => {
      btn.addEventListener("click", () => {
        const action = state.agentActions.find(item => item.id === btn.dataset.actionExecutePrv);
        if (!action) return;
        const sourceUrl = action.sourceUrl || action.runUrl || "";
        if (!sourceUrl) {
          renderSourceCheckMessage("Source URL missing", "This PRV review card does not have a source URL to write.", "warning");
          return;
        }
        executePrvSourceImport(sourceUrl, action.sport || "", action.id);
      });
    });

    els.agentActionList.querySelectorAll("[data-action-publish-prv]").forEach(btn => {
      btn.addEventListener("click", () => {
        const action = state.agentActions.find(item => item.id === btn.dataset.actionPublishPrv);
        if (!action) return;
        publishPrvVaultData(action.code || "", action.id);
      });
    });

    els.agentActionList.querySelectorAll("[data-action-recheck-prv]").forEach(btn => {
      btn.addEventListener("click", () => {
        const action = state.agentActions.find(item => item.id === btn.dataset.actionRecheckPrv);
        if (!action) return;
        recheckPrvPublicData(action.code || "", action.id);
      });
    });

    els.agentActionList.querySelectorAll("[data-action-retry-prv-sync]").forEach(btn => {
      btn.addEventListener("click", () => {
        const action = state.agentActions.find(item => item.id === btn.dataset.actionRetryPrvSync);
        if (!action) return;
        attemptPrvSyncIncidentRecovery(action);
      });
    });

    els.agentActionList.querySelectorAll("[data-action-find-source-preview]").forEach(btn => {
      btn.addEventListener("click", () => {
        findSourceAndPreviewImport(btn.dataset.actionFindSourcePreview);
      });
    });

    els.agentActionList.querySelectorAll("[data-action-publish-json]").forEach(btn => {
      btn.addEventListener("click", () => {
        publishChecklistAction(btn.dataset.actionPublishJson);
      });
    });

    els.agentActionList.querySelectorAll("[data-action-visual-test]").forEach(btn => {
      btn.addEventListener("click", () => {
        const action = state.agentActions.find(item => item.id === btn.dataset.actionVisualTest);
        if (!action) return;
        const plan = buildVisualTestPlanFromAction(action);
        const wasRetest = String(action.status || "").toLowerCase() === "fix_applied";
        updateAgentAction(action.id, {
          status: "running",
          validationResult: wasRetest ? "CV/ChatBot retest requested after fix..." : "CV/ChatBot visual test requested..."
        });
        logActivity({
          type: "visual_test",
          status: "requested",
          product: action.product || "",
          source: "agent_action_queue",
          title: wasRetest ? "Retest requested" : "Visual test requested",
          detail: wasRetest ? "Fix has been applied; queue card requested CV/ChatBot retest." : "Queue card requested CV/ChatBot validation."
        });
        renderAgentActions();
        renderActionLanes();
        renderActivityLog();
        renderVisualTestPlan(plan);
        runAgentVisualTest(plan);
      });
    });

    els.agentActionList.querySelectorAll("[data-action-execute-import]").forEach(btn => {
      btn.addEventListener("click", () => {
        const action = state.agentActions.find(item => item.id === btn.dataset.actionExecuteImport);
        if (!action) return;
        const sourceUrl = action.sourceUrl || action.runUrl || "";
        if (!sourceUrl) {
          renderSourceCheckMessage("Source URL missing", "This approved action does not have a source URL to write from.", "warning");
          return;
        }
        executeSourceImport(sourceUrl, action.sport || "", action.id);
      });
    });

    els.agentActionList.querySelectorAll("[data-action-recheck-coverage]").forEach(btn => {
      btn.addEventListener("click", () => {
        recheckActionCoverage(btn.dataset.actionRecheckCoverage);
      });
    });

    els.agentActionList.querySelectorAll("[data-action-create-fix-task]").forEach(btn => {
      btn.addEventListener("click", () => {
        const action = state.agentActions.find(item => item.id === btn.dataset.actionCreateFixTask);
        if (!action) return;
        const task = createFixTaskFromAgentAction(action);
        logActivity({
          type: "operator_task",
          status: "queued",
          product: action.product || "",
          source: "agent_action_queue",
          title: "Fix task created",
          detail: `${task.title} is ready in Operator Tasks.`
        });
        renderOperatorTasks();
        renderAgentActions();
        renderActionLanes();
        renderActivityLog();
      });
    });

    els.agentActionList.querySelectorAll("[data-action-ignore-future]").forEach(btn => {
      btn.addEventListener("click", () => {
        ignoreFutureSourceAction(btn.dataset.actionIgnoreFuture);
        renderAgentActions();
        renderActionLanes();
        renderActivityLog();
        updateMemoryStatus("Source ignore saved.", "admin rule");
      });
    });

    els.agentActionList.querySelectorAll("[data-action-keep-watching]").forEach(btn => {
      btn.addEventListener("click", () => {
        const action = updateAgentAction(btn.dataset.actionKeepWatching, {
          status: "known_issue",
          adminDecision: "keep_watching",
          executionResult: "Admin asked Sentinel to keep watching this source without auto-writing.",
          validationResult: "Held until the source exposes writable rows or an alternate source is available."
        });
        if (action) {
          logActivity({
            type: "prv_source_review",
            status: "known_issue",
            product: action.product || "",
            source: "admin",
            title: "PRV source kept on watch",
            detail: `${action.product || "PRV source"} remains held. Sentinel will not auto-write from locked source HTML.`
          });
        }
        renderAgentActions();
        renderActionLanes();
        renderActivityLog();
      });
    });

    els.agentActionList.querySelectorAll("[data-action-manual-prv]").forEach(btn => {
      btn.addEventListener("click", () => {
        const action = state.agentActions.find(item => item.id === btn.dataset.actionManualPrv);
        if (!action) return;
        updateAgentAction(action.id, {
          status: "needs_admin",
          adminDecision: "manual_prv_needed",
          recommendedAction: "Add PRV rows manually from a trusted source, then run Sync PRV JSON and recheck the product.",
          executionResult: "Manual PRV data path selected by admin.",
          validationResult: "Waiting for trusted PRV rows outside the locked source."
        });
        logActivity({
          type: "prv_source_review",
          status: "needs_admin",
          product: action.product || "",
          source: "admin",
          title: "Manual PRV data requested",
          detail: `${action.product || "PRV product"} needs trusted manual PRV rows before publish.`
        });
        renderAgentActions();
        renderActionLanes();
        renderActivityLog();
        renderSourceCheckMessage("Manual PRV path selected", "Review the source, add trusted PRV rows manually, then use Sync PRV JSON and Recheck PRV Public JSON.", "warning");
      });
    });

    els.agentActionList.querySelectorAll("[data-agent-status]").forEach(btn => {
      btn.addEventListener("click", () => {
        const action = updateAgentAction(btn.dataset.agentActionId, {
          status: btn.dataset.agentStatus,
          adminDecision: btn.dataset.agentStatus
        });
        if (action) {
          logActivity({
            type: "agent_action",
            status: action.status,
            product: action.product,
            source: action.source,
            title: "Agent action updated",
            detail: `${action.product || action.type} marked ${getAgentActionStatusLabel(action.status)}.`
          });
        }
        renderAgentActions();
        renderActionLanes();
        renderActivityLog();
      });
    });
  }

  function renderResolvedActionProof(action) {
    const proof = action.validationResult || action.executionResult || "Resolved proof recorded.";
    return `
      <div class="brief-item resolved-proof">
        <strong>${escapeHtml(action.product || action.type || "Resolved action")}</strong>
        <span>${escapeHtml(proof)}</span>
      </div>
    `;
  }

  function isReadyAction(action) {
    const status = String(action && action.status || "").toLowerCase();
    return status === "approved" || status === "queued" || status === "ready";
  }

  function hasAdminApproval(action) {
    const status = String(action && action.status || "").toLowerCase();
    const decision = String(action && action.adminDecision || "").toLowerCase();
    return status === "approved" || decision === "approved";
  }

  function isHoldAction(action) {
    const status = String(action && action.status || "").toLowerCase();
    return status === "needs_admin" || status === "approval_required" || status === "failed" || status === "blocked" || status === "known_issue" || status === "fix_queued" || status === "fix_applied";
  }

  function getAgentCycleStep() {
    const active = getActiveAgentActions();

    const running = active.find(action => String(action.status || "").toLowerCase() === "running");
    if (running) {
      return {
        kind: "wait",
        action: running,
        title: "Wait for active work",
        detail: `${running.product || running.type} is currently running. Let it finish or refresh status before starting another cycle.`
      };
    }

    const incidentRecovery = active.find(action => {
      const type = String(action.type || "").toLowerCase();
      const status = String(action.status || "").toLowerCase();
      const execution = String(action.executionResult || "").toLowerCase();
      if (type !== "sentinel_incident") return false;
      if (status === "running" || status === "validated" || status === "fix_attempted") return false;
      return !execution.includes("safe recovery attempted");
    });
    if (incidentRecovery) {
      return {
        kind: "sentinel_incident_recovery",
        action: incidentRecovery,
        title: "Attempt safe Sentinel recovery",
        detail: "Sentinel self-test failed. The agent will run one safe recovery retest before asking admin for manual review."
      };
    }

    const prvSyncRecovery = active.find(action => {
      const type = String(action.type || "").toLowerCase();
      const status = String(action.status || "").toLowerCase();
      const execution = String(action.executionResult || "").toLowerCase();
      return type === "prv_sync_incident" &&
        (status === "failed" || status === "blocked") &&
        !execution.includes("safe recovery attempted");
    });
    if (prvSyncRecovery) {
      return {
        kind: "prv_sync_recovery",
        action: prvSyncRecovery,
        title: "Attempt safe PRV sync recovery",
        detail: "PRV JSON sync failed. Sentinel will retry the full PRV publish once, then record proof or hold for admin review."
      };
    }

    const retest = active.find(action => String(action.status || "").toLowerCase() === "fix_applied" && action.product);
    if (retest) {
      return {
        kind: "retest",
        action: retest,
        title: "Run validation retest",
        detail: `${retest.product || retest.type} has a completed fix task and needs proof.`
      };
    }

    const approvedPrvPreview = active.find(action => {
      const status = String(action.status || "").toLowerCase();
      const type = String(action.type || "").toLowerCase();
      const execution = String(action.executionResult || "").toLowerCase();
      if (type !== "prv_source_review") return false;
      if (!hasAdminApproval(action)) return false;
      if (status === "running" || status === "failed" || status === "known_issue" || status === "blocked") return false;
      if (!(action.sourceUrl || action.runUrl)) return false;
      return !execution.includes("preview parsed") &&
        !execution.includes("products rows") &&
        !execution.includes("prv index");
    });
    if (approvedPrvPreview) {
      return {
        kind: "approved_prv_preview",
        action: approvedPrvPreview,
        title: "Build approved PRV preview",
        detail: `${approvedPrvPreview.product || "This PRV source"} is approved. Sentinel will preview the rows before any sheet write.`
      };
    }

    const approvedPrvWrite = active.find(action => {
      const status = String(action.status || "").toLowerCase();
      const type = String(action.type || "").toLowerCase();
      const execution = String(action.executionResult || "").toLowerCase();
      if (type !== "prv_source_review") return false;
      if (!hasAdminApproval(action)) return false;
      if (status === "running" || status === "failed" || status === "known_issue" || status === "blocked") return false;
      if (!(action.sourceUrl || action.runUrl)) return false;
      if (execution.includes("products rows") || execution.includes("prv index")) return false;
      return execution.includes("preview parsed");
    });
    if (approvedPrvWrite) {
      return {
        kind: "execute_prv_import",
        action: approvedPrvWrite,
        title: "Write approved PRV data",
        detail: `${approvedPrvWrite.product || "This PRV source"} is approved and previewed. Sentinel will write only this product to PRV Google Sheets.`
      };
    }

    const approvedPrvPublish = active.find(action => {
      const status = String(action.status || "").toLowerCase();
      const type = String(action.type || "").toLowerCase();
      const execution = String(action.executionResult || "").toLowerCase();
      if (type !== "prv_source_review") return false;
      if (!hasAdminApproval(action)) return false;
      if (status === "running" || status === "failed" || status === "known_issue" || status === "blocked") return false;
      if (!action.code) return false;
      if (execution.includes("json publish request completed") || execution.includes("json publish started")) return false;
      return execution.includes("products rows") ||
        execution.includes("prv index") ||
        execution.includes("sheet write completed");
    });
    if (approvedPrvPublish) {
      return {
        kind: "publish_prv_json",
        action: approvedPrvPublish,
        title: "Publish approved PRV JSON",
        detail: `${approvedPrvPublish.product || approvedPrvPublish.code} was written to PRV Sheets. Sentinel will publish JSON next.`
      };
    }

    const pendingChecklistValidation = active.find(action => {
      const type = String(action.type || "").toLowerCase();
      if (!isPendingPublicValidationAction(action)) return false;
      if (type !== "source_import" && type !== "checklist_publish") return false;
      return !!action.product;
    });
    if (pendingChecklistValidation) {
      return {
        kind: "checklist_coverage_recheck",
        action: pendingChecklistValidation,
        title: "Self-heal pending checklist validation",
        detail: `${pendingChecklistValidation.product || "This checklist"} was published but not visible yet. Sentinel will recheck public JSON before asking admin.`
      };
    }

    const pendingPrvValidation = active.find(action => {
      const type = String(action.type || "").toLowerCase();
      if (!isPendingPublicValidationAction(action)) return false;
      if (type !== "prv_source_review" && type !== "prv_publish") return false;
      return !!action.code;
    });
    if (pendingPrvValidation) {
      return {
        kind: "prv_public_recheck",
        action: pendingPrvValidation,
        title: "Self-heal pending PRV validation",
        detail: `${pendingPrvValidation.product || pendingPrvValidation.code} was published but not visible yet. Sentinel will recheck public PRV JSON before asking admin.`
      };
    }

    const readyImport = active.find(action => {
      const status = String(action.status || "").toLowerCase();
      return action.type === "source_import" &&
        (status === "ready" || hasAdminApproval(action)) &&
        !!(action.sourceUrl || action.runUrl);
    });
    if (readyImport) {
      return {
        kind: "execute_import",
        action: readyImport,
        title: "Execute approved import",
        detail: `${readyImport.product || "Approved source"} is approved and ready for a product-scoped sheet write.`
      };
    }

    const visualReady = active.find(action => {
      const status = String(action.status || "").toLowerCase();
      if (!action.product) return false;
      if (status === "running" || status === "fix_queued") return false;
      if (isPendingVisualValidationAction(action)) return true;
      const posture = getActionExecutionPosture(action);
      return posture.label === "Validate";
    });
    if (visualReady) {
      return {
        kind: "visual_test",
        action: visualReady,
        title: "Run CV/ChatBot validation",
        detail: `${visualReady.product || visualReady.type} has execution or coverage proof and needs app behavior proof.`
      };
    }

    const safePrvRecheck = active.find(action => {
      const status = String(action.status || "").toLowerCase();
      const type = String(action.type || "").toLowerCase();
      const validation = String(action.validationResult || "").toLowerCase();
      const execution = String(action.executionResult || "").toLowerCase();
      if (type !== "prv_source_review" && type !== "prv_publish") return false;
      if (status === "running" || status === "failed" || status === "known_issue" || status === "blocked") return false;
      if (!action.code) return false;
      if (validation.includes("public rows") || validation.includes("public prv rows") || validation.includes("validated")) return false;
      return execution.includes("sheet write") ||
        execution.includes("json publish") ||
        status === "needs_admin" ||
        status === "approval_required";
    });
    if (safePrvRecheck) {
      return {
        kind: "prv_public_recheck",
        action: safePrvRecheck,
        title: "Verify PRV public JSON",
        detail: `${safePrvRecheck.product || safePrvRecheck.code} has a product code. Sentinel will check whether PRV is already live before asking for another admin decision.`
      };
    }

    const safeChecklistRecheck = active.find(action => {
      const status = String(action.status || "").toLowerCase();
      const type = String(action.type || "").toLowerCase();
      const validation = String(action.validationResult || "").toLowerCase();
      const execution = String(action.executionResult || "").toLowerCase();
      if (type !== "source_import" && type !== "checklist_publish") return false;
      if (status === "running" || status === "failed" || status === "known_issue" || status === "blocked") return false;
      if (!action.product) return false;
      if (validation.includes("public json covered") || validation.includes("public rows")) return false;
      return execution.includes("sheet write") ||
        execution.includes("json publish") ||
        status === "needs_admin" ||
        status === "approval_required";
    });
    if (safeChecklistRecheck) {
      return {
        kind: "checklist_coverage_recheck",
        action: safeChecklistRecheck,
        title: "Verify Checklist public JSON",
        detail: `${safeChecklistRecheck.product || safeChecklistRecheck.type} has enough detail for a safe public coverage check. Sentinel will verify the JSON before asking for admin review.`
      };
    }

    const safePrvPreview = active.find(action => {
      const status = String(action.status || "").toLowerCase();
      const type = String(action.type || "").toLowerCase();
      const execution = String(action.executionResult || "").toLowerCase();
      if (type !== "prv_source_review") return false;
      if (status === "running" || status === "failed" || status === "known_issue" || status === "blocked") return false;
      if (!(action.sourceUrl || action.runUrl)) return false;
      return !execution.includes("preview parsed") && !execution.includes("parser returned");
    });
    if (safePrvPreview) {
      return {
        kind: "prv_preview",
        action: safePrvPreview,
        title: "Build PRV preview",
        detail: `${safePrvPreview.product || "This PRV source"} can be safely previewed. No Google Sheet write will happen without approval.`
      };
    }

    const safeChecklistPreview = active.find(action => {
      const status = String(action.status || "").toLowerCase();
      const type = String(action.type || "").toLowerCase();
      const execution = String(action.executionResult || "").toLowerCase();
      if (type !== "source_import") return false;
      if (status === "running" || status === "failed" || status === "known_issue" || status === "blocked") return false;
      if (!(action.sourceUrl || action.runUrl)) return false;
      return !execution.includes("preview parsed") && !execution.includes("import preview");
    });
    if (safeChecklistPreview) {
      return {
        kind: "checklist_preview",
        action: safeChecklistPreview,
        title: "Build checklist preview",
        detail: `${safeChecklistPreview.product || "This checklist source"} can be safely previewed. No Google Sheet write will happen without approval.`
      };
    }

    const failed = active.find(action => {
      const status = String(action.status || "").toLowerCase();
      return status === "failed" || status === "blocked" || status === "known_issue";
    });
    if (failed) {
      return {
        kind: "create_fix_task",
        action: failed,
        title: "Create repair task",
        detail: `${failed.product || failed.type} is blocked and needs a fix path.`
      };
    }

    const approval = active.find(action => {
      const status = String(action.status || "").toLowerCase();
      return status === "needs_admin" || status === "approval_required";
    });
    if (approval) {
      return {
        kind: "needs_admin",
        action: approval,
        title: "Admin decision required",
        detail: `${approval.product || approval.type} needs approval before the agent can continue.`
      };
    }

    return {
      kind: "source_watch",
      action: null,
      title: "Run source watch",
      detail: "No active queue item needs execution. The agent can scan for the next source opportunity."
    };
  }

  function renderAgentCycleMessage(title, detail, severity) {
    renderSentinelNotice(title, detail, severity || "info");
    renderSourceCheckMessage(title, detail, severity || "info", { noFocus: true });
    logActivity({
      type: "agent_cycle",
      status: severity === "critical" ? "blocked" : "started",
      source: "command_center",
      title,
      detail
    });
    renderActivityLog();
  }

  function runVisualTestForAction(action, isRetest) {
    const plan = buildVisualTestPlanFromAction(action);
    updateAgentAction(action.id, {
      status: "running",
      validationResult: isRetest ? "CV/ChatBot retest requested after fix..." : "CV/ChatBot visual test requested..."
    });
    logActivity({
      type: "visual_test",
      status: "requested",
      product: action.product || "",
      source: "agent_cycle",
      title: isRetest ? "Retest requested" : "Visual test requested",
      detail: isRetest ? "Agent cycle started the required retest." : "Agent cycle started CV/ChatBot validation."
    });
    renderAgentActions();
    renderActionLanes();
    renderActivityLog();
    renderVisualTestPlan(plan);
    return runAgentVisualTest(plan);
  }

  function getPendingVisualValidationBatch(limit) {
    const max = Math.max(1, Math.min(10, Number(limit || 10)));
    return getActiveAgentActions()
      .filter(action => {
        if (!isPendingVisualValidationAction(action)) return false;
        const type = String(action.type || "").toLowerCase();
        if (type !== "source_import" && type !== "checklist_publish" && type !== "visual_test") return false;
        return !!action.product;
      })
      .slice(0, max);
  }

  function getRunningVisualValidationBatch(limit) {
    const max = Math.max(1, Math.min(8, Number(limit || 5)));
    return getActiveAgentActions()
      .filter(action => {
        const type = String(action.type || "").toLowerCase();
        const status = String(action.status || "").toLowerCase();
        if (type !== "visual_test" && type !== "source_import" && type !== "checklist_publish") return false;
        if (status !== "queued" && status !== "running" && status !== "in_progress") return false;
        const validation = String(action.validationResult || "").toLowerCase();
        return validation.includes("visual") || type === "visual_test";
      })
      .slice(0, max);
  }

  function renderVisualQueueSummary(input) {
    if (!els.sourceCheckResult) return;
    const selected = Array.isArray(input && input.selected) ? input.selected : [];
    const queued = Array.isArray(input && input.queued) ? input.queued : [];
    const failed = Array.isArray(input && input.failed) ? input.failed : [];
    const running = getRunningVisualValidationBatch(20);

    els.sourceCheckResult.innerHTML = `
      <div class="visual-test-card">
        <div class="opp-top">
          <div>
            <h3>CV/ChatBot Visual Test Queue</h3>
            <p>${escapeHtml(input && input.detail ? input.detail : "Sentinel is queueing product behavior checks.")}</p>
          </div>
          <span class="badge ${failed.length ? "warning" : "info"}">${escapeHtml(queued.length ? "in flight" : "queued")}</span>
        </div>
        <div class="opp-meta">
          <span class="pill">Selected: ${formatNumber(selected.length)}</span>
          <span class="pill">Queued: ${formatNumber(queued.length)}</span>
          <span class="pill">Running/In flight: ${formatNumber(running.length)}</span>
          <span class="pill">Failed to queue: ${formatNumber(failed.length)}</span>
        </div>
        <div class="source-watch-list">
          ${selected.slice(0, 10).map((action, index) => {
            const isQueued = queued.some(item => item.id === action.id);
            const isFailed = failed.some(item => item.id === action.id);
            return `
              <div class="source-watch-item">
                <div class="opp-top">
                  <div>
                    <strong>${escapeHtml(action.product || action.code || "Product")}</strong>
                    <p>${escapeHtml(isFailed ? "Visual test failed to queue." : isQueued ? "Visual test is queued in GitHub Actions." : "Waiting to dispatch visual test.")}</p>
                  </div>
                  <span class="badge ${isFailed ? "critical" : isQueued ? "info" : "warning"}">${isFailed ? "failed" : isQueued ? "queued" : (index + 1) + " of " + selected.length}</span>
                </div>
              </div>
            `;
          }).join("")}
        </div>
        <div class="task-guardrail">Run Agent Cycle again to refresh queued visual tests and close passed/failed results.</div>
      </div>
    `;
  }

  async function refreshRunningVisualValidationBatch(options) {
    const opts = options || {};
    const running = getRunningVisualValidationBatch(opts.limit || 5);
    if (!running.length) return { ok: true, checked: 0, detail: "No running visual tests to refresh." };

    if (!readOperatorEndpoint() || !readOperatorKey()) {
      return { ok: false, checked: 0, detail: "Backend URL or admin key is missing." };
    }

    let checked = 0;
    let closed = 0;
    let failed = 0;
    for (const action of running) {
      const plan = buildVisualTestPlanFromAction(action);
      await refreshAgentVisualTestStatus(plan, { silent: true });
      checked += 1;
      const fresh = state.agentActions.find(item => item.id === action.id) || action;
      const status = String(fresh.status || "").toLowerCase();
      if (status === "validated") closed += 1;
      if (status === "failed" || status === "fix_queued") failed += 1;
    }

    const detail = `${checked} visual test${checked === 1 ? "" : "s"} refreshed. ${closed} passed. ${failed} need repair.`;
    if (!opts.silent) {
      logActivity({
        type: "visual_test",
        status: failed ? "needs_review" : "checked",
        source: "agent_cycle",
        title: "Visual test statuses refreshed",
        detail
      });
      renderSentinelNotice("Visual tests refreshed", detail, failed ? "warning" : "success");
      renderActivityLog();
    }

    return { ok: failed === 0, checked, closed, failed, detail };
  }

  async function runPendingVisualValidationBatch(options) {
    const opts = options || {};
    const pending = getPendingVisualValidationBatch(opts.limit || 10);
    if (!pending.length) return { ok: true, queued: 0, detail: "No pending visual validations found." };

    if (!readOperatorEndpoint() || !readOperatorKey()) {
      const detail = "Backend URL or admin key is missing, so Sentinel cannot queue CV/ChatBot visual tests.";
      renderAgentCycleMessage("Visual validation needs setup", detail, "warning");
      return { ok: false, queued: 0, detail };
    }

    if (!opts.silentStart) {
      renderAgentCycleMessage(
        "Queuing CV/ChatBot validation",
        `${pending.length} product${pending.length === 1 ? "" : "s"} have public JSON proof. Sentinel will queue visual tests now.`,
        "info"
      );
    }

    let queued = 0;
    let failed = 0;
    const queuedActions = [];
    const failedActions = [];
    const labels = [];

    pending.forEach((action, index) => {
      updateAgentAction(action.id, {
        status: "queued",
        validationResult: `Queued for CV/ChatBot visual test dispatch (${index + 1} of ${pending.length}).`
      });
    });
    renderAgentActions();
    renderActionLanes();
    renderVisualQueueSummary({
      selected: pending,
      queued: queuedActions,
      failed: failedActions,
      detail: `Dispatching ${pending.length} CV/ChatBot visual test${pending.length === 1 ? "" : "s"}.`
    });

    for (const action of pending) {
      const plan = buildVisualTestPlanFromAction(action);
      updateAgentAction(action.id, {
        status: "running",
        validationResult: "CV/ChatBot visual test requested by Agent Cycle..."
      });
      renderAgentActions();
      renderActionLanes();

      const data = await runAgentVisualTest(plan, { silent: true, silentPanel: true });
      if (data && data.ok) {
        queued += 1;
        queuedActions.push(action);
        labels.push(action.product || action.code || "product");
      } else {
        failed += 1;
        failedActions.push(action);
        updateAgentAction(action.id, {
          status: "failed",
          validationResult: data && data.error ? data.error : "Visual test dispatch failed."
        });
      }
      renderVisualQueueSummary({
        selected: pending,
        queued: queuedActions,
        failed: failedActions,
        detail: `${queued} of ${pending.length} visual test${pending.length === 1 ? "" : "s"} queued so far.`
      });
    }

    const detail = `${queued} CV/ChatBot visual test${queued === 1 ? "" : "s"} queued.${failed ? " " + failed + " failed to queue." : ""}`;
    logActivity({
      type: "visual_test",
      status: failed ? "needs_review" : "queued",
      source: "agent_cycle",
      title: "Visual validation batch queued",
      detail: labels.length ? `${detail} ${labels.slice(0, 4).join("; ")}` : detail
    });
    renderSentinelNotice("Visual validation batch queued", detail, failed ? "warning" : "success");
    renderVisualQueueSummary({
      selected: pending,
      queued: queuedActions,
      failed: failedActions,
      detail
    });
    renderActivityLog();
    renderAgentActions();
    renderActionLanes();

    return { ok: failed === 0, queued, failed, detail };
  }

  function getPendingPublicValidationBatch(limit) {
    const max = Math.max(1, Math.min(8, Number(limit || 5)));
    return getActiveAgentActions()
      .filter(action => {
        if (!isPendingPublicValidationAction(action)) return false;
        const type = String(action.type || "").toLowerCase();
        if (type !== "source_import" && type !== "checklist_publish" && type !== "prv_source_review" && type !== "prv_publish") return false;
        return !!(action.product || action.code);
      })
      .slice(0, max);
  }

  function countActiveSafeAutoCandidates() {
    return getActiveAgentActions().filter(action => {
      const status = String(action.status || "").toLowerCase();
      const type = String(action.type || "").toLowerCase();
      const validation = String(action.validationResult || "").toLowerCase();
      if (status === "running" || status === "failed" || status === "blocked" || status === "known_issue") return false;
      if (type !== "source_import" && type !== "checklist_publish" && type !== "prv_source_review" && type !== "prv_publish") return false;
      if (validation.includes("visual test") || validation.includes("cv/chatbot")) return false;
      if (status === "pending_visual_validation") return false;
      if (status === "pending_public_validation") return !!(action.code || action.product);
      return !!(action.sourceUrl || action.runUrl || action.code);
    }).length;
  }

  function getBackendSweepAutoCount(data) {
    const autoActions = data && data.auto_actions ? data.auto_actions : null;
    if (autoActions && autoActions.ran) return Number(autoActions.count || 0);
    const autoAction = data && data.auto_action ? data.auto_action : null;
    if (autoAction && autoAction.ran) return 1;
    return 0;
  }

  function getBackendSweepStopReason(data) {
    const autoActions = data && data.auto_actions ? data.auto_actions : null;
    if (autoActions && autoActions.reason) return autoActions.reason;
    const autoAction = data && data.auto_action ? data.auto_action : null;
    if (autoAction && autoAction.reason) return autoAction.reason;
    return "";
  }

  async function runBackendAgentDrainCycle() {
    if (!readOperatorEndpoint() || !readOperatorKey()) {
      return runBackendAgentSweep();
    }

    const maxWaves = 4;
    let waves = 0;
    let totalAuto = 0;
    let stopReason = "";
    const waveSummaries = [];

    renderAgentCycleMessage(
      "Running Agent Cycle",
      "Sentinel will run safe backend work in waves until the safe queue is quiet, blocked, or the time guardrail is reached.",
      "info"
    );

    for (let wave = 1; wave <= maxWaves; wave += 1) {
      const safeBefore = countActiveSafeAutoCandidates();
      if (wave > 1 && safeBefore <= 0) {
        stopReason = "No local safe queue candidates remain.";
        break;
      }

      const data = await runBackendAgentSweep({ silent: true, wave });
      waves += 1;
      const autoCount = getBackendSweepAutoCount(data);
      totalAuto += autoCount;
      stopReason = getBackendSweepStopReason(data) || "";
      const summary = data && data.auto_actions && data.auto_actions.summary
        ? data.auto_actions.summary
        : data && data.auto_action
          ? `${data.auto_action.product || data.auto_action.type || "action"} -> ${data.auto_action.status || data.auto_action.reason || "complete"}`
          : stopReason || "No backend auto action result.";
      waveSummaries.push(`Wave ${wave}: ${summary}`);

      if (!data || data.ok === false) {
        stopReason = data && data.error ? data.error : "Backend sweep returned an issue.";
        break;
      }

      if (autoCount <= 0) {
        stopReason = stopReason || "No safe auto-executable action found.";
        break;
      }

      if (data.auto_actions && data.auto_actions.results && data.auto_actions.results.some(result => result && result.status && result.status !== "validated")) {
        stopReason = "A wave ended with an item needing validation or admin review.";
        break;
      }
    }

    await loadBackendAgentMemory();
    const visualBatch = getPendingVisualValidationBatch(10);
    let visualSummary = "";
    let visualQueuedCount = 0;
    if (visualBatch.length) {
      const visualResult = await runPendingVisualValidationBatch({ silentStart: true, limit: 10 });
      visualQueuedCount = Number(visualResult && visualResult.queued || 0);
      visualSummary = visualResult && visualResult.queued
        ? ` Queued ${visualResult.queued} CV/ChatBot visual test${visualResult.queued === 1 ? "" : "s"}.`
        : "";
    }
    const activeCount = getActiveAgentActions().length;
    const detail = `${waves} wave${waves === 1 ? "" : "s"} ran. ${totalAuto} safe action${totalAuto === 1 ? "" : "s"} executed.${visualSummary} ${activeCount} active queue item${activeCount === 1 ? "" : "s"} remain.${stopReason ? " Stopped because: " + stopReason : ""}`;

    logActivity({
      type: "agent_cycle",
      status: activeCount ? "needs_review" : "validated",
      source: "operator_backend",
      title: "Agent Cycle drain complete",
      detail: `${detail} ${waveSummaries.slice(0, 4).join(" ")}`
    });
    renderActivityLog();
    renderSentinelNotice("Agent Cycle complete", detail, activeCount ? "warning" : "success");
    renderSourceCheckMessage("Agent Cycle complete", detail, activeCount ? "warning" : "success", { noFocus: true });
    renderAgentActions();
    renderActionLanes();
    renderRunSummary();

    return {
      ok: true,
      waves,
      totalAuto,
      visualQueued: visualQueuedCount,
      activeCount,
      stopReason,
      summaries: waveSummaries
    };
  }

  async function runPendingPublicValidationBatch() {
    const pending = getPendingPublicValidationBatch(6);
    if (!pending.length) return { ok: true, ran: 0, detail: "No pending public validations found." };

    if (readOperatorEndpoint() && readOperatorKey()) {
      renderAgentCycleMessage(
        "Self-healing pending validations",
        `${pending.length} pending public validation item${pending.length === 1 ? "" : "s"} found. Sentinel is handing the batch to the backend worker so stale JSON can be republished when needed.`,
        "info"
      );
      return runBackendAgentDrainCycle();
    }

    renderAgentCycleMessage(
      "Rechecking pending validations",
      `${pending.length} pending public validation item${pending.length === 1 ? "" : "s"} found. Backend key is missing, so Sentinel will only recheck public JSON and will not publish.`,
      "warning"
    );

    let passed = 0;
    let needsReview = 0;
    for (const action of pending) {
      const type = String(action.type || "").toLowerCase();
      if (type === "prv_source_review" || type === "prv_publish") {
        await recheckPrvPublicData(action.code || "", action.id);
      } else {
        await recheckActionCoverage(action.id);
      }

      const fresh = state.agentActions.find(item => item.id === action.id) || action;
      const status = String(fresh.status || "").toLowerCase();
      if (status === "pending_visual_validation" || status === "validated") passed += 1;
      else needsReview += 1;
    }

    const detail = `${passed} moved forward. ${needsReview} still need backend publish or admin review.`;
    logActivity({
      type: "agent_cycle",
      status: needsReview ? "needs_review" : "validated",
      source: "command_center",
      title: "Pending validation batch complete",
      detail
    });
    renderSentinelNotice("Pending validation batch complete", detail, needsReview ? "warning" : "success");
    renderActivityLog();
    renderAgentActions();
    renderActionLanes();
    return { ok: needsReview === 0, ran: pending.length, passed, needsReview, detail };
  }

  function describeQueuedActionAttempt(action) {
    const status = String(action && action.status || "").toLowerCase();
    const type = String(action && action.type || "").toLowerCase();
    const execution = String(action && action.executionResult || "").toLowerCase();
    const posture = action ? getActionExecutionPosture(action) : null;

    if (!action) return { kind: "missing", label: "Missing action", safe: false };
    if (isResolvedAgentAction(action)) return { kind: "resolved", label: "Already resolved", safe: false };
    if (status === "running" || status === "in_progress") {
      const validation = String(action.validationResult || "").toLowerCase();
      if (validation.includes("visual") || type === "visual_test") {
        return { kind: "refresh_visual", label: "Refresh visual test status", safe: true };
      }
      return { kind: "skip_running", label: "Already running", safe: false };
    }
    if (status === "queued") {
      const validation = String(action.validationResult || "").toLowerCase();
      if (validation.includes("visual") || type === "visual_test") {
        return { kind: "refresh_visual", label: "Refresh visual test status", safe: true };
      }
    }
    if (status === "pending_visual_validation" || (posture && posture.label === "Validate")) {
      return { kind: "visual_test", label: "Run CV/ChatBot visual test", safe: true };
    }
    if (status === "pending_public_validation") {
      if (type === "prv_source_review" || type === "prv_publish") return { kind: "prv_public_recheck", label: "Recheck PRV public JSON", safe: true };
      return { kind: "checklist_coverage_recheck", label: "Recheck checklist public JSON", safe: true };
    }
    if (status === "fix_applied" && action.product) return { kind: "visual_test", label: "Run retest after fix", safe: true };
    if (type === "backend_data_issue" && (action.product || action.code)) {
      return { kind: "checklist_coverage_recheck", label: "Recheck checklist public JSON", safe: true };
    }
    if (type === "source_import") {
      if ((status === "approved" || status === "ready" || hasAdminApproval(action)) && (action.sourceUrl || action.runUrl)) {
        return { kind: "execute_import", label: "Write approved checklist import", safe: true };
      }
      if ((action.sourceUrl || action.runUrl) && !execution.includes("preview parsed") && !execution.includes("import preview")) {
        return { kind: "checklist_preview", label: "Preview checklist source", safe: true };
      }
      if (action.product || action.code) {
        return { kind: "checklist_coverage_recheck", label: "Recheck checklist public JSON", safe: true };
      }
      return { kind: "needs_admin", label: "Checklist write needs approval or source details", safe: false };
    }
    if (type === "checklist_publish") {
      if (hasAdminApproval(action) && (action.code || action.product)) return { kind: "publish_checklist", label: "Publish approved checklist JSON", safe: true };
      if (action.product) return { kind: "checklist_coverage_recheck", label: "Recheck checklist public JSON", safe: true };
      return { kind: "needs_admin", label: "Checklist publish needs product details", safe: false };
    }
    if (type === "prv_source_review") {
      if (status === "known_issue" || status === "blocked" || status === "failed") return { kind: "create_fix_task", label: "Create repair task", safe: true };
      if (hasAdminApproval(action) && (execution.includes("products rows") || execution.includes("prv index") || execution.includes("sheet write")) && action.code) {
        return { kind: "publish_prv_json", label: "Publish approved PRV JSON", safe: true };
      }
      if (hasAdminApproval(action) && execution.includes("preview parsed") && (action.sourceUrl || action.runUrl)) {
        return { kind: "execute_prv_import", label: "Write approved PRV data", safe: true };
      }
      if ((action.sourceUrl || action.runUrl) && !execution.includes("preview parsed") && !execution.includes("parser returned")) {
        return { kind: "prv_preview", label: "Preview PRV source", safe: true };
      }
      if (action.code) return { kind: "prv_public_recheck", label: "Recheck PRV public JSON", safe: true };
      return { kind: "needs_admin", label: "PRV write needs approval or product code", safe: false };
    }
    if (type === "prv_publish" && action.code) return { kind: "prv_public_recheck", label: "Recheck PRV public JSON", safe: true };
    if (type === "prv_sync_incident") return { kind: "prv_sync_recovery", label: "Retry PRV sync recovery", safe: true };
    if (type === "sentinel_incident") return { kind: "sentinel_incident_recovery", label: "Retry Sentinel self-test", safe: true };
    if (status === "failed" || status === "blocked" || status === "known_issue") return { kind: "create_fix_task", label: "Create repair task", safe: true };
    return { kind: "needs_admin", label: "No safe attempt is available yet", safe: false };
  }

  async function attemptQueuedAgentAction(action) {
    const attempt = describeQueuedActionAttempt(action);
    if (!action || !attempt.safe) {
      return {
        ok: false,
        skipped: true,
        action,
        kind: attempt.kind,
        detail: attempt.label
      };
    }

    const sourceUrl = action.sourceUrl || action.runUrl || "";
    logActivity({
      type: "agent_run_queue",
      status: "started",
      product: action.product || "",
      source: "admin_run_queue",
      title: attempt.label,
      detail: `${action.product || action.code || action.type} is being attempted from the Admin Run Queue.`
    });
    renderActivityLog();

    if (attempt.kind === "refresh_visual") {
      const plan = buildVisualTestPlanFromAction(action);
      await refreshAgentVisualTestStatus(plan, { silent: true });
      return { ok: true, action, kind: attempt.kind, detail: attempt.label };
    }
    if (attempt.kind === "visual_test") {
      const plan = buildVisualTestPlanFromAction(action);
      updateAgentAction(action.id, {
        status: "running",
        validationResult: "CV/ChatBot visual test requested by Admin Run Queue..."
      });
      renderAgentActions();
      renderActionLanes();
      renderVisualTestPlan(plan);
      const data = await runAgentVisualTest(plan, { silent: true, silentPanel: true });
      return { ok: !!(data && data.ok), action, kind: attempt.kind, detail: data && data.error ? data.error : attempt.label };
    }
    if (attempt.kind === "prv_public_recheck") {
      await recheckPrvPublicData(action.code || "", action.id);
      return { ok: true, action, kind: attempt.kind, detail: attempt.label };
    }
    if (attempt.kind === "checklist_coverage_recheck") {
      await recheckActionCoverage(action.id);
      return { ok: true, action, kind: attempt.kind, detail: attempt.label };
    }
    if (attempt.kind === "checklist_preview") {
      await previewSourceImport(sourceUrl, action.sport || "", action.id);
      return { ok: true, action, kind: attempt.kind, detail: attempt.label };
    }
    if (attempt.kind === "execute_import") {
      await executeSourceImport(sourceUrl, action.sport || "", action.id);
      return { ok: true, action, kind: attempt.kind, detail: attempt.label };
    }
    if (attempt.kind === "publish_checklist") {
      await publishChecklistAction(action.id);
      return { ok: true, action, kind: attempt.kind, detail: attempt.label };
    }
    if (attempt.kind === "prv_preview") {
      await previewPrvSource(sourceUrl, action.sport || "", action.id);
      return { ok: true, action, kind: attempt.kind, detail: attempt.label };
    }
    if (attempt.kind === "execute_prv_import") {
      await executePrvSourceImport(sourceUrl, action.sport || "", action.id);
      return { ok: true, action, kind: attempt.kind, detail: attempt.label };
    }
    if (attempt.kind === "publish_prv_json") {
      await publishPrvVaultData(action.code || "", action.id);
      return { ok: true, action, kind: attempt.kind, detail: attempt.label };
    }
    if (attempt.kind === "prv_sync_recovery") {
      await attemptPrvSyncIncidentRecovery(action);
      return { ok: true, action, kind: attempt.kind, detail: attempt.label };
    }
    if (attempt.kind === "sentinel_incident_recovery") {
      await attemptSentinelIncidentRecovery(action);
      return { ok: true, action, kind: attempt.kind, detail: attempt.label };
    }
    if (attempt.kind === "create_fix_task") {
      const task = createFixTaskFromAgentAction(action);
      renderOperatorTasks();
      renderAgentActions();
      renderActionLanes();
      return { ok: true, action, kind: attempt.kind, detail: `Created ${task.title}.` };
    }

    return { ok: false, skipped: true, action, kind: attempt.kind, detail: attempt.label };
  }

  async function runAdminRunQueue() {
    const queued = getQueuedAgentActions(10);
    if (!queued.length) return { ok: true, ran: 0, detail: "No Admin Run Queue jobs found." };

    renderAgentCycleMessage(
      "Running Admin Run Queue",
      `${queued.length} flagged job${queued.length === 1 ? "" : "s"} will be attempted before Sentinel chooses other work.`,
      "info"
    );

    let attempted = 0;
    let skipped = 0;
    let failed = 0;
    const summaries = [];

    for (const action of queued) {
      let fresh = state.agentActions.find(item => item.id === action.id);
      if (!fresh || isResolvedAgentAction(fresh)) {
        removeActionFromRunQueue(action.id, { silent: true, source: "agent_run_queue" });
        continue;
      }
      fresh = applyRunQueueApproval(fresh);

      try {
        const result = await attemptQueuedAgentAction(fresh);
        if (result && result.skipped) {
          skipped += 1;
          updateAgentAction(fresh.id, {
            executionResult: "Admin Run Queue skipped this item.",
            validationResult: result.detail || "No safe executable next step was available."
          });
        } else {
          attempted += 1;
        }
        if (result && result.ok === false && !result.skipped) failed += 1;

        const current = state.agentActions.find(item => item.id === fresh.id);
        if (current && isResolvedAgentAction(current)) {
          removeActionFromRunQueue(current.id, { silent: true, source: "agent_run_queue" });
        }
        summaries.push(`${fresh.product || fresh.code || fresh.type}: ${result && result.detail || "attempted"}`);
      } catch (err) {
        failed += 1;
        updateAgentAction(fresh.id, {
          status: "failed",
          executionResult: err && err.message ? err.message : "Admin Run Queue attempt failed."
        });
        summaries.push(`${fresh.product || fresh.code || fresh.type}: failed`);
      }
    }

    clearResolvedRunQueueItems();
    const remaining = getQueuedAgentActions(20).length;
    const detail = `${attempted} attempted. ${skipped} skipped for approval/details. ${failed} failed. ${remaining} still queued.`;
    logActivity({
      type: "agent_run_queue",
      status: failed || skipped || remaining ? "needs_review" : "validated",
      source: "admin_run_queue",
      title: "Admin Run Queue complete",
      detail: `${detail} ${summaries.slice(0, 5).join(" ")}`
    });
    renderSentinelNotice("Admin Run Queue complete", detail, failed || skipped || remaining ? "warning" : "success");
    renderSourceCheckMessage("Admin Run Queue complete", detail, failed || skipped || remaining ? "warning" : "success", { noFocus: true });
    renderActivityLog();
    renderAgentActions();
    renderActionLanes();
    renderRunSummary();

    return { ok: failed === 0, attempted, skipped, failed, remaining, detail };
  }

  async function runAgentCycle() {
    const queued = getQueuedAgentActions(10);
    if (queued.length) {
      return runAdminRunQueue();
    }

    const runningVisuals = getRunningVisualValidationBatch(5);
    if (runningVisuals.length) {
      return refreshRunningVisualValidationBatch({ limit: 5 });
    }

    if (readOperatorEndpoint() && readOperatorKey() && countActiveSafeAutoCandidates() > 1) {
      return runBackendAgentDrainCycle();
    }

    const visualBatch = getPendingVisualValidationBatch(10);
    if (visualBatch.length > 1) {
      return runPendingVisualValidationBatch({ limit: 10 });
    }

    const pendingBatch = getPendingPublicValidationBatch(6);
    if (pendingBatch.length > 1) {
      return runPendingPublicValidationBatch();
    }

    const step = getAgentCycleStep();

    if (step.kind === "sentinel_incident_recovery") {
      renderAgentCycleMessage(step.title, step.detail, "warning");
      return attemptSentinelIncidentRecovery(step.action);
    }

    if (step.kind === "prv_sync_recovery") {
      renderAgentCycleMessage(step.title, step.detail, "warning");
      return attemptPrvSyncIncidentRecovery(step.action);
    }

    if (step.kind === "retest") {
      renderAgentCycleMessage(step.title, step.detail, "info");
      return runVisualTestForAction(step.action, true);
    }

    if (step.kind === "approved_prv_preview") {
      const sourceUrl = step.action.sourceUrl || step.action.runUrl || "";
      renderAgentCycleMessage(step.title, step.detail, "info");
      return previewPrvSource(sourceUrl, step.action.sport || "", step.action.id);
    }

    if (step.kind === "execute_prv_import") {
      const sourceUrl = step.action.sourceUrl || step.action.runUrl || "";
      renderAgentCycleMessage(step.title, step.detail, "info");
      return executePrvSourceImport(sourceUrl, step.action.sport || "", step.action.id);
    }

    if (step.kind === "execute_import") {
      const sourceUrl = step.action.sourceUrl || step.action.runUrl || "";
      renderAgentCycleMessage(step.title, step.detail, "info");
      return executeSourceImport(sourceUrl, step.action.sport || "", step.action.id);
    }

    if (step.kind === "publish_prv_json") {
      renderAgentCycleMessage(step.title, step.detail, "info");
      return publishPrvVaultData(step.action.code || "", step.action.id);
    }

    if (step.kind === "visual_test") {
      renderAgentCycleMessage(step.title, step.detail, "info");
      return runVisualTestForAction(step.action, false);
    }

    if (step.kind === "prv_public_recheck") {
      renderAgentCycleMessage(step.title, step.detail, "info");
      return recheckPrvPublicData(step.action.code || "", step.action.id);
    }

    if (step.kind === "checklist_coverage_recheck") {
      renderAgentCycleMessage(step.title, step.detail, "info");
      return recheckActionCoverage(step.action.id);
    }

    if (step.kind === "prv_preview") {
      const sourceUrl = step.action.sourceUrl || step.action.runUrl || "";
      renderAgentCycleMessage(step.title, step.detail, "info");
      return previewPrvSource(sourceUrl, step.action.sport || "", step.action.id);
    }

    if (step.kind === "checklist_preview") {
      const sourceUrl = step.action.sourceUrl || step.action.runUrl || "";
      renderAgentCycleMessage(step.title, step.detail, "info");
      return previewSourceImport(sourceUrl, step.action.sport || "", step.action.id);
    }

    if (step.kind === "create_fix_task") {
      const task = createFixTaskFromAgentAction(step.action);
      renderAgentCycleMessage(step.title, `${step.detail} Created ${task.title}.`, "warning");
      renderOperatorTasks();
      renderAgentActions();
      renderActionLanes();
      renderActivityLog();
      return { ok: true, task };
    }

    if (step.kind === "needs_admin") {
      renderAgentCycleMessage(step.title, `${step.detail} Use Scan New Checklists if you want a fresh source scan without advancing this queue item.`, "warning");
      return { ok: false, reason: "Admin decision required." };
    }

    if (step.kind === "wait") {
      renderAgentCycleMessage(step.title, step.detail, "warning");
      return { ok: false, reason: "Active work is already running." };
    }

    renderAgentCycleMessage(
      "Scanning for new work",
      readOperatorEndpoint() && readOperatorKey()
        ? "No active queue item needed action, so Sentinel is running the backend worker sweep now."
        : "No active queue item needed action, so Sentinel is running the browser daily sweep now.",
      "info"
    );
    if (readOperatorEndpoint() && readOperatorKey()) return runBackendAgentSweep();
    runDailySentinelSweep();
    return { ok: true };
  }

  function renderActionLaneCard(action, lane) {
    const badgeClass = getAgentActionBadgeClass(action);
    const fixPlan = buildAgentActionFixPlan(action);
    const nextStep = lane === "ready"
      ? "Next: execute the prepared step, then validate CV/ChatBot and log proof."
      : fixPlan.summary || "Next: admin review or product-specific fix before execution.";
    return `
      <article class="lane-action-card">
        <div>
          <div class="next-kind">${escapeHtml(action.type || "agent_action")}</div>
          <h3>${escapeHtml(action.product || action.recommendedAction || "Agent action")}</h3>
          <p>${escapeHtml(action.recommendedAction || nextStep)}</p>
          <span>${escapeHtml(nextStep)}</span>
        </div>
        <span class="badge ${badgeClass}">${escapeHtml(getAgentActionStatusLabel(action.status))}</span>
      </article>
    `;
  }

  function buildAgentActionFixPlan(action) {
    const status = String(action && action.status || "").toLowerCase();
    const type = String(action && action.type || "").toLowerCase();
    const validation = String(action && action.validationResult || "").toLowerCase();
    const execution = String(action && action.executionResult || "").toLowerCase();

    if (status === "failed" && type === "visual_test") {
      return {
        summary: "Open the visual report, identify the failing query or page, patch sandbox behavior, then rerun CV/ChatBot validation.",
        steps: [
          "Open the GitHub Actions visual report and note the failing test label.",
          "Identify whether the failure is ChatBot query routing, Checklist Vault product loading, or expected-test wording.",
          "Patch the sandbox file only, then run syntax checks.",
          "Push the fix and rerun the same product visual test.",
          "Mark validated only after the visual test passes."
        ]
      };
    }

    if (status === "failed" && validation.includes("visual")) {
      return {
        summary: "Treat this as a product-specific app behavior failure and use the visual report as proof.",
        steps: [
          "Open the visual report linked on the card.",
          "Compare the failing query with the product code and public JSON coverage.",
          "Fix the broken route, search alias, or ChatBot intent in sandbox.",
          "Rerun Test CV/ChatBot from this product card.",
          "Keep the item in Review/Hold until the rerun passes."
        ]
      };
    }

    if (status === "failed" && (validation.includes("coverage") || execution.includes("publish"))) {
      return {
        summary: "Recheck publish coverage before touching UI code.",
        steps: [
          "Run Recheck Coverage for this product.",
          "If public rows are missing, rerun the correct sport/year publish function.",
          "If the product is new, rebuild the checklist index.",
          "Wait for GitHub Pages propagation, then recheck coverage.",
          "Run CV/ChatBot visual validation after JSON coverage is confirmed."
        ]
      };
    }

    if (status === "known_issue") {
      return {
        summary: "Known issue is intentionally held; convert it to a fix task when ready.",
        steps: [
          "Confirm the issue still reproduces.",
          "Decide whether this is data, search, UI, or test expectation work.",
          "Patch in sandbox and document the affected product/query.",
          "Run the product visual test before clearing the known issue."
        ]
      };
    }

    if (status === "fix_queued") {
      return {
        summary: "Repair task is already queued. Complete it, then rerun the affected validation.",
        steps: [
          "Open the matching Operator Task.",
          "Complete the listed repair steps in sandbox.",
          "Rerun the same product validation.",
          "Mark done only after the fix has been applied."
        ]
      };
    }

    if (status === "fix_applied") {
      return {
        summary: "Fix task is complete. Rerun CV/ChatBot validation before resolving this item.",
        steps: [
          "Rerun Test CV/ChatBot for the same product.",
          "Confirm the product returns a passed visual status.",
          "Let the Command Center update the card from the visual proof.",
          "Only mark manually validated if you have equivalent proof."
        ]
      };
    }

    if (status === "needs_admin" || status === "approval_required") {
      return {
        summary: "Admin decision needed before the agent can continue.",
        steps: [
          "Review the source, sport, product code, and target sheet.",
          "Preview import if this is source data.",
          "Approve only if the scope is one product and no delete-first workflow is involved.",
          "After approval, write, publish, recheck coverage, and run CV/ChatBot validation."
        ]
      };
    }

    return {
      summary: "",
      steps: []
    };
  }

  function getAutonomyReadiness() {
    const actions = state.agentActions || [];
    const critical = (state.opportunities || []).filter(item => item.severity === "critical");
    const blockers = actions.filter(action => {
      const status = String(action.status || "").toLowerCase();
      return status === "failed" || status === "blocked";
    });
    const knownIssues = actions.filter(action => String(action.status || "").toLowerCase() === "known_issue");
    const needsAdmin = actions.filter(action => {
      const status = String(action.status || "").toLowerCase();
      return status === "needs_admin" || status === "approval_required";
    });
    const validated = actions.filter(action => String(action.status || "").toLowerCase() === "validated");

    if (critical.length || blockers.length) {
      return {
        label: "Hold",
        detail: `${formatNumber(critical.length)} critical audit items and ${formatNumber(blockers.length)} blocked actions.`,
        className: "critical"
      };
    }

    if (needsAdmin.length || knownIssues.length) {
      return {
        label: "Review",
        detail: `${formatNumber(needsAdmin.length)} actions need admin review and ${formatNumber(knownIssues.length)} known issues are open.`,
        className: "warning"
      };
    }

    if (state.autonomyMode === "full_auto") {
      return {
        label: "Full Auto",
        detail: "Full auto can run approved product-scoped writes, publishes, and validation in bounded batches.",
        className: blockers.length || knownIssues.length ? "warning" : "opportunity"
      };
    }

    if (state.autonomyMode === "guarded_auto") {
      return {
        label: "Guarded",
        detail: "Guarded auto self-heals pending public validation, but does not write new source rows.",
        className: "opportunity"
      };
    }

    return {
      label: "Manual",
      detail: "Approval-required mode is safest until more validated runs are logged.",
      className: "info"
    };
  }

  function renderAutonomyReadiness() {
    const readiness = getAutonomyReadiness();
    if (els.autonomyReadiness) {
      els.autonomyReadiness.textContent = readiness.label;
      els.autonomyReadiness.className = `readiness-value ${readiness.className}`;
      els.autonomyReadiness.title = readiness.detail;
    }
    return readiness;
  }

  function renderActionLanes() {
    if (!els.readyExecuteList || !els.reviewHoldList) return;

    const actions = getActiveAgentActions();
    const ready = actions.filter(isReadyAction).slice(0, 6);
    const holds = actions.filter(isHoldAction).slice(0, 6);

    els.readyExecuteList.innerHTML = ready.length
      ? ready.map(action => renderActionLaneCard(action, "ready")).join("")
      : `
        <div class="brief-item">
          <strong>No ready actions yet</strong>
          <span>Approve a next step or run Source Watch to prepare executable work.</span>
        </div>
      `;

    els.reviewHoldList.innerHTML = holds.length
      ? holds.map(action => renderActionLaneCard(action, "hold")).join("")
      : `
        <div class="brief-item">
          <strong>No holds yet</strong>
          <span>Known issues, failed visual tests, and review-required items will appear here.</span>
        </div>
      `;
  }

  function renderActivityLog() {
    if (!state.activityLog.length) {
      els.activityLogList.innerHTML = `
        <div class="brief-item">
          <strong>No activity yet</strong>
          <span>Agent events will appear here.</span>
        </div>
      `;
      renderRunSummary();
      return;
    }

    els.activityLogList.innerHTML = state.activityLog.slice(0, 18).map(entry => {
      const time = entry.ts ? new Date(entry.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
      return `
        <div class="activity-log-row">
          <strong>${escapeHtml(entry.title || "Activity")}</strong>
          <span>${escapeHtml(entry.detail || "")}</span>
          <em>${escapeHtml([time, entry.status, entry.source].filter(Boolean).join(" | "))}</em>
        </div>
      `;
    }).join("");
    renderRunSummary();
  }

  function getLatestActivityByStatus(statuses) {
    const wanted = (statuses || []).map(s => String(s).toLowerCase());
    return (state.activityLog || []).find(entry => wanted.includes(String(entry.status || "").toLowerCase()));
  }

  function getLatestAgentSweepActivity() {
    return (state.activityLog || []).find(entry => {
      const type = String(entry.type || "").toLowerCase();
      const title = String(entry.title || "").toLowerCase();
      return type === "agent_sweep" || title.includes("backend agent sweep") || title.includes("scheduled agent sweep");
    }) || null;
  }

  function summarizeHeldActions(actions) {
    const held = (actions || []).filter(action => {
      const status = String(action.status || "").toLowerCase();
      return status === "known_issue" || status === "blocked" || status === "failed";
    });
    const lockedPrv = held.filter(action => action.type === "prv_source_review" && getPrvKnownIssueReason(action) === "Locked source");
    const failed = held.filter(action => String(action.status || "").toLowerCase() === "failed");
    const blocked = held.filter(action => String(action.status || "").toLowerCase() === "blocked");

    if (!held.length) return "No held issues. Sentinel can continue with the next safe action.";
    const parts = [];
    if (lockedPrv.length) parts.push(`${formatNumber(lockedPrv.length)} locked PRV source${lockedPrv.length === 1 ? "" : "s"}`);
    if (failed.length) parts.push(`${formatNumber(failed.length)} failed action${failed.length === 1 ? "" : "s"}`);
    if (blocked.length) parts.push(`${formatNumber(blocked.length)} blocked action${blocked.length === 1 ? "" : "s"}`);
    const other = held.length - lockedPrv.length - failed.length - blocked.length;
    if (other > 0) parts.push(`${formatNumber(other)} other known issue${other === 1 ? "" : "s"}`);
    return `${parts.join(", ")} held from auto execution.`;
  }

  function getNextAgentRecommendation(actions) {
    const queued = getQueuedAgentActions(10);
    if (queued.length) return `Run Agent Cycle to attempt ${formatNumber(queued.length)} admin-queued job${queued.length === 1 ? "" : "s"} first.`;

    const recheckReady = (actions || []).find(action => {
      const attempt = describeQueuedActionAttempt(action);
      return attempt && attempt.safe && (attempt.kind === "checklist_coverage_recheck" || attempt.kind === "prv_public_recheck");
    });
    if (recheckReady) return `Sentinel can safely recheck public JSON for ${recheckReady.product || recheckReady.code || "the next audit item"}.`;

    const pendingValidation = (actions || []).find(action => String(action.status || "").toLowerCase() === "pending_public_validation");
    if (pendingValidation) return `Let Sentinel recheck published JSON for ${pendingValidation.product || pendingValidation.code || "the pending product"}.`;

    const needsAdmin = (actions || []).find(action => {
      const status = String(action.status || "").toLowerCase();
      return status === "needs_admin" || status === "approval_required";
    });
    if (needsAdmin) return `Review ${needsAdmin.product || needsAdmin.type || "the next action"} and approve only if the source/target scope is correct.`;

    const lockedPrv = (actions || []).find(action => action.type === "prv_source_review" && String(action.status || "").toLowerCase() === "known_issue");
    if (lockedPrv) return `Locked PRV sources are held. Choose Ignore Future, Keep Watching, or Add Manual PRV Data.`;

    return "Run Agent Cycle again later, or run Deep Sheets Audit when you need source-of-truth verification.";
  }

  function renderRunSummary() {
    if (!els.runSummaryList) return;

    const actions = getActiveAgentActions();
    const resolved = getResolvedAgentActions();
    const pending = actions.filter(action => {
      const status = String(action.status || "").toLowerCase();
      return status === "queued" || status === "approval_required" || status === "approved" || status === "needs_admin" || status === "running";
    });
    const blocked = actions.filter(action => {
      const status = String(action.status || "").toLowerCase();
      return status === "failed" || status === "blocked" || status === "known_issue";
    });
    const critical = (state.opportunities || []).filter(item => item.severity === "critical");
    const latestSweep = getLatestAgentSweepActivity();
    const latestFailure = getLatestActivityByStatus(["failed", "needs_review", "blocked", "known_issue"]);
    const latestSuccess = getLatestActivityByStatus(["validated", "completed", "imported", "exported", "queued", "saved"]);
    const validated = resolved.filter(action => String(action.status || "").toLowerCase() === "validated");
    const pendingValidation = actions.filter(action => String(action.status || "").toLowerCase() === "pending_public_validation");
    const runQueue = getQueuedAgentActions(20);
    const mode = getAutonomyLabel(state.autonomyMode);
    const readiness = renderAutonomyReadiness();
    const heldDetail = summarizeHeldActions(actions);
    const nextRecommendation = getNextAgentRecommendation(actions);

    const cards = [
      {
        title: "Last Sweep",
        detail: latestSweep ? latestSweep.detail || latestSweep.status || "Sweep completed." : "No backend sweep has been logged yet.",
        badge: latestSweep ? latestSweep.status || "logged" : "not run"
      },
      {
        title: "Checked",
        detail: `Mode: ${mode}. ${readiness.detail}`,
        badge: readiness.label
      },
      {
        title: "Changed",
        detail: latestSuccess ? `${latestSuccess.title}: ${latestSuccess.detail || latestSuccess.status}` : "No new write, validation, save, or queue change recorded yet.",
        badge: latestSuccess ? latestSuccess.status || "recorded" : "none"
      },
      {
        title: "Held",
        detail: heldDetail,
        badge: blocked.length ? "held" : "clear"
      },
      {
        title: "Validation",
        detail: `${formatNumber(validated.length)} validated actions with proof. ${formatNumber(pendingValidation.length)} pending published JSON recheck${pendingValidation.length === 1 ? "" : "s"}.`,
        badge: pendingValidation.length ? "pending" : "proof"
      },
      {
        title: "Agent Queue",
        detail: runQueue.length
          ? `${formatNumber(runQueue.length)} admin-queued job${runQueue.length === 1 ? "" : "s"} ready for Run Agent Cycle.`
          : "No admin-queued jobs waiting.",
        badge: runQueue.length ? "queued" : "clear"
      },
      {
        title: "Attention",
        detail: critical.length
          ? `${formatNumber(critical.length)} critical audit item${critical.length === 1 ? "" : "s"} active.`
          : latestFailure ? `${latestFailure.title}: ${latestFailure.detail || latestFailure.status}` : "No critical audit items or failed agent actions logged.",
        badge: critical.length ? "critical" : latestFailure ? latestFailure.status || "review" : "clear"
      },
      {
        title: "Recommended Next",
        detail: nextRecommendation,
        badge: pending.length || blocked.length ? "admin" : "agent"
      }
    ];

    els.runSummaryList.innerHTML = cards.map(card => `
      <div class="run-summary-card">
        <div>
          <strong>${escapeHtml(card.title)}</strong>
          <span>${escapeHtml(card.detail)}</span>
        </div>
        <em>${escapeHtml(card.badge)}</em>
      </div>
    `).join("");
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
    if (!audit) {
      els.dataHealthStats.innerHTML = `
        <div class="metric-row">
          <span>Audit status</span>
          <strong>Loading</strong>
        </div>
      `;
      return;
    }

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
    if (!state.audit) {
      els.edgeSignals.innerHTML = `
        <div class="signal-row">
          <strong>Loading Early Edge data</strong>
          <span>Signals will appear after the audit finishes.</span>
        </div>
      `;
      return;
    }

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

  function setLauncherState(button, stateName, label) {
    if (!button) return;
    button.classList.remove("launcher-running", "launcher-success", "launcher-failed");
    if (stateName) button.classList.add(`launcher-${stateName}`);
    button.setAttribute("data-launcher-state", stateName || "");
    if (label) button.setAttribute("data-launcher-label", label);
    else button.removeAttribute("data-launcher-label");
  }

  async function runLauncher(button, work, labels) {
    labels = Object.assign({
      running: "Running",
      success: "Done",
      failed: "Issue"
    }, labels || {});

    setLauncherState(button, "running", labels.running);
    try {
      const result = await Promise.resolve(work());
      const ok = !result || result.ok !== false;
      setLauncherState(button, ok ? "success" : "failed", ok ? labels.success : labels.failed);
      setTimeout(() => setLauncherState(button, "", ""), ok ? 4200 : 7000);
      return result;
    } catch (err) {
      setLauncherState(button, "failed", labels.failed);
      setTimeout(() => setLauncherState(button, "", ""), 7000);
      throw err;
    }
  }

  els.refreshBtn.addEventListener("click", () => runLauncher(els.refreshBtn, runAudit, { running: "Auditing", success: "Audit done" }));
  els.syncPrvJsonBtn.addEventListener("click", () => runLauncher(els.syncPrvJsonBtn, syncPrvJsonOnDemand, { running: "Syncing", success: "Synced" }));
  if (els.publicToolAuditBtn) els.publicToolAuditBtn.addEventListener("click", () => runLauncher(els.publicToolAuditBtn, runPublicToolAudit, { running: "Testing", success: "Passed" }));
  if (els.publicToolAuditPanelBtn) els.publicToolAuditPanelBtn.addEventListener("click", () => runLauncher(els.publicToolAuditPanelBtn, runPublicToolAudit, { running: "Testing", success: "Passed" }));
  if (els.sentinelSelfTestBtn) els.sentinelSelfTestBtn.addEventListener("click", () => runLauncher(els.sentinelSelfTestBtn, runSentinelSelfTest, { running: "Testing", success: "Passed" }));
  if (els.sentinelCommandBtn) {
    els.sentinelCommandBtn.addEventListener("click", () => runSentinelCommand(els.sentinelCommandInput && els.sentinelCommandInput.value || ""));
  }
  if (els.sentinelCommandInput) {
    els.sentinelCommandInput.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        runSentinelCommand(els.sentinelCommandInput.value || "");
      }
    });
  }
  document.querySelectorAll("[data-sentinel-click]").forEach(btn => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.sentinelClick || "";
      if (action === "syncPrv") runLauncher(btn, syncPrvJsonOnDemand, { running: "Syncing", success: "Synced" });
      else if (action === "audit") runLauncher(btn, runAudit, { running: "Auditing", success: "Audit done" });
      else if (action === "checklists") runLauncher(btn, runDeepBackendAuditWithBackend, { running: "Auditing", success: "Audit done" });
      else if (action === "prv") runLauncher(btn, runPrvSourceWatchWithBackend, { running: "Scanning", success: "Scan done" });
      else if (action === "agent") runLauncher(btn, runAgentCycle, { running: "Working", success: "Cycle done" });
    });
  });
  els.scanSourcesBtn.addEventListener("click", () => runLauncher(els.scanSourcesBtn, () => runSourceWatchWithBackend("quick_json"), { running: "Scanning", success: "Scan done" }));
  els.scanPrvSourcesBtn.addEventListener("click", () => runLauncher(els.scanPrvSourcesBtn, runPrvSourceWatchWithBackend, { running: "Scanning", success: "Scan done" }));
  els.agentCycleBtn.addEventListener("click", () => runLauncher(els.agentCycleBtn, runAgentCycle, { running: "Working", success: "Cycle done" }));
  if (els.backendAgentSweepBtn) els.backendAgentSweepBtn.addEventListener("click", () => runLauncher(els.backendAgentSweepBtn, runBackendAgentSweep, { running: "Sweeping", success: "Sweep done" }));
  if (els.installDailyAgentTriggerBtn) els.installDailyAgentTriggerBtn.addEventListener("click", () => runLauncher(els.installDailyAgentTriggerBtn, installDailyAgentSweepTrigger, { running: "Installing", success: "Trigger ready" }));
  els.clearDoneBtn.addEventListener("click", clearDoneTasks);
  els.clearResolvedAgentActionsBtn.addEventListener("click", clearResolvedAgentActions);
  els.clearActivityLogBtn.addEventListener("click", clearActivityLog);
  els.exportMemoryBtn.addEventListener("click", exportAgentMemory);
  els.importMemoryInput.addEventListener("change", event => {
    importAgentMemoryFile(event.target.files && event.target.files[0]);
  });
  els.saveBackendMemoryBtn.addEventListener("click", saveBackendAgentMemory);
  els.loadBackendMemoryBtn.addEventListener("click", loadBackendAgentMemory);
  els.clearSourceIgnoresBtn.addEventListener("click", clearSourceIgnores);
  els.clearMemoryBtn.addEventListener("click", clearLocalAgentMemory);
  els.autonomyModeSelect.addEventListener("change", () => {
    writeAutonomyMode(els.autonomyModeSelect.value || "approval_required");
    els.autonomyState.textContent = getAutonomyLabel(state.autonomyMode);
    logActivity({
      type: "autonomy",
      status: state.autonomyMode,
      source: "admin",
      title: "Autonomy mode changed",
      detail: `Mode set to ${getAutonomyLabel(state.autonomyMode)}.`
    });
    renderActivityLog();
  });
  els.sourceCheckBtn.addEventListener("click", validateSourceProductWithBackend);
  els.sourceWatchQuickBtn.addEventListener("click", () => runLauncher(els.sourceWatchQuickBtn, () => runSourceWatchWithBackend("quick_json"), { running: "Scanning", success: "Scan done" }));
  els.sourceWatchDeepBtn.addEventListener("click", () => runLauncher(els.sourceWatchDeepBtn, runDeepBackendAuditWithBackend, { running: "Auditing", success: "Audit done" }));
  els.prvSourceWatchBtn.addEventListener("click", () => runLauncher(els.prvSourceWatchBtn, runPrvSourceWatchWithBackend, { running: "Scanning", success: "Scan done" }));
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
  els.autonomyModeSelect.value = state.autonomyMode;
  els.autonomyState.textContent = getAutonomyLabel(state.autonomyMode);
  els.typeFilter.addEventListener("change", renderOpportunities);
  render();
  autoLoadBackendAgentMemoryIfEmpty();
  setTimeout(runAudit, 250);
})();
