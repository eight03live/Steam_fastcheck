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
  if (error instanceof GeminiTranslationError) {
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

async function handleMessage(message) {
  switch (message?.type) {
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type?.startsWith("steam-fast-check-gemini-")) {
    return false;
  }

  handleMessage(message)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse(makeErrorResponse(error)));
  return true;
});
