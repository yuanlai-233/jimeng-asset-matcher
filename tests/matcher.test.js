const assert = require("assert").strict;

const {
  missingPromptReferences,
  mentionTargetFailures,
  matchSlotKey,
  planMatchesToMentionTargets,
  promptHasExactTarget,
  pruneInactiveMentionTargets,
  matchBelongsToReference,
  matchPromptToCandidates,
  normalizeAssetName,
  parsePromptReferences,
  promptReferenceErrors,
  selectionReplacesPrompt,
  unexpectedCandidateNames
} = require("../matcher.js");

const tests = [];

test("missing highlights retain every occurrence and respect known filename boundaries", () => {
  const prompt = "@人物A @场景B @场景B @产品 正面 出现 @水杯放在桌上";
  const missing = missingPromptReferences(prompt, ["人物A", "产品 正面", "水杯"]);
  assert.deepEqual(missing.map((reference) => reference.name), ["场景B", "场景B"]);
  assert.deepEqual(missing.map((reference) => reference.start), [5, 10]);
  assert.equal(missingPromptReferences("@缺失 @缺失", []).length, 2);
  assert.equal(parsePromptReferences("@缺失 @缺失").length, 1,
    "existing callers retain deduplication");
});

function test(name, run) {
  tests.push({ name, run });
}

test("rejects malformed and embedded references without partial filename matches", () => {
  for (const prompt of ["@@sample", "person" + "@sample.test", "@sample.png", "@sample_010", "@测试_040"]) {
    assert.deepEqual(matchPromptToCandidates(prompt, ["sample", "sample_01", "测试_04"]), [], prompt);
  }
  assert.deepEqual(parsePromptReferences("person" + "@sample.test @@sample"), []);
  assert.deepEqual(matchPromptToCandidates("@sample\nname", ["sample name"]), []);
  for (const prompt of ["@@sample", "@", "@ sample", "＠sample", "@sample.png", "@clip.mp4"]) {
    assert.ok(promptReferenceErrors(prompt).length, prompt);
  }
  for (const prompt of ["使用@人物走近镜头", "@sample name (green)", "@sample。", "person" + "@sample.test"]) {
    assert.deepEqual(promptReferenceErrors(prompt), [], prompt);
  }
  assert.equal(matchPromptToCandidates("使用@人物走近镜头", ["人物"]).length, 1);
});

test("normalizes names without keeping @ prefixes", () => {
  assert.equal(normalizeAssetName("@@紫色水杯"), "紫色水杯");
  assert.equal(normalizeAssetName("  black-cup_01  "), "black-cup_01");
  assert.equal(normalizeAssetName("@"), "");
  assert.equal(normalizeAssetName("@角色甲(改尺寸)"), "角色甲(改尺寸)");
  assert.equal(
    normalizeAssetName("Cafe\u0301"),
    "Café",
    "native menu and macOS filenames must share NFC normalization"
  );
});

test("matches an NFC prompt against an NFD native candidate", () => {
  const matches = matchPromptToCandidates("使用 @Café。", ["Cafe\u0301"]);
  assert.deepEqual(matches.map((match) => match.name), ["Café"]);
  assert.deepEqual(matches.map((match) => match.token), ["@Café"]);
});

test("parses unique prompt references in first-seen order", () => {
  assert.deepEqual(
    parsePromptReferences("让 @紫色水杯 靠近 @黑色水杯，再看 @紫色水杯").map(
      (item) => item.name
    ),
    ["紫色水杯", "黑色水杯"]
  );
});

test("native mention masks terminate a preserved plain reference", () => {
  const references = parsePromptReferences("使用 @素材\u0000\u0000。继续");
  assert.deepEqual(references.map((item) => item.name), ["素材"]);
  assert.equal(normalizeAssetName("素材\u0000标签"), "");
});

test("matches exact candidate names and preserves prompt order", () => {
  const result = matchPromptToCandidates(
    "先看 @紫色水杯，再看 @黑色水杯。",
    ["黑色水杯", "紫色水杯"]
  );
  assert.deepEqual(
    result.map((item) => item.name),
    ["紫色水杯", "黑色水杯"]
  );
});

test("keeps bare-name matching disabled by default", () => {
  const result = matchPromptToCandidates(
    "让紫色水杯靠近黑色水杯。",
    ["黑色水杯", "紫色水杯"]
  );
  assert.equal(result.length, 0);
});

test("protects explicit references and ASCII identifier boundaries", () => {
  assert.equal(
    matchPromptToCandidates("@紫色水杯", ["水杯"]).length,
    0
  );
  assert.equal(
    matchPromptToCandidates("@1234 x123 1234", ["123"]).length,
    0
  );
});

test("requires the full uploaded candidate name before matching", () => {
  assert.equal(
    matchPromptToCandidates("使用 @吹风机。", ["吹风机配件"]).length,
    0
  );
  const matches = matchPromptToCandidates(
    "使用 @吹风机配件完成安装。",
    ["@吹风机配件"]
  );
  assert.deepEqual(
    matches.map((match) => match.token),
    ["@吹风机配件"]
  );
  assert.deepEqual(
    matchPromptToCandidates(
      "使用 @吹风机。",
      ["吹风机配件", "吹风机"]
    ).map((match) => match.name),
    ["吹风机"]
  );
});

test("a repeated click preserves an already paired plain reference", () => {
  const matches = matchPromptToCandidates(
    "@123 123",
    ["123"]
  );
  const plan = planMatchesToMentionTargets(
    matches,
    new Map([["123", 1]]),
    new Map([["123", 1]])
  );
  assert.deepEqual(plan.matches, []);
  assert.equal(plan.targetCounts.get("123"), 1);
});

test("same-name occurrences retain their own native-mention slots", () => {
  const prompt = "@123 再看 @123，最后 @123";
  const matches = matchPromptToCandidates(prompt, ["123"]);
  const plan = planMatchesToMentionTargets(
    matches,
    new Map([["123", 1]]),
    new Map([["123", 3]])
  );
  assert.deepEqual(
    plan.matches.map((match) => match.start),
    [prompt.indexOf("@123", 1), prompt.lastIndexOf("@123")],
    "the first native mention pairs with the first plain occurrence"
  );
  assert.equal(plan.targetCounts.get("123"), 3);
});

test("an existing paired slot is skipped without deleting its plain text", () => {
  const prompt = "开场 @人物，转场 @场景，再看 @人物";
  const matches = matchPromptToCandidates(prompt, ["人物", "场景"]);
  const plan = planMatchesToMentionTargets(
    matches,
    new Map([["人物", 1], ["场景", 0]]),
    new Map()
  );

  assert.deepEqual(
    plan.matches.map((match) => [match.name, match.start]),
    [
      ["人物", prompt.lastIndexOf("@人物")],
      ["场景", prompt.indexOf("@场景")]
    ]
  );
  assert.equal(
    matches.some((match) => match.start === prompt.indexOf("@人物")),
    true,
    "the paired source occurrence must remain available in the prompt snapshot"
  );
});

test("exact slot pairing can skip only the second same-name occurrence", () => {
  const prompt = "先看 @人物，然后再看 @人物";
  const matches = matchPromptToCandidates(prompt, ["人物"]);
  const pairedSlots = new Set([matchSlotKey(matches[1])]);
  const plan = planMatchesToMentionTargets(
    matches,
    new Map([["人物", 1]]),
    new Map([["人物", 8]]),
    pairedSlots
  );

  assert.deepEqual(
    plan.matches.map((match) => match.start),
    [matches[0].start],
    "an exact pair on the second slot must not make the first slot look satisfied"
  );
  assert.equal(
    plan.targetCounts.get("人物"),
    2,
    "stale targets and extra native counts cannot exceed the current plain slots"
  );
});

test("extra native mentions do not raise a current name's slot target", () => {
  const matches = matchPromptToCandidates("@人物", ["人物"]);
  const plan = planMatchesToMentionTargets(
    matches,
    new Map([["人物", 5]]),
    new Map([["人物", 9]])
  );

  assert.deepEqual(plan.matches, []);
  assert.equal(plan.targetCounts.get("人物"), 1);
});

test("prunes targets from an old task without losing active recovery", () => {
  const pruned = pruneInactiveMentionTargets(
    new Map([
      ["旧场景", 1],
      ["待补素材", 2],
      ["现有标签", 1]
    ]),
    new Map([
      ["旧场景", 0],
      ["待补素材", 0],
      ["现有标签", 1]
    ]),
    [{ name: "待补素材" }]
  );
  assert.deepEqual(pruned, new Map([
    ["待补素材", 2],
    ["现有标签", 1]
  ]));
});

test("does not keep a shorter old target inside a new longer asset name", () => {
  assert.equal(promptHasExactTarget("使用 @吹风机配件。", "吹风机"), false);
  assert.equal(promptHasExactTarget("使用 @吹风机。", "吹风机"), true);
});

test("a satisfied native target survives a partial candidate menu", () => {
  const failures = mentionTargetFailures(
    new Map([["123", 1]]),
    new Map([["123", 1]]),
    new Set()
  );
  assert.equal(failures.size, 0);
});

test("a changed upload baseline keeps a missing candidate yellow", () => {
  const failures = mentionTargetFailures(
    new Map([["123", 1]]),
    new Map([["123", 1]]),
    new Set(),
    { materialsChanged: true }
  );
  assert.equal(failures.get("123"), "上传素材已变化，当前素材菜单中没有这个素材");
});

test("detects only whole-prompt selections as a new prompt revision", () => {
  assert.equal(selectionReplacesPrompt("", ""), true);
  assert.equal(selectionReplacesPrompt("abcdefghij", "abcdefgh"), true);
  assert.equal(selectionReplacesPrompt("abcdefghij", "abc"), false);
});

test("reports uploaded candidates that the prompt and native mentions do not use", () => {
  assert.deepEqual(
    unexpectedCandidateNames(
      "让 @人物 走进 场景图。",
      ["人物", "场景图", "误传图片"],
      new Map()
    ),
    ["场景图", "误传图片"],
    "bare same-name prose must not count as an asset reference"
  );
  assert.deepEqual(
    unexpectedCandidateNames(
      "让人物继续动作。",
      ["人物", "已有标签", "误传图片"],
      new Map([["已有标签", 1]])
    ),
    ["人物", "误传图片"],
    "only explicit @ text or an existing native mention counts as used"
  );
  assert.deepEqual(
    unexpectedCandidateNames("让 @人物 继续动作。", ["人物"], new Map()),
    [],
    "an explicit complete @ reference must count as used"
  );
});

test("extra-material checks keep exact full-name and ASCII boundaries", () => {
  assert.deepEqual(
    unexpectedCandidateNames("使用 @吹风机配件 和 @1234。", [
      "吹风机",
      "吹风机配件",
      "123"
    ]),
    ["吹风机", "123"]
  );
});

test("prompt text can never manufacture an upload candidate", () => {
  assert.deepEqual(
    matchPromptToCandidates(
      "提示词写了 @Octo 和 @不存在素材。",
      ["真实上传素材"]
    ),
    []
  );
  assert.deepEqual(
    unexpectedCandidateNames(
      "提示词写了 @Octo 和 @不存在素材。",
      ["真实上传素材"]
    ),
    ["真实上传素材"]
  );
});

test("prefers a complete @name match over the bare name inside it", () => {
  const result = matchPromptToCandidates("使用 @123。", ["123"]);
  assert.equal(result.length, 1);
  assert.equal(result[0].token, "@123");
  assert.equal(result[0].prefixed, true);
});

test("matches a candidate whose displayed name also starts with @", () => {
  const result = matchPromptToCandidates("使用 @123。", ["@123"]);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "123");
});

test("keeps parentheses as part of an asset name", () => {
  const result = matchPromptToCandidates(
    "让 @角色甲（改尺寸） 走到桌面中央。",
    ["角色甲（改尺寸）"]
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].token, "@角色甲（改尺寸）");
});

test("matches a CJK asset prefix and leaves following prose alone", () => {
  const result = matchPromptToCandidates(
    "@太空吨仔先扶助黑色水杯。",
    ["太空吨仔"]
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].token, "@太空吨仔");
  assert.equal(result[0].end, "@太空吨仔".length);
});

test("maps exact candidates to over- and under-captured generic references", () => {
  const prompt =
    "普通文字角色甲@角色甲是一个测试角色，" +
    "场景：@测试场景一镜到底，" +
    "界面内容参考@测试截图。";
  const references = parsePromptReferences(prompt);
  const matches = matchPromptToCandidates(prompt, [
    "角色甲",
    "测试场景",
    "测试截图"
  ]);
  const resolved = matches.map((match) =>
    references.find((reference) => matchBelongsToReference(reference, match))?.name
  );

  assert.deepEqual(resolved, [
    "角色甲是一个测试角色",
    "测试场景一镜到底",
    "测试截图"
  ]);
  assert.equal(
    matchBelongsToReference({ start: 2 }, { start: 12 }),
    false
  );
});

test("does not match an @ asset name inside a longer name", () => {
  const result = matchPromptToCandidates("使用 @1234，而不是目标素材。", ["123"]);
  assert.equal(result.length, 0);
});

test("does not confuse a short candidate with a longer @ name", () => {
  const result = matchPromptToCandidates("使用 @水杯架，不是普通水杯。", ["水杯", "水杯架"]);
  assert.deepEqual(result.map((item) => item.name), ["水杯架"]);
});

test("supports candidate names containing spaces", () => {
  const result = matchPromptToCandidates("使用 @水瓶 产品图-4 作为场景。", ["水瓶 产品图-4"]);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "水瓶 产品图-4");
});

test("treats NBSP and repeated prompt whitespace as asset-name spaces", () => {
  const prompt = "使用 @水瓶\u00a0\u00a0产品图-4 作为场景。";
  const result = matchPromptToCandidates(prompt, ["水瓶 产品图-4"]);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "水瓶 产品图-4");
  assert.equal(result[0].token, "@水瓶\u00a0\u00a0产品图-4");
  assert.equal(prompt.slice(result[0].start, result[0].end), result[0].token);
});

test("never converts bare names inside ordinary prompt prose", () => {
  const bare = matchPromptToCandidates(
    "人物走过场景图，3—6秒后切镜，12只昆虫一起回头。",
    ["人物", "场景图", "6", "12"]
  );
  assert.equal(bare.length, 0);
  assert.deepEqual(
    matchPromptToCandidates("使用 @6 和 @12。", ["6", "12"])
      .map((item) => item.name),
    ["6", "12"]
  );
});

test("returns only repeated prefixed occurrences", () => {
  const result = matchPromptToCandidates("@紫色水杯 靠近 紫色水杯，再看 @紫色水杯", ["紫色水杯"]);
  assert.deepEqual(
    result.map((item) => item.token),
    ["@紫色水杯", "@紫色水杯"]
  );
});

test("canvas resolves all 50 distinct mixed-media references after native whitespace removal", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/canvas-mixed-50.json"), "utf8"));
  const prompt = fixture.prompt;
  const names = fixture.names.map(name => name.replace(/\s/gu, ""));
  const options = { allowCollapsedWhitespace: true };
  const matches = matchPromptToCandidates(prompt, names, options);
  assert.equal(matches.length, 50);
  assert.equal(new Set(matches.map(match => match.name)).size, 50);
  assert.deepEqual(missingPromptReferences(prompt, names, options), []);
  assert.deepEqual(unexpectedCandidateNames(prompt, names, new Map(), options), []);
  for (const match of matches) assert.equal(prompt.slice(match.start, match.end), match.token);
  assert.equal(matches.find(match => match.name === "角色侧面").token, "@角色  侧面");
  assert.equal(matches.find(match => match.name === "propbackpack").token, "@prop  backpack");
  assert.deepEqual(matchPromptToCandidates("普通 7、70、700、scene_A1、IMG-024B", names, options), []);
  assert.deepEqual(matchPromptToCandidates("@scene morning", ["scenemorning"]), [], "local file matching remains exact");
  assert.deepEqual(matchPromptToCandidates("@a b c。", ["ab c", "a bc"], options), [], "ambiguous compact names are rejected");
  assert.deepEqual(matchPromptToCandidates("@clip_070", ["clip_07"], options), []);
  assert.deepEqual(matchPromptToCandidates("@scene morning.png", ["scenemorning"], options), []);
  assert.deepEqual(matchPromptToCandidates("@scene\nmorning", ["scenemorning"], options), []);
});

let failures = 0;
for (const entry of tests) {
  try {
    entry.run();
    console.log(`✓ ${entry.name}`);
  } catch (error) {
    failures += 1;
    console.error(`✗ ${entry.name}`);
    console.error(error);
  }
}

if (failures) {
  process.exitCode = 1;
} else {
  console.log(`\n${tests.length} tests passed.`);
}
