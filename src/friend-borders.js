(() => {
  "use strict";

  const PATCH_KEY = "__steamFastCheckFriendBordersPatch";
  const PATCH_VERSION = "1.0.0";
  const MAX_CONCURRENT_REQUESTS = 4;
  const PRELOAD_MARGIN = "1000px 0px";
  const BORDER_CLASSES = [
    "steam_fast_check_friend_wishlist_1",
    "steam_fast_check_friend_wishlist_2",
    "steam_fast_check_friend_wishlist_3",
    "steam_fast_check_friend_wishlist_4plus"
  ];

  if (window[PATCH_KEY]?.version === PATCH_VERSION) {
    return;
  }

  const countCache = new Map();
  const requestQueue = [];
  let activeRequests = 0;

  function getBorderClass(friendCount) {
    if (friendCount >= 4) {
      return BORDER_CLASSES[3];
    }
    if (friendCount >= 1) {
      return BORDER_CLASSES[friendCount - 1];
    }
    return null;
  }

  function applyFriendCount(row, friendCount) {
    row.classList.remove(...BORDER_CLASSES);
    row.dataset.steamFastCheckFriendWishlistCount = String(friendCount);

    const borderClass = getBorderClass(friendCount);
    if (borderClass) {
      row.classList.add(borderClass);
    }
  }

  function countFriendsInHoverHtml(html) {
    const hoverDocument = new DOMParser().parseFromString(html, "text/html");
    return hoverDocument.querySelectorAll(
      ".hover_friends_blocks .playerAvatar"
    ).length;
  }

  function fetchFriendCount(appId) {
    if (!countCache.has(appId)) {
      const hoverUrl = new URL(`/apphover/${appId}`, location.origin);
      hoverUrl.searchParams.set("pagev6", "true");
      hoverUrl.searchParams.set("origin", location.origin);

      const request = fetch(hoverUrl, {
        credentials: "same-origin",
        headers: { "X-Requested-With": "XMLHttpRequest" }
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Steam hover request failed: ${response.status}`);
          }
          return response.text();
        })
        .then(countFriendsInHoverHtml)
        .catch(() => 0);

      countCache.set(appId, request);
    }

    return countCache.get(appId);
  }

  function processQueue() {
    while (
      activeRequests < MAX_CONCURRENT_REQUESTS &&
      requestQueue.length > 0
    ) {
      const { row, appId } = requestQueue.shift();
      activeRequests += 1;

      fetchFriendCount(appId)
        .then((friendCount) => applyFriendCount(row, friendCount))
        .finally(() => {
          activeRequests -= 1;
          processQueue();
        });
    }
  }

  function enqueueRow(row) {
    if (row.dataset.steamFastCheckFriendPreload === "queued") {
      return;
    }

    const appId = row.dataset.dsAppid;
    if (!/^\d+$/.test(appId || "")) {
      return;
    }

    row.dataset.steamFastCheckFriendPreload = "queued";
    requestQueue.push({ row, appId });
    processQueue();
  }

  const intersectionObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        intersectionObserver.unobserve(entry.target);
        enqueueRow(entry.target);
      }
    }
  }, { rootMargin: PRELOAD_MARGIN });

  function observeRow(row) {
    if (row.dataset.steamFastCheckFriendPreload) {
      return;
    }

    const appId = row.dataset.dsAppid;
    if (!/^\d+$/.test(appId || "")) {
      return;
    }

    row.dataset.steamFastCheckFriendPreload = "observed";
    intersectionObserver.observe(row);
  }

  function observeRowsWithin(root) {
    if (typeof root.matches === "function" && root.matches("a.search_result_row")) {
      observeRow(root);
    }

    if (typeof root.querySelectorAll === "function") {
      for (const row of root.querySelectorAll("a.search_result_row")) {
        observeRow(row);
      }
    }
  }

  observeRowsWithin(document);

  const resultsRoot = document.getElementById("search_results");
  let mutationObserver = null;
  if (resultsRoot) {
    mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const addedNode of mutation.addedNodes) {
          if (addedNode.nodeType === 1) {
            observeRowsWithin(addedNode);
          }
        }
      }
    });
    mutationObserver.observe(resultsRoot, { childList: true, subtree: true });
  }

  window[PATCH_KEY] = {
    version: PATCH_VERSION,
    intersectionObserver,
    mutationObserver
  };
})();
