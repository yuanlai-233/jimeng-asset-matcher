const assert = require("assert").strict;
const matcher = require("../matcher.js");

globalThis.JimengAssetMatcher = matcher;
globalThis.JimengAssetPlugin = {};
require("../candidates.js");

const plugin = globalThis.JimengAssetPlugin;
const { insertMention } = plugin.candidates;

globalThis.KeyboardEvent = class KeyboardEvent {};
globalThis.Event = class Event {};
globalThis.getComputedStyle = () => ({ overflowY: "hidden" });

const editor = {
  dispatchEvent() {},
  focus() {
    document.activeElement = editor;
  }
};
let editorText = "";
let caretOffset = 0;
let editorMutationCalls = [];
let nativePickerCalls = 0;
let paired = false;
let menuOpen = false;
let menuShellVisible = false;
let menuRows = [];
let editorVisible = true;
let nativePickerAvailable = true;
let nativePickerHook = null;
let beforePositionHook = null;

const menu = {
  contains: (element) => element?.parentElement === menu,
  getAttribute: (name) => name === "aria-hidden" ? "false" : null,
  getBoundingClientRect: () => ({ height: 320, width: 300 }),
  innerText: "可能@的内容",
  parentElement: null,
  querySelector: (selector) => selector.includes("img") ? {} : null,
  querySelectorAll: () => menuRows,
  textContent: "可能@的内容"
};

function row(name, click = () => {}) {
  const label = {
    children: [],
    getAttribute: () => null,
    textContent: name
  };
  const element = {
    click,
    closest: () => menu,
    getAttribute: () => null,
    innerText: name,
    parentElement: menu,
    querySelector: (selector) => selector.includes("img") ? {} : null,
    querySelectorAll: () => [label],
    textContent: name
  };
  element.setName = (nextName) => {
    label.textContent = nextName;
    element.innerText = nextName;
    element.textContent = nextName;
  };
  return element;
}

function installEnvironment(rows = []) {
  menuRows = rows;
  globalThis.document = {
    activeElement: editor,
    contains: (element) => element === editor || element === menu || rows.includes(element),
    querySelectorAll: (selector) => {
      if (selector === "span, p, div, button" || !menuOpen) return [];
      return menuRows;
    }
  };
  Object.assign(plugin, {
    editor: {
      findEditor: () => editor,
      findRangeAt: (_editor, token, start) => (
        editorText.slice(start, start + token.length) === token
          ? { start, token }
          : null
      ),
      insertText: () => {
        editorMutationCalls.push("insertText");
        throw new Error("insertMention must not type a synthetic @ trigger");
      },
      isMatchPaired: () => paired,
      placeCaretAfterMatch: (_editor, match) => {
        caretOffset = match.end;
        return true;
      },
      plainText: () => editorText,
      deleteTextAt: () => {
        editorMutationCalls.push("deleteTextAt");
        throw new Error("insertMention must not clean up text it never inserted");
      }
    },
    nativeTrigger: {
      ensurePicker: async (_editor, options = {}) => {
        nativePickerCalls += 1;
        beforePositionHook?.();
        const sourceBeforeOpen = editorText;
        const positioned = await options.beforeClick?.();
        if (!beforePositionHook) assert.equal(
          editorText,
          sourceBeforeOpen,
          "placing the caret before the native toolbar click must not edit source text"
        );
        if (positioned === false || !nativePickerAvailable) return false;
        nativePickerHook?.();
        menuOpen = true;
        return true;
      }
    },
    isVisible: (element) => {
      if (element === editor) return editorVisible;
      if (element === menu) return menuOpen || menuShellVisible;
      return menuOpen;
    },
    sleep: async () => {},
    waitFor: async (check) => {
      for (let attempt = 0; attempt < 32; attempt += 1) {
        const value = check();
        if (value) return value;
      }
      return null;
    }
  });
}

function reset(token) {
  editorText = `前${token}后`;
  caretOffset = 0;
  editorMutationCalls = [];
  nativePickerCalls = 0;
  paired = false;
  menuOpen = false;
  menuShellVisible = false;
  editorVisible = true;
  nativePickerAvailable = true;
  nativePickerHook = null;
  beforePositionHook = null;
}

async function run() {
  {
    const order = [];
    const originalDispatch = editor.dispatchEvent;
    editor.dispatchEvent = () => order.push("escape");
    editor.closest = () => ({});
    installEnvironment();
    plugin.canvas = {
      cleanupPicker: () => { order.push("cleanup"); return false; },
      pickerIsOpen: () => true
    };
    plugin.candidates.closePicker();
    assert.deepEqual(order, ["cleanup", "escape", "escape"],
      "a still-open native menu must close after cleanup");
    delete plugin.canvas;
    delete editor.closest;
    editor.dispatchEvent = originalDispatch;
    console.log("✓ canvas restores its owned trigger before Escape, without an outside click");
  }
  for (const restores of [true, false]) {
    const token = "@queued restore";
    reset(token);
    const source = editorText;
    let clicks = 0;
    installEnvironment([row("queued restore", () => {
      clicks++; paired = true; menuOpen = false;
    })]);
    beforePositionHook = () => { editorText += "@"; };
    const waitFor = plugin.waitFor;
    plugin.waitFor = async (check, timeout, interval) => {
      if (timeout === 720 && interval === 20 && restores) editorText = source;
      return waitFor(check, timeout, interval);
    };
    const result = await insertMention(editor, {
      name: "queued restore", token, start: 1, end: 1 + token.length
    });
    assert.equal(result.ok, restores);
    assert.equal(editorText, restores ? source : source + "@");
    assert.equal(clicks, restores ? 1 : 0);
    assert.deepEqual(editorMutationCalls, []);
    if (!restores) assert.equal(result.stopRun, true);
    console.log(restores
      ? "✓ queued page text restoration resumes the same reference with one click"
      : "✓ persistent source edits still stop matching before any candidate click");
  }
  {
    const token = "@selection changed";
    reset(token);
    let clicks = 0;
    installEnvironment([row("selection changed", () => { clicks++; })]);
    plugin.editor.verifyNativeSelection = () => false;
    const result = await insertMention(editor, {
      name: "selection changed", token, start: 1, end: 1 + token.length
    });
    assert.equal(result.ok, false);
    assert.equal(result.stopRun, true);
    assert.equal(clicks, 0);
    assert.deepEqual(editorMutationCalls, []);
    console.log("✓ stale internal selection blocks the candidate click without editing source text");
  }
  {
    const token = "@new menu sample";
    reset(token);
    let contentClicks = 0;
    let wrapperClicks = 0;
    const candidate = row("new menu sample", () => { wrapperClicks++; });
    const originalQuery = candidate.querySelector;
    candidate.querySelector = (selector) => selector.includes("option-content-")
      ? { click() { contentClicks++; paired = true; menuOpen = false; } }
      : originalQuery(selector);
    editor.matches = (selector) => selector === ".ProseMirror";
    installEnvironment([candidate]);
    const result = await insertMention(editor, {
      name: "new menu sample", token, start: 1, end: 1 + token.length
    });
    assert.equal(result.ok, true);
    assert.equal(contentClicks, 1);
    assert.equal(wrapperClicks, 0);
    assert.deepEqual(editorMutationCalls, []);
    delete editor.matches;
    console.log("✓ ProseMirror clicks exact inner reference content once without editing the placeholder");
  }
  {
    const token = "@切换期间素材";
    reset(token);
    let activeTask = true;
    installEnvironment([]);
    nativePickerHook = () => {
      activeTask = false;
      editorVisible = false;
    };
    await assert.rejects(
      () => insertMention(editor, {
        end: 1 + token.length,
        name: "切换期间素材",
        start: 1,
        token
      }, {
        assertEditorCurrent: () => {
          if (!activeTask) {
            const error = new Error("当前任务已切换");
            error.code = "EDITOR_CHANGED_DURING_MATCHING";
            throw error;
          }
        }
      }),
      (error) => error?.code === "EDITOR_CHANGED_DURING_MATCHING"
    );
    assert.equal(editorText, `前${token}后`);
    assert.deepEqual(editorMutationCalls, []);
    assert.equal(nativePickerCalls, 1);
    console.log("✓ task switching preserves the original source token");
  }

  {
    const token = "@水瓶\u00a0产品图  4";
    reset(token);
    installEnvironment([]);
    nativePickerAvailable = false;
    const result = await insertMention(editor, {
      end: 1 + token.length,
      name: "水瓶 产品图 4",
      start: 1,
      token
    });
    assert.equal(result.ok, false);
    assert.equal(result.retryable, false);
    assert.equal(editorText, `前${token}后`);
    assert.deepEqual(editorMutationCalls, []);
    assert.equal(nativePickerCalls, 1);
    console.log("✓ a missing native picker leaves the source text untouched");
  }

  {
    const token = "@17_测试昆虫素材 白色背景 正面展示";
    reset(token);
    let clickCount = 0;
    const candidate = row("17_测试昆虫素材 白色背景 正面展示", () => {
      clickCount += 1;
      paired = true;
      menuOpen = false;
      editorText = `前${token}后`;
    });
    installEnvironment([candidate]);
    const result = await insertMention(editor, {
      end: 1 + token.length,
      name: "17_测试昆虫素材 白色背景 正面展示",
      start: 1,
      token
    });
    assert.equal(result.ok, true);
    assert.equal(clickCount, 1);
    assert.equal(editorText, `前${token}后`, "success must preserve the source token");
    assert.deepEqual(editorMutationCalls, []);
    assert.equal(nativePickerCalls, 1);
    console.log("✓ a successful append uses the native toolbar and clicks one exact candidate once");
  }

  {
    const token = "@点击未确认素材";
    reset(token);
    let clickCount = 0;
    const candidate = row("点击未确认素材", () => {
      clickCount += 1;
    });
    installEnvironment([candidate]);
    const result = await insertMention(editor, {
      end: 1 + token.length,
      name: "点击未确认素材",
      start: 1,
      token
    });
    assert.equal(result.ok, false);
    assert.equal(result.retryable, false);
    assert.equal(clickCount, 1, "an uncertain candidate click must never retry");
    assert.equal(editorText, `前${token}后`);
    assert.deepEqual(editorMutationCalls, []);
    console.log("✓ an uncertain click preserves text and is never repeated");
  }

  {
    const token = "@点击后被网页破坏的素材";
    reset(token);
    let clickCount = 0;
    const candidate = row("点击后被网页破坏的素材", () => {
      clickCount += 1;
      menuOpen = false;
      // Reproduce the regression from the recording: the native page click
      // unexpectedly rewrites the explicit source token instead of appending.
      editorText = "前[源引用被破坏]后";
    });
    installEnvironment([candidate]);
    const result = await insertMention(editor, {
      end: 1 + token.length,
      name: "点击后被网页破坏的素材",
      start: 1,
      token
    });
    assert.equal(result.ok, false);
    assert.equal(result.uncertain, true);
    assert.equal(clickCount, 1, "a destructive native click must never be retried");
    assert.equal(editorText, "前[源引用被破坏]后");
    assert.deepEqual(
      editorMutationCalls,
      [],
      "the adapter must stop instead of trying to repair user text with text APIs"
    );
    console.log("✓ a native click that damages the source token is detected and stopped");
  }

  {
    const token = "@虚拟目标素材";
    reset(token);
    let clickCount = 0;
    let guardCalls = 0;
    const candidate = row("虚拟目标素材", () => {
      clickCount += 1;
    });
    installEnvironment([candidate]);
    const result = await insertMention(editor, {
      end: 1 + token.length,
      name: "虚拟目标素材",
      start: 1,
      token
    }, {
      assertEditorCurrent: () => {
        guardCalls += 1;
        if (guardCalls === 6) candidate.setName("虚拟列表回收后的其他素材");
      }
    });
    assert.equal(result.ok, false);
    assert.equal(clickCount, 0, "a recycled row must be revalidated before click");
    assert.equal(editorText, `前${token}后`);
    assert.deepEqual(editorMutationCalls, []);
    console.log("✓ a recycled virtual row cannot be clicked under its old name");
  }

  {
    const firstToken = "@第一素材";
    reset(firstToken);
    const first = row("第一素材", () => {
      paired = true;
      menuOpen = false;
      menuShellVisible = true;
      editorText = `前${firstToken}后`;
    });
    installEnvironment([first]);
    const firstResult = await insertMention(editor, {
      end: 1 + firstToken.length,
      name: "第一素材",
      start: 1,
      token: firstToken
    });
    assert.equal(firstResult.ok, true);
    assert.equal(firstResult.popupClosed, false, "the portal shell remains mounted");

    const secondToken = "@第二素材";
    editorText = `前${secondToken}后`;
    caretOffset = 0;
    editorMutationCalls = [];
    nativePickerCalls = 0;
    paired = false;
    let secondClicks = 0;
    const second = row("第二素材", () => {
      secondClicks += 1;
      paired = true;
      menuOpen = false;
      menuShellVisible = true;
      editorText = `前${secondToken}后`;
    });
    menuRows = [second];
    const secondResult = await insertMention(editor, {
      end: 1 + secondToken.length,
      name: "第二素材",
      start: 1,
      token: secondToken
    });
    assert.equal(secondResult.ok, true);
    assert.equal(secondClicks, 1);
    assert.deepEqual(editorMutationCalls, []);
    assert.equal(nativePickerCalls, 1);
    console.log("✓ an empty persistent portal shell does not block the next slot");
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
