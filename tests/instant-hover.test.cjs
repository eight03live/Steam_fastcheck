const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const scriptPath = path.join(__dirname, "..", "src", "instant-hover.js");
const extensionScript = fs.readFileSync(scriptPath, "utf8");
const screenshotCssPath = path.join(__dirname, "..", "src", "fast-screenshots.css");
const screenshotCss = fs.readFileSync(screenshotCssPath, "utf8");
const screenshotIntervalScriptPath = path.join(
  __dirname,
  "..",
  "src",
  "screenshot-interval.js"
);
const screenshotIntervalScript = fs.readFileSync(
  screenshotIntervalScriptPath,
  "utf8"
);
const tagScriptPath = path.join(__dirname, "..", "src", "search-tags.js");
const tagScript = fs.readFileSync(tagScriptPath, "utf8");
const tagCssPath = path.join(__dirname, "..", "src", "search-tags.css");
const tagCss = fs.readFileSync(tagCssPath, "utf8");
const friendScriptPath = path.join(__dirname, "..", "src", "friend-borders.js");
const friendScript = fs.readFileSync(friendScriptPath, "utf8");
const friendCssPath = path.join(__dirname, "..", "src", "friend-borders.css");
const friendCss = fs.readFileSync(friendCssPath, "utf8");
const countMarkerScriptPath = path.join(
  __dirname,
  "..",
  "src",
  "result-count-markers.js"
);
const countMarkerScript = fs.readFileSync(countMarkerScriptPath, "utf8");
const countMarkerCssPath = path.join(
  __dirname,
  "..",
  "src",
  "result-count-markers.css"
);
const countMarkerCss = fs.readFileSync(countMarkerCssPath, "utf8");
const popularHighlightScriptPath = path.join(
  __dirname,
  "..",
  "src",
  "popular-game-highlights.js"
);
const popularHighlightScript = fs.readFileSync(popularHighlightScriptPath, "utf8");
const steamDbSourceScriptPath = path.join(
  __dirname,
  "..",
  "src",
  "steamdb-popular-source.js"
);
const steamDbSourceScript = fs.readFileSync(steamDbSourceScriptPath, "utf8");
const manifestPath = path.join(__dirname, "..", "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const popupScriptPath = path.join(__dirname, "..", "popup", "popup.js");
const popupScript = fs.readFileSync(popupScriptPath, "utf8");
const popupHtmlPath = path.join(__dirname, "..", "popup", "popup.html");
const popupHtml = fs.readFileSync(popupHtmlPath, "utf8");
const geminiBackgroundPath = path.join(
  __dirname,
  "..",
  "background",
  "gemini-translation.js"
);
const geminiBackgroundScript = fs.readFileSync(geminiBackgroundPath, "utf8");
const geminiContentPath = path.join(
  __dirname,
  "..",
  "src",
  "gemini-translation.js"
);
const geminiContentScript = fs.readFileSync(geminiContentPath, "utf8");
const geminiCssPath = path.join(
  __dirname,
  "..",
  "src",
  "gemini-translation.css"
);
const geminiCss = fs.readFileSync(geminiCssPath, "utf8");

test("Steamのホバー待機時間とフェード時間だけを0msにする", () => {
  const observedDelays = [];
  const observedFadeSpeeds = [];
  let nextTimerId = 1;

  const nativeSetTimeout = (callback, delay, ...args) => {
    observedDelays.push(delay);
    callback(...args);
    return nextTimerId++;
  };

  const window = {
    setTimeout: nativeSetTimeout,
    setInterval: () => nextTimerId++,
    clearInterval: () => {},
    ShowGameHover(...args) {
      observedFadeSpeeds.push(args[4]);
    },
    GameHover() {
      window.setTimeout(() => window.ShowGameHover(null, null, null, null, 200), 150);
      window.setTimeout(() => window.ShowGameHover(null, null, null, null, 200), 300);
    }
  };

  vm.runInNewContext(extensionScript, { window });
  window.GameHover();

  assert.deepEqual(observedDelays, [0, 0]);
  assert.deepEqual(observedFadeSpeeds, [0, 0]);
  assert.equal(window.setTimeout, nativeSetTimeout);

  window.setTimeout(() => {}, 999);
  assert.deepEqual(observedDelays, [0, 0, 999]);
});

test("二重読み込み時にラッパーを重ねない", () => {
  const window = {
    setTimeout,
    setInterval,
    clearInterval,
    ShowGameHover() {},
    GameHover() {}
  };

  vm.runInNewContext(extensionScript, { window, setTimeout, setInterval, clearInterval });
  const firstGameHover = window.GameHover;
  const firstShowGameHover = window.ShowGameHover;

  vm.runInNewContext(extensionScript, { window, setTimeout, setInterval, clearInterval });

  assert.equal(window.GameHover, firstGameHover);
  assert.equal(window.ShowGameHover, firstShowGameHover);
});

test("スクリーンショットをフェードなしで設定した間隔に切り替える", () => {
  assert.match(
    screenshotCss,
    /animation-duration:\s*var\(--steam-fast-check-screenshot-cycle,\s*2\.4s\)\s*!important/
  );
  assert.match(screenshotCss, /animation-timing-function:\s*steps\(1,\s*end\)\s*!important/);
  assert.match(screenshotCss, /#global_hover\s*\{[^}]*transition:\s*none\s*!important/s);
  assert.match(
    screenshotCss,
    /\.screenshot\s*\{[^}]*transition:\s*none\s*!important/s
  );

  for (const [child, delayPattern] of [
    [1, "0s"],
    [2, "var\\(--steam-fast-check-screenshot-delay-2,\\s*0\\.6s\\)"],
    [3, "var\\(--steam-fast-check-screenshot-delay-3,\\s*1\\.2s\\)"],
    [4, "var\\(--steam-fast-check-screenshot-delay-4,\\s*1\\.8s\\)"]
  ]) {
    const rule = new RegExp(
      `screenshot:nth-child\\(${child}\\)\\s*\\{[^}]*animation-delay:\\s*${delayPattern}\\s*!important`,
      "s"
    );
    assert.match(screenshotCss, rule);
  }
});

test("保存した切り替え時間をCSS変数へ反映し、0.1秒刻みに補正する", async () => {
  const styleValues = new Map();
  let storageChangeListener;
  const document = {
    documentElement: {
      style: {
        setProperty(name, value) {
          styleValues.set(name, value);
        }
      }
    }
  };
  const chrome = {
    storage: {
      sync: {
        async get(defaults) {
          return {
            ...defaults,
            steamFastCheckScreenshotIntervalSeconds: 0.8
          };
        }
      },
      onChanged: {
        addListener(listener) {
          storageChangeListener = listener;
        }
      }
    }
  };

  vm.runInNewContext(screenshotIntervalScript, { chrome, document });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(styleValues.get("--steam-fast-check-screenshot-cycle"), "3.2s");
  assert.equal(styleValues.get("--steam-fast-check-screenshot-delay-2"), "0.8s");
  assert.equal(styleValues.get("--steam-fast-check-screenshot-delay-3"), "1.6s");
  assert.equal(styleValues.get("--steam-fast-check-screenshot-delay-4"), "2.4s");

  storageChangeListener(
    {
      steamFastCheckScreenshotIntervalSeconds: { newValue: 0.14 }
    },
    "sync"
  );
  assert.equal(styleValues.get("--steam-fast-check-screenshot-cycle"), "0.4s");
  assert.equal(styleValues.get("--steam-fast-check-screenshot-delay-4"), "0.3s");
});

test("無限スクロールの検索結果へ100件ごとの区切りを追加する", async () => {
  class FakeNode {
    constructor({ isRow = false } = {}) {
      this.nodeType = 1;
      this.isRow = isRow;
      this.parentElement = null;
      this.className = "";
      this.dataset = {};
      this.attributes = new Map();
      this.textContent = "";
    }

    get nextElementSibling() {
      if (!this.parentElement) {
        return null;
      }
      const index = this.parentElement.children.indexOf(this);
      return this.parentElement.children[index + 1] || null;
    }

    after(node) {
      const parent = this.parentElement;
      if (!parent) {
        return;
      }
      node.remove();
      const index = parent.children.indexOf(this);
      parent.children.splice(index + 1, 0, node);
      node.parentElement = parent;
    }

    remove() {
      if (!this.parentElement) {
        return;
      }
      const index = this.parentElement.children.indexOf(this);
      if (index >= 0) {
        this.parentElement.children.splice(index, 1);
      }
      this.parentElement = null;
    }

    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    }
  }

  class FakeContainer extends FakeNode {
    constructor() {
      super();
      this.children = [];
    }

    append(...nodes) {
      for (const node of nodes) {
        node.remove();
        node.parentElement = this;
        this.children.push(node);
      }
    }

    querySelectorAll(selector) {
      if (selector === "a.search_result_row") {
        return this.children.filter((child) => child.isRow);
      }
      if (selector === ".steam_fast_check_count_marker") {
        return this.children.filter(
          (child) => child.className === "steam_fast_check_count_marker"
        );
      }
      return [];
    }
  }

  const rowsContainer = new FakeContainer();
  const resultsRoot = new FakeContainer();
  const rows = Array.from({ length: 205 }, () => new FakeNode({ isRow: true }));
  rowsContainer.append(...rows);

  let observerCallback;
  class FakeMutationObserver {
    constructor(callback) {
      observerCallback = callback;
    }

    observe() {}
  }

  const document = {
    createElement: () => new FakeNode(),
    getElementById(id) {
      if (id === "search_results") {
        return resultsRoot;
      }
      return id === "search_resultsRows" ? rowsContainer : null;
    }
  };

  vm.runInNewContext(countMarkerScript, {
    MutationObserver: FakeMutationObserver,
    document,
    queueMicrotask,
    window: {}
  });
  await new Promise((resolve) => setImmediate(resolve));

  const getMarkers = () =>
    rowsContainer.querySelectorAll(".steam_fast_check_count_marker");
  assert.deepEqual(
    getMarkers().map((marker) => marker.textContent),
    ["100件", "200件"]
  );
  assert.equal(rows[99].nextElementSibling.textContent, "100件");
  assert.equal(rows[199].nextElementSibling.textContent, "200件");
  assert.equal(getMarkers()[0].attributes.get("data-ds-itemkey"), "");

  const appendedRows = Array.from(
    { length: 100 },
    () => new FakeNode({ isRow: true })
  );
  rowsContainer.append(...appendedRows);
  observerCallback();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(
    getMarkers().map((marker) => marker.textContent),
    ["100件", "200件", "300件"]
  );
  assert.equal(appendedRows[94].nextElementSibling.textContent, "300件");
  assert.match(countMarkerCss, /height:\s*1px/);
});

test("指定タグを検索行で優先表示し、ホバータグも同じ色で強調する", async () => {
  class FakeClassList {
    constructor() {
      this.values = new Set();
    }

    add(...values) {
      for (const value of values) {
        this.values.add(value);
      }
    }

    remove(...values) {
      for (const value of values) {
        this.values.delete(value);
      }
    }

    contains(value) {
      return this.values.has(value);
    }
  }

  class FakeElement {
    constructor() {
      this.nodeType = 1;
      this.children = [];
      this.classList = new FakeClassList();
      this.dataset = {};
      this.title = "";
      this.textContent = "";
      this.styleValues = new Map();
      this.style = {
        removeProperty: (name) => this.styleValues.delete(name),
        setProperty: (name, value) => this.styleValues.set(name, value)
      };
    }

    append(child) {
      this.children.push(child);
    }

    replaceChildren(fragment) {
      this.children = [...fragment.children];
    }

    matches() {
      return false;
    }

    querySelectorAll() {
      return [];
    }
  }

  const makeRow = (tagIds, popularRank = null) => {
    const platformArea = new FakeElement();
    platformArea.children.push({ className: "platform_img win" });

    return {
      nodeType: 1,
      dataset: popularRank
        ? { steamFastCheckPopularRank: String(popularRank) }
        : {},
      platformArea,
      getAttribute(name) {
        return name === "data-ds-tagids" ? JSON.stringify(tagIds) : null;
      },
      removeAttribute(name) {
        delete this[name];
      },
      matches(selector) {
        return selector === "a.search_result_row";
      },
      querySelector(selector) {
        return selector === ".search_platforms" ? platformArea : null;
      },
      querySelectorAll() {
        return [];
      }
    };
  };

  const tagControls = [
    ["122", "RPG"],
    ["3799", "ビジュアルノベル"],
    ["3871", "2D"],
    ["5350", "家族向け"]
  ].map(([value, loc]) => ({ dataset: { value, loc } }));
  const initialRow = makeRow([122, 3799, 3871, 5350], 4);
  const observerCallbacks = [];
  const documentListeners = new Map();
  let storageChangeListener;
  const documentBody = new FakeElement();

  const document = {
    createDocumentFragment: () => new FakeElement(),
    createElement: () => new FakeElement(),
    addEventListener(type, listener, capture) {
      documentListeners.set(`${type}:${capture}`, listener);
    },
    getElementById: () => new FakeElement(),
    body: documentBody,
    querySelectorAll(selector) {
      if (selector.includes("TagFilter_Container")) {
        return tagControls;
      }
      return selector === "a.search_result_row" ? [initialRow] : [];
    }
  };

  class FakeMutationObserver {
    constructor(callback) {
      observerCallbacks.push(callback);
    }

    observe() {}
  }

  const window = {};
  const chrome = {
    storage: {
      sync: {
        get: async () => ({
          steamFastCheckTagHighlightRules: [
            { tag: "家族向け", color: "#ffd166" },
            { tag: "TOP100", color: "#ff7a7a" },
            { tag: "2D", color: "#88ccff" }
          ],
          steamFastCheckOpenSearchResultsInNewTab: true
        })
      },
      onChanged: {
        addListener(listener) {
          storageChangeListener = listener;
        }
      }
    }
  };
  vm.runInNewContext(tagScript, {
    chrome,
    document,
    MutationObserver: FakeMutationObserver,
    window
  });

  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(
    initialRow.platformArea.children.map((child) => child.textContent),
    ["家族向け", "TOP100", "2D", "+2"]
  );
  assert.equal(
    initialRow.platformArea.title,
    "TOP100（SteamDBフォロワー第4位） / RPG / ビジュアルノベル / 2D / 家族向け"
  );
  assert.equal(
    initialRow.platformArea.children[1].className,
    "steam_fast_check_tag steam_fast_check_popular_tag"
  );
  assert.ok(initialRow.platformArea.classList.contains("steam_fast_check_tags"));
  assert.equal(initialRow.target, "_blank");
  assert.equal(initialRow.rel, "noopener noreferrer");
  assert.ok(
    initialRow.platformArea.children[0].classList.contains(
      "steam_fast_check_tag_highlight"
    )
  );
  assert.equal(
    initialRow.platformArea.children[0].styleValues.get(
      "--steam-fast-check-tag-highlight-color"
    ),
    "#ffd166"
  );
  assert.ok(
    initialRow.platformArea.children[1].classList.contains(
      "steam_fast_check_tag_highlight"
    )
  );
  assert.equal(
    initialRow.platformArea.children[1].styleValues.get(
      "--steam-fast-check-tag-highlight-color"
    ),
    "#ff7a7a"
  );

  storageChangeListener(
    {
      steamFastCheckTagHighlightRules: {
        newValue: [
          { tag: "家族向け", color: "#ffd166" },
          { tag: "2D", color: "#88ccff" },
          { tag: "RPG", color: "#99dd88" },
          { tag: "TOP100", color: "#ff7a7a" }
        ]
      }
    },
    "sync"
  );
  assert.deepEqual(
    initialRow.platformArea.children.map((child) => child.textContent),
    ["家族向け", "2D", "TOP100", "+2"]
  );
  assert.equal(
    initialRow.platformArea.children[2].styleValues.get(
      "--steam-fast-check-tag-highlight-color"
    ),
    "#ff7a7a"
  );

  const appendedRow = makeRow([3871, 122]);
  observerCallbacks[0]([{ addedNodes: [appendedRow] }]);
  assert.deepEqual(
    appendedRow.platformArea.children.map((child) => child.textContent),
    ["2D", "RPG"]
  );
  assert.equal(appendedRow.target, "_blank");
  assert.equal(appendedRow.rel, "noopener noreferrer");

  let propagationStopped = false;
  let defaultPrevented = false;
  documentListeners.get("click:true")({
    target: {
      closest: (selector) => selector === "a.search_result_row" ? appendedRow : null
    },
    preventDefault() {
      defaultPrevented = true;
    },
    stopImmediatePropagation() {
      propagationStopped = true;
    }
  });
  assert.equal(propagationStopped, true);
  assert.equal(defaultPrevented, false);
  assert.equal(appendedRow.target, "_blank");

  storageChangeListener(
    { steamFastCheckOpenSearchResultsInNewTab: { newValue: false } },
    "sync"
  );
  assert.equal(initialRow.target, undefined);
  assert.equal(initialRow.rel, undefined);

  propagationStopped = false;
  documentListeners.get("click:true")({
    target: {
      closest: (selector) => selector === "a.search_result_row" ? initialRow : null
    },
    stopImmediatePropagation() {
      propagationStopped = true;
    }
  });
  assert.equal(propagationStopped, false);

  storageChangeListener(
    { steamFastCheckOpenSearchResultsInNewTab: { newValue: true } },
    "sync"
  );
  assert.equal(initialRow.target, "_blank");
  assert.equal(initialRow.rel, "noopener noreferrer");

  const hoverTag = new FakeElement();
  hoverTag.textContent = "家族向け";
  hoverTag.matches = (selector) =>
    selector === "#global_hover .hover_tag_row .app_tag";
  observerCallbacks[1]([{ addedNodes: [hoverTag] }]);
  assert.ok(hoverTag.classList.contains("steam_fast_check_tag_highlight"));
  assert.equal(
    hoverTag.styleValues.get("--steam-fast-check-tag-highlight-color"),
    "#ffd166"
  );

  storageChangeListener(
    {
      steamFastCheckTagHighlightRules: {
        newValue: [{ tag: "家族向け", color: "#88ccff" }]
      }
    },
    "sync"
  );
  assert.equal(
    initialRow.platformArea.children[1].styleValues.get(
      "--steam-fast-check-tag-highlight-color"
    ),
    "#88ccff"
  );
  assert.deepEqual(
    initialRow.platformArea.children.map((child) => child.textContent),
    ["TOP100", "家族向け", "RPG", "+2"]
  );

  delete initialRow.dataset.steamFastCheckPopularRank;
  documentListeners.get("steam-fast-check-popular-tags-changed:undefined")();
  assert.deepEqual(
    initialRow.platformArea.children.map((child) => child.textContent),
    ["家族向け", "RPG", "ビジュアルノベル", "+1"]
  );
  assert.match(tagCss, /\.steam_fast_check_popular_tag/);
  assert.match(tagCss, /background:\s*#f3c243/);
});

test("フレンド人数を4段階の枠クラスへ変換する", async () => {
  class FakeClassList {
    constructor() {
      this.values = new Set();
    }

    add(...values) {
      for (const value of values) {
        this.values.add(value);
      }
    }

    remove(...values) {
      for (const value of values) {
        this.values.delete(value);
      }
    }

    contains(value) {
      return this.values.has(value);
    }
  }

  const makeRow = (appId) => ({
    nodeType: 1,
    classList: new FakeClassList(),
    dataset: { dsAppid: appId },
    matches: (selector) => selector === "a.search_result_row",
    querySelectorAll: () => []
  });

  const rows = ["1001", "1002", "1003", "1004", "1005"].map(makeRow);
  const friendCounts = new Map([
    ["1001", 1],
    ["1002", 2],
    ["1003", 3],
    ["1004", 5],
    ["1005", 0]
  ]);

  class FakeIntersectionObserver {
    constructor(callback) {
      this.callback = callback;
    }

    observe(target) {
      this.callback([{ isIntersecting: true, target }]);
    }

    unobserve() {}
  }

  class FakeMutationObserver {
    observe() {}
  }

  class FakeDOMParser {
    parseFromString(html) {
      return {
        querySelectorAll: () => ({ length: Number(html) })
      };
    }
  }

  const document = {
    getElementById: () => ({}),
    querySelectorAll: (selector) =>
      selector === "a.search_result_row" ? rows : []
  };
  const fetch = async (url) => {
    const appId = url.pathname.split("/").pop();
    return {
      ok: true,
      text: async () => String(friendCounts.get(appId))
    };
  };

  vm.runInNewContext(friendScript, {
    DOMParser: FakeDOMParser,
    IntersectionObserver: FakeIntersectionObserver,
    MutationObserver: FakeMutationObserver,
    URL,
    document,
    fetch,
    location: { origin: "https://store.steampowered.com" },
    window: {}
  });

  for (let index = 0; index < 3; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.ok(rows[0].classList.contains("steam_fast_check_friend_wishlist_1"));
  assert.ok(rows[1].classList.contains("steam_fast_check_friend_wishlist_2"));
  assert.ok(rows[2].classList.contains("steam_fast_check_friend_wishlist_3"));
  assert.ok(rows[3].classList.contains("steam_fast_check_friend_wishlist_4plus"));
  assert.equal(
    [...rows[4].classList.values].some((value) =>
      value.startsWith("steam_fast_check_friend_wishlist_")
    ),
    false
  );

  assert.equal(rows[0].dataset.steamFastCheckFriendWishlistCount, "1");
  assert.equal(rows[3].dataset.steamFastCheckFriendWishlistCount, "5");
});

test("フレンド人数別の仮色を明るい4色で定義する", () => {
  for (const color of ["#c9efff", "#fff1a8", "#ffb8b8", "#e3bdff"]) {
    assert.match(friendCss, new RegExp(color, "i"));
  }
  assert.match(friendCss, /border-width:\s*2px\s*!important/);
});

test("拡張アイコンの設定ポップアップから各設定を保存する", () => {
  assert.equal(manifest.name, "Steam Fast Check");
  assert.equal(manifest.version, "1.2.1");
  assert.equal(manifest.action.default_title, "Steam Fast Check 設定");
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.deepEqual(manifest.host_permissions, [
    "https://generativelanguage.googleapis.com/*",
    "https://steamdb.info/*"
  ]);
  assert.equal(
    manifest.background.service_worker,
    "background/gemini-translation.js"
  );
  assert.equal(manifest.action.default_popup, "popup/popup.html");
  assert.match(popupScript, /chrome\.storage\.sync\.get/);
  assert.match(popupScript, /chrome\.storage\.sync\.set/);
  assert.match(popupScript, /steamFastCheckTagHighlightRules/);
  assert.match(popupScript, /steamFastCheckOpenSearchResultsInNewTab/);
  assert.match(popupHtml, /id="open_in_new_tab"/);
  assert.match(popupHtml, /ゲームを新しいタブで開く/);
  assert.match(
    popupHtml,
    /id="screenshot_interval"[\s\S]*?type="range"[\s\S]*?min="0\.1"[\s\S]*?max="1"[\s\S]*?step="0\.1"/
  );
  assert.doesNotMatch(popupHtml, /1枚を表示する時間です/);
  assert.match(popupScript, /steamFastCheckScreenshotIntervalSeconds/);
  assert.match(popupScript, /updateScreenshotIntervalImmediately/);
  assert.match(
    popupScript,
    /screenshotIntervalInput\.addEventListener\("input", updateScreenshotIntervalImmediately\)/
  );
  const screenshotIntervalContentScript = manifest.content_scripts.find((entry) =>
    entry.js?.includes("src/screenshot-interval.js")
  );
  assert.ok(screenshotIntervalContentScript);
  assert.equal(screenshotIntervalContentScript.run_at, "document_start");
  assert.match(popupHtml, /id="popular_highlight_enabled"/);
  assert.match(popupHtml, /人気のゲームをハイライト/);
  assert.match(popupHtml, /id="popular_settings_panel"/);
  assert.match(popupHtml, /id="popular_highlight_year"/);
  assert.match(popupHtml, /id="popular_highlight_month"/);
  assert.match(popupHtml, /id="popular_settings_summary_status"/);
  assert.match(popupScript, /updatePopularSettingsSummary/);
  assert.match(popupScript, /件取得済み/);
  assert.match(popupHtml, /id="save_popular_settings"/);
  assert.match(popupHtml, /対象年月を保存/);
  assert.match(popupHtml, /id="open_steamdb_page"/);
  assert.match(popupScript, /steamFastCheckPopularHighlightEnabled/);
  assert.match(popupScript, /steamFastCheckPopularHighlightYear/);
  assert.match(popupScript, /steamFastCheckPopularHighlightMonth/);
  assert.match(popupScript, /sort", "followers_desc"/);
  assert.match(popupHtml, /id="comingsoon_page"/);
  assert.match(popupHtml, /近日登場チェック用ページ/);
  assert.doesNotMatch(popupHtml, /move_up_button|move_down_button/);
  assert.match(popupHtml, /class="drag_handle" draggable="true"/);
  assert.match(popupHtml, /TOP100を追加すると、専用タグの色と表示順も設定できます/);
  assert.match(popupScript, /moveRuleRow/);
  assert.match(popupScript, /insertBefore/);
  assert.match(popupScript, /dragstart/);
  assert.match(popupScript, /getBoundingClientRect/);
  assert.match(popupScript, /chrome\.tabs\.create/);
  assert.match(
    popupScript,
    /hwtype=0&supportedlang=japanese%2Cenglish&category1=998&os=win&filter=comingsoon&ndl=1/
  );
  assert.match(popupHtml, /id="gemini_translation_enabled"/);
  assert.match(popupHtml, /id="gemini_api_key"[^>]*type="password"/);
  assert.match(popupHtml, /id="gemini_model"/);
  assert.match(popupHtml, /id="refresh_models"/);
  assert.match(popupHtml, /id="test_gemini"/);
  assert.match(popupHtml, /id="clear_translation_cache"/);
  assert.match(popupHtml, /<details id="gemini_settings_panel"/);
  assert.match(popupHtml, /id="save_gemini_settings"/);
  assert.match(popupHtml, /API設定を保存/);
  assert.match(popupScript, /chrome\.storage\.local\.(?:set|remove)/);
  assert.match(popupScript, /steam-fast-check-gemini-list-models/);
  assert.match(
    popupScript,
    /async function saveGeminiSettings[\s\S]*chrome\.storage\.local\.set[\s\S]*chrome\.storage\.sync\.set/,
    "APIキーを先に保存してから、ゲームページへ設定変更を通知する"
  );
  assert.match(popupScript, /steamFastCheckGeminiSettingsRevision/);
  assert.match(popupScript, /saveGeminiSettings/);
  assert.match(popupScript, /saveGeneralSettings/);
  assert.match(popupScript, /savePopularSettings/);
  assert.match(popupScript, /updatePopularEnabledImmediately/);
  assert.match(
    popupScript,
    /popularEnabledInput\.addEventListener\("change", updatePopularEnabledImmediately\)/
  );
  assert.match(popupScript, /geminiSettingsPanel\.open/);
  assert.match(popupScript, /updateGeminiEnabledImmediately/);
  assert.match(
    popupScript,
    /geminiEnabledInput\.addEventListener\("change", updateGeminiEnabledImmediately\)/
  );
});

test("通常タブで表示したSteamDBのフォロワー上位100件を保存して返す", async () => {
  const localValues = {};
  const syncValues = {};
  const createdTabs = [];
  const removedTabs = [];
  const updatedTabs = [];
  let messageListener;

  const chrome = {
    storage: {
      local: {
        async setAccessLevel() {},
        async get(defaults) {
          return { ...defaults, ...localValues };
        },
        async set(values) {
          Object.assign(localValues, values);
        },
        async remove(key) {
          delete localValues[key];
        }
      },
      sync: {
        async get(defaults) {
          return { ...defaults, ...syncValues };
        },
        async set(values) {
          Object.assign(syncValues, values);
        }
      }
    },
    tabs: {
      async create(options) {
        createdTabs.push(options);
        return { id: 77, ...options };
      },
      async remove(tabId) {
        removedTabs.push(tabId);
      },
      async update(tabId, options) {
        updatedTabs.push({ tabId, options });
      },
      onRemoved: {
        addListener() {}
      }
    },
    runtime: {
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        }
      }
    }
  };

  vm.runInNewContext(geminiBackgroundScript, {
    URL,
    chrome,
    encodeURIComponent,
    fetch: async () => {
      throw new Error("SteamDBはバックグラウンドfetchを使わない");
    }
  });

  const sourceUrl =
    "https://steamdb.info/stats/gameratings/2026/?displayOnly=Game&max_release=2026-09-30&min_release=2026-09-01&sort=followers_desc";
  const sendMessage = (message, sender = {}) => new Promise((resolve) => {
    assert.equal(messageListener(message, sender, resolve), true);
  });

  const pending = await sendMessage({
    type: "steam-fast-check-steamdb-top-games",
    year: 2026,
    month: 9,
    refresh: true
  });
  assert.equal(pending.ok, true);
  assert.equal(pending.pending, true);
  assert.equal(pending.refreshing, true);
  assert.equal(createdTabs.length, 1);
  assert.equal(createdTabs[0].active, false);
  assert.equal(createdTabs[0].url, sourceUrl);
  assert.equal(
    localValues.steamFastCheckSteamDbPopularStatusV1.ok,
    null
  );

  const browserCheck = await sendMessage({
    type: "steam-fast-check-steamdb-source-status",
    year: 2026,
    month: 9,
    code: "steamdb-browser-check"
  }, { url: sourceUrl, tab: { id: 77 } });
  assert.equal(browserCheck.ok, false);
  assert.equal(browserCheck.code, "steamdb-browser-check");
  assert.equal(updatedTabs.length, 1);
  assert.equal(updatedTabs[0].tabId, 77);
  assert.equal(updatedTabs[0].options.active, true);

  const appIds = Array.from({ length: 105 }, (_, index) => String(5000000 + index));
  const ingested = await sendMessage({
    type: "steam-fast-check-steamdb-ingest-games",
    year: 2026,
    month: 9,
    sourceUrl,
    appIds
  }, { url: sourceUrl, tab: { id: 77 } });
  assert.equal(ingested.ok, true);
  assert.equal(ingested.apps.length, 100);
  assert.equal(ingested.apps[0].appId, "5000000");
  assert.equal(ingested.apps[0].rank, 1);
  assert.equal(ingested.apps[99].rank, 100);
  assert.deepEqual(removedTabs, [77]);
  assert.equal(
    typeof syncValues.steamFastCheckSteamDbPopularDataRevision,
    "number"
  );

  const cached = await sendMessage({
    type: "steam-fast-check-steamdb-top-games",
    year: 2026,
    month: 9,
    refresh: false
  });
  assert.equal(cached.ok, true);
  assert.equal(cached.cached, true);
  assert.equal(cached.apps.length, 100);
  assert.equal(createdTabs.length, 1);
});

test("SteamDBページの表示順から重複なしで上位100件を送る", async () => {
  let mutationCallback;
  let sentMessage;
  class MutationObserver {
    constructor(callback) {
      mutationCallback = callback;
    }

    observe() {}

    disconnect() {}
  }

  const rows = Array.from({ length: 105 }, (_, index) => ({
    dataset: { appid: String(6000000 + index) }
  }));
  rows.splice(20, 0, { dataset: { appid: "6000000" } });
  const document = {
    documentElement: {},
    querySelectorAll(selector) {
      assert.equal(selector, "table tbody tr.app");
      return rows;
    }
  };
  const window = {
    location: {
      href: "https://steamdb.info/stats/gameratings/2026/?displayOnly=Game&max_release=2026-09-30&min_release=2026-09-01&sort=followers_desc"
    }
  };
  const chrome = {
    runtime: {
      async sendMessage(message) {
        sentMessage = message;
        return { ok: true };
      }
    }
  };

  vm.runInNewContext(steamDbSourceScript, {
    Date,
    MutationObserver,
    Set,
    URL,
    chrome,
    document,
    window
  });
  for (let index = 0; index < 4; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.equal(sentMessage.type, "steam-fast-check-steamdb-ingest-games");
  assert.equal(sentMessage.year, 2026);
  assert.equal(sentMessage.month, 9);
  assert.equal(sentMessage.appIds.length, 100);
  assert.equal(sentMessage.appIds[0], "6000000");
  assert.equal(sentMessage.appIds[99], "6000099");
  assert.equal(typeof mutationCallback, "function");
  const sourceContentScript = manifest.content_scripts.find((entry) =>
    entry.js.includes("src/steamdb-popular-source.js")
  );
  assert.deepEqual(sourceContentScript.matches, [
    "https://steamdb.info/stats/gameratings/*"
  ]);
});

test("SteamDB上位100件と一致する検索行へTOP100タグ用の順位を付ける", async () => {
  const popularContentScript = manifest.content_scripts.find((entry) =>
    entry.js.includes("src/popular-game-highlights.js")
  );
  assert.equal(popularContentScript.css, undefined);

  class FakeRow {
    constructor(appId) {
      this.nodeType = 1;
      this.dataset = { dsAppid: String(appId) };
    }

    matches(selector) {
      return selector === "a.search_result_row";
    }

    querySelectorAll() {
      return [];
    }
  }

  const matchingRow = new FakeRow(111);
  const ordinaryRow = new FakeRow(222);
  const rows = [matchingRow, ordinaryRow];
  let mutationCallback;
  let storageChangeListener;
  let requestCount = 0;
  const dispatchedEvents = [];

  class MutationObserver {
    constructor(callback) {
      mutationCallback = callback;
    }

    observe() {}
  }

  const document = {
    getElementById(id) {
      return id === "search_results" ? {} : null;
    },
    querySelectorAll(selector) {
      return selector === "a.search_result_row" ? rows : [];
    },
    dispatchEvent(event) {
      dispatchedEvents.push(event.type);
    }
  };
  const chrome = {
    runtime: {
      async sendMessage(message) {
        requestCount += 1;
        assert.equal(message.type, "steam-fast-check-steamdb-top-games");
        assert.equal(message.year, 2026);
        assert.equal(message.month, 9);
        assert.equal(message.refresh, requestCount === 1);
        return {
          ok: true,
          apps: [{ appId: "111", rank: 4 }]
        };
      }
    },
    storage: {
      sync: {
        async get(defaults) {
          return {
            ...defaults,
            steamFastCheckPopularHighlightEnabled: true,
            steamFastCheckPopularHighlightYear: 2026,
            steamFastCheckPopularHighlightMonth: 9
          };
        }
      },
      onChanged: {
        addListener(listener) {
          storageChangeListener = listener;
        }
      }
    }
  };
  const window = {};
  class CustomEvent {
    constructor(type) {
      this.type = type;
    }
  }

  vm.runInNewContext(popularHighlightScript, {
    CustomEvent,
    Date,
    Map,
    MutationObserver,
    chrome,
    document,
    window
  });
  for (let index = 0; index < 4; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.equal(requestCount, 1);
  assert.equal(matchingRow.dataset.steamFastCheckPopularRank, "4");
  assert.equal(ordinaryRow.dataset.steamFastCheckPopularRank, undefined);
  assert.ok(dispatchedEvents.includes("steam-fast-check-popular-tags-changed"));

  const appendedRow = new FakeRow(111);
  mutationCallback([{ addedNodes: [appendedRow] }]);
  assert.equal(appendedRow.dataset.steamFastCheckPopularRank, "4");

  storageChangeListener(
    { steamFastCheckSteamDbPopularDataRevision: { newValue: Date.now() } },
    "sync"
  );
  for (let index = 0; index < 4; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(requestCount, 2);

  storageChangeListener(
    { steamFastCheckPopularHighlightEnabled: { newValue: false } },
    "sync"
  );
  assert.equal(matchingRow.dataset.steamFastCheckPopularRank, undefined);
});

test("Gemini APIのモデル一覧を絞り込み、翻訳結果をキャッシュする", async () => {
  const localValues = {
    steamFastCheckGeminiApiKey: "test-api-key"
  };
  const syncValues = {
    steamFastCheckGeminiTranslationEnabled: true,
    steamFastCheckGeminiModel: "gemini-test-flash"
  };
  let storageAccessLevel = null;
  let messageListener;
  let generateCount = 0;
  let partialGenerateCount = 0;
  let lastGenerateBody;

  const chrome = {
    storage: {
      local: {
        async setAccessLevel({ accessLevel }) {
          storageAccessLevel = accessLevel;
        },
        async get(defaults) {
          return { ...defaults, ...localValues };
        },
        async set(values) {
          Object.assign(localValues, values);
        },
        async remove(key) {
          delete localValues[key];
        }
      },
      sync: {
        async get(defaults) {
          return { ...defaults, ...syncValues };
        }
      }
    },
    runtime: {
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        }
      }
    }
  };

  function response(data, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(data)
    };
  }

  const fetch = async (url, options = {}) => {
    const href = String(url);
    assert.equal(options.headers["x-goog-api-key"], "test-api-key");
    if (href.includes("/models?") || href.endsWith("/models")) {
      return response({
        models: [
          {
            name: "models/gemini-test-flash",
            displayName: "Gemini Test Flash",
            supportedGenerationMethods: ["generateContent"]
          },
          {
            name: "models/gemini-test-image",
            displayName: "Gemini Test Image",
            supportedGenerationMethods: ["generateContent"]
          },
          {
            name: "models/text-embedding-test",
            displayName: "Embedding Test",
            supportedGenerationMethods: ["embedContent"]
          }
        ]
      });
    }

    generateCount += 1;
    lastGenerateBody = JSON.parse(options.body);
    const prompt = lastGenerateBody.contents[0].parts[0].text;
    const inputItems = JSON.parse(prompt.split("Input JSON:\n").at(-1));
    let returnedItems = inputItems;
    if (href.includes("gemini-partial")) {
      partialGenerateCount += 1;
      if (partialGenerateCount === 1) {
        returnedItems = inputItems.slice(0, 1);
      }
    }
    return response({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              translations: returnedItems.map((item) => ({
                id: item.id,
                translation: item.text === "An English description."
                  ? "日本語の説明です。"
                  : `訳:${item.text}`
              }))
            })
          }]
        }
      }]
    });
  };

  vm.runInNewContext(geminiBackgroundScript, {
    URL,
    chrome,
    encodeURIComponent,
    fetch
  });

  const sendMessage = (message) => new Promise((resolve) => {
    const keepChannelOpen = messageListener(message, {}, resolve);
    assert.equal(keepChannelOpen, true);
  });

  const modelResponse = await sendMessage({
    type: "steam-fast-check-gemini-list-models",
    apiKey: "test-api-key"
  });
  assert.equal(modelResponse.ok, true);
  assert.deepEqual(
    Array.from(modelResponse.models, (model) => model.id),
    ["gemini-test-flash"]
  );

  const firstTranslation = await sendMessage({
    type: "steam-fast-check-gemini-translate",
    texts: ["An English description."]
  });
  const secondTranslation = await sendMessage({
    type: "steam-fast-check-gemini-translate",
    texts: ["An English description."]
  });

  assert.equal(firstTranslation.ok, true);
  assert.equal(firstTranslation.cached, false);
  assert.equal(secondTranslation.ok, true);
  assert.equal(secondTranslation.cached, true);
  assert.equal(generateCount, 1);
  assert.deepEqual(Array.from(secondTranslation.translations), ["日本語の説明です。"]);
  assert.equal(
    lastGenerateBody.generationConfig.responseMimeType,
    "application/json"
  );
  assert.equal(
    lastGenerateBody.generationConfig.responseSchema.properties.translations.type,
    "array"
  );
  assert.equal(
    lastGenerateBody.generationConfig.responseSchema.properties.translations
      .items.properties.id.type,
    "string"
  );
  assert.match(lastGenerateBody.contents[0].parts[0].text, /Steam game description/);
  assert.equal(storageAccessLevel, "TRUSTED_CONTEXTS");

  syncValues.steamFastCheckGeminiModel = "gemini-partial";
  const recoveredTranslation = await sendMessage({
    type: "steam-fast-check-gemini-translate",
    texts: ["First repeated description.", "Second repeated description."]
  });
  assert.equal(recoveredTranslation.ok, true);
  assert.deepEqual(Array.from(recoveredTranslation.translations), [
    "訳:First repeated description.",
    "訳:Second repeated description."
  ]);
  assert.equal(partialGenerateCount, 2);
  assert.equal(generateCount, 3);
});

test("ゲームページでは指定した2つの説明欄だけを翻訳対象にする", () => {
  const appContentScript = manifest.content_scripts.find((entry) =>
    entry.matches.includes("https://store.steampowered.com/app/*")
  );
  assert.deepEqual(appContentScript.js, ["src/gemini-translation.js"]);
  assert.deepEqual(appContentScript.css, ["src/gemini-translation.css"]);
  assert.match(
    geminiContentScript,
    /\.game_description_snippet, #game_area_description/
  );
  assert.doesNotMatch(geminiContentScript, /steamFastCheckGeminiApiKey/);
  assert.match(geminiContentScript, /steam-fast-check-gemini-translate/);
  assert.match(geminiContentScript, /toggleOriginalOnClick/);
  assert.doesNotMatch(geminiContentScript, /addEventListener\("mousedown"/);
  assert.doesNotMatch(geminiContentScript, /addEventListener\("mouseover"/);
  assert.doesNotMatch(
    geminiContentScript,
    /if \(JAPANESE_PATTERN\.test\(text\)\)\s*\{\s*return false;/
  );
  assert.match(geminiCss, /#steam_fast_check_translation_status/);
  assert.match(geminiCss, /\.steam_fast_check_translated_parent:hover/);
  assert.match(geminiCss, /\.steam_fast_check_original_visible/);
  assert.match(geminiBackgroundScript, /setAccessLevel/);
  assert.match(geminiBackgroundScript, /TRUSTED_CONTEXTS/);
});

test("日本語の見出しを残し、英語のゲーム説明だけを書き換える", async () => {
  class FakeClassList {
    constructor() {
      this.values = new Set();
    }

    add(value) {
      this.values.add(value);
    }

    remove(value) {
      this.values.delete(value);
    }

    contains(value) {
      return this.values.has(value);
    }

    toggle(value, force) {
      if (force === undefined ? !this.values.has(value) : force) {
        this.values.add(value);
        return true;
      }
      this.values.delete(value);
      return false;
    }
  }

  class FakeElement {
    constructor(tagName = "DIV", textContent = "") {
      this.tagName = tagName;
      this.textContent = textContent;
      this.classList = new FakeClassList();
      this.attributes = new Map();
      this.dataset = {};
      this.style = {};
      this.hidden = false;
      this.isConnected = true;
    }

    addEventListener() {}

    getAttribute(name) {
      return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    setAttribute(name, value) {
      this.attributes.set(name, String(value));
      if (name === "hidden") {
        this.hidden = true;
      }
    }

    removeAttribute(name) {
      this.attributes.delete(name);
    }

    getBoundingClientRect() {
      return { width: 200, height: 80 };
    }

    closest(selector) {
      return selector === ".steam_fast_check_translated_parent" &&
        this.classList.contains("steam_fast_check_translated_parent")
        ? this
        : null;
    }
  }

  const japaneseParent = new FakeElement("H2", "このゲームについて");
  const englishParent = new FakeElement(
    "P",
    "An English game description. Important feature."
  );
  const boldParent = new FakeElement("STRONG", "Important feature.");
  boldParent.parentElement = englishParent;
  const japaneseNode = {
    nodeValue: "このゲームについて",
    parentElement: japaneseParent,
    isConnected: true
  };
  const englishNode = {
    nodeValue: "\n  An English game description. ",
    parentElement: englishParent,
    isConnected: true
  };
  const boldNode = {
    nodeValue: "Important feature.  \n",
    parentElement: boldParent,
    isConnected: true
  };
  const container = {
    textContent: "このゲームについて An English game description. Important feature."
  };
  const elementsById = new Map();
  const documentListeners = new Map();
  let storageChangeListener;
  let selectedText = "";

  const document = {
    documentElement: {
      append(element) {
        elementsById.set(element.id, element);
      }
    },
    getElementById(id) {
      return elementsById.get(id) || null;
    },
    addEventListener(type, listener) {
      documentListeners.set(type, listener);
    },
    createElement() {
      return new FakeElement();
    },
    createRange() {
      return { selectNodeContents() {} };
    },
    createTreeWalker() {
      const nodes = [japaneseNode, englishNode, boldNode];
      let index = 0;
      return {
        nextNode() {
          return nodes[index++] || null;
        }
      };
    },
    querySelectorAll(selector) {
      assert.equal(selector, ".game_description_snippet, #game_area_description");
      return [container];
    }
  };
  const chrome = {
    i18n: {
      detectLanguage(_text, callback) {
        callback({ languages: [{ language: "en", percentage: 85 }] });
      }
    },
    runtime: {
      lastError: null,
      async sendMessage(message) {
        assert.deepEqual(Array.from(message.texts), [
          "An English game description.",
          "Important feature."
        ]);
        return {
          ok: true,
          translations: ["英語のゲーム説明です。", "重要な特徴です。"],
          model: "gemini-test-flash",
          cached: false
        };
      }
    },
    storage: {
      sync: {
        async get(defaults) {
          return {
            ...defaults,
            steamFastCheckGeminiTranslationEnabled: true,
            steamFastCheckGeminiModel: "gemini-test-flash"
          };
        }
      },
      onChanged: {
        addListener(listener) {
          storageChangeListener = listener;
        }
      }
    }
  };
  const window = {
    setTimeout() {},
    getSelection() {
      return {
        isCollapsed: selectedText === "",
        toString: () => selectedText,
        removeAllRanges() {},
        addRange() {}
      };
    }
  };

  vm.runInNewContext(geminiContentScript, {
    Element: FakeElement,
    NodeFilter: { SHOW_TEXT: 4 },
    chrome,
    document,
    window
  });
  for (let index = 0; index < 4; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.equal(japaneseNode.nodeValue, "このゲームについて");
  assert.equal(englishNode.nodeValue, "\n  英語のゲーム説明です。 ");
  assert.equal(boldNode.nodeValue, "重要な特徴です。  \n");
  assert.equal(
    englishParent.classList.contains("steam_fast_check_translated_parent"),
    true
  );

  selectedText = "英語のゲーム説明です。";
  documentListeners.get("click")({ target: englishParent, button: 0 });
  assert.equal(englishNode.nodeValue, "\n  英語のゲーム説明です。 ");
  assert.equal(boldNode.nodeValue, "重要な特徴です。  \n");

  selectedText = "";
  documentListeners.get("click")({ target: englishParent, button: 0 });
  assert.equal(englishNode.nodeValue, "\n  An English game description. ");
  assert.equal(boldNode.nodeValue, "Important feature.  \n");
  assert.equal(
    englishParent.classList.contains("steam_fast_check_original_visible"),
    true
  );

  documentListeners.get("click")({ target: englishParent, button: 0 });
  assert.equal(englishNode.nodeValue, "\n  英語のゲーム説明です。 ");
  assert.equal(boldNode.nodeValue, "重要な特徴です。  \n");

  storageChangeListener(
    { steamFastCheckGeminiTranslationEnabled: { newValue: false } },
    "sync"
  );
  assert.equal(englishNode.nodeValue, "\n  An English game description. ");
  assert.equal(boldNode.nodeValue, "Important feature.  \n");
  assert.equal(
    englishParent.classList.contains("steam_fast_check_translated_parent"),
    false
  );
});
