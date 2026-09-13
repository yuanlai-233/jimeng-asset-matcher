const assert = require("assert").strict;
const matcher = require("../matcher.js");

globalThis.JimengAssetMatcher = matcher;
globalThis.JimengAssetPlugin = {};
require("../candidates.js");

const {
  discover,
  insertMention,
  isSubjectLibraryRow,
  isSystemMenuEntry,
  nameFromRow,
  rowMatches,
  scrollableMenuCandidates,
  visibleRows
} = globalThis.JimengAssetPlugin.candidates;

function row(name, text = name) {
  return {
    element: {
      innerText: text,
      textContent: text
    },
    name
  };
}

assert.equal(rowMatches(row("吹风机配件"), "吹风机"), false);
assert.equal(rowMatches(row("吹风机配件", "吹风机"), "吹风机"), false);
assert.equal(rowMatches(row("吹风机配件"), "@吹风机配件"), true);
assert.equal(rowMatches(row("@吹风机配件"), "吹风机配件"), true);
assert.equal(rowMatches(row("", "@吹风机配件"), "吹风机配件"), true);
assert.equal(rowMatches(row("", "吹风机配件 参考素材"), "吹风机配件"), false);

assert.equal(isSystemMenuEntry("@Octo"), true);
assert.equal(isSystemMenuEntry("Octo（AI 助手）"), true);
assert.equal(isSystemMenuEntry("Octo AI assistant"), true);
assert.equal(isSystemMenuEntry("创建主体"), true);
assert.equal(isSystemMenuEntry("会员6折"), true);
assert.equal(isSystemMenuEntry("Octopus 玩偶"), false);
const subjectMenuControl = {
  className: "subject-more-action",
  getAttribute: (name) => name === "aria-haspopup" ? "menu" : null,
  innerText: "",
  textContent: ""
};
const savedSubjectElement = {
  className: "subject-library-item",
  getAttribute: () => null,
  querySelectorAll: () => [subjectMenuControl]
};
assert.equal(isSubjectLibraryRow(savedSubjectElement), true);
assert.equal(isSubjectLibraryRow({
  className: "upload-reference-item",
  getAttribute: () => null,
  querySelectorAll: () => []
}), false);
assert.equal(nameFromRow({
  innerText: "06_测试飞虫素材 白色背景 正面展示",
  querySelectorAll: () => [
    { children: [], textContent: "6" },
    { children: [], textContent: "06_测试飞虫素材 白色背景 正面展示" }
  ],
  textContent: "06_测试飞虫素材 白色背景 正面展示"
}), "06_测试飞虫素材 白色背景 正面展示");

console.log("✓ candidate rows and spaced-name queries stay exact");

let mentionCount = 0;
let paired = false;
let popupOpen = false;
let activePopup = null;
const insertedText = [];
const insertionEvents = [];
let editorText = "@水瓶 产品图-4";
let deleteSucceeds = true;
const label = {
  children: [],
  textContent: "水瓶 产品图-4"
};
const candidateElement = {
  click: () => {
    mentionCount = 1;
    paired = true;
    popupOpen = false;
    editorText = "@水瓶 产品图-4";
  },
  innerText: "水瓶 产品图-4",
  parentElement: null,
  querySelector: (selector) => selector.includes("img") ? {} : null,
  querySelectorAll: () => [label],
  textContent: "水瓶 产品图-4"
};
const seedLabel = {
  children: [],
  textContent: "其他素材"
};
const seedElement = {
  innerText: "其他素材",
  parentElement: null,
  querySelector: (selector) => selector.includes("img") ? {} : null,
  querySelectorAll: () => [seedLabel],
  textContent: "其他素材"
};
const commandElement = {
  innerText: "创建主体",
  parentElement: null,
  querySelector: () => null,
  querySelectorAll: () => [{ children: [], textContent: "创建主体" }],
  textContent: "创建主体"
};
const octoElement = {
  getBoundingClientRect: () => ({ height: 48, width: 240 }),
  innerText: "Octo",
  parentElement: null,
  querySelector: (selector) => selector.includes("img") ? {} : null,
  querySelectorAll: () => [{ children: [], textContent: "Octo" }],
  textContent: "Octo"
};
const savedSubjectRow = {
  getBoundingClientRect: () => ({ height: 48, width: 240 }),
  getAttribute: () => null,
  innerText: "角色甲",
  parentElement: null,
  querySelector: (selector) => selector.includes("img") ? {} : null,
  querySelectorAll: (selector) => selector.includes("button") ||
    selector.includes("role") || selector.includes("aria-haspopup")
    ? [subjectMenuControl]
    : [{ children: [], textContent: "角色甲" }],
  textContent: "角色甲"
};

globalThis.KeyboardEvent = class KeyboardEvent {};
globalThis.Event = class Event {};
globalThis.getComputedStyle = () => ({ overflowY: "hidden" });

Object.assign(globalThis.JimengAssetPlugin, {
  editor: {
    countExactMentions: () => mentionCount,
    findRangeAt: (_editor, token, start) =>
      editorText.slice(start, start + token.length) === token
        ? { start, token }
        : null,
    insertText: (_editor, value) => {
      insertionEvents.push(["insert", value]);
      insertedText.push(value);
      return true;
    },
    isMatchPaired: () => paired,
    plainText: () => editorText,
    placeCaretAfterMatch: () => true,
    deleteTextAt: (_editor, token, start) => {
      insertionEvents.push(["delete"]);
      return deleteSucceeds;
    }
  },
  nativeTrigger: {
    ensurePicker: async (_editor, options = {}) => {
      const beforeOpen = editorText;
      const positioned = await options.beforeClick?.();
      assert.equal(editorText, beforeOpen);
      if (positioned === false) return false;
      popupOpen = true;
      return true;
    }
  },
  isVisible: (element) => element !== activePopup || popupOpen,
  sleep: async (duration) => {
    insertionEvents.push(["sleep", duration]);
  },
  waitFor: async (check) => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const value = check();
      if (value) return value;
    }
    return null;
  }
});

(async () => {
  const menu = {
    clientHeight: 100,
    contains: (element) => element === wrongScrollWrapper ||
      element.parentElement === wrongScrollWrapper,
    dispatchEvent: () => {
      if (menu.scrollTop >= 100) {
        menu.innerText = "素材列表";
        menu.textContent = "素材列表";
      }
    },
    getBoundingClientRect: () => ({ height: 100, width: 300 }),
    innerText: "可能@的内容",
    parentElement: null,
    querySelector: (selector) => selector.includes("img") ? {} : null,
    scrollHeight: 300,
    scrollTop: 50,
    textContent: "可能@的内容"
  };
  const wrongScrollWrapper = {
    clientHeight: 100,
    parentElement: menu,
    scrollHeight: 120,
    scrollTop: 0
  };
  const menuAsset = (name) => ({
    closest: () => menu,
    innerText: name,
    parentElement: wrongScrollWrapper,
    querySelector: (selector) => selector.includes("img") ? {} : null,
    querySelectorAll: () => [{ children: [], textContent: name }],
    textContent: name
  });
  const assets = ["素材 A", "素材 B", "素材 C", "素材 D"].map(menuAsset);
  globalThis.document = {
    activeElement: { dispatchEvent: () => {} },
    dispatchEvent: () => {},
    querySelectorAll: (selector) => {
      if (selector === "div, li, button") return [];
      if (menu.scrollTop < 100) return assets.slice(0, 2);
      if (menu.scrollTop < 200) return assets.slice(1, 3);
      return assets.slice(2);
    }
  };
  const discovered = await discover({});
  assert.deepEqual(discovered.map((item) => item.name), [
    "素材 A",
    "素材 B",
    "素材 C",
    "素材 D"
  ]);
  assert.equal(menu.scrollTop, 50, "menu scroll position should be restored");
  assert.equal(
    scrollableMenuCandidates([ { element: assets[0], name: "素材 A" } ], menu)[0],
    menu,
    "the real large scroll viewport must win over a nearer incidental overflow"
  );
  console.log("✓ a locked popup survives virtual-list marker recycling");
  insertionEvents.length = 0;

  let popupRows = [];
  const candidatePopup = {
    contains: (element) => element.parentElement === candidatePopup,
    getBoundingClientRect: () => ({ height: 320, width: 300 }),
    innerText: "可能@的内容",
    parentElement: null,
    querySelector: (selector) => selector.includes("img") ? {} : null,
    querySelectorAll: () => popupRows,
    textContent: "可能@的内容"
  };
  activePopup = candidatePopup;
  popupRows = [
    commandElement,
    octoElement,
    savedSubjectRow,
    seedElement,
    candidateElement
  ];
  for (const element of popupRows) {
    element.parentElement = candidatePopup;
    element.closest = () => candidatePopup;
  }
  globalThis.document = {
    activeElement: { dispatchEvent: () => {} },
    dispatchEvent: () => {},
    querySelectorAll: (selector) => {
      if (selector === "div, li, button" || !popupOpen) return [];
      return [commandElement, octoElement, savedSubjectRow, seedElement, candidateElement];
    }
  };
  const result = await insertMention(
    {},
    {
      name: "水瓶 产品图-4",
      start: 0,
      token: "@水瓶 产品图-4"
    }
  );
  assert.equal(result.ok, true);
  assert.deepEqual(
    insertionEvents.filter(([type]) => type !== "sleep"),
    [],
    "native-toolbar matching must not call editor text mutation helpers"
  );
  assert.equal(
    editorText,
    "@水瓶 产品图-4",
    "the source @name text must remain after appending the native mention"
  );
  assert.deepEqual(
    insertedText,
    [],
    "an exact candidate must be opened through the native @ toolbar without typing"
  );
  popupOpen = true;
  assert.deepEqual(
    visibleRows().map((item) => item.name),
    ["其他素材", "水瓶 产品图-4"],
    "commands, saved subjects and non-upload rows must be excluded"
  );
  popupOpen = false;
  assert.equal(
    insertedText.some((value) => /\s/u.test(value)),
    false,
    "the native @ menu must not receive a literal space before selection"
  );
  insertedText.length = 0;
  insertionEvents.length = 0;
  editorText = "@水瓶 产品图-4";
  const alreadyPaired = await insertMention(
    {},
    {
      end: "@水瓶 产品图-4".length,
      name: "水瓶 产品图-4",
      start: 0,
      token: "@水瓶 产品图-4"
    }
  );
  assert.equal(alreadyPaired.ok, true);
  assert.equal(alreadyPaired.alreadyPaired, true);
  assert.deepEqual(
    insertedText,
    [],
    "a repeated run must not insert another trigger for an already paired slot"
  );
  paired = false;
  mentionCount = 0;
  popupOpen = false;
  editorText = "@水瓶 产品图-4";
  insertedText.length = 0;
  insertionEvents.length = 0;
  globalThis.document.querySelectorAll = () => [];
  const noPicker = await insertMention(
    {},
    {
      end: "@水瓶 产品图-4".length,
      name: "水瓶 产品图-4",
      start: 0,
      token: "@水瓶 产品图-4"
    }
  );
  assert.equal(noPicker.ok, false);
  assert.equal(editorText, "@水瓶 产品图-4");
  assert.equal(insertionEvents.some(([type]) => type === "delete"), false);
  assert.match(noPicker.reason, /原文字已保留/u);
  insertedText.length = 0;
  insertionEvents.length = 0;
  const beforeDiscovery = editorText;
  assert.deepEqual(await discover({}), []);
  assert.equal(editorText, beforeDiscovery);
  assert.deepEqual(
    insertedText,
    [],
    "catalogue discovery without an open native menu must never type a temporary @"
  );
  popupRows = [octoElement];
  globalThis.document.querySelectorAll = () => [octoElement];
  assert.deepEqual(
    visibleRows(),
    [],
    "Octo must also be excluded from the thumbnail fallback"
  );

  const scopedAsset = {
    getBoundingClientRect: () => ({ height: 52, width: 280 }),
    innerText: "18_测试素材 白色背景 正面展示",
    parentElement: null,
    querySelector: (selector) => selector.includes("img") ? {} : null,
    querySelectorAll: () => [{
      children: [],
      textContent: "18_测试素材 白色背景 正面展示"
    }],
    textContent: "18_测试素材 白色背景 正面展示"
  };
  const pagePromotion = {
    getBoundingClientRect: () => ({ height: 48, width: 260 }),
    innerText: "会员6折",
    parentElement: null,
    querySelector: (selector) => selector.includes("img") ? {} : null,
    querySelectorAll: () => [{ children: [], textContent: "会员6折" }],
    textContent: "会员6折"
  };
  const popupRoot = {
    contains: (element) => element.parentElement === popupRoot,
    getBoundingClientRect: () => ({ height: 460, width: 320 }),
    innerText: "可能@的内容",
    parentElement: null,
    querySelector: (selector) => selector.includes("img") ? {} : null,
    querySelectorAll: (selector) => selector === "div, li, button"
      ? [scopedAsset]
      : [],
    textContent: "可能@的内容"
  };
  const popupMarker = {
    innerText: "可能@的内容",
    parentElement: popupRoot,
    textContent: "可能@的内容"
  };
  scopedAsset.parentElement = popupRoot;
  scopedAsset.closest = () => popupRoot;
  const promotionRoot = {
    contains: (element) => element === pagePromotion,
    innerText: "会员6折",
    textContent: "会员6折"
  };
  pagePromotion.parentElement = promotionRoot;
  pagePromotion.closest = () => promotionRoot;
  globalThis.document = {
    activeElement: { dispatchEvent: () => {} },
    dispatchEvent: () => {},
    querySelectorAll: (selector) => {
      if (selector === "span, p, div, button") return [popupMarker];
      if (selector === "div, li, button") return [scopedAsset, pagePromotion];
      return [pagePromotion, scopedAsset];
    }
  };
  assert.deepEqual(
    visibleRows().map((item) => item.name),
    ["18_测试素材 白色背景 正面展示"],
    "explicit rows outside the current @ popup must be excluded"
  );

  globalThis.document = {
    activeElement: { dispatchEvent: () => {} },
    dispatchEvent: () => {},
    querySelectorAll: (selector) => {
      if (selector === "span, p, div, button") return [popupMarker];
      if (selector === "div, li, button") return [scopedAsset, pagePromotion];
      return [];
    }
  };
  assert.deepEqual(
    visibleRows().map((item) => item.name),
    ["18_测试素材 白色背景 正面展示"],
    "the unlabelled fallback must stay inside the current @ popup"
  );
  console.log("✓ spaced asset names are selected without typing a menu-closing space");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
