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
globalThis.NodeFilter = { SHOW_TEXT: 4 };

function text(value) {
  return {
    nodeType: 3,
    nodeValue: value,
    parentElement: null,
    parentNode: null
  };
}

function matchesSelector(element, selector) {
  return String(selector || "").split(",").some((part) => {
    const value = part.trim();
    if (!value) return false;
    if (value === "img") return element.tagName === "IMG";
    if (value === "[data-mention]") return element.hasAttribute("data-mention");
    if (value === "[data-reference-type]") {
      return element.hasAttribute("data-reference-type");
    }
    if (value.includes('[data-slate-inline="true"]') &&
      element.getAttribute("data-slate-inline") !== "true") {
      return false;
    }
    if (value.includes('[data-slate-void="true"]') &&
      element.getAttribute("data-slate-void") !== "true") {
      return false;
    }
    if (value.includes('[contenteditable="false"]') &&
      element.getAttribute("contenteditable") !== "false") {
      return false;
    }
    if (value.includes('[class*="mention"]') &&
      !String(element.className || "").includes("mention")) {
      return false;
    }
    if (value.includes('[class*="Mention"]') &&
      !String(element.className || "").includes("Mention")) {
      return false;
    }
    if (value.includes('[class*="reference"]') &&
      !String(element.className || "").includes("reference")) {
      return false;
    }
    return /(?:data-slate-inline|data-slate-void|contenteditable|data-mention|data-reference-type|class\*=)/u
      .test(value);
  });
}

function element(tagName, attributes = {}, children = []) {
  const node = {
    alt: attributes.alt || "",
    attributes: { ...attributes },
    childNodes: children,
    className: attributes.class || "",
    nodeType: 1,
    parentElement: null,
    parentNode: null,
    tagName: String(tagName || "div").toUpperCase(),
    contains(target) {
      if (target === this) return true;
      return this.childNodes.some((child) =>
        child === target || child.nodeType === 1 && child.contains(target)
      );
    },
    closest(selector) {
      let current = this;
      while (current) {
        if (current.nodeType === 1 && matchesSelector(current, selector)) return current;
        current = current.parentElement;
      }
      return null;
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name)
        ? this.attributes[name]
        : null;
    },
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name);
    },
    matches(selector) {
      return matchesSelector(this, selector);
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      const result = [];
      const visit = (current) => {
        for (const child of current.childNodes || []) {
          if (child.nodeType !== 1) continue;
          if (matchesSelector(child, selector)) result.push(child);
          visit(child);
        }
      };
      visit(this);
      return result;
    }
  };
  Object.defineProperties(node, {
    innerText: {
      get() {
        return this.childNodes.map((child) =>
          child.nodeType === 3 ? child.nodeValue : child.innerText
        ).join("");
      }
    },
    textContent: {
      get() {
        return this.childNodes.map((child) =>
          child.nodeType === 3 ? child.nodeValue : child.textContent
        ).join("");
      }
    }
  });
  for (const child of children) {
    child.parentElement = node;
    child.parentNode = node;
  }
  return node;
}

function slateBlock(...children) {
  return element("div", { "data-slate-node": "element" }, children);
}

function mention(name, { imageOnly = false } = {}) {
  const children = imageOnly
    ? [element("img", { alt: name })]
    : [text(name)];
  return element("span", {
    contenteditable: "false",
    "data-slate-inline": "true"
  }, children);
}

function editor(...blocks) {
  const root = element("div", {
    contenteditable: "true",
    "data-slate-editor": "true"
  }, blocks);
  root.focus = () => {
    document.activeElement = root;
  };
  return root;
}

function descendants(root) {
  const result = [];
  for (const child of root.childNodes || []) {
    if (child.nodeType === 3) result.push(child);
    else result.push(...descendants(child));
  }
  return result;
}

globalThis.getSelection = () => ({
  addRange() {},
  removeAllRanges() {}
});
globalThis.document = {
  activeElement: null,
  createRange() {
    return {
      collapse() {},
      toString() {
        assert.equal(this.startContainer, this.endContainer);
        return this.startContainer.nodeValue.slice(this.startOffset, this.endOffset);
      },
      getClientRects() { return []; },
      setEnd(node, offset) {
        this.endContainer = node;
        this.endOffset = offset;
      },
      setStart(node, offset) {
        this.startContainer = node;
        this.startOffset = offset;
      }
    };
  },
  createTreeWalker(root) {
    const nodes = descendants(root);
    let index = 0;
    return {
      nextNode() {
        return nodes[index++] || null;
      }
    };
  },
  getElementById: () => null
};

require("../editor.js");
const adapter = globalThis.JimengAssetPlugin.editor;

{
  const current = editor(...Array.from({ length: 150 }, (_, index) =>
    slateBlock(text(`@素材_${index}`), mention(`素材_${index}`), text("。"))));
  const matches = matcher.matchPromptToCandidates(adapter.plainText(current),
    Array.from({ length: 150 }, (_, index) => `素材_${index}`));
  let walks = 0;
  const originalWalker = document.createTreeWalker;
  document.createTreeWalker = (...args) => { walks += 1; return originalWalker(...args); };
  const before = performance.now();
  const individually = matches.filter((match) => adapter.isMatchPaired(current, match));
  const individualMs = performance.now() - before;
  const individualWalks = walks;
  walks = 0;
  const batchStart = performance.now();
  assert.deepEqual(adapter.pairedCandidateMatches(current, matches), individually);
  const batchMs = performance.now() - batchStart;
  assert.equal(walks, 1, "150 pairing checks must share one fresh text map");
  assert.equal(individualWalks, 150);
  assert.equal(individually.length, 150);
  current.childNodes[0].childNodes[1].childNodes[0].nodeValue = "不同素材";
  assert.equal(adapter.pairedCandidateMatches(current, matches).length, 149,
    "a later native label edit must invalidate pairing; no cross-turn DOM cache");
  document.createTreeWalker = originalWalker;
  console.log(`✓ 150-reference pairing: ${individualWalks} → 1 DOM walks; local fixture ${individualMs.toFixed(1)} → ${batchMs.toFixed(1)} ms`);
}

assert.equal(
  typeof adapter.isMatchPaired,
  "function",
  "editor.js must export isMatchPaired(editor, match)"
);
assert.equal(
  typeof adapter.countPairedCandidateMentions,
  "function",
  "editor.js must export countPairedCandidateMentions(editor, matches)"
);

{
  const source = "@素材";
  const current = editor(slateBlock(text(source), mention("素材")));
  assert.equal(adapter.isMatchPaired(current, {
    end: source.length,
    name: "素材",
    start: 0,
    token: source
  }), true, "the original token followed by the same native mention is paired");
}

{
  const firstToken = "@素材";
  const separator = "，再看";
  const secondToken = "@素材";
  const secondStart = firstToken.length + separator.length;
  const current = editor(slateBlock(
    text(firstToken + separator + secondToken),
    mention("素材")
  ));
  const first = {
    end: firstToken.length,
    name: "素材",
    start: 0,
    token: firstToken
  };
  const second = {
    end: secondStart + secondToken.length,
    name: "素材",
    start: secondStart,
    token: secondToken
  };

  assert.equal(
    adapter.isMatchPaired(current, first),
    false,
    "a same-name mention belonging to a later slot must not satisfy the first slot"
  );
  assert.equal(adapter.isMatchPaired(current, second), true);
  assert.equal(
    adapter.countPairedCandidateMentions(current, [first, second]).get("素材"),
    1,
    "only the second of two same-name slots is paired"
  );
}

{
  const source = "@素材";
  const current = editor(slateBlock(text(`${source}。`), mention("素材")));
  assert.equal(adapter.isMatchPaired(current, {
    end: source.length,
    name: "素材",
    start: 0,
    token: source
  }), false, "visible punctuation between the token and mention breaks adjacency");
}

{
  const source = "@图片";
  const current = editor(slateBlock(text(source), mention("图片", { imageOnly: true })));
  assert.equal(adapter.isMatchPaired(current, {
    end: source.length,
    name: "图片",
    start: 0,
    token: source
  }), true, "an image-only native mention can be identified from its img alt");
}

{
  const source = "@带占位";
  const spacer = element("span", {
    "data-slate-spacer": "true",
    "data-slate-length": "0"
  }, [text("\u00a0")]);
  const wrappedMention = element("span", { class: "inline-shell" }, [
    mention("带占位")
  ]);
  const current = editor(slateBlock(text(source), spacer, wrappedMention));
  assert.equal(adapter.isMatchPaired(current, {
    end: source.length,
    name: "带占位",
    start: 0,
    token: source
  }), true, "Slate spacer text and a neutral inline wrapper do not break adjacency");
}

{
  const source = "@无inline属性";
  const voidMention = element("span", {
    contenteditable: "false",
    "data-slate-node": "element",
    "data-slate-void": "true"
  }, [text("无inline属性")]);
  const current = editor(slateBlock(text(source), voidMention));
  assert.equal(adapter.isMatchPaired(current, {
    end: source.length,
    name: "无inline属性",
    start: 0,
    token: source
  }), true, "a Slate void mention without data-slate-inline stays in its paragraph");
}

{
  const source = "@真实空格";
  const current = editor(slateBlock(
    text(source),
    text("\u00a0"),
    mention("真实空格")
  ));
  assert.equal(adapter.isMatchPaired(current, {
    end: source.length,
    name: "真实空格",
    start: 0,
    token: source
  }), false, "a user-visible NBSP outside Slate scaffolding still breaks adjacency");
}

{
  const rect = { left: 100, right: 900, top: 400, bottom: 700, width: 800 };
  const highlights = new Map();
  globalThis.innerWidth = 1200;
  globalThis.CSS = { highlights };
  globalThis.Highlight = class {
    constructor(...ranges) { this.ranges = ranges; }
  };
  document.createElement = () => ({
    style: {}, children: [],
    setAttribute() {},
    appendChild(child) { this.children.push(child); },
    get childElementCount() { return this.children.length; }
  });
  document.documentElement = { appendChild() {} };
  const current = editor(slateBlock(
    text("@人物A"), mention("人物A"), text(" @场景B @场景B @待配对")
  ));
  current.getBoundingClientRect = () => rect;
  const check = (names, expected) => {
    adapter.highlightRemaining(current, names);
    assert.deepEqual(highlights.get("test-highlight").ranges.map((range) => range.toString()), expected);
  };
  check(["人物A", "待配对"], ["@场景B", "@场景B", "@待配对"]);
  check(["人物A", "待配对"], ["@场景B", "@场景B", "@待配对"]);
  check([], ["@场景B", "@场景B", "@待配对"]);

  const spaced = editor(slateBlock(
    text("@角色 正面"), mention("角色 正面"),
    text(" @scene morning"), mention("scene morning"),
    text(" @镜头 跟随"), mention("镜头 跟随"),
    text(" @缺失场景 @缺失场景")
  ));
  spaced.getBoundingClientRect = () => rect;
  for (const names of [[], ["无关素材"], ["角色 正面", "scene morning", "镜头 跟随"]]) {
    adapter.highlightRemaining(spaced, names);
    assert.deepEqual(highlights.get("test-highlight").ranges.map((range) => range.toString()),
      ["@缺失场景", "@缺失场景"],
      "native full filenames must prevent truncated false highlights even with an empty or partial catalogue");
  }
  adapter.highlightReferences(spaced,
    matcher.missingPromptReferences(adapter.plainText(spaced), []), { exactPositions: true });
  assert.deepEqual(highlights.get("test-highlight").ranges.map((range) => range.toString()),
    ["@缺失场景", "@缺失场景"], "the final-pass renderer must also reject paired truncated names");

  const repeated = editor(slateBlock(
    text("@scene morning，"), text("@scene morning"), mention("scene morning")
  ));
  repeated.getBoundingClientRect = () => rect;
  adapter.highlightRemaining(repeated, []);
  assert.deepEqual(highlights.get("test-highlight").ranges.map((range) => range.toString()),
    ["@scene morning"], "a later same-name native chip must not hide the earlier unpaired full filename");

  current.childNodes[0].childNodes[2].nodeValue = "";
  adapter.highlightRemaining(current, ["人物A"]);
  assert.equal(highlights.has("test-highlight"), false);
  assert.equal(globalThis.JimengAssetPlugin.state.highlightActive, false);
}

console.log("✓ native mentions are paired to the exact adjacent plain-text slot; missing highlights survive refresh");

// Exercise the actual editor and UI together: preserved @ text is not an
// unresolved reference when its adjacent native chip already exists.
{
  require("../runtime.js");
  const plugin = globalThis.JimengAssetPlugin;
  require("../ui.js");
  const names = ["角色 正面", "scene morning", "镜头 跟随",
    ...Array.from({ length: 45 }, (_, index) => `素材_${index}`)];
  const current = editor(slateBlock(
    ...names.flatMap((name) => [text(` @${name}`), mention(name)]),
    text(" @未提供的素材_999")
  ));
  current.getBoundingClientRect = () => ({ left: 100, right: 900, top: 400, bottom: 700, width: 800 });
  for (const catalogue of [[], names, names.slice(0, 3)]) {
    plugin.state.candidateNamesSnapshot = catalogue;
    plugin.state.statusContentDirty = true;
    const snapshot = plugin.ui.evaluateMatchStatus(current, { refreshContent: true });
    assert.equal(snapshot.remainingCount, 1, "the toolbar must count only the single absent asset");
    assert.deepEqual(snapshot.remaining.map((item) => item.name), ["未提供的素材_999"]);
    assert.deepEqual(adapter.highlightRemaining(current, catalogue), ["未提供的素材_999"]);
  }

  const handlers = new Map();
  const message = { textContent: "" };
  let sendClicks = 0;
  document.addEventListener = (type, callback) => handlers.set(type, callback);
  document.createElement = () => ({
    addEventListener() {},
    querySelector: (selector) => selector === ".jam-confirm-message" ? message : { focus() {} }
  });
  plugin.editor.findEditor = () => current;
  plugin.canvas = { formFor: () => ({}), sendButton: () => ({ click() { sendClicks += 1; } }) };
  plugin.ui.installSendGuard();
  plugin.state.candidateNamesSnapshot = [];
  handlers.get("keydown")({ key: "Enter", target: current, preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(message.textContent,
    "仍有未匹配引用：@未提供的素材_999\n点击“确认发送”后才会真正提交；Esc 可取消。");
  assert.equal(sendClicks, 0, "opening the confirmation must never submit a generation");

  current.childNodes[0].childNodes.at(-1).nodeValue = "";
  assert.equal(plugin.ui.evaluateMatchStatus(current, { refreshContent: true }).remainingCount, 0);
  console.log("✓ 48 native pairs plus one missing asset agree across highlighting, toolbar and send confirmation");
}
