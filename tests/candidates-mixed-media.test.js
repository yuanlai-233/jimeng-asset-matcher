const assert = require("node:assert/strict");
globalThis.document = { contains: () => true };
globalThis.JimengAssetMatcher = require("../matcher.js");
const plugin = globalThis.JimengAssetPlugin = { isVisible: () => true };
require("../candidates.js");
let rows = [];
const root = {
  innerText: "可能@的内容", textContent: "可能@的内容",
  contains: (element) => rows.includes(element),
  querySelectorAll: () => rows,
  getBoundingClientRect: () => ({ width: 300, height: 400 })
};
function row(name, kind) {
  return {
    innerText: name, textContent: name, parentElement: root,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 280, height: 40 }),
    querySelector: (selector) => kind === "audio"
      ? (selector.includes("option-cover-container-") ? {} : null)
      : kind === "command" ? null : (selector.includes("img") ? {} : null),
    querySelectorAll: (selector) => selector.includes("aria-haspopup")
      ? kind === "subject" ? [{ getAttribute: (key) => key === "aria-haspopup" ? "menu" : null }] : []
      : [{ children: [], textContent: name }]
  };
}
rows = [
  ...Array.from({ length: 30 }, (_, i) => row(`图片_${i + 1}`, "image")),
  ...Array.from({ length: 10 }, (_, i) => row(`视频_${i + 1}`, "video")),
  ...Array.from({ length: 10 }, (_, i) => row(`音频 ${i + 1}`, "audio")),
  row("创建主体", "command"), row("保存的角色", "subject"), row("普通工具", "command")
];
assert.equal(plugin.candidates.visibleRows(root).length, 50);
assert.deepEqual(plugin.candidates.visibleRows(root).slice(-10).map(x => x.name),
  Array.from({ length: 10 }, (_, i) => `音频 ${i + 1}`));
rows = rows.filter(x => x.innerText.startsWith("音频") || x.innerText === "创建主体");
assert.equal(plugin.candidates.visibleRows(root).length, 10);
console.log("✓ mixed and audio-only native menus include audio covers, excluding commands and saved subjects");

// Canvas uses data-mention-option-thumbnail plus a media kind for icon-only
// covers, even when the option contains no HTML media element. Plain SVG
// commands and saved subjects must still stay outside the upload catalogue.
function canvasRow(name, kind, { legacyImage = false, subject = false, typed = true } = {}) {
  const element = row(name, "command");
  element.querySelector = selector => legacyImage && selector.includes("img") ||
    typed && ["image", "video", "audio"].includes(kind) &&
    selector.includes(`[data-mention-option-thumbnail][data-kind="${kind}"]`) ? {} : null;
  if (subject) element.className = "subject-library-item";
  return element;
}
const image = canvasRow("图片_01", "image", { legacyImage: true });
const video = canvasRow("视频_010", "video");
const audio = canvasRow("音效（上升）", "audio");
const placeholder = canvasRow("等待封面", "image");
const command = canvasRow("普通工具", "audio", { typed: false });
const unknown = canvasRow("未知类型", "subject");
const saved = canvasRow("已保存角色", "image", { subject: true });
rows = [image, video, audio, placeholder, command, unknown, saved];
assert.deepEqual(plugin.candidates.visibleRows(root).map(item => item.name),
  ["图片_01", "视频_010", "音效（上升）", "等待封面"]);
let revealed = false;
plugin.isVisible = element => element !== audio || revealed;
audio.scrollIntoView = () => { revealed = true; };
plugin.waitFor = async check => check();
(async () => {
  const target = await plugin.candidates.seekExactVisibleRow("音效（上升）", root);
  assert.equal(target?.element, audio, "a clipped icon-only audio row must be found and revealed");
  assert.equal(revealed, true);
  rows = [video, audio, command, unknown, saved];
  assert.deepEqual(plugin.candidates.visibleRows(root).map(item => item.name),
    ["视频_010", "音效（上升）"]);
  assert.equal(plugin.candidates.rowMatches({element: video, name: "视频_010"}, "视频_01"), false);
  console.log("✓ canvas mixed/icon-only menus retain typed references, reveal clipped audio, and reject commands/subjects/prefix matches");
})().catch(error => { console.error(error); process.exitCode = 1; });
