const assert = require("assert").strict;
const matcher = require("../matcher.js");

globalThis.JimengAssetMatcher = matcher;
globalThis.JimengAssetPlugin = {};
require("../candidates.js");

const plugin = globalThis.JimengAssetPlugin;
const { discover, scrollableMenuCandidates, seekExactVisibleRow } = plugin.candidates;

globalThis.KeyboardEvent = class KeyboardEvent {};
globalThis.Event = class Event {};

const allNames = Array.from(
  { length: 29 },
  (_value, index) => `${String(index + 1).padStart(2, "0")}_素材`
);
let loadedCount = 21;
let markerVisible = true;
let renderCountdown = 0;
let loadCountdown = 0;
let loadGrowths = 0;
let wrapperAlive = true;
let invalidateWrapperOnScroll = false;

const popupRoot = {
  clientHeight: 420,
  contains: (element) => element === heading || element === realViewport ||
    element === incidentalWrapper || rowPool.includes(element),
  getBoundingClientRect: () => ({ height: 420, width: 340 }),
  innerText: "可能@的内容\n创建主体",
  parentElement: null,
  querySelector: (selector) => selector.includes("img") ? {} : null,
  querySelectorAll: () => rowPool,
  scrollHeight: 420,
  scrollTop: 0,
  textContent: "可能@的内容\n创建主体"
};

const incidentalWrapper = {
  _overflow: "auto",
  clientHeight: 340,
  contains: (element) => wrapperAlive && rowPool.includes(element),
  getBoundingClientRect: () => ({ height: 340, width: 320 }),
  innerText: "创建主体",
  matches: () => false,
  parentElement: null,
  scrollHeight: 360,
  scrollTop: 7,
  textContent: "创建主体"
};

let realScrollTop = 37;
const realViewport = {
  _overflow: "hidden",
  clientHeight: 340,
  contains: (element) => element === incidentalWrapper || rowPool.includes(element),
  dispatchEvent: () => {
    markerVisible = false;
    if (invalidateWrapperOnScroll) wrapperAlive = false;
    renderCountdown = Math.max(renderCountdown, 2);
    const max = Math.max(realViewport.scrollHeight - realViewport.clientHeight, 0);
    if (realScrollTop >= max - 2 && loadedCount < allNames.length && !loadCountdown) {
      // The next batch appears well after the first render sample. This is the
      // real failure mode that made the old code stop at the previous bottom.
      loadCountdown = 6;
    }
  },
  getBoundingClientRect: () => ({ height: 340, width: 320 }),
  matches: (selector) => selector.includes("scroll-area-viewport"),
  parentElement: popupRoot
};
Object.defineProperties(realViewport, {
  scrollHeight: {
    get: () => loadedCount * 20
  },
  scrollTop: {
    get: () => realScrollTop,
    set: (value) => {
      const max = Math.max(realViewport.scrollHeight - realViewport.clientHeight, 0);
      realScrollTop = Math.max(0, Math.min(Number(value) || 0, max));
    }
  }
});

incidentalWrapper.parentElement = realViewport;

const heading = {
  innerText: "可能@的内容",
  parentElement: popupRoot,
  textContent: "可能@的内容"
};

function makeRow() {
  const leaf = {
    children: [],
    getAttribute: () => null,
    get textContent() {
      return this.owner._name;
    },
    owner: null
  };
  const element = {
    _name: "",
    closest: () => incidentalWrapper,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ height: 20, width: 300 }),
    get innerText() {
      return this._name;
    },
    parentElement: incidentalWrapper,
    querySelector: (selector) => selector.includes("img") ? {} : null,
    querySelectorAll: () => [leaf],
    get textContent() {
      return this._name;
    }
  };
  leaf.owner = element;
  return element;
}

const rowPool = Array.from({ length: 17 }, makeRow);

function renderRows() {
  const maxStart = Math.max(loadedCount - rowPool.length, 0);
  const start = Math.min(Math.floor(realScrollTop / 20), maxStart);
  for (let index = 0; index < rowPool.length; index += 1) {
    rowPool[index]._name = allNames[start + index] || "";
  }
}
renderRows();

globalThis.getComputedStyle = (element) => ({
  overflowY: element?._overflow || "visible"
});

globalThis.document = {
  activeElement: { dispatchEvent: () => {} },
  dispatchEvent: () => {},
  querySelectorAll: (selector) => {
    if (selector === "span, p, div, button") return markerVisible ? [heading] : [];
    if (selector === "div, li, button") return rowPool;
    return rowPool;
  }
};

Object.assign(plugin, {
  isVisible: () => true,
  sleep: async () => {
    if (renderCountdown > 0) {
      renderCountdown -= 1;
      if (!renderCountdown) renderRows();
    }
    if (loadCountdown > 0) {
      loadCountdown -= 1;
      if (!loadCountdown) {
        loadedCount = Math.min(loadedCount + 4, allNames.length);
        loadGrowths += 1;
        renderCountdown = Math.max(renderCountdown, 2);
      }
    }
  },
  waitFor: async (check, timeout = 2400, interval = 80) => {
    const attempts = Math.max(Math.ceil(timeout / interval), 1);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const value = check();
      if (value) return value;
      await plugin.sleep(interval);
    }
    return null;
  }
});

(async () => {
  const originalScrollTop = realScrollTop;
  const seedRows = rowPool.map((element) => ({
    element,
    name: element._name
  }));
  assert.equal(
    scrollableMenuCandidates(seedRows, popupRoot)[0],
    realViewport,
    "the large real viewport must outrank the nearer overflow:auto wrapper"
  );

  const rows = await discover({});
  const names = rows.map((item) => item.name).sort();
  assert.deepEqual(names, [...allNames].sort());
  assert.equal(new Set(rows.map((item) => item.element)).size <= 17, true);
  assert.equal(rows.some((item) => item.name === "29_素材"), true);
  assert.equal(loadGrowths, 2, "the scan must survive two lazy height expansions");
  assert.equal(markerVisible, false, "the strong title is recycled after scrolling");
  assert.equal(realViewport.scrollTop, originalScrollTop);
  assert.equal(incidentalWrapper.scrollTop, 7);
  renderRows();
  const sought = await seekExactVisibleRow("29_素材", popupRoot);
  assert.equal(sought?.name, "29_素材");
  assert.equal(
    realViewport.scrollTop > originalScrollTop,
    true,
    "a later-page candidate should be revealed in the live picker without a text query"
  );
  realViewport.scrollTop = 0;
  wrapperAlive = true;
  invalidateWrapperOnScroll = true;
  renderRows();
  const soughtAfterWrapperRecycle = await seekExactVisibleRow(
    "29_素材",
    incidentalWrapper
  );
  invalidateWrapperOnScroll = false;
  assert.equal(soughtAfterWrapperRecycle?.name, "29_素材");
  console.log("✓ collects all 29 names from a delayed 17-row virtual list");
  console.log("✓ reveals an off-screen exact candidate without typing its filename");
  console.log("✓ promotes the stable viewport when an inner picker wrapper is recycled");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
