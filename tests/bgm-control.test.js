const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const events = new Map();
const elements = new Map();
let syncs = 0, preserved = 0, timers = 0;
function element() {
  const attrs = new Map(), styles = new Map(), listeners = new Map();
  return {
    attrs, listeners, className: "", offsetHeight: 32,
    setAttribute: (k, v) => attrs.set(k, v), getAttribute: (k) => attrs.get(k),
    removeAttribute: (k) => attrs.delete(k),
    style: { getPropertyValue: (k) => styles.get(k), setProperty: (k, v) => styles.set(k, v) },
    addEventListener: (k, fn) => listeners.set(k, fn),
    remove() { this.removed = true; },
    querySelector: () => ({ getAttribute: () => "16" })
  };
}
const editor = { ...element(), sig: "original", matches: () => true, contains: () => false };
editor.dispatchEvent = () => {
  const payload = JSON.parse(editor.getAttribute("data-jimeng-bgm-request"));
  if (payload.mode === "sync") { syncs++; editor.sig = payload.enabled ? "music" : "no-music"; }
  editor.setAttribute("data-jimeng-bgm-result", JSON.stringify({ ok: true, changed: payload.mode === "sync" }));
};
const root = { contains: () => true }, row = {};
const at = { ...element(), className: "native-at", parentElement: row, after(b) { this.nextElementSibling = b; b.parentElement = row; } };
const plugin = {
  state: { matching: false, localUploading: false, matchStatusVerified: true, matchStatusEditor: editor, verifiedEditorSignature: "original" },
  ui: {
    updateMatchStatus() {}, toast() {}, scheduleMatchControlPosition() {},
    editorVerificationSignature: (e) => e.sig,
    materialBaselineChanged: () => false,
    markMatchVerified(e) { preserved++; plugin.state.verifiedEditorSignature = e.sig; }
  }
};
vm.runInNewContext(fs.readFileSync(require.resolve("../bgm.js"), "utf8"), {
  JimengAssetPlugin: plugin,
  document: {
    getElementById: (id) => elements.get(id),
    createElement: () => { const b = element(); elements.set("jimeng-bgm-toggle", b); return b; },
    addEventListener: (name, fn) => events.set(name, fn)
  },
  getComputedStyle: () => ({ display: "flex", flexDirection: "row", columnGap: "8px" }),
  Event: class {}, setTimeout: () => ++timers, clearTimeout() {}, WeakMap, Map, JSON
});
const context = { editor, nativeAtButton: at, composerRoot: root };
plugin.bgm.mount(context);
const button = at.nextElementSibling;
assert.equal(button.getAttribute("aria-checked"), "false");
assert.equal(button.style.getPropertyValue("--jam-bgm-size"), "32px");
assert.equal(button.style.getPropertyValue("--jam-bgm-gap"), "0px", "use the native row gap, not a second margin");
plugin.bgm.mount(context);
assert.equal(at.nextElementSibling, button, "rerenders reuse a single inline control");
const click = () => button.listeners.get("click")({ preventDefault() {}, stopPropagation() {} });
click();
assert.equal(button.getAttribute("aria-checked"), "true");
assert.equal(preserved, 1, "changing only the owned sentence retains current valid verification");
editor.sig = "user-edited";
click();
assert.equal(preserved, 1, "never grant verification when the user changed the prompt");
const before = syncs;
plugin.state.matching = true; plugin.bgm.render(); click();
assert.equal(button.disabled, true);
assert.equal(syncs, before, "no prompt mutation during matching");
plugin.state.matching = false;
events.get("compositionstart")(); click();
assert.equal(syncs, before, "no prompt mutation during IME composition");
events.get("compositionend")();
plugin.bgm.mount(null);
assert.equal(button.removed, true, "inactive composers lose their control");
console.log("✓ BGM inline control reuses native sizing/gaps, keeps valid verification and pauses during matching/IME");
