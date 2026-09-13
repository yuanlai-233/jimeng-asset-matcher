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

function textNode(value) {
  return {
    nodeType: 3,
    nodeValue: value,
    parentElement: null,
    parentNode: null
  };
}

function block(...children) {
  const node = {
    childNodes: children,
    closest: () => null,
    getAttribute(name) {
      return name === "data-slate-node" ? "element" : null;
    },
    nodeType: 1,
    parentElement: null,
    parentNode: null
  };
  for (const child of children) {
    child.parentElement = node;
    child.parentNode = node;
  }
  return node;
}

function descendants(root) {
  const result = [];
  for (const child of root.childNodes || []) {
    if (child.nodeType === 3) result.push(child);
    else result.push(...descendants(child));
  }
  return result;
}

const selection = {
  current: null,
  addRange(range) {
    this.current = range;
  },
  get rangeCount() {
    return this.current ? 1 : 0;
  },
  getRangeAt() {
    return this.current;
  },
  removeAllRanges() {
    this.current = null;
  }
};

function range() {
  return {
    collapse(toStart) {
      if (toStart) {
        this.endContainer = this.startContainer;
        this.endOffset = this.startOffset;
      } else {
        this.startContainer = this.endContainer;
        this.startOffset = this.endOffset;
      }
    },
    setEnd(node, offset) {
      this.endContainer = node;
      this.endOffset = offset;
    },
    setStart(node, offset) {
      this.startContainer = node;
      this.startOffset = offset;
    }
  };
}

let activeEditor = null;
globalThis.getSelection = () => selection;
globalThis.document = {
  activeElement: null,
  createRange: range,
  createTreeWalker(root) {
    const nodes = descendants(root);
    let index = 0;
    return { nextNode: () => nodes[index++] || null };
  },
  execCommand(command) {
    if (command !== "delete" || !selection.current) return false;
    const selected = selection.current;
    if (selected.startContainer !== selected.endContainer) return false;
    const node = selected.startContainer;
    node.nodeValue = node.nodeValue.slice(0, selected.startOffset) +
      node.nodeValue.slice(selected.endOffset);
    return true;
  },
  getElementById: () => null
};

function editor(...blocks) {
  const root = {
    childNodes: blocks,
    contains(target) {
      if (target === this) return true;
      return descendants(this).includes(target) || blocks.includes(target);
    },
    focus() {
      activeEditor = root;
      document.activeElement = root;
    },
    nodeType: 1,
    querySelectorAll: () => []
  };
  for (const child of blocks) {
    child.parentElement = root;
    child.parentNode = root;
  }
  return root;
}

require("../editor.js");
const adapter = globalThis.JimengAssetPlugin.editor;

{
  const token = "@块尾追加素材";
  const first = textNode(`甲${token}`);
  const second = textNode("下一行");
  const current = editor(block(first), block(second));
  assert.equal(adapter.placeCaretAfterMatch(current, {
    end: first.nodeValue.length,
    name: "块尾追加素材",
    start: 1,
    token
  }), true);
  assert.equal(selection.current.startContainer, first);
  assert.equal(selection.current.startOffset, first.nodeValue.length);
  console.log("✓ an appended mention keeps a block-end token's DOM affinity");
}

{
  const first = textNode("甲@跨");
  const second = textNode("块乙");
  const current = editor(block(first), block(second));
  assert.equal(adapter.placeCaretAfterMatch(current, {
    end: 4,
    name: "跨块",
    start: 1,
    token: "@跨块"
  }), false, "a source token spanning Slate blocks must fail closed");
  console.log("✓ a cross-block source token is rejected without mutation");
}

{
  const source = "@原素材";
  const node = textNode(`${source}@后文`);
  const current = editor(block(node));
  assert.equal(adapter.deleteTextAt(current, "@", source.length), true);
  assert.equal(node.nodeValue, `${source}后文`);
  assert.equal(activeEditor, current);
  console.log("✓ trigger cleanup deletes only the appended bare @");
}

{
  const first = textNode("First @sample.");
  const second = textNode("Second @clip.");
  const hardBreak = { nodeType: 1, tagName: "BR", childNodes: [] };
  const paragraph = block(first, hardBreak, second);
  paragraph.tagName = "P";
  const last = textNode("Third @third.");
  const nextParagraph = block(last);
  nextParagraph.tagName = "P";
  const current = editor(paragraph, nextParagraph);
  current.matches = () => true;
  assert.equal(adapter.plainText(current), "First @sample.\nSecond @clip.\nThird @third.\n");
  const matches = matcher.matchPromptToCandidates(adapter.plainText(current), ["sample", "clip", "third"]);
  assert.equal(matches.length, 3);
  for (const match of matches) {
    const range = adapter.findRangeAt(current, match.token, match.start);
    assert.ok(range, "the prompt offsets and DOM map must include the same line separators");
    assert.equal(range.endContainer, { sample: first, clip: second, third: last }[match.name]);
  }
  console.log("✓ ProseMirror paragraph and hard-break separators preserve matching and exact DOM offsets");
}
