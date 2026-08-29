(() => {
  "use strict";

  const PATCH_KEY = "__steamFastCheckPopularGameHighlightsPatch";
  const PATCH_VERSION = "1.0.0";
  const ENABLED_STORAGE_KEY = "steamFastCheckPopularHighlightEnabled";
  const YEAR_STORAGE_KEY = "steamFastCheckPopularHighlightYear";
  const MONTH_STORAGE_KEY = "steamFastCheckPopularHighlightMonth";
  const DATA_REVISION_STORAGE_KEY = "steamFastCheckSteamDbPopularDataRevision";
  const POPULAR_TAG_EVENT = "steam-fast-check-popular-tags-changed";

  if (window[PATCH_KEY]?.version === PATCH_VERSION) {
    return;
  }

  const now = new Date();
  let enabled = false;
  let selectedYear = now.getFullYear();
  let selectedMonth = now.getMonth() + 1;
  let popularRanks = new Map();
  let requestRevision = 0;

  function applyPopularMetadata(row) {
    const rank = enabled ? popularRanks.get(row.dataset.dsAppid) : null;
    if (Number.isInteger(rank)) {
      row.dataset.steamFastCheckPopularRank = String(rank);
    } else {
      delete row.dataset.steamFastCheckPopularRank;
    }
  }

  function applyHighlightsWithin(root) {
    if (typeof root.matches === "function" && root.matches("a.search_result_row")) {
      applyPopularMetadata(root);
    }
    if (typeof root.querySelectorAll === "function") {
      for (const row of root.querySelectorAll("a.search_result_row")) {
        applyPopularMetadata(row);
      }
    }
    document.dispatchEvent(new CustomEvent(POPULAR_TAG_EVENT));
  }

  function replacePopularRanks(apps) {
    const nextRanks = new Map();
    if (Array.isArray(apps)) {
      for (const app of apps) {
        const appId = String(app?.appId || "");
        const rank = Number(app?.rank);
        if (/^\d+$/.test(appId) && Number.isInteger(rank) && rank > 0) {
          nextRanks.set(appId, rank);
        }
      }
    }
    popularRanks = nextRanks;
    applyHighlightsWithin(document);
  }

  async function loadPopularGames({ refresh = false } = {}) {
    const revision = ++requestRevision;
    if (!enabled) {
      replacePopularRanks([]);
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: "steam-fast-check-steamdb-top-games",
        year: selectedYear,
        month: selectedMonth,
        refresh
      });
      if (revision !== requestRevision) {
        return;
      }
      replacePopularRanks(response?.ok ? response.apps : []);
    } catch {
      if (revision === requestRevision) {
        replacePopularRanks([]);
      }
    }
  }

  function normalizeSettings(stored) {
    enabled = stored[ENABLED_STORAGE_KEY] === true;
    const year = Number(stored[YEAR_STORAGE_KEY]);
    const month = Number(stored[MONTH_STORAGE_KEY]);
    selectedYear = Number.isInteger(year) ? year : now.getFullYear();
    selectedMonth = Number.isInteger(month) && month >= 1 && month <= 12
      ? month
      : now.getMonth() + 1;
  }

  const resultsRoot = document.getElementById("search_results");
  let mutationObserver = null;
  if (resultsRoot) {
    mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const addedNode of mutation.addedNodes) {
          if (addedNode.nodeType === 1) {
            applyHighlightsWithin(addedNode);
          }
        }
      }
    });
    mutationObserver.observe(resultsRoot, { childList: true, subtree: true });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") {
      return;
    }
    const settingsChanged = Boolean(
      changes[ENABLED_STORAGE_KEY] ||
      changes[YEAR_STORAGE_KEY] ||
      changes[MONTH_STORAGE_KEY]
    );
    const dataChanged = Boolean(changes[DATA_REVISION_STORAGE_KEY]);
    if (!settingsChanged && !dataChanged) {
      return;
    }

    if (settingsChanged) {
      normalizeSettings({
        [ENABLED_STORAGE_KEY]: changes[ENABLED_STORAGE_KEY]?.newValue ?? enabled,
        [YEAR_STORAGE_KEY]: changes[YEAR_STORAGE_KEY]?.newValue ?? selectedYear,
        [MONTH_STORAGE_KEY]: changes[MONTH_STORAGE_KEY]?.newValue ?? selectedMonth
      });
    }
    loadPopularGames({ refresh: settingsChanged });
  });

  window[PATCH_KEY] = {
    version: PATCH_VERSION,
    mutationObserver,
    reload: loadPopularGames
  };

  chrome.storage.sync
    .get({
      [ENABLED_STORAGE_KEY]: false,
      [YEAR_STORAGE_KEY]: now.getFullYear(),
      [MONTH_STORAGE_KEY]: now.getMonth() + 1
    })
    .then((stored) => {
      normalizeSettings(stored);
      return loadPopularGames({ refresh: true });
    })
    .catch(() => replacePopularRanks([]));
})();
