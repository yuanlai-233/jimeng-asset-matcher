const assert = require("assert").strict;
const matcher = require("../matcher.js");

globalThis.JimengAssetMatcher = matcher;
globalThis.JimengAssetPlugin = {};
require("../candidates.js");

const plugin = globalThis.JimengAssetPlugin;
const { discover, findAssetMenuRoot, insertMention, visibleRows } = plugin.candidates;

globalThis.KeyboardEvent = class KeyboardEvent {};
globalThis.Event = class Event {};
globalThis.getComputedStyle = () => ({ overflowY: "visible" });

function popup(state) {
  const root = {
    _rows: [],
    clientHeight: 480,
    contains(element) {
      return this._rows.includes(element);
    },
    getAttribute(name) {
      if (name === "aria-hidden") return state === "open" ? "false" : "true";
      if (name === "data-state") return state;
      return null;
    },
    getBoundingClientRect: () => ({ height: 480, width: 340 }),
    innerText: "可能@的内容\n创建主体",
    matches: (selector) => selector.includes('[role="listbox"]'),
    parentElement: null,
    querySelector: (selector) => selector.includes("img") ? {} : null,
    querySelectorAll(selector) {
      return selector === "div, li, button" ? this._rows : [];
    },
    scrollHeight: 480,
    scrollTop: 0,
    textContent: "可能@的内容\n创建主体"
  };
  return root;
}

function candidate(name, root, index = 0) {
  const label = {
    children: [],
    getAttribute: () => null,
    textContent: name
  };
  const element = {
    _mountedIndex: index,
    closest: (selector) => selector.includes("role") ? root : null,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ height: 42, width: 300 }),
    innerText: name,
    parentElement: root,
    querySelector: (selector) => selector.includes("img") ? {} : null,
    querySelectorAll: () => [label],
    textContent: name
  };
  root._rows.push(element);
  return element;
}

function marker(root) {
  return {
    innerText: "可能@的内容",
    parentElement: root,
    textContent: "可能@的内容"
  };
}

function installDocument({ markers, rows }) {
  globalThis.document = {
    activeElement: { dispatchEvent: () => {} },
    dispatchEvent: () => {},
    querySelectorAll: (selector) => {
      if (selector === "span, p, div, button") return markers;
      if (selector === "div, li, button") return rows;
      return rows;
    }
  };
}

Object.assign(plugin, {
  editor: {
    findRangeAt: () => null,
    insertText: () => {},
    placeCaretAtEnd: () => {},
    plainText: () => ""
  },
  sleep: async () => {},
  waitFor: async (check) => check()
});

async function discoversAllMountedRows() {
  const mountedRoot = popup("open");
  const mountedRows = Array.from(
    { length: 29 },
    (_value, index) => candidate(
      `${String(index + 1).padStart(2, "0")}_已上传素材`,
      mountedRoot,
      index
    )
  );
  const mountedMarker = marker(mountedRoot);

  plugin.isVisible = (element) => {
    if (element === mountedRoot || element === mountedMarker) return true;
    const index = mountedRows.indexOf(element);
    // Reproduce the old global-viewport check: only 12 mounted rows intersect
    // the page viewport even though all 29 belong to the active popup DOM.
    return index >= 0 && index < 12;
  };
  installDocument({ markers: [mountedMarker], rows: mountedRows });

  const discovered = await discover({});
  assert.deepEqual(
    discovered.map((item) => item.name),
    mountedRows.map((element) => element.innerText),
    "all mounted upload rows inside the active popup must be inventoried"
  );
  console.log("✓ discovers all 29 mounted rows even when only 12 intersect the page viewport");
}

async function prefersActivePopup() {
  const closingRoot = popup("closed");
  const activeRoot = popup("open");
  const closingRows = [candidate("旧弹窗素材", closingRoot)];
  const activeRows = [
    candidate("新弹窗01_素材", activeRoot),
    candidate("新弹窗02_素材", activeRoot)
  ];
  const closingMarker = marker(closingRoot);
  const activeMarker = marker(activeRoot);

  plugin.isVisible = () => true;
  installDocument({
    // A closing portal can remain earlier in DOM order during its exit animation.
    markers: [closingMarker, activeMarker],
    rows: [...closingRows, ...activeRows]
  });

  const seeds = [...closingRows, ...activeRows].map((element) => ({
    element,
    name: element.innerText
  }));
  assert.equal(
    findAssetMenuRoot(seeds),
    activeRoot,
    "an explicitly open popup must outrank an overlapping data-state=closed portal"
  );
  assert.deepEqual(
    visibleRows().map((item) => item.name),
    activeRows.map((element) => element.innerText),
    "candidate rows from the closing popup must not leak into the active inventory"
  );
  console.log("✓ prefers the new active popup over an overlapping closing portal");
}

async function refusesToStackOnAnUnclosedPopup() {
  const oldRoot = popup("open");
  let rowClicks = 0;
  const oldRows = [candidate("旧弹窗素材", oldRoot)];
  oldRows[0].click = () => { rowClicks += 1; };
  const oldMarker = marker(oldRoot);
  installDocument({ markers: [oldMarker], rows: oldRows });
  plugin.isVisible = () => true;
  let insertedTriggers = 0;
  const editor = { focus() {} };
  plugin.editor = {
    findEditor: () => editor,
    findRangeAt: () => ({}),
    insertText: () => {
      insertedTriggers += 1;
      return true;
    },
    isMatchPaired: () => false,
    placeCaretAfterMatch: () => true,
    plainText: () => "@新素材",
    deleteTextAt: () => true
  };
  plugin.waitFor = async (check) => check();

  const result = await insertMention(editor, {
    end: "@新素材".length,
    name: "新素材",
    start: 0,
    token: "@新素材"
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /上一个素材选择框尚未关闭/u);
  assert.equal(insertedTriggers, 0, "an unclosed popup must block the next native picker open");
  assert.equal(rowClicks, 0);
  console.log("✓ an unclosed popup blocks the next native picker instead of stacking");
}

(async () => {
  const cases = [
    ["mounted-row inventory", discoversAllMountedRows],
    ["popup lifecycle", prefersActivePopup],
    ["unclosed popup guard", refusesToStackOnAnUnclosedPopup]
  ];
  let failures = 0;

  for (const [label, run] of cases) {
    try {
      await run();
    } catch (error) {
      failures += 1;
      console.error(`✗ ${label}`);
      console.error(error);
    }
  }

  if (failures > 0) process.exitCode = 1;
})();
