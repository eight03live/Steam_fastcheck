(() => {
  "use strict";

  const PATCH_KEY = "__steamFastCheckSteamDbPopularSourcePatch";
  const PATCH_VERSION = "1.0.0";
  const MAX_RESULTS = 100;

  if (window[PATCH_KEY]?.version === PATCH_VERSION) {
    return;
  }

  function readPeriodFromUrl() {
    const url = new URL(window.location.href);
    const yearMatch = url.pathname.match(/^\/stats\/gameratings\/(\d{4})\/?$/);
    const minRelease = url.searchParams.get("min_release") || "";
    const maxRelease = url.searchParams.get("max_release") || "";
    const minMatch = minRelease.match(/^(\d{4})-(\d{2})-01$/);
    const maxMatch = maxRelease.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (
      !yearMatch ||
      !minMatch ||
      !maxMatch ||
      url.searchParams.get("displayOnly") !== "Game" ||
      url.searchParams.get("sort") !== "followers_desc"
    ) {
      return null;
    }

    const year = Number(yearMatch[1]);
    const month = Number(minMatch[2]);
    const expectedLastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (
      Number(minMatch[1]) !== year ||
      Number(maxMatch[1]) !== year ||
      Number(maxMatch[2]) !== month ||
      Number(maxMatch[3]) !== expectedLastDay
    ) {
      return null;
    }

    return { year, month, sourceUrl: url.toString() };
  }

  function collectAppIds() {
    const appIds = [];
    const seen = new Set();
    for (const row of document.querySelectorAll("table tbody tr.app")) {
      const appId = String(row.dataset.appid || "");
      if (!/^\d+$/.test(appId) || seen.has(appId)) {
        continue;
      }
      seen.add(appId);
      appIds.push(appId);
      if (appIds.length >= MAX_RESULTS) {
        break;
      }
    }
    return appIds;
  }

  const period = readPeriodFromUrl();
  let observer = null;
  let sent = false;
  let challengeReported = false;

  async function sendVisibleList() {
    if (!period || sent) {
      return false;
    }
    const appIds = collectAppIds();
    if (appIds.length === 0) {
      return false;
    }

    sent = true;
    try {
      const response = await chrome.runtime.sendMessage({
        type: "steam-fast-check-steamdb-ingest-games",
        ...period,
        appIds
      });
      if (!response?.ok) {
        sent = false;
        return false;
      }
      observer?.disconnect();
      return true;
    } catch {
      sent = false;
      return false;
    }
  }

  async function reportBrowserCheck() {
    if (!period || sent || challengeReported) {
      return;
    }
    const pageText = `${document.title || ""}\n${document.body?.innerText || ""}`;
    if (!/Checking your browser|Performing security verification|Verify you are human/i.test(pageText)) {
      return;
    }
    challengeReported = true;
    try {
      await chrome.runtime.sendMessage({
        type: "steam-fast-check-steamdb-source-status",
        ...period,
        code: "steamdb-browser-check"
      });
    } catch {
      challengeReported = false;
    }
  }

  if (period) {
    observer = new MutationObserver(() => {
      sendVisibleList();
      reportBrowserCheck();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    sendVisibleList();
    reportBrowserCheck();
  }

  window[PATCH_KEY] = {
    version: PATCH_VERSION,
    observer,
    retry: sendVisibleList
  };
})();
