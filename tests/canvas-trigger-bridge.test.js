const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
let clock = 0;
const listeners = new Map();
const attrs = new Map();
class Doc {
  constructor(text) { this.text = text; }
  textBetween(a, b) { return this.text.slice(a, b); }
  eq(doc) { return this.text === doc.text; }
  resolve(pos) { return pos; }
}
class Selection {
  constructor(pos) { this.from = this.to = pos; }
  static near(pos) { return new Selection(pos); }
}
const editor = { matches: () => true, isConnected: true,
  closest: (selector) => selector.startsWith("form") ? {} : null,
  checkVisibility: () => true, getBoundingClientRect: () => ({ height: 9 }),
  getAttribute: (key) => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value) };
let doc = new Doc("原文 @sample 后文");
let selection = new Selection(10);
let scrolledSelections = 0;
const state = { get doc() { return doc; }, get selection() { return selection; },
  get tr() { return { doc, scrollIntoView() { scrolledSelections += 1; return this; }, setSelection(value) { this.selection = value; return this; },
  insertText(text, from, to) { this.doc = new Doc(doc.text.slice(0, from) + text + doc.text.slice(to));
    this.selection = new Selection(from + text.length); return this; }, delete(from, to) {
    this.doc = new Doc(doc.text.slice(0, from) + doc.text.slice(to)); return this;
  } }; } };
editor.contains = () => true;
const view = { dom: editor, state, focus() {}, posAtDOM: (_node, offset) => offset,
  dispatch(tr) { doc = tr.doc; if (tr.selection) selection = tr.selection; } };
editor.editor = { view };
vm.runInNewContext(fs.readFileSync(require.resolve("../upload-bridge.js"), "utf8"), {
  document: { addEventListener: (name, fn) => listeners.set(name, fn) }, window: {
    getSelection: () => ({ rangeCount: 1, isCollapsed: true,
      getRangeAt: () => ({ endContainer: {}, endOffset: selection.from }) })
  }, WeakMap, JSON, Date: { now: () => clock }
});
function request(mode, token = "") {
  attrs.set("data-jimeng-selection-request", JSON.stringify({ mode, token }));
  listeners.get("jimeng-editor-selection-request")({ target: editor });
  return attrs.get("data-jimeng-selection-result");
}
const original = doc;
assert.equal(request("capture-trigger"), "synced");
assert.equal(scrolledSelections, 1, "initial catalogue discovery must reveal the current caret without changing the document");
assert.equal(request("accept-trigger"), "changed", "an existing @query cannot replace the source");
assert.equal(request("cleanup-trigger"), "unchanged");
assert.equal(doc, original, "a non-mutating menu owns no source characters");
assert.equal(request("capture-trigger"), "synced");
selection = new Selection(9);
assert.equal(request("accept-trigger"), "changed", "unchanged text with a moved caret is unsafe");
selection = new Selection(10);
assert.equal(request("capture-trigger"), "synced");
doc = new Doc(doc.text.slice(0, 10) + "@" + doc.text.slice(10));
selection = new Selection(11);
assert.equal(request("accept-trigger"), "synced");
assert.equal(request("cleanup-trigger"), "synced");
assert.equal(doc.text, original.text, "only the native button's inserted @ may be deleted");
selection = new Selection(10);
assert.equal(request("capture-trigger"), "synced");
doc = new Doc(doc.text.slice(0, 10) + "@" + doc.text.slice(10));
selection = new Selection(11);
assert.equal(request("accept-trigger"), "synced");
doc = new Doc(doc.text + "用户修改");
const edited = doc;
assert.equal(request("cleanup-trigger"), "unchanged");
assert.equal(doc, edited, "user edits or candidate commits must prevent cleanup");
selection = new Selection(0);
assert.equal(request("capture-trigger"), "synced");
doc = new Doc("@错误改写");
selection = new Selection(1);
assert.equal(request("accept-trigger"), "changed", "more than a single insertion cannot be accepted");
console.log("✓ canvas native @ cleanup restores only the exact pre-click document and never overwrites later edits");
for (const token of ["", "@QA_video_01", "@QA name (green)", "@测试_04", "@🧪素材"]) {
  doc = new Doc(`before ${token} after`);
  selection = new Selection(7 + token.length);
  const before = doc.text;
  if (token) assert.equal(request("sync", token), "synced");
  assert.equal(request("capture-trigger"), "synced");
  assert.equal(request("accept-trigger"), "changed");
  assert.equal(request("append-trigger"), "synced");
  assert.equal(request("append-trigger"), "changed", "the single owned @ must not be appended twice");
  assert.equal(request("accept-trigger"), "synced");
  assert.equal(doc.text, `before ${token}@ after`);
  assert.equal(request("cleanup-trigger"), "synced");
  assert.equal(doc.text, before);
}
selection = new Selection(1);
assert.equal(request("capture-trigger"), "synced");
doc = new Doc(doc.text + "edited");
assert.equal(request("append-trigger"), "changed", "a concurrent edit must prevent trigger insertion");
console.log("✓ reused queries get one isolated trigger; discovery, Unicode, spaces and concurrent edits are guarded");
assert.ok(scrolledSelections > 4, "both source selections and initial discovery must reveal the popup anchor");

doc = new Doc("@sample.");
selection = new Selection(doc.text.length);
assert.equal(request("capture-trigger"), "synced");
assert.equal(request("append-trigger"), "synced");
assert.equal(request("accept-trigger"), "synced");
editor.checkVisibility = () => false;
assert.equal(request("capture-trigger"), "hidden");
assert.equal(request("cleanup-trigger"), "synced", "a still-mounted hidden owner can clean only its exact owned character");
assert.equal(doc.text, "@sample.");
for (const changed of [false, true]) {
  editor.checkVisibility = () => true;
  doc = new Doc("before @sample after");
  selection = new Selection(14);
  assert.equal(request("sync", "@sample"), "synced");
  assert.equal(request("capture-trigger"), "synced");
  assert.equal(request("append-trigger"), "synced");
  assert.equal(request("accept-trigger"), "synced");
  doc = new Doc(doc.text + (changed ? "changed" : ""));
  assert.equal(request("verify", "@sample"), changed ? "changed" : "synced");
  assert.equal(request("cleanup-trigger"), changed ? "unchanged" : "synced");
  assert.equal(doc.text, changed ? "before @sample@ afterchanged" : "before @sample after");
}
console.log("✓ identical collaboration snapshots preserve native selection and owned-trigger cleanup; edits remain blocked");

editor.checkVisibility = () => true;
doc = new Doc("stable @sample");
selection = new Selection(14);
assert.equal(request("begin-settle"), "settling");
clock += 299;
assert.equal(request("settle"), "settling");
// A delayed controlled-value update must restart the stability window.
doc = new Doc("stable @sample updated");
assert.equal(request("settle"), "settling");
clock += 299;
assert.equal(request("settle"), "settling");
doc = new Doc(doc.text); // equal collaboration snapshots do not extend it
clock += 1;
assert.equal(request("settle"), "synced");
const settledDoc = doc;
assert.equal(request("begin-settle"), "settling", "each operation observes a fresh window");
assert.equal(doc, settledDoc, "waiting must never rewrite source text or chips");
editor.checkVisibility = () => false;
clock += 300;
assert.equal(request("settle"), "hidden", "switching away must stop the wait");
console.log("✓ canvas waits through delayed document changes before pinning the next caret; equal snapshots, new runs and hidden nodes are guarded");
