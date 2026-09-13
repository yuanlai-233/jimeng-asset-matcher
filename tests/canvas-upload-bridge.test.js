"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function fixture(options = {}) {
  const listeners = new Map();
  const timers = new Map();
  let nativeDialogs = 0;
  let clicks = 0;
  let received = [];
  let pickerResult;
  class Event { constructor(type, init = {}) { Object.assign(this, { type }, init); } }
  class Input {
    constructor() { this.type = "file"; this.isConnected = true; this.attrs = new Map(); this.multiple = true; this.accept = "image/png"; }
    get files() { return this._files || []; }
    set files(value) { this._files = value; }
    click() { nativeDialogs++; }
    showPicker() { nativeDialogs++; }
    hasAttribute(key) { return this.attrs.has(key); }
    getAttribute(key) { return this.attrs.get(key) || null; }
    setAttribute(key, value) { this.attrs.set(key, value); }
    dispatchEvent(event) { if (event.type === "change") received = this.files; }
  }
  const originalClick = Input.prototype.click;
  const originalShowPicker = Input.prototype.showPicker;
  const originalOpen = async () => { nativeDialogs++; return []; };
  const window = { showOpenFilePicker: originalOpen };
  const visible = { isConnected: true, checkVisibility() { return !this.hidden; }, getBoundingClientRect: () => ({ height: 40 }) };
  const editor = { ...visible, textContent: "Use @sample.", hidden: options.hidden };
  const button = { ...visible, id: "own-trigger", disabled: options.disabled,
    getAttribute: (key) => key === "aria-controls" ? "own-menu" : null,
    dispatchEvent() { if (options.changeText) editor.textContent += "edited"; if (options.switchNode) form.isConnected = false; }
  };
  const formAttrs = new Map();
  const form = { ...visible, contains: (node) => node === editor,
    matches: () => true, getAttribute: (key) => key === "data-target-id" ? "node-one" : formAttrs.get(key),
    setAttribute: (key, value) => formAttrs.set(key, value),
    querySelectorAll: (selector) => selector.includes("generation-material-slot") ? options.replace ? [slot] : [] :
      selector.startsWith("button") ? [button] : options.twoEditors ? [editor, {}] : [editor] };
  const carrier = new Input();
  carrier.parentElement = form;
  carrier.setAttribute("data-jimeng-canvas-upload", "1");
  carrier.files = options.files || [
    { name: "sample.png", type: "image/png", size: 12 },
    { name: "second.png", type: "image/png", size: 12 }
  ];
  const existing = new Input();
  const card = { contains: (node) => node === existing && !options.foreignInput };
  existing.closest = () => form;
  const slot = { ...visible, getAttribute: (key) => key === "aria-busy" ? "false" : null,
    querySelector: () => options.ready ? null : {},
    closest: () => card, scrollIntoView() {}, click() { clicks++; existing.click(); },
    __reactFiberTest: { memoizedProps: { material: { id: "failed-id", fileName: options.wrongName ? "other" : "sample", type: 2,
      presentation: { thumbnailUrl: "private-url-not-exposed" } }, task: options.ready ? undefined : { phase: "failed" } } } };
  if (options.replace) carrier.setAttribute("data-jimeng-canvas-replace", "failed-id");
  const item = { ...visible, textContent: "上传参考内容", getAttribute: () => null,
    click() {
      clicks++;
      if (options.interrupt) return listeners.get("pointerdown")({ isTrusted: true });
      if (options.throwClick) throw new Error("native menu failed");
      if (options.api) {
        pickerResult = window.showOpenFilePicker({ multiple: !options.single,
          types: [{ accept: options.accept || { [options.badAccept ? "text/plain" : "image/png"]: [] } }] });
        pickerResult.catch(() => {});
        return;
      }
      const input = options.existingInput ? existing : new Input();
      input.multiple = !options.single;
      if (options.badAccept) input.accept = "text/plain";
      if (options.accept) input.accept = Object.keys(options.accept).join(",");
      if (options.showPicker) input.showPicker();
      else input.click();
    }
  };
  const menu = { ...visible, querySelectorAll: () => options.twoItems ? [item, item] : [item] };
  const document = {
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); },
    querySelectorAll: () => [carrier, existing],
    getElementById: () => options.noMenu ? null : menu
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("../canvas-upload-bridge.js"), "utf8"), {
    JimengMediaFiles: require("../media-files.js"),
    document, window, HTMLInputElement: Input, Event, PointerEvent: Event, DOMException,
    setTimeout(fn, delay) { const token = {}; timers.set(token, { fn, delay }); return token; },
    clearTimeout(token) { timers.delete(token); }
  });
  return { editor, form, carrier, listeners, window,
    start: () => listeners.get("jimeng-canvas-upload-request")({ target: carrier }),
    fire(delay) { for (const [key, timer] of [...timers]) if (timer.delay === delay) { timers.delete(key); timer.fn(); } },
    status: () => carrier.getAttribute("data-jimeng-picker-result"),
    result: () => pickerResult,
    received: () => received,
    assertRestored() {
      assert.equal(Input.prototype.click, originalClick);
      assert.equal(Input.prototype.showPicker, originalShowPicker);
      assert.equal(window.showOpenFilePicker, originalOpen);
      assert.equal(listeners.has("pointerdown"), false);
      assert.equal(listeners.has("keydown"), false);
      assert.equal(nativeDialogs, 0);
    }, clicks: () => clicks };
}

(async () => {
  const replacement = fixture({ replace: true, files: [{ name: "sample.png", type: "image/png", size: 12 }] });
  replacement.listeners.get("jimeng-canvas-material-state-request")({ target: replacement.form });
  assert.deepEqual(JSON.parse(replacement.form.getAttribute("data-jimeng-canvas-material-state")),
    [{ id: "failed-id", name: "sample", kind: 2, status: "failed" }]);
  await replacement.start();
  assert.equal(replacement.status(), "dispatched");
  assert.equal(replacement.received().length, 1);
  replacement.assertRestored();
  for (const option of [{ ready: true }, { wrongName: true }, { foreignInput: true }]) {
    const rejected = fixture({ ...option, replace: true, files: [{ name: "sample.png", type: "image/png", size: 12 }] });
    await rejected.start();
    assert.equal(rejected.status(), option.foreignInput ? "incompatible" : "invalid-replacement");
    assert.deepEqual(rejected.received(), []);
    rejected.assertRestored();
  }
  console.log("✓ failed cards expose only names/status and permit same-name replacement through their own input; ready/foreign/mismatched cards are rejected");
  for (const api of [false, true]) {
    const files = [{ name: "card.png", type: "image/png", size: 12 },
      { name: "clip.mp4", type: "video/mp4", size: 12 }, { name: "sound.wav", type: "audio/wav", size: 12 }];
    const mixed = fixture({ api, files, accept: { "image/*": [], "video/*": [], "audio/*": [] } });
    await mixed.start();
    assert.equal(mixed.status(), "dispatched");
    assert.deepEqual(api ? await Promise.all((await mixed.result()).map(handle => handle.getFile())) : mixed.received(), files);
    mixed.assertRestored();
    const imageOnly = fixture({ api, files });
    await imageOnly.start();
    if (api) await assert.rejects(imageOnly.result());
    assert.equal(imageOnly.status(), "incompatible");
    imageOnly.assertRestored();
  }
  for (const mode of [{}, { showPicker: true }, { api: true }]) {
    const f = fixture(mode);
    await f.start();
    assert.equal(f.status(), "dispatched");
    if (mode.api) {
      const handles = await f.result();
      assert.equal(await handles[0].getFile(), f.carrier.files[0]);
    } else assert.equal(f.received(), f.carrier.files);
    assert.equal(f.clicks(), 1);
    f.assertRestored();
  }
  console.log("✓ canvas hands exact files to one native upload action and restores click/showPicker/open hooks");
  const tooMany = fixture({ files: Array.from({ length: 51 }, (_, index) => ({
    name: `material-${index}.png`, type: "image/png", size: 12
  })) });
  await tooMany.start();
  assert.equal(tooMany.status(), "invalid-target");
  tooMany.assertRestored();
  console.log("✓ canvas rejects batches larger than the 50-file native upload limit");
  for (const [options, expected] of [
    [{ hidden: true }, "invalid-target"], [{ disabled: true }, "invalid-target"],
    [{ twoEditors: true }, "invalid-target"], [{ files: [] }, "invalid-target"],
    [{ files: [{ name: "script.exe", type: "application/octet-stream", size: 12 }] }, "invalid-target"],
    [{ single: true }, "incompatible"], [{ badAccept: true }, "incompatible"],
    [{ existingInput: true }, "incompatible"], [{ twoItems: true }, "menu-unavailable"],
    [{ switchNode: true }, "target-changed"], [{ changeText: true }, "target-changed"],
    [{ interrupt: true }, "interrupted"], [{ throwClick: true }, "unavailable"],
    [{ api: true, badAccept: true }, "incompatible"]
  ]) {
    const f = fixture(options);
    await f.start();
    assert.equal(f.status(), expected, JSON.stringify(options));
    assert.deepEqual(f.received(), []);
    f.assertRestored();
  }
  const timeout = fixture({ noMenu: true });
  const pending = timeout.start();
  timeout.fire(1800);
  timeout.fire(30);
  await pending;
  assert.equal(timeout.status(), "timeout");
  timeout.assertRestored();
  console.log("✓ canvas rejects replacement inputs, ambiguous/hidden targets, changed nodes, bad files and interrupted/timed-out menus");
})().catch((error) => { console.error(error); process.exitCode = 1; });
