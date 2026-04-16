window.CMChat = window.CMChat || {};
window.CMChat.ui = window.CMChat.ui || {};

(function(ns, utils) {
  const {
    escapeHtml,
    formatReleaseDate
  } = utils;

  let submitHandler = null;
  let latestResultCardId = null;

  function setSubmitHandler(fn) {
    submitHandler = typeof fn === "function" ? fn : null;
  }

  function getChatApp() {
    return document.querySelector(".chat-app");
  }

  function getChatMessages() {
    return document.getElementById("chatMessages");
  }

  function getExamplePills() {
    return document.getElementById("examplePills");
  }

  function getJumpNav() {
    return document.getElementById("chatJumpNav");
  }

  function getJumpBtn() {
    return document.getElementById("chatJumpBtn");
  }

  function getJumpBtnIcon() {
    return document.getElementById("chatJumpBtnIcon");
  }

  function runSubmit(value) {
    if (submitHandler) submitHandler(value);
  }

  function renderExamples(examples) {
    const examplePills = getExamplePills();
    if (!examplePills) return;

    if (!examples || !examples.length) {
      examplePills.innerHTML = "";
      examplePills.style.display = "none";
      return;
    }

    examplePills.style.display = "";
    examplePills.innerHTML = examples.map(e =>
      `<button class="example-pill" data-example="${escapeHtml(e)}">${escapeHtml(e)}</button>`
    ).join("");

    examplePills.querySelectorAll("[data-example]").forEach(btn => {
      btn.onclick = () => runSubmit(btn.dataset.example);
    });
  }

  function addUserMessage(text) {
    const chatMessages = getChatMessages();
    if (!chatMessages) return;

    chatMessages.innerHTML += `
      <div class="message-row user">
        <div class="message-bubble">${escapeHtml(text)}</div>
      </div>
    `;
    scrollToBottom();
  }

  function scrollToBottom() {
    const chatMessages = getChatMessages();
    if (!chatMessages) return;
    chatMessages.scrollTop = chatMessages.scrollHeight;
    updateJumpNav();
  }

  function scrollNewCardToTop(element) {
    const chatMessages = getChatMessages();
    if (!chatMessages) return;

    if (!element) {
      scrollToBottom();
      return;
    }

    requestAnimationFrame(() => {
      const targetTop = Math.max(0, element.offsetTop - 8);
      chatMessages.scrollTo({
        top: targetTop,
        behavior: "smooth"
      });

      setTimeout(updateJumpNav, 180);
    });
  }

  function setLatestResultCard(element) {
    if (!element) return;

    const chatMessages = getChatMessages();
    if (!chatMessages) return;

    const prev = chatMessages.querySelector("[data-latest-result='1']");
    if (prev) prev.removeAttribute("data-latest-result");

    element.setAttribute("data-latest-result", "1");
    latestResultCardId = element.id || null;

    updateJumpNav();
  }

  function getLatestResultCard() {
    if (latestResultCardId) {
      const byId = document.getElementById(latestResultCardId);
      if (byId) return byId;
    }

    const chatMessages = getChatMessages();
    if (!chatMessages) return null;

    return chatMessages.querySelector("[data-latest-result='1']");
  }

  function scrollLatestResultToTop() {
    const chatMessages = getChatMessages();
    const card = getLatestResultCard();
    if (!chatMessages || !card) return;

    const top = Math.max(0, card.offsetTop - 8);
    chatMessages.scrollTo({
      top,
      behavior: "smooth"
    });

    setTimeout(updateJumpNav, 350);
  }

  function scrollLatestResultToBottom() {
    const chatMessages = getChatMessages();
    const card = getLatestResultCard();
    if (!chatMessages || !card) return;

    const bottomTarget = Math.max(
      0,
      card.offsetTop + card.offsetHeight - chatMessages.clientHeight + 8
    );

    chatMessages.scrollTo({
      top: bottomTarget,
      behavior: "smooth"
    });

    setTimeout(updateJumpNav, 220);
  }

  function updateJumpNav() {
    const chatMessages = getChatMessages();
    const nav = getJumpNav();
    const btn = getJumpBtn();
    const icon = getJumpBtnIcon();
    const card = getLatestResultCard();

    if (!chatMessages || !nav || !btn || !icon || !card) {
      if (nav) nav.classList.add("is-hidden");
      return;
    }

    const viewTop = chatMessages.scrollTop;
    const viewBottom = viewTop + chatMessages.clientHeight;
    const cardTop = card.offsetTop;
    const cardBottom = cardTop + card.offsetHeight;
    const cardHeight = card.offsetHeight;

    if (cardHeight <= chatMessages.clientHeight - 32) {
      nav.classList.add("is-hidden");
      btn.dataset.direction = "";
      btn.setAttribute("aria-label", "Jump within latest result");
      return;
    }

    const nearBottom = viewBottom >= cardBottom - 28;
    const nearTop = viewTop <= cardTop + 28;

    nav.classList.remove("is-hidden");

    if (nearBottom && !nearTop) {
      icon.textContent = "↑";
      btn.dataset.direction = "up";
      btn.setAttribute("aria-label", "Jump to top of latest result");
    } else {
      icon.textContent = "↓";
      btn.dataset.direction = "down";
      btn.setAttribute("aria-label", "Jump to bottom of latest result");
    }
  }

  function initJumpNav() {
    const chatMessages = getChatMessages();
    const btn = getJumpBtn();

    if (chatMessages) {
      chatMessages.addEventListener("scroll", updateJumpNav, { passive: true });
    }

    if (btn) {
      btn.addEventListener("click", () => {
        const direction = btn.dataset.direction || "down";
        if (direction === "up") {
          scrollLatestResultToTop();
        } else {
          scrollLatestResultToBottom();
        }
      });
    }

    updateJumpNav();
  }

  function addStandardAnswerCard(r) {
    const chatMessages = getChatMessages();
    if (!chatMessages) return;

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

    const card = document.getElementById(cardId);
    setLatestResultCard(card);
    bindFollowups();
    scrollNewCardToTop(card);
  }

  function addPlayerStatsCard(r) {
    const chatMessages = getChatMessages();
    if (!chatMessages) return;

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

    const card = document.getElementById(cardId);
    setLatestResultCard(card);
    bindFollowups();
    scrollNewCardToTop(card);
  }

  function addWelcomeMessage(force = false) {
    const chatMessages = getChatMessages();
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
    const chatMessages = getChatMessages();
    if (!chatMessages) {
      return { remove() {} };
    }

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
    const chatMessages = getChatMessages();
    if (!chatMessages) return;

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

          updateJumpNav();
        };
      }
    }

    setLatestResultCard(card);
    bindFollowups();
    scrollNewCardToTop(card);
  }

  function addChecklistResultCard(result) {
    const chatMessages = getChatMessages();
    if (!chatMessages) return;

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
    setLatestResultCard(card);
    bindFollowups();
    scrollNewCardToTop(card);
  }

  function addReleaseScheduleCard(result) {
    const chatMessages = getChatMessages();
    if (!chatMessages) return;

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
    setLatestResultCard(card);
    bindFollowups();
    scrollNewCardToTop(card);
  }

  function bindFollowups() {
    const chatMessages = getChatMessages();
    if (!chatMessages) return;

    chatMessages.querySelectorAll("[data-followup]").forEach(btn => {
      btn.onclick = () => runSubmit(btn.dataset.followup);
    });
  }

  ns.setSubmitHandler = setSubmitHandler;
  ns.renderExamples = renderExamples;
  ns.addUserMessage = addUserMessage;
  ns.scrollToBottom = scrollToBottom;
  ns.scrollNewCardToTop = scrollNewCardToTop;
  ns.addStandardAnswerCard = addStandardAnswerCard;
  ns.addPlayerStatsCard = addPlayerStatsCard;
  ns.addWelcomeMessage = addWelcomeMessage;
  ns.startLoadingBubble = startLoadingBubble;
  ns.getMoreButtonLabel = getMoreButtonLabel;
  ns.addPrvResultCard = addPrvResultCard;
  ns.addChecklistResultCard = addChecklistResultCard;
  ns.addReleaseScheduleCard = addReleaseScheduleCard;
  ns.bindFollowups = bindFollowups;
  ns.initJumpNav = initJumpNav;
  ns.updateJumpNav = updateJumpNav;
})(window.CMChat.ui, window.CMChat.utils);
