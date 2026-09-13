const assert = require("assert").strict;
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, "0.3.24");
assert.equal(manifest.name, "即梦素材一键匹配");
assert.equal(
  manifest.description,
  "分步上传本地图片、视频和音频并手动匹配，在原文字后追加即梦/Dreamina 原生 @ 标签。"
);
assert.deepEqual(manifest.permissions, ["storage"]);
assert.deepEqual(manifest.host_permissions, [
  "https://jimeng.jianying.com/*",
  "https://dreamina.capcut.com/*"
]);
assert.equal(manifest.background, undefined, "the extension must not add a background network worker");
assert.equal(manifest.content_scripts.length, 2);
assert.deepEqual(manifest.content_scripts.find((entry) => entry.world === "MAIN").js, ["media-files.js", "upload-bridge.js", "canvas-upload-bridge.js", "bgm-bridge.js"]);
assert.equal(manifest.content_scripts.find((entry) => entry.world !== "MAIN").js.includes("onboarding.js"), true);
assert.equal(
  manifest.content_scripts.flatMap((entry) => entry.js).some((file) => /^https?:/i.test(file)),
  false,
  "all runtime scripts must be packaged locally"
);

console.log("✓ manifest restores the original display copy and keeps minimal permissions");
require("./upload-bridge.test.js");
require("./editor-selection-bridge.test.js");
