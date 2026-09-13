(function startExtension(scope) {
  "use strict";

  const plugin = scope.JimengAssetPlugin;
  // Prevent duplicate listeners if the content script is injected twice.
  const runtimeMarker = "data-jimeng-asset-matcher-active";
  if (
    scope.__JIMENG_ASSET_MATCHER_LOADED__ ||
    document.documentElement.hasAttribute(runtimeMarker)
  ) return;
  scope.__JIMENG_ASSET_MATCHER_LOADED__ = plugin.version;
  document.documentElement.setAttribute(runtimeMarker, plugin.version);

  const matcher = plugin.matcher || scope.JimengAssetMatcher;
  const localAssets = scope.JimengLocalAssets;
  const localDirectory = scope.JimengLocalDirectory;
  const localWorkflow = scope.JimengLocalWorkflow;
  let promptEditTimer = null;
  let promptEmptyTimer = null;
  let promptRebaseDropsPlain = false;
  let promptResetEditor = null;
  let promptResetTimer = null;
  let matchingInterrupted = false;

  function interruptMatching() {
    if (!plugin.state.matching) return;
    matchingInterrupted = true;
    // Run before a trusted navigation click unmounts the old editor. Never
    // close a popup in the newly selected page or delete an unowned bare @.
    plugin.canvas?.cleanupPicker?.();
  }

  function scheduleTaskStateRebase(editor, { dropPlainTargets = false } = {}) {
    if (!editor || plugin.state.matching) return;
    promptRebaseDropsPlain ||= dropPlainTargets;
    clearTimeout(promptEditTimer);
    promptEditTimer = setTimeout(() => {
      if (document.contains(editor) && !plugin.state.matching) {
        plugin.ui.rebaseExpectedMentionCounts(editor, {
          keepPlainTargets: !promptRebaseDropsPlain
        });
        if (plugin.ui.verifiedEditorChanged?.(editor)) {
          plugin.ui.invalidateMatchStatus({ contentDirty: true });
        } else {
          plugin.ui.updateMatchStatus({ contentDirty: true });
        }
      }
      promptRebaseDropsPlain = false;
    }, 90);
  }

  function discoveryProgress(rows, expected) {
    const names = candidateNamesFromRows(rows);
    return {
      complete: names.length > 0 && (!expected || names.length >= expected),
      expected,
      names
    };
  }

  // Read the native upload menu at most twice before matching starts. A partial
  // list is never cached or used for a best-effort pass: that was the source of
  // the old 12/29 and 16/29 failures.
  async function discoverWithRetry(
    editor,
    expected,
    { retryIncomplete = true } = {}
  ) {
    const assertCurrent = () => {
      if (plugin.state.matching) assertMatchingEditorCurrent(editor);
    };
    const opened = await plugin.nativeTrigger.ensurePicker(editor, { assertCurrent });
    assertCurrent();
    if (!opened) {
      plugin.candidates.closePicker();
      throw new Error(
        "无法通过网页原生 @ 按钮打开素材菜单；已停止读取，请检查输入框后重试。"
      );
    }
    let rows = await plugin.candidates.discover(editor);
    assertCurrent();
    let progress = discoveryProgress(rows, expected);
    if (progress.complete) {
      plugin.candidates.closePicker();
      return rows;
    }
    if (!retryIncomplete) {
      plugin.candidates.closePicker();
      return rows;
    }
    const firstResult = progress.expected
      ? `${progress.names.length}/${progress.expected} 项`
      : `${progress.names.length} 项`;
    plugin.ui.toast(
      `素材菜单第一次只读取到 ${firstResult}，正在完整重试…`,
      "info",
      12000
    );
    plugin.candidates.closePicker();
    await plugin.sleep(220);
    assertCurrent();
    const reopened = await plugin.nativeTrigger.ensurePicker(editor, { assertCurrent });
    assertCurrent();
    if (!reopened) {
      plugin.candidates.closePicker();
      throw new Error("原生素材菜单没有重新打开，已停止读取以保护提示词。");
    }
    rows = await plugin.candidates.discover(editor);
    assertCurrent();
    progress = discoveryProgress(rows, expected);
    if (!progress.complete && progress.expected) {
      plugin.candidates.closePicker();
      throw new Error(
        `素材目录读取不完整：只读取到 ${progress.names.length}/${progress.expected} 项，` +
        "已停止匹配以避免漏掉后半部分素材"
      );
    }
    plugin.candidates.closePicker();
    return rows;
  }

  async function insertWithRetry(editor, match, options = {}) {
    // One slot, one candidate click. A click can be accepted by Dreamina before
    // Slate exposes the native node; retrying here is what created duplicate
    // purple boxes in the recording. A later manual run will first re-check the
    // exact adjacent slot and skip it if the delayed node has appeared.
    return plugin.candidates.insertMention(editor, match, options);
  }

  function candidateNamesFromRows(rows) {
    // Prompt text can never manufacture a candidate. The upload menu is the
    // only source of names used by the matcher.
    return Array.from(new Set(rows
      .map((row) => row.name)
      .filter((name) => name && !plugin.candidates.isSystemMenuEntry(name))));
  }

  async function acquireCandidateCatalog(
    editor,
    { retryIncomplete = true } = {}
  ) {
    const expected = plugin.candidates.expectedUploadCount?.(editor) || 0;
    const cached = plugin.ui.readCandidateCatalog?.(editor) || [];
    if (cached.length && (!expected || cached.length >= expected)) {
      plugin.ui.toast(`已使用本任务缓存的 ${cached.length} 项素材名`, "info", 3200);
      return Object.freeze(cached.slice());
    }
    if (cached.length) plugin.ui.invalidateCandidateCatalog?.();

    const rows = await discoverWithRetry(editor, expected, { retryIncomplete });
    const names = candidateNamesFromRows(rows);
    if (!names.length) {
      plugin.candidates.closePicker();
      return Object.freeze([]);
    }
    if (expected && names.length < expected) {
      throw new Error(
        `素材目录读取不完整：只读取到 ${names.length}/${expected} 项，` +
        "已停止匹配以避免漏掉后半部分素材"
      );
    }
    const cachedNames = plugin.ui.cacheCandidateCatalog?.(editor, names) || names;
    plugin.ui.toast(`素材目录已完整缓存：${cachedNames.length} 项`, "info", 3200);
    return Object.freeze(cachedNames.slice());
  }

  function rememberLocalDirectory(result) {
    const handle = result?.handle || null;
    if (!handle) return null;
    if (plugin.state.localDirectoryHandle !== handle) {
      plugin.state.localAssetIndex = null;
      plugin.state.localAssetIndexHandle = null;
    }
    plugin.state.localDirectoryHandle = handle;
    return handle;
  }

  // Clear the site-origin database used by versions <=0.3.6, then restore only
  // this page session's in-memory handle. A real picker is always opened from
  // the user's click so browser user activation is preserved.
  function preloadLocalDirectory() {
    if (!localDirectory?.restoreDirectory) return;
    localDirectory.clearLegacyDirectoryStorage?.().catch((error) => {
      console.warn("[即梦本地素材] 未能清除旧版网页目录授权", error);
    });
    localDirectory.restoreDirectory().then((result) => {
      // A fast first click may already have selected a newer folder while the
      // startup cleanup was pending. Never let a stale restore win.
      if (result?.usable && result.handle && !plugin.state.localDirectoryHandle) {
        rememberLocalDirectory(result);
      }
    }).catch((error) => {
      console.warn("[即梦本地素材] 未能恢复上次的文件夹", error);
    });
  }

  async function acquireLocalDirectory(forceDirectory) {
    if (!localDirectory?.chooseDirectory) {
      throw new Error("本地素材文件夹模块未加载，请重新加载扩展。");
    }

    const remembered = plugin.state.localDirectoryHandle;
    if (!forceDirectory && remembered) {
      const permission = await localDirectory.requestReadPermission(remembered);
      if (permission === "granted") return remembered;
    }

    // force=true invokes showDirectoryPicker in this click turn.
    const selected = await localDirectory.chooseDirectory({ force: true });
    if (forceDirectory) {
      // The browser may return the same handle object when the user reselects
      // the same folder. Shift-click explicitly means rescan, even then.
      plugin.state.localAssetIndex = null;
      plugin.state.localAssetIndexHandle = null;
    }
    return rememberLocalDirectory(selected);
  }

  async function localAssetIndex(handle, button) {
    if (plugin.state.localAssetIndex &&
      plugin.state.localAssetIndexHandle === handle) {
      return plugin.state.localAssetIndex;
    }
    button.textContent = "扫描文件夹…";
    plugin.ui.toast(
      "正在扫描素材文件夹…",
      "info",
      12000
    );
    const index = await localAssets.indexDirectory(handle);
    if (!index.indexedFileCount) {
      throw new Error("选中的文件夹中没有可用的图片、视频或音频。");
    }
    plugin.state.localAssetIndex = index;
    plugin.state.localAssetIndexHandle = handle;
    return index;
  }

  function conflictMessage(conflicts) {
    const lines = conflicts.slice(0, 4).map((conflict) => {
      return `@${conflict.name}：发现 ${conflict.records.length} 个同名文件`;
    });
    const remainder = conflicts.length > 4
      ? `\n另有 ${conflicts.length - 4} 个同名冲突。`
      : "";
    return `文件夹内存在同名素材，已停止上传以避免串图：\n` +
      `${lines.join("\n")}${remainder}\n请重命名后重试。`;
  }

  function assertEditorCurrent(editor, code, message) {
    const activeEditor = plugin.editor.findEditor();
    if (!document.contains(editor) || activeEditor !== editor) {
      const error = new Error(message);
      error.code = code;
      throw error;
    }
  }

  function assertLocalPromptCurrent(editor, prompt) {
    assertEditorCurrent(
      editor,
      "EDITOR_CHANGED_DURING_UPLOAD",
      "上传期间提示词输入框已切换，已停止自动上传，请重新点击。"
    );
    localWorkflow.assertPromptUnchanged(prompt, plugin.editor.plainText(editor));
  }

  function assertMatchingEditorCurrent(editor) {
    if (matchingInterrupted || document.visibilityState === "hidden") {
      const error = new Error("已暂停匹配并清理临时 @；回到原任务后点“自动匹配”可继续，已匹配标签会保留。");
      error.code = "EDITOR_CHANGED_DURING_MATCHING";
      throw error;
    }
    assertEditorCurrent(
      editor,
      "EDITOR_CHANGED_DURING_MATCHING",
      "匹配期间提示词输入框已切换，已停止修改，请在当前任务重新点击。"
    );
  }

  function uploadWasRejected(editor) {
    const canvas = plugin.canvas?.uploadStateFor?.(editor);
    return canvas ? canvas.rejected : plugin.state.localUploadRejectedByEditor?.has?.(editor);
  }

  function markUploadRejected(editor) {
    const canvas = plugin.canvas?.uploadStateFor?.(editor);
    if (canvas) canvas.rejected = true;
    else plugin.state.localUploadRejectedByEditor?.add?.(editor);
  }

  function pendingLocalUploadNames(editor) {
    const canvas = plugin.canvas?.uploadStateFor?.(editor);
    if (canvas) return canvas.pending.slice();
    const scoped = plugin.state.localUploadPendingByEditor?.get?.(editor);
    if (Array.isArray(scoped)) return scoped.slice();
    return plugin.state.localUploadReconcileEditor === editor
      ? (plugin.state.localUploadPendingNames || []).slice()
      : [];
  }

  function markLocalUploadDispatched(editor, names) {
    const pending = Array.from(new Set((names || []).filter(Boolean)));
    const canvas = plugin.canvas?.uploadStateFor?.(editor);
    if (canvas) { canvas.pending = pending; canvas.rejected = false; return; }
    plugin.state.localUploadRejectedByEditor?.delete?.(editor);
    plugin.state.localUploadPendingByEditor?.set?.(editor, pending);
    plugin.state.localUploadNeedsReconcile = pending.length > 0;
    plugin.state.localUploadPendingNames = pending;
    plugin.state.localUploadReconcileEditor = editor;
  }

  function clearLocalUploadReconcile(editor) {
    const canvas = plugin.canvas?.uploadStateFor?.(editor);
    if (canvas) { canvas.pending = []; canvas.rejected = false; return; }
    plugin.state.localUploadPendingByEditor?.delete?.(editor);
    plugin.state.localUploadRejectedByEditor?.delete?.(editor);
    if (plugin.state.localUploadReconcileEditor !== editor) return;
    plugin.state.localUploadNeedsReconcile = false;
    plugin.state.localUploadPendingNames = [];
    plugin.state.localUploadReconcileEditor = null;
  }

  function verifiedLocalUploadNames(editor) {
    const canvas = plugin.canvas?.uploadStateFor?.(editor);
    if (canvas) return Array.from(canvas.verified);
    const verified = plugin.state.localUploadVerifiedNamesByEditor?.get?.(editor);
    return verified instanceof Set
      ? Array.from(verified)
      : (Array.isArray(verified) ? verified.slice() : []);
  }

  function markLocalUploadVerified(editor, names) {
    if (!plugin.state.localUploadVerifiedNamesByEditor?.get) {
      plugin.state.localUploadVerifiedNamesByEditor = new WeakMap();
    }
    const verified = new Set(verifiedLocalUploadNames(editor));
    for (const value of names || []) {
      const name = matcher.normalizeAssetName(value);
      if (name) verified.add(name);
    }
    const canvas = plugin.canvas?.uploadStateFor?.(editor);
    if (canvas) canvas.verified = verified;
    else plugin.state.localUploadVerifiedNamesByEditor.set(editor, verified);
    return Array.from(verified);
  }

  function nativeNameForUpload(name, candidateNames) {
    const token = `@${matcher.normalizeAssetName(name)}`;
    return matcher.matchPromptToCandidates(token, candidateNames)
      .find((match) => match.start === 0 && match.token === token)?.name || "";
  }

  function pruneVerifiedLocalUploadsFromCandidateCatalog(editor, candidateNames) {
    const verifiedNames = verifiedLocalUploadNames(editor);
    // An empty menu can be a transient render failure, so never use it to
    // unlock a whole verified batch for re-upload. Prune only against a
    // successfully read, non-empty authoritative catalogue.
    const canvas = plugin.canvas?.uploadStateFor?.(editor);
    const confirmedEmpty = canvas && plugin.canvas.materialSlots(editor)?.length === 0;
    if (!verifiedNames.length || !candidateNames?.length && !confirmedEmpty) return [];
    const available = new Set((candidateNames || []).map((name) =>
      matcher.normalizeAssetName(name)
    ));
    const retained = verifiedNames.filter((name) => nativeNameForUpload(name, available));
    const removed = verifiedNames.filter((name) => !nativeNameForUpload(name, available));
    if (!removed.length) return [];
    if (canvas) {
      canvas.verified = new Set(retained);
    } else if (retained.length) {
      plugin.state.localUploadVerifiedNamesByEditor.set(
        editor,
        new Set(retained)
      );
    } else {
      plugin.state.localUploadVerifiedNamesByEditor.delete(editor);
    }
    return removed;
  }

  function stopIfLocalUploadNeedsReconcile(editor) {
    const pendingNames = pendingLocalUploadNames(editor);
    if (!pendingNames.length) return;
    const wasRejected = uploadWasRejected(editor);
    const error = new Error(
      (wasRejected
        ? "上一批素材中有文件被网页拒绝："
        : "上一批素材已经交给网页、仍在等待确认：") +
      pendingNames.slice(0, 6).map((name) => `@${name}`).join("、") +
      (wasRejected
        ? "。请先点击“自动匹配”核对已成功的文件；核对后再次自动上传只会补传缺失项。"
        : "。为避免重复上传，自动上传不会打开 @ 菜单重试；请等待素材出现后点击“自动匹配”。")
    );
    error.code = "UPLOAD_ATTEMPT_NOT_RECONCILED";
    error.details = { pendingNames };
    throw error;
  }

  function reconcileCanvasMaterialState(editor, index = null) {
    const materials = plugin.canvas?.materialState?.(editor);
    if (!materials || materials.some((item) => item.status === "uploading")) return materials;
    const names = materials.map((item) => item.name);
    const ready = materials.filter((item) => item.status === "ready").map((item) => item.name);
    const pending = pendingLocalUploadNames(editor);
    const originals = [...pending, ...verifiedLocalUploadNames(editor),
      ...(index?.records || []).map((record) => record.assetName),
      ...matcher.matchPromptToCandidates(plugin.editor.plainText(editor), names).map((match) => match.token.slice(1))];
    const ledger = plugin.canvas.uploadStateFor(editor);
    ledger.verified = new Set(originals.filter((name) => nativeNameForUpload(name, ready)));
    // The native cards prove terminal results for these dispatched files.
    // An unknown/missing card remains pending rather than enabling duplicates.
    if (pending.every((name) => nativeNameForUpload(name, names))) clearLocalUploadReconcile(editor);
    return materials;
  }

  function reconcileLocalUploadFromCandidateCatalog(editor, candidateNames) {
    const pendingNames = pendingLocalUploadNames(editor);
    if (!pendingNames.length) return { missing: [], pendingNames: [] };
    const available = new Set((candidateNames || []).map((name) =>
      matcher.normalizeAssetName(name)
    ));
    const missing = pendingNames.filter((name) =>
      !nativeNameForUpload(name, available)
    );
    if (!missing.length) {
      markLocalUploadVerified(editor, pendingNames);
      clearLocalUploadReconcile(editor);
    }
    return { missing, pendingNames };
  }

  function localUploadContextRoot(editor) {
    const modernRoot = plugin.localUpload.resolveModernRoot?.(editor);
    if (modernRoot) return modernRoot;
    let node = editor?.parentElement || null;
    for (let depth = 0; node && depth < 8; depth += 1) {
      if (node === document.body || node === document.documentElement) break;
      if (node.querySelector?.('input[type="file"]')) return node;
      node = node.parentElement;
    }
    return null;
  }

  async function runLocalUpload(button, { forceDirectory = false } = {}) {
    if (plugin.state.localUploading || plugin.state.matching) return;
    if (!localAssets || !localWorkflow || !plugin.localUpload) {
      throw new Error("本地自动上传模块未完整加载，请重新加载扩展。");
    }

    const editor = plugin.editor.findEditor();
    if (!editor) throw new Error("没有找到提示词输入框");
    plugin.bgm?.flush(editor);
    const prompt = plugin.editor.plainText(editor);
    if (!matcher.normalizeText(prompt)) throw new Error("提示词是空的");
    const syntaxErrors = matcher.promptReferenceErrors(prompt);
    if (syntaxErrors.length) throw new Error(syntaxErrors.join("\n"));
    if (!matcher.parsePromptReferences(prompt).length) {
      throw new Error(
        "没有需要上传的 @素材名。\n检查已有素材，请点“自动匹配”。"
      );
    }

    // A dispatched batch is the strongest duplicate-upload signal we have.
    // Check it before asking for directory permission, walking folders or
    // reading any File so a repeated click is both safe and instantaneous.
    reconcileCanvasMaterialState(editor);
    stopIfLocalUploadNeedsReconcile(editor);

    plugin.state.localUploading = true;
    const matchButton = document.getElementById(plugin.constants.buttonId);
    button.disabled = true;
    if (matchButton) matchButton.disabled = true;
    button.textContent = forceDirectory ? "选择文件夹…" : "准备上传…";
    try {
      const handle = await acquireLocalDirectory(forceDirectory);
      const index = await localAssetIndex(handle, button);
      const canvasMaterials = reconcileCanvasMaterialState(editor, index);
      const initialPlan = localWorkflow.planLocalUpload(
        prompt,
        index,
        verifiedLocalUploadNames(editor)
      );
      if (initialPlan.conflicts.length) {
        throw new Error(conflictMessage(initialPlan.conflicts));
      }

      assertLocalPromptCurrent(editor, prompt);

      if (!initialPlan.filesToUpload.length &&
        !initialPlan.alreadyUploaded.length) {
        const missingNames = Array.from(new Set(
          (initialPlan.missing || []).map((item) => item.name).filter(Boolean)
        ));
        const suffix = missingNames.length
          ? `：${missingNames.slice(0, 6).map((name) => `@${name}`).join("、")}`
          : "";
        const error = new Error(
          `本地文件夹中没有与提示词精确匹配的素材${suffix}。` +
          "未执行上传，也没有打开 @ 素材菜单。"
        );
        error.code = "NO_LOCAL_ASSET_MATCH";
        error.details = { missingNames };
        throw error;
      }

      // Automatic upload is deliberately folder-first. Do not inspect the
      // web page's @ catalogue here: doing so opens the picker before files are
      // handed to Dreamina and can leave a meaningless bare @ in the prompt.
      const plan = initialPlan;

      const imageLimit = plugin.localUpload.imageLimitForEditor?.(editor);
      const mediaLimits = plugin.localUpload.mediaLimitsForEditor?.(editor) || {};
      const canvasCapacity = plugin.localUpload.canvasCapacityForEditor?.(editor);
      const replacementCount = (canvasMaterials || []).filter((item) => item.status === "failed" &&
        plan.filesToUpload.some((record) => nativeNameForUpload(record.assetName, [item.name]))).length;
      if (canvasCapacity && canvasCapacity.used + plan.filesToUpload.length - replacementCount > canvasCapacity.limit) {
        throw new Error(`当前画布模式最多添加 ${canvasCapacity.limit} 个素材；已有 ${canvasCapacity.used} 项，本次需新增 ${plan.filesToUpload.length} 项。本次未上传，请减少引用或移除不用的参考。`);
      }
      const verifiedNames = new Set(verifiedLocalUploadNames(editor));
      const knownRecords = index.records.filter((record) => verifiedNames.has(record.assetName));
      const countKind = (records, kind) => new Set(records.filter((record) =>
        (record.mediaKind || scope.JimengMediaFiles.kindOf(record.filename)) === kind)
        .map((record) => record.assetName)).size;
      for (const [kind, label] of [["image", "图片"], ["video", "视频"], ["audio", "音频"]]) {
        const limit = mediaLimits[kind] || (kind === "image" ? imageLimit : null);
        const existing = countKind(knownRecords, kind);
        const added = countKind(plan.filesToUpload, kind);
        if (limit && existing + added > limit) {
          throw new Error(`当前模式最多添加 ${limit} 个${label}；本任务已确认 ${existing} 个，本次需新增 ${added} 个。本次未上传，请减少对应类型的素材后重试。`);
        }
      }
      if (mediaLimits.total && verifiedNames.size + plan.filesToUpload.length > mediaLimits.total) {
        throw new Error(`当前模式最多添加 ${mediaLimits.total} 项素材；本次上传后会超过总量。本次未上传，请减少附件后重试。`);
      }

      if (plan.filesToUpload.length) {
        assertLocalPromptCurrent(editor, prompt);
        button.textContent = `读取 ${plan.filesToUpload.length} 项…`;
        const materialized = await localAssets.materializeMatchedFiles({
          files: plan.filesToUpload
        });
        assertLocalPromptCurrent(editor, prompt);

        button.textContent = `上传 ${materialized.length} 项…`;
        plugin.ui.toast(
          `已精确命中 ${materialized.length} 项：图片 ${countKind(plan.filesToUpload, "image")}、视频 ${countKind(plan.filesToUpload, "video")}、音频 ${countKind(plan.filesToUpload, "audio")}，正在上传…`,
          "info",
          30000
        );
        const contextRoot = localUploadContextRoot(editor);
        // Invalidate before handing files to the page. Even if its DOM success
        // signal times out, the native uploader may already own this batch.
        plugin.ui.invalidateCandidateCatalog?.();
        plugin.ui.invalidateMatchStatus?.({ materialsDirty: true });
        const pendingNames = Array.from(new Set(
          plan.filesToUpload.map((record) => record.assetName).filter(Boolean)
        ));
        let dispatchMarked = false;
        const dispatchedNames = new Set();
        const markDispatched = (event) => {
          dispatchMarked = true;
          const names = event?.filenames ? plan.filesToUpload.filter((record) =>
            event.filenames.includes(record.filename)).map((record) => record.assetName) : pendingNames;
          names.forEach((name) => dispatchedNames.add(name));
          markLocalUploadDispatched(editor, [...dispatchedNames]);
        };
        try {
          await plugin.localUpload.uploadFiles(
            materialized.map((item) => item.file),
            {
              ...(contextRoot ? { contextRoot } : {}),
              assertCurrent: () => assertLocalPromptCurrent(editor, prompt),
              onBatchProgress: (completed, total) => { button.textContent = `上传 ${completed}/${total} 项…`; },
              onFilesDispatched: markDispatched
            }
          );
        } catch (error) {
          if (error?.code === "UPLOAD_CAPACITY_REJECTED") {
            clearLocalUploadReconcile(editor);
          }
          if (dispatchMarked && error?.code === "UPLOAD_REJECTED") {
            markUploadRejected(editor);
            error.message = plugin.canvas?.formFor?.(editor)
              ? "即梦报告素材上传失败。再次点击“自动上传”会只重试失败项，保留已成功的素材和原有卡片位置。"
              :
              "即梦报告本批至少有一项素材上传失败。请先点击“自动匹配”核对已成功项，" +
              "再点“自动上传”时只会补传仍缺少的文件。";
          }
          throw error;
        }
        if (!dispatchMarked) {
          const error = new Error(
            "网页上传器返回了结果，但没有确认文件已经交给原生上传入口；" +
            "为保护提示词，本次不会打开 @ 素材菜单。"
          );
          error.code = "UPLOAD_DISPATCH_NOT_CONFIRMED";
          throw error;
        }
        assertLocalPromptCurrent(editor, prompt);
        plugin.ui.invalidateMatchStatus({ materialsDirty: true });
        plugin.ui.toast(
          `已提交：图片 ${countKind(plan.filesToUpload, "image")}、视频 ${countKind(plan.filesToUpload, "video")}、音频 ${countKind(plan.filesToUpload, "audio")}。下一步点击“自动匹配”。` +
          (plan.missing.some((reference) => !verifiedNames.has(reference.name))
            ? "\n还有引用未在所选文件夹中找到；确认已上传项后，可重选包含全部素材的上一级文件夹补传。" : ""),
          plan.missing.some((reference) => !verifiedNames.has(reference.name)) ? "warning" : "success",
          12000
        );
      } else {
        plugin.ui.toast(
          `${plan.alreadyUploaded.length} 项素材已确认，本次无需上传。` +
          "可点击“自动匹配”检查引用标签。",
          "info",
          6000
        );
      }
      assertLocalPromptCurrent(editor, prompt);
    } finally {
      plugin.state.localUploading = false;
      button.disabled = false;
      button.textContent = "自动上传";
      if (matchButton && !plugin.state.matching) matchButton.disabled = false;
    }

  }

  function replaceMap(target, source) {
    target.clear();
    for (const [key, value] of source) target.set(key, value);
  }

  // Reconcile persisted slot targets with the editor at click time. This does
  // not lower an active deficit, so a later manual run can finish any source
  // slots that still lack an adjacent native mention.
  function currentMentionTargets(editor, prompt, candidateNames) {
    const expected = plugin.state.expectedMentionCounts;
    const names = Array.from(expected.keys());
    if (!names.length) return new Map();
    const knownNames = Array.from(new Set([...names, ...(candidateNames || [])]));
    const plainMatches = matcher.matchPromptToCandidates(prompt, knownNames);
    const currentCounts = plugin.editor.countPairedCandidateMentions(
      editor,
      plainMatches
    );
    const active = matcher.pruneInactiveMentionTargets(
      expected,
      currentCounts,
      plainMatches
    );
    plugin.ui.setExpectedMentionCounts(active);
    return active;
  }

  function candidateMatches(editor, prompt, candidateNames, targetMentionCounts) {
    const discovered = matcher.matchPromptToCandidates(prompt, candidateNames);
    const paired = plugin.editor.pairedCandidateMatches
      ? plugin.editor.pairedCandidateMatches(editor, discovered)
      : discovered.filter((match) => plugin.editor.isMatchPaired(editor, match));
    const pairedSlots = new Set(paired
      .map((match) => matcher.matchSlotKey(match))
      .filter(Boolean));
    const currentCounts = new Map();
    for (const match of paired) currentCounts.set(match.name, (currentCounts.get(match.name) || 0) + 1);
    const seededTargets = new Map(targetMentionCounts);
    const plan = matcher.planMatchesToMentionTargets(
      discovered,
      currentCounts,
      seededTargets,
      pairedSlots
    );
    replaceMap(targetMentionCounts, plan.targetCounts);
    // Persist desired counts even on a partial failure, so the next click can
    // continue filling the same deficit instead of accepting a lower target.
    plugin.ui.setExpectedMentionCounts(targetMentionCounts);
    return plan;
  }

  function validateExpectedMentions(
    editor,
    knownCandidates,
    failures,
    materialsChanged
  ) {
    const names = new Set([
      ...knownCandidates,
      ...plugin.state.expectedMentionCounts.keys()
    ]);
    const matches = matcher.matchPromptToCandidates(
      plugin.editor.plainText(editor),
      Array.from(names)
    );
    const counts = plugin.editor.countPairedCandidateMentions(editor, matches);
    const targetFailures = matcher.mentionTargetFailures(
      plugin.state.expectedMentionCounts,
      counts,
      knownCandidates,
      { materialsChanged }
    );
    for (const [name, reason] of targetFailures) {
      // Keep the actionable insertion error; a final count is only a fallback.
      if (!failures.has(name)) failures.set(name, reason);
    }
  }

  function unpairedNativeReferences(editor, candidateNames) {
    const matches = matcher.matchPromptToCandidates(plugin.editor.plainText(editor), candidateNames);
    const names = Array.from(new Set(matches.map((match) => match.name)));
    const all = plugin.editor.countCandidateMentions(editor, names);
    const paired = plugin.editor.countPairedCandidateMentions(editor, matches);
    return new Map(names.filter((name) => (all.get(name) || 0) > (paired.get(name) || 0))
      .map((name) => [name, "存在未贴在原文字后的同名标签，请先检查并删除错位或重复标签"]));
  }

  function extraMaterialMessage(names) {
    return names.length
      ? `可能多传 ${names.length} 项：${names.map((name) => `@${name}`).join("、")}`
      : "";
  }

  function compactNames(names, limit = 5) {
    const unique = Array.from(new Set(names || []));
    const visible = unique.slice(0, limit).map((name) => `@${name}`).join("、");
    return unique.length > limit ? `${visible} 等 ${unique.length} 项` : visible;
  }

  function failureToastMessage(failures, highlightedCount, unexpectedMaterials) {
    const entries = Array.from(failures || []);
    const missing = entries.filter(([, reason]) => /未找到同名|菜单中没有/u.test(reason));
    const incomplete = entries.filter(([, reason]) =>
      /数量不足|引用缺少|缺少相邻|没有确认生成|结果尚未确认/u.test(reason));
    const lines = [
      `匹配未完成：还有 ${Math.max(highlightedCount || 0, entries.length)} 处文字占位尚未配对。`
    ];
    if (missing.length) {
      lines.push(`本次上传素材中找不到：${compactNames(missing.map(([name]) => name))}`);
    }
    if (incomplete.length) {
      lines.push(`原文字后缺少原生标签：${compactNames(incomplete.map(([name]) => name))}`);
    }
    if (unexpectedMaterials.length) {
      lines.push(`疑似多传：${compactNames(unexpectedMaterials)}`);
    }
    const misplaced = entries.filter(([, reason]) => /未贴在原文字后/.test(reason));
    if (misplaced.length) {
      lines.push(`发现错位或重复标签：${compactNames(misplaced.map(([name]) => name))}，请先手动检查并删除多余标签。`);
    }
    const explained = new Set([...missing, ...incomplete, ...misplaced].map(([name]) => name));
    for (const [name, reason] of entries.filter(([name]) => !explained.has(name)).slice(0, 3)) {
      lines.push(`@${name}：${reason}`);
    }
    lines.push("原来的 @素材名 会保留；处理提示的问题后，再点“自动匹配”。");
    return lines.join("\n");
  }

  // One immutable name catalogue feeds the pass. A fresh native picker is
  // still opened for each click because Dreamina creates the mention at the
  // current Slate caret, but the full upload list is never rediscovered here.
  async function executePass({
    candidateNames,
    editor,
    failures,
    label,
    prompt,
    targetMentionCounts,
    successes
  }) {
    if (!candidateNames.length) return { matchCount: 0, rowsFound: false };
    const plan = candidateMatches(
      editor,
      prompt,
      candidateNames,
      targetMentionCounts
    );
    const operations = plan.matches
      .map((match) => ({ action: "insert", match }))
      .sort((a, b) => b.match.start - a.match.start);
    const operationOptions = {
      assertEditorCurrent: () => assertMatchingEditorCurrent(editor)
    };

    for (let index = 0; index < operations.length; index += 1) {
      const { match } = operations[index];
      assertMatchingEditorCurrent(editor);
      plugin.ui.toast(
        `${label} ${index + 1}/${operations.length}：@${match.name}`,
        "info",
        12000
      );
      const result = await insertWithRetry(editor, match, operationOptions);
      if (result.ok) {
        successes.push(match.name);
        failures.delete(match.name);
      } else {
        failures.set(match.name, result.reason);
      }
      // Once a native row has been clicked, Dreamina can still commit it after
      // our confirmation timeout. Moving the caret to another slot during that
      // uncertain window can create duplicate or misplaced purple boxes, so
      // stop this run immediately. A later manual run re-checks adjacency and
      // skips the slot if the delayed native mention eventually appeared.
      if (!result.ok && (result.clicked || result.uncertain || result.stopRun)) break;
    }
    return { matchCount: operations.length, rowsFound: true };
  }

  // Native mentions are masked by editor.plainText. Every explicit @ reference
  // remains visible; only slots without an adjacent native mention are handled.
  async function runMatching(button, preferredEditor = null) {
    if (plugin.state.matching || plugin.state.localUploading) return;
    const bgmEditor = plugin.editor.findEditor();
    if (!preferredEditor || preferredEditor === bgmEditor) plugin.bgm?.flush(bgmEditor);
    const verifiedBeforeRun = plugin.state.matchStatusVerified;
    const verifiedEditorBeforeRun = plugin.state.matchStatusEditor;
    plugin.state.matching = true;
    matchingInterrupted = false;
    plugin.ui.setMatchControlsBusy?.(true);
    plugin.ui.invalidateMatchStatus();
    button.disabled = true;
    button.textContent = "匹配中…";

    try {
      const activeEditor = plugin.editor.findEditor();
      if (preferredEditor && (
        !document.contains(preferredEditor) || activeEditor !== preferredEditor
      )) {
        const error = new Error(
          "提示词输入框已切换，已停止自动匹配，请重新点击。"
        );
        error.code = "EDITOR_CHANGED_DURING_MATCHING";
        throw error;
      }
      const editor = preferredEditor || activeEditor;
      if (!editor) throw new Error("没有找到提示词输入框");
      const canvasMaterials = reconcileCanvasMaterialState(editor);
      const failedMaterials = canvasMaterials?.filter((item) => item.status === "failed") || [];
      if (failedMaterials.length) {
        const error = new Error(`${failedMaterials.length} 项素材上传失败：${compactNames(failedMaterials.map((item) => item.name))}。请点击“自动上传”重试失败项；已成功的素材和提示词会保留。`);
        error.code = "CANVAS_UPLOAD_FAILED";
        throw error;
      }
      if (canvasMaterials?.some((item) => item.status === "uploading")) {
        throw new Error("画布素材仍在上传，请等上传完成后再点击“自动匹配”。");
      }
      plugin.ui.trackMatchStatusEditor(editor);
      const wasVerifiedForEditor = verifiedBeforeRun &&
        verifiedEditorBeforeRun === editor;
      const materialsChangedBeforeRun = plugin.ui.materialBaselineChanged(editor);

      plugin.editor.clearHighlights();
      const prompt = plugin.editor.plainText(editor);
      const requested = matcher.parsePromptReferences(prompt);
      if (!matcher.normalizeText(prompt)) throw new Error("提示词是空的");

      const successes = [];
      const failures = new Map();
      // Automatic upload deliberately leaves its dispatched names pending.
      // The exact local filenames are already a trustworthy immutable match
      // list when it covers the entire prompt. Mixed batches can also contain
      // manually uploaded video/audio, so discover the full catalogue if any
      // reference is outside this local batch instead of ending after images.
      const pendingNames = pendingLocalUploadNames(editor);
      const localNames = Array.from(new Set([...verifiedLocalUploadNames(editor), ...pendingNames]
        .map((name) => matcher.normalizeAssetName(name)).filter(Boolean)));
      const localReferenceStarts = new Set(pendingNames.length
        ? matcher.matchPromptToCandidates(prompt, localNames).map((match) => match.start)
        : []);
      const usesPendingLocalNames = !plugin.canvas?.formFor?.(editor) && pendingNames.length > 0 &&
        requested.every((reference) => localReferenceStarts.has(reference.start));
      plugin.ui.toast(
        usesPendingLocalNames
          ? `正在按本批 ${pendingNames.length} 个文件名逐项匹配…`
          : "正在读取素材菜单…",
        "info",
        12000
      );
      const candidateNames = usesPendingLocalNames
        ? Object.freeze(localNames)
        : await acquireCandidateCatalog(editor);
      if (usesPendingLocalNames) {
        plugin.ui.setActiveMatchCandidateNames?.(editor, candidateNames);
      }
      assertMatchingEditorCurrent(editor);
      const syntaxErrors = matcher.promptReferenceErrors(prompt);
      if (syntaxErrors.length) {
        plugin.ui.toast(syntaxErrors.join("\n"), "warning", 10000);
        return;
      }
      // A pending-name list is intentionally not a full web catalogue. Never
      // prune the verified upload ledger from that partial set.
      const removedVerifiedNames = usesPendingLocalNames
        ? []
        : pruneVerifiedLocalUploadsFromCandidateCatalog(editor, candidateNames);
      // A complete native catalogue is also evidence for references added
      // manually or restored after refresh. Only canvas has stable node IDs.
      if (!usesPendingLocalNames && plugin.canvas?.uploadStateFor?.(editor)) {
        markLocalUploadVerified(editor, candidateNames);
      }
      if (removedVerifiedNames.length) {
        plugin.ui.toast(
          `检测到 ${removedVerifiedNames.length} 项已确认素材已从网页目录移除；` +
          "本次只检查匹配，下次点“自动上传”会按本地文件名精确补传。",
          "warning",
          9000
        );
      }
      const knownCandidates = new Set(candidateNames);
      // Generic parsing deliberately stops at whitespace and may also absorb
      // CJK prose. Candidate-aware matching owns the exact filename boundary.
      // Remember which original @ starts resolved so a valid full filename is
      // never re-reported later under a truncated generic name.
      const resolvedRequestedStarts = new Set(
        matcher.matchPromptToCandidates(prompt, candidateNames)
          .map((match) => match.start)
      );
      const targetMentionCounts = currentMentionTargets(
        editor,
        prompt,
        candidateNames
      );
      const orphaned = unpairedNativeReferences(editor, candidateNames);
      if (orphaned.size) {
        plugin.ui.setMatchFailures(orphaned);
        plugin.ui.toast("发现未贴在原文字后的同名标签。请先删除错位或重复标签，再点击匹配；原文字不会被删除。", "warning", 10000);
        return;
      }
      const firstPass = await executePass({
        candidateNames,
        editor,
        failures,
        label: "正在匹配",
        prompt,
        targetMentionCounts,
        successes
      });
      if (!firstPass.rowsFound) {
        const names = plugin.editor.highlightReferences(editor, requested);
        plugin.ui.setMatchFailures(new Map(
          names.map((name) => [name, "当前素材菜单中没有这个素材"])
        ));
        throw new Error(
          `素材菜单为空，已标红 ${plugin.state.highlightCount} 处：` +
          names.map((name) => `@${name}`).join("、")
        );
      }
      const totalMatchCount = firstPass.matchCount;

      // One pass intentionally issues at most one click per slot. Give the last
      // Slate mutation a short settle window, then verify exact adjacency; do
      // not launch a second pass while a clicked mention may still be pending.
      await plugin.sleep(240);
      assertMatchingEditorCurrent(editor);
      const finalPrompt = plugin.editor.plainText(editor);
      const finalPlan = candidateMatches(
        editor,
        finalPrompt,
        candidateNames,
        targetMentionCounts
      );
      plugin.editor.highlightReferences(
        editor,
        [...finalPlan.matches, ...matcher.missingPromptReferences(finalPrompt, candidateNames)
          .filter((reference) => !plugin.editor.isMatchPaired(editor, reference))],
        { exactPositions: true }
      );
      const remainingCandidateNames = new Set(
        finalPlan.matches.map((match) => match.name)
      );
      // A clicked row may commit just after the operation timeout. The final
      // adjacency check is authoritative: clear an earlier uncertain failure
      // when every slot for that known name is now paired, while retaining the
      // failure if even one same-name occurrence is still incomplete.
      for (const name of knownCandidates) {
        if (!remainingCandidateNames.has(name)) failures.delete(name);
      }
      for (const match of finalPlan.matches) {
        if (!failures.has(match.name)) {
          failures.set(match.name, "原文字后仍缺少相邻的原生素材标签");
        }
      }

      // Generic parsing also preserves clear missing-file feedback for prompt
      // names that do not appear in the authoritative upload catalogue.
      for (const reference of requested) {
        if (resolvedRequestedStarts.has(reference.start)) continue;
        if (!knownCandidates.has(reference.name) && !failures.has(reference.name)) {
          failures.set(reference.name, usesPendingLocalNames
            ? "不在已知上传文件名单中，请核对文件名；本批完成后可再次检查完整目录"
            : "当前素材菜单中没有这个素材");
        }
      }

      validateExpectedMentions(
        editor,
        knownCandidates,
        failures,
        materialsChangedBeforeRun
      );
      for (const [name, reason] of unpairedNativeReferences(editor, candidateNames)) failures.set(name, reason);
      // A pending upload is reconciled only after every requested name has an
      // actual native mention in the editor. This keeps a failed/early match
      // pending without another upload, while a successful pass writes the
      // task-local verified ledger and clears the guard.
      if (pendingNames.length) {
        const mentionCounts = plugin.editor.countCandidateMentions(
          editor,
          candidateNames
        );
        const confirmedPendingNames = [];
        const unconfirmedPendingNames = [];
        for (const name of pendingNames) {
          const nativeName = nativeNameForUpload(name, candidateNames);
          if ((mentionCounts.get(nativeName) || 0) < 1) {
            unconfirmedPendingNames.push(name);
            if (!failures.has(name)) {
              failures.set(name, "尚未确认生成对应的原生素材标签");
            }
          } else {
            confirmedPendingNames.push(name);
          }
        }
        // Reconciliation proves upload availability, not that every unrelated
        // prompt reference matched. Once each pending name has an exact native
        // mention, write that upload ledger even if an unrelated reference
        // is missing from the full catalogue.
        if (confirmedPendingNames.length) {
          markLocalUploadVerified(editor, confirmedPendingNames);
        }
        if (!unconfirmedPendingNames.length) {
          reconcileLocalUploadFromCandidateCatalog(editor, candidateNames);
        } else if (uploadWasRejected(editor)) {
          // The page explicitly rejected this batch. A manual matching pass is
          // the recovery checkpoint: keep confirmed names in the ledger, then
          // unlock only the missing names for a later selective re-upload.
          clearLocalUploadReconcile(editor);
          plugin.ui.toast(
            `已确认 ${confirmedPendingNames.length} 项；` +
            `其余 ${unconfirmedPendingNames.length} 项可再次点击“自动上传”补传。`,
            "warning",
            9000
          );
        }
      }

      // Never run the "possibly over-uploaded" review against a partial local
      // name list or a failed/uncertain pass. The recording's false modal was
      // produced from text already damaged by the old bare-@ insertion path.
      const unexpectedMaterials = !usesPendingLocalNames && !failures.size
        ? plugin.ui.reviewCandidateUsage(editor, candidateNames)
        : [];

      if (!totalMatchCount && !requested.length) {
        const existingCounts = plugin.editor.countCandidateMentions(
          editor,
          candidateNames
        );
        const hasExistingNative = Array.from(existingCounts.values())
          .some((count) => count > 0);
        const verifiedFallback = wasVerifiedForEditor &&
          !materialsChangedBeforeRun;
        if (!failures.size &&
          (verifiedFallback || hasExistingNative || unexpectedMaterials.length)) {
          plugin.ui.markMatchVerified(editor, existingCounts);
          if (unexpectedMaterials.length) {
            plugin.ui.toast(
              `${extraMaterialMessage(unexpectedMaterials)}。这些素材已上传，` +
              "但提示词中没有引用，请确认是否多上传了。",
              "warning",
              9000
            );
            plugin.ui.showUnexpectedMaterialsReview(unexpectedMaterials);
          } else {
            plugin.ui.toast("现有原生素材引用检查完成", "success", 3200);
          }
          return;
        }
        if (!failures.size) {
          throw new Error("没有找到与已上传素材完全同名的文字");
        }
      }

      if (failures.size) {
        plugin.ui.setMatchFailures(failures);
        plugin.ui.toast(
          failureToastMessage(
            failures,
            plugin.state.highlightCount,
            unexpectedMaterials
          ),
          "warning",
          9000
        );
      } else {
        const finalMatches = matcher.matchPromptToCandidates(
          finalPrompt,
          candidateNames
        );
        const actualCounts = plugin.editor.countPairedCandidateMentions(
          editor,
          finalMatches
        );
        plugin.ui.markMatchVerified(editor, actualCounts);
        if (unexpectedMaterials.length) {
          plugin.ui.toast(
            `引用匹配完成；${extraMaterialMessage(unexpectedMaterials)}。` +
            "这些素材已上传，但提示词中没有引用。",
            "warning",
            9000
          );
        } else {
          const completedNames = Array.from(new Set(successes));
          plugin.ui.toast(
            completedNames.length
              ? `匹配完成：共 ${Array.from(actualCounts.values()).reduce((sum, count) => sum + count, 0)} 处引用。原文已保留，请检查标签后再生成。`
              : "引用标签已齐全，无需重复匹配。",
            "success",
            5000
          );
        }
      }
      if (unexpectedMaterials.length) {
        plugin.ui.showUnexpectedMaterialsReview(unexpectedMaterials);
      }
    } finally {
      plugin.canvas?.cleanupPicker?.();
      plugin.state.matching = false;
      button.disabled = false;
      button.textContent = "自动匹配";
      plugin.ui.setMatchControlsBusy?.(false);
    }
  }

  const editorSelector =
    '[data-slate-editor="true"], [contenteditable="true"][role="textbox"], [contenteditable="true"]';
  const ignoredPluginSelector = [
    '[data-jimeng-bgm]',
    `#${plugin.constants.buttonId}`,
    `#${plugin.constants.confirmId}`,
    `#${plugin.constants.controlsId}`,
    `#${plugin.constants.extraConfirmId}`,
    `#${plugin.constants.helpButtonId}`,
    `#${plugin.constants.localUploadButtonId}`,
    `#${plugin.constants.onboardingId}`,
    `#${plugin.constants.overlayId}`,
    `#${plugin.constants.statusId}`,
    `#${plugin.constants.toastId}`
  ].join(",");

  function asElement(node) {
    return node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement || null;
  }

  function isWithin(node, selector) {
    const element = asElement(node);
    return Boolean(element?.matches?.(selector) || element?.closest?.(selector));
  }

  function contains(node, selector) {
    const element = asElement(node);
    return Boolean(element?.matches?.(selector) || element?.querySelector?.(selector));
  }

  function changedNodes(mutation) {
    return [...mutation.addedNodes, ...mutation.removedNodes];
  }

  function nodeIsInsideEditor(node, editor) {
    return Boolean(node && editor && (node === editor || editor.contains?.(node)));
  }

  function changedNodeTouchesEditor(node, editor) {
    return nodeIsInsideEditor(node, editor) || Boolean(node?.contains?.(editor));
  }

  function mutationTouchesEditor(mutation, editor) {
    return nodeIsInsideEditor(mutation.target, editor) ||
      changedNodes(mutation).some((node) => changedNodeTouchesEditor(node, editor));
  }

  // Ignore mutations created by the extension itself. For page mutations,
  // invalidate only the caches that can actually have changed.
  const layoutVisibilityAttributes = new Set([
    "aria-hidden",
    "class",
    "data-state",
    "hidden",
    "open",
    "style"
  ]);
  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.filter((mutation) => {
      const changed = changedNodes(mutation);
      return mutation.type === "childList"
        ? !changed.length || !changed.every((node) => isWithin(node, ignoredPluginSelector))
        : !isWithin(mutation.target, ignoredPluginSelector);
    });
    if (!relevant.length) return;
    const layoutOnly = relevant.every((mutation) =>
      mutation.type === "attributes" &&
      layoutVisibilityAttributes.has(mutation.attributeName)
    );
    if (layoutOnly) {
      // SPA result/detail views may reuse the same DOM and only toggle a class,
      // style or aria state. Re-run the lightweight top-layer hit test so an
      // already-mounted dock cannot remain above the result media.
      plugin.ui.scheduleMatchControlPosition();
      if (!document.getElementById(plugin.constants.statusId)) {
        plugin.ui.updateMatchStatus();
      }
      return;
    }
    const contentDirty = relevant.some((mutation) =>
      isWithin(mutation.target, editorSelector) ||
      changedNodes(mutation).some((node) => contains(node, editorSelector))
    );
    if (contentDirty) plugin.bgm?.schedule();
    const trackedEditor = plugin.state.matchStatusEditor;
    const materialsDirty = relevant.some((mutation) =>
      (!trackedEditor || !mutationTouchesEditor(mutation, trackedEditor)) && (
        isWithin(mutation.target, 'img, video, audio, [data-slot="generation-material-slot"]') ||
        changedNodes(mutation).some((node) => contains(node, 'img, video, audio, [data-slot="generation-material-slot"]'))
      )
    );
    const statusContentDirty = trackedEditor
      ? relevant.some((mutation) => mutationTouchesEditor(mutation, trackedEditor))
      : contentDirty;
    const trackedEditorCleared = Boolean(
      trackedEditor && statusContentDirty && !plugin.state.matching &&
      !matcher.normalizeText(plugin.editor.plainText(trackedEditor))
    );

    if (!document.getElementById(plugin.constants.buttonId) ||
      !document.getElementById(plugin.constants.localUploadButtonId)) {
      clearTimeout(plugin.state.installTimer);
      plugin.state.installTimer = setTimeout(() => {
        plugin.ui.installMatchButton(runMatching);
        plugin.ui.installLocalUploadButton?.(runLocalUpload);
      }, 250);
    }
    if (trackedEditorCleared) {
      // React/Slate may clear the composer without a trusted input event after
      // submission. Focus reconciliation can also expose a transient empty
      // tree, so require the same editor to stay empty before treating it as a
      // real task boundary.
      clearTimeout(promptEmptyTimer);
      promptEmptyTimer = setTimeout(() => {
        if (
          plugin.state.matchStatusEditor === trackedEditor &&
          document.contains(trackedEditor) &&
          !plugin.state.matching &&
          !matcher.normalizeText(plugin.editor.plainText(trackedEditor))
        ) {
          plugin.ui.resetMatchSession();
        }
      }, 120);
    } else if (statusContentDirty && !plugin.state.matching) {
      clearTimeout(promptEmptyTimer);
      scheduleTaskStateRebase(trackedEditor);
      plugin.ui.updateMatchStatus({ contentDirty: true, materialsDirty });
    } else {
      plugin.ui.updateMatchStatus({
        contentDirty: statusContentDirty,
        materialsDirty
      });
    }
    plugin.editor.refreshHighlights();
  });
  observer.observe(document.documentElement, {
    attributeFilter: [
      "aria-hidden",
      "aria-busy",
      "data-material-type",
      "class",
      "data-state",
      "hidden",
      "open",
      "src",
      "poster",
      "style"
    ],
    attributes: true,
    childList: true,
    characterData: true,
    subtree: true
  });

  plugin.ui.installMatchButton(runMatching);
  plugin.ui.installLocalUploadButton?.(runLocalUpload);
  preloadLocalDirectory();
  plugin.ui.installAssetChangeGuard();
  plugin.ui.installSendGuard();
  plugin.ui.updateMatchStatus();
  document.addEventListener("pointerdown", (event) => {
    if (event.isTrusted) interruptMatching();
  }, true);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") interruptMatching();
  });
  window.addEventListener("blur", interruptMatching);
  window.addEventListener("pagehide", interruptMatching);
  document.addEventListener("beforeinput", (event) => {
    if (plugin.state.matching || !event.isTrusted) return;
    const trackedEditor = plugin.state.matchStatusEditor;
    const editedEditor = trackedEditor && nodeIsInsideEditor(event.target, trackedEditor)
      ? trackedEditor
      : null;
    if (!editedEditor) return;
    const selectedText = scope.getSelection?.()?.toString() || "";
    const prompt = plugin.editor.plainText(editedEditor);
    if (!matcher.selectionReplacesPrompt(prompt, selectedText)) return;
    promptResetEditor = editedEditor;
    clearTimeout(promptResetTimer);
    promptResetTimer = setTimeout(() => {
      if (promptResetEditor === editedEditor) promptResetEditor = null;
    }, 500);
  }, true);
  document.addEventListener("input", (event) => {
    const trackedEditor = plugin.state.matchStatusEditor;
    const statusContentDirty = !trackedEditor ||
      nodeIsInsideEditor(event.target, trackedEditor);
    if (!statusContentDirty) {
      plugin.ui.updateMatchStatus();
      return;
    }
    if (!plugin.state.matching) {
      const currentPrompt = trackedEditor
        ? plugin.editor.plainText(trackedEditor)
        : "";
      if (trackedEditor && !matcher.normalizeText(currentPrompt)) {
        promptResetEditor = null;
        promptRebaseDropsPlain = false;
        clearTimeout(promptResetTimer);
        clearTimeout(promptEditTimer);
        clearTimeout(promptEmptyTimer);
        plugin.ui.resetMatchSession();
        plugin.editor.refreshHighlights(event);
        return;
      }
      const promptWasReplaced = Boolean(
        event.isTrusted && trackedEditor && promptResetEditor === trackedEditor
      );
      promptResetEditor = null;
      clearTimeout(promptResetTimer);
      scheduleTaskStateRebase(trackedEditor, {
        dropPlainTargets: promptWasReplaced
      });
      plugin.ui.updateMatchStatus({ contentDirty: true });
    } else {
      plugin.ui.updateMatchStatus({ contentDirty: true });
    }
    plugin.editor.refreshHighlights(event);
  }, true);
  document.addEventListener("scroll", (event) => {
    plugin.editor.refreshHighlights(event);
    plugin.ui.scheduleMatchControlPosition();
  }, { capture: true, passive: true });
  document.addEventListener("pointermove", (event) => {
    if (event.buttons) plugin.ui.scheduleMatchControlPosition();
  }, { capture: true, passive: true });
  for (const type of ["pointerup", "pointercancel"]) {
    document.addEventListener(
      type,
      () => plugin.ui.scheduleMatchControlPosition(),
      { capture: true, passive: true }
    );
  }
  window.addEventListener("resize", (event) => {
    plugin.editor.refreshHighlights(event);
    plugin.ui.scheduleMatchControlPosition();
  }, { passive: true });
  for (const type of ["resize", "scroll"]) {
    scope.visualViewport?.addEventListener(
      type,
      () => plugin.ui.scheduleMatchControlPosition(),
      { passive: true }
    );
  }
})(globalThis);
