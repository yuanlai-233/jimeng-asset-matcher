const assert = require("node:assert/strict");
globalThis.JimengAssetMatcher = require("../matcher.js");
let elements = [];
globalThis.document = { querySelectorAll: () => elements, activeElement: null };
globalThis.innerHeight = 1000;
globalThis.JimengAssetPlugin = {
  constants: {}, state: {}, isVisible: (element) => !element.hidden,
  canvas: { formFor: (element) => element.canvas ? {} : null }
};
require("../editor.js");
function editor(canvas, width, height) {
  return { canvas, innerText: "@QA_unused", matches: () => false,
    getAttribute: () => null, contains: () => false,
    getBoundingClientRect: () => ({ width, height, top: 500, bottom: 500 + height }) };
}
const scaled = editor(true, 220, 9);
const ordinary = editor(false, 640, 100);
elements = [ordinary, scaled];
assert.equal(JimengAssetPlugin.editor.findEditor(), scaled);
scaled.hidden = true;
assert.equal(JimengAssetPlugin.editor.findEditor(), ordinary);
elements = [editor(false, 220, 9)];
assert.equal(JimengAssetPlugin.editor.findEditor(), null);
console.log("✓ zoomed canvas editors use semantic ownership; ordinary small fields remain excluded");
