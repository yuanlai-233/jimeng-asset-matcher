const assert = require("assert").strict;
const matcher = require("../matcher.js");

const originalPrompt = "@素材甲，@素材乙";
let livePrompt = originalPrompt;
const candidateNames = ["素材甲", "素材乙"];
const attemptedNames = [];
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

globalThis.JimengAssetMatcher = matcher;
globalThis.JimengAssetPlugin = {
  candidates: {
    closePicker: () => {},
    discover: async () => candidateNames.map((name) => ({ element: {}, name })),
    insertMention: async (_editor, match) => {
      attemptedNames.push(match.name);
      livePrompt = "@素材甲，[第二个源引用被网页破坏]";
      return {
        clicked: true,
        ok: false,
        reason: "候选已点击，但源引用已变化",
        retryable: false,
        uncertain: true
      };
    },
    isSystemMenuEntry: () => false
  },
  constants: {
    buttonId: "test-match-button",
    confirmId: "test-confirm",
    controlsId: "test-controls",
    extraConfirmId: "test-extra-confirm",
    localUploadButtonId: "test-upload-button",
    overlayId: "test-overlay",
    statusId: "test-status",
    toastId: "test-toast"
  },
  editor: {
    clearHighlights: () => {},
    countCandidateMentions: (_editor, names) => new Map(
      names.map((name) => [name, 0])
    ),
    countPairedCandidateMentions: (_editor, matches) => {
      const counts = new Map();
      for (const match of matches) {
        if (!counts.has(match.name)) counts.set(match.name, 0);
      }
      return counts;
    },
    findEditor: () => editor,
    highlightReferences: (_editor, references) => references.map((item) => item.name),
    isMatchPaired: () => false,
    plainText: () => livePrompt,
    refreshHighlights: () => {}
  },
  nativeTrigger: {
    ensurePicker: async () => true
  },
  sleep: async () => {},
  state: {
    candidateNamesSnapshot: [],
    expectedMentionCounts: new Map(),
    highlightCount: 0,
    localUploading: false,
    matchStatusEditor: null,
    matchStatusVerified: false,
    matching: false
  },
  ui: {
    installAssetChangeGuard: () => {},
    installMatchButton: (callback) => { runMatching = callback; },
    installSendGuard: () => {},
    invalidateMatchStatus: () => {},
    markMatchVerified: () => {},
    materialBaselineChanged: () => false,
    reviewCandidateUsage: (_editor, names) => {
      globalThis.JimengAssetPlugin.state.candidateNamesSnapshot = [...names];
      return [];
    },
    scheduleMatchControlPosition: () => {},
    setExpectedMentionCounts: (counts) => {
      globalThis.JimengAssetPlugin.state.expectedMentionCounts = new Map(counts);
    },
    setMatchFailures: () => {},
    showUnexpectedMaterialsReview: () => {},
    toast: () => {},
    trackMatchStatusEditor: (trackedEditor) => {
      globalThis.JimengAssetPlugin.state.matchStatusEditor = trackedEditor;
    },
    updateMatchStatus: () => {}
  },
  version: "test"
};

const rootAttributes = new Map();
globalThis.document = {
  addEventListener: () => {},
  contains: () => true,
  documentElement: {
    hasAttribute: (name) => rootAttributes.has(name),
    setAttribute: (name, value) => rootAttributes.set(name, value)
  },
  getElementById: () => ({})
};
globalThis.window = { addEventListener: () => {} };
globalThis.visualViewport = { addEventListener: () => {} };
globalThis.Node = { ELEMENT_NODE: 1 };
globalThis.MutationObserver = class MutationObserver {
  observe() {}
};

require("../content.js");

(async () => {
  assert.equal(typeof runMatching, "function");
  await runMatching({ disabled: false, textContent: "自动匹配" });

  assert.deepEqual(
    attemptedNames,
    ["素材乙"],
    "a click that damages its source token must stop before the next slot starts"
  );
  assert.equal(
    livePrompt.includes("@素材乙"),
    false,
    "the fixture must reproduce the destructive native-page rewrite"
  );
  console.log("✓ a destructive candidate click stops the remaining match pass");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
