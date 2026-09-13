const assert = require("assert").strict;
const matcher = require("../matcher.js");

const assetName = "晚到素材";
let prompt = `@${assetName}`;
let highlighted = [];
let paired = false;
let runMatching = null;
let insertCalls = 0;
let markVerifiedCalls = 0;
let reportedFailures = new Map();

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
    discover: async () => [{ element: {}, name: assetName }],
    insertMention: async () => {
      insertCalls += 1;
      return {
        clicked: true,
        ok: false,
        reason: "候选已点击，原生标签尚未确认",
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
    highlightReferences: (_editor, references) => {
      highlighted = references.map((item) => item.name);
      return highlighted;
    },
    isMatchPaired: (_editor, reference) => paired && reference.name === assetName,
    plainText: () => prompt,
    refreshHighlights: () => {}
  },
  nativeTrigger: {
    ensurePicker: async () => true
  },
  sleep: async (duration) => {
    if (duration === 240) paired = true;
  },
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
    markMatchVerified: () => {
      markVerifiedCalls += 1;
    },
    materialBaselineChanged: () => false,
    reviewCandidateUsage: (_editor, names) => {
      globalThis.JimengAssetPlugin.state.candidateNamesSnapshot = [...names];
      return [];
    },
    scheduleMatchControlPosition: () => {},
    setExpectedMentionCounts: (counts) => {
      globalThis.JimengAssetPlugin.state.expectedMentionCounts = new Map(counts);
    },
    setMatchFailures: (failures) => {
      reportedFailures = new Map(failures);
    },
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

  assert.equal(insertCalls, 1, "the uncertain slot is clicked only once");
  assert.equal(paired, true, "the fixture must expose the late adjacent mention");
  assert.equal(
    reportedFailures.has(assetName),
    false,
    "final exact adjacency must clear the earlier uncertain-click failure"
  );
  assert.equal(
    markVerifiedCalls,
    1,
    "a late pair that satisfies every slot must finish as verified"
  );
  console.log("✓ a late adjacent mention supersedes an earlier uncertain-click result");
  prompt += " @缺失场景 @缺失场景";
  await runMatching({ disabled: false, textContent: "自动匹配" });
  assert.deepEqual(highlighted, ["缺失场景", "缺失场景"],
    "the completed pass highlights every missing slot without recoloring the paired asset");
  assert.equal(reportedFailures.has("缺失场景"), true);
  assert.equal(markVerifiedCalls, 1, "missing assets cannot mark the prompt verified");
  console.log("✓ final matching highlights repeated absent assets alongside a successful native pair");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
