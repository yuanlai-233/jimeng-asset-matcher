const assert = require("assert").strict;

const assetName = "17_测试昆虫素材 白色背景 正面展示";
const genericName = "17_测试昆虫素材";
const token = `@${assetName}`;
const match = {
  end: token.length,
  name: assetName,
  start: 0,
  token
};

let discoverCalls = 0;
let insertCalls = 0;
let runMatching = null;
let reportedFailures = new Map();
const candidateSnapshots = [];

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

globalThis.JimengAssetMatcher = {
  missingPromptReferences: require("../matcher.js").missingPromptReferences,
  promptReferenceErrors: require("../matcher.js").promptReferenceErrors,
  matchBelongsToReference: (reference, candidate) => (
    reference.name === candidate.name && reference.start === candidate.start
  ),
  matchSlotKey: (candidate) => JSON.stringify([
    candidate.name,
    candidate.start,
    candidate.end
  ]),
  matchPromptToCandidates: (_prompt, names) => {
    candidateSnapshots.push([...names]);
    return names.includes(assetName) ? [{ ...match }] : [];
  },
  mentionTargetFailures: () => new Map(),
  normalizeText: (value) => String(value || "").trim(),
  // Generic parsing stops at the first space; the candidate-aware matcher
  // below still resolves the complete uploaded filename at the same @ start.
  parsePromptReferences: () => [{
    end: genericName.length + 1,
    name: genericName,
    start: 0,
    token: `@${genericName}`
  }],
  planMatchesToMentionTargets: (matches) => ({
    matches: matches.map((item) => ({ ...item })),
    targetCounts: new Map([[assetName, 1]])
  }),
  promptHasExactTarget: () => true,
  pruneInactiveMentionTargets: (expected) => new Map(expected),
  selectionReplacesPrompt: () => false
};

const state = {
  candidateNamesSnapshot: [],
  expectedMentionCounts: new Map(),
  highlightCount: 0,
  matchStatusEditor: null,
  matchStatusVerified: false,
  matching: false
};

globalThis.JimengAssetPlugin = {
  candidates: {
    closePicker: () => {},
    discover: async () => {
      discoverCalls += 1;
      return [{ element: {}, name: assetName }];
    },
    insertMention: async () => {
      insertCalls += 1;
      // Keep the explicit token in place so final adjacency validation fails.
      return {
        ok: false,
        reason: "fixture forces a supplemental pass",
        retryable: false
      };
    },
    isSystemMenuEntry: () => false
  },
  constants: {
    buttonId: "test-match-button",
    confirmId: "test-confirm",
    controlsId: "test-controls",
    extraConfirmId: "test-extra-confirm",
    overlayId: "test-overlay",
    statusId: "test-status",
    toastId: "test-toast"
  },
  editor: {
    clearHighlights: () => {},
    countCandidateMentions: (_editor, names) => new Map(
      names.map((name) => [name, 0])
    ),
    countExactMentions: () => 0,
    countPairedCandidateMentions: (_editor, matches) => new Map(
      matches.map((item) => [item.name, 0])
    ),
    findEditor: () => editor,
    findRangeAt: () => ({}),
    highlightReferences: (_editor, references) => references.map((item) => item.name),
    highlightRemaining: () => [assetName],
    isMatchPaired: () => false,
    plainText: () => token,
    refreshHighlights: () => {}
  },
  nativeTrigger: {
    ensurePicker: async () => true
  },
  sleep: async () => {},
  state,
  ui: {
    installAssetChangeGuard: () => {},
    installMatchButton: (callback) => { runMatching = callback; },
    installSendGuard: () => {},
    invalidateMatchStatus: () => {},
    markMatchVerified: () => {},
    materialBaselineChanged: () => false,
    reviewCandidateUsage: (_editor, names) => {
      state.candidateNamesSnapshot = [...names];
      return [];
    },
    scheduleMatchControlPosition: () => {},
    setExpectedMentionCounts: (counts) => {
      state.expectedMentionCounts = new Map(counts);
    },
    setMatchFailures: (failures) => {
      reportedFailures = new Map(failures);
    },
    showUnexpectedMaterialsReview: () => {},
    toast: () => {},
    trackMatchStatusEditor: (trackedEditor) => {
      state.matchStatusEditor = trackedEditor;
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
globalThis.window = {
  addEventListener: () => {}
};
globalThis.visualViewport = {
  addEventListener: () => {}
};
globalThis.Node = {
  ELEMENT_NODE: 1
};
globalThis.MutationObserver = class MutationObserver {
  observe() {}
};

require("../content.js");

(async () => {
  assert.equal(typeof runMatching, "function", "content startup must expose its match callback");
  const button = { disabled: false, textContent: "自动匹配" };
  await runMatching(button);

  assert.equal(
    insertCalls,
    1,
    "one matching run must click a slot at most once even when confirmation fails"
  );
  assert.equal(
    discoverCalls,
    1,
    "initial and supplemental matching must share one authoritative candidate snapshot"
  );
  assert.equal(candidateSnapshots.length >= 2, true);
  for (const snapshot of candidateSnapshots) {
    assert.deepEqual(snapshot, [assetName]);
  }
  assert.deepEqual(
    state.candidateNamesSnapshot,
    [],
    "an incomplete/failed pass must not publish a catalogue for extra-material review"
  );
  assert.equal(
    reportedFailures.has(genericName),
    false,
    "a full candidate with spaces must not be re-reported under its truncated generic name"
  );
  assert.equal(reportedFailures.has(assetName), true);
  console.log("✓ one candidate snapshot feeds a single non-retrying pass without auditing failures");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
