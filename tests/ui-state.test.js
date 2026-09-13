const assert = require("assert").strict;
const animationFrames = [];
let editorText = "";
let unpairedNames = [];

globalThis.requestAnimationFrame = (callback) => {
  animationFrames.push(callback);
  return animationFrames.length;
};

globalThis.JimengAssetMatcher = {
  matchPromptToCandidates: (prompt, names) => names.flatMap((name) => {
    const token = `@${name}`;
    const start = String(prompt || "").indexOf(token);
    return start < 0 ? [] : [{
      end: start + token.length,
      name,
      start,
      token
    }];
  }),
  normalizeText: (value) => String(value || "").trim(),
  parsePromptReferences: () => [],
  promptHasExactTarget: (prompt, name) => String(prompt).includes(`@${name}`),
  pruneInactiveMentionTargets: (expected, current, matches) => {
    const plainNames = new Set(matches.map((item) => item.name));
    return new Map(Array.from(expected).filter(([name]) =>
      (current.get(name) || 0) > 0 || plainNames.has(name)
    ));
  },
  unexpectedCandidateNames: (prompt, names, counts) => names.filter((name) =>
    !String(prompt).includes(`@${name}`) && !(counts.get(name) > 0)
  )
};
require("../runtime.js");

const plugin = globalThis.JimengAssetPlugin;
const connectedEditors = new Set();
const connectedElements = new Set();
const rect = { bottom: 500, height: 200, left: 100, right: 900, top: 300, width: 800 };
const editorA = { contains: () => false, getBoundingClientRect: () => rect };
const editorB = { contains: () => false, getBoundingClientRect: () => rect };
let pointerFocusCalls = 0;
editorA.focus = () => { pointerFocusCalls += 1; };

globalThis.document = {
  contains: (element) => connectedEditors.has(element) || connectedElements.has(element),
  getElementById: () => null,
  images: [],
  querySelectorAll: () => []
};
plugin.isVisible = () => true;
plugin.candidates = {
  isSystemMenuEntry: (name) => /^Octo(?:$|[\s（(:：])/iu.test(String(name || ""))
};
plugin.editor = {
  findEditor: () => editorA,
  plainText: () => editorText,
  unpairedCandidateMatches: () => unpairedNames.map((name) => ({ name })),
  unpairedPromptReferences: () => unpairedNames.map((name) => ({ name }))
};
require("../ui.js");
assert.equal(
  typeof plugin.ui.installLocalUploadButton,
  "function",
  "the local upload workflow must have its own control installer"
);

function stopScheduledRender() {
  clearTimeout(plugin.state.statusTimer);
  plugin.state.statusTimer = null;
  while (animationFrames.length) animationFrames.shift()();
}

connectedEditors.add(editorA);
connectedEditors.add(editorB);
plugin.state.materialCheckPending = true;
plugin.ui.markMatchVerified(editorB);
stopScheduledRender();

assert.equal(plugin.state.matchStatusEditor, editorB);
assert.equal(plugin.state.matchStatusVerified, true);
assert.equal(plugin.state.materialCheckPending, false);

editorText = "@当前素材";
plugin.editor.countCandidateMentions = (_editor, names) => new Map(
  names.map((name) => [name, 0])
);
const unexpected = plugin.ui.reviewCandidateUsage(editorB, [
  "当前素材",
  "误传素材",
  "Octo"
]);
stopScheduledRender();
assert.deepEqual(unexpected, ["误传素材"]);
assert.deepEqual(plugin.state.candidateNamesSnapshot, ["当前素材", "误传素材"]);
assert.equal(plugin.state.candidateCatalogComplete, true);
assert.equal(plugin.state.candidateCatalogEditor, editorB);
assert.deepEqual(
  plugin.ui.readCandidateCatalog(editorB),
  ["当前素材", "误传素材"],
  "the current task may reuse its complete in-memory name catalogue"
);
assert.equal(
  plugin.ui.evaluateMatchStatus(editorB, { refreshContent: true }).verified,
  false,
  "an unconfirmed extra upload must keep the shared status yellow"
);
editorText = "@当前素材 @误传素材";
plugin.ui.rebaseExpectedMentionCounts(editorB);
assert.equal(plugin.state.unexpectedMaterialNames.length, 0);
assert.equal(
  plugin.ui.evaluateMatchStatus(editorB, { refreshContent: true }).verified,
  true,
  "adding an exact prompt reference must clear the extra-upload warning"
);
unpairedNames = ["当前素材"];
assert.equal(
  plugin.ui.evaluateMatchStatus(editorB, { refreshContent: true }).verified,
  false,
  "a preserved source token stays yellow until its adjacent native mention exists"
);
unpairedNames = [];
assert.equal(
  plugin.ui.evaluateMatchStatus(editorB, { refreshContent: true }).verified,
  true,
  "a preserved source token with an adjacent native mention may stay green"
);

editorText = "@本批待确认素材";
unpairedNames = [];
plugin.ui.setActiveMatchCandidateNames(editorB, ["本批待确认素材"]);
plugin.ui.markMatchVerified(
  editorB,
  new Map([["本批待确认素材", 1]])
);
stopScheduledRender();
assert.deepEqual(
  plugin.state.candidateNamesSnapshot,
  ["本批待确认素材"],
  "pending exact names must remain available to the red/green status evaluator"
);
assert.equal(plugin.state.candidateCatalogComplete, false);
assert.equal(plugin.state.candidateCatalogEditor, null);
assert.deepEqual(
  plugin.ui.readCandidateCatalog(editorB),
  [],
  "a status-only pending snapshot must never be reused as an authoritative catalogue"
);
assert.equal(
  plugin.ui.evaluateMatchStatus(editorB, { refreshContent: true }).verified,
  true,
  "a preserved token with its adjacent pending mention must not remain red"
);

editorText = "@当前素材";
plugin.ui.reviewCandidateUsage(editorB, ["当前素材", "误传素材"]);
plugin.ui.acknowledgeUnexpectedMaterials();
stopScheduledRender();
assert.equal(
  plugin.ui.evaluateMatchStatus(editorB, { refreshContent: true }).verified,
  true,
  "an explicitly kept extra upload may restore green when matching is complete"
);
plugin.ui.rebaseExpectedMentionCounts(editorB, { keepPlainTargets: false });
assert.equal(plugin.state.acknowledgedUnexpectedSignature, "");
assert.equal(
  plugin.ui.evaluateMatchStatus(editorB, { refreshContent: true }).verified,
  false,
  "a whole-task replacement must require extra uploads to be reviewed again"
);
plugin.ui.acknowledgeUnexpectedMaterials();
stopScheduledRender();
editorText = "";
assert.equal(
  plugin.ui.resolveMatchStatusEditor(),
  editorB,
  "status must remain bound to the editor that completed matching"
);

plugin.ui.markMatchVerified(editorB, new Map([["123", 2]]));
stopScheduledRender();
assert.equal(plugin.state.expectedMentionCounts.get("123"), 2);

plugin.state.materialCheckPending = true;
assert.equal(
  plugin.ui.evaluateMatchStatus(editorB, { refreshContent: true }).verified,
  true,
  "an unchanged material baseline must keep both UI messages green"
);
assert.equal(plugin.state.materialCheckPending, false);

document.images = [{
  alt: "",
  currentSrc: "asset-a",
  getBoundingClientRect: () => ({
    bottom: 340,
    height: 40,
    left: 40,
    right: 80,
    top: 300,
    width: 40
  }),
  src: "asset-a"
}];
plugin.state.materialCheckPending = true;
assert.equal(
  plugin.ui.evaluateMatchStatus(editorB, { refreshContent: true }).verified,
  false,
  "a changed material baseline must invalidate both UI messages together"
);
assert.equal(plugin.state.candidateNamesSnapshot.length, 0);
assert.equal(plugin.state.candidateCatalogComplete, false);
assert.equal(plugin.state.candidateCatalogEditor, null);
assert.equal(plugin.state.unexpectedMaterialNames.length, 0);
document.images = [];
plugin.ui.markMatchVerified(editorB, new Map([["123", 2]]));
stopScheduledRender();
plugin.ui.invalidateMatchStatus();
stopScheduledRender();
assert.equal(plugin.state.expectedMentionCounts.get("123"), 2);
assert.notEqual(
  plugin.state.verifiedMaterialSignature,
  null,
  "normal invalidation must preserve the last material baseline"
);

function control(controlRect, label = "") {
  return {
    closest: () => null,
    contains: () => false,
    getAttribute: (name) => name === "aria-label" ? label : "",
    getBoundingClientRect: () => controlRect,
    id: "",
    innerText: label,
    textContent: label
  };
}

const sendButton = control({
  bottom: 486,
  height: 36,
  left: 860,
  right: 896,
  top: 450,
  width: 36
}, "发送");
const thumbnail = {
  alt: "素材",
  currentSrc: "asset-b",
  getBoundingClientRect: () => ({
    bottom: 360,
    height: 60,
    left: 40,
    right: 100,
    top: 300,
    width: 60
  }),
  src: "asset-b"
};
const thumbnailButton = control({
  bottom: 322,
  height: 24,
  left: 82,
  right: 106,
  top: 298,
  width: 24
});
const toolbarButton = control({
  bottom: 486,
  height: 36,
  left: 700,
  right: 736,
  top: 450,
  width: 36
});
connectedElements.add(sendButton);
document.images = [thumbnail];
document.querySelectorAll = () => [sendButton];

assert.equal(
  plugin.ui.shouldCheckMaterialControl(sendButton, editorB),
  false,
  "the send arrow must never be treated as a thumbnail control"
);
assert.equal(
  plugin.ui.shouldCheckMaterialControl(thumbnailButton, editorB),
  true,
  "a control touching an uploaded thumbnail must still be checked"
);
assert.equal(
  plugin.ui.shouldCheckMaterialControl(toolbarButton, editorB),
  false,
  "a small toolbar control sharing the composer must not be treated as an upload"
);
document.images = [];

// The floating dock belongs only to the unobscured creation composer. A
// historical/read-only prompt visible on a result detail page must not be
// enough to make the controls appear over the video.
const creationEditor = {
  contains: (element) => element === creationEditor,
  getBoundingClientRect: () => rect
};
const creationSend = control({
  bottom: 486,
  height: 36,
  left: 860,
  right: 896,
  top: 450,
  width: 36
}, "发送");
connectedEditors.add(creationEditor);
connectedElements.add(creationSend);
document.elementFromPoint = (x) => x > 840 ? creationSend : creationEditor;
assert.equal(
  plugin.ui.isActiveCreationComposer(creationEditor, creationSend),
  true,
  "an unobscured editor and its visible send control form the active creation composer"
);
const detailOverlay = control({
  bottom: 800,
  height: 800,
  left: 0,
  right: 1200,
  top: 0,
  width: 1200
}, "视频详情遮罩");
detailOverlay.contains = (element) =>
  element === creationEditor || element === creationSend;
connectedElements.add(detailOverlay);
document.elementFromPoint = () => detailOverlay;
assert.equal(
  plugin.ui.isActiveCreationComposer(creationEditor, creationSend),
  false,
  "an editor hidden behind a result/detail overlay must not anchor the dock"
);
document.elementFromPoint = (x) => x > 840 ? detailOverlay : creationEditor;
assert.equal(
  plugin.ui.isActiveCreationComposer(creationEditor, creationSend),
  false,
  "a covered send control must hide the dock instead of placing it over result media"
);
connectedElements.delete(detailOverlay);
connectedEditors.delete(creationEditor);
connectedElements.delete(creationSend);
delete document.elementFromPoint;

plugin.ui.setExpectedMentionCounts(new Map([
  ["旧素材", 2],
  ["保留素材", 1]
]));
plugin.editor.countCandidateMentions = (_editor, names) => new Map(
  names.map((name) => [name, name === "保留素材" ? 1 : 0])
);
assert.equal(plugin.ui.rebaseExpectedMentionCounts(editorB), true);
assert.deepEqual(
  plugin.state.expectedMentionCounts,
  new Map([["保留素材", 1]]),
  "a replacement prompt must drop targets that no longer have native mentions"
);
editorText = "仍需处理 @部分失败素材";
plugin.ui.setExpectedMentionCounts(new Map([
  ["已删除素材", 1],
  ["部分失败素材", 2]
]));
plugin.editor.countCandidateMentions = (_editor, names) => new Map(
  names.map((name) => [name, 0])
);
assert.equal(plugin.ui.rebaseExpectedMentionCounts(editorB), true);
assert.deepEqual(
  plugin.state.expectedMentionCounts,
  new Map([["部分失败素材", 2]]),
  "ordinary edits must keep an exact unfinished @ target while pruning removed names"
);
plugin.ui.rebaseExpectedMentionCounts(editorB, { keepPlainTargets: false });
assert.equal(
  plugin.state.expectedMentionCounts.size,
  0,
  "a whole-prompt replacement must not inherit a same-name plain target"
);
editorText = "当前提示 @当前失败素材";
plugin.ui.setMatchFailures(new Map([
  ["旧失败素材", "旧任务缺失"],
  ["当前失败素材", "当前任务缺失"]
]));
plugin.ui.rebaseExpectedMentionCounts(editorB);
assert.deepEqual(
  plugin.state.statusFailureDetails,
  new Map([["当前失败素材", "当前任务缺失"]]),
  "hover details must prune file names that no longer exist in the prompt"
);
editorText = "";
plugin.state.matching = true;
plugin.ui.setExpectedMentionCounts(new Map([["部分失败素材", 2]]));
assert.equal(plugin.ui.rebaseExpectedMentionCounts(editorB), false);
assert.equal(
  plugin.state.expectedMentionCounts.get("部分失败素材"),
  2,
  "matcher-generated input must keep partial-recovery targets"
);
plugin.state.matching = false;

plugin.ui.markMatchVerified(editorB, new Map([
  ["旧人物", 1],
  ["旧场景", 1]
]));
plugin.state.localUploadNeedsReconcile = true;
plugin.state.localUploadPendingNames = ["未确认素材"];
plugin.state.localUploadPendingByEditor.set(editorB, ["未确认素材"]);
plugin.state.localUploadReconcileEditor = editorB;
plugin.state.localUploadVerifiedNamesByEditor.set(
  editorB,
  new Set(["已确认素材"])
);
plugin.state.localUploading = true;
stopScheduledRender();
plugin.ui.resetMatchSession();
stopScheduledRender();
assert.equal(plugin.state.localUploadNeedsReconcile, true);
assert.deepEqual(plugin.state.localUploadPendingNames, ["未确认素材"]);
assert.deepEqual(
  plugin.state.localUploadPendingByEditor.get(editorB),
  ["未确认素材"],
  "prompt clearing during upload must preserve duplicate-upload protection"
);
assert.deepEqual(
  Array.from(plugin.state.localUploadVerifiedNamesByEditor.get(editorB)),
  ["已确认素材"],
  "prompt clearing during upload must preserve the verified local ledger"
);
plugin.state.localUploading = false;
plugin.ui.resetMatchSession();
stopScheduledRender();
assert.equal(plugin.state.matchStatusVerified, false);
assert.equal(plugin.state.matchStatusEditor, null);
assert.equal(plugin.state.expectedMentionCounts.size, 0);
assert.equal(plugin.state.verifiedMaterialSignature, null);
assert.equal(plugin.state.statusFailureDetails.size, 0);
assert.equal(plugin.state.candidateNamesSnapshot.length, 0);
assert.equal(plugin.state.candidateCatalogComplete, false);
assert.equal(plugin.state.candidateCatalogEditor, null);
assert.equal(plugin.state.unexpectedMaterialNames.length, 0);
assert.equal(plugin.state.localUploadNeedsReconcile, false);
assert.deepEqual(plugin.state.localUploadPendingNames, []);
assert.equal(plugin.state.localUploadPendingByEditor.get(editorB), undefined);
assert.equal(plugin.state.localUploadReconcileEditor, null);
assert.equal(
  plugin.state.localUploadVerifiedNamesByEditor.get(editorB),
  undefined,
  "a real task reset must clear the previous task's verified local ledger"
);

const layout = plugin.ui.matchControlLayout(
  { bottom: 500, height: 200, left: 100, right: 900, top: 300, width: 800 },
  null,
  110,
  30,
  1200,
  800
);
assert.equal(layout.left, 790);
assert.equal(layout.top, 260);
const fractionalLayout = plugin.ui.matchControlLayout(
  {
    bottom: 500.25,
    height: 400,
    left: 100.5,
    right: 1040,
    top: 100.25,
    width: 939.5
  },
  null,
  110.25,
  29.5,
  1200,
  800
);
assert.equal(fractionalLayout.left, 929.75);
assert.equal(fractionalLayout.top, 60.75);
plugin.ui.scheduleMatchControlPosition();
plugin.ui.scheduleMatchControlPosition();
plugin.ui.scheduleMatchControlPosition();
assert.equal(
  animationFrames.length,
  1,
  "rapid geometry updates must coalesce into one animation frame"
);
stopScheduledRender();

connectedEditors.delete(editorB);
assert.equal(plugin.ui.resolveMatchStatusEditor(), editorA);
assert.equal(plugin.state.matchStatusVerified, false);
assert.equal(plugin.state.matchStatusEditor, null);
assert.equal(plugin.state.expectedMentionCounts.size, 0);

// Product wording makes the two manual phases explicit: upload first, then
// click automatic matching. This fixture tests the actual installed controls,
// not only callback button mocks used by content tests.
const installedById = new Map();
function installedElement(tagName) {
  return {
    _listeners: new Map(),
    children: [],
    className: "",
    dataset: {},
    id: "",
    parentElement: null,
    style: { setProperty(key, value) { this[key] = value; }, removeProperty(key) { delete this[key]; } },
    tagName: tagName.toUpperCase(),
    textContent: "",
    title: "",
    addEventListener(type, listener) {
      this._listeners.set(type, listener);
    },
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      if (child.id) installedById.set(child.id, child);
      return child;
    },
    closest(selector) {
      if (selector === "[data-action]" && this.dataset.action) return this;
      return null;
    },
    focus() {
      document.activeElement = this;
    },
    getBoundingClientRect() {
      return { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0 };
    },
    insertBefore(child, reference) {
      child.parentElement = this;
      const index = this.children.indexOf(reference);
      if (index < 0) this.children.push(child);
      else this.children.splice(index, 0, child);
      if (child.id) installedById.set(child.id, child);
      return child;
    },
    querySelector(selector) {
      if (!selector.startsWith("#")) return null;
      const id = selector.slice(1);
      return this.children.find((child) => child.id === id) || null;
    },
    remove() {
      if (this.parentElement) {
        this.parentElement.children = this.parentElement.children
          .filter((child) => child !== this);
      }
      if (this.id) installedById.delete(this.id);
      this.parentElement = null;
    },
    removeAttribute(name) {
      delete this[name];
    },
    setAttribute(name, value) {
      this[name] = value;
    }
  };
}
const installedRoot = installedElement("html");
document.createElement = installedElement;
document.documentElement = installedRoot;
document.getElementById = (id) => installedById.get(id) || null;
const capturedMatchEditors = [];
plugin.ui.installMatchButton(async (_button, pressedEditor) => {
  capturedMatchEditors.push(pressedEditor);
});
plugin.ui.installLocalUploadButton(async () => {});
let guideSeenWrites = 0;
plugin.onboarding = {
  markSeen: async () => { guideSeenWrites += 1; },
  steps: Array.from({ length: 5 }, (_, index) => ({
    text: index === 0 ? "先上传，再匹配" : `说明 ${index + 1}`,
    title: `步骤 ${index + 1}`
  }))
};
const installedControls = installedById.get(plugin.constants.controlsId);
const installedMatchButton = installedById.get(plugin.constants.buttonId);
const installedUploadButton = installedById.get(plugin.constants.localUploadButtonId);
const installedHelpButton = installedById.get(plugin.constants.helpButtonId);
assert.equal(installedMatchButton.textContent, "自动匹配");
assert.equal(installedUploadButton.textContent, "自动上传");
assert.deepEqual(
  installedControls.children.slice(0, 2),
  [installedUploadButton, installedMatchButton],
  "the two explicit phases remain ordered upload, match"
);
assert.match(
  installedUploadButton["aria-description"],
  /上传完成后.*自动匹配/u,
  "the upload tooltip must tell the user to start matching separately"
);
assert.equal(installedHelpButton, undefined, "no permanent help button is installed");

function findInstalled(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root?.children || []) {
    const found = findInstalled(child, predicate);
    if (found) return found;
  }
  return null;
}

const installedGuide = plugin.ui.showOnboarding({ automatic: true });
assert.ok(installedGuide, "the first-use guide can open automatically once");
const guideDialog = findInstalled(
  installedGuide,
  (element) => element.role === "dialog"
);
assert.equal(guideDialog["aria-modal"], "true");
const guideList = findInstalled(
  installedGuide,
  (element) => element.className === "jam-onboarding-steps"
);
assert.equal(guideList.children.length, 5);
const guideEyebrow = findInstalled(
  installedGuide,
  (element) => element.className === "jam-onboarding-eyebrow"
);
assert.match(
  guideEyebrow.textContent,
  /^即梦素材一键匹配/u
);
assert.equal(
  findInstalled(installedGuide, (element) =>
    element.className === "jam-onboarding-disclaimer"),
  null,
  "repository disclaimer copy must not be injected into the product guide"
);
const guideStart = findInstalled(
  installedGuide,
  (element) => element.dataset?.action === "start"
);
installedGuide._listeners.get("click")({ target: guideStart });
assert.equal(document.getElementById(plugin.constants.onboardingId), null);
assert.equal(guideSeenWrites, 1);

let editorAtPress = editorA;
plugin.editor.findEditor = () => editorAtPress;
function pressEvent() {
  return {
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    }
  };
}
const pointerDown = pressEvent();
const mouseDown = pressEvent();
installedMatchButton._listeners.get("pointerdown")(pointerDown);
installedMatchButton._listeners.get("mousedown")(mouseDown);
assert.equal(pointerDown.defaultPrevented, true);
assert.equal(pointerDown.propagationStopped, true);
assert.equal(mouseDown.defaultPrevented, true);
assert.equal(mouseDown.propagationStopped, true);
assert.equal(
  pointerFocusCalls,
  0,
  "capturing the Infinite Canvas editor must not expand it during pointerdown"
);
editorAtPress = editorB;
installedMatchButton._listeners.get("click")(pressEvent());
assert.deepEqual(
  capturedMatchEditors,
  [editorA],
  "automatic matching must receive the editor captured before the button steals focus"
);

// Black-box integration: the positioning path must actually consume the page
// scope predicate. Testing the helper alone would allow a future refactor to
// accidentally leave the fixed dock visible over a result video.
const installedIndicator = installedElement("span");
installedIndicator.id = plugin.constants.statusId;
installedControls.appendChild(installedIndicator);
const nativeAtButton = control({
  bottom: 486,
  height: 36,
  left: 760,
  right: 796,
  top: 450,
  width: 36
}, "@");
let liveComposerRect = rect;
const composerRoot = {
  contains: (element) => [creationEditor, creationSend, nativeAtButton].includes(element),
  getBoundingClientRect: () => liveComposerRect,
  parentElement: null,
  querySelectorAll: () => []
};
creationEditor.parentElement = composerRoot;
connectedEditors.add(creationEditor);
connectedElements.add(creationSend);
connectedElements.add(nativeAtButton);
connectedElements.add(composerRoot);
plugin.state.matchStatusEditor = creationEditor;
plugin.editor.findEditor = () => creationEditor;
plugin.nativeTrigger = { findNativeButton: () => nativeAtButton };
document.querySelectorAll = () => [creationSend];
document.elementFromPoint = (x) => {
  if (x > 840) return creationSend;
  if (x > 740) return nativeAtButton;
  return creationEditor;
};
document.documentElement.clientWidth = 1200;
document.documentElement.clientHeight = 800;
plugin.ui.scheduleMatchControlPosition();
stopScheduledRender();
assert.equal(installedControls.style.visibility, "visible");
assert.equal(installedControls.style.left, "648px");
assert.equal(installedControls.style.top, "256px");

plugin.state.matching = true;
liveComposerRect = {
  bottom: 500,
  height: 350,
  left: 100,
  right: 1050,
  top: 150,
  width: 950
};
plugin.ui.scheduleMatchControlPosition();
stopScheduledRender();
assert.equal(
  installedControls.style.left,
  "648px",
  "composer resize during matching must not move the controls horizontally"
);
assert.equal(
  installedControls.style.top,
  "256px",
  "composer resize during matching must not move the controls vertically"
);
assert.equal(
  installedControls.style.visibility,
  "hidden",
  "matching must hide the dock so Infinite Canvas expansion and the native picker stay unobstructed"
);

let matchingRender = null;
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (callback, delay) => {
  if (delay === 100) {
    matchingRender = callback;
    return 987654;
  }
  return realSetTimeout(callback, delay);
};
try {
  plugin.ui.updateMatchStatus({ contentDirty: true });
} finally {
  globalThis.setTimeout = realSetTimeout;
}
assert.equal(typeof matchingRender, "function");
matchingRender();
plugin.state.statusTimer = null;
assert.equal(
  installedControls.style.left,
  "648px",
  "a status render during matching must keep the dock's frozen horizontal position"
);
assert.equal(
  installedControls.style.top,
  "256px",
  "a status render during matching must keep the dock's frozen vertical position"
);
assert.equal(
  installedControls.style.visibility,
  "hidden",
  "a status render during matching must keep the dock hidden above the native picker"
);
plugin.state.matching = false;
liveComposerRect = rect;
plugin.ui.setMatchControlsBusy(true);
assert.equal(
  installedControls.style.visibility,
  "hidden",
  "the native picker interaction must suppress the extension dock"
);
plugin.ui.setMatchControlsBusy(false);
stopScheduledRender();
assert.equal(
  installedControls.style.visibility,
  "visible",
  "the dock must return at the current composer position after matching"
);

connectedElements.add(detailOverlay);
document.elementFromPoint = () => detailOverlay;
plugin.ui.scheduleMatchControlPosition();
stopScheduledRender();
assert.equal(
  installedControls.style.visibility,
  "hidden",
  "opening a result/detail overlay must hide an already-mounted dock"
);
connectedElements.delete(detailOverlay);

// Result/detail actions and the native @ control are small toolbar buttons too,
// but neither may stand in for the real creation submit control.
document.elementFromPoint = (x) => {
  if (x > 840) return creationSend;
  if (x > 740) return nativeAtButton;
  return creationEditor;
};
connectedElements.delete(creationSend);
const regenerateButton = control({
  bottom: 486,
  height: 36,
  left: 860,
  right: 896,
  top: 450,
  width: 36
}, "再次生成");
connectedElements.add(regenerateButton);
document.querySelectorAll = () => [regenerateButton];
assert.equal(
  plugin.ui.resolveActiveComposerContext(creationEditor),
  null,
  "a result-page regenerate action must not be treated as the creation send key"
);
connectedElements.delete(regenerateButton);
document.querySelectorAll = () => [nativeAtButton];
assert.equal(
  plugin.ui.resolveActiveComposerContext(creationEditor),
  null,
  "a lone native @ control must not make a non-creation page look active"
);
connectedElements.add(creationSend);
document.querySelectorAll = () => [creationSend];
plugin.nativeTrigger = { findNativeButton: () => creationSend };
assert.equal(
  plugin.ui.resolveActiveComposerContext(creationEditor),
  null,
  "the send and native @ controls must be distinct elements"
);
plugin.nativeTrigger = { findNativeButton: () => nativeAtButton };

// A first matching run binds matchStatusEditor after the dock has already
// learned this composer. Infinite Canvas may then unmount @ again when its
// native picker closes. Hiding the dock during matching must not discard the
// exact composer context needed to restore the controls afterwards.
document.querySelectorAll = () => [creationSend];
document.elementFromPoint = (x) => {
  if (x > 840) return creationSend;
  if (x > 740) return nativeAtButton;
  return creationEditor;
};
plugin.ui.scheduleMatchControlPosition();
stopScheduledRender();
assert.equal(installedControls.style.visibility, "visible");
plugin.state.matchStatusEditor = null;
plugin.state.matching = true;
plugin.ui.setMatchControlsBusy(true);
plugin.ui.trackMatchStatusEditor(creationEditor);
plugin.nativeTrigger = { findNativeButton: () => null };
plugin.state.matching = false;
plugin.ui.setMatchControlsBusy(false);
stopScheduledRender();
assert.equal(
  installedControls.style.visibility,
  "visible",
  "the dock must recover after the first match even when the paged toolbar unmounts @"
);
plugin.nativeTrigger = { findNativeButton: () => nativeAtButton };
connectedEditors.delete(creationEditor);
connectedElements.delete(creationSend);
connectedElements.delete(nativeAtButton);
connectedElements.delete(composerRoot);
creationEditor.parentElement = null;

editorText = "@manual sample";
plugin.state.candidateCatalogComplete = false;
plugin.state.candidateNamesSnapshot = [];
plugin.state.expectedMentionCounts = new Map([["manual sample", 1]]);
plugin.state.statusFailureDetails = new Map([["manual sample", "原生素材引用缺少 1 处"]]);
plugin.editor.countPairedCandidateMentions = () => new Map([["manual sample", 0]]);
plugin.ui.rebaseExpectedMentionCounts(editorA);
assert.equal(plugin.state.statusFailureDetails.size, 1, "an unpaired slot must remain an error");
plugin.editor.countPairedCandidateMentions = () => new Map([["manual sample", 1]]);
plugin.ui.rebaseExpectedMentionCounts(editorA);
assert.equal(plugin.state.statusFailureDetails.size, 0, "a manually repaired adjacent slot clears its stale error");
plugin.state.statusFailureDetails = new Map([["manual sample", "存在未贴在原文字后的同名标签"]]);
plugin.editor.countCandidateMentions = () => new Map([["manual sample", 2]]);
plugin.ui.rebaseExpectedMentionCounts(editorA);
assert.equal(plugin.state.statusFailureDetails.size, 1, "a paired slot plus a stray chip must keep its error");
plugin.editor.countCandidateMentions = () => new Map([["manual sample", 1]]);
plugin.ui.rebaseExpectedMentionCounts(editorA);
assert.equal(plugin.state.statusFailureDetails.size, 0, "removing the stray chip clears only that stale error");
stopScheduledRender();

console.log("✓ keeps verified status bound to the matched editor");
console.log("✓ clears stale material dirtiness after taking a verified baseline");
console.log("✓ keeps extra uploads yellow until they are referenced or explicitly kept");
console.log("✓ clears extra-upload snapshots after real material changes and task resets");
console.log("✓ keeps send and toolbar controls out of the material-change guard");
console.log("✓ shows controls only for an unobscured active creation composer");
console.log("✓ rebases stale targets for a new prompt revision");
console.log("✓ prunes stale file names from hover details after prompt edits");
console.log("✓ resets all task-scoped targets after a confirmed send");
console.log("✓ anchors the match controls above the prompt editor's top-right corner");
console.log("✓ coalesces realtime positioning to one update per frame");
console.log("✓ clears verification when the matched editor leaves the page");
console.log("✓ labels the separate manual phases as 自动上传 and 自动匹配");
