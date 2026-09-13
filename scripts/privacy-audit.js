"use strict";

const assert = require("assert").strict;
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const ignoredDirectories = new Set([
  ".git", ".codex", ".agents", "build", "coverage", "dist",
  "node_modules", "release", "tmp"
]);
const ignoredFiles = new Set([
  ".DS_Store", "HANDOFF.md", "Thumbs.db", "mobius-master.png"
]);
const textExtensions = new Set([
  ".css", ".html", ".js", ".json", ".md", ".mjs", ".txt", ".yml", ".yaml"
]);

function publicFiles(directory, relative = "") {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      throw new Error(`Symlinks are not allowed in the public tree: ${path.join(relative, entry.name)}`);
    }
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    if (entry.isFile() && (
      ignoredFiles.has(entry.name) || /\.(?:crx|mov|mp4|p12|pem|key|webm|zip)$/iu.test(entry.name)
    )) continue;
    const nextRelative = path.join(relative, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...publicFiles(absolute, nextRelative));
    else if (entry.isFile()) result.push({ absolute, relative: nextRelative });
  }
  return result;
}

const files = publicFiles(root);
const forbiddenPathPatterns = [
  new RegExp("/" + "Users/", "u"),
  new RegExp("/" + "var/folders/", "u"),
  new RegExp("Temporary" + "Items", "u")
];
const secretPatterns = [
  new RegExp("gh" + "[pousr]_[A-Za-z0-9]{20,}", "u"),
  new RegExp("sk" + "-[A-Za-z0-9_-]{20,}", "u"),
  new RegExp("AKIA" + "[A-Z0-9]{16}", "u"),
  new RegExp("BEGIN (?:RSA |EC |OPENSSH )?PRIVATE" + " KEY", "u"),
  new RegExp("AIza" + "[A-Za-z0-9_-]{30,}", "u")
];
// Project-specific creative names from the private development recordings
// must not leak into public fixtures, examples, or diagnostics.
const privateContentPatterns = [
  new RegExp("源" + "来", "u"),
  new RegExp("菜园" + "木箱", "u"),
  new RegExp("象甲" + "虫玩偶", "u"),
  new RegExp("瓢虫" + "玩偶", "u"),
  new RegExp("蝽虫" + "玩偶", "u"),
  new RegExp("蛾子" + "玩偶", "u"),
  new RegExp("10" + "厘米", "u")
];
const findings = [];
const allowedPublicEmails = new Set(["cs_svip@163.com"]);
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu;

for (const file of files) {
  const stat = fs.statSync(file.absolute);
  if (stat.size > 5 * 1024 * 1024) {
    findings.push(`${file.relative}: public file exceeds 5 MB`);
  }
  if (!textExtensions.has(path.extname(file.relative).toLowerCase())) continue;
  const text = fs.readFileSync(file.absolute, "utf8");
  for (const email of text.match(emailPattern) || []) {
    if (!allowedPublicEmails.has(email.toLowerCase())) {
      findings.push(`${file.relative}: unexpected public email ${email}`);
    }
  }
  for (const pattern of [
    ...forbiddenPathPatterns,
    ...secretPatterns,
    ...privateContentPatterns
  ]) {
    if (pattern.test(text)) findings.push(`${file.relative}: matched ${pattern}`);
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
assert.equal(fs.existsSync(path.join(root, "DISCLAIMER.md")), true);
assert.deepEqual(manifest.permissions, ["storage"]);
assert.deepEqual(manifest.host_permissions, [
  "https://jimeng.jianying.com/*",
  "https://dreamina.capcut.com/*"
]);
assert.equal(manifest.background, undefined);
assert.equal(findings.length, 0, findings.join("\n"));

console.log(`✓ privacy audit passed for ${files.length} publishable files`);
