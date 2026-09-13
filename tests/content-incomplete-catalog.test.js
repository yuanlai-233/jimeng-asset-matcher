const assert = require("assert").strict;

let discoverCalls = 0;
let insertCalls = 0;
let cacheCalls = 0;
let invalidationCalls = 0;
let runMatching = null;

const editor = {
  contains: () => false,
  getBoundingClientRect: () => ({
    bottom: 700,
    height: 300,
    left: 100,
    right: 900,
    top: 400,
    width: 800
  })
};
const rows = Array.from({ length: 12 }, (_value, index) => ({
  element: {},
  name: `${String(index + 1).padStart(2, "0")}_素材`
}));

globalThis.JimengAssetMatcher = {
  promptReferenceErrors: require("../matcher.js").promptReferenceErrors,
  normalizeText: (value) => String(value || "").trim(),
  parsePromptReferences: () => [{ name: "29_素材", start: 0, token: "@29_素材" }],
  selectionReplacesPrompt: () => false
};
globalThis.JimengAssetPlugin = {
  candidates: {
    closePicker: () => {},
    discover: async () => {
      discoverCalls += 1;
      return rows;
    },
    expectedUploadCount: () => 29,
    insertMention: async () => {
      insertCalls += 1;
      return { ok: true };
    },
    isSystemMenuEntry: () => false
  },
  constants: {
    buttonId: "incomplete-button",
    confirmId: "incomplete-confirm",
    controlsId: "incomplete-controls",
    extraConfirmId: "incomplete-extra",
    overlayId: "incomplete-overlay",
    statusId: "incomplete-status",
    toastId: "incomplete-toast"
  },
  editor: {
    clearHighlights: () => {},
    findEditor: () => editor,
    plainText: () => "@29_素材",
    refreshHighlights: () => {}
  },
  nativeTrigger: { ensurePicker: async () => true },
  sleep: async () => {},
  state: {
    expectedMentionCounts: new Map(),
    matchStatusEditor: null,
    matchStatusVerified: false,
    matching: false
  },
  ui: {
    cacheCandidateCatalog: () => {
      cacheCalls += 1;
      return [];
    },
    installAssetChangeGuard: () => {},
    installMatchButton: (callback) => { runMatching = callback; },
    installSendGuard: () => {},
    invalidateCandidateCatalog: () => { invalidationCalls += 1; },
    invalidateMatchStatus: () => {},
    materialBaselineChanged: () => false,
    readCandidateCatalog: () => rows.map((row) => row.name),
    scheduleMatchControlPosition: () => {},
    toast: () => {},
    trackMatchStatusEditor: () => {},
    updateMatchStatus: () => {}
  },
  version: "test"
};

const attributes = new Map();
globalThis.document = {
  addEventListener: () => {},
  contains: () => true,
  documentElement: {
    hasAttribute: (name) => attributes.has(name),
    setAttribute: (name, value) => attributes.set(name, value)
  },
  getElementById: () => ({})
};
globalThis.window = { addEventListener: () => {} };
globalThis.visualViewport = { addEventListener: () => {} };
globalThis.Node = { ELEMENT_NODE: 1 };
globalThis.MutationObserver = class MutationObserver { observe() {} };

require("../content.js");

(async () => {
  const button = { disabled: false, textContent: "自动匹配" };
  await assert.rejects(
    runMatching(button),
    /只读取到 12\/29 项/u
  );
  assert.equal(discoverCalls, 2, "one bounded full retry is allowed");
  assert.equal(cacheCalls, 0, "an incomplete catalogue must never enter browser memory");
  assert.equal(invalidationCalls, 1, "an undersized old snapshot must be invalidated");
  assert.equal(insertCalls, 0, "partial discovery must not start mention insertion");
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "自动匹配");
  console.log("✓ refuses to cache or match an incomplete 12/29 catalogue");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
