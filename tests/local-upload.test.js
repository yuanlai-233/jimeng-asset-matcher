const assert = require("assert").strict;
require("../media-files.js");

class FakeFile {
  constructor(name, { size = 128, type = "image/png" } = {}) {
    this.name = name;
    this.size = size;
    this.type = type;
  }
}

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    Object.assign(this, init);
  }
}

class FakeDataTransfer {
  constructor() {
    const files = [];
    this.items = { add: (file) => files.push(file) };
    this.files = files;
  }
}

class FakeHTMLInputElement {
  constructor({ accept = "", context = "", multiple = false } = {}) {
    this.accept = accept;
    this.className = "";
    this.disabled = false;
    this.dispatched = [];
    this.isConnected = true;
    this.multiple = multiple;
    this.parentElement = context ? {
      className: "",
      getAttribute: () => null,
      innerText: context,
      parentElement: null,
      textContent: context
    } : null;
    this.type = "file";
    this.value = "";
    this.webkitdirectory = false;
    this._files = [];
  }

  dispatchEvent(event) {
    this.dispatched.push(event);
    return true;
  }

  getAttribute(name) {
    if (name === "accept") return this.accept;
    if (name === "aria-disabled") return null;
    return null;
  }
}

Object.defineProperty(FakeHTMLInputElement.prototype, "files", {
  configurable: true,
  get() { return this._files; },
  set(files) { this._files = Array.from(files); }
});

globalThis.File = FakeFile;
globalThis.DataTransfer = FakeDataTransfer;
globalThis.Event = FakeEvent;
globalThis.HTMLInputElement = FakeHTMLInputElement;
globalThis.JimengAssetPlugin = { sleep: async () => {} };

require("../local-upload.js");
const adapter = globalThis.JimengAssetPlugin.localUpload;

function image(name, options) {
  return new FakeFile(name, options);
}

function state(overrides = {}) {
  return {
    assetLabelCount: 0,
    errorCount: 0,
    itemCount: 0,
    loadingCount: 0,
    previewCount: 0,
    successCount: 0,
    uploadBusyCount: 0,
    ...overrides
  };
}

function domNode(parentElement = null, { className = "", id = "" } = {}) {
  return {
    className,
    closest: () => null,
    contains(target) {
      let node = target;
      while (node) {
        if (node === this) return true;
        node = node.parentElement;
      }
      return false;
    },
    getAttribute: () => null,
    hidden: false,
    id,
    innerText: "",
    parentElement,
    textContent: ""
  };
}

async function testSelectsTheNativeMaterialInput() {
  const profile = new FakeHTMLInputElement({
    accept: "image/*",
    context: "更换头像 avatar profile",
    multiple: true
  });
  const video = new FakeHTMLInputElement({
    accept: "video/mp4",
    context: "上传视频",
    multiple: true
  });
  const material = new FakeHTMLInputElement({
    accept: ".jpg,.jpeg,.png,.webp",
    context: "上传参考素材 reference asset",
    multiple: true
  });
  const document = { querySelectorAll: () => [profile, video, material] };

  assert.equal(
    adapter.findUploadInput([image("场景.png"), image("人物.jpg", { type: "image/jpeg" })], { document }),
    material
  );
  console.log("✓ selects a compatible material input and rejects video/profile inputs");
}

async function testFailsOnAmbiguousInputs() {
  const first = new FakeHTMLInputElement({ accept: "image/*", context: "上传素材", multiple: true });
  const second = new FakeHTMLInputElement({ accept: "image/*", context: "上传素材", multiple: true });
  const document = { querySelectorAll: () => [first, second] };

  assert.throws(
    () => adapter.findUploadInput([image("场景.png")], { document }),
    (error) => error.code === "AMBIGUOUS_UPLOAD_INPUT"
  );
  console.log("✓ fails closed when two upload inputs are equally plausible");
}

async function testPrefersOmniReferenceOverFrameInputs() {
  const omni = new FakeHTMLInputElement({
    accept: "image/png,image/jpeg,video/mp4",
    context: "全能参考 上传素材",
    multiple: true
  });
  const firstFrame = new FakeHTMLInputElement({
    accept: "image/*",
    context: "首帧图片",
    multiple: true
  });
  const sharedModal = {
    className: "",
    getAttribute: () => null,
    innerText: "上传图片 首帧 尾帧",
    parentElement: null,
    textContent: "上传图片 首帧 尾帧"
  };
  omni.parentElement.parentElement = sharedModal;
  firstFrame.parentElement.parentElement = sharedModal;
  const document = { querySelectorAll: () => [firstFrame, omni] };
  assert.equal(
    adapter.findUploadInput([image("场景.png")], { document }),
    omni
  );
  console.log("✓ prefers a multimodal omni-reference input over first/last-frame inputs");
}

async function testInjectsBatchAndWaitsForStableDom() {
  const files = [image("场景.png"), image("人物.jpg", { type: "image/jpeg" })];
  const input = new FakeHTMLInputElement({ accept: "image/*", context: "上传素材", multiple: true });
  let clock = 0;
  let calls = 0;
  const snapshots = [
    state(),
    state({ loadingCount: 1 }),
    state({ itemCount: 2, previewCount: 2 }),
    state({ itemCount: 2, previewCount: 2 }),
    state({ itemCount: 2, previewCount: 2 }),
    state({ itemCount: 2, previewCount: 2 })
  ];
  const snapshot = () => snapshots[Math.min(calls++, snapshots.length - 1)];
  let dispatchedNotice = null;

  const result = await adapter.uploadFiles(files, {
    Event: FakeEvent,
    DataTransfer: FakeDataTransfer,
    HTMLInputElement: FakeHTMLInputElement,
    input,
    interval: 100,
    now: () => clock,
    onFilesDispatched: (details) => { dispatchedNotice = details; },
    sleep: async (milliseconds) => { clock += milliseconds; },
    snapshot,
    stableMs: 200,
    timeout: 2000
  });

  assert.deepEqual(input.files, files);
  assert.deepEqual(input.dispatched.map((event) => event.type), ["input", "change"]);
  assert.equal(input.dispatched.every((event) => event.bubbles && event.composed), true);
  assert.deepEqual(dispatchedNotice, { count: 2, input });
  assert.equal(result.count, 2);
  assert.equal(result.after.previewCount, 2);
  console.log("✓ injects a complete batch and waits until upload DOM evidence is stable");
}

async function testRejectsUnsupportedOrUnsafeBatches() {
  assert.throws(
    () => adapter.normalizeFiles([image("脚本.exe", { type: "application/octet-stream" })]),
    (error) => error.code === "UNSUPPORTED_FILE"
  );

  const singleOnly = new FakeHTMLInputElement({ accept: "image/*", context: "上传素材" });
  assert.throws(
    () => adapter.findUploadInput([image("一.png"), image("二.png")], {
      document: { querySelectorAll: () => [singleOnly] }
    }),
    (error) => error.code === "UPLOAD_INPUT_NOT_FOUND"
  );
  assert.throws(
    () => adapter.normalizeFiles(Array.from({ length: 51 }, (_, index) => image(`超过上限${index}.png`))),
    (error) => error.code === "TOO_MANY_FILES" && /50/.test(error.message)
  );
  console.log("✓ rejects unsupported files and refuses a multi-file batch on a single-file input");
}

async function testMixedBatchAndImageDecoder() {
  const files = [image("card.png"), image("clip.mp4", { type: "video/mp4" }),
    image("sound.wav", { type: "audio/wav" })];
  const input = new FakeHTMLInputElement({ accept: "image/*,video/*,audio/*", context: "上传素材", multiple: true });
  let clock = 0;
  const decoded = [];
  await adapter.uploadFiles(files, {
    input, Event: FakeEvent, DataTransfer: FakeDataTransfer, HTMLInputElement: FakeHTMLInputElement,
    createImageBitmap: async file => { decoded.push(file.name); return { close() {} }; },
    now: () => clock, sleep: async ms => { clock += ms; }, interval: 100, stableMs: 100,
    snapshot: () => state({ itemCount: input.files.length, previewCount: input.files.length })
  });
  assert.deepEqual(input.files, files);
  assert.deepEqual(decoded, ["card.png"], "video/audio files must not be passed to the image decoder");
  const imageOnly = new FakeHTMLInputElement({ accept: "image/*", context: "上传素材", multiple: true });
  await assert.rejects(() => adapter.uploadFiles(files, { input: imageOnly }), error => error.code === "INCOMPATIBLE_UPLOAD_INPUT");
  assert.deepEqual(imageOnly.files, []);

  clock = 0;
  let calls = 0;
  const result = await adapter.waitForUploadStable(state({ canvasMaterials: 3, canvasImages: 1 }), 3, {
    now: () => clock, sleep: async ms => { clock += ms; }, interval: 100, stableMs: 100,
    snapshot: () => state({ canvasMaterials: ++calls < 4 ? 5 : 6, canvasImages: 2, itemCount: 100 })
  });
  assert.equal(result.canvasMaterials, 6);
  assert.equal(result.canvasImages, 2, "one image plus video/audio must confirm as three materials");
  console.log("✓ mixed upload delivers all media, decodes only images, rejects image-only inputs and counts canvas media separately");
}

async function testDoesNotTreatFileAssignmentAsUploadSuccess() {
  let clock = 0;
  const unchanged = state();
  await assert.rejects(
    () => adapter.waitForUploadStable(unchanged, 1, {
      interval: 100,
      now: () => clock,
      sleep: async (milliseconds) => { clock += milliseconds; },
      snapshot: () => unchanged,
      timeout: 200
    }),
    (error) => error.code === "UPLOAD_NOT_CONFIRMED"
  );
  console.log("✓ requires page-side completion evidence instead of trusting FileList assignment");
}

async function testCompletionUsesDeltaInsteadOfAbsoluteCount() {
  let clock = 0;
  let calls = 0;
  const before = state({ itemCount: 20, previewCount: 20 });
  const snapshots = [
    state({ itemCount: 22, previewCount: 22 }),
    state({ itemCount: 23, previewCount: 23 }),
    state({ itemCount: 23, previewCount: 23 }),
    state({ itemCount: 23, previewCount: 23 })
  ];
  const after = await adapter.waitForUploadStable(before, 3, {
    interval: 100,
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    snapshot: () => snapshots[Math.min(calls++, snapshots.length - 1)],
    stableMs: 200,
    timeout: 1000
  });

  assert.equal(after.previewCount, 23);
  assert.ok(calls >= 4, "a partial +2 increase must not complete a three-file upload");
  console.log("✓ confirms a batch from the before/after delta, not the existing absolute count");
}

async function testAcceptsAnIdleAggregateBatchProvisionally() {
  let clock = 0;
  let calls = 0;
  const snapshots = [
    state({
      itemCount: 1,
      loadingCount: 4,
      previewCount: 1,
      uploadBusyCount: 1
    }),
    state({
      itemCount: 1,
      loadingCount: 4,
      previewCount: 1,
      uploadBusyCount: 0
    }),
    state({
      itemCount: 1,
      loadingCount: 5,
      previewCount: 1,
      uploadBusyCount: 0
    }),
    state({
      itemCount: 1,
      loadingCount: 5,
      previewCount: 1,
      uploadBusyCount: 0
    }),
    state({
      itemCount: 1,
      loadingCount: 5,
      previewCount: 1,
      uploadBusyCount: 0
    })
  ];
  const after = await adapter.waitForUploadStable(state(), 29, {
    interval: 100,
    now: () => clock,
    provisionalStableMs: 200,
    sleep: async (milliseconds) => { clock += milliseconds; },
    snapshot: () => snapshots[Math.min(calls++, snapshots.length - 1)],
    timeout: 2000
  });

  assert.equal(after.acceptanceKind, "provisional");
  assert.equal(after.previewCount, 1);
  assert.ok(clock < 1000, "an idle aggregate card must not wait near the 30-second fallback");
  console.log("✓ provisionally accepts one aggregate card after its own spinner disappears");
}

async function testAcceptsAnAggregateCardWhenSynchronousBusyWasMissed() {
  let clock = 0;
  const after = await adapter.waitForUploadStable(state(), 29, {
    idleAggregateStableMs: 200,
    interval: 100,
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    snapshot: () => state({ itemCount: 1, previewCount: 1 }),
    timeout: 1200
  });

  assert.equal(after.acceptanceKind, "provisional");
  assert.equal(after.acceptanceReason, "idle-aggregate-card");
  assert.ok(clock < 800, "an already-idle aggregate card must not wait near timeout");
  console.log("✓ accepts an idle aggregate card when its synchronous spinner was missed");
}

async function testDoesNotAcceptAnAggregateWhileItsSpinnerIsBusy() {
  let clock = 0;
  await assert.rejects(
    () => adapter.waitForUploadStable(state(), 29, {
      interval: 100,
      now: () => clock,
      provisionalStableMs: 200,
      sleep: async (milliseconds) => { clock += milliseconds; },
      snapshot: () => state({
        itemCount: 1,
        loadingCount: 1,
        previewCount: 1,
        uploadBusyCount: 1
      }),
      timeout: 400
    }),
    (error) => error.code === "UPLOAD_NOT_CONFIRMED"
  );
  console.log("✓ keeps waiting while the aggregate batch's own spinner is active");
}

async function testStopsOnPageUploadError() {
  let clock = 0;
  await assert.rejects(
    () => adapter.waitForUploadStable(state(), 1, {
      interval: 50,
      now: () => clock,
      sleep: async (milliseconds) => { clock += milliseconds; },
      snapshot: () => state({ errorCount: 1 }),
      timeout: 500
    }),
    (error) => error.code === "UPLOAD_REJECTED"
  );
  console.log("✓ stops immediately when Dreamina reports an upload error");
}

async function testReadsNativeParenthesizedUploadCount() {
  const snapshot = adapter.captureUploadState({
    observationRoot: {
      innerText: "全部（23）",
      querySelectorAll: () => [],
      textContent: "全部（23）"
    }
  });
  assert.equal(snapshot.assetLabelCount, 23);
  console.log("✓ reads native 全部（N） upload totals as completion evidence");
}

async function testScopesBusyStateToTheUploadCard() {
  const root = domNode();
  const genericPanel = domNode(root, { className: "generic-panel" });
  const uploadCard = domNode(genericPanel, { className: "upload-item-card" });
  const preview = domNode(uploadCard);
  const uploadSpinner = domNode(uploadCard);
  // This loader shares the same generic composer/panel, but it is not inside
  // the upload card and must never become this batch's busy signal.
  const unrelatedSpinner = domNode(genericPanel);
  const observationRoot = {
    ...root,
    innerText: "页面其他区域处理中",
    querySelectorAll(selector) {
      if (selector === 'img[src^="blob:"]') return [preview];
      if (selector === '[class*="upload-item"]') return [uploadCard];
      if (selector === '[role="progressbar"]') {
        return [uploadSpinner, unrelatedSpinner];
      }
      return [];
    },
    textContent: "页面其他区域处理中"
  };
  genericPanel.parentElement = observationRoot;

  const snapshot = adapter.captureUploadState({ observationRoot });
  assert.ok(snapshot.loadingCount > snapshot.uploadBusyCount);
  assert.equal(snapshot.uploadBusyCount, 1);
  console.log("✓ ignores unrelated page loaders when tracking the uploaded batch spinner");
}

function observerHarness() {
  const instances = [];
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.disconnectCalls = 0;
      this.observeCalls = 0;
      instances.push(this);
    }

    disconnect() {
      this.disconnectCalls += 1;
    }

    observe() {
      this.observeCalls += 1;
    }
  }
  return { FakeMutationObserver, instances };
}

async function testDisconnectsUploadObserverOnEveryExit() {
  const root = { querySelectorAll: () => [] };

  {
    const { FakeMutationObserver, instances } = observerHarness();
    let clock = 0;
    await adapter.waitForUploadStable(state(), 1, {
      MutationObserver: FakeMutationObserver,
      interval: 100,
      now: () => clock,
      observationRoot: root,
      sleep: async (milliseconds) => { clock += milliseconds; },
      snapshot: () => state({ itemCount: 1, previewCount: 1 }),
      stableMs: 100,
      timeout: 500
    });
    assert.equal(instances[0].observeCalls, 1);
    assert.equal(instances[0].disconnectCalls, 1);
  }

  {
    const { FakeMutationObserver, instances } = observerHarness();
    let clock = 0;
    await assert.rejects(
      () => adapter.waitForUploadStable(state(), 1, {
        MutationObserver: FakeMutationObserver,
        interval: 50,
        now: () => clock,
        observationRoot: root,
        sleep: async (milliseconds) => { clock += milliseconds; },
        snapshot: () => state({ errorCount: 1 }),
        timeout: 200
      }),
      (error) => error.code === "UPLOAD_REJECTED"
    );
    assert.equal(instances[0].disconnectCalls, 1);
  }

  {
    const { FakeMutationObserver, instances } = observerHarness();
    let clock = 0;
    await assert.rejects(
      () => adapter.waitForUploadStable(state(), 1, {
        MutationObserver: FakeMutationObserver,
        interval: 50,
        now: () => clock,
        observationRoot: root,
        sleep: async (milliseconds) => { clock += milliseconds; },
        snapshot: () => state(),
        timeout: 100
      }),
      (error) => error.code === "UPLOAD_NOT_CONFIRMED"
    );
    assert.equal(instances[0].disconnectCalls, 1);
  }
  console.log("✓ disconnects the upload MutationObserver on success, error, and timeout");
}

async function testInstallsObserverBeforeDispatchingFileEvents() {
  const files = [image("批次.png")];
  const input = new FakeHTMLInputElement({
    accept: "image/*",
    context: "上传素材",
    multiple: true
  });
  const observationRoot = { querySelectorAll: () => [] };
  let observerInstalled = false;
  class OrderedObserver {
    constructor() {}
    disconnect() {}
    observe() {
      observerInstalled = true;
    }
  }
  const originalDispatch = input.dispatchEvent.bind(input);
  input.dispatchEvent = (event) => {
    assert.equal(observerInstalled, true, "observer must exist before input/change");
    return originalDispatch(event);
  };
  let clock = 0;
  let calls = 0;
  const snapshots = [
    state(),
    state({ itemCount: 1, previewCount: 1 }),
    state({ itemCount: 1, previewCount: 1 }),
    state({ itemCount: 1, previewCount: 1 })
  ];

  await adapter.uploadFiles(files, {
    DataTransfer: FakeDataTransfer,
    Event: FakeEvent,
    HTMLInputElement: FakeHTMLInputElement,
    MutationObserver: OrderedObserver,
    input,
    interval: 100,
    now: () => clock,
    observationRoot,
    sleep: async (milliseconds) => { clock += milliseconds; },
    snapshot: () => snapshots[Math.min(calls++, snapshots.length - 1)],
    stableMs: 100,
    timeout: 800
  });
  assert.deepEqual(input.dispatched.map((event) => event.type), ["input", "change"]);
  console.log("✓ installs the upload observer before dispatching input/change");
}

async function testDoesNotReadWholeDocumentInnerTextForProgress() {
  const body = {
    get innerText() {
      throw new Error("whole-page innerText must not be read");
    },
    querySelectorAll() {
      return [];
    },
    textContent: "large prompt history"
  };
  assert.doesNotThrow(() => adapter.captureUploadState({
    document: { body, documentElement: {} },
    observationRoot: body
  }));
  console.log("✓ upload progress avoids whole-document innerText layout scans");
}

async function testDoesNotReadNarrowRootInnerTextWhenTextContentIsEmpty() {
  const root = {
    get innerText() {
      throw new Error("narrow-root innerText must not force layout");
    },
    querySelectorAll() {
      return [];
    },
    textContent: ""
  };
  assert.doesNotThrow(() => adapter.captureUploadState({
    document: { body: {}, documentElement: {} },
    observationRoot: root
  }));
  console.log("✓ empty upload roots never fall back to layout-forcing innerText");
}

async function testPrefersComposerRootOverTinyInputWrapper() {
  const files = [image("同级预览.png")];
  const contextRoot = domNode();
  const wrapper = domNode(contextRoot, { className: "upload-input-wrapper" });
  const input = new FakeHTMLInputElement({
    accept: "image/*",
    context: "",
    multiple: true
  });
  input.parentElement = wrapper;
  let observedRoot = null;
  class RootObserver {
    disconnect() {}
    observe(root) { observedRoot = root; }
  }
  let clock = 0;
  let calls = 0;
  const snapshots = [
    state(),
    state({ itemCount: 1, previewCount: 1 }),
    state({ itemCount: 1, previewCount: 1 }),
    state({ itemCount: 1, previewCount: 1 })
  ];
  await adapter.uploadFiles(files, {
    DataTransfer: FakeDataTransfer,
    Event: FakeEvent,
    HTMLInputElement: FakeHTMLInputElement,
    MutationObserver: RootObserver,
    contextRoot,
    input,
    interval: 100,
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    snapshot: () => snapshots[Math.min(calls++, snapshots.length - 1)],
    stableMs: 100,
    timeout: 800
  });
  assert.equal(observedRoot, contextRoot);
  console.log("✓ observes the whole verified composer when previews are input-wrapper siblings");
}

async function testBodyFallbackUsesLowFrequencyPollingOnly() {
  const body = domNode();
  const input = new FakeHTMLInputElement({ accept: "image/*", multiple: true });
  input.parentElement = null;
  class ForbiddenBodyObserver {
    constructor() {
      throw new Error("body fallback must not install a subtree observer");
    }
  }
  let clock = 0;
  let calls = 0;
  const snapshots = [
    state(),
    state({ itemCount: 1, previewCount: 1 }),
    state({ itemCount: 1, previewCount: 1 }),
    state({ itemCount: 1, previewCount: 1 })
  ];
  await adapter.uploadFiles([image("轮询素材.png")], {
    DataTransfer: FakeDataTransfer,
    Event: FakeEvent,
    HTMLInputElement: FakeHTMLInputElement,
    MutationObserver: ForbiddenBodyObserver,
    document: { body },
    input,
    interval: 100,
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    snapshot: () => snapshots[Math.min(calls++, snapshots.length - 1)],
    stableMs: 100,
    timeout: 800
  });
  console.log("✓ body fallback polls without observing every page mutation");
}

async function testIncrementalStackAndCapacity() {
  for (const expectedCount of [1, 12]) {
    let clock = 0;
    const before = state({ itemCount: 1, previewCount: 1, previewSources: "old" });
    const after = await adapter.waitForUploadStable(before, expectedCount, {
      idleAggregateStableMs: 200, interval: 100, now: () => clock,
      sleep: async (ms) => { clock += ms; },
      snapshot: () => state({ itemCount: 1, previewCount: 1, previewSources: "new" }),
      timeout: 1000
    });
    assert.equal(after.acceptanceKind, "provisional");
    assert.ok(clock < 800);
  }
  let clock = 0;
  await assert.rejects(() => adapter.waitForUploadStable(state(), 50, {
    interval: 100, now: () => clock, sleep: async (ms) => { clock += ms; },
    snapshot: () => state({ capacityError: "最多添加 30 个图片" }), timeout: 1000
  }), (error) => error.code === "UPLOAD_CAPACITY_REJECTED");
  assert.ok(clock < 200, "explicit rejection must not wait for the upload timeout");
  console.log("✓ incremental stacks accept changed previews without count growth; capacity rejection stops immediately");
}

function testImageLimitUsesVerifiedModeNotPrompt() {
  const upload = {};
  let model = "即梦 Seedance 2.5";
  let mode = "全能参考";
  const root = { querySelectorAll: (selector) => selector.includes("reference-upload-")
    ? [upload] : [{ textContent: model }, { textContent: mode }] };
  const editor = { matches: () => true, closest: () => root,
    textContent: "提示词写着最多 9999 张，不能改变平台限制" };
  const originalVisibility = globalThis.JimengAssetPlugin.isVisible;
  globalThis.JimengAssetPlugin.isVisible = () => true;
  assert.equal(adapter.imageLimitForEditor(editor), 30);
  mode = "首尾帧";
  assert.equal(adapter.imageLimitForEditor(editor), null);
  mode = "全能参考";
  model = "另一个模型";
  assert.equal(adapter.imageLimitForEditor(editor), null);
  model = "Dreamina Seedance 2.0";
  mode = "全方位參考";
  assert.deepEqual(adapter.mediaLimitsForEditor(editor), { image: 9, video: 3, audio: 3, total: 12 });
  assert.equal(adapter.imageLimitForEditor(editor), 9);
  model = "Dreamina Seedance 2.5";
  assert.deepEqual(adapter.mediaLimitsForEditor(editor), { image: 30, video: 10, audio: 10, total: 50 });
  mode = "Omni reference";
  assert.equal(adapter.imageLimitForEditor(editor), 30);
  mode = "First and last frame";
  assert.equal(adapter.mediaLimitsForEditor(editor), null);
  globalThis.JimengAssetPlugin.isVisible = originalVisibility;
  console.log("✓ image limit is scoped to the verified model and mode, never inferred from prompt text");
}

function testCanvasCapacityAndPortal() {
  const plugin = globalThis.JimengAssetPlugin;
  let model = "选择模型: 即梦 Seedance 2.0 VIP, Standard-only model";
  let mode = "生成模式: 全能参考";
  const form = { querySelectorAll: () => [model, mode].map(label => ({ getAttribute: () => label })) };
  const oldCanvas = plugin.canvas;
  plugin.canvas = { formFor: () => form, materialSlots: () => [{}, {}, {}] };
  assert.deepEqual(adapter.canvasCapacityForEditor({}), { limit: 12, used: 3 });
  model = "选择模型: 即梦 Seedance 2.5";
  assert.equal(adapter.canvasCapacityForEditor({}), null);
  model = "选择模型: 即梦 Seedance 2.0 VIP";
  mode = "生成模式: 首尾帧";
  assert.equal(adapter.canvasCapacityForEditor({}), null);
  plugin.canvas = oldCanvas;
  const notice = { textContent: "最多支持上传 12 个素材", getAttribute: () => null };
  for (const text of ["最多支持上传 12 个素材", "图片数量已达上限", "圖片數量已達上限", "最多支援上傳 9 張圖片"]) {
    notice.textContent = text;
    const snapshot = adapter.captureUploadState({
      observationRoot: { querySelectorAll: () => [], textContent: "" },
      document: { querySelectorAll: () => [notice] }
    });
    assert.equal(snapshot.capacityError, text);
  }
  console.log("✓ canvas capacity includes existing media and only applies to verified model/mode; portal notices are recognized");
}

async function testCorruptBatchNeverDispatched() {
  const input = new FakeHTMLInputElement({ accept: "image/*", context: "上传素材", multiple: true });
  let closed = 0;
  let dispatched = false;
  await assert.rejects(() => adapter.uploadFiles([image("good.png"), image("broken.png")], {
    input, createImageBitmap: async file => {
      if (file.name === "broken.png") throw new Error("decode failed");
      return { close: () => { closed++; } };
    }, onFilesDispatched: () => { dispatched = true; }
  }), e => e.code === "INVALID_IMAGE" && /broken.png/.test(e.message));
  assert.equal(closed, 1);
  assert.equal(dispatched, false);
  assert.deepEqual(input.files, []);
  console.log("✓ a corrupt image rejects the complete batch before native dispatch and closes decoded bitmaps");
}

async function testCanvasBatchAndAbort() {
  let clock = 0;
  let calls = 0;
  const before = state({ canvasImages: 2, itemCount: 2, previewCount: 2 });
  const after = await adapter.waitForUploadStable(before, 2, {
    now: () => clock, sleep: async ms => { clock += ms; }, interval: 100, stableMs: 100, timeout: 1000,
    snapshot: () => state({ canvasImages: ++calls < 4 ? 3 : 4, itemCount: 20, previewCount: 20 })
  });
  assert.equal(after.canvasImages, 4);
  assert.ok(calls >= 5, "canvas must confirm the complete batch, not unrelated previews or an aggregate");
  clock = 0;
  await assert.rejects(() => adapter.waitForUploadStable(before, 2, {
    now: () => clock, sleep: async ms => { clock += ms; }, interval: 100, timeout: 300,
    snapshot: () => state({ canvasImages: 3, itemCount: 20, previewCount: 20 })
  }), e => e.code === "UPLOAD_NOT_CONFIRMED");
  let reads = 0;
  let disconnected = false;
  await assert.rejects(() => adapter.waitForUploadStable(before, 1, {
    assertCurrent: () => { throw new Error("node changed"); },
    snapshot: () => { reads++; return before; },
    wakeup: { disconnect: () => { disconnected = true; } }
  }), /node changed/);
  assert.equal(reads, 0);
  assert.equal(disconnected, true);
  console.log("✓ canvas waits for every image; switching nodes aborts observation and releases its observer");
}

async function testCanvasSequentialRecoveryBatches() {
  const plugin = globalThis.JimengAssetPlugin;
  const oldCanvas = plugin.canvas;
  const editor = {};
  let native = [{ id: "bad", name: "retry", status: "failed" }];
  plugin.canvas = { materialState: () => native };
  let clock = 0, ready = 0, pending = 0;
  const batches = [], notices = [];
  const root = { matches: () => true, querySelector: () => editor, appendChild(input) { input.parentElement = this; } };
  const doc = { createElement() {
    const input = new FakeHTMLInputElement({ multiple: true });
    const attrs = new Map(), listeners = new Map();
    input.setAttribute = (key, value) => attrs.set(key, value);
    input.getAttribute = key => attrs.get(key) || null;
    input.addEventListener = (key, fn) => listeners.set(key, fn);
    input.removeEventListener = key => listeners.delete(key);
    input.remove = () => {};
    input.dispatchEvent = () => {
      assert.equal(pending, 0, "next batch must wait for the previous batch to finish");
      batches.push({ names: input.files.map(file => file.name), replace: attrs.get("data-jimeng-canvas-replace") });
      pending = input.files.length;
      attrs.set("data-jimeng-picker-result", "dispatched");
      listeners.get("jimeng-local-picker-result")();
    };
    return input;
  } };
  const files = [image("retry.png"), ...Array.from({ length: 49 }, (_, i) => image(`new${i}.png`))];
  const result = await adapter.uploadFiles(files, { contextRoot: root, document: doc, disableMutationObserver: true,
    now: () => clock, interval: 100, stableMs: 100, sleep: async ms => { clock += ms; ready += pending; pending = 0; },
    snapshot: () => state({ canvasMaterials: ready, uploadBusyCount: pending }),
    onFilesDispatched: event => notices.push(event.filenames) });
  assert.equal(result.count, 50);
  assert.deepEqual(batches.map(batch => batch.names.length), [1, 49]);
  assert.equal(batches[0].replace, "bad");
  assert.equal(batches[1].replace, undefined);
  assert.deepEqual(notices.flat(), files.map(file => file.name));
  const fiftyNew = Array.from({ length: 50 }, (_, index) => image(`batch-${index}.png`));
  const batchStart = batches.length;
  const fiftyResult = await adapter.uploadFiles(fiftyNew, { contextRoot: root, document: doc, disableMutationObserver: true,
    now: () => clock, interval: 100, stableMs: 100, sleep: async ms => { clock += ms; ready += pending; pending = 0; },
    snapshot: () => state({ canvasMaterials: ready, uploadBusyCount: pending }) });
  assert.equal(fiftyResult.count, 50);
  assert.deepEqual(batches.slice(batchStart).map(batch => batch.names.length), [50]);
  native = [{ id: "ready", name: "retry", status: "ready" }];
  await assert.rejects(() => adapter.uploadFiles([files[0]], { contextRoot: root }), error => error.code === "CANVAS_EXISTING_MATERIAL");
  const count = batches.length;
  native = [];
  clock = 0;
  await assert.rejects(() => adapter.uploadFiles(files.slice(1), { contextRoot: root, document: doc, disableMutationObserver: true,
    now: () => clock, interval: 100, sleep: async ms => { clock += ms; }, timeout: 200,
    snapshot: () => state({ canvasMaterials: ready, uploadBusyCount: pending }) }), error => error.code === "UPLOAD_NOT_CONFIRMED");
  assert.equal(batches.length, count + 1, "a failed batch must prevent later files from being dispatched");
  plugin.canvas = oldCanvas;
  console.log("✓ canvas replaces failed cards singly, uploads all new files in one batch, waits between batches and stops on failure");
}

(async () => {
  await testCanvasSequentialRecoveryBatches();
  await testMixedBatchAndImageDecoder();
  testCanvasCapacityAndPortal();
  await testCorruptBatchNeverDispatched();
  await testCanvasBatchAndAbort();
  testImageLimitUsesVerifiedModeNotPrompt();
  await testIncrementalStackAndCapacity();
  await testSelectsTheNativeMaterialInput();
  await testFailsOnAmbiguousInputs();
  await testPrefersOmniReferenceOverFrameInputs();
  await testInjectsBatchAndWaitsForStableDom();
  await testRejectsUnsupportedOrUnsafeBatches();
  await testDoesNotTreatFileAssignmentAsUploadSuccess();
  await testCompletionUsesDeltaInsteadOfAbsoluteCount();
  await testAcceptsAnIdleAggregateBatchProvisionally();
  await testAcceptsAnAggregateCardWhenSynchronousBusyWasMissed();
  await testDoesNotAcceptAnAggregateWhileItsSpinnerIsBusy();
  await testStopsOnPageUploadError();
  await testReadsNativeParenthesizedUploadCount();
  await testScopesBusyStateToTheUploadCard();
  await testDisconnectsUploadObserverOnEveryExit();
  await testInstallsObserverBeforeDispatchingFileEvents();
  await testDoesNotReadWholeDocumentInnerTextForProgress();
  await testDoesNotReadNarrowRootInnerTextWhenTextContentIsEmpty();
  await testPrefersComposerRootOverTinyInputWrapper();
  await testBodyFallbackUsesLowFrequencyPollingOnly();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
