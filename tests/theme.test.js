"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
function node(parent = null, attrs = {}, backgroundColor = "rgba(0, 0, 0, 0)") {
  return { parentElement: parent, attrs, isConnected: true, style: { backgroundColor }, writes: 0,
    getAttribute(k) { return this.attrs[k] ?? null; },
    setAttribute(k, v) { this.attrs[k] = v; this.writes++; } };
}
const html = node(null, { "data-theme": "light" });
const body = node(html);
const composer = node(body);
const editor = node(composer);
const callbacks = [];
let observer, watches = [];
const plugin = {};
const os = { matches: true, addEventListener() {} };
vm.runInNewContext(fs.readFileSync(require.resolve("../theme.js"), "utf8"), {
  JimengAssetPlugin: plugin, document: { documentElement: html, body },
  getComputedStyle: (n) => n.style, matchMedia: () => os,
  requestAnimationFrame: (fn) => { callbacks.push(fn); return callbacks.length; },
  MutationObserver: class { constructor(fn) { observer = fn; } disconnect() { watches = []; }
    observe(n, options) { watches.push({ n, options }); } }
});
assert.equal(html.attrs["data-jimeng-theme"], "light", "page preference overrides dark OS");
plugin.theme.follow(editor);
assert.equal(watches.length, 4);
assert.ok(watches.every(w => !w.options.subtree && !w.options.characterData), "no whole-page content polling");
const writes = html.writes;
plugin.theme.follow(editor); plugin.theme.refresh();
assert.equal(html.writes, writes, "unchanged themes do not trigger mutation loops");
html.attrs["data-theme"] = "dark";
observer(); observer();
assert.equal(callbacks.length, 1, "coalesce theme changes"); callbacks.shift()();
assert.equal(html.attrs["data-jimeng-theme"], "dark");
delete html.attrs["data-theme"];
body.attrs["lv-theme"] = "light";
plugin.theme.refresh();
assert.equal(html.attrs["data-jimeng-theme"], "light", "Jimeng/Dreamina lv-theme is authoritative");
delete body.attrs["lv-theme"];
body.attrs.class = "app theme-light";
plugin.theme.refresh();
assert.equal(html.attrs["data-jimeng-theme"], "light");
delete body.attrs.class;
composer.style.backgroundColor = "rgb(247, 248, 250)";
plugin.theme.refresh();
assert.equal(html.attrs["data-jimeng-theme"], "light", "actual composer surface overrides OS fallback");
composer.style.backgroundColor = "rgb(30, 32, 36)";
plugin.theme.refresh();
assert.equal(html.attrs["data-jimeng-theme"], "dark");
assert.equal(html.attrs["data-theme"], undefined, "never writes the site's theme setting");
const css = fs.readFileSync(require.resolve("../content.css"), "utf8");
assert.ok(css.includes(':root[data-jimeng-theme="light"]'));
assert.equal(css.includes("color-scheme: dark;"), false);
assert.ok(css.includes("color: var(--jam-music)"));
console.log("✓ theme follows page settings and composer colors, coalesces changes and covers the music control");
