const assert = require("assert").strict;

globalThis.JimengAssetMatcher = require("../matcher.js");
require("../runtime.js");
require("../local-assets.js");
require("../local-workflow.js");

const plugin = globalThis.JimengAssetPlugin;
const events = [];
const nativeCounts = new Map();
const pairedSlots = new Set();
let cachedCandidateNames = [];
let candidateNames = [];
let directorySelections = 0;
let discoverCalls = 0;
let ensurePickerCalls = 0;
let expectedUploadCount = 0;
let editorConnected = true;
let activeEditor = null;
let afterDiscover = null;
let discoverBarrier = null;
let getFileCalls = [];
let insertCalls = 0;
let lastMatchFailures = new Map();
let prompt = "";
let runLocalUpload = null;
let runMatchingDirect = null;
let uploadFiles = async () => {};
let selectedDirectory = null;
let pageObserverCallback = null;
let pageObserverOptions = null;
let positionScheduleCalls = 0;

function file(name) {
  return {
    kind: "file",
    name,
    async getFile() {
      getFileCalls.push(name);
      events.push(`get-file:${name}`);
      return { name, size: 100, type: "image/png" };
    }
  };
}

function directory(name, entries) {
  return {
    kind: "directory",
    name,
    async *entries() {
      events.push(`scan-directory:${name}`);
      for (const entry of entries) yield [entry.name, entry];
    }
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}

async function waitUntil(check, attempts = 100) {
  for (let index = 0; index < attempts; index += 1) {
    if (check()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("Timed out waiting for the local upload workflow fixture");
}

const editor = {
  contains: () => false,
  getBoundingClientRect: () => ({
    bottom: 700,
    height: 300,
    left: 100,
    right: 900,
    top: 400,
    width: 800
  }),
  parentElement: null
};
const matchButton = { disabled: false, textContent: "自动匹配" };
const uploadButton = { disabled: false, textContent: "自动上传" };

plugin.candidates = {
  closePicker: () => {},
  discover: async () => {
    discoverCalls += 1;
    events.push(plugin.state.matching ? "matching-catalogue" : "pre-upload-catalogue");
    if (discoverBarrier) await discoverBarrier;
    const rows = candidateNames.map((name) => ({ element: {}, name }));
    afterDiscover?.();
    return rows;
  },
  expectedUploadCount: () => expectedUploadCount,
  insertMention: async (_editor, match) => {
    if (!candidateNames.includes(match.name)) {
      return {
        ok: false,
        reason: "原生候选菜单中还没有发布该同名素材",
        retryable: false
      };
    }
    insertCalls += 1;
    events.push(`match:${match.name}`);
    assert.equal(
      prompt.slice(match.start, match.end),
      match.token,
      "the fixture expects content matching to operate on the original exact token"
    );
    pairedSlots.add(globalThis.JimengAssetMatcher.matchSlotKey(match));
    nativeCounts.set(match.name, (nativeCounts.get(match.name) || 0) + 1);
    return { ok: true };
  },
  isSystemMenuEntry: () => false
};

plugin.editor = {
  clearHighlights: () => {},
  countCandidateMentions: (_editor, names) => new Map(
    names.map((name) => [name, nativeCounts.get(name) || 0])
  ),
  countExactMentions: (_editor, name) => nativeCounts.get(name) || 0,
  countPairedCandidateMentions: (_editor, matches) => {
    const counts = new Map();
    for (const match of matches) {
      if (!counts.has(match.name)) counts.set(match.name, 0);
      if (pairedSlots.has(globalThis.JimengAssetMatcher.matchSlotKey(match))) {
        counts.set(match.name, counts.get(match.name) + 1);
      }
    }
    return counts;
  },
  findEditor: () => activeEditor,
  findRangeAt: (_editor, token, start) => (
    prompt.slice(start, start + token.length) === token ? {} : null
  ),
  highlightReferences: (_editor, references) => references.map((item) => item.name),
  highlightRemaining: () => [],
  isMatchPaired: (_editor, match) => pairedSlots.has(
    globalThis.JimengAssetMatcher.matchSlotKey(match)
  ),
  plainText: () => prompt,
  refreshHighlights: () => {}
};

plugin.localUpload = {
  uploadFiles: (...args) => uploadFiles(...args)
};

plugin.nativeTrigger = {
  ensurePicker: async (_editor, options = {}) => {
    ensurePickerCalls += 1;
    if (await options.beforeClick?.() === false) return false;
    events.push(plugin.state.matching ? "matching-picker" : "pre-upload-picker");
    return true;
  }
};

plugin.sleep = async () => {};
plugin.ui = {
  cacheCandidateCatalog: (_editor, names) => {
    cachedCandidateNames = [...names];
    plugin.state.candidateCatalogComplete = cachedCandidateNames.length > 0;
    plugin.state.candidateCatalogEditor = _editor;
    plugin.state.candidateNamesSnapshot = [...cachedCandidateNames];
    return [...names];
  },
  installAssetChangeGuard: () => {},
  installLocalUploadButton: (callback) => { runLocalUpload = callback; },
  installMatchButton: (callback) => { runMatchingDirect = callback; },
  installSendGuard: () => {},
  invalidateCandidateCatalog: () => {
    cachedCandidateNames = [];
    plugin.state.candidateCatalogComplete = false;
    plugin.state.candidateCatalogEditor = null;
    plugin.state.candidateNamesSnapshot = [];
  },
  invalidateMatchStatus: () => {
    plugin.state.matchStatusVerified = false;
  },
  markMatchVerified: (verifiedEditor) => {
    plugin.state.matchStatusEditor = verifiedEditor;
    plugin.state.matchStatusVerified = true;
    lastMatchFailures = new Map();
  },
  materialBaselineChanged: () => false,
  readCandidateCatalog: () => [...cachedCandidateNames],
  rebaseExpectedMentionCounts: () => {},
  resetMatchSession: () => {
    if (plugin.state.localUploading) return;
    plugin.state.localUploadNeedsReconcile = false;
    plugin.state.localUploadPendingNames = [];
    plugin.state.localUploadPendingByEditor = new WeakMap();
    plugin.state.localUploadRejectedByEditor = new WeakSet();
    plugin.state.localUploadReconcileEditor = null;
    plugin.state.localUploadVerifiedNamesByEditor = new WeakMap();
  },
  reviewCandidateUsage: () => [],
  scheduleMatchControlPosition: () => { positionScheduleCalls += 1; },
  setExpectedMentionCounts: (counts) => {
    plugin.state.expectedMentionCounts = new Map(counts);
  },
  setActiveMatchCandidateNames: (_editor, names) => {
    plugin.state.candidateCatalogComplete = false;
    plugin.state.candidateCatalogEditor = null;
    plugin.state.candidateNamesSnapshot = [...names];
    return [...names];
  },
  setMatchFailures: (failures) => {
    lastMatchFailures = new Map(failures);
  },
  showUnexpectedMaterialsReview: () => {},
  toast: () => {},
  trackMatchStatusEditor: (trackedEditor) => {
    plugin.state.matchStatusEditor = trackedEditor;
  },
  updateMatchStatus: () => {}
};

globalThis.JimengLocalDirectory = {
  chooseDirectory: async () => {
    directorySelections += 1;
    events.push("choose-directory");
    return { handle: selectedDirectory };
  },
  requestReadPermission: async () => "granted",
  restoreDirectory: async () => ({ handle: null })
};

const rootAttributes = new Map();
globalThis.document = {
  addEventListener: () => {},
  contains: (element) => element !== editor || editorConnected,
  documentElement: {
    hasAttribute: (name) => rootAttributes.has(name),
    setAttribute: (name, value) => rootAttributes.set(name, value)
  },
  getElementById: (id) => (
    id === plugin.constants.buttonId ? matchButton : null
  )
};
globalThis.window = { addEventListener: () => {} };
globalThis.visualViewport = { addEventListener: () => {} };
globalThis.Node = { ELEMENT_NODE: 1 };
globalThis.MutationObserver = class MutationObserver {
  constructor(callback) {
    pageObserverCallback = callback;
  }
  observe(_target, options) {
    pageObserverOptions = options;
  }
};

require("../content.js");
assert.ok(
  ["aria-hidden", "class", "data-state", "hidden", "open", "style"]
    .every((name) => pageObserverOptions.attributeFilter.includes(name)),
  "page visibility attributes must trigger a fresh active-composer check"
);
const positionCallsBeforeVisibilityMutation = positionScheduleCalls;
pageObserverCallback([{
  addedNodes: [],
  attributeName: "class",
  removedNodes: [],
  target: {
    closest: () => null,
    matches: () => false,
    nodeType: Node.ELEMENT_NODE
  },
  type: "attributes"
}]);
assert.equal(
  positionScheduleCalls,
  positionCallsBeforeVisibilityMutation + 1,
  "a class-only SPA detail transition must immediately re-check dock visibility"
);

function resetScenario() {
  cachedCandidateNames = [];
  candidateNames = [];
  directorySelections = 0;
  discoverCalls = 0;
  ensurePickerCalls = 0;
  events.length = 0;
  expectedUploadCount = 0;
  editorConnected = true;
  activeEditor = editor;
  afterDiscover = null;
  discoverBarrier = null;
  getFileCalls = [];
  insertCalls = 0;
  lastMatchFailures = new Map();
  editor.parentElement = null;
  nativeCounts.clear();
  pairedSlots.clear();
  plugin.state.expectedMentionCounts = new Map();
  plugin.state.candidateCatalogComplete = false;
  plugin.state.candidateCatalogEditor = null;
  plugin.state.candidateNamesSnapshot = [];
  plugin.state.localAssetIndex = null;
  plugin.state.localAssetIndexHandle = null;
  plugin.state.localDirectoryHandle = null;
  plugin.state.localUploadNeedsReconcile = false;
  plugin.state.localUploadPendingNames = [];
  plugin.state.localUploadPendingByEditor = new WeakMap();
  plugin.state.localUploadRejectedByEditor = new WeakSet();
  plugin.state.localUploadReconcileEditor = null;
  plugin.state.localUploadVerifiedNamesByEditor = new WeakMap();
  plugin.state.localUploading = false;
  plugin.state.matchStatusEditor = null;
  plugin.state.matchStatusVerified = false;
  plugin.state.matching = false;
  matchButton.disabled = false;
  matchButton.textContent = "自动匹配";
  uploadButton.disabled = false;
  uploadButton.textContent = "自动上传";
}

async function testUploadResolvesBeforeMatching() {
  resetScenario();
  selectedDirectory = directory("素材库", [
    file("新素材.png"),
    file("已有素材.png"),
    file("正文同名.png"),
    file("未引用.png")
  ]);
  prompt = "正文同名不上传；@新素材 与 @已有素材 同时出现，后面再用 @新素材。";
  candidateNames = ["已有素材"];
  expectedUploadCount = 1;
  const uploadGate = deferred();
  let receivedFiles = [];
  let receivedContextRoot = null;
  const composerRoot = {
    parentElement: null,
    querySelector: () => ({ type: "file" })
  };
  editor.parentElement = composerRoot;

  uploadFiles = async (files, options) => {
    assert.equal(
      plugin.state.localAssetIndexHandle,
      selectedDirectory,
      "the selected directory handle must be cached before upload starts"
    );
    assert.deepEqual(
      Array.from(plugin.state.localAssetIndex?.byAssetName?.keys?.() || []),
      ["已有素材", "新素材", "未引用", "正文同名"],
      "the complete local filename catalogue must be cached before prompt intersection files are dispatched"
    );
    assert.equal(
      ensurePickerCalls,
      0,
      "auto upload must not open the native @ picker before handing files to the page"
    );
    assert.equal(
      discoverCalls,
      0,
      "auto upload must not discover the native catalogue before handing files to the page"
    );
    assert.equal(
      insertCalls,
      0,
      "auto upload must not insert native mentions before handing files to the page"
    );
    receivedFiles = files;
    receivedContextRoot = options.contextRoot;
    events.push("upload-start");
    assert.equal(
      ensurePickerCalls + discoverCalls + insertCalls,
      0,
      "onFilesDispatched must run before every native @ operation"
    );
    options.onFilesDispatched?.();
    events.push("files-dispatched");
    await uploadGate.promise;
    candidateNames = ["已有素材", "新素材"];
    expectedUploadCount = 2;
    events.push("upload-resolved");
  };

  const workflow = runLocalUpload(uploadButton, { forceDirectory: true });
  await waitUntil(() => events.includes("upload-start"));

  assert.deepEqual(
    receivedFiles.map((item) => item.name),
    ["新素材.png", "已有素材.png"],
    "without a trusted task cache, the local filename/prompt intersection owns the upload plan"
  );
  assert.equal(receivedContextRoot, composerRoot);
  assert.deepEqual(getFileCalls, ["新素材.png", "已有素材.png"]);
  assert.equal(ensurePickerCalls, 0);
  assert.equal(discoverCalls, 0);
  assert.equal(insertCalls, 0, "native matching must not start while uploadFiles is pending");
  assert.equal(events.indexOf("choose-directory") < events.indexOf("scan-directory:素材库"), true);
  assert.equal(events.indexOf("scan-directory:素材库") < events.indexOf("get-file:新素材.png"), true);
  assert.equal(events.indexOf("get-file:已有素材.png") < events.indexOf("upload-start"), true);

  uploadGate.resolve();
  await workflow;

  assert.equal(ensurePickerCalls, 0, "automatic upload must stop without opening @");
  assert.equal(discoverCalls, 0, "automatic upload must not verify through the native menu");
  assert.equal(insertCalls, 0, "automatic upload must not continue into matching");
  assert.deepEqual(
    plugin.state.localUploadPendingByEditor.get(editor),
    ["新素材", "已有素材"],
    "the dispatched upload remains pending until the separate manual match action"
  );
  assert.equal(
    events.filter((event) => event === "get-file:新素材.png").length,
    1,
    "a repeated @ reference must materialize and upload one local file"
  );

  const uploadResolvedAt = events.indexOf("upload-resolved");
  await runMatchingDirect(matchButton);
  const firstMatchAt = events.findIndex((event) => event.startsWith("match:"));
  assert.equal(
    uploadResolvedAt < firstMatchAt,
    true,
    "only a later explicit automatic-match click may begin native mention insertion"
  );
  assert.equal(
    ensurePickerCalls + discoverCalls,
    0,
    "pending exact local names must bypass the content-layer full-catalogue scan"
  );
  assert.equal(insertCalls, 3, "manual matching handles every explicit source slot");
  assert.equal(plugin.state.localUploadNeedsReconcile, false);
  assert.equal(matchButton.textContent, "自动匹配");
}

async function testVerifiedLedgerSkipsSecondAutomaticUpload() {
  resetScenario();
  selectedDirectory = directory("素材库", [file("账本素材.png")]);
  prompt = "人物使用 @账本素材。";
  let uploadCalls = 0;
  uploadFiles = async (_files, options) => {
    uploadCalls += 1;
    options.onFilesDispatched?.();
    candidateNames = ["账本素材"];
    expectedUploadCount = 1;
  };

  await runLocalUpload(uploadButton, { forceDirectory: true });

  assert.equal(uploadCalls, 1);
  assert.deepEqual(getFileCalls, ["账本素材.png"]);
  assert.equal(insertCalls, 0, "upload must wait for a separate match click");
  assert.equal(
    plugin.state.localUploadVerifiedNamesByEditor.get(editor),
    undefined,
    "upload dispatch alone is not native-catalogue verification"
  );

  await runMatchingDirect(matchButton);

  assert.deepEqual(
    Array.from(plugin.state.localUploadVerifiedNamesByEditor.get(editor) || []),
    ["账本素材"],
    "the explicit match action commits catalogue-confirmed names to the ledger"
  );
  assert.deepEqual(
    plugin.state.candidateNamesSnapshot,
    ["账本素材"],
    "the pending fast path must retain its exact names for status evaluation"
  );
  assert.equal(
    plugin.state.candidateCatalogComplete,
    false,
    "a pending-name status snapshot must not masquerade as a full native catalogue"
  );
  assert.deepEqual(
    plugin.ui.readCandidateCatalog(editor),
    [],
    "the next non-pending match must not reuse the partial status snapshot"
  );
  assert.equal(
    plugin.state.matchStatusVerified,
    true,
    "a successful pending match may become verified with its status-only snapshot"
  );
  const insertsAfterFirstRun = insertCalls;
  const nativeCallsAfterManualMatch = {
    discover: discoverCalls,
    ensurePicker: ensurePickerCalls
  };

  await runLocalUpload(uploadButton, { forceDirectory: false });

  assert.equal(uploadCalls, 1, "a verified file must not be uploaded twice");
  assert.deepEqual(
    getFileCalls,
    ["账本素材.png"],
    "a verified file must not even be materialized again"
  );
  assert.equal(
    insertCalls,
    insertsAfterFirstRun,
    "automatic upload never checks or mutates native mention slots"
  );
  assert.deepEqual(
    { discover: discoverCalls, ensurePicker: ensurePickerCalls },
    nativeCallsAfterManualMatch,
    "an already-uploaded automatic pass must still avoid the native @ menu"
  );
}

async function testPendingAReconcilesBeforeUnknownWebB() {
  for (const repetitions of [1, 3]) {
    resetScenario();
    candidateNames = Array.from({ length: 50 }, (_, i) => `素材_${String(i + 1).padStart(2, "0")}`);
    const localNames = candidateNames.slice(0, 30);
    prompt = Array.from({ length: repetitions }, () => candidateNames.map(name => `@${name}`).join("，")).join("。\n");
    const originalPrompt = prompt;
    plugin.state.localUploadPendingByEditor.set(editor, localNames);
    plugin.state.localUploadNeedsReconcile = true;
    plugin.state.localUploadPendingNames = localNames;
    plugin.state.localUploadReconcileEditor = editor;
    expectedUploadCount = 50;

    await runMatchingDirect(matchButton);

    assert.equal(insertCalls, 50 * repetitions, "one click must process every slot, including names outside the 30 local images");
    assert.equal(discoverCalls, 1, "mixed references require one complete catalogue");
    for (const name of candidateNames) assert.equal(nativeCounts.get(name), repetitions);
    assert.equal(lastMatchFailures.size, 0);
    assert.equal(plugin.state.matchStatusVerified, true);
    assert.equal(plugin.state.localUploadNeedsReconcile, false);
    assert.equal(plugin.state.localUploadPendingByEditor.get(editor), undefined);
    assert.deepEqual(Array.from(plugin.state.localUploadVerifiedNamesByEditor.get(editor) || []), localNames);
    assert.equal(prompt, originalPrompt);

    await runMatchingDirect(matchButton);
    assert.equal(insertCalls, 50 * repetitions, "repeated matching must not duplicate any of the 150 slots");
  }
}

async function testAuthoritativeCataloguePrunesOnlyMissingVerifiedNames() {
  resetScenario();
  selectedDirectory = directory("素材库", [
    file("精确恢复A.png"),
    file("继续保留B.png")
  ]);
  prompt = "人物使用 @精确恢复A 与 @继续保留B。";
  let uploadCalls = 0;
  let nativeCallsBeforeRepairUpload = null;
  const uploadedBatches = [];
  uploadFiles = async (files, options) => {
    uploadCalls += 1;
    if (uploadCalls === 2) {
      assert.deepEqual(
        {
          discover: discoverCalls,
          ensurePicker: ensurePickerCalls,
          insertMention: insertCalls
        },
        nativeCallsBeforeRepairUpload,
        "the repair upload must reach dispatch without any new pre-upload @ operation"
      );
    }
    uploadedBatches.push(files.map((item) => item.name));
    options.onFilesDispatched?.();
    candidateNames = ["精确恢复A", "继续保留B"];
    expectedUploadCount = 2;
  };

  await runLocalUpload(uploadButton, { forceDirectory: true });

  assert.equal(uploadCalls, 1);
  assert.deepEqual(uploadedBatches, [["精确恢复A.png", "继续保留B.png"]]);
  assert.equal(insertCalls, 0);
  await runMatchingDirect(matchButton);
  assert.deepEqual(
    Array.from(plugin.state.localUploadVerifiedNamesByEditor.get(editor) || []),
    ["精确恢复A", "继续保留B"]
  );

  // The page has removed only A. Only a separate explicit match click may
  // read the authoritative catalogue and prune the verified ledger.
  candidateNames = ["继续保留B"];
  expectedUploadCount = 1;
  plugin.ui.invalidateCandidateCatalog();
  await runMatchingDirect(matchButton);

  assert.equal(uploadCalls, 1, "the authoritative pruning pass must not upload");
  assert.deepEqual(
    getFileCalls,
    ["精确恢复A.png", "继续保留B.png"],
    "the catalogue-check pass must not materialize either local file"
  );
  assert.deepEqual(
    Array.from(plugin.state.localUploadVerifiedNamesByEditor.get(editor) || []),
    ["继续保留B"],
    "authoritative discovery must remove A while retaining verified B"
  );
  assert.equal(
    lastMatchFailures.has("精确恢复A"),
    true,
    "the pruning pass may report the now-missing A reference"
  );
  nativeCallsBeforeRepairUpload = {
    discover: discoverCalls,
    ensurePicker: ensurePickerCalls,
    insertMention: insertCalls
  };

  await runLocalUpload(uploadButton, { forceDirectory: false });

  assert.equal(uploadCalls, 2);
  assert.deepEqual(
    uploadedBatches,
    [
      ["精确恢复A.png", "继续保留B.png"],
      ["精确恢复A.png"]
    ],
    "the repair pass must upload A only and keep B protected by the ledger"
  );
  assert.deepEqual(
    getFileCalls,
    ["精确恢复A.png", "继续保留B.png", "精确恢复A.png"]
  );
  assert.deepEqual(
    {
      discover: discoverCalls,
      ensurePicker: ensurePickerCalls,
      insertMention: insertCalls
    },
    nativeCallsBeforeRepairUpload,
    "the repair upload must stop before any new native matching work"
  );
}

async function testUploadCompletionDoesNotPerformCatalogueVerification() {
  resetScenario();
  selectedDirectory = directory("素材库", [file("临界确认.png")]);
  prompt = "人物使用 @临界确认。";
  let uploadCalls = 0;
  uploadFiles = async (_files, options) => {
    uploadCalls += 1;
    options.onFilesDispatched?.();
    candidateNames = ["临界确认"];
    expectedUploadCount = 1;
  };
  afterDiscover = () => {
    throw new Error("automatic upload must not discover the native catalogue");
  };

  await runLocalUpload(uploadButton, { forceDirectory: true });

  assert.equal(uploadCalls, 1);
  assert.deepEqual(getFileCalls, ["临界确认.png"]);
  assert.equal(ensurePickerCalls, 0);
  assert.equal(discoverCalls, 0);
  assert.equal(insertCalls, 0);
  assert.equal(plugin.state.localUploadNeedsReconcile, true);
  assert.equal(
    plugin.state.localUploadVerifiedNamesByEditor.get(editor),
    undefined,
    "only manual matching may promote a dispatched name to verified"
  );
}

async function testNoLocalIntersectionStopsBeforeNativeOrUpload() {
  resetScenario();
  selectedDirectory = directory("素材库", [
    file("目录中的其他素材.png"),
    directory("子目录", [file("仍然不匹配.jpg")])
  ]);
  prompt = "镜头只引用 @文件夹里没有。";
  // These values deliberately make the old implementation eager to open the
  // native menu. A folder-first run must ignore them when the local index has
  // no exact intersection with the prompt.
  candidateNames = ["文件夹里没有"];
  expectedUploadCount = 99;
  let uploadCalls = 0;
  uploadFiles = async () => {
    uploadCalls += 1;
  };

  try {
    await runLocalUpload(uploadButton, { forceDirectory: true });
  } catch (_error) {
    // The UI may surface "no local match" as either a rejected action or an
    // informational early return; the protected behavior is zero side effects.
  }

  assert.equal(directorySelections, 1, "the selected directory must still be indexed first");
  assert.equal(events.includes("scan-directory:素材库"), true);
  assert.equal(events.includes("scan-directory:子目录"), true);
  assert.deepEqual(getFileCalls, [], "non-matching file handles must stay metadata-only");
  assert.equal(uploadCalls, 0, "no local filename intersection means no upload");
  assert.equal(ensurePickerCalls, 0, "no local match must not open the native @ picker");
  assert.equal(discoverCalls, 0, "no local match must not scan the native catalogue");
  assert.equal(insertCalls, 0, "no local match must not insert a native mention");
}

async function testPromptChangeStopsMatching() {
  resetScenario();
  selectedDirectory = directory("素材库", [file("变化前.png")]);
  prompt = "人物 @变化前。";
  uploadFiles = async (_files, options) => {
    events.push("upload-start");
    options.onFilesDispatched?.();
    prompt = "人物 @变化后。";
    events.push("upload-resolved");
  };

  await assert.rejects(
    () => runLocalUpload(uploadButton, { forceDirectory: true }),
    (error) => error?.code === "PROMPT_CHANGED_DURING_UPLOAD"
  );

  assert.deepEqual(getFileCalls, ["变化前.png"]);
  assert.equal(insertCalls, 0, "a changed prompt must never continue to runMatching");
  assert.equal(
    events.includes("matching-catalogue"),
    false,
    "a changed prompt must stop before the post-upload native catalogue scan"
  );
}

async function testResolvedAdapterWithoutDispatchConfirmationStopsBeforeNative() {
  resetScenario();
  selectedDirectory = directory("素材库", [file("未分派.png")]);
  prompt = "人物 @未分派。";
  let uploadCalls = 0;
  uploadFiles = async () => {
    uploadCalls += 1;
    events.push("adapter-resolved-without-dispatch");
  };

  await assert.rejects(
    () => runLocalUpload(uploadButton, { forceDirectory: true }),
    (error) => error?.code === "UPLOAD_DISPATCH_NOT_CONFIRMED"
  );

  assert.equal(uploadCalls, 1);
  assert.deepEqual(getFileCalls, ["未分派.png"]);
  assert.equal(ensurePickerCalls, 0, "an unconfirmed adapter result must not open @");
  assert.equal(discoverCalls, 0, "an unconfirmed adapter result must not read candidates");
  assert.equal(insertCalls, 0, "an unconfirmed adapter result must not insert mentions");
  assert.equal(plugin.state.localUploadNeedsReconcile, false);
  assert.deepEqual(plugin.state.localUploadPendingNames, []);
  assert.equal(
    plugin.state.localUploadPendingByEditor.get(editor),
    undefined,
    "a batch that never reached onFilesDispatched must not lock later retries"
  );
}

async function testPromptClearDuringDispatchKeepsRetryGuard() {
  resetScenario();
  selectedDirectory = directory("素材库", [file("清空期间.png")]);
  prompt = "人物 @清空期间。";
  let uploadCalls = 0;
  uploadFiles = async (_files, options) => {
    uploadCalls += 1;
    options.onFilesDispatched?.();
    prompt = "";
    plugin.ui.resetMatchSession();
  };

  await assert.rejects(
    () => runLocalUpload(uploadButton, { forceDirectory: true }),
    (error) => error?.code === "PROMPT_CHANGED_DURING_UPLOAD"
  );
  assert.equal(plugin.state.localUploadNeedsReconcile, true);
  assert.deepEqual(plugin.state.localUploadPendingNames, ["清空期间"]);

  prompt = "人物 @清空期间。";
  await assert.rejects(
    () => runLocalUpload(uploadButton, { forceDirectory: false }),
    (error) => error?.code === "UPLOAD_ATTEMPT_NOT_RECONCILED"
  );
  assert.equal(uploadCalls, 1, "clearing and restoring the prompt must not dispatch twice");
}

async function testConflictStopsBeforeEveryUploadSideEffect() {
  resetScenario();
  selectedDirectory = directory("素材库", [
    directory("角色", [file("冲突素材.png")]),
    directory("备份", [file("冲突素材.jpg")])
  ]);
  prompt = "人物使用 @冲突素材。";
  let uploadCalls = 0;
  uploadFiles = async () => {
    uploadCalls += 1;
  };

  await assert.rejects(
    () => runLocalUpload(uploadButton, { forceDirectory: true }),
    /同名素材/
  );

  assert.deepEqual(getFileCalls, [], "conflicts must stop before file handles are materialized");
  assert.equal(uploadCalls, 0, "conflicts must stop before the page upload adapter runs");
  assert.equal(insertCalls, 0, "conflicts must stop before native matching runs");
  assert.equal(events.includes("pre-upload-catalogue"), false);
  assert.equal(events.includes("matching-catalogue"), false);
}

async function testEditorReplacementStopsMatching() {
  resetScenario();
  selectedDirectory = directory("素材库", [file("当前素材.png")]);
  prompt = "人物 @当前素材。";
  uploadFiles = async (_files, options) => {
    events.push("upload-start");
    options.onFilesDispatched?.();
    editorConnected = false;
    events.push("upload-resolved");
  };

  await assert.rejects(
    () => runLocalUpload(uploadButton, { forceDirectory: true }),
    (error) => error?.code === "EDITOR_CHANGED_DURING_UPLOAD"
  );
  assert.equal(insertCalls, 0, "a replaced editor must never receive native mentions");
}

async function testConnectedOldEditorStopsMatching() {
  resetScenario();
  selectedDirectory = directory("素材库", [file("旧任务素材.png")]);
  prompt = "人物 @旧任务素材。";
  const newEditor = { ...editor };
  uploadFiles = async (_files, options) => {
    events.push("upload-start");
    options.onFilesDispatched?.();
    activeEditor = newEditor;
    events.push("upload-resolved");
  };

  await assert.rejects(
    () => runLocalUpload(uploadButton, { forceDirectory: true }),
    (error) => error?.code === "EDITOR_CHANGED_DURING_UPLOAD"
  );
  assert.equal(editorConnected, true, "the old task editor remains mounted in this regression");
  assert.equal(insertCalls, 0, "a mounted old editor must never receive native mentions");
  assert.equal(events.includes("matching-catalogue"), false);
}

async function testPlainPromptDoesNotOpenDirectoryPicker() {
  resetScenario();
  selectedDirectory = directory("素材库", [file("普通正文.png")]);
  prompt = "这里只有普通正文，没有显式素材引用。";
  await assert.rejects(
    () => runLocalUpload(uploadButton, { forceDirectory: true }),
    /没有需要上传的 @素材名/
  );
  assert.equal(directorySelections, 0);
  assert.deepEqual(getFileCalls, []);
}

async function testAutomaticUploadDoesNotRequireNativeCatalogueConfirmation() {
  resetScenario();
  selectedDirectory = directory("素材库", [file("目录未就绪.png")]);
  prompt = "人物 @目录未就绪。";
  uploadFiles = async (_files, options) => {
    options.onFilesDispatched?.();
    events.push("upload-resolved");
    candidateNames = [];
    expectedUploadCount = 0;
  };

  await runLocalUpload(uploadButton, { forceDirectory: true });
  assert.equal(ensurePickerCalls, 0);
  assert.equal(discoverCalls, 0);
  assert.equal(insertCalls, 0);
  assert.equal(plugin.state.localUploadNeedsReconcile, true);
  assert.deepEqual(
    plugin.state.localUploadPendingByEditor.get(editor),
    ["目录未就绪"]
  );
}

async function testCataloguePublicationWaitsForManualMatching() {
  resetScenario();
  selectedDirectory = directory("素材库", [file("稍后发布.png")]);
  prompt = "人物 @稍后发布。";
  uploadFiles = async (_files, options) => {
    options.onFilesDispatched?.();
    events.push("upload-resolved");
  };
  const originalSleep = plugin.sleep;
  let publicationWaits = 0;
  plugin.sleep = async (milliseconds) => {
    if (milliseconds === 250) {
      publicationWaits += 1;
      candidateNames = ["稍后发布"];
      expectedUploadCount = 1;
    }
  };
  try {
    await runLocalUpload(uploadButton, { forceDirectory: true });
  } finally {
    plugin.sleep = originalSleep;
  }
  assert.equal(publicationWaits, 0, "upload must not poll the @ catalogue publication state");
  assert.equal(ensurePickerCalls, 0);
  assert.equal(discoverCalls, 0);
  assert.equal(insertCalls, 0);

  candidateNames = ["稍后发布"];
  expectedUploadCount = 1;
  await runMatchingDirect(matchButton);
  assert.equal(insertCalls, 1);
}

async function testEarlyManualMatchKeepsPendingWithoutInsertion() {
  resetScenario();
  selectedDirectory = directory("素材库", [file("仍在发布.png")]);
  prompt = "人物 @仍在发布。";
  uploadFiles = async (_files, options) => {
    options.onFilesDispatched?.();
  };

  await runLocalUpload(uploadButton, { forceDirectory: true });
  assert.deepEqual(plugin.state.localUploadPendingByEditor.get(editor), ["仍在发布"]);

  await runMatchingDirect(matchButton);
  assert.equal(insertCalls, 0, "an early match click must not insert an unconfirmed mention");
  assert.equal(
    lastMatchFailures.has("仍在发布"),
    true,
    "the direct native-picker attempt must report the unpublished exact name"
  );
  assert.deepEqual(
    plugin.state.localUploadPendingByEditor.get(editor),
    ["仍在发布"],
    "a missing exact native row must keep the dispatched batch pending"
  );
  assert.equal(
    plugin.state.localUploadVerifiedNamesByEditor.get(editor),
    undefined,
    "an unpublished native name must not enter the verified ledger"
  );

  candidateNames = ["仍在发布"];
  expectedUploadCount = 1;
  await runMatchingDirect(matchButton);
  assert.equal(insertCalls, 1);
  assert.equal(plugin.state.localUploadNeedsReconcile, false);
}

async function testDelayedCatalogueRequiresManualMatchingToReconcile() {
  resetScenario();
  selectedDirectory = directory("素材库", [file("延迟素材.png")]);
  prompt = "人物 @延迟素材。";
  cachedCandidateNames = ["旧素材"];
  candidateNames = ["旧素材"];
  expectedUploadCount = 0;
  let uploadCalls = 0;
  uploadFiles = async (_files, options) => {
    uploadCalls += 1;
    options.onFilesDispatched?.();
    events.push("upload-resolved");
  };

  await runLocalUpload(uploadButton, { forceDirectory: true });
  assert.equal(uploadCalls, 1);
  assert.equal(plugin.state.localUploadNeedsReconcile, true);
  assert.deepEqual(cachedCandidateNames, [], "upload invalidates stale catalogue data without reading @");
  const pickerCallsAfterUpload = ensurePickerCalls;
  const discoverCallsAfterUpload = discoverCalls;
  assert.equal(pickerCallsAfterUpload, 0);
  assert.equal(discoverCallsAfterUpload, 0);

  await assert.rejects(
    () => runLocalUpload(uploadButton, { forceDirectory: false }),
    (error) => error?.code === "UPLOAD_ATTEMPT_NOT_RECONCILED"
  );
  assert.equal(uploadCalls, 1, "an immediate retry must not resubmit an unconfirmed batch");
  assert.equal(plugin.state.localUploadNeedsReconcile, true);
  assert.equal(
    ensurePickerCalls,
    pickerCallsAfterUpload,
    "a second automatic-upload click must not open @ while the dispatched batch is pending"
  );
  assert.equal(
    discoverCalls,
    discoverCallsAfterUpload,
    "a second automatic-upload click must not inspect the native catalogue"
  );

  // Even after the native catalogue has published the delayed record, another
  // automatic-upload click must remain folder-only and refuse to redispatch.
  // Reconciliation belongs exclusively to the explicit one-click match flow.
  candidateNames = ["旧素材", "延迟素材"];
  await assert.rejects(
    () => runLocalUpload(uploadButton, { forceDirectory: false }),
    (error) => error?.code === "UPLOAD_ATTEMPT_NOT_RECONCILED"
  );

  assert.equal(uploadCalls, 1, "a delayed native record must not be uploaded twice");
  assert.equal(plugin.state.localUploadNeedsReconcile, true);
  assert.equal(ensurePickerCalls, pickerCallsAfterUpload);
  assert.equal(discoverCalls, discoverCallsAfterUpload);
  assert.equal(insertCalls, 0, "automatic-upload retries must not begin native matching");

  await runMatchingDirect(matchButton);

  assert.equal(uploadCalls, 1);
  assert.equal(plugin.state.localUploadNeedsReconcile, false);
  assert.equal(
    ensurePickerCalls,
    pickerCallsAfterUpload,
    "the pending fast path delegates native toolbar opening to the candidate adapter"
  );
  assert.equal(
    discoverCalls,
    discoverCallsAfterUpload,
    "pending local names go straight to exact native rows without a full catalogue scan"
  );
  assert.equal(insertCalls, 1, "manual matching reconciles and appends the delayed native material");
}

async function testPendingBatchStopsBeforeFolderWork() {
  resetScenario();
  prompt = "人物继续使用 @已经分派。";
  selectedDirectory = directory("不应读取", [file("已经分派.png")]);
  plugin.state.localUploadPendingByEditor.set(editor, ["已经分派"]);
  plugin.state.localUploadNeedsReconcile = true;
  plugin.state.localUploadPendingNames = ["已经分派"];
  plugin.state.localUploadReconcileEditor = editor;
  let uploadCalls = 0;
  uploadFiles = async () => { uploadCalls += 1; };

  await assert.rejects(
    () => runLocalUpload(uploadButton, { forceDirectory: true }),
    (error) => error?.code === "UPLOAD_ATTEMPT_NOT_RECONCILED"
  );
  assert.equal(directorySelections, 0, "pending must stop before requesting a folder");
  assert.equal(events.some((event) => event.startsWith("scan-directory:")), false);
  assert.deepEqual(getFileCalls, []);
  assert.equal(uploadCalls, 0);
}

async function testTaskSwitchDuringCatalogueScanStopsBeforeInsertion() {
  resetScenario();
  prompt = "人物 @扫描中切换。";
  candidateNames = ["扫描中切换"];
  const gate = deferred();
  discoverBarrier = gate.promise;

  const matching = runMatchingDirect(matchButton);
  await waitUntil(() => events.includes("matching-catalogue"));
  activeEditor = { ...editor };
  gate.resolve();

  await assert.rejects(
    () => matching,
    (error) => error?.code === "EDITOR_CHANGED_DURING_MATCHING"
  );
  assert.equal(editorConnected, true);
  assert.equal(insertCalls, 0, "task switching during discovery must stop before prompt mutation");
}

async function testPreDispatchFailureDoesNotLockRetry() {
  resetScenario();
  selectedDirectory = directory("素材库", [file("入口恢复.png")]);
  prompt = "人物 @入口恢复。";
  let uploadCalls = 0;
  uploadFiles = async (_files, options) => {
    uploadCalls += 1;
    if (uploadCalls === 1) {
      const error = new Error("没有找到上传入口");
      error.code = "UPLOAD_INPUT_NOT_FOUND";
      throw error;
    }
    options.onFilesDispatched?.();
    candidateNames = ["入口恢复"];
  };

  await assert.rejects(
    () => runLocalUpload(uploadButton, { forceDirectory: true }),
    (error) => error?.code === "UPLOAD_INPUT_NOT_FOUND"
  );
  assert.equal(plugin.state.localUploadNeedsReconcile, false);
  assert.deepEqual(plugin.state.localUploadPendingNames, []);

  await runLocalUpload(uploadButton, { forceDirectory: false });
  assert.equal(uploadCalls, 2, "fixing the page input must allow a clean retry");
  assert.equal(insertCalls, 0, "the clean upload retry still stops before matching");
  await runMatchingDirect(matchButton);
  assert.equal(insertCalls, 1);
}

async function testRejectedBatchReconcilesBeforeSelectiveRetry() {
  resetScenario();
  selectedDirectory = directory("素材库", [
    file("成功项.png"),
    file("失败项.png")
  ]);
  prompt = "人物 @成功项，场景 @失败项。";
  const uploadedBatches = [];
  uploadFiles = async (files, options) => {
    uploadedBatches.push(files.map((item) => item.name));
    options.onFilesDispatched?.();
    if (uploadedBatches.length === 1) {
      const error = new Error("页面报告上传失败");
      error.code = "UPLOAD_REJECTED";
      throw error;
    }
  };

  await assert.rejects(
    () => runLocalUpload(uploadButton, { forceDirectory: true }),
    (error) => error?.code === "UPLOAD_REJECTED" &&
      /先点击“自动匹配”/.test(error.message)
  );
  assert.equal(plugin.state.localUploadRejectedByEditor.has(editor), true);
  assert.deepEqual(
    plugin.state.localUploadPendingByEditor.get(editor),
    ["成功项", "失败项"]
  );

  candidateNames = ["成功项"];
  await runMatchingDirect(matchButton);
  assert.deepEqual(
    Array.from(plugin.state.localUploadVerifiedNamesByEditor.get(editor) || []),
    ["成功项"]
  );
  assert.equal(plugin.state.localUploadPendingByEditor.get(editor), undefined);
  assert.equal(plugin.state.localUploadRejectedByEditor.has(editor), false);

  await runLocalUpload(uploadButton, { forceDirectory: false });
  assert.deepEqual(uploadedBatches, [
    ["成功项.png", "失败项.png"],
    ["失败项.png"]
  ]);
}

async function testPendingBatchIsScopedToItsEditor() {
  resetScenario();
  selectedDirectory = directory("旧素材库", [file("旧待确认.png")]);
  prompt = "旧任务 @旧待确认。";
  uploadFiles = async (_files, options) => {
    options.onFilesDispatched?.();
  };
  await runLocalUpload(uploadButton, { forceDirectory: true });
  assert.deepEqual(plugin.state.localUploadPendingByEditor.get(editor), ["旧待确认"]);

  const nextEditor = { ...editor };
  activeEditor = nextEditor;
  selectedDirectory = directory("新素材库", [file("新任务素材.png")]);
  prompt = "新任务 @新任务素材。";
  candidateNames = [];
  uploadFiles = async (_files, options) => {
    options.onFilesDispatched?.();
    candidateNames = ["新任务素材"];
  };

  await runLocalUpload(uploadButton, { forceDirectory: true });
  assert.equal(insertCalls, 0, "automatic upload on the new editor still does not match");
  await runMatchingDirect(matchButton);
  assert.equal(insertCalls, 1, "manual matching remains available on the new editor");
  assert.deepEqual(
    plugin.state.localUploadPendingByEditor.get(editor),
    ["旧待确认"],
    "the old editor keeps its own reconciliation guard"
  );
}

async function testIncrementalPendingKeepsVerifiedNames() {
  resetScenario();
  prompt = "@旧素材，@新素材。";
  candidateNames = ["旧素材", "新素材"];
  plugin.state.localUploadVerifiedNamesByEditor.set(editor, new Set(["旧素材"]));
  plugin.state.localUploadPendingByEditor.set(editor, ["新素材"]);
  plugin.state.localUploadNeedsReconcile = true;
  plugin.state.localUploadPendingNames = ["新素材"];
  plugin.state.localUploadReconcileEditor = editor;
  await runMatchingDirect(matchButton);
  assert.equal(insertCalls, 2);
  assert.equal(lastMatchFailures.size, 0);
  assert.equal(plugin.state.matchStatusVerified, true);
  assert.deepEqual(plugin.state.candidateNamesSnapshot, ["旧素材", "新素材"]);
  assert.equal(discoverCalls, 0);
  console.log("✓ incremental pending names retain the verified prior batch for matching");
}

async function testOrphanBlocksRepeatedInsertion() {
  resetScenario();
  prompt = "@测试素材。";
  candidateNames = ["测试素材"];
  nativeCounts.set("测试素材", 1);
  await runMatchingDirect(matchButton);
  await runMatchingDirect(matchButton);
  assert.equal(insertCalls, 0);
  assert.equal(nativeCounts.get("测试素材"), 1);
  assert.match(lastMatchFailures.get("测试素材"), /未贴在原文字后/);
  assert.equal(plugin.state.matchStatusVerified, false);
  console.log("✓ existing off-slot native chips block further insertion and cannot turn green");
}

async function testCapacityPreflightAndRejectionRetry() {
  resetScenario();
  prompt = "@容量A，@容量B。";
  selectedDirectory = directory("容量测试", [file("容量A.png"), file("容量B.png")]);
  plugin.localUpload.imageLimitForEditor = () => 1;
  await assert.rejects(() => runLocalUpload(uploadButton, { forceDirectory: true }), /图片/);
  assert.equal(getFileCalls.length, 0, "capacity preflight must run before materializing files");
  assert.equal(plugin.state.localUploadPendingByEditor.has(editor), false);
  delete plugin.localUpload.imageLimitForEditor;
  uploadFiles = async (_files, options) => {
    options.onFilesDispatched?.();
    const error = new Error("最多添加 30 个图片");
    error.code = "UPLOAD_CAPACITY_REJECTED";
    throw error;
  };
  await assert.rejects(() => runLocalUpload(uploadButton, { forceDirectory: false }),
    (error) => error.code === "UPLOAD_CAPACITY_REJECTED");
  assert.equal(plugin.state.localUploadPendingByEditor.has(editor), false);
  assert.equal(plugin.state.localUploadNeedsReconcile, false);
  console.log("✓ capacity preflight avoids file reads and native capacity rejection releases the retry lock");
}

async function testCanvasNodeLedgerAcrossRemount() {
  resetScenario();
  const ledger = { pending: [], verified: new Set(), rejected: false };
  const otherLedger = { pending: [], verified: new Set(), rejected: false };
  const remount = { ...editor };
  const otherNode = { ...editor };
  plugin.canvas = { uploadStateFor: owner => owner === otherNode ? otherLedger : ledger, materialSlots: () => [] };
  selectedDirectory = directory("素材库", [file("画布素材.png")]);
  prompt = "@画布素材。";
  let uploads = 0;
  uploadFiles = async (_files, options) => {
    uploads++;
    options.onFilesDispatched();
    candidateNames = ["画布素材"];
    expectedUploadCount = 1;
  };
  await runLocalUpload(uploadButton, { forceDirectory: true });
  activeEditor = remount;
  plugin.state.localUploadPendingByEditor = new WeakMap();
  await assert.rejects(() => runLocalUpload(uploadButton), error => error.code === "UPLOAD_ATTEMPT_NOT_RECONCILED");
  assert.equal(uploads, 1);
  await runMatchingDirect(matchButton);
  assert.deepEqual(ledger.pending, []);
  assert.deepEqual([...ledger.verified], ["画布素材"]);
  plugin.state.localUploadVerifiedNamesByEditor = new WeakMap();
  await runLocalUpload(uploadButton);
  assert.equal(uploads, 1, "canvas confirmations survive ordinary editor-state resets");
  activeEditor = otherNode;
  await runLocalUpload(uploadButton);
  assert.equal(uploads, 2, "a different canvas node needs its own reference upload");
  assert.deepEqual(otherLedger.pending, ["画布素材"]);
  delete plugin.canvas;
  console.log("✓ canvas pending and verified ledgers survive editor remounts without leaking into other nodes");
}

async function testCanvasManualCataloguePreventsReupload() {
  resetScenario();
  const ledger = { pending: [], verified: new Set(), rejected: false };
  plugin.canvas = { uploadStateFor: () => ledger, materialSlots: () => [{}] };
  candidateNames = ["已有图片"];
  expectedUploadCount = 1;
  prompt = "@已有图片。";
  selectedDirectory = directory("素材库", [file("已有图片.png")]);
  await runMatchingDirect(matchButton);
  assert.deepEqual([...ledger.verified], ["已有图片"]);
  uploadFiles = async () => { throw new Error("must not upload existing canvas references"); };
  await runLocalUpload(uploadButton);
  assert.deepEqual(getFileCalls, []);
  delete plugin.canvas;
  console.log("✓ a full native canvas catalogue restores existing-reference confirmations after page refresh");
}

async function testCanvasCapacityStopsBeforeReading() {
  resetScenario();
  prompt = "@新增图片。";
  selectedDirectory = directory("素材库", [file("新增图片.png")]);
  plugin.localUpload.canvasCapacityForEditor = () => ({ limit: 12, used: 12 });
  await assert.rejects(() => runLocalUpload(uploadButton), /已有 12 项/);
  assert.deepEqual(getFileCalls, []);
  delete plugin.localUpload.canvasCapacityForEditor;
  console.log("✓ manually uploaded canvas references count against capacity before local file reads");
}

async function testCanvasWhitespaceUploadReconciliation() {
  resetScenario();
  const ledger = { pending: ["scene morning", "角色 侧面"], verified: new Set(), rejected: false };
  plugin.canvas = { formFor: () => ({}), uploadStateFor: () => ledger, materialSlots: () => [{}, {}] };
  candidateNames = ["scenemorning", "角色侧面"];
  expectedUploadCount = 2;
  prompt = "@scene morning，@角色  侧面。";
  await runMatchingDirect(matchButton);
  assert.equal(insertCalls, 2);
  assert.deepEqual(ledger.pending, []);
  assert.ok(ledger.verified.has("scene morning"));
  assert.ok(ledger.verified.has("角色 侧面"));
  await runMatchingDirect(matchButton);
  assert.equal(insertCalls, 2, "a second match must not duplicate native references");
  assert.ok(ledger.verified.has("scene morning"), "a compact native catalogue must retain original upload names");
  delete plugin.canvas;
  console.log("✓ canvas compact names reconcile original pending uploads and remain verified on repeated matching");
}

async function testMixedUploadLimitsAndLedger() {
  resetScenario();
  const images = Array.from({ length: 30 }, (_, i) => `picture_${i}`);
  const videos = Array.from({ length: 10 }, (_, i) => `clip_${i}`);
  const audio = Array.from({ length: 10 }, (_, i) => `sound_${i}`);
  const names = [...images, ...videos, ...audio];
  prompt = names.map(name => `@${name}`).join("，");
  selectedDirectory = directory("mixed", [
    directory("pictures", images.map(name => file(`${name}.png`))),
    directory("videos", videos.map(name => file(`${name}.mp4`))),
    directory("audio", audio.map(name => file(`${name}.wav`)))
  ]);
  plugin.localUpload.imageLimitForEditor = () => 30;
  plugin.localUpload.mediaLimitsForEditor = () => ({ image: 30, video: 10, audio: 10, total: 50 });
  const batches = [];
  uploadFiles = async (files, options) => {
    batches.push(files.map(file => file.name));
    options.onFilesDispatched(); candidateNames = names; expectedUploadCount = 50;
  };
  await runLocalUpload(uploadButton, { forceDirectory: true });
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 50, "50 mixed files must not be rejected as 50 images");
  assert.equal(ensurePickerCalls, 0, "upload must not open the reference menu");
  await runMatchingDirect(matchButton);
  await runLocalUpload(uploadButton);
  assert.equal(batches.length, 1, "confirmed video/audio must join the same deduplication ledger");
  delete plugin.localUpload.imageLimitForEditor;
  delete plugin.localUpload.mediaLimitsForEditor;
  console.log("✓ one directory uploads 30/10/10 in one batch and confirms all media without duplicate uploads");
}

(async () => {
  await testMixedUploadLimitsAndLedger();
  await testCanvasNodeLedgerAcrossRemount();
  await testCanvasManualCataloguePreventsReupload();
  await testCanvasWhitespaceUploadReconciliation();
  await testCanvasCapacityStopsBeforeReading();
  await testCapacityPreflightAndRejectionRetry();
  await testIncrementalPendingKeepsVerifiedNames();
  await testOrphanBlocksRepeatedInsertion();
  assert.equal(typeof runLocalUpload, "function", "content startup must expose local upload callback");
  await testUploadResolvesBeforeMatching();
  console.log("✓ 自动上传只索引和上传，显式点击自动匹配后才打开 @ 并插入标签");
  await testVerifiedLedgerSkipsSecondAutomaticUpload();
  console.log("✓ 首次确认成功后再次自动上传由本任务账本阻止重复读取和上传");
  await testPendingAReconcilesBeforeUnknownWebB();
  console.log("✓ 30 个本地素材与网页素材一次完成 50 / 150 处引用，重复点击不增加标签");
  await testAuthoritativeCataloguePrunesOnlyMissingVerifiedNames();
  console.log("✓ 权威目录精确修剪 A、保留 B，下一次仅补传 A 且分派前不触碰 @");
  await testUploadCompletionDoesNotPerformCatalogueVerification();
  console.log("✓ 上传完成后不自动读取素材目录，待手动匹配后再确认账本");
  await testNoLocalIntersectionStopsBeforeNativeOrUpload();
  console.log("✓ 本地文件名没有命中时不上传、不打开菜单、不插入标签");
  await testPromptChangeStopsMatching();
  console.log("✓ 上传期间提示词变化时停止后续原生匹配");
  await testResolvedAdapterWithoutDispatchConfirmationStopsBeforeNative();
  console.log("✓ 上传器未确认分派时停止且不打开 @、不锁定待对账批次");
  await testPromptClearDuringDispatchKeepsRetryGuard();
  console.log("✓ 已分派上传时清空并恢复提示词不会重复上传");
  await testConflictStopsBeforeEveryUploadSideEffect();
  console.log("✓ 同名路径冲突在 getFile、上传和原生匹配前停止");
  await testEditorReplacementStopsMatching();
  console.log("✓ 上传期间编辑器被替换时停止原生匹配");
  await testConnectedOldEditorStopsMatching();
  console.log("✓ 旧编辑器仍挂载但当前任务已切换时停止匹配");
  await testPlainPromptDoesNotOpenDirectoryPicker();
  console.log("✓ 没有显式 @ 引用时不打开文件夹选择器");
  await testAutomaticUploadDoesNotRequireNativeCatalogueConfirmation();
  console.log("✓ 自动上传不依赖原生素材目录确认，也不开始匹配");
  await testCataloguePublicationWaitsForManualMatching();
  console.log("✓ 原生目录稍后发布文件名时仍等待用户手动点击自动匹配");
  await testEarlyManualMatchKeepsPendingWithoutInsertion();
  console.log("✓ 自动匹配点得过早时原生菜单零点击并保留 pending，名称发布后可安全重试");
  await testDelayedCatalogueRequiresManualMatchingToReconcile();
  console.log("✓ 原生目录延迟发布时自动上传不碰 @，自动匹配直接查找精确候选");
  await testPendingBatchStopsBeforeFolderWork();
  console.log("✓ 待确认批次在目录授权、扫描、读文件和上传前立即阻止重复点击");
  await testTaskSwitchDuringCatalogueScanStopsBeforeInsertion();
  console.log("✓ 素材目录扫描期间切换任务时不修改旧提示词");
  await testPreDispatchFailureDoesNotLockRetry();
  console.log("✓ 上传入口在分派前失败不会锁死下一次重试");
  await testRejectedBatchReconcilesBeforeSelectiveRetry();
  console.log("✓ 页面明确拒绝后先核对成功项，再只补传缺失文件");
  await testPendingBatchIsScopedToItsEditor();
  console.log("✓ 待确认上传按编辑器隔离，不污染新任务");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
