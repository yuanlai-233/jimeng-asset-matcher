const assert = require("assert").strict;

let focused = false;
let opened = false;
let historicalClicks = 0;
let currentClicks = 0;
let uploadClicks = 0;
const triggerOrder = [];

function rect(left, top, width = 40, height = 40) {
  return { bottom: top + height, height, left, right: left + width, top, width };
}

function control(bounds, click, { aria = null, text = "@" } = {}) {
  return {
    className: "",
    click,
    getAttribute: (name) => name === "aria-label" ? aria : null,
    getBoundingClientRect: () => bounds,
    id: "",
    innerText: text,
    parentElement: null,
    querySelector: () => null,
    textContent: text
  };
}

const editor = {
  focus: () => {
    focused = true;
    triggerOrder.push("focus");
  },
  getBoundingClientRect: () => rect(100, 100, 800, 400)
};
const historical = control(rect(120, 120), () => { historicalClicks += 1; });
const current = control(rect(220, 450), () => {
  currentClicks += 1;
  triggerOrder.push("native-click");
  opened = true;
});
const upload = control(
  rect(280, 450),
  () => { uploadClicks += 1; },
  { aria: "添加素材", text: "" }
);
const popup = {};
const rowElement = {
  closest: () => popup,
  parentElement: null
};

globalThis.document = {
  querySelectorAll: (selector) => {
    if (selector === "svg path[d]") return [];
    if (selector === "span, div") return [];
    return focused ? [historical, upload, current] : [historical];
  }
};
globalThis.JimengAssetMatcher = {
  normalizeText: (value) => String(value || "").trim()
};
globalThis.JimengAssetPlugin = {
  candidates: {
    visibleRows: () => opened ? [{ element: rowElement, name: "素材" }] : []
  },
  constants: { buttonId: "jimeng-asset-match-button" },
  isVisible: () => true,
  sleep: async () => {},
  waitFor: async (check) => check()
};

require("../native-trigger.js");

(async () => {
  const result = await globalThis.JimengAssetPlugin.nativeTrigger.ensurePicker(editor, {
    beforeClick: () => {
      assert.equal(focused, true, "the live toolbar must be resolved after editor focus");
      triggerOrder.push("before-click");
      return true;
    },
    requireFresh: true
  });
  assert.equal(result, true);
  assert.equal(currentClicks, 1, "the current editor's @ control should be clicked");
  assert.equal(historicalClicks, 0, "historical task controls must be ignored");
  assert.equal(uploadClicks, 0, "the upload-material control must not be mistaken for @");
  assert.deepEqual(
    triggerOrder,
    ["focus", "before-click", "native-click"],
    "the exact caret callback must run immediately before the native toolbar click"
  );
  console.log("✓ focuses first and opens the current editor's native @ menu");

  opened = false;
  const clicksBeforeRejection = currentClicks;
  assert.equal(await globalThis.JimengAssetPlugin.nativeTrigger.ensurePicker(editor, {
    beforeClick: async () => false, requireFresh: true
  }), false);
  assert.equal(currentClicks, clicksBeforeRejection, "an asynchronous caret rejection must prevent the native click");

  let interrupted = false;
  const plugin = globalThis.JimengAssetPlugin;
  const savedSleep = plugin.sleep;
  plugin.sleep = async () => { interrupted = true; };
  await assert.rejects(() => plugin.nativeTrigger.ensurePicker(editor, {
    assertCurrent: () => { if (interrupted) throw new Error("navigation"); },
    requireFresh: true
  }), /navigation/);
  assert.equal(currentClicks, clicksBeforeRejection, "navigation while focusing must not issue a late toolbar click");
  plugin.sleep = savedSleep;

  const toolbarScope = {
    contains: (node) => node === editor || node === current,
    getBoundingClientRect: () => rect(100, 100, 800, 440),
    querySelectorAll: (selector) => selector === "svg path[d]" || selector === "span, div" ? [] : [current]
  };
  editor.parentElement = toolbarScope;
  opened = false;
  await globalThis.JimengAssetPlugin.nativeTrigger.ensurePicker(editor, {
    beforeClick: () => true, requireFresh: true
  });
  let pageScans = 0;
  const queryAll = document.querySelectorAll;
  document.querySelectorAll = (selector) => { pageScans++; return queryAll(selector); };
  for (let i = 0; i < 120; i++) {
    opened = false;
    assert.equal(await globalThis.JimengAssetPlugin.nativeTrigger.ensurePicker(editor, {
      beforeClick: () => true, requireFresh: true
    }), true);
  }
  assert.equal(pageScans, 0, "subsequent references must resolve a live button only within their proved toolbar");
  assert.equal(historicalClicks, 0);
  console.log("✓ 120 subsequent references avoid page-wide toolbar scans and still reject historical controls");
  const placeholder = control(rect(220, 480, 24, 24), () => {});
  editor.contains = (node) => node === placeholder;
  toolbarScope.contains = (node) => [editor, current, placeholder].includes(node);
  document.querySelectorAll = (selector) => /svg path|span, div/.test(selector) ? [] : [placeholder, current];
  assert.equal(globalThis.JimengAssetPlugin.nativeTrigger.findNativeButton(editor), placeholder);
  assert.equal(globalThis.JimengAssetPlugin.nativeTrigger.findNativeButton(editor, { toolbarOnly: true }), current,
    "inline BGM placement must exclude the @ button inside the empty editor's placeholder");
  console.log("✓ toolbar-only lookup ignores the empty prompt's inline @ example");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
