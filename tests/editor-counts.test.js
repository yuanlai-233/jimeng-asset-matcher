const assert = require("assert").strict;
const matcher = require("../matcher.js");

globalThis.JimengAssetMatcher = matcher;
globalThis.JimengAssetPlugin = {
  constants: {
    highlightName: "test-highlight",
    overlayId: "test-overlay"
  },
  state: {}
};
require("../editor.js");

function mention(text, children = []) {
  return {
    children,
    contains(element) {
      return children.includes(element) || children.some((child) => child.contains(element));
    },
    getAttribute() {
      return null;
    },
    innerText: text,
    querySelector() {
      return null;
    },
    textContent: text
  };
}

const nestedLabel = mention("1234");
const nestedRoot = mention("1234", [nestedLabel]);
const resizedSource = mention("角色甲（改尺寸）");
const repeatedLabel = mention("黑色水杯黑色水杯");
const underscoredName = mention("_123");
const hyphenatedName = mention("-cup");
const emojiName = mention("🧋水杯");
const clippedVideo = mention("QA_vi…eo_01");
clippedVideo.querySelectorAll = () => [{ getAttribute: (key) => key === "aria-label" ? "QA_video_01" : null }];
const editor = {
  querySelectorAll(selector) {
    assert.match(
      selector,
      /\[contenteditable="false"\]/,
      "absolute counts must include every node masked by plainText"
    );
    return [
      nestedRoot,
      nestedLabel,
      resizedSource,
      repeatedLabel,
      underscoredName,
      hyphenatedName,
      emojiName,
      clippedVideo
    ];
  }
};
const counts = globalThis.JimengAssetPlugin.editor.countCandidateMentions(
  editor,
  [
    "123",
    "1234",
    "角色甲",
    "角色甲（改尺寸）",
    "水杯",
    "黑色水杯",
    "_123",
    "-cup",
    "🧋水杯",
    "QA_video_01",
    "QA_video_010"
  ]
);

assert.equal(counts.get("123"), 0);
assert.equal(counts.get("1234"), 1);
assert.equal(counts.get("角色甲"), 0);
assert.equal(counts.get("角色甲（改尺寸）"), 1);
assert.equal(counts.get("水杯"), 0);
assert.equal(counts.get("黑色水杯"), 1);
assert.equal(counts.get("_123"), 1);
assert.equal(counts.get("-cup"), 1);
assert.equal(counts.get("🧋水杯"), 1);
assert.equal(counts.get("QA_video_01"), 1);
assert.equal(counts.get("QA_video_010"), 0, "a clipped label must never imply a prefix match");
console.log("✓ counts nested native mentions once and assigns exact longest names");
