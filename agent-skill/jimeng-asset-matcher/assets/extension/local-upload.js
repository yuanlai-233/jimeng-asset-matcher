(function createLocalUploadAdapter(scope) {
  "use strict";

  const plugin = (scope.JimengAssetPlugin ||= {});

  const media = scope.JimengMediaFiles;
  const POSITIVE_CONTEXT = /(?:上传|上傳|素材|参考|參考|参照|图片|圖片|图像|影像|视频|影片|音频|音訊|upload|asset|material|reference|image|video|audio)/i;
  const OMNI_CONTEXT = /(?:全能参考|万能参考|全方位參考|全能參考|omni\s*reference|all[ -]?in[ -]?one\s*reference)/i;
  const NEGATIVE_CONTEXT = /(?:头像|个人资料|字体|字幕|首帧|尾帧|封面|avatar|profile|font|subtitle|first\s*frame|last\s*frame|cover)/i;
  const BUSY_TEXT = /(?:上传中|处理中|正在上传|uploading|processing)/gi;
  const ERROR_TEXT = /(?:上传失败|上傳失敗|文件过大|檔案過大|格式不支持|不支援.{0,6}格式|重新上传|重新上傳|upload failed|unsupported file|file too large)/gi;
  const ERROR_ELEMENT_TEXT = /(?:上传失败|上傳失敗|文件过大|檔案過大|格式不支持|不支援.{0,6}格式|重新上传|重新上傳|upload failed|unsupported file|file too large)/i;
  const SUCCESS_TEXT = /(?:上传成功|上传完成|upload complete|upload succeeded)/gi;
  const CAPACITY_TEXT = /(?:最多(?:支持|支援)?(?:添加|上传|上傳)?\s*\d+\s*(?:个|张|個|張)?\s*(?:图片|圖像|圖片|影片|音訊|图像|素材|參考)|(?:图片|圖片)(?:数|數)?量.{0,12}(?:上限|限制)|maximum.{0,20}(?:images|references|materials))/i;
  const MAX_UPLOAD_BATCH_FILES = 50;

  class LocalUploadError extends Error {
    constructor(code, message, details = null) {
      super(message);
      this.name = "LocalUploadError";
      this.code = code;
      this.details = details;
    }
  }

  function fail(code, message, details) {
    throw new LocalUploadError(code, message, details);
  }

  function extensionOf(name) {
    const match = String(name || "").toLowerCase().match(/\.([^.]+)$/);
    return match?.[1] || "";
  }

  function normalizeFiles(files, options = {}) {
    const list = Array.from(files || []);
    const maxFiles = Math.min(
      Number.isFinite(options.maxFiles) ? options.maxFiles : MAX_UPLOAD_BATCH_FILES,
      MAX_UPLOAD_BATCH_FILES
    );
    if (!list.length) fail("NO_FILES", "没有可上传的素材文件。");
    if (list.length > maxFiles) {
      fail("TOO_MANY_FILES", `一次最多上传 ${maxFiles} 项素材。`, { count: list.length });
    }

    for (const file of list) {
      if (typeof scope.File === "function" && !(file instanceof scope.File)) {
        fail("INVALID_FILE", "上传对象不是浏览器授权读取的 File。", { name: file?.name });
      }
      if (!String(file?.name || "").trim() || !Number.isFinite(file?.size) || file.size <= 0) {
        fail("INVALID_FILE", "素材文件无效或内容为空。", { name: file?.name });
      }
      if (!media.kindOf(file)) {
        fail("UNSUPPORTED_FILE", `不支持上传“${file.name}”：请使用支持的图片、视频或音频格式，并检查文件类型。`, {
          name: file.name,
          type: file.type || ""
        });
      }
    }
    return list;
  }

  function acceptTokens(input) {
    return String(input?.accept || input?.getAttribute?.("accept") || "")
      .split(",")
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean);
  }

  function tokenAcceptsFile(token, file) {
    return media.tokenAcceptsFile(token, file);
  }

  function inputAcceptsFiles(input, files) {
    const tokens = acceptTokens(input);
    if (!tokens.length) return true;
    return files.every((file) => tokens.some((token) => tokenAcceptsFile(token, file)));
  }

  function elementText(element) {
    if (!element) return "";
    const attributes = [
      "aria-label", "class", "data-testid", "id", "name", "placeholder", "title"
    ];
    // Reading innerText forces layout. textContent plus accessible metadata is
    // enough for input selection and keeps large composers responsive.
    const parts = [element.textContent, element.className];
    for (const name of attributes) parts.push(element.getAttribute?.(name));
    return parts.filter(Boolean).join(" ");
  }

  function contextText(input, maxDepth = 5) {
    const parts = [];
    let node = input;
    for (let depth = 0; node && depth <= maxDepth; depth += 1) {
      parts.push(elementText(node));
      node = node.parentElement;
    }
    return parts.join(" ");
  }

  function contains(root, element) {
    if (!root || !element) return false;
    if (root === element) return true;
    try {
      return Boolean(root.contains?.(element));
    } catch {
      return false;
    }
  }

  function inputScore(input, files, options = {}) {
    if (!input || input.disabled || input.isConnected === false ||
      input.getAttribute?.("aria-disabled") === "true" || input.webkitdirectory) return -Infinity;
    if (files.length > 1 && !input.multiple) return -Infinity;
    if (!inputAcceptsFiles(input, files)) return -Infinity;

    const tokens = acceptTokens(input);
    const text = contextText(input);
    // Negative labels must be close to this input. A shared upload modal often
    // contains the words “首帧 / 尾帧” for sibling controls and must not
    // demote the correct omni-reference input merely because of ancestor text.
    const localText = contextText(input, 2);
    let score = tokens.length ? 100 : 10;
    if (tokens.some((token) => /^(?:image|video|audio)\/\*$/.test(token))) score += 35;
    if (tokens.some((token) => /^(?:image|video|audio)\//.test(token) || token.startsWith("."))) score += 20;
    if (files.length > 1 && input.multiple) score += 25;
    if (POSITIVE_CONTEXT.test(text)) score += 55;
    if (OMNI_CONTEXT.test(text)) score += 90;
    if (NEGATIVE_CONTEXT.test(localText)) score -= 140;

    const contextRoot = options.contextRoot || options.root;
    if (contextRoot && contains(contextRoot, input)) score += 180;
    if (options.preferredInput === input) score += 500;
    return score;
  }

  function queryFileInputs(documentRef) {
    if (!documentRef?.querySelectorAll) return [];
    return Array.from(documentRef.querySelectorAll('input[type="file"]'));
  }

  function rankUploadInputs(files, options = {}) {
    const documentRef = options.document || scope.document;
    return queryFileInputs(documentRef)
      .map((input, index) => ({ input, index, score: inputScore(input, files, options) }))
      .filter((candidate) => Number.isFinite(candidate.score))
      .sort((left, right) => right.score - left.score || right.index - left.index);
  }

  function findUploadInput(files, options = {}) {
    const ranked = rankUploadInputs(files, options);
    if (!ranked.length || ranked[0].score < (options.minimumScore ?? 60)) {
      fail("UPLOAD_INPUT_NOT_FOUND", "没有找到可信的即梦素材上传入口。", {
        candidates: ranked.map(({ score }) => score)
      });
    }
    const margin = options.minimumScoreMargin ?? 15;
    if (ranked[1] && ranked[0].score - ranked[1].score < margin) {
      fail("AMBIGUOUS_UPLOAD_INPUT", "页面上存在多个相似的素材上传入口，已停止自动上传。", {
        scores: ranked.slice(0, 3).map(({ score }) => score)
      });
    }
    return ranked[0].input;
  }

  function createTransfer(files, options = {}) {
    const Transfer = options.DataTransfer || scope.DataTransfer;
    if (typeof Transfer !== "function") {
      fail("DATATRANSFER_UNAVAILABLE", "当前浏览器不支持安全构造上传文件列表。");
    }
    const transfer = new Transfer();
    if (!transfer?.items?.add || !transfer.files) {
      fail("DATATRANSFER_UNAVAILABLE", "当前页面的文件传输接口不可用。");
    }
    for (const file of files) transfer.items.add(file);
    if (transfer.files.length !== files.length) {
      fail("FILELIST_BUILD_FAILED", "未能完整构造待上传文件列表。", {
        expected: files.length,
        actual: transfer.files.length
      });
    }
    return transfer;
  }

  function assignFiles(input, files, options = {}) {
    const transfer = createTransfer(files, options);
    const Input = options.HTMLInputElement || scope.HTMLInputElement;
    const descriptor = Input?.prototype &&
      Object.getOwnPropertyDescriptor(Input.prototype, "files");
    if (!descriptor?.set) {
      fail("FILE_SETTER_UNAVAILABLE", "当前页面不允许安全设置上传文件列表。");
    }

    try {
      input.value = "";
      descriptor.set.call(input, transfer.files);
    } catch (error) {
      fail("FILELIST_ASSIGN_FAILED", "无法把本地素材交给即梦上传入口。", {
        cause: String(error?.message || error)
      });
    }

    const assigned = Array.from(input.files || []);
    const matches = assigned.length === files.length && assigned.every((file, index) =>
      file === files[index] || (
        file.name === files[index].name &&
        file.size === files[index].size &&
        file.type === files[index].type
      )
    );
    if (!matches) {
      fail("FILELIST_ASSIGN_FAILED", "即梦上传入口没有接收完整的文件列表。", {
        expected: files.length,
        actual: assigned.length
      });
    }
    return transfer.files;
  }

  function dispatchFileEvents(input, options = {}) {
    const EventCtor = options.Event || scope.Event;
    if (typeof EventCtor !== "function") {
      fail("EVENT_UNAVAILABLE", "当前页面无法触发上传事件。");
    }
    input.dispatchEvent(new EventCtor("input", { bubbles: true, composed: true }));
    input.dispatchEvent(new EventCtor("change", { bubbles: true, composed: true }));
  }

  function countMatches(text, pattern) {
    return (String(text || "").match(pattern) || []).length;
  }

  function isPluginNode(element) {
    const id = String(element?.id || "");
    return id.startsWith("jimeng-") || Boolean(element?.closest?.('[id^="jimeng-"]'));
  }

  function isProbablyVisible(element) {
    if (!element || isPluginNode(element)) return false;
    if (element.hidden || element.getAttribute?.("aria-hidden") === "true") return false;
    try {
      const style = scope.getComputedStyle?.(element);
      if (style?.display === "none" || style?.visibility === "hidden" || Number(style?.opacity) === 0) {
        return false;
      }
    } catch {
      // A detached style context is not proof that the element is hidden.
    }
    return true;
  }

  function uniqueElements(root, selectors) {
    const result = new Set();
    if (!root?.querySelectorAll) return result;
    const list = Array.from(selectors || []).filter(Boolean);
    if (!list.length) return result;
    try {
      for (const element of root.querySelectorAll(list.join(","))) {
        result.add(element);
      }
      if (result.size || list.length === 1) return result;
    } catch {
      // Fall through for test doubles and page builds rejecting one selector.
    }
    for (const selector of list) {
      try {
        for (const element of root.querySelectorAll(selector)) result.add(element);
      } catch {
        // Ignore selectors unsupported by a test double or an older page build.
      }
    }
    return result;
  }

  function uploadContainerMetadata(element) {
    if (!element) return "";
    const values = [element.className?.baseVal || element.className, element.id];
    for (const name of ["aria-label", "data-testid", "data-state", "name", "role", "title"]) {
      values.push(element.getAttribute?.(name));
    }
    return values.filter(Boolean).join(" ");
  }

  function isExplicitUploadContainer(element) {
    const metadata = uploadContainerMetadata(element);
    if (!/(?:upload|reference|material|asset|上传|参考|素材)/iu.test(metadata)) {
      return false;
    }
    // A whole prompt composer/editor can contain upload controls alongside many
    // unrelated loaders. It is context for input selection, not one upload card.
    return !/(?:composer|editor|prompt)/iu.test(metadata);
  }

  function nearestUploadContainer(element, observationRoot, maxDepth = 8) {
    let node = element;
    for (let depth = 0; node && depth <= maxDepth; depth += 1) {
      if (isExplicitUploadContainer(node)) return node;
      if (node === observationRoot) break;
      node = node.parentElement;
    }
    return null;
  }

  function isDirectUploadCard(element, observationRoot) {
    if (!element || element === observationRoot) return false;
    if (isExplicitUploadContainer(element)) return true;
    const metadata = uploadContainerMetadata(element);
    // Hashed/anonymous wrappers are common for one thumbnail card. Explicitly
    // generic composer/editor/panel wrappers are not card evidence.
    return !/(?:composer|editor|prompt|generic|(?:^|[-_\s])panel(?:$|[-_\s]))/iu
      .test(metadata);
  }

  function busyBelongsToUploadEvidence(
    busy,
    evidence,
    observationRoot,
    { allowSharedParent = false } = {}
  ) {
    if (contains(evidence, busy) || contains(busy, evidence)) return true;
    // Overlay spinners are commonly siblings of the image inside one card.
    if (allowSharedParent && busy?.parentElement &&
      busy.parentElement === evidence?.parentElement &&
      isDirectUploadCard(busy.parentElement, observationRoot)) {
      return true;
    }
    const busyContainer = nearestUploadContainer(busy, observationRoot);
    if (!busyContainer) return false;
    const evidenceContainer = nearestUploadContainer(evidence, observationRoot);
    return Boolean(evidenceContainer && busyContainer === evidenceContainer);
  }

  function uploadScopedBusyCount(
    busyElements,
    previewElements,
    itemElements,
    observationRoot
  ) {
    if (!previewElements.length && !itemElements.length) return 0;
    return Array.from(busyElements).filter((busy) =>
      isProbablyVisible(busy) && (
        previewElements.some((element) => busyBelongsToUploadEvidence(
          busy,
          element,
          observationRoot,
          { allowSharedParent: true }
        )) || itemElements.some((element) => busyBelongsToUploadEvidence(
          busy,
          element,
          observationRoot
        ))
      )
    ).length;
  }

  function maxAssetLabelCount(text) {
    let maximum = 0;
    const expression = /(?:全部|图片|圖片|图像|圖像|素材|all|images?|assets?)\s*[:：]?\s*[（(]?\s*(\d{1,3})\s*[）)]?/gi;
    for (const match of String(text || "").matchAll(expression)) {
      maximum = Math.max(maximum, Number(match[1]) || 0);
    }
    return maximum;
  }

  function uploadStatusText(root, documentRef, extraElements = []) {
    const candidates = uniqueElements(root, [
      '[role="alert"]', '[role="status"]', '[aria-live]', '[role="tab"]',
      '[data-testid*="upload"]', '[data-testid*="reference"]',
      '[class*="upload"]', '[class*="reference"]', '[class*="material"]',
      '[class*="asset"]', '[class*="progress"]', '[class*="loading"]',
      '[class*="success"]', '[class*="error"]', '[class*="tab"]'
    ]);
    for (const element of extraElements) candidates.add(element);
    const parts = Array.from(candidates)
      .filter(isProbablyVisible)
      .map((element) => String(element.textContent || ""))
      .filter(Boolean);
    const documentWide = root === documentRef?.body ||
      root === documentRef?.documentElement || root === documentRef;
    // A narrow upload/composer root is safe as a fallback. Never copy the
    // entire page's prompt and history text on every progress update.
    if (!parts.length && !documentWide) {
      parts.push(String(root?.textContent ?? ""));
    }
    return parts.join("\n");
  }

  function captureUploadState(options = {}) {
    const documentRef = options.document || scope.document;
    const root = options.observationRoot || documentRef?.body || documentRef;
    const canvasRoot = root?.matches?.('form[data-testid="video-generation-form"]') ? root : null;
    const canvasState = canvasRoot && plugin.canvas?.materialState?.(
      canvasRoot.querySelector('.ProseMirror[contenteditable="true"]'));
    const canvasSlots = canvasRoot ? Array.from(canvasRoot.querySelectorAll('[data-slot="generation-material-slot"][data-material-type]')) : [];
    const failedSlot = (slot) => Boolean(slot.querySelector('[data-slot="generation-material-error-icon"], [role="alert"]'));

    const previewElements = uniqueElements(root, [
      'img[src^="blob:"]',
      'img[src^="data:"]',
      '[class*="upload"] img[src]',
      '[class*="reference"] img[src]',
      '[class*="material"] img[src]',
      '[class*="asset"] img[src]',
      '[data-testid*="upload"] img[src]',
      '[data-testid*="reference"] img[src]'
    ]);
    const itemElements = uniqueElements(root, [
      '[class*="reference-item"]',
      '[class*="material-item"]',
      '[class*="asset-item"]',
      '[class*="upload-item"]',
      '[data-testid*="reference-item"]',
      '[data-testid*="upload-item"]'
    ]);
    const busyElements = uniqueElements(root, [
      '[aria-busy="true"]', '[role="progressbar"]', "progress",
      '[data-loading="true"]', '[data-uploading="true"]', '[data-state="loading"]',
      '[class*="uploading"]', '[class*="loading"]', '[class*="progress"]',
      '[class~="spinner"]', '[class*="-spinner"]', '[class*="spinner-"]',
      '[class~="spin"]', '[class*="-spin"]', '[class*="spin-"]'
    ]);
    const errorElements = uniqueElements(root, [
      '[class*="upload-error"]', '[class*="error"]', '[data-testid*="error"]', '[role="alert"]'
    ]);
    const statusText = uploadStatusText(root, documentRef, [
      ...busyElements,
      ...errorElements
    ]);

    const visiblePreviews = Array.from(previewElements).filter((element) =>
      isProbablyVisible(element) && !element.closest?.('[contenteditable="true"]'));
    const visibleItems = Array.from(itemElements).filter(isProbablyVisible);
    const previewCount = visiblePreviews.length;
    const itemCount = visibleItems.length;
    const loadingCount = Array.from(busyElements).filter(isProbablyVisible).length +
      countMatches(statusText, BUSY_TEXT);
    const visibleErrorCount = Array.from(errorElements).filter((element) =>
      isProbablyVisible(element) && ERROR_ELEMENT_TEXT.test(String(element.textContent || ""))
    ).length;
    const errorCount = Math.max(
      visibleErrorCount,
      countMatches(statusText, ERROR_TEXT),
      canvasState ? canvasState.filter((item) => item.status === "failed").length : canvasSlots.filter(failedSlot).length
    );
    // Native rejection toasts are portals outside the composer. Read only
    // short visible notices, never whole-page text or the user's prompt.
    const notices = Array.from(documentRef?.querySelectorAll?.(
      '[role="alert"], [role="status"], [data-sonner-toast], [class*="message-notice"], [class*="toast"]'
    ) || []).filter((element) => isProbablyVisible(element) &&
      !element.closest?.('[contenteditable="true"]'));
    const capacityError = notices.map((element) => String(element.textContent || "").trim())
      .find((text) => text.length < 240 && CAPACITY_TEXT.test(text)) || "";

    return {
      assetLabelCount: maxAssetLabelCount(statusText),
      errorCount,
      capacityError,
      previewSources: visiblePreviews.map((element) => element.currentSrc || element.src ||
        element.getAttribute?.("src") || "").filter(Boolean).sort().join("\n"),
      ...(canvasRoot ? {
        canvasMaterials: canvasState ? canvasState.filter((item) => item.status === "ready").length : canvasSlots
          .filter((slot) => !failedSlot(slot) && slot.getAttribute("aria-busy") !== "true" &&
            (slot.getAttribute("aria-busy") === "false" || slot.querySelector('img[src], video[src], audio[src]'))).length,
        canvasImages: Array.from(root.querySelectorAll('[data-slot="generation-material-slot"][data-material-type="2"]'))
          .filter((slot) => slot.getAttribute("aria-busy") !== "true" && slot.querySelector('img[src]')).length
      } : {}),
      itemCount,
      loadingCount,
      previewCount,
      successCount: countMatches(statusText, SUCCESS_TEXT),
      // Unlike loadingCount, this only follows spinners/progress nodes that are
      // inside (or immediately beside) an upload item/preview. Dreamina can keep
      // unrelated page-level loaders alive while the submitted batch is done.
      uploadBusyCount: canvasState ? canvasState.filter((item) => item.status === "uploading").length : uploadScopedBusyCount(
        busyElements,
        visiblePreviews,
        visibleItems,
        root
      )
    };
  }

  function stateSignature(state) {
    return [
      state.canvasMaterials,
      state.canvasImages,
      state.assetLabelCount,
      state.errorCount,
      state.itemCount,
      state.previewCount,
      state.successCount,
      state.previewSources || "",
      Number.isFinite(state.uploadBusyCount)
        ? state.uploadBusyCount
        : state.loadingCount
    ].join(":");
  }

  function completionEvidence(before, current, expectedCount) {
    if (Number.isFinite(before.canvasMaterials) && Number.isFinite(current.canvasMaterials)) {
      const delta = current.canvasMaterials - before.canvasMaterials;
      return { aggregate: false, complete: delta >= expectedCount,
        deltas: { assetLabel: delta, item: delta, preview: delta, success: 0 } };
    }
    if (Number.isFinite(before.canvasImages) && Number.isFinite(current.canvasImages)) {
      const delta = current.canvasImages - before.canvasImages;
      return { aggregate: false, complete: delta >= expectedCount,
        deltas: { assetLabel: delta, item: delta, preview: delta, success: 0 } };
    }
    const deltas = {
      assetLabel: current.assetLabelCount - before.assetLabelCount,
      item: current.itemCount - before.itemCount,
      preview: current.previewCount - before.previewCount,
      success: current.successCount - before.successCount
    };
    const complete = deltas.assetLabel >= expectedCount || deltas.item >= expectedCount ||
      deltas.preview >= expectedCount || deltas.success >= expectedCount;
    const aggregate = expectedCount >= 1 && !complete &&
      (deltas.item > 0 || deltas.preview > 0 ||
        Boolean(current.previewSources && current.previewSources !== before.previewSources));
    return { aggregate, complete, deltas };
  }

  function scopedBusyCount(state) {
    return Number.isFinite(state?.uploadBusyCount)
      ? state.uploadBusyCount
      : Number(state?.loadingCount) || 0;
  }

  function mutationWakeup(options, sleep, interval) {
    const root = options.observationRoot;
    const Observer = options.MutationObserver || scope.MutationObserver;
    if (!root || options.disableMutationObserver || typeof Observer !== "function") {
      return {
        disconnect() {},
        wait: () => sleep(interval)
      };
    }

    const listeners = new Set();
    const mutationThrottleMs = Math.max(options.mutationThrottleMs ?? 100, 80);
    let observer = null;
    let mutationTimer = null;
    try {
      observer = new Observer(() => {
        if (mutationTimer !== null) return;
        mutationTimer = setTimeout(() => {
          mutationTimer = null;
          for (const notify of Array.from(listeners)) notify();
        }, mutationThrottleMs);
      });
      observer.observe(root, {
        attributeFilter: [
          "aria-busy", "aria-valuenow", "class", "data-state", "data-material-type", "src", "style"
        ],
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true
      });
    } catch (_error) {
      observer?.disconnect?.();
      return {
        disconnect() {},
        wait: () => sleep(interval)
      };
    }

    return {
      disconnect() {
        listeners.clear();
        if (mutationTimer !== null) {
          clearTimeout(mutationTimer);
          mutationTimer = null;
        }
        observer.disconnect();
      },
      wait() {
        return new Promise((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            listeners.delete(finish);
            resolve();
          };
          listeners.add(finish);
          Promise.resolve(sleep(interval)).then(finish, finish);
        });
      }
    };
  }

  async function waitForUploadStable(before, expectedCount, options = {}) {
    const timeout = options.timeout ?? 30000;
    // Mutations are the fast path; this is only a low-frequency watchdog.
    const interval = options.interval ?? 750;
    const stableMs = options.stableMs ?? 600;
    const provisionalStableMs = options.provisionalStableMs ?? 240;
    const idleAggregateStableMs = options.idleAggregateStableMs ?? 450;
    const now = options.now || Date.now;
    const sleep = options.sleep || plugin.sleep || ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
    const snapshot = options.snapshot || (() => captureUploadState(options));
    const startedAt = now();
    let stableSince = null;
    let stableSignature = null;
    let provisionalSince = null;
    let provisionalSignature = null;
    let sawAggregateBusy = false;
    let lastState = before;
    let bestDeltas = { assetLabel: 0, item: 0, preview: 0, success: 0 };
    const beforeScopedBusy = scopedBusyCount(before);
    const wakeup = options.wakeup || mutationWakeup(options, sleep, interval);

    try {
      while (now() - startedAt <= timeout) {
        options.assertCurrent?.();
        const current = snapshot();
        lastState = current;
        if (current.capacityError && current.capacityError !== before.capacityError) {
          fail("UPLOAD_CAPACITY_REJECTED", `${current.capacityError}。请按页面提示减少对应类型的素材后重试。`);
        }
        if (current.errorCount > before.errorCount) {
          fail("UPLOAD_REJECTED", "即梦页面报告素材上传失败。", { before, current });
        }

        const evidence = completionEvidence(before, current, expectedCount);
        for (const key of Object.keys(bestDeltas)) {
          bestDeltas[key] = Math.max(bestDeltas[key], evidence.deltas[key]);
        }
        const currentScopedBusy = scopedBusyCount(current);
        const batchIdle = currentScopedBusy <= beforeScopedBusy;
        if (evidence.aggregate && currentScopedBusy > beforeScopedBusy) {
          sawAggregateBusy = true;
        }

        const signature = stateSignature(current);
        if (evidence.complete && batchIdle) {
          if (signature !== stableSignature) {
            stableSignature = signature;
            stableSince = now();
          } else if (now() - stableSince >= stableMs) {
            return { ...current, acceptanceKind: "complete" };
          }
        } else {
          stableSince = null;
          stableSignature = null;
        }

        // Dreamina represents a large multi-file batch as one stacked card.
        // Usually its own busy indicator is observed before it becomes idle.
        // Some builds create and remove that indicator synchronously inside
        // the change handler, leaving only an idle new card in the first
        // snapshot. A slightly longer idle-only quiet window handles that
        // sequence without waiting for the 30-second fallback. Final per-file
        // truth still comes from the separate native @ matching phase.
        if (evidence.aggregate && batchIdle) {
          if (signature !== provisionalSignature) {
            provisionalSignature = signature;
            provisionalSince = now();
          } else {
            const quietWindow = sawAggregateBusy
              ? provisionalStableMs
              : idleAggregateStableMs;
            if (now() - provisionalSince >= quietWindow) {
              return {
                ...current,
                acceptanceKind: "provisional",
                acceptanceReason: sawAggregateBusy
                  ? "batch-busy-cleared"
                  : "idle-aggregate-card"
              };
            }
          }
        } else {
          provisionalSince = null;
          provisionalSignature = null;
        }
        await wakeup.wait();
      }

      fail("UPLOAD_NOT_CONFIRMED", "文件已交给即梦，但页面没有确认全部素材上传完成。", {
        before,
        expectedCount,
        lastState,
        observedDeltas: bestDeltas,
        sawAggregateBusy
      });
    } finally {
      wakeup.disconnect();
    }
  }

  function inferObservationRoot(input, options = {}) {
    if (options.observationRoot) return options.observationRoot;
    const contextRoot = options.contextRoot || options.root;
    // The composer root is supplied only after content.js has verified that it
    // owns this file input. Prefer it because previews are commonly siblings
    // of the input's tiny wrapper rather than descendants of that wrapper.
    if (contextRoot && contains(contextRoot, input)) return contextRoot;
    let node = input?.parentElement;
    let semanticRoot = null;
    for (let depth = 0; node && depth < 8; depth += 1) {
      if (isExplicitUploadContainer(node)) return node;
      if (!semanticRoot && POSITIVE_CONTEXT.test(elementText(node))) {
        semanticRoot = node;
      }
      if (node === contextRoot) break;
      node = node.parentElement;
    }
    if (semanticRoot) return semanticRoot;
    return (options.document || scope.document)?.body || null;
  }

  function resolveModernRoot(editor) {
    const canvasForm = plugin.canvas?.formFor(editor);
    if (canvasForm) return canvasForm;
    if (!editor?.matches?.('.ProseMirror[contenteditable="true"]')) return null;
    const root = editor.closest?.('[class*="generator-"]');
    if (!root || !plugin.isVisible?.(editor)) return null;
    const entries = Array.from(root.querySelectorAll('[class*="reference-upload-"]'))
      .filter((element) => plugin.isVisible(element));
    return entries.length === 1 ? root : null;
  }

  function imageLimitForEditor(editor) {
    return mediaLimitsForEditor(editor)?.image || null;
  }

  function mediaLimitsForEditor(editor) {
    const root = resolveModernRoot(editor);
    if (!root) return null;
    const controls = Array.from(root.querySelectorAll('[role="combobox"]'))
      .map((element) => String(element.textContent || "")).join(" ");
    if (!OMNI_CONTEXT.test(controls)) return null;
    if (/Seedance\s*2\.5\b/i.test(controls)) return { image: 30, video: 10, audio: 10, total: 50 };
    // Dreamina 2.0 has a separate 12-item limit; never apply the 2.5 fixture's
    // 50-item allowance. Limits come from Dreamina's official Seedance 2.0 guide.
    if (/Dreamina\s+Seedance\s*2\.0\b/i.test(controls)) return { image: 9, video: 3, audio: 3, total: 12 };
    return null;
  }

  function canvasCapacityForEditor(editor) {
    const form = plugin.canvas?.formFor(editor);
    if (!form) return null;
    const labels = Array.from(form.querySelectorAll('button[aria-label]'))
      .map((button) => button.getAttribute("aria-label") || "").join(" ");
    // Verified in canvas Seedance 2.0 / omni: the native rejection is 12
    // total materials, including manually added image/video/audio references.
    if (!/选择模型:.*Seedance\s*2\.0\b/i.test(labels) || !/生成模式:\s*全能参考/.test(labels)) return null;
    return { limit: 12, used: plugin.canvas.materialSlots(editor)?.length || 0 };
  }

  async function dispatchModernFiles(files, root, options) {
    const documentRef = options.document || scope.document;
    const input = documentRef.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.hidden = true;
    const canvas = root.matches('form[data-testid="video-generation-form"]');
    input.setAttribute(canvas ? "data-jimeng-canvas-upload" : "data-jimeng-picker-request", "1");
    if (canvas && options.canvasReplaceId) input.setAttribute("data-jimeng-canvas-replace", options.canvasReplaceId);
    assignFiles(input, files, options);
    root.appendChild(input);
    try {
      await new Promise((resolve, reject) => {
        let timer;
        const finish = (status) => {
          clearTimeout(timer);
          input.removeEventListener("jimeng-local-picker-result", receive);
          if (status === "dispatched") {
            options.onFilesDispatched?.({ count: files.length, filenames: files.map((file) => file.name), input: null });
            resolve();
          } else {
            reject(new LocalUploadError("NATIVE_PICKER_UNAVAILABLE",
              "新版上传入口未就绪。请重新加载扩展并刷新即梦页面后重试。", { status }));
          }
        };
        const receive = () => finish(input.getAttribute("data-jimeng-picker-result"));
        input.addEventListener("jimeng-local-picker-result", receive);
        timer = setTimeout(() => finish("bridge-not-loaded"), 2200);
        input.dispatchEvent(new Event(canvas ? "jimeng-canvas-upload-request" : "jimeng-local-picker-request", { bubbles: true }));
      });
    } finally {
      input.remove();
    }
  }

  async function uploadFiles(files, options = {}) {
    const normalized = normalizeFiles(files, options);
    const decode = options.createImageBitmap || scope.createImageBitmap;
    // Validate only explicitly matched files before handing any of the batch
    // to the site. HEIC/HEIF support is left to the native uploader.
    if (typeof decode === "function" && !options.canvasBatchValidated) {
      for (const file of normalized) {
        options.assertCurrent?.();
        if (media.kindOf(file) !== "image") continue;
        if (/\.(?:heic|heif)$/i.test(file.name)) continue;
        let bitmap;
        try { bitmap = await decode(file); }
        catch (_error) { fail("INVALID_IMAGE", `图片无法解码，文件可能损坏：${file.name}。本批未上传。`); }
        finally { bitmap?.close?.(); }
      }
      options.assertCurrent?.();
    }
    const modernRoot = !options.input && options.contextRoot?.matches?.('[class*="generator-"], form[data-testid="video-generation-form"]') &&
      options.contextRoot.querySelector?.('.ProseMirror[contenteditable="true"]')
      ? options.contextRoot : null;
    if (modernRoot?.matches('form[data-testid="video-generation-form"]') && !options.canvasBatchValidated) {
      const editor = modernRoot.querySelector('.ProseMirror[contenteditable="true"]');
      const materials = plugin.canvas?.materialState?.(editor);
      if (!materials) fail("CANVAS_STATE_UNAVAILABLE", "无法确认画布素材状态，请刷新页面后重试。");
      if (materials.some((item) => item.status === "uploading")) fail("CANVAS_UPLOAD_PENDING", "画布素材仍在上传，请等待完成后重试。");
      const compact = (name) => String(name).normalize("NFC").replace(/\s+/gu, "");
      const batches = [];
      const newFiles = [];
      for (const file of normalized) {
        const stem = file.name.slice(0, -(media.extensionOf(file.name).length + 1));
        const existing = materials.filter((item) => compact(item.name) === compact(stem));
        if (existing.length > 1 || existing.some((item) => item.status !== "failed")) {
          fail("CANVAS_EXISTING_MATERIAL", `画布中已有同名素材：${stem}。请先点击“自动匹配”核对。`);
        }
        if (existing.length) batches.push({ files: [file], replaceId: existing[0].id });
        else newFiles.push(file);
      }
      // A fresh canvas upload can accept the complete new-material batch at
      // once. Failed cards are intentionally kept as one-file replacements so
      // their existing positions remain stable and cannot be duplicated.
      if (newFiles.length) batches.push({ files: newFiles });
      let completed = 0;
      let first;
      let last;
      for (const batch of batches) {
        options.assertCurrent?.();
        options.onBatchProgress?.(completed, normalized.length);
        last = await uploadFiles(batch.files, { ...options, canvasBatchValidated: true, canvasReplaceId: batch.replaceId });
        first ||= last;
        completed += batch.files.length;
        options.onBatchProgress?.(completed, normalized.length);
      }
      return { before: first.before, after: last.after, count: completed, input: null };
    }
    const input = modernRoot ? null : options.input || findUploadInput(normalized, options);
    if (input && inputScore(input, normalized, { ...options, preferredInput: input }) === -Infinity) {
      fail("INCOMPATIBLE_UPLOAD_INPUT", "指定的上传入口无法接收这些素材。");
    }

    const observationRoot = modernRoot || inferObservationRoot(input, options);
    const documentRef = options.document || scope.document;
    const stateOptions = {
      ...options,
      disableMutationObserver: options.disableMutationObserver ??
        (observationRoot === documentRef?.body),
      observationRoot
    };
    const before = (options.snapshot || (() => captureUploadState(stateOptions)))();
    const interval = options.interval ?? 750;
    const sleep = options.sleep || plugin.sleep || ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
    // Observe before input/change: the page can create and remove the spinner
    // synchronously inside its change handler.
    const wakeup = mutationWakeup(stateOptions, sleep, interval);
    try {
      if (modernRoot) {
        await dispatchModernFiles(normalized, modernRoot, options);
      } else {
        assignFiles(input, normalized, options);
        dispatchFileEvents(input, options);
      }
      // Let the workflow distinguish pre-dispatch failures from timeouts after
      // the page owns FileList. The latter must stay pending to prevent retry.
      if (!modernRoot) options.onFilesDispatched?.({ count: normalized.length, input });
      const after = await waitForUploadStable(before, normalized.length, {
        ...stateOptions,
        wakeup
      });
      return { after, before, count: normalized.length, input };
    } catch (error) {
      wakeup.disconnect();
      throw error;
    }
  }

  plugin.localUpload = Object.freeze({
    LocalUploadError,
    assignFiles,
    captureUploadState,
    findUploadInput,
    inputScore,
    normalizeFiles,
    MAX_UPLOAD_BATCH_FILES,
    rankUploadInputs,
    resolveModernRoot,
    imageLimitForEditor,
    mediaLimitsForEditor,
    canvasCapacityForEditor,
    uploadFiles,
    waitForUploadStable
  });
})(globalThis);
