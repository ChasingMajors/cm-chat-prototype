window.CMChat = window.CMChat || {};
window.CMChat.api = window.CMChat.api || {};

(function(ns, config, cache, utils) {
  async function postJson(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      cache: "no-store",
      body: JSON.stringify(body || {})
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function logEvent(payload) {
    try {
      await postJson(config.LOG_EXEC_URL, {
        action: "logEvent",
        payload: payload || {}
      });
    } catch (err) {
      console.warn("Log failed", err);
    }
  }

  async function getPrintRunData(code, sport) {
    const key = utils.makeKey(code, sport);
    if (cache.memCache.printRunRows.has(key)) return cache.memCache.printRunRows.get(key);

    try {
      const data = await postJson(config.VAULT_EXEC_URL, {
        action: "getRowsByCode",
        payload: { code, sport }
      });
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      cache.memCache.printRunRows.set(key, rows);
      return rows;
    } catch (err) {
      console.warn("getPrintRunData failed", err);
      return [];
    }
  }

  async function getHomeFeed() {
    if (Array.isArray(cache.memCache.homeFeed)) return cache.memCache.homeFeed;

    try {
      const res = await fetch(`${config.LOG_EXEC_URL}?action=getHomeFeed`, { cache: "no-store" });
      const data = await res.json();
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      cache.memCache.homeFeed = rows;
      return rows;
    } catch (err) {
      console.warn("getHomeFeed failed", err);
      return [];
    }
  }

  async function getChecklistSummary(code) {
    if (cache.memCache.checklistSummary.has(code)) return cache.memCache.checklistSummary.get(code);
    const data = await postJson(config.CHECKLIST_EXEC_URL, { action: "checklist_summary", code });
    const out = data || {};
    cache.memCache.checklistSummary.set(code, out);
    return out;
  }

  async function getChecklistSection(code, section) {
    const key = utils.makeKey(code, section);
    if (cache.memCache.checklistSection.has(key)) return cache.memCache.checklistSection.get(key);
    const data = await postJson(config.CHECKLIST_EXEC_URL, { action: "checklist_section", code, section });
    const out = data || {};
    cache.memCache.checklistSection.set(key, out);
    return out;
  }

  async function getChecklistParallels(code) {
    if (cache.memCache.checklistParallels.has(code)) return cache.memCache.checklistParallels.get(code);
    const data = await postJson(config.CHECKLIST_EXEC_URL, { action: "parallels", code });
    const out = data || {};
    cache.memCache.checklistParallels.set(code, out);
    return out;
  }

  async function getPlayerCards(playerQuery, sport, year = "", code = "") {
    const key = utils.makeKey(utils.normalize(playerQuery), sport || "baseball", year, code);
    if (cache.memCache.playerCards.has(key)) return cache.memCache.playerCards.get(key);

    const data = await postJson(config.CHECKLIST_EXEC_URL, {
      action: "player_cards",
      player_query: playerQuery,
      sport: sport || "baseball",
      year: year || "",
      code: code || ""
    });

    const out = data || {};
    cache.memCache.playerCards.set(key, out);
    return out;
  }

  async function getPlayerYears(playerQuery, sport = "baseball") {
    const key = utils.makeKey(utils.normalize(playerQuery), sport);
    if (cache.memCache.playerYears.has(key)) return cache.memCache.playerYears.get(key);

    const data = await postJson(config.CHECKLIST_EXEC_URL, {
      action: "player_years",
      player_query: playerQuery,
      sport
    });

    const years = Array.isArray(data?.years) ? data.years : [];
    cache.memCache.playerYears.set(key, years);
    return years;
  }

  async function getReleaseSchedule() {
    if (Array.isArray(cache.memCache.releaseSchedule)) return cache.memCache.releaseSchedule;

    try {
      const res = await fetch(`${config.RELEASE_SCHEDULE_EXEC_URL}?action=release_schedule`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      cache.memCache.releaseSchedule = rows;
      return rows;
    } catch (err) {
      console.warn("getReleaseSchedule failed", err);
      return [];
    }
  }

  ns.postJson = postJson;
  ns.logEvent = logEvent;
  ns.getPrintRunData = getPrintRunData;
  ns.getHomeFeed = getHomeFeed;
  ns.getChecklistSummary = getChecklistSummary;
  ns.getChecklistSection = getChecklistSection;
  ns.getChecklistParallels = getChecklistParallels;
  ns.getPlayerCards = getPlayerCards;
  ns.getPlayerYears = getPlayerYears;
  ns.getReleaseSchedule = getReleaseSchedule;
})(window.CMChat.api, window.CMChat.config, window.CMChat.cache, window.CMChat.utils);
