const SCHEDULE_EXEC_URL = "https://script.google.com/macros/s/AKfycbzWRkmn2xhvsaqvlMxx4AJmqvpyDTR6wKmd9rvpr4ttzXOkH9vH4qPxk59YlEHVMInlHw/exec";

const SCHEDULE_CACHE_KEY = "cm_release_schedule_v1";
const SCHEDULE_CACHE_TS_KEY = "cm_release_schedule_ts_v1";
const SCHEDULE_CACHE_TTL_MS = 1000 * 60 * 15;

const scheduleSearch = document.getElementById("scheduleSearch");
const sportFilter = document.getElementById("sportFilter");
const statusFilter = document.getElementById("statusFilter");
const clearFiltersBtn = document.getElementById("clearFiltersBtn");
const scheduleResults = document.getElementById("scheduleResults");
const scheduleCount = document.getElementById("scheduleCount");
const scheduleLoading = document.getElementById("scheduleLoading");
const scheduleEmpty = document.getElementById("scheduleEmpty");

let allScheduleRows = [];
let filteredScheduleRows = [];
let scheduleBootPromise = null;
let searchDebounce = null;

/* ------------------ UTIL ------------------ */

function safeString(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function normalize(text) {
  return safeString(text)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\w\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(str) {
  return safeString(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatDateDisplay(yyyyMmDd) {
  const raw = safeString(yyyyMmDd).trim();
  if (!raw) return "";

  const parts = raw.split("-");
  if (parts.length !== 3) return raw;

  const year = Number(parts[0]);
  const month = Number(parts[1]) - 1;
  const day = Number(parts[2]);

  const dt = new Date(year, month, day);
  if (Number.isNaN(dt.getTime())) return raw;

  return dt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function compareReleaseDates(a, b) {
  const aDate = safeString(a.releaseDate);
  const bDate = safeString(b.releaseDate);

  if (aDate && bDate && aDate !== bDate) return aDate.localeCompare(bDate);

  const aName = safeString(a.setName || a.product);
  const bName = safeString(b.setName || b.product);
  return aName.localeCompare(bName);
}

function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function getCachedWithTtl(key, tsKey, ttlMs) {
  try {
    const raw = localStorage.getItem(key);
    const ts = Number(localStorage.getItem(tsKey));
    if (!raw || !ts || Date.now() - ts > ttlMs) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setCachedWithTtl(key, tsKey, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    localStorage.setItem(tsKey, String(Date.now()));
  } catch (err) {
    console.warn("Schedule cache write failed", err);
  }
}

function showLoading(isLoading) {
  if (scheduleLoading) {
    scheduleLoading.style.display = isLoading ? "" : "none";
  }
}

function showEmpty(show) {
  if (scheduleEmpty) {
    scheduleEmpty.style.display = show ? "" : "none";
  }
}

function updateCount(count) {
  if (!scheduleCount) return;

  if (!count) {
    scheduleCount.textContent = "0 releases";
    return;
  }

  scheduleCount.textContent = `${count.toLocaleString("en-US")} release${count === 1 ? "" : "s"}`;
}

function setResultsHtml(html) {
  if (!scheduleResults) return;
  scheduleResults.innerHTML = html;
}

/* ------------------ API ------------------ */

async function getReleaseScheduleFromApi() {
  const res = await fetch(`${SCHEDULE_EXEC_URL}?action=release_schedule`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  if (!data?.ok) throw new Error(data?.error || "Release schedule load failed");

  return Array.isArray(data.rows) ? data.rows : [];
}

async function loadReleaseSchedule() {
  const cached = getCachedWithTtl(
    SCHEDULE_CACHE_KEY,
    SCHEDULE_CACHE_TS_KEY,
    SCHEDULE_CACHE_TTL_MS
  );

  if (cached) {
    allScheduleRows = Array.isArray(cached) ? cached : [];
    return allScheduleRows;
  }

  const rows = await getReleaseScheduleFromApi();
  allScheduleRows = rows.slice().sort(compareReleaseDates);

  setCachedWithTtl(
    SCHEDULE_CACHE_KEY,
    SCHEDULE_CACHE_TS_KEY,
    allScheduleRows
  );

  return allScheduleRows;
}

/* ------------------ FILTERS ------------------ */

function getSearchValue() {
  return normalize(scheduleSearch?.value || "");
}

function getSportValue() {
  return normalize(sportFilter?.value || "");
}

function getStatusValue() {
  return normalize(statusFilter?.value || "");
}

function rowMatchesFilters(row) {
  const q = getSearchValue();
  const sport = getSportValue();
  const status = getStatusValue();

  if (sport && normalize(row.sport) !== sport) return false;
  if (status && normalize(row.status) !== status) return false;

  if (q) {
    const haystack = normalize([
      row.releaseDate,
      row.sport,
      row.manufacturer,
      row.product,
      row.setName,
      row.format,
      row.status
    ].join(" "));

    if (!haystack.includes(q)) return false;
  }

  return true;
}

function applyFilters() {
  filteredScheduleRows = allScheduleRows.filter(rowMatchesFilters);
  renderScheduleRows(filteredScheduleRows);
}

/* ------------------ RENDER ------------------ */

function buildSportOptions(rows) {
  const sports = uniq(rows.map(r => safeString(r.sport).trim())).sort((a, b) => a.localeCompare(b));
  return sports;
}

function buildStatusOptions(rows) {
  const statuses = uniq(rows.map(r => safeString(r.status).trim())).sort((a, b) => a.localeCompare(b));
  return statuses;
}

function populateFilterOptions() {
  if (sportFilter) {
    const current = sportFilter.value;
    const sports = buildSportOptions(allScheduleRows);

    sportFilter.innerHTML = [
      `<option value="">All Sports</option>`,
      ...sports.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
    ].join("");

    sportFilter.value = current || "";
  }

  if (statusFilter) {
    const current = statusFilter.value;
    const statuses = buildStatusOptions(allScheduleRows);

    statusFilter.innerHTML = [
      `<option value="">All Statuses</option>`,
      ...statuses.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
    ].join("");

    statusFilter.value = current || "";
  }
}

function renderScheduleRows(rows) {
  updateCount(rows.length);

  if (!rows.length) {
    setResultsHtml("");
    showEmpty(true);
    return;
  }

  showEmpty(false);

  const html = rows.map(row => {
    const releaseDate = formatDateDisplay(row.releaseDate);
    const setName = safeString(row.setName || row.product);
    const metaParts = [
      row.sport,
      row.manufacturer,
      row.format
    ].filter(Boolean);

    const statusClass = normalize(row.status) === "upcoming"
      ? "schedule-status upcoming"
      : "schedule-status released";

    return `
      <article class="schedule-card">
        <div class="schedule-card-top">
          <div class="schedule-date">${escapeHtml(releaseDate)}</div>
          <div class="${statusClass}">${escapeHtml(row.status || "")}</div>
        </div>

        <div class="schedule-title">${escapeHtml(setName)}</div>

        ${metaParts.length ? `
          <div class="schedule-meta">
            ${metaParts.map(part => `<span class="schedule-chip">${escapeHtml(part)}</span>`).join("")}
          </div>
        ` : ""}

        ${row.product && row.product !== row.setName ? `
          <div class="schedule-subtitle">${escapeHtml(row.product)}</div>
        ` : ""}

        <div class="schedule-actions">
          ${row.checklistUrl ? `
            <a class="schedule-btn" href="${escapeHtml(row.checklistUrl)}">Checklist</a>
          ` : ""}
          ${row.vaultUrl ? `
            <a class="schedule-btn schedule-btn-secondary" href="${escapeHtml(row.vaultUrl)}">Print Run</a>
          ` : ""}
        </div>
      </article>
    `;
  }).join("");

  setResultsHtml(html);
}

/* ------------------ EVENTS ------------------ */

function clearFilters() {
  if (scheduleSearch) scheduleSearch.value = "";
  if (sportFilter) sportFilter.value = "";
  if (statusFilter) statusFilter.value = "";
  applyFilters();
}

function bindEvents() {
  if (scheduleSearch) {
    scheduleSearch.addEventListener("input", () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        applyFilters();
      }, 120);
    });
  }

  if (sportFilter) {
    sportFilter.addEventListener("change", applyFilters);
  }

  if (statusFilter) {
    statusFilter.addEventListener("change", applyFilters);
  }

  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener("click", clearFilters);
  }
}

/* ------------------ INIT ------------------ */

async function initSchedulePage() {
  try {
    showLoading(true);
    showEmpty(false);

    if (!scheduleBootPromise) {
      scheduleBootPromise = loadReleaseSchedule();
    }

    await scheduleBootPromise;
    populateFilterOptions();
    applyFilters();
  } catch (err) {
    console.error("Release schedule init failed", err);

    updateCount(0);
    setResultsHtml(`
      <div class="schedule-error-card">
        <div class="schedule-error-title">Something went wrong</div>
        <div class="schedule-error-text">The release schedule could not load right now. Please try again.</div>
      </div>
    `);
    showEmpty(false);
  } finally {
    showLoading(false);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    initSchedulePage();
  });
} else {
  bindEvents();
  initSchedulePage();
}
