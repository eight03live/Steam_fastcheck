"use strict";

const STORAGE_KEY = "steamFastCheckTagHighlightRules";
const OPEN_IN_NEW_TAB_STORAGE_KEY = "steamFastCheckOpenSearchResultsInNewTab";
const SCREENSHOT_INTERVAL_STORAGE_KEY = "steamFastCheckScreenshotIntervalSeconds";
const POPULAR_ENABLED_STORAGE_KEY = "steamFastCheckPopularHighlightEnabled";
const POPULAR_YEAR_STORAGE_KEY = "steamFastCheckPopularHighlightYear";
const POPULAR_MONTH_STORAGE_KEY = "steamFastCheckPopularHighlightMonth";
const POPULAR_STATUS_STORAGE_KEY = "steamFastCheckSteamDbPopularStatusV1";
const GEMINI_ENABLED_STORAGE_KEY = "steamFastCheckGeminiTranslationEnabled";
const GEMINI_MODEL_STORAGE_KEY = "steamFastCheckGeminiModel";
const GEMINI_SETTINGS_REVISION_STORAGE_KEY = "steamFastCheckGeminiSettingsRevision";
const GEMINI_API_KEY_STORAGE_KEY = "steamFastCheckGeminiApiKey";
const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
const FALLBACK_GEMINI_MODELS = [
  { id: "gemini-3.5-flash-lite", displayName: "Gemini 3.5 Flash-Lite" },
  { id: "gemini-3.1-flash-lite", displayName: "Gemini 3.1 Flash-Lite" },
  { id: "gemini-3.5-flash", displayName: "Gemini 3.5 Flash" },
  { id: "gemini-3.7-flash", displayName: "Gemini 3.7 Flash" }
];
const COMING_SOON_CHECK_URL =
  "https://store.steampowered.com/search/?hwtype=0&supportedlang=japanese%2Cenglish&category1=998&os=win&filter=comingsoon&ndl=1";
const DEFAULT_COLOR = "#ffd166";
const MAX_RULES = 30;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const currentDate = new Date();
const DEFAULT_POPULAR_YEAR = currentDate.getFullYear();
const DEFAULT_POPULAR_MONTH = currentDate.getMonth() + 1;
const MIN_SCREENSHOT_INTERVAL = 0.1;
const MAX_SCREENSHOT_INTERVAL = 1;
const SCREENSHOT_INTERVAL_STEP = 0.1;
const DEFAULT_SCREENSHOT_INTERVAL = 0.6;

const rulesContainer = document.getElementById("rules");
const ruleTemplate = document.getElementById("rule_template");
const addButton = document.getElementById("add_rule");
const saveButton = document.getElementById("save");
const statusElement = document.getElementById("status");
const openInNewTabInput = document.getElementById("open_in_new_tab");
const screenshotIntervalInput = document.getElementById("screenshot_interval");
const screenshotIntervalValueElement = document.getElementById(
  "screenshot_interval_value"
);
const screenshotIntervalStatusElement = document.getElementById(
  "screenshot_interval_status"
);
const comingSoonPageButton = document.getElementById("comingsoon_page");
const popularEnabledInput = document.getElementById("popular_highlight_enabled");
const popularYearInput = document.getElementById("popular_highlight_year");
const popularMonthInput = document.getElementById("popular_highlight_month");
const popularSettingsPanel = document.getElementById("popular_settings_panel");
const popularSettingsSummaryStatusElement = document.getElementById(
  "popular_settings_summary_status"
);
const savePopularSettingsButton = document.getElementById("save_popular_settings");
const openSteamDbPageButton = document.getElementById("open_steamdb_page");
const popularSettingsStatusElement = document.getElementById("popular_settings_status");
const popularStatusElement = document.getElementById("popular_highlight_status");
const geminiEnabledInput = document.getElementById("gemini_translation_enabled");
const geminiApiKeyInput = document.getElementById("gemini_api_key");
const geminiModelSelect = document.getElementById("gemini_model");
const refreshModelsButton = document.getElementById("refresh_models");
const testGeminiButton = document.getElementById("test_gemini");
const clearTranslationCacheButton = document.getElementById("clear_translation_cache");
const translationStatusElement = document.getElementById("translation_status");
const geminiSettingsPanel = document.getElementById("gemini_settings_panel");
const saveGeminiSettingsButton = document.getElementById("save_gemini_settings");
let modelsLoadedApiKey = "";
let savedGeminiEnabled = false;
let savedPopularEnabled = false;
let savedPopularYear = DEFAULT_POPULAR_YEAR;
let savedPopularMonth = DEFAULT_POPULAR_MONTH;
let popularDataStatus = null;
let savedScreenshotInterval = DEFAULT_SCREENSHOT_INTERVAL;
let pendingScreenshotInterval = null;
let screenshotIntervalSaving = false;

function normalizeColor(value) {
  const color = value.trim().toLowerCase();
  return HEX_COLOR_PATTERN.test(color) ? color : null;
}

function normalizeScreenshotInterval(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return DEFAULT_SCREENSHOT_INTERVAL;
  }

  const snappedValue =
    Math.round(numericValue / SCREENSHOT_INTERVAL_STEP) * SCREENSHOT_INTERVAL_STEP;
  return Number(
    Math.min(
      MAX_SCREENSHOT_INTERVAL,
      Math.max(MIN_SCREENSHOT_INTERVAL, snappedValue)
    ).toFixed(1)
  );
}

function displayScreenshotInterval(value) {
  const interval = normalizeScreenshotInterval(value);
  screenshotIntervalInput.value = String(interval);
  screenshotIntervalValueElement.textContent = `${interval.toFixed(1)}秒`;
  return interval;
}

function showScreenshotIntervalStatus(message, isError = false) {
  screenshotIntervalStatusElement.textContent = message;
  screenshotIntervalStatusElement.classList.toggle("error", isError);
}

async function flushScreenshotIntervalSave() {
  if (screenshotIntervalSaving) {
    return;
  }

  screenshotIntervalSaving = true;
  while (pendingScreenshotInterval !== null) {
    const interval = pendingScreenshotInterval;
    pendingScreenshotInterval = null;
    try {
      await chrome.storage.sync.set({
        [SCREENSHOT_INTERVAL_STORAGE_KEY]: interval
      });
      savedScreenshotInterval = interval;
      if (pendingScreenshotInterval === null) {
        showScreenshotIntervalStatus("保存済み");
      }
    } catch (error) {
      if (pendingScreenshotInterval === null) {
        displayScreenshotInterval(savedScreenshotInterval);
        showScreenshotIntervalStatus(
          error.message || "保存できませんでした。",
          true
        );
      }
    }
  }
  screenshotIntervalSaving = false;
}

function updateScreenshotIntervalImmediately() {
  pendingScreenshotInterval = displayScreenshotInterval(
    screenshotIntervalInput.value
  );
  showScreenshotIntervalStatus("保存中…");
  void flushScreenshotIntervalSave();
}

function showStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.classList.toggle("error", isError);
}

function showTranslationStatus(message, isError = false) {
  translationStatusElement.textContent = message;
  translationStatusElement.classList.toggle("error", isError);
}

function showPopularSettingsStatus(message, isError = false) {
  popularSettingsStatusElement.textContent = message;
  popularSettingsStatusElement.classList.toggle("error", isError);
}

function updatePopularSettingsSummary() {
  const period = `${savedPopularYear}年${savedPopularMonth}月`;
  const matchesSavedPeriod =
    Number(popularDataStatus?.year) === savedPopularYear &&
    Number(popularDataStatus?.month) === savedPopularMonth;
  let state = "未取得";
  let stateClass = "";

  if (matchesSavedPeriod && popularDataStatus?.ok === true) {
    state = `${popularDataStatus.count || 0}件取得済み`;
  } else if (matchesSavedPeriod && popularDataStatus?.ok === null) {
    state = "取得中";
    stateClass = "loading";
  } else if (matchesSavedPeriod && popularDataStatus?.ok === false) {
    if (popularDataStatus.cached) {
      state = `${popularDataStatus.count || 0}件保存済み`;
    } else {
      state = "取得失敗";
      stateClass = "error";
    }
  }

  popularSettingsSummaryStatusElement.textContent = `${period}・${state}`;
  popularSettingsSummaryStatusElement.classList.toggle(
    "loading",
    stateClass === "loading"
  );
  popularSettingsSummaryStatusElement.classList.toggle(
    "error",
    stateClass === "error"
  );
}

function getPopularPeriod() {
  const year = Number(popularYearInput.value);
  const month = Number(popularMonthInput.value);
  if (!Number.isInteger(year) || year < 2003 || year > 2100) {
    throw new Error("人気ゲームの年を2003～2100の範囲で入力してください。");
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("人気ゲームの月を選択してください。");
  }
  return { year, month };
}

function buildSteamDbPopularUrl(year, month) {
  const monthText = String(month).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const url = new URL(`https://steamdb.info/stats/gameratings/${year}/`);
  url.searchParams.set("displayOnly", "Game");
  url.searchParams.set("max_release", `${year}-${monthText}-${lastDay}`);
  url.searchParams.set("min_release", `${year}-${monthText}-01`);
  url.searchParams.set("sort", "followers_desc");
  return url.toString();
}

function showPopularStatus(status) {
  popularDataStatus = status || null;
  updatePopularSettingsSummary();
  popularStatusElement.classList.toggle("error", status?.ok === false);
  if (!status || !status.fetchedAt) {
    popularStatusElement.textContent = "まだ一覧を参照していません。";
    return;
  }

  const timestamp = new Date(status.fetchedAt).toLocaleString("ja-JP");
  const period = `${status.year}年${status.month}月`;
  if (status.ok === null) {
    const cacheNote = status.cached
      ? ` 保存済み${status.count}件を表示しながら更新します。`
      : "";
    popularStatusElement.textContent = `${period}: ${status.message || "SteamDBの一覧を読み込んでいます…"}${cacheNote}`;
    return;
  }
  if (status.ok === false) {
    const cacheNote = status.cached
      ? ` 保存済み${status.count}件を使用します。`
      : "";
    popularStatusElement.textContent = `${period}: ${status.message || "取得できませんでした。"}${cacheNote}`;
    return;
  }
  popularStatusElement.textContent = `${period}: ${status.count}件取得 / ${timestamp}`;
}

function formatBackgroundError(response, fallback) {
  const details = [response?.message || fallback];
  if (response?.code) {
    details.push(`コード: ${response.code}`);
  }
  if (response?.status) {
    details.push(`HTTP: ${response.status}`);
  }
  return details.join(" / ");
}

function populateModelOptions(models, selectedModel, preserveMissing = true) {
  const normalized = Array.isArray(models) && models.length > 0
    ? models
    : FALLBACK_GEMINI_MODELS;
  const uniqueModels = new Map();
  for (const model of normalized) {
    if (model && typeof model.id === "string" && model.id) {
      uniqueModels.set(model.id, model);
    }
  }
  if (preserveMissing && selectedModel && !uniqueModels.has(selectedModel)) {
    uniqueModels.set(selectedModel, {
      id: selectedModel,
      displayName: `${selectedModel}（保存済み）`
    });
  }

  geminiModelSelect.replaceChildren();
  for (const model of uniqueModels.values()) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.displayName === model.id
      ? model.id
      : `${model.displayName} — ${model.id}`;
    option.title = model.description || "";
    geminiModelSelect.append(option);
  }
  const firstModel = uniqueModels.keys().next().value || "";
  geminiModelSelect.value = uniqueModels.has(selectedModel)
    ? selectedModel
    : uniqueModels.has(DEFAULT_GEMINI_MODEL)
      ? DEFAULT_GEMINI_MODEL
      : firstModel;
}

async function refreshGeminiModels({ quiet = false } = {}) {
  const apiKey = geminiApiKeyInput.value.trim();
  const selectedModel = geminiModelSelect.value || DEFAULT_GEMINI_MODEL;
  if (!apiKey) {
    if (!quiet) {
      showTranslationStatus("モデル一覧の取得にはAPIキーが必要です。", true);
    }
    return false;
  }

  refreshModelsButton.disabled = true;
  if (!quiet) {
    showTranslationStatus("利用可能なモデルを問い合わせています…");
  }
  try {
    const response = await chrome.runtime.sendMessage({
      type: "steam-fast-check-gemini-list-models",
      apiKey
    });
    if (!response?.ok) {
      throw Object.assign(new Error(formatBackgroundError(
        response,
        "モデル一覧を取得できませんでした。"
      )), { response });
    }
    if (!Array.isArray(response.models) || response.models.length === 0) {
      showTranslationStatus(
        "このAPIキーで利用できるテキスト生成モデルが見つかりませんでした。",
        true
      );
      return false;
    }
    populateModelOptions(response.models, selectedModel, false);
    modelsLoadedApiKey = apiKey;
    const changedModel = geminiModelSelect.value !== selectedModel;
    showTranslationStatus(
      changedModel
        ? `${response.models.length}件取得しました。保存済みモデルは利用できないため、${geminiModelSelect.value}を選択しました。保存してください。`
        : `${response.models.length}件の利用可能モデルを取得しました。`
    );
    return true;
  } catch (error) {
    showTranslationStatus(
      error.message || "モデル一覧を取得できませんでした。",
      true
    );
    return false;
  } finally {
    refreshModelsButton.disabled = false;
  }
}

async function testGeminiConnection() {
  const apiKey = geminiApiKeyInput.value.trim();
  const model = geminiModelSelect.value;
  if (!apiKey) {
    showTranslationStatus("接続テストにはAPIキーが必要です。", true);
    return;
  }

  testGeminiButton.disabled = true;
  showTranslationStatus(`${model} で実翻訳をテストしています…`);
  try {
    const response = await chrome.runtime.sendMessage({
      type: "steam-fast-check-gemini-test",
      apiKey,
      model
    });
    if (!response?.ok) {
      showTranslationStatus(
        formatBackgroundError(response, "接続テストに失敗しました。"),
        true
      );
      return;
    }
    showTranslationStatus(`接続成功: ${response.model} / 訳例「${response.sample}」`);
  } catch (error) {
    showTranslationStatus(error.message || "接続テストに失敗しました。", true);
  } finally {
    testGeminiButton.disabled = false;
  }
}

async function clearTranslationCache() {
  clearTranslationCacheButton.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "steam-fast-check-gemini-clear-cache"
    });
    if (!response?.ok) {
      throw new Error(formatBackgroundError(response, "キャッシュを消去できませんでした。"));
    }
    showTranslationStatus("翻訳キャッシュを消去しました。");
  } catch (error) {
    showTranslationStatus(error.message || "キャッシュを消去できませんでした。", true);
  } finally {
    clearTranslationCacheButton.disabled = false;
  }
}

let draggedRow = null;

function moveRuleRow(row, direction) {
  const sibling = direction < 0
    ? row.previousElementSibling
    : row.nextElementSibling;
  if (!sibling) {
    return;
  }

  if (direction < 0) {
    rulesContainer.insertBefore(row, sibling);
  } else {
    rulesContainer.insertBefore(sibling, row);
  }
  showStatus("");
}

function finishDragging() {
  draggedRow?.classList.remove("dragging");
  draggedRow = null;
}

function addRuleRow(rule = {}) {
  if (rulesContainer.children.length >= MAX_RULES) {
    showStatus(`最大${MAX_RULES}件まで登録できます。`, true);
    return;
  }

  const row = ruleTemplate.content.firstElementChild.cloneNode(true);
  const tagInput = row.querySelector(".tag_input");
  const colorInput = row.querySelector(".color_input");
  const hexInput = row.querySelector(".hex_input");
  const dragHandle = row.querySelector(".drag_handle");
  const removeButton = row.querySelector(".remove_button");
  const color = normalizeColor(rule.color || "") || DEFAULT_COLOR;

  tagInput.value = typeof rule.tag === "string" ? rule.tag : "";
  colorInput.value = color;
  hexInput.value = color;

  colorInput.addEventListener("input", () => {
    hexInput.value = colorInput.value.toLowerCase();
    showStatus("");
  });

  hexInput.addEventListener("input", () => {
    const normalized = normalizeColor(hexInput.value);
    if (normalized) {
      colorInput.value = normalized;
    }
    showStatus("");
  });

  tagInput.addEventListener("input", () => showStatus(""));
  dragHandle.addEventListener("dragstart", (event) => {
    draggedRow = row;
    row.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", "steam-fast-check-tag-rule");
    event.dataTransfer.setDragImage(row, 14, 16);
  });
  dragHandle.addEventListener("dragend", finishDragging);
  dragHandle.addEventListener("keydown", (event) => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      moveRuleRow(row, event.key === "ArrowUp" ? -1 : 1);
    }
  });
  row.addEventListener("dragover", (event) => {
    if (!draggedRow || draggedRow === row) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const bounds = row.getBoundingClientRect();
    const insertAfter = event.clientY >= bounds.top + bounds.height / 2;
    const referenceNode = insertAfter ? row.nextElementSibling : row;
    rulesContainer.insertBefore(draggedRow, referenceNode);
    showStatus("");
  });
  row.addEventListener("drop", (event) => {
    event.preventDefault();
    finishDragging();
  });
  removeButton.addEventListener("click", () => {
    row.remove();
    if (rulesContainer.children.length === 0) {
      addRuleRow();
    }
    showStatus("");
  });

  rulesContainer.append(row);
}

function collectRules() {
  const rules = [];
  const normalizedTags = new Set();

  for (const row of rulesContainer.querySelectorAll(".rule_row")) {
    const tag = row.querySelector(".tag_input").value.trim();
    const color = normalizeColor(row.querySelector(".hex_input").value);

    if (!tag) {
      continue;
    }
    if (!color) {
      throw new Error(`「${tag}」の色を #RRGGBB 形式で入力してください。`);
    }

    const normalizedTag = tag.toLocaleLowerCase();
    if (normalizedTags.has(normalizedTag)) {
      throw new Error(`「${tag}」が重複しています。`);
    }

    normalizedTags.add(normalizedTag);
    rules.push({ tag, color });
  }

  return rules;
}

async function saveGeneralSettings() {
  try {
    const rules = collectRules();
    await chrome.storage.sync.set({
      [STORAGE_KEY]: rules,
      [OPEN_IN_NEW_TAB_STORAGE_KEY]: openInNewTabInput.checked
    });
    showStatus("保存しました。");
  } catch (error) {
    showStatus(error.message || "保存できませんでした。", true);
  }
}

async function savePopularSettings({ quiet = false } = {}) {
  savePopularSettingsButton.disabled = true;
  try {
    const period = getPopularPeriod();
    await chrome.storage.sync.set({
      [POPULAR_YEAR_STORAGE_KEY]: period.year,
      [POPULAR_MONTH_STORAGE_KEY]: period.month
    });
    savedPopularYear = period.year;
    savedPopularMonth = period.month;
    updatePopularSettingsSummary();
    if (!quiet) {
      showPopularSettingsStatus(`${period.year}年${period.month}月を保存しました。`);
    }
    return period;
  } catch (error) {
    showPopularSettingsStatus(error.message || "対象年月を保存できませんでした。", true);
    return null;
  } finally {
    savePopularSettingsButton.disabled = false;
  }
}

async function updatePopularEnabledImmediately() {
  const requestedEnabled = popularEnabledInput.checked;
  popularEnabledInput.disabled = true;
  if (requestedEnabled) {
    popularSettingsPanel.open = true;
  }
  try {
    await chrome.storage.sync.set({
      [POPULAR_ENABLED_STORAGE_KEY]: requestedEnabled
    });
    savedPopularEnabled = requestedEnabled;
    showPopularSettingsStatus(requestedEnabled
      ? "人気ゲームのハイライトをオンにしました。"
      : "人気ゲームのハイライトをオフにしました。"
    );
  } catch (error) {
    popularEnabledInput.checked = savedPopularEnabled;
    showPopularSettingsStatus(
      error.message || "ハイライト設定を変更できませんでした。",
      true
    );
  } finally {
    popularEnabledInput.disabled = false;
  }
}

async function saveGeminiSettings() {
  saveGeminiSettingsButton.disabled = true;
  try {
    const apiKey = geminiApiKeyInput.value.trim();
    const model = geminiModelSelect.value || DEFAULT_GEMINI_MODEL;
    if (savedGeminiEnabled && !apiKey) {
      throw new Error("Gemini翻訳をオフにしてからAPIキーを削除してください。");
    }
    if (apiKey) {
      await chrome.storage.local.set({ [GEMINI_API_KEY_STORAGE_KEY]: apiKey });
    } else {
      await chrome.storage.local.remove(GEMINI_API_KEY_STORAGE_KEY);
    }
    await chrome.storage.sync.set({
      [GEMINI_MODEL_STORAGE_KEY]: model,
      [GEMINI_SETTINGS_REVISION_STORAGE_KEY]: Date.now()
    });
    showTranslationStatus("Gemini API設定を保存しました。");
  } catch (error) {
    showTranslationStatus(error.message || "Gemini設定を保存できませんでした。", true);
  } finally {
    saveGeminiSettingsButton.disabled = false;
  }
}

async function updateGeminiEnabledImmediately() {
  const requestedEnabled = geminiEnabledInput.checked;
  geminiEnabledInput.disabled = true;
  try {
    if (requestedEnabled) {
      const localStored = await chrome.storage.local.get({
        [GEMINI_API_KEY_STORAGE_KEY]: ""
      });
      if (!localStored[GEMINI_API_KEY_STORAGE_KEY]?.trim()) {
        geminiEnabledInput.checked = false;
        geminiSettingsPanel.open = true;
        showTranslationStatus(
          "Gemini翻訳をオンにする前に、APIキーを入力して「API設定を保存」を押してください。",
          true
        );
        return;
      }
    }

    await chrome.storage.sync.set({
      [GEMINI_ENABLED_STORAGE_KEY]: requestedEnabled,
      [GEMINI_SETTINGS_REVISION_STORAGE_KEY]: Date.now()
    });
    savedGeminiEnabled = requestedEnabled;
    showStatus(requestedEnabled
      ? "Gemini翻訳をオンにしました。"
      : "Gemini翻訳をオフにしました。"
    );
  } catch (error) {
    geminiEnabledInput.checked = savedGeminiEnabled;
    showStatus(error.message || "Gemini翻訳の状態を変更できませんでした。", true);
  } finally {
    geminiEnabledInput.disabled = false;
  }
}

async function loadSettings() {
  try {
    const [stored, localStored] = await Promise.all([
      chrome.storage.sync.get({
        [STORAGE_KEY]: [],
        [OPEN_IN_NEW_TAB_STORAGE_KEY]: true,
        [SCREENSHOT_INTERVAL_STORAGE_KEY]: DEFAULT_SCREENSHOT_INTERVAL,
        [POPULAR_ENABLED_STORAGE_KEY]: false,
        [POPULAR_YEAR_STORAGE_KEY]: DEFAULT_POPULAR_YEAR,
        [POPULAR_MONTH_STORAGE_KEY]: DEFAULT_POPULAR_MONTH,
        [GEMINI_ENABLED_STORAGE_KEY]: false,
        [GEMINI_MODEL_STORAGE_KEY]: DEFAULT_GEMINI_MODEL
      }),
      chrome.storage.local.get({
        [GEMINI_API_KEY_STORAGE_KEY]: "",
        [POPULAR_STATUS_STORAGE_KEY]: null
      })
    ]);
    const rules = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
    openInNewTabInput.checked = stored[OPEN_IN_NEW_TAB_STORAGE_KEY] !== false;
    savedScreenshotInterval = displayScreenshotInterval(
      stored[SCREENSHOT_INTERVAL_STORAGE_KEY]
    );
    popularEnabledInput.checked = stored[POPULAR_ENABLED_STORAGE_KEY] === true;
    savedPopularEnabled = popularEnabledInput.checked;
    savedPopularYear = Number(stored[POPULAR_YEAR_STORAGE_KEY]);
    savedPopularMonth = Number(stored[POPULAR_MONTH_STORAGE_KEY]);
    popularYearInput.value = String(savedPopularYear);
    popularMonthInput.value = String(savedPopularMonth);
    showPopularStatus(localStored[POPULAR_STATUS_STORAGE_KEY]);
    geminiEnabledInput.checked = stored[GEMINI_ENABLED_STORAGE_KEY] === true;
    savedGeminiEnabled = geminiEnabledInput.checked;
    geminiEnabledInput.disabled = false;
    geminiApiKeyInput.value = localStored[GEMINI_API_KEY_STORAGE_KEY] || "";
    populateModelOptions(FALLBACK_GEMINI_MODELS, stored[GEMINI_MODEL_STORAGE_KEY]);

    if (rules.length === 0) {
      addRuleRow();
    } else {
      for (const rule of rules.slice(0, MAX_RULES)) {
        addRuleRow(rule);
      }
    }
  } catch {
    openInNewTabInput.checked = true;
    savedScreenshotInterval = displayScreenshotInterval(
      DEFAULT_SCREENSHOT_INTERVAL
    );
    popularEnabledInput.checked = false;
    savedPopularEnabled = false;
    savedPopularYear = DEFAULT_POPULAR_YEAR;
    savedPopularMonth = DEFAULT_POPULAR_MONTH;
    popularYearInput.value = String(DEFAULT_POPULAR_YEAR);
    popularMonthInput.value = String(DEFAULT_POPULAR_MONTH);
    showPopularStatus(null);
    geminiEnabledInput.checked = false;
    savedGeminiEnabled = false;
    geminiEnabledInput.disabled = false;
    populateModelOptions(FALLBACK_GEMINI_MODELS, DEFAULT_GEMINI_MODEL);
    addRuleRow();
    showStatus("設定を読み込めませんでした。", true);
  }
}

addButton.addEventListener("click", () => addRuleRow());
screenshotIntervalInput.addEventListener("input", updateScreenshotIntervalImmediately);
refreshModelsButton.addEventListener("click", () => refreshGeminiModels());
testGeminiButton.addEventListener("click", testGeminiConnection);
clearTranslationCacheButton.addEventListener("click", clearTranslationCache);
saveGeminiSettingsButton.addEventListener("click", saveGeminiSettings);
geminiEnabledInput.addEventListener("change", updateGeminiEnabledImmediately);
savePopularSettingsButton.addEventListener("click", () => savePopularSettings());
popularEnabledInput.addEventListener("change", updatePopularEnabledImmediately);
popularYearInput.addEventListener("input", () => showPopularSettingsStatus(""));
popularMonthInput.addEventListener("change", () => showPopularSettingsStatus(""));
geminiSettingsPanel.addEventListener("toggle", () => {
  const apiKey = geminiApiKeyInput.value.trim();
  if (geminiSettingsPanel.open && apiKey && apiKey !== modelsLoadedApiKey) {
    refreshGeminiModels({ quiet: true });
  }
});
geminiApiKeyInput.addEventListener("input", () => {
  modelsLoadedApiKey = "";
  showTranslationStatus("APIキーを変更した場合は、モデル一覧の更新または接続テストで確認できます。");
});
comingSoonPageButton.addEventListener("click", async () => {
  await chrome.tabs.create({ url: COMING_SOON_CHECK_URL });
  window.close();
});
openSteamDbPageButton.addEventListener("click", async () => {
  try {
    const period = await savePopularSettings({ quiet: true });
    if (!period) {
      return;
    }
    const { year, month } = period;
    await chrome.tabs.create({ url: buildSteamDbPopularUrl(year, month) });
    window.close();
  } catch (error) {
    showStatus(error.message || "SteamDBを開けませんでした。", true);
  }
});
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[POPULAR_STATUS_STORAGE_KEY]) {
    showPopularStatus(changes[POPULAR_STATUS_STORAGE_KEY].newValue);
  }
});
saveButton.addEventListener("click", saveGeneralSettings);
loadSettings();
