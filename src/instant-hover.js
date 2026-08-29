(() => {
  "use strict";

  const PATCH_KEY = "__steamFastCheckHoverPatch";
  const STEAM_HOVER_DELAYS = new Set([50, 100, 150, 300]);
  const INSTALL_RETRY_MS = 25;

  function installInstantHover() {
    if (
      typeof window.GameHover !== "function" ||
      typeof window.ShowGameHover !== "function"
    ) {
      return false;
    }

    const currentPatch = window[PATCH_KEY];
    if (
      currentPatch?.gameHover === window.GameHover &&
      currentPatch?.showGameHover === window.ShowGameHover
    ) {
      return true;
    }

    const originalGameHover = window.GameHover;
    const originalShowGameHover = window.ShowGameHover;

    function showGameHoverImmediately(...args) {
      // Steam passes the fade duration as the fifth argument.
      args[4] = 0;
      return originalShowGameHover.apply(this, args);
    }

    function startGameHoverImmediately(...args) {
      const previousSetTimeout = window.setTimeout;

      // GameHover schedules its two intentional delays synchronously. Limit the
      // override to that call so unrelated Steam timers retain their behavior.
      window.setTimeout = function fastHoverTimeout(callback, delay, ...timerArgs) {
        const effectiveDelay = STEAM_HOVER_DELAYS.has(delay) ? 0 : delay;
        return previousSetTimeout.call(window, callback, effectiveDelay, ...timerArgs);
      };

      try {
        return originalGameHover.apply(this, args);
      } finally {
        window.setTimeout = previousSetTimeout;
      }
    }

    window.ShowGameHover = showGameHoverImmediately;
    window.GameHover = startGameHoverImmediately;
    window[PATCH_KEY] = {
      version: "1.0.0",
      gameHover: startGameHoverImmediately,
      showGameHover: showGameHoverImmediately
    };

    return true;
  }

  if (installInstantHover()) {
    return;
  }

  const retryTimer = window.setInterval(() => {
    if (installInstantHover()) {
      window.clearInterval(retryTimer);
    }
  }, INSTALL_RETRY_MS);
})();
