const assert = require("node:assert/strict");
let now = 0;
let nextTimer = 0;
const timers = new Map();
globalThis.setTimeout = (callback, delay) => {
  const id = ++nextTimer;
  timers.set(id, { callback, at: now + delay });
  return id;
};
globalThis.clearTimeout = (id) => timers.delete(id);
function advance(ms) {
  const end = now + ms;
  for (;;) {
    const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
    if (!next || next[1].at > end) break;
    now = next[1].at;
    timers.delete(next[0]);
    next[1].callback();
  }
  now = end;
}
class Element {
  constructor() { this.children = []; this.dataset = {}; this.listeners = {}; }
  appendChild(child) { this.children.push(child); child.parent = this; }
  setAttribute(key, value) { this[key] = value; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
}
const root = new Element();
globalThis.document = {
  documentElement: root,
  createElement: () => new Element(),
  getElementById: id => root.children.find(child => child.id === id)
};
require("../matcher.js");
require("../runtime.js");
require("../ui.js");
const { ui, constants } = JimengAssetPlugin;
const notice = () => document.getElementById(constants.toastId);
ui.toast("上传完成", "success", 1000);
const initial = notice();
advance(1050); // A new result arrives while the previous one is fading out.
ui.toast("素材全部匹配", "success", 1000);
advance(150);
assert.equal(notice(), initial, "an old exit timer must not remove a newer result");
assert.equal(initial.children[1].children[0].textContent, "素材全部匹配");
initial.listeners.mouseenter();
initial.listeners.focusin();
initial.listeners.mouseleave();
advance(20000);
assert.equal(notice(), initial, "pointer departure must not dismiss keyboard-focused content");
ui.toast("提示已更新", "warning", 1000);
advance(20000);
assert.equal(notice(), initial, "updates must remain readable while focused");
initial.listeners.focusout({ relatedTarget: null });
advance(1131);
assert.equal(notice(), undefined, "the notice expires after both pointer and focus leave");
ui.toast("可以继续创作", "success", 1000);
notice().children[2].listeners.click();
advance(131);
assert.equal(notice(), undefined, "the close button dismisses the current notice");
console.log("✓ toast replacement survives a pending exit and stays readable during hover/focus");
