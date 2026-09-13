const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const listeners = new Map();
const attrs = new Map();
const text = "开头 @QA name 01 后文";
const token = "@QA name 01";
const pos = text.indexOf(token) + token.length;
const node = {};
class Selection {
  constructor(pos) { this.from = this.to = pos; }
  static near(position) { return new Selection(position); }
}
const doc = { textBetween: (a, b) => text.slice(a, b), resolve: (p) => p };
let dispatches = 0;
let height = 76;
const editor = {
  matches: () => true, isConnected: true,
  closest: (selector) => selector.includes("generator-") ? {} : null,
  checkVisibility: () => true, getBoundingClientRect: () => ({ height }),
  contains: (target) => target === node,
  getAttribute: (name) => attrs.get(name),
  setAttribute: (name, value) => attrs.set(name, value)
};
const view = {
  dom: editor, isDestroyed: false,
  state: { doc, selection: new Selection(0), tr: { setSelection: (selection) => ({ selection }) } },
  posAtDOM: () => pos,
  dispatch(tr) { dispatches++; this.state.selection = tr.selection; },
  focus() {}
};
editor.editor = { view };
let rangeNode = node;
vm.runInNewContext(fs.readFileSync(require.resolve("../upload-bridge.js"), "utf8"), {
  document: { addEventListener: (name, fn) => listeners.set(name, fn) },
  window: { getSelection: () => ({ rangeCount: 1, isCollapsed: true,
    getRangeAt: () => ({ endContainer: rangeNode, endOffset: pos }) }) },
  WeakMap, JSON
});
function request(mode = "sync", source = token) {
  attrs.set("data-jimeng-selection-request", JSON.stringify({ mode, token: source }));
  listeners.get("jimeng-editor-selection-request")({ target: editor });
  return attrs.get("data-jimeng-selection-result");
}
assert.equal(request(), "synced");
assert.equal(view.state.selection.from, pos);
assert.equal(view.state.doc, doc, "selection synchronization must never change source text");
assert.equal(dispatches, 1);
assert.equal(request("verify"), "synced");
view.state.selection = new Selection(1);
assert.equal(request("verify"), "changed");
assert.equal(request(), "synced");
view.state.doc = { ...doc };
assert.equal(request("verify"), "changed");
view.state.doc = doc;
assert.equal(request("sync", "@wrong"), "source-changed");
assert.equal(request("verify"), "changed", "failed sync must invalidate the old pin");
rangeNode = {};
assert.equal(request(), "outside-editor");
rangeNode = node;
height = 24;
assert.equal(request(), "hidden", "measurement mirror must never be targeted");
height = 76;
delete editor.editor;
assert.equal(request(), "unsupported");
console.log("✓ native selection bridge pins the exact source end, preserves text, and rejects stale/mirror editors");
