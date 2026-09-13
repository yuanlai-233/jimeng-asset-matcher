const assert = require("assert").strict;
const matcher = require("../matcher.js");

const assetName = "已匹配素材";
let livePrompt = `镜头保持稳定，@${assetName}`;
let paired = true;
let observerCallback = null;
let observerOptions = null;
let invalidationCalls = 0;
let positionScheduleCalls = 0;

const listeners = new Map();
const rootAttributes = new Map();
const mountedIds = new Set([
  "focus-test-match-button",
  "focus-test-upload-button",
  "focus-test-status"
]);

function addListener(type, callback) {
  if (!listeners.has(type)) listeners.set(type, []);
  listeners.get(type).push(callback);
}

function dispatch(type, event) {
  for (const callback of listeners.get(type) || []) callback(event);
}

const editor = {
  nodeType: 1,
  parentElement: null,
  contains: (node) => node?._insideEditor === true,
  getBoundingClientRect: () => ({
    bottom: 700,
    height: 300,
    left: 100,
    right: 900,
    top: 400,
    width: 800
  }),
  matches: (selector) => selector.includes("data-slate-editor"),
  closest: () => null,
  querySelector: () => null,
  querySelectorAll: () => []
};

globalThis.document = {
  addEventListener: addListener,
  contains: (node) => node === editor || mountedIds.has(node?.id),
  documentElement: {
    appendChild: () => {},
    clientHeight: 800,
    clientWidth: 1200,
    hasAttribute: (name) => rootAttributes.has(name),
    setAttribute: (name, value) => rootAttributes.set(name, value)
  },
  getElementById: (id) => mountedIds.has(id) ? { id } : null,
  images: [],
  querySelectorAll: () => []
};
globalThis.window = { addEventListener: () => {} };
globalThis.visualViewport = { addEventListener: () => {} };
globalThis.Node = { ELEMENT_NODE: 1 };
globalThis.MutationObserver = class MutationObserver {
  constructor(callback) {
    observerCallback = callback;
  }

  observe(_target, options) {
    observerOptions = options;
  }
};

globalThis.JimengAssetMatcher = matcher;
require("../runtime.js");

const plugin = globalThis.JimengAssetPlugin;
plugin.constants = Object.freeze({
  ...plugin.constants,
  buttonId: "focus-test-match-button",
  confirmId: "focus-test-confirm",
  controlsId: "focus-test-controls",
  extraConfirmId: "focus-test-extra-confirm",
  localUploadButtonId: "focus-test-upload-button",
  overlayId: "focus-test-overlay",
  statusId: "focus-test-status",
  toastId: "focus-test-toast"
});
plugin.candidates = {
  closePicker: () => {},
  discover: async () => [],
  isSystemMenuEntry: () => false
};
plugin.editor = {
  clearHighlights: () => {},
  countCandidateMentions: (_editor, names) => new Map(
    names.map((name) => [name, paired ? 1 : 0])
  ),
  countPairedCandidateMentions: (_editor, matches) => {
    const counts = new Map();
    for (const match of matches) {
      if (!counts.has(match.name)) counts.set(match.name, 0);
      if (paired) counts.set(match.name, counts.get(match.name) + 1);
    }
    return counts;
  },
  findEditor: () => editor,
  plainText: () => livePrompt,
  refreshHighlights: () => {},
  unpairedCandidateMatches: () => paired ? [] : [{ name: assetName }],
  unpairedPromptReferences: () => paired ? [] : [{ name: assetName }]
};
plugin.nativeTrigger = { ensurePicker: async () => false };

require("../ui.js");

// This regression exercises content.js event classification, not button or
// confirmation DOM. Keep those installers inert while retaining the real UI
// verification/evaluation implementation and its semantic baseline.
plugin.ui.installAssetChangeGuard = () => {};
plugin.ui.installLocalUploadButton = () => {};
plugin.ui.installMatchButton = () => {};
plugin.ui.installSendGuard = () => {};
plugin.ui.scheduleMatchControlPosition = () => { positionScheduleCalls += 1; };
plugin.ui.updateMatchStatus = () => {};

const invalidateMatchStatus = plugin.ui.invalidateMatchStatus;
plugin.ui.invalidateMatchStatus = (options) => {
  invalidationCalls += 1;
  invalidateMatchStatus(options);
};

function clearStatusTimer() {
  clearTimeout(plugin.state.statusTimer);
  plugin.state.statusTimer = null;
}

function restoreGreen() {
  plugin.ui.trackMatchStatusEditor(editor);
  plugin.ui.setActiveMatchCandidateNames(editor, [assetName]);
  plugin.ui.markMatchVerified(editor, new Map([[assetName, 1]]));
  clearStatusTimer();
  invalidationCalls = 0;
  assert.equal(
    plugin.ui.evaluateMatchStatus(editor, { refreshContent: true }).verified,
    true,
    "the fixture must start from a fully verified green state"
  );
}

function mutation(type, attributes = {}) {
  return {
    addedNodes: [],
    attributeName: null,
    removedNodes: [],
    target: editor,
    type,
    ...attributes
  };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 140));
  clearStatusTimer();
}

require("../content.js");

(async () => {
  assert.equal(typeof observerCallback, "function");
  assert.equal(observerOptions.subtree, true);
  assert.equal((listeners.get("input") || []).length > 0, true);

  restoreGreen();
  dispatch("focusin", { isTrusted: true, target: editor });
  dispatch("selectionchange", { isTrusted: true, target: document });
  await settle();
  assert.equal(plugin.state.matchStatusVerified, true);
  assert.equal(invalidationCalls, 0, "focus and selection alone must stay green");

  restoreGreen();
  const positionCallsBeforeCanvasTransform = positionScheduleCalls;
  observerCallback([mutation("attributes", {
    attributeName: "style",
    target: {
      closest: () => null,
      matches: () => false,
      nodeType: Node.ELEMENT_NODE
    }
  })]);
  await settle();
  assert.equal(
    plugin.state.matchStatusVerified,
    true,
    "panning or zooming an Infinite Canvas ancestor must not invalidate green"
  );
  assert.equal(invalidationCalls, 0);
  assert.equal(
    positionScheduleCalls,
    positionCallsBeforeCanvasTransform + 1,
    "a canvas transform must only schedule lightweight dock repositioning"
  );

  restoreGreen();
  observerCallback([
    mutation("attributes", { attributeName: "class" }),
    mutation("attributes", { attributeName: "style" }),
    mutation("attributes", { attributeName: "data-slate-focused" }),
    mutation("attributes", { attributeName: "data-slate-leaf" }),
    mutation("childList", {
      addedNodes: [{ _insideEditor: true, nodeType: 3, parentElement: editor }],
      removedNodes: [{ _insideEditor: true, nodeType: 3, parentElement: editor }]
    })
  ]);
  await settle();
  assert.equal(
    plugin.state.matchStatusVerified,
    true,
    "a focus-driven Slate rerender with unchanged text and mentions must stay green"
  );
  assert.equal(
    invalidationCalls,
    0,
    "selection/class/style/data-slate scaffolding must not invalidate matching"
  );

  restoreGreen();
  livePrompt = "";
  observerCallback([mutation("childList")]);
  await new Promise((resolve) => setTimeout(resolve, 30));
  livePrompt = `镜头保持稳定，@${assetName}`;
  observerCallback([mutation("childList")]);
  await settle();
  assert.equal(
    plugin.state.matchStatusVerified,
    true,
    "a transient empty Slate tree during focus reconciliation must not reset green"
  );
  assert.equal(invalidationCalls, 0);

  restoreGreen();
  dispatch("input", {
    data: null,
    inputType: "insertText",
    isComposing: false,
    isTrusted: true,
    target: editor
  });
  await settle();
  assert.equal(
    plugin.state.matchStatusVerified,
    true,
    "a trusted input event whose plain text and mention pairing are unchanged must stay green"
  );
  assert.equal(invalidationCalls, 0, "a semantic no-op input must not invalidate");

  restoreGreen();
  livePrompt += "，新增文字";
  dispatch("input", {
    data: "新增文字",
    inputType: "insertText",
    isComposing: false,
    isTrusted: true,
    target: editor
  });
  await settle();
  assert.equal(
    plugin.state.matchStatusVerified,
    false,
    "a real plain-text edit must still invalidate green"
  );
  assert.equal(invalidationCalls > 0, true);

  livePrompt = `镜头保持稳定，@${assetName}`;
  paired = true;
  restoreGreen();
  paired = false;
  dispatch("input", {
    data: null,
    inputType: "historyUndo",
    isComposing: false,
    isTrusted: true,
    target: editor
  });
  await settle();
  assert.equal(
    plugin.state.matchStatusVerified,
    false,
    "removing a native mention must invalidate even when the source text is unchanged"
  );
  assert.equal(invalidationCalls > 0, true);

  console.log("✓ keeps green across focus-only Slate and no-op input events");
  console.log("✓ treats Infinite Canvas transforms as layout-only state");
  console.log("✓ still invalidates real prompt or native-mention changes");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
