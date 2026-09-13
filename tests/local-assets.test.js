const assert = require("assert").strict;

const {
  DEFAULT_ASSET_EXTENSIONS,
  indexDirectory,
  matchPromptToLocalAssets,
  materializeMatchedFiles
} = require("../local-assets.js");

const tests = [];

function test(name, run) {
  tests.push({ name, run });
}

function file(name, onGetFile = () => {}) {
  return {
    kind: "file",
    name,
    async getFile() {
      onGetFile();
      return { name };
    }
  };
}

function directory(name, entries) {
  return {
    kind: "directory",
    name,
    async *entries() {
      for (const entry of entries) {
        yield [entry.name, entry];
      }
    }
  };
}

test("indexes supported image, video and audio files without reading their bytes", async () => {
  assert.equal(DEFAULT_ASSET_EXTENSIONS.includes("mp4"), true);
  assert.equal(DEFAULT_ASSET_EXTENSIONS.includes("wav"), true);
  let reads = 0;
  const index = await indexDirectory(directory("media", [
    file("photo.png", () => reads++), file("clip.mp4", () => reads++),
    file("voice.wav", () => reads++), file("notes.txt", () => reads++)
  ]));
  assert.deepEqual(index.records.map(record => record.mediaKind), ["video", "image", "audio"]);
  assert.equal(reads, 0);
});

test("recursively indexes every supported file without materializing it", async () => {
  let getFileCalls = 0;
  const firstHalf = Array.from({ length: 20 }, (_, index) =>
    file(`${String(index + 1).padStart(2, "0")}_素材.png`, () => {
      getFileCalls += 1;
    })
  );
  const secondHalf = Array.from({ length: 20 }, (_, index) =>
    file(`${String(index + 21).padStart(2, "0")}_素材.JPG`, () => {
      getFileCalls += 1;
    })
  );
  const root = directory("素材库", [
    ...firstHalf,
    directory("下半部分", secondHalf),
    file("说明.txt"),
    file(".隐藏素材.png"),
    directory(".缓存", [file("不应读取.png")])
  ]);

  const index = await indexDirectory(root);

  assert.equal(index.scannedFileCount, 41);
  assert.equal(index.indexedFileCount, 40);
  assert.equal(index.byAssetName.size, 40);
  assert.equal(index.byAssetName.has("40_素材"), true);
  assert.equal(
    index.byAssetName.get("40_素材")[0].relativePath,
    "下半部分/40_素材.JPG"
  );
  assert.equal(getFileCalls, 0, "indexing must retain handles, not read every file");
  assert.deepEqual(
    index.skipped.map((entry) => [entry.relativePath, entry.reason]),
    [
      [".缓存", "hidden-entry"],
      [".隐藏素材.png", "hidden-entry"],
      ["说明.txt", "unsupported-extension"]
    ]
  );
});

test("matches exact explicit @ names and ignores ordinary prose", async () => {
  const root = directory("素材库", [
    file("01_测试场景长名称.png"),
    file("角色甲.jpg"),
    file("角色甲正面.jpg")
  ]);
  const index = await indexDirectory(root);
  const result = matchPromptToLocalAssets(
    "普通文字角色甲不上传；场景用 @01_测试场景长名称，人物用 @角色甲。",
    index
  );

  assert.deepEqual(
    result.files.map((record) => record.assetName),
    ["01_测试场景长名称", "角色甲"]
  );
  assert.deepEqual(
    result.occurrences.map((occurrence) => occurrence.name),
    ["01_测试场景长名称", "角色甲"]
  );
  assert.deepEqual(result.missing, []);
});

test("known CJK asset names may be followed immediately by action prose", async () => {
  const index = await indexDirectory(directory("素材库", [file("太空吨仔.webp")]));
  const result = matchPromptToLocalAssets(
    "@太空吨仔先扶住叶片，再快速回头。",
    index
  );

  assert.deepEqual(result.files.map((record) => record.assetName), ["太空吨仔"]);
  assert.deepEqual(result.missing, []);
  assert.equal(result.occurrences[0].token, "@太空吨仔");
});

test("deduplicates repeated references because one local file uploads once", async () => {
  const index = await indexDirectory(directory("素材库", [file("红色玩偶.png")]));
  const result = matchPromptToLocalAssets(
    "@红色玩偶先出现，最后再看 @红色玩偶。",
    index
  );

  assert.equal(result.occurrences.length, 2);
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].filename, "红色玩偶.png");
});

test("materializes only matched files and preserves prompt order", async () => {
  const reads = [];
  const index = await indexDirectory(directory("素材库", [
    file("未引用.png", () => reads.push("未引用.png")),
    file("场景.png", () => reads.push("场景.png")),
    file("人物.png", () => reads.push("人物.png"))
  ]));
  const result = matchPromptToLocalAssets("先 @人物，再 @场景。", index);
  const selected = await materializeMatchedFiles(result, { concurrency: 2 });

  assert.deepEqual(selected.map((item) => item.file.name), ["人物.png", "场景.png"]);
  assert.deepEqual(selected.map((item) => item.record.assetName), ["人物", "场景"]);
  assert.deepEqual(new Set(reads), new Set(["人物.png", "场景.png"]));
  assert.equal(reads.includes("未引用.png"), false);
});

test("reports duplicate basenames as conflicts instead of picking a folder", async () => {
  const index = await indexDirectory(directory("素材库", [
    directory("角色", [file("角色甲.png")]),
    directory("备份", [file("角色甲.jpg")])
  ]));
  const result = matchPromptToLocalAssets("人物参考 @角色甲。", index);

  assert.equal(result.files.length, 0);
  assert.equal(result.occurrences[0].status, "conflict");
  assert.deepEqual(
    result.conflicts[0].records.map((record) => record.relativePath),
    ["备份/角色甲.jpg", "角色/角色甲.png"]
  );
});

test("normalizes decomposed macOS filenames before exact matching", async () => {
  const decomposed = "咖啡\u0301";
  const composed = decomposed.normalize("NFC");
  const index = await indexDirectory(directory("素材库", [file(`${decomposed}.png`)]));
  const result = matchPromptToLocalAssets(`使用 @${composed}。`, index);

  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].assetName, composed);
});

test("keeps missing explicit references separate from known local files", async () => {
  const index = await indexDirectory(directory("素材库", [file("已存在素材.png")]));
  const result = matchPromptToLocalAssets(
    "使用 @已存在素材，再加入 @没有这个文件。",
    index
  );

  assert.deepEqual(result.files.map((record) => record.assetName), ["已存在素材"]);
  assert.deepEqual(result.missing.map((reference) => reference.name), ["没有这个文件"]);
});

test("can be cancelled during a large recursive scan", async () => {
  const controller = new AbortController();
  const root = {
    kind: "directory",
    name: "素材库",
    async *entries() {
      yield ["01.png", file("01.png")];
      controller.abort();
      yield ["02.png", file("02.png")];
    }
  };

  await assert.rejects(
    () => indexDirectory(root, { signal: controller.signal }),
    (error) => error?.name === "AbortError"
  );
});

(async () => {
  for (const item of tests) {
    await item.run();
    console.log(`✓ ${item.name}`);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
