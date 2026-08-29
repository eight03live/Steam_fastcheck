(() => {
  "use strict";

  const PATCH_KEY = "__steamFastCheckCountMarkersPatch";
  const PATCH_VERSION = "1.0.0";
  const COUNT_INTERVAL = 100;
  const MARKER_CLASS = "steam_fast_check_count_marker";

  if (window[PATCH_KEY]?.version === PATCH_VERSION) {
    return;
  }

  let updateScheduled = false;

  function createMarker(count) {
    const marker = document.createElement("div");
    marker.className = MARKER_CLASS;
    marker.dataset.steamFastCheckCount = String(count);
    marker.setAttribute("role", "separator");
    marker.setAttribute("aria-label", `ここまで${count}件`);
    // Steam scans every child in this container and expects this attribute.
    // An empty value makes the marker a safe non-result item during that scan.
    marker.setAttribute("data-ds-itemkey", "");
    marker.textContent = `${count}件`;
    return marker;
  }

  function updateCountMarkers() {
    updateScheduled = false;

    const rowsContainer = document.getElementById("search_resultsRows");
    if (!rowsContainer) {
      return;
    }

    const rows = [...rowsContainer.querySelectorAll("a.search_result_row")];
    const markersByCount = new Map();

    for (const marker of rowsContainer.querySelectorAll(`.${MARKER_CLASS}`)) {
      const count = Number.parseInt(marker.dataset.steamFastCheckCount, 10);
      if (!Number.isFinite(count) || markersByCount.has(count)) {
        marker.remove();
      } else {
        markersByCount.set(count, marker);
      }
    }

    const requiredCounts = new Set();
    for (let count = COUNT_INTERVAL; count <= rows.length; count += COUNT_INTERVAL) {
      requiredCounts.add(count);
      const row = rows[count - 1];
      const marker = markersByCount.get(count) || createMarker(count);

      if (row.nextElementSibling !== marker) {
        row.after(marker);
      }
    }

    for (const [count, marker] of markersByCount) {
      if (!requiredCounts.has(count)) {
        marker.remove();
      }
    }
  }

  function scheduleCountMarkerUpdate() {
    if (updateScheduled) {
      return;
    }

    updateScheduled = true;
    queueMicrotask(updateCountMarkers);
  }

  const resultsRoot = document.getElementById("search_results");
  let observer = null;
  if (resultsRoot) {
    observer = new MutationObserver(scheduleCountMarkerUpdate);
    observer.observe(resultsRoot, { childList: true, subtree: true });
  }

  scheduleCountMarkerUpdate();

  window[PATCH_KEY] = {
    version: PATCH_VERSION,
    observer,
    update: scheduleCountMarkerUpdate
  };
})();
