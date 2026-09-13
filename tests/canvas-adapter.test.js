const assert = require("node:assert/strict");
const plugin = globalThis.JimengAssetPlugin = { isVisible: (node) => !node.hidden };
require("../canvas.js");
const prompt = {};
let editors = [];
let buttons = [];
let slots = [];
let popups = [];
const form = { contains: (node) => node === prompt || node === area || buttons.includes(node),
  querySelectorAll: (selector) => selector === "button" ? buttons : selector.includes("material-slot") ? slots : selector.includes("listbox") ? popups : editors };
const area = {};
const editor = { closest: (selector) => selector.startsWith("form") ? form :
  selector.includes("prompt-area") ? area : prompt };
editors = [editor];
function button(label, type = "button", insidePrompt = false) {
  return { getAttribute: (key) => key === "aria-label" ? label : key === "type" ? type : null,
    closest: () => insidePrompt ? prompt : null };
}
const toolbar = button("引用参考");
const placeholder = button("引用参考", "button", true);
const submit = button("生成", "submit");
buttons = [toolbar, placeholder, submit, button("添加参考")];
assert.equal(plugin.canvas.formFor(editor), form);
assert.equal(plugin.canvas.referenceButton(editor), toolbar);
assert.equal(plugin.canvas.sendButton(editor), submit);
assert.equal(plugin.canvas.editorArea(editor), area);
buttons.push(button("引用参考"));
assert.equal(plugin.canvas.referenceButton(editor), null, "ambiguous controls must fail closed");
buttons.pop();
editors.push({});
assert.equal(plugin.canvas.formFor(editor), null, "multiple editors in one form are unsafe");
editors.pop();
editor.hidden = true;
assert.equal(plugin.canvas.formFor(editor), null);
editor.hidden = false;
let text = "@sample";
let actions = [];
plugin.editor = { plainText: () => text,
  nativeSelectionAction: (_editor, mode) => { actions.push(mode); return true; } };
assert.equal(plugin.canvas.capturePicker(editor), true);
text += "@";
assert.equal(plugin.canvas.acceptPicker(editor), true);
assert.equal(plugin.canvas.expectedPickerText(editor, "@sample"), "@sample@");
assert.equal(plugin.canvas.expectedPickerText(editor, "unrelated"), "unrelated");
plugin.canvas.cleanupPicker(editor);
assert.equal(actions.at(-1), "cleanup-trigger");
assert.equal(plugin.canvas.expectedPickerText(editor, "@sample"), "@sample");
function slot(type, src = "", busy = "false") {
  return { hasAttribute: () => Boolean(type),
    getAttribute: (key) => ({ "data-material-type": type, "aria-busy": busy, "aria-label": type ? "Reference material" : "添加参考" })[key],
    querySelectorAll: () => src ? [{ src }] : [] };
}
slots = [slot("2", "image-a"), slot("3", "video-a"), slot(null)];
assert.equal(plugin.canvas.materialSlots(editor).length, 2, "the add slot is not an uploaded asset");
const signature = plugin.canvas.materialSignature(editor);
slots[1] = slot("3", "video-b");
assert.notEqual(plugin.canvas.materialSignature(editor), signature, "video replacement invalidates the catalogue");
slots[1] = slot("3", "video-a", "true");
assert.notEqual(plugin.canvas.materialSignature(editor), signature, "uploading video is never the verified baseline");
const owners = [];
plugin.editor.nativeSelectionAction = (target) => { owners.push(target); return true; };
plugin.canvas.capturePicker(editor);
plugin.canvas.cleanupPicker({});
assert.equal(owners.at(-1), editor, "switching nodes cleans up only the original picker owner");
console.log("✓ canvas controls are scoped to one visible video form; temporary native triggers are tracked per editor");

assert.equal(plugin.canvas.pickerIsOpen(editor), false);
popups = [{}];
assert.equal(plugin.canvas.pickerIsOpen(editor), true, "an empty native listbox is still an open picker");
popups[0].hidden = true;
assert.equal(plugin.canvas.pickerIsOpen(editor), false);
popups[0].hidden = false;
plugin.candidates = { isInteractiveElement: () => false };
assert.equal(plugin.canvas.pickerIsOpen(editor), false, "a closing, noninteractive popup must not block the next native trigger");

let nodeId = "node-a";
form.getAttribute = () => nodeId;
const firstState = plugin.canvas.uploadStateFor(editor);
firstState.pending = ["pending-image"];
firstState.verified.add("ready-image");
const remounted = { ...editor };
editors = [remounted];
assert.equal(plugin.canvas.uploadStateFor(remounted), firstState, "remount keeps the same canvas node ledger");
nodeId = "node-b";
const other = { ...editor };
editors = [other];
assert.notEqual(plugin.canvas.uploadStateFor(other), firstState, "different nodes cannot share upload confirmations");
assert.deepEqual(plugin.canvas.uploadStateFor(other).pending, []);
assert.equal(plugin.canvas.uploadStateFor(editor), firstState, "the old owner remains pinned after switching nodes");
globalThis.location = { pathname: "/another-canvas" };
nodeId = "node-a";
const otherCanvas = { ...editor };
editors = [otherCanvas];
assert.notEqual(plugin.canvas.uploadStateFor(otherCanvas), firstState, "node IDs from different canvases must not collide");
console.log("✓ canvas upload ledgers survive remounts and remain isolated by canvas and node");
