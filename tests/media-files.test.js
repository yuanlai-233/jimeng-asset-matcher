const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const media = require("../media-files.js");
const local = require("../local-assets.js");
const workflow = require("../local-workflow.js");

const mixed = [{ name: "card.png", type: "image/png" },
  { name: "clip.mp4", type: "video/mp4" }, { name: "sound.wav", type: "audio/x-wav" }];
assert.deepEqual(mixed.map(media.kindOf), ["image", "video", "audio"]);
assert.equal(media.kindOf({ name: "fake.png", type: "video/mp4" }), null);
assert.equal(media.kindOf({ name: "code.js", type: "image/png" }), null);
assert.equal(media.kindOf({ name: "voice.M4A", type: "" }), "audio");
assert.equal(media.acceptsFiles(["image/*"], mixed), false);
assert.equal(media.acceptsFiles(["image/*", "video/*", "audio/*"], mixed), true);
assert.equal(media.pickerAcceptsFiles({ multiple: true, types: [{ accept: { "image/png": [".png"] } }] }, mixed), false);
assert.equal(media.pickerAcceptsFiles({ multiple: true, types: [{ accept: {
  "image/png": [".png"], "video/mp4": [".mp4"], "audio/wav": [".wav"]
} }] }, mixed), true);

let reads = 0;
function directory(folder) {
  return { kind: "directory", name: path.basename(folder), async *entries() {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const target = path.join(folder, entry.name);
      yield [entry.name, entry.isDirectory() ? directory(target) : {
        kind: "file", name: entry.name, async getFile() { reads++; return fs.readFileSync(target); }
      }];
    }
  } };
}
(async () => {
  const root = path.resolve(__dirname, "../examples/mixed-names");
  const index = await local.indexDirectory(directory(path.join(root, "materials")));
  assert.equal(index.records.length, 50);
  const counts = Object.fromEntries(["image", "video", "audio"].map(kind =>
    [kind, index.records.filter(record => record.mediaKind === kind).length]));
  assert.deepEqual(counts, { image: 30, video: 10, audio: 10 });
  assert.equal(reads, 0);
  for (const references of [50, 100, 150]) {
    const prompt = fs.readFileSync(path.join(root, `prompt-${references}.txt`), "utf8");
    const plan = workflow.planLocalUpload(prompt, index);
    assert.equal(plan.filesToUpload.length, 50);
    assert.equal(plan.occurrences.length, references, "ordinary prose numbers must not add references");
    assert.equal(plan.missing.length, 0);
    assert.equal(plan.conflicts.length, 0);
    for (const record of index.records) assert.equal(plan.occurrences.filter(item => item.name === record.assetName).length, references / 50);
    const images = index.records.filter(record => record.mediaKind === "image").map(record => record.assetName);
    const repair = workflow.planLocalUpload(prompt, index, images);
    assert.equal(repair.filesToUpload.length, 20, "previously confirmed pictures must not be re-uploaded");
    assert.equal(repair.filesToUpload.every(record => record.mediaKind !== "image"), true);
  }
  const plan = workflow.planLocalUpload(fs.readFileSync(path.join(root, "prompt-50.txt"), "utf8"), index);
  await local.materializeMatchedFiles({ files: plan.filesToUpload });
  assert.equal(reads, 50);
  console.log("✓ user's 30-image/10-video/10-audio reproducer resolves 50/100/150 references, including spaces and near names, and repairs only missing media");
})().catch(error => { console.error(error); process.exitCode = 1; });
