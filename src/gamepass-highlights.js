(() => {
  "use strict";

  const PATCH_KEY = "__steamFastCheckGamePassHighlightsPatch";
  const PATCH_VERSION = "1.0.0";
  const ENABLED_STORAGE_KEY = "steamFastCheckGamePassHighlightEnabled";
  const DATA_REVISION_STORAGE_KEY = "steamFastCheckGamePassDataRevision";
  const POPULAR_TAG_EVENT = "steam-fast-check-popular-tags-changed";

  if (window[PATCH_KEY]?.version === PATCH_VERSION) {
    return;
  }

  const TRADEMARK_PATTERN = /[™®©]|\((?:tm|r|c)\)/gi;
  const BRACKET_WRAP_PATTERN = /^[「『](.+)[」』](?:\s*本編)?$/;
  const SUFFIX_STRIP_PATTERN =
    /(?:\s*[-–—:：]?\s*)(?:\(\s*pc\s*\)|\(\s*windows(?:\s*10|\s*11)?\s*\)|\(\s*game\s*preview\s*\)|\(\s*ゲーム\s*プレビュー\s*\)|for\s+windows(?:\s*10|\s*11)?|windows(?:\s*10|\s*11)?(?:\s+edition)?|pc(?:\s+edition)?|game\s*preview|ゲーム\s*プレビュー|standard\s+edition|スタンダード\s*エディション|base\s+game|本編)\s*$/i;
  const SEPARATOR_PATTERN =
    /[\s!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~’‘“”・：；！？「」『』（）［］【】〈〉《》〜～－—–]+/g;
  const BILINGUAL_SPLIT_PATTERN =
    /^([A-Za-z0-9][A-Za-z0-9\s:'’\-_!&.,/]+?)\s+([0-9]*\s*[ぁ-んァ-ヶ一-龠ー].*)$/;

  let enabled = true;
  let normalizedGamePassTitles = new Set();
  let normalizedUpcomingGamePassTitles = new Set();
  let requestRevision = 0;

  const COMING_SOON_TEXT_PATTERN =
    /近日登場|発表予定|未定|coming\s*soon|to\s*be\s*announced|\btba\b|when\s*it'?s\s*ready/i;
  const JP_FULL_DATE_PATTERN = /^(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日$/;
  const JP_YEAR_MONTH_PATTERN = /^(\d{4})年\s*(\d{1,2})月$/;
  const JP_YEAR_ONLY_PATTERN = /^(\d{4})年(?:\s*(?:第?[1-4]四半期|Q[1-4]))?$/i;
  const EN_YEAR_ONLY_PATTERN = /^(?:Q[1-4]\s+)?(\d{4})$/i;

  function normalizeTitleKey(value) {
    const normalized = String(value || "")
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(TRADEMARK_PATTERN, "")
      .replace(SEPARATOR_PATTERN, "");
    return normalized;
  }

  function stripDecorations(rawTitle) {
    let text = String(rawTitle || "")
      .normalize("NFKC")
      .replace(TRADEMARK_PATTERN, "")
      .trim();

    const bracketMatch = text.match(BRACKET_WRAP_PATTERN);
    if (bracketMatch) {
      text = bracketMatch[1].trim();
    }

    for (let step = 0; step < 4; step += 1) {
      const stripped = text.replace(SUFFIX_STRIP_PATTERN, "").trim();
      const innerBracket = stripped.match(BRACKET_WRAP_PATTERN);
      const next = innerBracket ? innerBracket[1].trim() : stripped;
      if (next === text || !next) {
        break;
      }
      text = next;
    }

    return text;
  }

  function expandTitleKeys(rawTitle) {
    const keys = new Set();
    const raw = String(rawTitle || "").trim();
    if (!raw) {
      return keys;
    }

    const baseKey = normalizeTitleKey(raw);
    if (baseKey) {
      keys.add(baseKey);
    }

    const stripped = stripDecorations(raw);
    const strippedKey = normalizeTitleKey(stripped);
    if (strippedKey) {
      keys.add(strippedKey);
    }

    const bilingualMatch = stripped.match(BILINGUAL_SPLIT_PATTERN);
    if (bilingualMatch) {
      const englishKey = normalizeTitleKey(bilingualMatch[1]);
      const japaneseKey = normalizeTitleKey(bilingualMatch[2]);
      if (englishKey.length >= 2) {
        keys.add(englishKey);
      }
      if (japaneseKey.length >= 2) {
        keys.add(japaneseKey);
      }
    }

    return keys;
  }

  function getRowTitle(row) {
    if (typeof row?.querySelector === "function") {
      const titleElement = row.querySelector(".title");
      if (titleElement && typeof titleElement.textContent === "string") {
        return titleElement.textContent.trim();
      }
    }
    if (typeof row?.dataset?.dsTitle === "string") {
      return row.dataset.dsTitle.trim();
    }
    return "";
  }

  function isComingSoonSearchPage() {
    const locationText = String(
      window?.location?.search || window?.location?.href || ""
    );
    return /(?:[?&])filter=comingsoon(?:&|$)/i.test(locationText);
  }

  function isComingSoonRow(row) {
    if (isComingSoonSearchPage()) {
      return true;
    }
    if (typeof row?.querySelector !== "function") {
      return false;
    }
    const releasedElement = row.querySelector(".search_released");
    const text =
      typeof releasedElement?.textContent === "string"
        ? releasedElement.textContent.trim()
        : "";
    if (!text) {
      return false;
    }
    if (COMING_SOON_TEXT_PATTERN.test(text)) {
      return true;
    }

    const now = new Date();
    const nowYear = now.getFullYear();
    const nowMonth = now.getMonth() + 1;
    const todayStartMs = new Date(nowYear, now.getMonth(), now.getDate()).getTime();

    const jpFullMatch = text.match(JP_FULL_DATE_PATTERN);
    if (jpFullMatch) {
      const releaseMs = new Date(
        Number(jpFullMatch[1]),
        Number(jpFullMatch[2]) - 1,
        Number(jpFullMatch[3])
      ).getTime();
      if (releaseMs > todayStartMs) {
        return true;
      }
      if (
        releaseMs === todayStartMs &&
        !row.querySelector(".search_review_summary")
      ) {
        return true;
      }
      return false;
    }

    const jpYearMonthMatch = text.match(JP_YEAR_MONTH_PATTERN);
    if (jpYearMonthMatch) {
      const year = Number(jpYearMonthMatch[1]);
      const month = Number(jpYearMonthMatch[2]);
      return year > nowYear || (year === nowYear && month >= nowMonth);
    }

    const jpYearMatch = text.match(JP_YEAR_ONLY_PATTERN);
    if (jpYearMatch) {
      return Number(jpYearMatch[1]) >= nowYear;
    }

    const enYearMatch = text.match(EN_YEAR_ONLY_PATTERN);
    if (enYearMatch) {
      return Number(enYearMatch[1]) >= nowYear;
    }

    const parsedMs = Date.parse(text);
    if (Number.isFinite(parsedMs)) {
      return parsedMs > todayStartMs;
    }

    return false;
  }

  function isGamePassRow(row) {
    if (!enabled) {
      return false;
    }
    const targetTitles = isComingSoonRow(row)
      ? normalizedUpcomingGamePassTitles
      : normalizedGamePassTitles;
    if (targetTitles.size === 0) {
      return false;
    }
    const rowTitle = getRowTitle(row);
    if (!rowTitle) {
      return false;
    }
    const candidateKeys = expandTitleKeys(rowTitle);
    for (const key of candidateKeys) {
      if (targetTitles.has(key)) {
        return true;
      }
    }
    return false;
  }

  function applyGamePassMetadata(row) {
    if (!row?.dataset) {
      return;
    }
    if (isGamePassRow(row)) {
      row.dataset.steamFastCheckGamePass = "true";
    } else {
      delete row.dataset.steamFastCheckGamePass;
    }
  }

  function applyHighlightsWithin(root) {
    if (typeof root?.matches === "function" && root.matches("a.search_result_row")) {
      applyGamePassMetadata(root);
    }
    if (typeof root?.querySelectorAll === "function") {
      for (const row of root.querySelectorAll("a.search_result_row")) {
        applyGamePassMetadata(row);
      }
    }
    document.dispatchEvent(new CustomEvent(POPULAR_TAG_EVENT));
  }

  function buildNormalizedKeySet(titles) {
    const nextKeys = new Set();
    if (Array.isArray(titles)) {
      for (const title of titles) {
        for (const key of expandTitleKeys(title)) {
          nextKeys.add(key);
        }
      }
    }
    return nextKeys;
  }

  function replaceGamePassTitles(titles, upcomingTitles = titles) {
    normalizedGamePassTitles = buildNormalizedKeySet(titles);
    normalizedUpcomingGamePassTitles = buildNormalizedKeySet(
      Array.isArray(upcomingTitles) ? upcomingTitles : titles
    );
    applyHighlightsWithin(document);
  }

  async function loadGamePassGames({ refresh = false } = {}) {
    const revision = ++requestRevision;
    if (!enabled) {
      replaceGamePassTitles([], []);
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: "steam-fast-check-gamepass-games",
        refresh
      });
      if (revision !== requestRevision) {
        return;
      }
      if (response?.ok) {
        replaceGamePassTitles(response.titles, response.upcomingTitles);
      } else {
        replaceGamePassTitles([], []);
      }
    } catch {
      if (revision === requestRevision) {
        replaceGamePassTitles([], []);
      }
    }
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
    const enabledChanged = Boolean(changes[ENABLED_STORAGE_KEY]);
    const dataChanged = Boolean(changes[DATA_REVISION_STORAGE_KEY]);
    if (!enabledChanged && !dataChanged) {
      return;
    }

    if (enabledChanged) {
      enabled = changes[ENABLED_STORAGE_KEY].newValue !== false;
    }
    loadGamePassGames({ refresh: false });
  });

  window[PATCH_KEY] = {
    version: PATCH_VERSION,
    mutationObserver,
    reload: loadGamePassGames
  };

  chrome.storage.sync
    .get({
      [ENABLED_STORAGE_KEY]: true
    })
    .then((stored) => {
      enabled = stored[ENABLED_STORAGE_KEY] !== false;
      return loadGamePassGames({ refresh: false });
    })
    .catch(() => replaceGamePassTitles([]));
})();
