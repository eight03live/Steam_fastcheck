"use strict";

const ENABLED_STORAGE_KEY = "steamFastCheckGeminiTranslationEnabled";
const MODEL_STORAGE_KEY = "steamFastCheckGeminiModel";
const API_KEY_STORAGE_KEY = "steamFastCheckGeminiApiKey";
const CACHE_STORAGE_KEY = "steamFastCheckGeminiTranslationCacheV1";
const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const MODEL_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const MAX_TEXTS = 160;
const MAX_TOTAL_CHARACTERS = 120000;
const MAX_CACHE_ENTRIES = 60;
const API_ROOT = "https://generativelanguage.googleapis.com/v1beta";
const STEAMDB_CACHE_STORAGE_KEY = "steamFastCheckSteamDbPopularCacheV1";
const STEAMDB_STATUS_STORAGE_KEY = "steamFastCheckSteamDbPopularStatusV1";
const STEAMDB_DATA_REVISION_STORAGE_KEY = "steamFastCheckSteamDbPopularDataRevision";
const STEAMDB_MAX_RESULTS = 100;
const STEAMDB_MIN_YEAR = 2003;
const STEAMDB_MAX_YEAR = 2100;
const steamDbSourceTabs = new Map();
const GAMEPASS_CACHE_STORAGE_KEY = "steamFastCheckGamePassCacheV1";
const GAMEPASS_STATUS_STORAGE_KEY = "steamFastCheckGamePassStatusV1";
const GAMEPASS_DATA_REVISION_STORAGE_KEY = "steamFastCheckGamePassDataRevision";
const GAMEPASS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const GAMEPASS_SIGL_IDS = [
  "609d944c-d395-4c0a-9ea4-e9f39b52c1ad",
  "fdd9e2a7-0fee-49f6-ad69-4354098401ff"
];
const GAMEPASS_MARKETS = [
  { market: "US", language: "en-us" },
  { market: "JP", language: "ja-jp" }
];
const GAMEPASS_BATCH_SIZE = 200;
let gamePassFetchPromise = null;

const storageAccessReady = (async () => {
  if (typeof chrome.storage.local.setAccessLevel === "function") {
    await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  }
})().catch(() => {});

class GeminiTranslationError extends Error {
  constructor(code, phase, message, status = null) {
    super(message);
    this.name = "GeminiTranslationError";
    this.code = code;
    this.phase = phase;
    this.status = status;
  }
}

class SteamDbPopularError extends Error {
  constructor(code, message, status = null) {
    super(message);
    this.name = "SteamDbPopularError";
    this.code = code;
    this.phase = "steamdb";
    this.status = status;
  }
}

class GamePassCatalogError extends Error {
  constructor(code, message, status = null) {
    super(message);
    this.name = "GamePassCatalogError";
    this.code = code;
    this.phase = "gamepass";
    this.status = status;
  }
}

function normalizeModelName(value) {
  const model = typeof value === "string" ? value.replace(/^models\//, "").trim() : "";
  if (!MODEL_NAME_PATTERN.test(model)) {
    throw new GeminiTranslationError(
      "invalid-model",
      "validate",
      "選択されたGeminiモデル名が不正です。"
    );
  }
  return model;
}

function validateApiKey(value) {
  const apiKey = typeof value === "string" ? value.trim() : "";
  if (!apiKey) {
    throw new GeminiTranslationError(
      "api-key-missing",
      "settings",
      "Gemini APIキーが設定されていません。"
    );
  }
  return apiKey;
}

function validateTexts(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TEXTS) {
    throw new GeminiTranslationError(
      "invalid-input",
      "validate",
      "翻訳対象の件数が不正です。"
    );
  }

  const texts = value.map((text) => typeof text === "string" ? text : "");
  const totalCharacters = texts.reduce((total, text) => total + text.length, 0);
  if (texts.some((text) => !text.trim()) || totalCharacters > MAX_TOTAL_CHARACTERS) {
    throw new GeminiTranslationError(
      "invalid-input",
      "validate",
      "翻訳対象の文字数が上限を超えているか、空の文章が含まれています。"
    );
  }
  return texts;
}

function makeErrorResponse(error) {
  if (
    error instanceof GeminiTranslationError ||
    error instanceof SteamDbPopularError ||
    error instanceof GamePassCatalogError
  ) {
    return {
      ok: false,
      code: error.code,
      phase: error.phase,
      message: error.message,
      status: error.status
    };
  }

  return {
    ok: false,
    code: "unexpected-error",
    phase: "background",
    message: error?.message || "予期しないエラーが発生しました。",
    status: null
  };
}

function validateSteamDbPeriod(yearValue, monthValue) {
  const year = Number(yearValue);
  const month = Number(monthValue);
  if (
    !Number.isInteger(year) ||
    year < STEAMDB_MIN_YEAR ||
    year > STEAMDB_MAX_YEAR ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    throw new SteamDbPopularError(
      "invalid-period",
      "SteamDB参照用の年または月が不正です。"
    );
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
  return url;
}

function addSteamDbApp(apps, seenAppIds, appIdValue) {
  const appId = String(appIdValue || "");
  if (!/^\d+$/.test(appId) || seenAppIds.has(appId)) {
    return;
  }
  seenAppIds.add(appId);
  apps.push({ appId, rank: apps.length + 1 });
}

async function readSteamDbCache(cacheKey) {
  await storageAccessReady;
  const stored = await chrome.storage.local.get({
    [STEAMDB_CACHE_STORAGE_KEY]: {}
  });
  const cache = stored[STEAMDB_CACHE_STORAGE_KEY];
  const entry = cache && typeof cache === "object" ? cache[cacheKey] : null;
  return Array.isArray(entry?.apps) ? entry : null;
}

async function writeSteamDbCache(cacheKey, entry) {
  await storageAccessReady;
  const stored = await chrome.storage.local.get({
    [STEAMDB_CACHE_STORAGE_KEY]: {}
  });
  const current = stored[STEAMDB_CACHE_STORAGE_KEY];
  const cache = current && typeof current === "object" ? { ...current } : {};
  cache[cacheKey] = entry;

  const newestEntries = Object.entries(cache)
    .sort((left, right) => (right[1]?.fetchedAt || 0) - (left[1]?.fetchedAt || 0))
    .slice(0, 12);
  await chrome.storage.local.set({
    [STEAMDB_CACHE_STORAGE_KEY]: Object.fromEntries(newestEntries)
  });
}

async function writeSteamDbStatus(status) {
  await storageAccessReady;
  await chrome.storage.local.set({ [STEAMDB_STATUS_STORAGE_KEY]: status });
}

function parseSteamDbSourceUrl(sourceUrlValue) {
  let url;
  try {
    url = new URL(sourceUrlValue);
  } catch {
    throw new SteamDbPopularError(
      "steamdb-invalid-source",
      "SteamDB一覧のURLを確認できませんでした。"
    );
  }

  const yearMatch = url.pathname.match(/^\/stats\/gameratings\/(\d{4})\/?$/);
  const minMatch = (url.searchParams.get("min_release") || "")
    .match(/^(\d{4})-(\d{2})-01$/);
  const maxMatch = (url.searchParams.get("max_release") || "")
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "steamdb.info" ||
    !yearMatch ||
    !minMatch ||
    !maxMatch ||
    url.searchParams.get("displayOnly") !== "Game" ||
    url.searchParams.get("sort") !== "followers_desc"
  ) {
    throw new SteamDbPopularError(
      "steamdb-invalid-source",
      "フォロワー順のSteamDB対象一覧ではありません。"
    );
  }

  const { year, month } = validateSteamDbPeriod(yearMatch[1], minMatch[2]);
  const expectedLastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (
    Number(minMatch[1]) !== year ||
    Number(maxMatch[1]) !== year ||
    Number(maxMatch[2]) !== month ||
    Number(maxMatch[3]) !== expectedLastDay
  ) {
    throw new SteamDbPopularError(
      "steamdb-invalid-source",
      "SteamDB一覧の対象年月を確認できませんでした。"
    );
  }
  return { year, month, sourceUrl: url.toString() };
}

function normalizeSteamDbAppIds(values) {
  if (!Array.isArray(values)) {
    throw new SteamDbPopularError(
      "steamdb-results-missing",
      "SteamDBの上位ゲーム一覧を読み取れませんでした。"
    );
  }

  const apps = [];
  const seenAppIds = new Set();
  for (const value of values) {
    addSteamDbApp(apps, seenAppIds, value);
    if (apps.length >= STEAMDB_MAX_RESULTS) {
      break;
    }
  }
  if (apps.length === 0) {
    throw new SteamDbPopularError(
      "steamdb-results-missing",
      "SteamDBの上位ゲーム一覧を読み取れませんでした。"
    );
  }
  return apps;
}

async function readCachedSteamDbPopularGames(year, month) {
  const cacheKey = `${year}-${String(month).padStart(2, "0")}`;
  const cached = await readSteamDbCache(cacheKey);
  if (!cached) {
    return {
      ok: true,
      year,
      month,
      sourceUrl: buildSteamDbPopularUrl(year, month).toString(),
      fetchedAt: null,
      apps: [],
      cached: false,
      pending: true
    };
  }
  return { ok: true, ...cached, cached: true };
}

async function requestSteamDbPopularGames(yearValue, monthValue, refreshValue) {
  const { year, month } = validateSteamDbPeriod(yearValue, monthValue);
  const cacheKey = `${year}-${String(month).padStart(2, "0")}`;
  const sourceUrl = buildSteamDbPopularUrl(year, month).toString();
  const cachedResponse = await readCachedSteamDbPopularGames(year, month);

  if (refreshValue === false || steamDbSourceTabs.has(cacheKey)) {
    return cachedResponse;
  }

  steamDbSourceTabs.set(cacheKey, null);
  try {
    await writeSteamDbStatus({
      ok: null,
      year,
      month,
      sourceUrl,
      fetchedAt: Date.now(),
      count: cachedResponse.apps.length,
      cached: cachedResponse.apps.length > 0,
      message: "SteamDBの一覧を通常のタブで読み込んでいます…"
    });
    const tab = await chrome.tabs.create({ url: sourceUrl, active: false });
    if (!Number.isInteger(tab?.id)) {
      throw new Error("SteamDB tab id is missing.");
    }
    if (steamDbSourceTabs.has(cacheKey)) {
      steamDbSourceTabs.set(cacheKey, tab.id);
    } else {
      chrome.tabs.remove(tab.id).catch(() => {});
    }
    return { ...cachedResponse, refreshing: true };
  } catch {
    steamDbSourceTabs.delete(cacheKey);
    const error = new SteamDbPopularError(
      "steamdb-tab-open-failed",
      "SteamDBの対象一覧を開けませんでした。設定から一覧を開いてください。"
    );
    const errorResponse = makeErrorResponse(error);
    await writeSteamDbStatus({
      ...errorResponse,
      year,
      month,
      sourceUrl,
      fetchedAt: cachedResponse.fetchedAt || Date.now(),
      count: cachedResponse.apps.length,
      cached: cachedResponse.apps.length > 0
    }).catch(() => {});
    return cachedResponse.apps.length > 0
      ? { ...cachedResponse, stale: true, warning: errorResponse }
      : errorResponse;
  }
}

async function ingestSteamDbPopularGames(message, sender) {
  if (!sender?.url?.startsWith("https://steamdb.info/")) {
    throw new SteamDbPopularError(
      "steamdb-invalid-source",
      "SteamDB以外のページから一覧を受け取ることはできません。"
    );
  }

  const source = parseSteamDbSourceUrl(sender.url);
  if (Number(message.year) !== source.year || Number(message.month) !== source.month) {
    throw new SteamDbPopularError(
      "steamdb-invalid-source",
      "SteamDB一覧の対象年月が一致しません。"
    );
  }
  const apps = normalizeSteamDbAppIds(message.appIds);
  const fetchedAt = Date.now();
  const cacheKey = `${source.year}-${String(source.month).padStart(2, "0")}`;
  const entry = { ...source, fetchedAt, apps };

  await writeSteamDbCache(cacheKey, entry);
  await writeSteamDbStatus({
    ok: true,
    ...source,
    fetchedAt,
    count: apps.length,
    cached: false
  });
  await chrome.storage.sync.set({
    [STEAMDB_DATA_REVISION_STORAGE_KEY]: fetchedAt
  });

  const sourceTabId = steamDbSourceTabs.get(cacheKey);
  steamDbSourceTabs.delete(cacheKey);
  if (Number.isInteger(sourceTabId)) {
    chrome.tabs.remove(sourceTabId).catch(() => {});
  }
  return { ok: true, ...entry, cached: false };
}

async function updateSteamDbSourceStatus(message, sender) {
  if (!sender?.url?.startsWith("https://steamdb.info/")) {
    throw new SteamDbPopularError(
      "steamdb-invalid-source",
      "SteamDB以外のページから状態を受け取ることはできません。"
    );
  }
  const source = parseSteamDbSourceUrl(sender.url);
  if (Number(message.year) !== source.year || Number(message.month) !== source.month) {
    throw new SteamDbPopularError(
      "steamdb-invalid-source",
      "SteamDB一覧の対象年月が一致しません。"
    );
  }
  const cached = await readSteamDbCache(
    `${source.year}-${String(source.month).padStart(2, "0")}`
  );
  const status = {
    ok: false,
    code: "steamdb-browser-check",
    phase: "steamdb",
    message: "開いたSteamDBタブでブラウザー確認を完了してください。ページ本体が表示されると自動で反映します。",
    status: null,
    ...source,
    fetchedAt: Date.now(),
    count: cached?.apps?.length || 0,
    cached: Boolean(cached)
  };
  await writeSteamDbStatus(status);
  if (Number.isInteger(sender.tab?.id)) {
    chrome.tabs.update(sender.tab.id, { active: true }).catch(() => {});
  }
  return status;
}

async function readGamePassCache() {
  await storageAccessReady;
  const stored = await chrome.storage.local.get({
    [GAMEPASS_CACHE_STORAGE_KEY]: null
  });
  const entry = stored[GAMEPASS_CACHE_STORAGE_KEY];
  return entry &&
    typeof entry === "object" &&
    Array.isArray(entry.titles) &&
    Array.isArray(entry.upcomingTitles)
    ? entry
    : null;
}

async function writeGamePassCache(entry) {
  await storageAccessReady;
  await chrome.storage.local.set({
    [GAMEPASS_CACHE_STORAGE_KEY]: entry
  });
}

async function writeGamePassStatus(status) {
  await storageAccessReady;
  await chrome.storage.local.set({
    [GAMEPASS_STATUS_STORAGE_KEY]: status
  });
}

async function fetchGamePassProductIds() {
  const requests = [];
  for (const siglId of GAMEPASS_SIGL_IDS) {
    for (const { market, language } of GAMEPASS_MARKETS) {
      const url = new URL("https://catalog.gamepass.com/sigls/v2");
      url.searchParams.set("id", siglId);
      url.searchParams.set("language", language);
      url.searchParams.set("market", market);
      requests.push(
        fetch(url)
          .then(async (response) => {
            if (!response.ok) {
              throw new GamePassCatalogError(
                "gamepass-sigl-http-error",
                `Xbox Game Pass一覧の取得がHTTP ${response.status}で失敗しました。`,
                response.status
              );
            }
            return response.json();
          })
      );
    }
  }

  const settled = await Promise.allSettled(requests);
  const productIds = [];
  const seenIds = new Set();
  let anySucceeded = false;

  for (const result of settled) {
    if (result.status !== "fulfilled" || !Array.isArray(result.value)) {
      continue;
    }
    anySucceeded = true;
    for (const item of result.value) {
      const id = typeof item?.id === "string" ? item.id.trim().toUpperCase() : "";
      if (/^[A-Z0-9]{10,16}$/.test(id) && !seenIds.has(id)) {
        seenIds.add(id);
        productIds.push(id);
      }
    }
  }

  if (!anySucceeded) {
    const firstError = settled.find((item) => item.status === "rejected")?.reason;
    if (firstError instanceof GamePassCatalogError) {
      throw firstError;
    }
    throw new GamePassCatalogError(
      "gamepass-network-error",
      "Xbox Game PassのカタログAPIへ接続できませんでした。"
    );
  }

  if (productIds.length === 0) {
    throw new GamePassCatalogError(
      "gamepass-empty-catalog",
      "Xbox Game Passの対象ゲームIDを取得できませんでした。"
    );
  }

  return productIds;
}

function parseCatalogReleaseTimestamp(rawDate) {
  if (typeof rawDate !== "string") {
    return null;
  }
  const trimmed = rawDate.trim();
  if (!trimmed || /^999[89]/.test(trimmed) || /^1753/.test(trimmed)) {
    return null;
  }
  const timestamp = Date.parse(trimmed);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function extractProductReleaseTimestamps(product) {
  const timestamps = [];
  const marketProperties = Array.isArray(product?.MarketProperties)
    ? product.MarketProperties
    : [];
  for (const mp of marketProperties) {
    const ts = parseCatalogReleaseTimestamp(mp?.OriginalReleaseDate);
    if (ts !== null) {
      timestamps.push(ts);
    }
  }

  const skuAvailabilities = Array.isArray(product?.DisplaySkuAvailabilities)
    ? product.DisplaySkuAvailabilities
    : [];
  for (const skuEntry of skuAvailabilities) {
    const skuMarketProps = Array.isArray(skuEntry?.Sku?.MarketProperties)
      ? skuEntry.Sku.MarketProperties
      : [];
    for (const smp of skuMarketProps) {
      for (const candidate of [smp?.FirstAvailableDate, smp?.PreOrderReleaseDate]) {
        const ts = parseCatalogReleaseTimestamp(candidate);
        if (ts !== null) {
          timestamps.push(ts);
        }
      }
    }
  }

  return timestamps;
}

async function fetchGamePassTitlesForMarket(productIds, market, language) {
  const products = [];
  let fallbackIndex = 0;
  for (let start = 0; start < productIds.length; start += GAMEPASS_BATCH_SIZE) {
    const batchIds = productIds.slice(start, start + GAMEPASS_BATCH_SIZE);
    const url = new URL("https://displaycatalog.mp.microsoft.com/v7.0/products");
    url.searchParams.set("bigIds", batchIds.join(","));
    url.searchParams.set("market", market);
    url.searchParams.set("languages", language);

    let response;
    try {
      response = await fetch(url);
    } catch {
      throw new GamePassCatalogError(
        "gamepass-network-error",
        "Microsoft Storeの製品カタログAPIへ接続できませんでした。"
      );
    }

    if (!response.ok) {
      throw new GamePassCatalogError(
        "gamepass-catalog-http-error",
        `Microsoft Store製品情報の取得がHTTP ${response.status}で失敗しました。`,
        response.status
      );
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw new GamePassCatalogError(
        "gamepass-invalid-json",
        "Microsoft Storeの製品カタログ応答を読み取れませんでした。",
        response.status
      );
    }

    if (!Array.isArray(data?.Products)) {
      continue;
    }

    for (const product of data.Products) {
      fallbackIndex += 1;
      const productId = typeof product?.ProductId === "string" && product.ProductId.trim()
        ? product.ProductId.trim().toUpperCase()
        : `PRODUCT_${fallbackIndex}`;
      const productTitles = [];
      const localizedList = Array.isArray(product?.LocalizedProperties)
        ? product.LocalizedProperties
        : [];
      for (const localized of localizedList) {
        const productTitle = typeof localized?.ProductTitle === "string"
          ? localized.ProductTitle.trim()
          : "";
        if (productTitle) {
          productTitles.push(productTitle);
        }
      }

      if (productTitles.length > 0) {
        products.push({
          productId,
          titles: productTitles,
          releaseTimestamps: extractProductReleaseTimestamps(product)
        });
      }
    }
  }

  return products;
}

async function fetchFreshGamePassCatalog(cachedEntry = null) {
  await writeGamePassStatus({
    ok: null,
    fetchedAt: Date.now(),
    count: cachedEntry?.count || 0,
    cached: Boolean(cachedEntry?.titles?.length),
    message: "Xbox Game Passの一覧を取得しています…"
  });

  const productIds = await fetchGamePassProductIds();
  const marketResults = await Promise.allSettled(
    GAMEPASS_MARKETS.map(({ market, language }) =>
      fetchGamePassTitlesForMarket(productIds, market, language)
    )
  );

  const productsById = new Map();
  let anyMarketSucceeded = false;
  for (const result of marketResults) {
    if (result.status !== "fulfilled" || !Array.isArray(result.value)) {
      continue;
    }
    anyMarketSucceeded = true;
    for (const item of result.value) {
      if (!item || !Array.isArray(item.titles)) {
        continue;
      }
      const existing = productsById.get(item.productId) || {
        titles: new Set(),
        releaseTimestamps: []
      };
      for (const title of item.titles) {
        if (typeof title === "string" && title.trim()) {
          existing.titles.add(title.trim());
        }
      }
      if (Array.isArray(item.releaseTimestamps)) {
        existing.releaseTimestamps.push(...item.releaseTimestamps);
      }
      productsById.set(item.productId, existing);
    }
  }

  if (!anyMarketSucceeded) {
    const firstError = marketResults.find((item) => item.status === "rejected")?.reason;
    if (firstError instanceof GamePassCatalogError) {
      throw firstError;
    }
    throw new GamePassCatalogError(
      "gamepass-catalog-error",
      "Xbox Game Passのタイトル詳細を取得できませんでした。"
    );
  }

  const fetchedAt = Date.now();
  const upcomingCutoffMs = fetchedAt - 7 * 24 * 60 * 60 * 1000;
  const uniqueTitles = new Set();
  const uniqueUpcomingTitles = new Set();

  for (const product of productsById.values()) {
    const validTimestamps = product.releaseTimestamps.filter((ts) => Number.isFinite(ts));
    const minReleaseTimestamp = validTimestamps.length > 0
      ? Math.min(...validTimestamps)
      : null;
    const isUpcoming =
      minReleaseTimestamp === null || minReleaseTimestamp >= upcomingCutoffMs;

    for (const title of product.titles) {
      uniqueTitles.add(title);
      if (isUpcoming) {
        uniqueUpcomingTitles.add(title);
      }
    }
  }

  const titles = [...uniqueTitles];
  const upcomingTitles = [...uniqueUpcomingTitles];
  if (titles.length === 0) {
    throw new GamePassCatalogError(
      "gamepass-titles-missing",
      "Xbox Game Passのタイトル一覧を読み取れませんでした。"
    );
  }

  const count = productIds.length;
  const entry = { fetchedAt, count, titles, upcomingTitles };

  await writeGamePassCache(entry);
  await writeGamePassStatus({
    ok: true,
    fetchedAt,
    count,
    titleCount: titles.length,
    cached: false
  });
  await chrome.storage.sync.set({
    [GAMEPASS_DATA_REVISION_STORAGE_KEY]: fetchedAt
  });

  return { ok: true, ...entry, cached: false };
}

async function requestGamePassGames(refreshValue) {
  const cached = await readGamePassCache();
  const cacheFresh = Boolean(
    cached &&
    cached.titles.length > 0 &&
    Number.isFinite(cached.fetchedAt) &&
    Date.now() - cached.fetchedAt < GAMEPASS_CACHE_TTL_MS
  );

  if (!refreshValue && cacheFresh) {
    return { ok: true, ...cached, cached: true };
  }

  if (!gamePassFetchPromise) {
    gamePassFetchPromise = fetchFreshGamePassCatalog(cached).finally(() => {
      gamePassFetchPromise = null;
    });
  }

  try {
    return await gamePassFetchPromise;
  } catch (error) {
    const errorResponse = makeErrorResponse(
      error instanceof GamePassCatalogError
        ? error
        : new GamePassCatalogError(
          "gamepass-unexpected-error",
          error?.message || "Xbox Game Passの一覧を取得できませんでした。"
        )
    );
    await writeGamePassStatus({
      ...errorResponse,
      fetchedAt: cached?.fetchedAt || Date.now(),
      count: cached?.count || 0,
      cached: Boolean(cached?.titles?.length)
    }).catch(() => {});

    if (cached && cached.titles.length > 0) {
      return {
        ok: true,
        ...cached,
        cached: true,
        stale: true,
        warning: errorResponse
      };
    }
    return errorResponse;
  }
}

async function parseApiResponse(response, phase) {
  const rawText = await response.text();
  let data = {};
  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch {
      if (response.ok) {
        throw new GeminiTranslationError(
          "invalid-api-response",
          phase,
          "Gemini APIからJSONではない応答が返されました。",
          response.status
        );
      }
    }
  }

  if (!response.ok) {
    let message = data?.error?.message || `Gemini APIがHTTP ${response.status}を返しました。`;
    let code = "api-error";
    if (response.status === 400) {
      code = "bad-request";
    } else if (response.status === 401 || response.status === 403) {
      code = "api-key-rejected";
      message = "APIキーが無効か、このAPIを利用する権限がありません。";
    } else if (response.status === 429) {
      code = "quota-exceeded";
      message = "Gemini APIの利用上限またはレート上限に達しました。";
    } else if (response.status >= 500) {
      code = "gemini-unavailable";
      message = "Gemini APIが一時的に利用できません。時間を置いて再試行してください。";
    }
    throw new GeminiTranslationError(code, phase, message, response.status);
  }

  return data;
}

function isTextGenerationModel(model) {
  const name = typeof model?.name === "string" ? model.name : "";
  const methods = Array.isArray(model?.supportedGenerationMethods)
    ? model.supportedGenerationMethods
    : [];
  const excluded = /(?:embedding|image|imagen|veo|lyria|tts|live|audio|transcribe|robotics|computer-use)/i;
  return (
    name.startsWith("models/gemini-") &&
    methods.includes("generateContent") &&
    !excluded.test(name)
  );
}

async function listModels(apiKeyValue) {
  const apiKey = validateApiKey(apiKeyValue);
  const models = [];
  let pageToken = "";

  for (let page = 0; page < 10; page += 1) {
    const url = new URL(`${API_ROOT}/models`);
    url.searchParams.set("pageSize", "1000");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    let response;
    try {
      response = await fetch(url, {
        headers: { "x-goog-api-key": apiKey }
      });
    } catch {
      throw new GeminiTranslationError(
        "network-error",
        "models-list",
        "Gemini APIへ接続できませんでした。通信状態を確認してください。"
      );
    }

    const data = await parseApiResponse(response, "models-list");
    if (Array.isArray(data.models)) {
      models.push(...data.models.filter(isTextGenerationModel));
    }
    pageToken = typeof data.nextPageToken === "string" ? data.nextPageToken : "";
    if (!pageToken) {
      break;
    }
  }

  const normalized = models.map((model) => ({
    id: normalizeModelName(model.name),
    displayName: model.displayName || normalizeModelName(model.name),
    description: model.description || "",
    inputTokenLimit: Number(model.inputTokenLimit) || null,
    outputTokenLimit: Number(model.outputTokenLimit) || null
  }));
  normalized.sort((left, right) => left.displayName.localeCompare(right.displayName, "ja"));
  return normalized;
}

function hashTexts(model, texts) {
  const input = `${model}\u0000${texts.join("\u0001")}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `v1-${(hash >>> 0).toString(16)}-${input.length}`;
}

async function readCache(cacheKey) {
  await storageAccessReady;
  const stored = await chrome.storage.local.get({ [CACHE_STORAGE_KEY]: {} });
  const cache = stored[CACHE_STORAGE_KEY];
  const entry = cache && typeof cache === "object" ? cache[cacheKey] : null;
  return Array.isArray(entry?.translations) ? entry.translations : null;
}

async function writeCache(cacheKey, translations) {
  await storageAccessReady;
  const stored = await chrome.storage.local.get({ [CACHE_STORAGE_KEY]: {} });
  const current = stored[CACHE_STORAGE_KEY];
  const cache = current && typeof current === "object" ? { ...current } : {};
  cache[cacheKey] = { translations, createdAt: Date.now() };

  const entries = Object.entries(cache).sort(
    (left, right) => (right[1]?.createdAt || 0) - (left[1]?.createdAt || 0)
  );
  await chrome.storage.local.set({
    [CACHE_STORAGE_KEY]: Object.fromEntries(entries.slice(0, MAX_CACHE_ENTRIES))
  });
}

function extractGeneratedText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    const reason = data?.promptFeedback?.blockReason;
    throw new GeminiTranslationError(
      reason ? "response-blocked" : "empty-response",
      "response",
      reason
        ? `Geminiが応答を生成できませんでした（${reason}）。`
        : "Geminiから翻訳結果が返されませんでした。"
    );
  }
  return parts.map((part) => typeof part.text === "string" ? part.text : "").join("");
}

async function requestTranslationItems(apiKey, model, items) {
  const prompt = [
    "You are a professional game-store translator.",
    "The input is text from a Steam game description.",
    "Translate every item's text from English into natural Japanese.",
    "Preserve game titles, proper names, product names, placeholders, and line breaks when appropriate.",
    "Keep the tone suitable for a Steam store description.",
    "Return every input id exactly once with its Japanese translation, including duplicate or similar text.",
    "Do not add commentary, merge entries, change ids, or omit entries.",
    "Input JSON:",
    JSON.stringify(items)
  ].join("\n");

  let response;
  try {
    response = await fetch(
      `${API_ROOT}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: {
              type: "object",
              properties: {
                translations: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      translation: { type: "string" }
                    },
                    required: ["id", "translation"]
                  }
                }
              },
              required: ["translations"]
            }
          }
        })
      }
    );
  } catch {
    throw new GeminiTranslationError(
      "network-error",
      "generate-content",
      "Gemini APIへ接続できませんでした。通信状態を確認してください。"
    );
  }

  const data = await parseApiResponse(response, "generate-content");
  let parsed;
  try {
    parsed = JSON.parse(extractGeneratedText(data));
  } catch (error) {
    if (error instanceof GeminiTranslationError) {
      throw error;
    }
    throw new GeminiTranslationError(
      "invalid-translation-json",
      "response",
      "Geminiの翻訳結果を読み取れませんでした。"
    );
  }

  if (!Array.isArray(parsed?.translations)) {
    throw new GeminiTranslationError(
      "invalid-translation-response",
      "response",
      "Geminiの翻訳結果にtranslations配列がありませんでした。"
    );
  }

  const expectedIds = new Set(items.map((item) => item.id));
  const translatedById = new Map();
  for (const result of parsed.translations) {
    if (
      typeof result?.id === "string" &&
      expectedIds.has(result.id) &&
      typeof result.translation === "string" &&
      result.translation.trim()
    ) {
      translatedById.set(result.id, result.translation);
    }
  }
  return translatedById;
}

async function requestTranslations(apiKey, model, texts) {
  const items = texts.map((text, index) => ({
    id: `segment-${index + 1}`,
    text
  }));
  const translatedById = await requestTranslationItems(apiKey, model, items);
  let missingItems = items.filter((item) => !translatedById.has(item.id));

  if (missingItems.length > 0) {
    const retryResults = await requestTranslationItems(apiKey, model, missingItems);
    for (const [id, translation] of retryResults) {
      translatedById.set(id, translation);
    }
    missingItems = items.filter((item) => !translatedById.has(item.id));
  }

  if (missingItems.length > 0) {
    throw new GeminiTranslationError(
      "translation-count-mismatch",
      "response-retry",
      `Geminiが${items.length}件中${items.length - missingItems.length}件しか返しませんでした。欠けた${missingItems.length}件を再試行しても取得できませんでした。`
    );
  }

  return items.map((item) => translatedById.get(item.id));
}

async function translate(message) {
  await storageAccessReady;
  const texts = validateTexts(message.texts);
  const syncSettings = await chrome.storage.sync.get({
    [ENABLED_STORAGE_KEY]: false,
    [MODEL_STORAGE_KEY]: DEFAULT_MODEL
  });
  if (syncSettings[ENABLED_STORAGE_KEY] !== true) {
    throw new GeminiTranslationError(
      "translation-disabled",
      "settings",
      "Gemini翻訳は設定でオフになっています。"
    );
  }

  const model = normalizeModelName(syncSettings[MODEL_STORAGE_KEY] || DEFAULT_MODEL);
  const localSettings = await chrome.storage.local.get({ [API_KEY_STORAGE_KEY]: "" });
  const apiKey = validateApiKey(localSettings[API_KEY_STORAGE_KEY]);
  const cacheKey = hashTexts(model, texts);
  let cachedTranslations = null;
  try {
    cachedTranslations = await readCache(cacheKey);
  } catch {
    // キャッシュが壊れていても、Geminiへの翻訳要求は続行する。
  }
  if (cachedTranslations?.length === texts.length) {
    return { ok: true, translations: cachedTranslations, model, cached: true };
  }

  const translations = await requestTranslations(apiKey, model, texts);
  let cacheStored = true;
  try {
    await writeCache(cacheKey, translations);
  } catch {
    cacheStored = false;
  }
  return { ok: true, translations, model, cached: false, cacheStored };
}

async function testConnection(message) {
  await storageAccessReady;
  const apiKey = validateApiKey(message.apiKey);
  const model = normalizeModelName(message.model || DEFAULT_MODEL);
  const translations = await requestTranslations(apiKey, model, ["A short game description."]);
  return { ok: true, model, sample: translations[0] };
}

async function handleMessage(message, sender) {
  switch (message?.type) {
    case "steam-fast-check-steamdb-top-games":
      return requestSteamDbPopularGames(
        message.year,
        message.month,
        message.refresh
      );
    case "steam-fast-check-steamdb-ingest-games":
      return ingestSteamDbPopularGames(message, sender);
    case "steam-fast-check-steamdb-source-status":
      return updateSteamDbSourceStatus(message, sender);
    case "steam-fast-check-gamepass-games":
      return requestGamePassGames(message.refresh);
    case "steam-fast-check-gemini-translate":
      return translate(message);
    case "steam-fast-check-gemini-list-models":
      return { ok: true, models: await listModels(message.apiKey) };
    case "steam-fast-check-gemini-test":
      return testConnection(message);
    case "steam-fast-check-gemini-clear-cache":
      await storageAccessReady;
      await chrome.storage.local.remove(CACHE_STORAGE_KEY);
      return { ok: true };
    default:
      return null;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type?.startsWith("steam-fast-check-")) {
    return false;
  }

  handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse(makeErrorResponse(error)));
  return true;
});

chrome.tabs?.onRemoved?.addListener((tabId) => {
  for (const [cacheKey, sourceTabId] of steamDbSourceTabs) {
    if (sourceTabId === tabId) {
      steamDbSourceTabs.delete(cacheKey);
    }
  }
});
