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

/* ------------------ UTIL ------------------ */

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
    .replace(/>/g, "&gt;");
}

function includesAny(haystack, needles) {
  return needles.some((n) => haystack.includes(normalize(n)));
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
  chatMessages.innerHTML += `<div class="message-row user"><div class="message-bubble">${escapeHtml(text)}</div></div>`;
  scroll();
}

function addAssistantBubble(text) {
  chatMessages.innerHTML += `<div class="message-row assistant"><div class="message-bubble">${escapeHtml(text)}</div></div>`;
  scroll();
}

function addAnswerCard(r) {
  chatMessages.innerHTML += `
    <div class="message-row assistant">
      <div class="answer-card">
        <div class="answer-badge">${r.badge}</div>
        <div class="answer-title">${escapeHtml(r.title)}</div>
        <div class="answer-summary">${escapeHtml(r.summary)}</div>
        ${(r.metadata||[]).map(m=>`<div class="answer-meta-chip">${m}</div>`).join("")}
      </div>
    </div>`;
  scroll();
}

function scroll() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

/* ------------------ CACHE ------------------ */

function getCached(key, tsKey) {
  try {
    const raw = localStorage.getItem(key);
    const ts = +localStorage.getItem(tsKey);
    if (!raw || !ts || Date.now()-ts > INDEX_TTL_MS) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function setCached(key, tsKey, val) {
  localStorage.setItem(key, JSON.stringify(val));
  localStorage.setItem(tsKey, Date.now());
}

/* ------------------ API ------------------ */

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {"Content-Type":"text/plain"},
    body: JSON.stringify(body)
  });
  return res.json();
}

async function getPrintRunData(code, sport) {
  try {
    const data = await postJson(VAULT_EXEC_URL, {
      action: "getRowsByCode",
      payload: { code, sport }
    });
    return data?.rows || [];
  } catch {
    return [];
  }
}

/* ------------------ INDEX LOAD ------------------ */

async function loadChecklistIndex() {
  const cached = getCached(CL_INDEX_KEY, CL_INDEX_TS_KEY);
  if (cached) return checklistIndex = cached;

  const data = await postJson(CHECKLIST_EXEC_URL, {action:"index"});
  return checklistIndex = data.index || [];
}

async function loadPrintRunIndex() {
  const cached = getCached(PRV_INDEX_KEY, PRV_INDEX_TS_KEY);
  if (cached) return printRunIndex = cached;

  const data = await postJson(VAULT_EXEC_URL, {action:"index"});
  return printRunIndex = data.index || data.products || [];
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

/* ------------------ MATCHING ------------------ */

function findProduct(list, query) {
  const nq = normalize(query);
  let best, score=0;

  list.forEach(item=>{
    const name = item.DisplayName || item.displayName || "";
    const hay = normalize(name + " " + (item.Keywords||""));
    let s = 0;
    if (nq.includes(normalize(name))) s+=10;
    if (hay.includes(nq)) s+=3;

    if (s>score) {
      score=s;
      best={
        name,
        sport:item.sport,
        year:item.year,
        code:item.Code||item.code
      };
    }
  });

  return best;
}

/* ------------------ INTENT ------------------ */

function detectIntent(q) {
  q = normalize(q);
  if (q.includes("print run")) return "print_run";
  if (q.includes("checklist")) return "checklist";
  if (q.includes("trending")) return "trending";
  if (q.includes("player")) return "player";
  return "search";
}

/* ------------------ RESPONSE ------------------ */

async function buildResponse(query) {
  const intent = detectIntent(query);

  const cl = findProduct(checklistIndex, query);
  const prv = findProduct(printRunIndex, query);

  /* PRINT RUN */
  if (intent==="print_run" && prv) {
    const rows = await getPrintRunData(prv.code, prv.sport);

    if (rows.length) {
      const preview = rows.slice(0,5)
        .map(r => `${r.setType||""} ${r.setLine||""}: ${r.printRun} copies`)
        .join(" • ");

      return {
        badge:"Print Run",
        title:prv.name,
        summary:preview,
        metadata:[`Rows: ${rows.length}`]
      };
    }

    return {
      badge:"Print Run",
      title:prv.name,
      summary:"No print run rows found yet"
    };
  }

  /* CHECKLIST */
  if ((intent==="checklist"||intent==="search") && cl) {
    return {
      badge:"Checklist",
      title:cl.name,
      summary:"Checklist found. Open in vault for full details."
    };
  }

  /* FALLBACK */
  return {
    badge:"Try",
    title:"Try another search",
    summary:"Ask for a print run, checklist, or player."
  };
}

/* ------------------ MAIN ------------------ */

async function submitQuery(text) {
  const val = text || chatInput.value.trim();
  if (!val) return;

  addUserMessage(val);
  chatInput.value="";

  addAssistantBubble("Thinking...");

  await bootstrapData();

  const res = await buildResponse(val);

  chatMessages.lastChild.remove();
  addAssistantBubble("Here’s what I found.");
  addAnswerCard(res);
}

/* ------------------ INIT ------------------ */

sendBtn.onclick = ()=>submitQuery();
chatInput.onkeydown = e=>{ if(e.key==="Enter") submitQuery(); };

renderExamples();
bootstrapData();
chatInput.focus();
