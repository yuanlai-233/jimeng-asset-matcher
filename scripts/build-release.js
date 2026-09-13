"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const name = `jimeng-asset-matcher-v${manifest.version}`;
const dist = path.resolve(
  process.env.JIMENG_RELEASE_DIR || path.join(root, "dist")
);
const packageRoot = path.join(dist, name);
const archive = path.join(dist, `${name}.zip`);
// Ship only manifest-declared runtime/UI files and the required license.
// Guides, screenshots, examples and development files stay in the source tree.
const runtimeFiles = new Set([
  "manifest.json",
  "LICENSE",
  ...manifest.content_scripts.flatMap((entry) => [...entry.js, ...(entry.css || [])]),
  ...Object.values(manifest.icons || {})
]);

fs.rmSync(packageRoot, { force: true, recursive: true });
fs.rmSync(archive, { force: true });
for (const relative of Array.from(runtimeFiles).sort()) {
  const source = path.join(root, relative);
  const target = path.join(packageRoot, relative);
  if (!fs.statSync(source).isFile()) throw new Error(`Missing release file: ${relative}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

const zipped = spawnSync("zip", ["-qr", archive, name], {
  cwd: dist,
  encoding: "utf8"
});
if (zipped.status !== 0) {
  throw new Error(zipped.stderr || "zip command failed");
}
console.log(`✓ built ${archive} from ${runtimeFiles.size} whitelisted files`);
