const assert = require("assert").strict;

let editorFocused = false;
let pickerOpen = false;
let historicalClicks = 0;
let canvasClicks = 0;
let pagerClicks = 0;
let unmountAtUntilPager = false;
let toolbarRevealed = false;
let anonymousPagerMode = false;
let anonymousSendClicks = 0;
let sharedIsolationMode = false;
let sharedToolbarRevealed = false;
let sharedHistoricalClicks = 0;
let sharedCurrentClicks = 0;
let sharedPagerClicks = 0;
const promptMutations = [];

function rect(left, top, width = 40, height = 40) {
  return { bottom: top + height, height, left, right: left + width, top, width };
}

function node(bounds, {
  ariaLabel = null,
  click = () => {},
  text = ""
} = {}) {
  return {
    className: "",
    click,
    contains: () => false,
    getAttribute: (name) => name === "aria-label" ? ariaLabel : null,
    getBoundingClientRect: () => bounds,
    id: "",
    innerText: text,
    parentElement: null,
    querySelector: () => null,
    textContent: text
  };
}

// Infinite Canvas renders the prompt as a narrow floating card. Its native
// toolbar is horizontally paged: the @ control remains mounted to the right,
// outside the editor's initial toolbar viewport, until that toolbar is
// revealed. The extension must not require the user to press the right-arrow
// paging control first.
const editor = {
  focus() {
    editorFocused = true;
  },
  getBoundingClientRect: () => rect(500, 900, 720, 360),
  parentElement: null
};
const composer = {
  contains: (element) => element === editor || element === canvasAt ||
    element === pager || element === anonymousPager || element === anonymousSend,
  parentElement: null
};
editor.parentElement = composer;

const historicalAt = node(rect(140, 180), {
  click: () => { historicalClicks += 1; },
  text: "@"
});
const canvasAt = node(rect(1300, 1210), {
  click: () => {
    canvasClicks += 1;
    pickerOpen = true;
  },
  text: "@"
});
canvasAt.parentElement = composer;
const pager = node(rect(1160, 1210), {
  ariaLabel: "下一页 right pager",
  click: () => {
    pagerClicks += 1;
    toolbarRevealed = true;
  }
});
pager.parentElement = composer;
const anonymousPager = node(rect(1160, 1210), {
  click: () => {
    pagerClicks += 1;
    toolbarRevealed = true;
  }
});
anonymousPager.parentElement = composer;
const chevronPath = {
  getPointAtLength: (distance) => distance <= 0
    ? { x: 0, y: 0 }
    : distance >= 12
      ? { x: 0, y: 12 }
      : { x: 6, y: 6 },
  getTotalLength: () => 12
};
anonymousPager.querySelectorAll = () => [chevronPath];
const anonymousSend = node(rect(1210, 1210), {
  click: () => { anonymousSendClicks += 1; }
});
anonymousSend.parentElement = composer;
const rotatedUpPath = {
  getPointAtLength: chevronPath.getPointAtLength,
  getScreenCTM: () => ({ a: 0, b: -1, c: 1, d: 0, e: 0, f: 12 }),
  getTotalLength: () => 12
};
anonymousSend.querySelectorAll = () => [rotatedUpPath];

const popup = {};
const rowElement = {
  closest: () => popup,
  parentElement: null
};

const sharedEditor = {
  focus() {},
  getBoundingClientRect: () => rect(500, 900, 720, 360),
  parentElement: null
};
const sharedCanvasRoot = {
  contains: (element) => [
    sharedEditor,
    sharedCurrentAt,
    sharedPager,
    sharedHistoricalAt
  ].includes(element),
  getBoundingClientRect: () => rect(400, 700, 820, 520),
  parentElement: null
};
const sharedCurrentComposer = {
  contains: (element) => [sharedEditor, sharedCurrentAt, sharedPager].includes(element),
  parentElement: sharedCanvasRoot
};
const sharedHistoricalComposer = {
  contains: (element) => element === sharedHistoricalAt,
  parentElement: sharedCanvasRoot
};
sharedEditor.parentElement = sharedCurrentComposer;
const sharedHistoricalAt = node(rect(520, 1210), {
  click: () => { sharedHistoricalClicks += 1; },
  text: "@"
});
sharedHistoricalAt.parentElement = sharedHistoricalComposer;
const sharedCurrentAt = node(rect(1300, 1210), {
  click: () => {
    sharedCurrentClicks += 1;
    pickerOpen = true;
  },
  text: "@"
});
sharedCurrentAt.parentElement = sharedCurrentComposer;
const sharedPager = node(rect(1160, 1210), {
  ariaLabel: "下一页 right pager",
  click: () => {
    sharedPagerClicks += 1;
    sharedToolbarRevealed = true;
  }
});
sharedPager.parentElement = sharedCurrentComposer;

globalThis.document = {
  querySelectorAll: (selector) => {
    if (selector === "svg path[d]" || selector === "span, div") return [];
    if (sharedIsolationMode) {
      return sharedToolbarRevealed
        ? [sharedHistoricalAt, sharedCurrentAt, sharedPager]
        : [sharedHistoricalAt, sharedPager];
    }
    if (unmountAtUntilPager && !toolbarRevealed) {
      return anonymousPagerMode
        ? [historicalAt, anonymousPager, anonymousSend]
        : [historicalAt, pager];
    }
    return [historicalAt, canvasAt, pager];
  }
};
globalThis.JimengAssetMatcher = {
  normalizeText: (value) => String(value || "").trim()
};
globalThis.JimengAssetPlugin = {
  candidates: {
    visibleRows: () => pickerOpen
      ? [{ element: rowElement, name: "当前画布素材" }]
      : []
  },
  constants: { buttonId: "jimeng-asset-match-button" },
  isVisible: () => true,
  sleep: async () => {},
  waitFor: async (check) => check()
};

require("../native-trigger.js");

(async () => {
  const opened = await globalThis.JimengAssetPlugin.nativeTrigger.ensurePicker(
    editor,
    {
      beforeClick: () => {
        assert.equal(editorFocused, true);
        // The production caret callback is allowed to change Selection only;
        // it must never type a temporary @ or otherwise mutate source text.
        assert.deepEqual(promptMutations, []);
        return true;
      },
      requireFresh: true
    }
  );

  assert.equal(
    opened,
    true,
    "Infinite Canvas matching must open the current card's @ picker even when the toolbar initially clips that control"
  );
  assert.equal(canvasClicks, 1);
  assert.equal(historicalClicks, 0);
  assert.deepEqual(promptMutations, []);
  console.log("✓ reveals the Infinite Canvas toolbar and opens its native @ picker");

  // Some builds unmount the clipped item. Only the explicit right/next pager
  // in the same composer may be clicked to reveal it.
  pickerOpen = false;
  unmountAtUntilPager = true;
  toolbarRevealed = false;
  const reopened = await globalThis.JimengAssetPlugin.nativeTrigger.ensurePicker(
    editor,
    { beforeClick: () => true, requireFresh: true }
  );
  assert.equal(reopened, true);
  assert.equal(pagerClicks, 1);
  assert.equal(canvasClicks, 2);
  assert.equal(historicalClicks, 0);
  assert.deepEqual(promptMutations, []);
  console.log("✓ pages an unmounted Infinite Canvas @ control into view safely");

  pickerOpen = false;
  toolbarRevealed = false;
  anonymousPagerMode = true;
  const reopenedFromIcon = await globalThis.JimengAssetPlugin.nativeTrigger
    .ensurePicker(editor, { beforeClick: () => true, requireFresh: true });
  assert.equal(reopenedFromIcon, true);
  assert.equal(pagerClicks, 2);
  assert.equal(canvasClicks, 3);
  assert.equal(historicalClicks, 0);
  assert.equal(anonymousSendClicks, 0);
  console.log("✓ recognizes an unlabeled pager without mistaking a rotated send arrow");

  // Multiple prompt cards may share a compact canvas-stage ancestor. That
  // shared root is not ownership: while the current card's @ is unmounted,
  // the matcher must page the current card instead of clicking a historical
  // card's still-visible @ control.
  pickerOpen = false;
  toolbarRevealed = false;
  anonymousPagerMode = false;
  const historicalClicksBeforeSharedRoot = historicalClicks;
  const canvasClicksBeforeSharedRoot = canvasClicks;
  const pagerClicksBeforeSharedRoot = pagerClicks;
  const sharedCanvasRoot = {
    contains: (element) => [editor, canvasAt, pager, historicalAt].includes(element),
    getBoundingClientRect: () => rect(400, 700, 820, 520),
    parentElement: null
  };
  const historicalComposer = {
    contains: (element) => element === historicalAt,
    getBoundingClientRect: () => rect(100, 120, 420, 260),
    parentElement: sharedCanvasRoot
  };
  composer.parentElement = sharedCanvasRoot;
  historicalAt.parentElement = historicalComposer;

  const sharedRootOpened = await globalThis.JimengAssetPlugin.nativeTrigger.ensurePicker(
    editor,
    { beforeClick: () => true, requireFresh: true }
  );
  assert.equal(
    sharedRootOpened,
    true,
    "a shared compact canvas root must not make a historical card's @ belong to the current editor"
  );
  assert.equal(
    historicalClicks,
    historicalClicksBeforeSharedRoot,
    "the historical card's @ must never be clicked"
  );
  assert.equal(pagerClicks, pagerClicksBeforeSharedRoot + 1);
  assert.equal(canvasClicks, canvasClicksBeforeSharedRoot + 1);
  console.log("✓ isolates the current composer inside a shared Infinite Canvas root");

  // Repeat the ownership case on a fresh editor with no trusted-scope cache;
  // place the historical @ inside the same toolbar geometry band so geometry
  // alone cannot rescue an incorrect global choice.
  pickerOpen = false;
  sharedIsolationMode = true;
  sharedToolbarRevealed = false;
  const freshSharedRootOpened = await globalThis.JimengAssetPlugin.nativeTrigger
    .ensurePicker(sharedEditor, { beforeClick: () => true, requireFresh: true });
  assert.equal(freshSharedRootOpened, true);
  assert.equal(sharedHistoricalClicks, 0);
  assert.equal(sharedPagerClicks, 1);
  assert.equal(sharedCurrentClicks, 1);
  console.log("✓ rejects a nearby historical @ before a fresh canvas scope is trusted");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
