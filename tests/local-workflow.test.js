const assert = require("assert").strict;

const { indexDirectory } = require("../local-assets.js");
const {
  assertPromptUnchanged,
  planLocalUpload
} = require("../local-workflow.js");

const tests = [];

function test(name, run) {
  tests.push({ name, run });
}

function file(name) {
  return {
    kind: "file",
    name,
    async getFile() {
      return { name };
    }
  };
}

function directory(name, entries) {
  return {
    kind: "directory",
    name,
    async *entries() {
      for (const entry of entries) yield [entry.name, entry];
    }
  };
}

async function createIndex(entries) {
  return indexDirectory(directory("素材库", entries));
}

test("只计划上传提示词中精确 @ 命中的本地图片", async () => {
  const index = await createIndex([
    file("01_测试场景.png"),
    file("角色甲.jpg"),
    file("角色甲正面.jpg"),
    file("未引用的素材.webp")
  ]);

  const plan = planLocalUpload(
    "普通正文提到角色甲和未引用的素材，只有场景 @01_测试场景 需要上传。",
    index,
    []
  );

  assert.deepEqual(
    plan.filesToUpload.map((record) => record.assetName),
    ["01_测试场景"]
  );
  assert.deepEqual(plan.alreadyUploaded, []);
  assert.deepEqual(plan.conflicts, []);
});

test("已出现在原生素材目录的名称不再重复上传", async () => {
  const index = await createIndex([
    file("角色甲.png"),
    file("红色玩偶.png")
  ]);

  const plan = planLocalUpload(
    "人物 @角色甲，友方 @红色玩偶。",
    index,
    ["@角色甲", " 不相关的已上传素材 "]
  );

  assert.deepEqual(
    plan.alreadyUploaded.map((record) => record.assetName),
    ["角色甲"]
  );
  assert.deepEqual(
    plan.filesToUpload.map((record) => record.assetName),
    ["红色玩偶"]
  );
});

test("同一个 @ 引用出现多次时只计划上传一份文件", async () => {
  const index = await createIndex([file("蓝色蜻蜓.png")]);
  const plan = planLocalUpload(
    "@蓝色蜻蜓先起飞，镜头后段 @蓝色蜻蜓 再抓住衣袖。",
    index,
    []
  );

  assert.equal(plan.occurrences.length, 2);
  assert.equal(plan.filesToUpload.length, 1);
  assert.equal(plan.filesToUpload[0].relativePath, "蓝色蜻蜓.png");
});

test("不同路径存在同名素材时计划仅返回冲突而不返回待上传文件", async () => {
  const index = await createIndex([
    directory("角色", [file("角色甲.png")]),
    directory("备份", [file("角色甲.jpg")])
  ]);
  const plan = planLocalUpload("人物使用 @角色甲。", index, []);

  assert.equal(plan.filesToUpload.length, 0);
  assert.equal(plan.alreadyUploaded.length, 0);
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].name, "角色甲");
  assert.deepEqual(
    plan.conflicts[0].records.map((record) => record.relativePath),
    ["备份/角色甲.jpg", "角色/角色甲.png"]
  );
});

test("上传期间提示词变化时抛出可识别的停止错误", () => {
  assert.equal(assertPromptUnchanged("使用 @角色甲。", "使用 @角色甲。"), true);
  assert.throws(
    () => assertPromptUnchanged("使用 @角色甲。", "使用 @角色乙。"),
    (error) => {
      assert.equal(error?.code, "PROMPT_CHANGED_DURING_UPLOAD");
      assert.match(error?.message || "", /提示词已发生变化/);
      return true;
    }
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
