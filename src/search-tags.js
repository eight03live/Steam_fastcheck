(() => {
  "use strict";

  const PATCH_KEY = "__steamFastCheckTagsPatch";
  const PATCH_VERSION = "1.0.0";
  const STORAGE_KEY = "steamFastCheckTagHighlightRules";
  const OPEN_IN_NEW_TAB_STORAGE_KEY = "steamFastCheckOpenSearchResultsInNewTab";
  const MAX_VISIBLE_TAGS = 3;
  const POPULAR_TAG_NAME = "TOP100";
  const POPULAR_TAG_EVENT = "steam-fast-check-popular-tags-changed";
  const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

  if (window[PATCH_KEY]?.version === PATCH_VERSION) {
    return;
  }

  function normalizeTagName(tagName) {
    return String(tagName || "").trim().toLocaleLowerCase();
  }

  function normalizeColor(color) {
    const normalized = String(color || "").trim().toLowerCase();
    return HEX_COLOR_PATTERN.test(normalized) ? normalized : null;
  }

  function getContrastColor(hexColor) {
    const red = Number.parseInt(hexColor.slice(1, 3), 16);
    const green = Number.parseInt(hexColor.slice(3, 5), 16);
    const blue = Number.parseInt(hexColor.slice(5, 7), 16);
    const brightness = (red * 299 + green * 587 + blue * 114) / 1000;
    return brightness >= 155 ? "#101820" : "#ffffff";
  }

  function buildTagNameMap() {
    const tagNames = new Map();
    const controls = document.querySelectorAll(
      '#TagFilter_Container .tab_filter_control_row[data-param="tags"][data-value][data-loc]'
    );

    for (const control of controls) {
      tagNames.set(control.dataset.value, control.dataset.loc);
    }

    return tagNames;
  }

  function parseTagIds(rawTagIds) {
    if (!rawTagIds) {
      return [];
    }

    try {
      const parsed = JSON.parse(rawTagIds);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }

  let tagNames = buildTagNameMap();
  let highlightRules = new Map();
  let rulesRevision = 0;
  let openInNewTab = true;

  function applyLinkBehavior(row) {
    if (openInNewTab) {
      row.target = "_blank";
      row.rel = "noopener noreferrer";
      return;
    }

    row.removeAttribute("target");
    row.removeAttribute("rel");
  }

  function applyTagHighlight(element, tagName) {
    element.classList.remove("steam_fast_check_tag_highlight");
    element.style?.removeProperty("--steam-fast-check-tag-highlight-color");
    element.style?.removeProperty("--steam-fast-check-tag-highlight-text");

    const color = highlightRules.get(normalizeTagName(tagName));
    if (!color) {
      return;
    }

    element.classList.add("steam_fast_check_tag_highlight");
    element.style?.setProperty("--steam-fast-check-tag-highlight-color", color);
    element.style?.setProperty(
      "--steam-fast-check-tag-highlight-text",
      getContrastColor(color)
    );
  }

  function decorateRow(row) {
    applyLinkBehavior(row);

    const platformArea = row.querySelector(".search_platforms");
    if (!platformArea) {
      return;
    }

    const rawTagIds = row.getAttribute("data-ds-tagids") || "[]";
    const popularRankValue = String(
      row.dataset?.steamFastCheckPopularRank || ""
    );
    const popularRank = /^\d+$/.test(popularRankValue)
      ? Number(popularRankValue)
      : null;
    if (
      platformArea.dataset.steamFastCheckTagsFor === rawTagIds &&
      platformArea.dataset.steamFastCheckTagsRevision === String(rulesRevision) &&
      platformArea.dataset.steamFastCheckPopularRank === popularRankValue
    ) {
      return;
    }

    if (tagNames.size === 0) {
      tagNames = buildTagNameMap();
    }

    const allTagNames = parseTagIds(rawTagIds)
      .map((tagId) => tagNames.get(tagId))
      .filter(Boolean);
    const availableTagNames = popularRank
      ? [POPULAR_TAG_NAME, ...allTagNames]
      : allTagNames;
    const highlightedTagNames = [...highlightRules.keys()]
      .map((highlightedName) =>
        availableTagNames.find(
          (tagName) => normalizeTagName(tagName) === highlightedName
        )
      )
      .filter(Boolean);
    let prioritizedTagNames = [
      ...highlightedTagNames,
      ...availableTagNames.filter((tagName) =>
        !highlightRules.has(normalizeTagName(tagName))
      )
    ];
    if (popularRank && !highlightRules.has(normalizeTagName(POPULAR_TAG_NAME))) {
      prioritizedTagNames = [
        POPULAR_TAG_NAME,
        ...prioritizedTagNames.filter((tagName) => tagName !== POPULAR_TAG_NAME)
      ];
    }

    const visibleTagNames = prioritizedTagNames.slice(0, MAX_VISIBLE_TAGS);
    if (popularRank && !visibleTagNames.includes(POPULAR_TAG_NAME)) {
      const popularIndex = Math.min(
        prioritizedTagNames.indexOf(POPULAR_TAG_NAME),
        MAX_VISIBLE_TAGS - 1
      );
      visibleTagNames.pop();
      visibleTagNames.splice(popularIndex, 0, POPULAR_TAG_NAME);
    }

    const fragment = document.createDocumentFragment();
    for (const tagName of visibleTagNames) {
      const tag = document.createElement("span");
      const isPopularTag = tagName === POPULAR_TAG_NAME;
      tag.className = isPopularTag
        ? "steam_fast_check_tag steam_fast_check_popular_tag"
        : "steam_fast_check_tag";
      tag.textContent = tagName;
      if (isPopularTag) {
        tag.title = `SteamDBフォロワー上位100件 第${popularRank}位`;
      }
      applyTagHighlight(tag, tagName);
      fragment.append(tag);
    }

    const visibleUserTagCount = visibleTagNames.filter(
      (tagName) => tagName !== POPULAR_TAG_NAME
    ).length;
    if (allTagNames.length > visibleUserTagCount) {
      const remaining = document.createElement("span");
      remaining.className = "steam_fast_check_tag steam_fast_check_tag_more";
      remaining.textContent = `+${allTagNames.length - visibleUserTagCount}`;
      fragment.append(remaining);
    }

    platformArea.replaceChildren(fragment);
    platformArea.classList.add("steam_fast_check_tags");
    platformArea.dataset.steamFastCheckTagsFor = rawTagIds;
    platformArea.dataset.steamFastCheckTagsRevision = String(rulesRevision);
    platformArea.dataset.steamFastCheckPopularRank = popularRankValue;
    platformArea.title = [
      popularRank
        ? `TOP100（SteamDBフォロワー第${popularRank}位）`
        : null,
      ...allTagNames
    ].filter(Boolean).join(" / ");
  }

  function decorateRowsWithin(root) {
    if (typeof root.matches === "function" && root.matches("a.search_result_row")) {
      decorateRow(root);
    }

    if (typeof root.querySelectorAll === "function") {
      for (const row of root.querySelectorAll("a.search_result_row")) {
        decorateRow(row);
      }
    }
  }

  function handleSearchResultClick(event) {
    const row = event.target?.closest?.("a.search_result_row");
    if (!row || !openInNewTab) {
      return;
    }

    // Keep the browser's native link activation, but prevent Steam's bubbling
    // click handler from replacing/reloading the search tab before it opens.
    applyLinkBehavior(row);
    event.stopImmediatePropagation();
  }

  function highlightHoverTag(tag) {
    applyTagHighlight(tag, tag.textContent);
  }

  function highlightHoverTagsWithin(root) {
    const hoverTagSelector = "#global_hover .hover_tag_row .app_tag";

    if (typeof root.matches === "function" && root.matches(hoverTagSelector)) {
      highlightHoverTag(root);
    }

    if (typeof root.querySelectorAll === "function") {
      for (const tag of root.querySelectorAll(hoverTagSelector)) {
        highlightHoverTag(tag);
      }
    }
  }

  function setHighlightRules(rules) {
    const nextRules = new Map();

    if (Array.isArray(rules)) {
      for (const rule of rules) {
        const tagName = normalizeTagName(rule?.tag);
        const color = normalizeColor(rule?.color);
        if (tagName && color) {
          nextRules.set(tagName, color);
        }
      }
    }

    highlightRules = nextRules;
    rulesRevision += 1;
    decorateRowsWithin(document);
    highlightHoverTagsWithin(document);
  }

  function setOpenInNewTab(enabled) {
    openInNewTab = enabled !== false;
    decorateRowsWithin(document);
  }

  decorateRowsWithin(document);
  highlightHoverTagsWithin(document);
  document.addEventListener("click", handleSearchResultClick, true);
  document.addEventListener(POPULAR_TAG_EVENT, () => {
    decorateRowsWithin(document);
  });

  const resultsRoot = document.getElementById("search_results");
  let resultsObserver = null;
  if (resultsRoot) {
    resultsObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const addedNode of mutation.addedNodes) {
          if (addedNode.nodeType === 1) {
            decorateRowsWithin(addedNode);
          }
        }
      }
    });
    resultsObserver.observe(resultsRoot, { childList: true, subtree: true });
  }

  let hoverObserver = null;
  if (document.body) {
    hoverObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const addedNode of mutation.addedNodes) {
          if (addedNode.nodeType === 1) {
            highlightHoverTagsWithin(addedNode);
          }
        }
      }
    });
    hoverObserver.observe(document.body, { childList: true, subtree: true });
  }

  window[PATCH_KEY] = {
    version: PATCH_VERSION,
    resultsObserver,
    hoverObserver,
    clickListener: handleSearchResultClick
  };

  if (globalThis.chrome?.storage?.sync) {
    chrome.storage.sync
      .get({
        [STORAGE_KEY]: [],
        [OPEN_IN_NEW_TAB_STORAGE_KEY]: true
      })
      .then((stored) => {
        setOpenInNewTab(stored[OPEN_IN_NEW_TAB_STORAGE_KEY]);
        setHighlightRules(stored[STORAGE_KEY]);
      })
      .catch(() => {
        setOpenInNewTab(true);
        setHighlightRules([]);
      });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync") {
        return;
      }

      if (changes[STORAGE_KEY]) {
        setHighlightRules(changes[STORAGE_KEY].newValue);
      }
      if (changes[OPEN_IN_NEW_TAB_STORAGE_KEY]) {
        setOpenInNewTab(changes[OPEN_IN_NEW_TAB_STORAGE_KEY].newValue);
      }
    });
  }
})();
