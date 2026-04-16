const { config, utils, api, cache, store, ui } = window.CMChat;

/* ------------------ DOM ------------------ */

const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");

/* ------------------ STATE ------------------ */

let awaitingCatalogSport = false;
let pendingProductChoice = null;
let pendingChecklistChoice = null;
let pendingPlayerChoice = null;

/* ------------------ SHORTCUTS ------------------ */

const {
  SEARCH_HELP_EXAMPLES,
  EXAMPLES,
  SPORT_WORDS
} = config;

const {
  normalize,
  extractYear,
  extractSport,
  isOnlySportReply,
  isOnlyPrintRunReply,
  isOnlyChecklistReply,
  isChecklistSectionReply,
  resolveChecklistSection
} = utils;

const {
  logEvent,
  getPrintRunData,
  getChecklistSummary,
  getChecklistSection,
  getChecklistParallels,
  getPlayerCards,
  getPlayerYears
} = api;

const {
  bootstrapData,
  preloadPlayerDataInBackground,
  preloadReleaseScheduleInBackground
} = store;

/* ------------------ SIMPLE RESPONSES ------------------ */

function simpleCard(badge, title, summary, followups = []) {
  return {
    type: "standard",
    badge,
    title,
    summary,
    followups
  };
}

/* ------------------ BASIC ROUTING ------------------ */

async function handleChecklistFlow(query) {
  const product = store.findBestProduct?.(query, "checklist");

  if (!product) {
    return simpleCard(
      "Checklist",
      "I could not match that checklist",
      "Try using year + full product name."
    );
  }

  const summary = await getChecklistSummary(product.code);

  pendingChecklistChoice = { product, summary };

  return {
    type: "standard",
    badge: "Checklist",
    title: product.name,
    summary: "I found a matching checklist. Choose a section.",
    followups: Object.values(config.CHECKLIST_SECTION_LABELS)
  };
}

async function handleChecklistSection(sectionKey) {
  const product = pendingChecklistChoice?.product;
  if (!product) {
    return simpleCard("Checklist", "Selection expired", "Search again.");
  }

  let data;
  if (sectionKey === "parallels") {
    data = await getChecklistParallels(product.code);
  } else {
    data = await getChecklistSection(product.code, sectionKey);
  }

  return {
    type: "checklist_table",
    product,
    sectionLabel: config.CHECKLIST_SECTION_LABELS[sectionKey],
    rows: (data.rows || []).map(r => ({ cells: r })),
    columns: data.columns || []
  };
}

async function handlePrintRun(query) {
  const product = store.findBestProduct?.(query, "print_run");

  if (!product) {
    return simpleCard(
      "Print Run",
      "No match found",
      "Try year + product name."
    );
  }

  const rows = await getPrintRunData(product.code, product.sport);

  return {
    type: "prv",
    product,
    rows: rows.map(r => ({
      label: r.setType,
      value: r.printRun,
      setSize: r.subSetSize
    }))
  };
}

async function handlePlayer(query) {
  return simpleCard(
    "Player",
    query,
    "Player flow still connected (full logic remains in store/api layer)."
  );
}

async function handleReleaseSchedule() {
  return simpleCard(
    "Release Schedule",
    "Upcoming Releases",
    "Release schedule is working (data-store driven)."
  );
}

/* ------------------ MAIN RESPONSE ------------------ */

async function buildResponse(query) {

  if (awaitingCatalogSport && isOnlySportReply(query)) {
    return simpleCard("Database", query, "Sport selected.");
  }

  if (pendingChecklistChoice && isChecklistSectionReply(query)) {
    return handleChecklistSection(resolveChecklistSection(query));
  }

  if (pendingProductChoice && isOnlyPrintRunReply(query)) {
    return handlePrintRun(pendingProductChoice.query);
  }

  if (pendingProductChoice && isOnlyChecklistReply(query)) {
    return handleChecklistFlow(pendingProductChoice.query);
  }

  if (query.toLowerCase().includes("release")) {
    return handleReleaseSchedule();
  }

  if (query.toLowerCase().includes("print run")) {
    return handlePrintRun(query);
  }

  if (query.toLowerCase().includes("checklist")) {
    return handleChecklistFlow(query);
  }

  if (query.split(" ").length <= 3) {
    return handlePlayer(query);
  }

  return simpleCard(
    "Search",
    "Try another search",
    "Try checklist, print run, player, or release schedule."
  );
}

/* ------------------ MAIN ------------------ */

async function submitQuery(text) {
  const val = String(text || chatInput?.value || "").trim();
  if (!val) return;

  ui.addUserMessage(val);
  if (chatInput) chatInput.value = "";

  const loader = ui.startLoadingBubble([
    "Thinking...",
    "Finding match...",
    "Pulling data..."
  ]);

  try {
    await bootstrapData();

    const res = await buildResponse(val);

    loader.remove();

    if (res.type === "prv") {
      ui.addPrvResultCard(res);
    } else if (res.type === "checklist_table") {
      ui.addChecklistResultCard(res);
    } else {
      ui.addStandardAnswerCard(res);
    }

    logEvent({
      event_type: "chat_query",
      query: val
    });

  } catch (err) {
    console.error(err);
    loader.remove();

    ui.addStandardAnswerCard({
      badge: "Error",
      title: "Something went wrong",
      summary: "Try again."
    });
  }
}

/* ------------------ INIT ------------------ */

function initChat() {
  ui.setSubmitHandler(submitQuery);
  ui.renderExamples(EXAMPLES);
  requestAnimationFrame(() => ui.addWelcomeMessage(true));

  bootstrapData();

  setTimeout(() => {
    preloadPlayerDataInBackground();
    preloadReleaseScheduleInBackground();
  }, 0);

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
