"use strict";

(() => {
  const ENABLED_STORAGE_KEY = "steamFastCheckGeminiTranslationEnabled";
  const MODEL_STORAGE_KEY = "steamFastCheckGeminiModel";
  const SETTINGS_REVISION_STORAGE_KEY = "steamFastCheckGeminiSettingsRevision";
  const DEFAULT_MODEL = "gemini-3.5-flash-lite";
  const TARGET_SELECTOR = ".game_description_snippet, #game_area_description";
  const STATUS_ID = "steam_fast_check_translation_status";
  const TRANSLATED_PARENT_CLASS = "steam_fast_check_translated_parent";
  const ORIGINAL_VISIBLE_CLASS = "steam_fast_check_original_visible";
  const INTERACTIVE_SELECTOR = "a, button, input, select, textarea, label";
  const LATIN_PATTERN = /[A-Za-z]/;
  const JAPANESE_PATTERN = /[ぁ-んァ-ヶ一-龠]/;
  const SKIPPED_PARENT_NAMES = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA"]);
  const HOVER_BLOCK_NAMES = new Set([
    "P",
    "LI",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "BLOCKQUOTE",
    "FIGCAPTION",
    "TD",
    "TH",
    "PRE"
  ]);

  let enabled = false;
  let currentRun = 0;
  let originals = [];
  let hoverTargetStates = [];
  let hoverRecordsByElement = new WeakMap();

  function findTranslatedParent(target) {
    return target instanceof Element
      ? target.closest(`.${TRANSLATED_PARENT_CLASS}`)
      : null;
  }

  function toggleOriginalOnClick(event) {
    if (event.button !== undefined && event.button !== 0) {
      return;
    }
    if (event.target instanceof Element && event.target.closest(INTERACTIVE_SELECTOR)) {
      return;
    }
    const target = findTranslatedParent(event.target);
    const records = target ? hoverRecordsByElement.get(target) : null;
    if (!records) {
      return;
    }
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString()) {
      return;
    }

    const showOriginal = !target.classList.contains(ORIGINAL_VISIBLE_CLASS);
    for (const record of records) {
      if (!record.node.isConnected) {
        continue;
      }
      if (showOriginal && record.node.nodeValue === record.translatedValue) {
        record.node.nodeValue = record.originalValue;
      } else if (!showOriginal && record.node.nodeValue === record.originalValue) {
        record.node.nodeValue = record.translatedValue;
      }
    }
    target.classList.toggle(ORIGINAL_VISIBLE_CLASS, showOriginal);
  }

  document.addEventListener("click", toggleOriginalOnClick);

  function getStatusElement() {
    let element = document.getElementById(STATUS_ID);
    if (!element) {
      element = document.createElement("div");
      element.id = STATUS_ID;
      element.tabIndex = 0;
      element.title = "クリックするとステータスを選択できます";
      element.addEventListener("click", () => {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(element);
        selection.removeAllRanges();
        selection.addRange(range);
      });
      document.documentElement.append(element);
    }
    return element;
  }

  function showStatus(message, state = "working") {
    const element = getStatusElement();
    element.textContent = message;
    element.dataset.state = state;
    element.hidden = false;
  }

  function hideStatusAfterDelay(runId, delay = 3500) {
    window.setTimeout(() => {
      if (runId === currentRun) {
        const element = document.getElementById(STATUS_ID);
        if (element) {
          element.hidden = true;
        }
      }
    }, delay);
  }

  function formatError(response) {
    return [
      "Gemini翻訳に失敗しました。",
      `コード: ${response?.code || "unknown"}`,
      `段階: ${response?.phase || "unknown"}`,
      response?.status ? `HTTP: ${response.status}` : "",
      `内容: ${response?.message || "不明なエラーです。"}`,
      "拡張機能の設定でAPIキーとモデルを確認してください。",
      "この表示はクリックすると選択できます。"
    ].filter(Boolean).join("\n");
  }

  function detectLanguage(text) {
    return new Promise((resolve) => {
      chrome.i18n.detectLanguage(text.slice(0, 5000), (result) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(result);
      });
    });
  }

  async function isEnglishContainer(container) {
    const text = container.textContent.trim();
    if (!LATIN_PATTERN.test(text)) {
      return false;
    }

    const detection = await detectLanguage(text);
    if (!detection || !Array.isArray(detection.languages)) {
      const englishWords = text.match(/\b[A-Za-z]{3,}\b/g)?.length || 0;
      const japaneseCharacters = text.match(/[ぁ-んァ-ヶ一-龠]/g)?.length || 0;
      return englishWords >= 3 && englishWords * 2 >= japaneseCharacters;
    }
    return detection.languages.some(
      (language) => language.language === "en" && language.percentage >= 45
    );
  }

  function collectTextRecords(container) {
    const records = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parentName = node.parentElement?.tagName;
      const raw = node.nodeValue || "";
      const trimmed = raw.trim();
      if (
        SKIPPED_PARENT_NAMES.has(parentName) ||
        trimmed.length < 2 ||
        !LATIN_PATTERN.test(trimmed) ||
        JAPANESE_PATTERN.test(trimmed)
      ) {
        continue;
      }

      const start = raw.indexOf(trimmed);
      let hoverElement = node.parentElement;
      while (
        hoverElement &&
        hoverElement !== container &&
        !HOVER_BLOCK_NAMES.has(hoverElement.tagName)
      ) {
        hoverElement = hoverElement.parentElement;
      }
      records.push({
        node,
        hoverElement: hoverElement || container,
        originalValue: raw,
        text: trimmed,
        prefix: raw.slice(0, start),
        suffix: raw.slice(start + trimmed.length)
      });
    }
    return records;
  }

  function restoreOriginals() {
    for (const record of originals) {
      if (record.node.isConnected && record.node.nodeValue === record.translatedValue) {
        record.node.nodeValue = record.originalValue;
      }
    }
    originals = [];

    for (const state of hoverTargetStates) {
      if (!state.element.isConnected) {
        continue;
      }
      if (!state.hadTranslatedClass) {
        state.element.classList.remove(TRANSLATED_PARENT_CLASS);
      }
      if (!state.hadOriginalVisibleClass) {
        state.element.classList.remove(ORIGINAL_VISIBLE_CLASS);
      }
    }
    hoverTargetStates = [];
    hoverRecordsByElement = new WeakMap();
  }

  function markOriginalTextTargets(records) {
    const recordsByElement = new Map();
    hoverTargetStates = [];
    for (const record of records) {
      const element = record.hoverElement;
      if (!element) {
        continue;
      }
      const elementRecords = recordsByElement.get(element) || [];
      elementRecords.push(record);
      recordsByElement.set(element, elementRecords);
    }

    hoverRecordsByElement = new WeakMap();
    for (const [element, elementRecords] of recordsByElement) {
      hoverTargetStates.push({
        element,
        hadTranslatedClass: element.classList.contains(TRANSLATED_PARENT_CLASS),
        hadOriginalVisibleClass: element.classList.contains(ORIGINAL_VISIBLE_CLASS)
      });
      element.classList.add(TRANSLATED_PARENT_CLASS);
      hoverRecordsByElement.set(element, elementRecords);
    }
  }

  async function runTranslation() {
    const runId = ++currentRun;
    restoreOriginals();
    if (!enabled) {
      document.getElementById(STATUS_ID)?.setAttribute("hidden", "");
      return;
    }

    const containers = [...document.querySelectorAll(TARGET_SELECTOR)];
    if (containers.length === 0) {
      showStatus("Gemini翻訳: 対象の説明欄が見つかりませんでした。", "idle");
      hideStatusAfterDelay(runId);
      return;
    }

    showStatus("Gemini翻訳: 英語の説明文を確認しています…");
    const englishChecks = await Promise.all(containers.map(isEnglishContainer));
    if (runId !== currentRun || !enabled) {
      return;
    }

    const records = containers.flatMap((container, index) =>
      englishChecks[index] ? collectTextRecords(container) : []
    );
    if (records.length === 0) {
      showStatus("Gemini翻訳: 翻訳が必要な英語の説明文はありません。", "success");
      hideStatusAfterDelay(runId);
      return;
    }

    showStatus(`Gemini翻訳: ${records.length}箇所を翻訳しています…`);
    let response;
    try {
      response = await chrome.runtime.sendMessage({
        type: "steam-fast-check-gemini-translate",
        texts: records.map((record) => record.text)
      });
    } catch (error) {
      response = {
        ok: false,
        code: "message-error",
        phase: "content-script",
        message: error?.message || "バックグラウンド処理と通信できませんでした。"
      };
    }

    if (runId !== currentRun || !enabled) {
      return;
    }
    if (!response?.ok) {
      showStatus(formatError(response), "error");
      return;
    }

    originals = [];
    records.forEach((record, index) => {
      if (!record.node.isConnected || record.node.nodeValue !== record.originalValue) {
        return;
      }
      record.translatedValue = `${record.prefix}${response.translations[index]}${record.suffix}`;
      record.node.nodeValue = record.translatedValue;
      originals.push(record);
    });
    markOriginalTextTargets(originals);

    const source = response.cached ? "キャッシュ" : response.model;
    showStatus(
      `Gemini翻訳: 完了しました（${source}）。翻訳文をクリックすると原文と日本語を切り替えられます。`,
      "success"
    );
    hideStatusAfterDelay(runId, 5000);
  }

  async function loadSettings() {
    const settings = await chrome.storage.sync.get({
      [ENABLED_STORAGE_KEY]: false,
      [MODEL_STORAGE_KEY]: DEFAULT_MODEL
    });
    enabled = settings[ENABLED_STORAGE_KEY] === true;
    await runTranslation();
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") {
      return;
    }
    if (changes[ENABLED_STORAGE_KEY]) {
      enabled = changes[ENABLED_STORAGE_KEY].newValue === true;
      runTranslation();
    } else if (
      enabled &&
      (changes[MODEL_STORAGE_KEY] || changes[SETTINGS_REVISION_STORAGE_KEY])
    ) {
      runTranslation();
    }
  });

  loadSettings().catch((error) => {
    showStatus(formatError({
      code: "settings-load-error",
      phase: "content-script",
      message: error?.message || "設定を読み込めませんでした。"
    }), "error");
  });
})();
