"use strict";
const assert = require("assert").strict;
const fs = require("fs");
const vm = require("vm");

function fixture({ trigger = true, hidden = false, compatible = true,
  accept = { "image/png": [".png"] } } = {}) {
  const listeners = new Map();
  const timers = new Map();
  const add = (name, fn) => listeners.set(name, fn);
  const remove = (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); };
  const original = async () => { throw new Error("Real picker must not be opened"); };
  const window = { showOpenFilePicker: original };
  let result;
  let clicks = 0;
  const target = {
    checkVisibility: () => !hidden,
    getBoundingClientRect: () => ({ width: 50, height: 50 }),
    click() {
      clicks++;
      if (trigger) result = window.showOpenFilePicker(compatible ? {
        multiple: true, types: [{ accept }]
      } : { types: [{ accept: { "text/plain": [".txt"] } }] });
    }
  };
  const root = {
    matches: () => true,
    querySelector: () => ({}),
    querySelectorAll: () => [target]
  };
  class Input {
    constructor() {
      this.type = "file";
      this.isConnected = true;
      this.parentElement = root;
      this.files = [{ name: "sample.png", type: "image/png" }];
      this.attrs = new Map([["data-jimeng-picker-request", "1"]]);
    }
    hasAttribute(name) { return this.attrs.has(name); }
    setAttribute(name, value) { this.attrs.set(name, value); }
    dispatchEvent() {}
  }
  const input = new Input();
  const document = { addEventListener: add, removeEventListener: remove };
  vm.runInNewContext(fs.readFileSync(require.resolve("../upload-bridge.js"), "utf8"), {
    JimengMediaFiles: require("../media-files.js"),
    document, window, HTMLInputElement: Input, Event: class {}, DOMException,
    setTimeout(fn) { const id = {}; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  return {
    input, window, original, listeners, timers,
    start: () => listeners.get("jimeng-local-picker-request")({ target: input }),
    result: () => result,
    clicks: () => clicks,
    status: () => input.attrs.get("data-jimeng-picker-result")
  };
}

(async () => {
  const mediaFiles = [{ name: "card.png", type: "image/png" },
    { name: "clip.mp4", type: "video/mp4" }, { name: "sound.wav", type: "audio/wav" }];
  const mixed = fixture({ accept: { "image/png": [".png"], "video/mp4": [".mp4"], "audio/wav": [".wav"] } });
  mixed.input.files = mediaFiles;
  mixed.start();
  assert.equal(mixed.status(), "dispatched");
  assert.deepEqual(await Promise.all((await mixed.result()).map(handle => handle.getFile())), mediaFiles);
  assert.equal(mixed.window.showOpenFilePicker, mixed.original);
  const imageOnly = fixture();
  imageOnly.input.files = mediaFiles;
  imageOnly.start();
  await assert.rejects(imageOnly.result(), /Incompatible/);
  assert.equal(imageOnly.status(), "incompatible", "an image-only picker must reject the entire mixed batch");
  const success = fixture();
  success.start();
  assert.equal(success.status(), "dispatched");
  assert.equal(success.window.showOpenFilePicker, success.original);
  const handles = await success.result();
  assert.equal(await handles[0].getFile(), success.input.files[0]);
  assert.equal(success.clicks(), 1);
  assert.equal(success.timers.size, 0);
  assert.equal(success.listeners.has("pointerdown"), false);

  const hidden = fixture({ hidden: true });
  hidden.start();
  assert.equal(hidden.status(), "invalid-target");
  assert.equal(hidden.clicks(), 0);
  assert.equal(hidden.window.showOpenFilePicker, hidden.original);

  const timed = fixture({ trigger: false });
  timed.start();
  Array.from(timed.timers.values())[0]();
  assert.equal(timed.status(), "timeout");
  assert.equal(timed.window.showOpenFilePicker, timed.original);

  const interrupted = fixture({ trigger: false });
  interrupted.start();
  interrupted.listeners.get("pointerdown")({ isTrusted: true });
  assert.equal(interrupted.status(), "interrupted");
  assert.equal(interrupted.window.showOpenFilePicker, interrupted.original);

  const wrong = fixture({ compatible: false });
  wrong.start();
  await assert.rejects(wrong.result(), /Incompatible/);
  assert.equal(wrong.status(), "incompatible");
  assert.equal(wrong.window.showOpenFilePicker, wrong.original);

  const invalid = fixture();
  invalid.input.files = [{ name: "secret.txt", type: "text/plain" }];
  invalid.start();
  assert.equal(invalid.status(), "invalid-target");
  assert.equal(invalid.clicks(), 0);
  console.log("✓ picker bridge delivers exact files once, excludes hidden targets, and restores on all exits");
})().catch((error) => { console.error(error); process.exitCode = 1; });
