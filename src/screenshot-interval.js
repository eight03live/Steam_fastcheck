"use strict";

(() => {
  const STORAGE_KEY = "steamFastCheckScreenshotIntervalSeconds";
  const MIN_INTERVAL = 0.1;
  const MAX_INTERVAL = 1;
  const INTERVAL_STEP = 0.1;
  const DEFAULT_INTERVAL = 0.6;
  let currentInterval = DEFAULT_INTERVAL;

  function normalizeInterval(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return DEFAULT_INTERVAL;
    }

    const snappedValue = Math.round(numericValue / INTERVAL_STEP) * INTERVAL_STEP;
    return Number(
      Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, snappedValue)).toFixed(1)
    );
  }

  function formatSeconds(value) {
    return `${value.toFixed(1)}s`;
  }

  function applyInterval(value) {
    currentInterval = normalizeInterval(value);
    const root = document.documentElement;
    if (!root) {
      return;
    }

    root.style.setProperty(
      "--steam-fast-check-screenshot-cycle",
      formatSeconds(currentInterval * 4)
    );
    for (let imageIndex = 2; imageIndex <= 4; imageIndex += 1) {
      root.style.setProperty(
        `--steam-fast-check-screenshot-delay-${imageIndex}`,
        formatSeconds(currentInterval * (imageIndex - 1))
      );
    }
  }

  if (!document.documentElement) {
    document.addEventListener(
      "readystatechange",
      () => applyInterval(currentInterval),
      { once: true }
    );
  }

  chrome.storage.sync
    .get({ [STORAGE_KEY]: DEFAULT_INTERVAL })
    .then((stored) => applyInterval(stored[STORAGE_KEY]))
    .catch(() => applyInterval(DEFAULT_INTERVAL));

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync" && changes[STORAGE_KEY]) {
      applyInterval(changes[STORAGE_KEY].newValue);
    }
  });
})();
