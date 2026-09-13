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

function makeRange() {
  return {
    collapse(value) {
      this.collapsed = value;
      if (value) {
        this.endContainer = this.startContainer;
        this.endOffset = this.startOffset;
      } else {
        this.startContainer = this.endContainer;
        this.startOffset = this.endOffset;
      }
    },
    selectNodeContents(node) {
      this.startContainer = node;
      this.startOffset = 0;
      this.endContainer = node;
      this.endOffset = node.nodeValue?.length || 0;
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

const selection = {
  range: null,
  get rangeCount() {
    return this.range ? 1 : 0;
  },
  addRange(range) {
    this.range = range;
  },
  getRangeAt() {
    return this.range;
  },
  removeAllRanges() {
    this.range = null;
  }
};

const text = {
  nodeType: 3,
  nodeValue: "前缀@素材后缀",
  parentElement: null,
  parentNode: null
};

const block = {
  childNodes: [text],
  closest() {
    return null;
  },
  getAttribute(name) {
    return name === "data-slate-node" ? "element" : null;
  },
  nodeType: 1,
  parentElement: null,
  parentNode: null
};
text.parentElement = block;
text.parentNode = block;

let focusCalls = 0;
const editor = {
  childNodes: [block],
  contains(node) {
    return node === this || node === block || node === text;
  },
  focus() {
    focusCalls += 1;
    document.activeElement = this;

    // Dreamina's Slate editor may reconcile its selection when focus() is
    // called again. Model the observed failure by moving the caret to the
    // end, even when the editor was already focused.
    const range = makeRange();
    range.setStart(text, text.nodeValue.length);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  },
  nodeType: 1
};
block.parentElement = editor;
block.parentNode = editor;

globalThis.getSelection = () => selection;
globalThis.document = {
  activeElement: null,
  createRange: makeRange,
  createTextNode(value) {
    return {
      nodeType: 3,
      nodeValue: value,
      parentElement: null,
      parentNode: null
    };
  },
  createTreeWalker() {
    let returned = false;
    return {
      nextNode() {
        if (returned) return null;
        returned = true;
        return text;
      }
    };
  },
  execCommand(command, _showUi, value) {
    if (command !== "insertText" || !selection.range) return false;
    const range = selection.getRangeAt(0);
    const offset = range.startOffset;
    text.nodeValue = text.nodeValue.slice(0, offset) + value +
      text.nodeValue.slice(offset);

    const afterInsert = makeRange();
    afterInsert.setStart(text, offset + value.length);
    afterInsert.collapse(true);
    selection.removeAllRanges();
    selection.addRange(afterInsert);
    return true;
  }
};

require("../editor.js");
const adapter = globalThis.JimengAssetPlugin.editor;

assert.equal(adapter.placeCaretAfterMatch(editor, {
  end: "前缀@素材".length,
  name: "素材",
  start: "前缀".length,
  token: "@素材"
}), true);
adapter.insertText(editor, "@");

assert.equal(
  text.nodeValue,
  "前缀@素材@后缀",
  "the native @ trigger must be appended after the preserved source token"
);
assert.equal(
  focusCalls,
  1,
  "insertText must not refocus an already-active editor and reset its Slate selection"
);
document.activeElement = null;
assert.equal(adapter.insertText(editor, "x"), false);
assert.equal(text.nodeValue, "前缀@素材@后缀", "lost focus must fail instead of appending");
assert.equal(focusCalls, 1, "insertText must never recover by refocusing Slate");

console.log("✓ the native @ trigger keeps its caret instead of appending");
