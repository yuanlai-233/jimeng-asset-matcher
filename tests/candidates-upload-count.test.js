const assert = require("assert").strict;
const matcher = require("../matcher.js");

globalThis.JimengAssetMatcher = matcher;
globalThis.JimengAssetPlugin = {};
require("../candidates.js");

const plugin = globalThis.JimengAssetPlugin;
const { expectedUploadCount } = plugin.candidates;

globalThis.getComputedStyle = () => ({
  display: "block",
  opacity: "1",
  pointerEvents: "auto",
  visibility: "visible"
});

const editor = {
  contains: () => false,
  getBoundingClientRect: () => ({
    bottom: 800,
    left: 300,
    right: 1100,
    top: 500
  })
};

function control(text, {
  className = "upload-tab",
  left = 320,
  role = "tab",
  top = 420
} = {}) {
  return {
    className,
    getAttribute: (name) => {
      if (name === "role") return role;
      if (name === "aria-selected") return "false";
      return null;
    },
    getBoundingClientRect: () => ({
      bottom: top + 36,
      height: 36,
      left,
      right: left + 110,
      top,
      width: 110
    }),
    innerText: text,
    parentElement: null,
    tagName: "BUTTON",
    textContent: text
  };
}

const nearbyAll = control("全部 (29)");
const nearbyImages = control("图片（29）", { left: 440 });
const unrelatedPromptText = control("全部 (417)", {
  className: "prompt-copy",
  role: "",
  top: 610
});
unrelatedPromptText.tagName = "DIV";
unrelatedPromptText.getAttribute = () => null;
const farAwayTab = control("All (99)", { left: 1700, top: 40 });
const wrongCategory = control("视频 (88)", { left: 560 });

globalThis.document = {
  contains: () => true,
  querySelectorAll: () => [
    unrelatedPromptText,
    farAwayTab,
    wrongCategory,
    nearbyAll,
    nearbyImages
  ]
};
plugin.isVisible = () => true;

assert.equal(
  expectedUploadCount(editor),
  29,
  "only nearby semantic All/Image upload controls may define catalogue completeness"
);

console.log("✓ reads the nearby native upload total without using prompt numbers");
