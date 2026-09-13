const assert = require("assert").strict;
const matcher = require("../matcher.js");

globalThis.JimengAssetMatcher = matcher;
globalThis.JimengAssetPlugin = {};
require("../candidates.js");

const plugin = globalThis.JimengAssetPlugin;
const { insertMention, seekExactVisibleRow } = plugin.candidates;

globalThis.KeyboardEvent = class KeyboardEvent {};
globalThis.Event = class Event {};

let logicalTime = 0;
let waitCalls = [];
let documentRows = [];

function installClock() {
  logicalTime = 0;
  waitCalls = [];
  plugin.sleep = async (duration = 0) => {
    logicalTime += Number(duration) || 0;
  };
  plugin.waitFor = async (check, timeout = 2400, interval = 80) => {
    const call = { elapsed: 0, interval, timeout };
    waitCalls.push(call);
    const attempts = Math.max(Math.ceil(timeout / interval), 1);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const value = check();
      if (value) return value;
      call.elapsed += interval;
      await plugin.sleep(interval);
    }
    return null;
  };
}

function makeMenu({ clientHeight = 320, scrollHeight = 320 } = {}) {
  let scrollTop = 0;
  const menu = {
    clientHeight,
    contains(element) {
      return element === this || element?.parentElement === this;
    },
    dispatchEvent() {},
    getAttribute(name) {
      if (name === "aria-hidden") return "false";
      if (name === "data-state") return "open";
      return null;
    },
    getBoundingClientRect: () => ({
      bottom: clientHeight,
      height: clientHeight,
      left: 0,
      right: 320,
      top: 0,
      width: 320
    }),
    innerText: "可能@的内容",
    matches: (selector) => selector.includes('[role="listbox"]'),
    parentElement: null,
    querySelector: (selector) => selector.includes("img") ? {} : null,
    querySelectorAll: () => documentRows,
    scrollHeight,
    textContent: "可能@的内容"
  };
  Object.defineProperty(menu, "scrollTop", {
    get: () => scrollTop,
    set: (value) => {
      const max = Math.max(menu.scrollHeight - menu.clientHeight, 0);
      scrollTop = Math.max(0, Math.min(Number(value) || 0, max));
    }
  });
  return menu;
}

function makeRow(name, menu, click = () => {}) {
  const label = {
    children: [],
    getAttribute: () => null,
    textContent: name
  };
  return {
    click,
    closest: (selector) => selector.includes("role") ? menu : null,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ height: 40, width: 280 }),
    innerText: name,
    parentElement: menu,
    querySelector: (selector) => selector.includes("img") ? {} : null,
    querySelectorAll: () => [label],
    textContent: name
  };
}

function installDocument(rowsForQuery) {
  documentRows = rowsForQuery();
  globalThis.document = {
    activeElement: { dispatchEvent: () => {} },
    dispatchEvent: () => {},
    querySelectorAll: (selector) => {
      if (selector === "span, p, div, button") return [];
      documentRows = rowsForQuery();
      return documentRows;
    }
  };
}

globalThis.getComputedStyle = (element) => ({
  overflowY: element?._overflowY || "visible"
});
plugin.isVisible = () => true;

async function visibleCandidateHasNoSearchDelay() {
  installClock();
  const name = "123";
  const token = `@${name}`;
  const menu = makeMenu();
  let pickerOpen = false;
  let paired = false;
  let mentionCount = 0;
  let editorText = `前缀${token}后缀`;
  let caretOffset = 0;
  let scrollEvents = 0;
  const insertedValues = [];
  const editor = {
    dispatchEvent: () => {},
    focus: () => {
      document.activeElement = editor;
    }
  };
  const candidate = makeRow(name, menu, () => {
    mentionCount += 1;
    paired = true;
    pickerOpen = false;
    editorText = `前缀${token}后缀`;
  });
  menu.dispatchEvent = () => {
    scrollEvents += 1;
  };

  installDocument(() => pickerOpen ? [candidate] : []);
  plugin.isVisible = (element) => element !== menu || pickerOpen;
  plugin.editor = {
    countExactMentions: () => mentionCount,
    findEditor: () => editor,
    findRangeAt: (_editor, value, start) => (
      editorText.slice(start, start + value.length) === value
        ? { start, token: value }
        : null
    ),
    insertText: (_editor, value) => {
      insertedValues.push(value);
      return true;
    },
    isMatchPaired: () => paired,
    placeCaretAfterMatch: (_editor, match) => {
      caretOffset = match.end;
      return true;
    },
    plainText: () => editorText,
    deleteTextAt: (_editor, token, start) => {
      editorText = editorText.slice(0, start) +
        editorText.slice(start + token.length);
      caretOffset = start;
      return true;
    }
  };
  plugin.nativeTrigger = {
    ensurePicker: async (_editor, options = {}) => {
      const beforeOpen = editorText;
      const positioned = await options.beforeClick?.();
      assert.equal(editorText, beforeOpen);
      if (positioned === false) return false;
      pickerOpen = true;
      return true;
    }
  };

  const start = "前缀".length;
  const result = await insertMention(editor, {
    end: start + token.length,
    name,
    start,
    token
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    insertedValues,
    [],
    "a first-screen exact row must use the native toolbar without typing any text"
  );
  assert.equal(scrollEvents, 0, "a first-screen exact row must not scan the list");
  assert.equal(
    logicalTime <= 120,
    true,
    `a first-screen match used ${logicalTime}ms of logical waiting`
  );
  assert.equal(
    Math.max(...waitCalls.map((call) => call.elapsed), 0) <= 60,
    true,
    "no successful first-screen poll should consume a long timeout"
  );
  console.log(`✓ first-screen exact candidate completes within ${logicalTime}ms logical wait`);
}

async function virtualLastPageUsesOnlyStepSettleTime() {
  installClock();
  plugin.isVisible = () => true;
  const allNames = Array.from(
    { length: 15 },
    (_value, index) => `${String(index + 1).padStart(2, "0")}_素材`
  );
  const menu = makeMenu({ clientHeight: 100, scrollHeight: 300 });
  menu._overflowY = "auto";
  let scrollEvents = 0;
  const rowPool = Array.from({ length: 5 }, () => makeRow("", menu));

  function renderRows() {
    const maxStart = allNames.length - rowPool.length;
    const start = Math.min(Math.floor(menu.scrollTop / 20), maxStart);
    for (let index = 0; index < rowPool.length; index += 1) {
      const name = allNames[start + index] || "";
      const row = rowPool[index];
      row.innerText = name;
      row.textContent = name;
      row.querySelectorAll = () => [{
        children: [],
        getAttribute: () => null,
        textContent: name
      }];
    }
  }

  menu.dispatchEvent = () => {
    scrollEvents += 1;
    renderRows();
  };
  renderRows();
  installDocument(() => rowPool);

  const found = await seekExactVisibleRow(allNames.at(-1), menu);

  assert.equal(found?.name, allNames.at(-1));
  assert.equal(scrollEvents, 3, "the 200px range should need exactly three 78px steps");
  assert.equal(
    logicalTime <= 50,
    true,
    `a synchronously rendered last page used ${logicalTime}ms of logical waiting`
  );
  assert.deepEqual(
    waitCalls,
    [],
    "changed rows must be accepted after the short step settle without extra polling"
  );
  console.log(`✓ virtual last-page lookup uses ${scrollEvents} steps and ${logicalTime}ms logical wait`);
}

async function waitsForMountedContentInsteadOfClipChanges() {
  installClock();
  const allNames = Array.from(
    { length: 15 },
    (_value, index) => `${String(index + 1).padStart(2, "0")}_异步素材`
  );
  const menu = makeMenu({ clientHeight: 100, scrollHeight: 300 });
  menu._overflowY = "auto";
  let renderCountdown = 0;
  let renderedScrollTop = 0;
  let scrollEvents = 0;
  const rowPool = Array.from({ length: 5 }, (_value, slot) => {
    const row = makeRow("", menu);
    row.getBoundingClientRect = () => {
      const top = renderedScrollTop + slot * 20 - menu.scrollTop;
      return {
        bottom: top + 20,
        height: 20,
        left: 0,
        right: 280,
        top,
        width: 280
      };
    };
    return row;
  });

  function renderRows() {
    renderedScrollTop = menu.scrollTop;
    const maxStart = allNames.length - rowPool.length;
    const start = Math.min(Math.floor(menu.scrollTop / 20), maxStart);
    for (let index = 0; index < rowPool.length; index += 1) {
      const name = allNames[start + index] || "";
      const row = rowPool[index];
      row.innerText = name;
      row.textContent = name;
      row.querySelectorAll = () => [{
        children: [],
        getAttribute: () => null,
        textContent: name
      }];
    }
  }

  const clockSleep = plugin.sleep;
  plugin.sleep = async (duration = 0) => {
    await clockSleep(duration);
    if (renderCountdown > 0) {
      renderCountdown -= 1;
      if (!renderCountdown) renderRows();
    }
  };
  menu.dispatchEvent = () => {
    scrollEvents += 1;
    renderCountdown = 2;
  };
  renderRows();
  installDocument(() => rowPool);

  const target = allNames[7];
  const found = await seekExactVisibleRow(target, menu);

  assert.equal(found?.name, target);
  assert.equal(scrollEvents, 1, "the seeker must observe the intermediate rendered page");
  assert.equal(
    waitCalls.some((call) => call.elapsed > 0),
    true,
    "clip geometry alone must not be mistaken for new virtual-row contents"
  );
  console.log("✓ waits for mounted virtual-row contents before advancing again");
}

(async () => {
  await visibleCandidateHasNoSearchDelay();
  await virtualLastPageUsesOnlyStepSettleTime();
  await waitsForMountedContentInsteadOfClipChanges();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
