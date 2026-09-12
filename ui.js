(function createUi(scope) {
  "use strict";

  const plugin = scope.JimengAssetPlugin;
  const {
    matchPromptToCandidates,
    normalizeText,
    pruneInactiveMentionTargets,
    unexpectedCandidateNames
  } = scope.JimengAssetMatcher;
  const {
    buttonId,
    confirmId,
    controlsId,
    extraConfirmId,
    helpButtonId,
    localUploadButtonId,
    onboardingId,
    statusId,
    toastId
  } = plugin.constants;
  let cachedCreditCounter = null;
  let cachedCreditSendButton = null;
  let cachedSendButton = null;
  let cachedSendEditor = null;
  let geometryObserver = null;
  let lastComposerContext = null;
  let materialCheckTimer = null;
  let matchControlsSuppressed = false;
  let observedGeometryTargets = [];
  let positionFrame = null;

  function setControlsVisibility(controls, visible) {
    controls.style.visibility = visible ? "visible" : "hidden";
    controls.dataset.visible = String(visible);
  }

  function buttonLabel(element) {
    return normalizeText(
      element.innerText || element.textContent ||
      element.getAttribute("aria-label") || element.getAttribute("title") || ""
    );
  }

  // Small notices sit at the viewport top, away from the prompt editor.
  function toast(message, kind = "info", duration = 3600) {
    let element = document.getElementById(toastId);
    if (!element) {
      element = document.createElement("div");
      element.id = toastId;
      const icon = document.createElement("span");
      icon.className = "jam-toast-icon";
      icon.setAttribute("aria-hidden", "true");
      const content = document.createElement("div");
      content.className = "jam-toast-content";
      content.setAttribute("role", "status");
      content.setAttribute("aria-live", "polite");
      content.setAttribute("aria-atomic", "true");
      const detail = document.createElement("div");
      detail.className = "jam-toast-detail";
      content.appendChild(detail);
      const close = document.createElement("button");
      close.type = "button";
      close.className = "jam-toast-close";
      close.setAttribute("aria-label", "关闭提示");
      close.textContent = "×";
      close.addEventListener("click", () => {
        element.__jamDismiss();
      });
      element.appendChild(icon);
      element.appendChild(content);
      element.appendChild(close);
      element.__jamParts = { icon, detail };
      element.__jamDismiss = () => {
        clearTimeout(plugin.state.toastTimer);
        clearTimeout(element.__jamExitTimer);
        element.dataset.leaving = "true";
        element.__jamExitTimer = setTimeout(() => element.remove(), 130);
      };
      element.__jamResume = () => {
        clearTimeout(plugin.state.toastTimer);
        if (element.__jamHovered || element.__jamFocused || element.dataset.leaving === "true") return;
        plugin.state.toastTimer = setTimeout(element.__jamDismiss, element.__jamDuration);
      };
      element.addEventListener("mouseenter", () => {
        element.__jamHovered = true;
        clearTimeout(plugin.state.toastTimer);
      });
      element.addEventListener("focusin", () => {
        element.__jamFocused = true;
        clearTimeout(plugin.state.toastTimer);
      });
      element.addEventListener("mouseleave", () => {
        element.__jamHovered = false;
        element.__jamResume();
      });
      element.addEventListener("focusout", (event) => {
        element.__jamFocused = element.contains(event.relatedTarget);
        element.__jamResume();
      });
      document.documentElement.appendChild(element);
    }
    clearTimeout(element.__jamExitTimer);
    delete element.dataset.leaving;
    element.dataset.kind = kind;
    const progress = kind === "info" && /…$/.test(message);
    element.dataset.progress = String(progress);
    const { icon, detail } = element.__jamParts;
    icon.textContent = kind === "success" ? "✓" : kind === "error" ? "!" : kind === "warning" ? "!" : "i";
    detail.textContent = message;
    element.__jamDuration = Math.max(duration, Math.min(16000, String(message).length * 85));
    element.__jamResume();
  }

  function installControlTooltip(controls, button, description, hint = description) {
    const tooltip = document.createElement("span");
    tooltip.id = `${button.id}-hint`;
    tooltip.className = "jam-control-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.textContent = hint;
    button.setAttribute("aria-label", button.textContent);
    button.setAttribute("aria-describedby", tooltip.id);
    button.setAttribute("aria-description", description);
    controls.appendChild(tooltip);
  }

  function ensureMatchControls() {
    // v0.3.7/0.3.8 injected a permanent “说明” button. Remove a stale copy
    // immediately after an extension reload; the guide is now first-use only.
    document.getElementById(helpButtonId)?.remove();
    let controls = document.getElementById(controlsId);
    if (controls) return controls;
    controls = document.createElement("div");
    controls.id = controlsId;
    controls.setAttribute("role", "group");
    controls.setAttribute("aria-label", "素材匹配控制");
    document.documentElement.appendChild(controls);
    return controls;
  }

  // The optional button is anchored beside the status lamp and no longer
  // depends on whether Dreamina's native menu is already open.
  function installMatchButton(onMatch) {
    if (document.getElementById(buttonId)) return;
    const controls = ensureMatchControls();
    const button = document.createElement("button");
    button.id = buttonId;
    button.type = "button";
    button.textContent = "自动匹配";
    let editorAtPointerDown = null;
    const preserveEditorFocus = (event) => {
      // The browser moves focus on mousedown, before click fires. Capture the
      // active creation editor and cancel that default. Do not call focus()
      // here: Infinite Canvas expands its prompt card asynchronously on focus,
      // which used to freeze the dock inside the newly expanded editor.
      editorAtPointerDown = resolveActiveComposerContext()?.editor ||
        plugin.editor.findEditor?.() || null;
      event.preventDefault();
      event.stopPropagation();
    };
    button.addEventListener("pointerdown", preserveEditorFocus);
    button.addEventListener("mousedown", preserveEditorFocus);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const preferredEditor = editorAtPointerDown ||
        resolveActiveComposerContext()?.editor ||
        plugin.editor.findEditor?.() || null;
      editorAtPointerDown = null;
      onMatch(button, preferredEditor).catch((error) => {
        console.error("[即梦素材匹配]", error);
        toast(error?.message || "匹配失败，请重试", "error", 6000);
      });
    });
    controls.insertBefore(button, controls.children[0] || null);
    installControlTooltip(controls, button,
      `第 2 步 · 自动匹配。在 @素材名 后添加原生标签，保留原文。v${plugin.version || "development"}`,
      "为 @素材名 配对标签，保留原文");
  }

  // Upload and matching are deliberately separate manual phases. Holding
  // Shift intentionally replaces the remembered folder without adding
  // another permanent control to the dock.
  function installLocalUploadButton(onUpload) {
    if (document.getElementById(localUploadButtonId)) return;
    const controls = ensureMatchControls();
    const button = document.createElement("button");
    button.id = localUploadButtonId;
    button.type = "button";
    button.textContent = "自动上传";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      button.setAttribute("aria-busy", "true");
      onUpload(button, { forceDirectory: event.shiftKey === true }).catch((error) => {
        if (error?.name === "AbortError") {
          toast("已取消选择文件夹", "info", 2600);
          return;
        }
        console.error("[即梦本地素材上传]", error);
        toast(error?.message || "本地素材上传失败，请重试", "error", 8000);
      }).finally(() => button.setAttribute("aria-busy", "false"));
    });
    const matchButton = controls.querySelector?.(`#${buttonId}`) || null;
    controls.insertBefore(button, matchButton);
    installControlTooltip(controls, button,
      "第 1 步 · 自动上传。只上传提示词中 @ 引用的图片、视频和音频。上传完成后，点击“自动匹配”。Shift + 点击：更换文件夹或重新扫描。",
      "上传 @ 引用的素材，再点自动匹配\nShift + 点击：更换文件夹 / 重新扫描");
  }

  function closeOnboarding({ remember = true } = {}) {
    const backdrop = document.getElementById(onboardingId);
    if (!backdrop) return;
    const previousFocus = backdrop.__jimengPreviousFocus;
    backdrop.remove();
    if (remember) {
      plugin.onboarding?.markSeen?.().catch((error) => {
        console.warn("[即梦使用说明] 无法保存已读状态", error);
      });
    }
    if (previousFocus?.focus && document.contains(previousFocus)) {
      previousFocus.focus({ preventScroll: true });
    }
  }

  async function forgetSelectedDirectory(button) {
    if (button) button.disabled = true;
    try {
      const result = await scope.JimengLocalDirectory?.clearDirectoryHandle?.();
      plugin.state.localDirectoryHandle = null;
      plugin.state.localAssetIndex = null;
      plugin.state.localAssetIndexHandle = null;
      if (result?.legacyCleared === false) {
        toast(
          "当前页面已忘记文件夹；请关闭仍运行旧版插件的页面，旧授权随后会自动清理。",
          "warning",
          8000
        );
      } else {
        toast("已忘记当前文件夹；下次自动上传会重新选择。", "success", 4200);
      }
    } catch (error) {
      console.error("[即梦使用说明] 清除文件夹失败", error);
      toast("没有清除成功，请刷新页面后重试。", "error", 5200);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function showOnboarding({ automatic = false } = {}) {
    const existing = document.getElementById(onboardingId);
    if (existing) return existing;
    if (automatic && (
      plugin.state.localUploading || plugin.state.matching ||
      document.getElementById(confirmId) ||
      document.getElementById(extraConfirmId)
    )) return null;
    if (!automatic) plugin.state.onboardingAutoHandled = true;

    const backdrop = document.createElement("div");
    backdrop.id = onboardingId;
    backdrop.dataset.automatic = automatic ? "true" : "false";
    backdrop.__jimengPreviousFocus = document.activeElement;

    const card = document.createElement("div");
    card.className = "jam-onboarding-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "jam-onboarding-title");

    const eyebrow = document.createElement("div");
    eyebrow.className = "jam-onboarding-eyebrow";
    eyebrow.textContent = `即梦素材一键匹配 v${plugin.version || ""}`.trim();
    const title = document.createElement("h2");
    title.id = "jam-onboarding-title";
    title.textContent = "素材就位，只需两步";
    const lead = document.createElement("p");
    lead.className = "jam-onboarding-lead";
    lead.textContent = "写好 @素材名，先上传素材，再为每处引用添加原生标签。普通页和画布都这样用。";
    const example = document.createElement("div");
    example.className = "jam-onboarding-example";
    example.textContent = "图片文件：角色_正面.png\n提示词：@角色_正面，向镜头挥手。";

    const list = document.createElement("ol");
    list.className = "jam-onboarding-steps";
    for (const step of plugin.onboarding?.steps || []) {
      const item = document.createElement("li");
      const heading = document.createElement("strong");
      heading.textContent = step.title;
      const text = document.createElement("span");
      text.textContent = step.text;
      item.appendChild(heading);
      item.appendChild(text);
      list.appendChild(item);
    }

    const note = document.createElement("p");
    note.className = "jam-onboarding-note";
    note.textContent = "提示：按住 Shift 再点“自动上传”，可重新选择并强制重扫文件夹。";

    const actions = document.createElement("div");
    actions.className = "jam-onboarding-actions";
    const forget = document.createElement("button");
    forget.type = "button";
    forget.dataset.action = "forget-directory";
    forget.textContent = "忘记已选文件夹";
    const start = document.createElement("button");
    start.type = "button";
    start.dataset.action = "start";
    start.textContent = "开始使用";
    actions.appendChild(forget);
    actions.appendChild(start);

    card.appendChild(eyebrow);
    card.appendChild(title);
    card.appendChild(lead);
    card.appendChild(example);
    card.appendChild(list);
    card.appendChild(note);
    card.appendChild(actions);
    backdrop.appendChild(card);
    backdrop.addEventListener("click", (event) => {
      const action = event.target.closest?.("[data-action]")?.dataset.action;
      if (action === "forget-directory") {
        event.preventDefault();
        return void forgetSelectedDirectory(event.target.closest("button"));
      }
      if (event.target === backdrop || action === "start") closeOnboarding();
    });
    document.documentElement.appendChild(backdrop);
    start.focus({ preventScroll: true });
    return backdrop;
  }

  function maybeShowFirstUseGuide() {
    if (plugin.state.onboardingAutoHandled ||
      plugin.state.onboardingCheckStarted ||
      plugin.state.localUploading || plugin.state.matching ||
      document.getElementById(onboardingId) ||
      document.getElementById(confirmId) ||
      document.getElementById(extraConfirmId)) return;
    plugin.state.onboardingCheckStarted = true;
    Promise.resolve(plugin.onboarding?.hasSeen?.())
      .then((seen) => {
        const mayOpen = !seen && !plugin.state.onboardingAutoHandled &&
          !plugin.state.localUploading && !plugin.state.matching &&
          !document.getElementById(onboardingId) &&
          !document.getElementById(confirmId) &&
          !document.getElementById(extraConfirmId) &&
          resolveActiveComposerContext();
        plugin.state.onboardingAutoHandled = true;
        if (mayOpen) {
          showOnboarding({ automatic: true });
        }
      })
      .catch((error) => {
        // Storage failure must not create an automatic popup loop.
        plugin.state.onboardingAutoHandled = true;
        console.warn("[即梦使用说明] 无法读取已读状态", error);
      })
      .finally(() => {
        plugin.state.onboardingCheckStarted = false;
      });
  }

  function deeplyVisible(element) {
    if (!element || !document.contains(element) || !plugin.isVisible(element)) {
      return false;
    }
    if (typeof element.checkVisibility === "function") {
      try {
        if (!element.checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true
        })) return false;
      } catch (_error) {
        // Older Chromium builds accept no options; the geometry check above
        // remains the conservative fallback.
      }
    }
    return true;
  }

  function pointBelongsTo(element, x, y) {
    if (typeof document.elementFromPoint !== "function") return true;
    const hit = document.elementFromPoint(x, y);
    if (!hit) return false;
    // A top-layer result/detail shell may itself contain the historical
    // composer in the DOM. Treat only the element (or one of its descendants)
    // as active; an ancestor hit is not proof that the control is unobscured.
    return hit === element || element.contains?.(hit);
  }

  function unobscured(element) {
    if (!deeplyVisible(element)) return false;
    const rect = element.getBoundingClientRect();
    const viewportWidth = scope.innerWidth ||
      document.documentElement?.clientWidth || Infinity;
    const viewportHeight = scope.innerHeight ||
      document.documentElement?.clientHeight || Infinity;
    if (rect.right <= 0 || rect.bottom <= 0 ||
      rect.left >= viewportWidth || rect.top >= viewportHeight) {
      return false;
    }
    const x = Math.max(rect.left + 1, Math.min(
      rect.right - 1,
      rect.left + rect.width / 2
    ));
    const y = Math.max(rect.top + 1, Math.min(
      rect.bottom - 1,
      rect.top + rect.height / 2
    ));
    return pointBelongsTo(element, x, y);
  }

  // A result/detail overlay can leave the old creation editor connected and
  // geometrically visible underneath it. CSS visibility alone therefore is
  // insufficient: both the editor and its actual send control must still own
  // their topmost hit-test points.
  function isActiveCreationComposer(editor, sendButton) {
    const canvasForm = plugin.canvas?.formFor(editor);
    if (canvasForm) {
      return sendButton === plugin.canvas.sendButton(editor) &&
        unobscured(plugin.canvas.editorArea(editor)) && unobscured(sendButton);
    }
    if (!editor || !sendButton || !unobscured(editor) || !unobscured(sendButton)) {
      return false;
    }
    const editorRect = editor.getBoundingClientRect();
    const sendRect = sendButton.getBoundingClientRect();
    return editorRect.width >= 280 && editorRect.height >= 36 &&
      sendRect.width >= 24 && sendRect.width <= 72 &&
      sendRect.height >= 24 && sendRect.height <= 72;
  }

  function isSendCandidate(element, editorRect) {
    if (!document.contains(element) || !plugin.isVisible(element) ||
      element.closest?.('[data-jimeng-bgm]') ||
      (element.id === buttonId || element.id === localUploadButtonId ||
        element.id === helpButtonId) ||
      element.closest(`#${confirmId}, #${extraConfirmId}, #${onboardingId}`)) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    const label = `${buttonLabel(element)} ${element.getAttribute("aria-label") || ""}`
      .toLowerCase();
    const regenerate = /再次生成|重新生成|重新编辑|generate again|regenerate/.test(label);
    const referenceControl = /^[＠@]$/u.test(buttonLabel(element)) ||
      /mention|reference|at[-_ ]?sign|素材引用|引用素材|参考|参照|メンション/i
        .test(label);
    if (regenerate || referenceControl) return false;
    const semantic = /send|submit|发送|生成|送信/.test(label);
    const controlSized = rect.width >= 30 && rect.width <= 62 &&
      rect.height >= 30 && rect.height <= 62;
    const nearEditor = rect.left <= editorRect.right + 24 &&
      rect.right >= editorRect.right - 92 &&
      rect.top >= editorRect.bottom - 125 &&
      rect.bottom <= editorRect.bottom + 125;
    return nearEditor && (semantic || controlSized);
  }

  function findSendButton(editor = plugin.editor.findEditor()) {
    if (!editor) return null;
    if (plugin.canvas?.formFor(editor)) return plugin.canvas.sendButton(editor);
    if (cachedSendEditor !== editor) {
      cachedSendButton = null;
      cachedSendEditor = editor;
    }
    const editorRect = editor.getBoundingClientRect();
    if (cachedSendButton && isSendCandidate(cachedSendButton, editorRect)) {
      return cachedSendButton;
    }

    // Cache the stable send control so scroll-driven status positioning does
    // not scan every page button repeatedly.
    const candidates = Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter((element) => isSendCandidate(element, editorRect))
      .map((element) => ({ element, right: element.getBoundingClientRect().right }))
      .sort((a, b) => b.right - a.right);
    cachedSendButton = candidates[0]?.element || null;
    return cachedSendButton;
  }

  function composerRootFor(editor, sendButton, nativeAtButton) {
    if (!editor || !sendButton || !nativeAtButton) return null;
    const editorRect = editor.getBoundingClientRect();
    let node = editor.parentElement;
    for (let depth = 0; node && depth < 10; depth += 1) {
      if (node === document.body || node === document.documentElement) break;
      if (node.contains?.(sendButton) && node.contains?.(nativeAtButton)) {
        const rect = node.getBoundingClientRect();
        const compactWidth = rect.width <= Math.max(editorRect.width + 360, 720);
        const compactHeight = rect.height <= Math.max(editorRect.height + 260, 360);
        if (rect.width >= editorRect.width && rect.height >= editorRect.height &&
          compactWidth && compactHeight && deeplyVisible(node)) {
          return node;
        }
      }
      node = node.parentElement;
    }
    return null;
  }

  function resolveActiveComposerContext(editor = resolveMatchStatusEditor(), { allowDisabledSend = false } = {}) {
    if (!editor) return null;
    const sendButton = findSendButton(editor);
    const active = isActiveCreationComposer(editor, sendButton);
    if (!active && !(allowDisabledSend && sendButton?.disabled &&
      unobscured(plugin.canvas?.editorArea(editor) || editor))) return null;
    const nativeAtButton = plugin.nativeTrigger?.findNativeButton?.(editor, { toolbarOnly: true }) || null;
    if (!active && !unobscured(nativeAtButton)) return null;
    const canvasForm = plugin.canvas?.formFor(editor);
    if (canvasForm && nativeAtButton && canvasForm.contains(nativeAtButton)) {
      return { composerRoot: canvasForm, editor, nativeAtButton, sendButton };
    }
    if (nativeAtButton && !sameControl(sendButton, nativeAtButton)) {
      const sendRect = sendButton.getBoundingClientRect();
      const atRect = nativeAtButton.getBoundingClientRect();
      // A horizontally clipped Infinite Canvas control can fail the topmost
      // hit test even though it still belongs to the live composer. The exact
      // shared compact root is the safer identity check here.
      if (sendRect.right > atRect.right + 8) {
        const composerRoot = composerRootFor(editor, sendButton, nativeAtButton);
        if (composerRoot) {
          lastComposerContext = {
            composerRoot,
            editor,
            nativeAtButton,
            sendButton
          };
          return lastComposerContext;
        }
      }
    }

    // Some canvas toolbar pages temporarily unmount @ altogether. Reuse only
    // the last fully verified context for this same connected editor; never
    // discover a new page from editor/send geometry alone.
    const previous = lastComposerContext;
    if (!nativeAtButton && previous?.editor === editor &&
      document.contains(previous.composerRoot) &&
      previous.composerRoot.contains?.(editor) &&
      previous.composerRoot.contains?.(sendButton) &&
      sameControl(previous.sendButton, sendButton) &&
      deeplyVisible(previous.composerRoot)) {
      return { ...previous, nativeAtButton: null, sendButton };
    }
    return null;
  }

  function isCreditCounter(element, sendRect) {
    if (!element || !document.contains(element) || !plugin.isVisible(element)) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    const text = normalizeText(element.innerText || element.textContent);
    return /\d{1,4}/.test(text) && text.length <= 8 &&
      rect.right <= sendRect.left + 4 && rect.left >= sendRect.left - 130 &&
      Math.abs((rect.top + rect.bottom) / 2 -
        (sendRect.top + sendRect.bottom) / 2) < 28;
  }

  function findCreditCounter(sendButton) {
    const sendRect = sendButton.getBoundingClientRect();
    if (cachedCreditSendButton === sendButton &&
      isCreditCounter(cachedCreditCounter, sendRect)) {
      return cachedCreditCounter;
    }
    let scope = sendButton.parentElement;
    if (scope?.getBoundingClientRect().width < 100) scope = scope.parentElement;
    if (!scope) {
      cachedCreditCounter = null;
      cachedCreditSendButton = sendButton;
      return null;
    }
    const candidates = Array.from(scope.querySelectorAll("span, div"))
      .filter((element) => isCreditCounter(element, sendRect));
    candidates.sort(
      (a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right
    );
    cachedCreditCounter = candidates[0] || null;
    cachedCreditSendButton = sendButton;
    return cachedCreditCounter;
  }

  function matchControlLayout(
    composerRect,
    _counterRect,
    controlsWidth,
    controlsHeight,
    viewportWidth,
    viewportHeight
  ) {
    // The dock belongs outside the prompt card, aligned with its upper-right
    // corner. Anchoring to the send key put it inside the bottom toolbar and
    // made old hidden composers leak controls over result/detail pages.
    const composerRight = composerRect.right ??
      (composerRect.left + (composerRect.width || 0));
    const preferredTop = composerRect.top - controlsHeight - 10;
    const left = Math.max(
      8,
      Math.min(composerRight - controlsWidth, viewportWidth - controlsWidth - 8)
    );
    const top = Math.max(
      8,
      Math.min(
        preferredTop,
        viewportHeight - controlsHeight - 8
      )
    );
    return { left, top };
  }

  function observeMatchGeometry(editor, sendButton, composerRoot, nativeAtButton) {
    if (typeof scope.ResizeObserver !== "function") return;
    const targets = [editor, sendButton, composerRoot, nativeAtButton]
      .filter(Boolean);
    if (targets.length === observedGeometryTargets.length &&
      targets.every((target, index) => target === observedGeometryTargets[index])) {
      return;
    }
    geometryObserver ||= new scope.ResizeObserver(scheduleMatchControlPosition);
    geometryObserver.disconnect();
    for (const target of targets) geometryObserver.observe(target);
    observedGeometryTargets = targets;
  }

  function positionMatchControlsNow(preferredContext = null) {
    const controls = document.getElementById(controlsId);
    const indicator = document.getElementById(statusId);
    const button = document.getElementById(buttonId);
    if (!controls) return;
    // The native popup opens into the same space above an Infinite Canvas
    // prompt card. Hide the dock for the whole operation so it neither follows
    // expansion animations nor covers candidate rows.
    if (matchControlsSuppressed || plugin.state.matching) {
      setControlsVisibility(controls, false);
      return;
    }
    setControlsVisibility(controls, false);
    const context = preferredContext || resolveActiveComposerContext();
    plugin.theme?.follow(context?.editor);
    plugin.bgm?.mount(context || resolveActiveComposerContext(undefined, { allowDisabledSend: true }));
    if (!indicator || !button || !context) return;
    const { composerRoot, editor, nativeAtButton, sendButton } = context;
    const uploadButton = document.getElementById(localUploadButtonId);
    if (uploadButton) uploadButton.style.removeProperty("display");
    const controlsRect = controls.getBoundingClientRect();
    const layout = matchControlLayout(
      composerRoot.getBoundingClientRect(),
      null,
      controlsRect.width || 252,
      controlsRect.height || 34,
      scope.innerWidth || document.documentElement.clientWidth,
      scope.innerHeight || document.documentElement.clientHeight
    );
    controls.style.left = `${layout.left}px`;
    controls.style.top = `${layout.top}px`;
    controls.dataset.tooltipSide = layout.top < 128 ? "bottom" : "top";
    const hintSpace = layout.top < 128
      ? (scope.innerHeight || document.documentElement.clientHeight) - layout.top - (controlsRect.height || 34) - 14
      : layout.top - 14;
    controls.style.setProperty?.("--jam-hint-space", `${Math.max(48, hintSpace)}px`);
    setControlsVisibility(controls, true);
    observeMatchGeometry(editor, sendButton, composerRoot, nativeAtButton);
  }

  // Geometry-only updates run at most once per animation frame. They never
  // parse prompt text or rescan material thumbnails.
  function scheduleMatchControlPosition() {
    if (matchControlsSuppressed || plugin.state.matching) {
      const controls = document.getElementById(controlsId);
      if (controls) setControlsVisibility(controls, false);
      return;
    }
    if (positionFrame !== null) return;
    const requestFrame = scope.requestAnimationFrame ||
      ((callback) => setTimeout(callback, 16));
    positionFrame = requestFrame(() => {
      positionFrame = null;
      positionMatchControlsNow();
    });
  }

  function setMatchControlsBusy(active) {
    matchControlsSuppressed = Boolean(active);
    plugin.bgm?.render();
    const controls = document.getElementById(controlsId);
    if (matchControlsSuppressed) {
      if (controls) setControlsVisibility(controls, false);
      return;
    }
    scheduleMatchControlPosition();
  }

  // Track uploaded thumbnails beside the prompt editor, excluding inline
  // mention thumbnails.
  function materialImages(editor) {
    const editorRect = editor.getBoundingClientRect();
    return Array.from(document.images)
      .filter((image) => {
        if (editor.contains(image)) return false;
        const rect = image.getBoundingClientRect();
        const thumbnailSize = rect.width >= 12 && rect.width <= 180 &&
          rect.height >= 12 && rect.height <= 180;
        const nearEditor = rect.right >= editorRect.left - 240 &&
          rect.left <= editorRect.left + 100 &&
          rect.bottom >= editorRect.top - 48 &&
          rect.top <= editorRect.bottom + 48;
        return thumbnailSize && nearEditor;
      });
  }

  // Removing or replacing an uploaded thumbnail invalidates green.
  function materialSignature(editor) {
    const canvasSignature = plugin.canvas?.materialSignature?.(editor);
    if (canvasSignature !== null && canvasSignature !== undefined) return canvasSignature;
    return materialImages(editor)
      .map((image) => `${image.currentSrc || image.src}|${image.alt || ""}`)
      .sort()
      .join("\n");
  }

  function uploadedMaterialCount(editor) {
    const slots = plugin.canvas?.materialSlots?.(editor);
    if (slots) return slots.length;
    return editor ? materialImages(editor).length : 0;
  }

  function sameControl(first, second) {
    return Boolean(first && second && (
      first === second || first.contains?.(second) || second.contains?.(first)
    ));
  }

  // A small control is related to an upload only when it is geometrically
  // adjacent to the thumbnail. Sharing a large composer ancestor is not
  // enough: the send arrow lives in that same ancestor.
  function isMaterialThumbnailControl(control, editor) {
    if (!control || !editor) return false;
    const controlRect = control.getBoundingClientRect();
    if (controlRect.width > 44 || controlRect.height > 44) return false;
    return materialImages(editor).some((image) => {
      const imageRect = image.getBoundingClientRect();
      const horizontalGap = Math.max(
        imageRect.left - controlRect.right,
        controlRect.left - imageRect.right,
        0
      );
      const verticalGap = Math.max(
        imageRect.top - controlRect.bottom,
        controlRect.top - imageRect.bottom,
        0
      );
      return horizontalGap <= 24 && verticalGap <= 24;
    });
  }

  function shouldCheckMaterialControl(control, editor) {
    const sendButton = findSendButton(editor);
    return !sameControl(control, sendButton) &&
      isMaterialThumbnailControl(control, editor);
  }

  function clearMatchVerification({ clearMaterialBaseline = false } = {}) {
    plugin.state.matchStatusVerified = false;
    plugin.state.verifiedEditorSignature = null;
    if (clearMaterialBaseline) plugin.state.verifiedMaterialSignature = null;
  }

  // Slate changes caret/selection scaffolding when the editor merely receives
  // focus. Compare the prompt's semantic state instead of treating every DOM
  // mutation or input event as a real edit. Native mention text is masked with
  // NUL by editor.plainText(), so remove that mask and explicit zero-width
  // scaffolding from the source-text part of the signature.
  function editorVerificationSignature(editor) {
    if (!editor) return "";
    const prompt = plugin.editor.plainText(editor);
    const source = String(prompt || "")
      .replace(/[\u0000\u200B-\u200D\u2060\uFEFF]/gu, "")
      .replace(/\u00a0/gu, " ")
      .normalize("NFC");
    const names = Array.from(new Set([
      ...plugin.state.candidateNamesSnapshot,
      ...plugin.state.expectedMentionCounts.keys(),
      ...plugin.state.statusFailureDetails.keys()
    ].filter(Boolean))).sort();
    const mentionCounts = plugin.editor.countCandidateMentions
      ? plugin.editor.countCandidateMentions(editor, names)
      : new Map();
    const unpaired = plugin.editor.unpairedCandidateMatches
      ? plugin.editor.unpairedCandidateMatches(editor, names)
      : [];
    const unpairedCounts = new Map(names.map((name) => [name, 0]));
    for (const item of unpaired || []) {
      if (unpairedCounts.has(item?.name)) {
        unpairedCounts.set(item.name, unpairedCounts.get(item.name) + 1);
      }
    }
    return JSON.stringify({
      source,
      mentions: names.map((name) => [name, mentionCounts.get(name) || 0]),
      unpaired: names.map((name) => [name, unpairedCounts.get(name) || 0])
    });
  }

  function verifiedEditorChanged(editor) {
    return Boolean(
      editor &&
      plugin.state.matchStatusVerified &&
      plugin.state.matchStatusEditor === editor &&
      plugin.state.verifiedEditorSignature !== null &&
      plugin.state.verifiedEditorSignature !== editorVerificationSignature(editor)
    );
  }

  function setExpectedMentionCounts(counts) {
    plugin.state.expectedMentionCounts = new Map(
      Array.from(counts || []).filter(([, count]) => count > 0)
    );
  }

  function setMatchFailures(failures) {
    plugin.state.statusFailureDetails = new Map(
      Array.from(failures || []).filter(([name]) => normalizeText(name))
    );
    updateMatchStatus();
  }

  function materialNameSignature(names) {
    return Array.from(new Set(names || [])).sort().join("\n");
  }

  function unacknowledgedUnexpectedMaterials() {
    const names = plugin.state.unexpectedMaterialNames;
    const signature = materialNameSignature(names);
    return signature && signature !== plugin.state.acknowledgedUnexpectedSignature
      ? names.slice()
      : [];
  }

  function clearCandidateUsage() {
    plugin.state.acknowledgedUnexpectedSignature = "";
    plugin.state.candidateCatalogComplete = false;
    plugin.state.candidateCatalogEditor = null;
    plugin.state.candidateMaterialSignature = null;
    plugin.state.candidateNamesSnapshot = [];
    plugin.state.unexpectedMaterialNames = [];
    document.getElementById(extraConfirmId)?.remove();
  }

  function normalizedCandidateNames(candidateNames) {
    return Array.from(new Set(candidateNames || [])).filter((name) =>
      name && !plugin.candidates?.isSystemMenuEntry?.(name)
    );
  }

  // The catalogue contains primitive names only. DOM rows belong to one
  // short-lived native picker render and are never cached across insertions.
  function cacheCandidateCatalog(editor, candidateNames) {
    if (!editor) return [];
    const names = normalizedCandidateNames(candidateNames);
    plugin.state.candidateCatalogComplete = names.length > 0;
    plugin.state.candidateCatalogEditor = editor;
    plugin.state.candidateNamesSnapshot = names;
    plugin.state.candidateMaterialSignature = materialSignature(editor);
    return names.slice();
  }

  // Pending uploads carry an exact local filename set, but that set is not a
  // complete native catalogue. Keep it for adjacency/highlight status without
  // allowing readCandidateCatalog(), ledger pruning or extra-material review
  // to treat the partial set as authoritative.
  function setActiveMatchCandidateNames(editor, candidateNames) {
    if (!editor) return [];
    const names = normalizedCandidateNames(candidateNames);
    plugin.state.candidateCatalogComplete = false;
    plugin.state.candidateCatalogEditor = null;
    plugin.state.candidateMaterialSignature = null;
    plugin.state.candidateNamesSnapshot = names;
    plugin.state.acknowledgedUnexpectedSignature = "";
    plugin.state.unexpectedMaterialNames = [];
    plugin.state.statusContentDirty = true;
    document.getElementById(extraConfirmId)?.remove();
    return names.slice();
  }

  function readCandidateCatalog(editor) {
    if (!editor || !plugin.state.candidateCatalogComplete ||
      plugin.state.candidateCatalogEditor !== editor ||
      candidateMaterialsChanged(editor)) {
      if (plugin.state.candidateCatalogComplete) clearCandidateUsage();
      return [];
    }
    return plugin.state.candidateNamesSnapshot.slice();
  }

  // Compare the authoritative native menu with explicit @ prompt references
  // and existing native mentions. A stable signature preserves an explicit
  // "confirm keep" choice until the prompt or uploaded-material set changes.
  function reviewCandidateUsage(editor, candidateNames, { update = true } = {}) {
    if (!editor) return [];
    const names = cacheCandidateCatalog(editor, candidateNames);
    const counts = plugin.editor.countCandidateMentions(editor, names);
    const unexpected = unexpectedCandidateNames(
      plugin.editor.plainText(editor),
      names,
      counts
    );
    const signature = materialNameSignature(unexpected);
    if (plugin.state.acknowledgedUnexpectedSignature !== signature) {
      plugin.state.acknowledgedUnexpectedSignature = "";
    }
    plugin.state.unexpectedMaterialNames = unexpected;
    if (!unexpected.length) document.getElementById(extraConfirmId)?.remove();
    if (update) updateMatchStatus({ contentDirty: true });
    return unacknowledgedUnexpectedMaterials();
  }

  function acknowledgeUnexpectedMaterials() {
    plugin.state.acknowledgedUnexpectedSignature = materialNameSignature(
      plugin.state.unexpectedMaterialNames
    );
    document.getElementById(extraConfirmId)?.remove();
    updateMatchStatus({ contentDirty: true });
  }

  // Reconcile task state after every real editor change. Exact @ targets and
  // native mentions survive small edits, while names absent from the
  // current prompt are removed even when Slate skips an observable empty state.
  function rebaseExpectedMentionCounts(editor, { keepPlainTargets = true } = {}) {
    if (!editor || plugin.state.matching) return false;
    if (!keepPlainTargets) plugin.state.acknowledgedUnexpectedSignature = "";
    const prompt = plugin.editor.plainText(editor);
    const expectedNames = Array.from(plugin.state.expectedMentionCounts.keys());
    const failureNames = Array.from(plugin.state.statusFailureDetails.keys());
    const names = Array.from(new Set([...expectedNames, ...failureNames]));
    if (names.length) {
      const plainMatches = keepPlainTargets
        ? matchPromptToCandidates(prompt, names)
        : [];
      const currentCounts = plugin.editor.countPairedCandidateMentions
        ? plugin.editor.countPairedCandidateMentions(editor, plainMatches)
        : plugin.editor.countCandidateMentions(editor, names);
      setExpectedMentionCounts(pruneInactiveMentionTargets(
        plugin.state.expectedMentionCounts,
        currentCounts,
        plainMatches
      ));
      const activeNames = new Set([
        ...plainMatches.map((item) => item.name),
        ...Array.from(currentCounts)
          .filter(([, count]) => count > 0)
          .map(([name]) => name)
      ]);
      plugin.state.statusFailureDetails = new Map(
        Array.from(plugin.state.statusFailureDetails)
          .filter(([name, reason]) => {
            if (!activeNames.has(name)) return false;
            if (String(reason).includes("未贴在原文字后") && plugin.editor.countCandidateMentions) {
              const native = plugin.editor.countCandidateMentions(editor, [name]);
              if ((native.get(name) || 0) > (currentCounts.get(name) || 0)) return true;
            }
            const slots = plainMatches.filter((item) => item.name === name).length;
            // Clear a manually repaired slot's stale error only after exact
            // adjacency is verified; this does not grant overall green.
            return !plugin.editor.countPairedCandidateMentions || !slots ||
              (currentCounts.get(name) || 0) < slots;
          })
      );
    }
    if (plugin.state.candidateCatalogComplete &&
      plugin.state.candidateNamesSnapshot.length) {
      reviewCandidateUsage(editor, plugin.state.candidateNamesSnapshot, { update: false });
    }
    return Boolean(names.length || plugin.state.candidateNamesSnapshot.length);
  }

  // A submitted or cleared prompt is a hard task boundary. Dreamina reuses
  // the same Slate editor between tasks, so DOM identity alone cannot prevent
  // the previous task's targets and material baseline from leaking forward.
  function resetMatchSession() {
    clearMatchVerification({ clearMaterialBaseline: true });
    setExpectedMentionCounts(new Map());
    // Clearing/replacing the prompt while a dispatched upload is still being
    // verified is not a safe upload boundary. Preserve its per-editor pending
    // names so re-entering the prompt cannot dispatch the same files again.
    if (!plugin.state.localUploading) {
      plugin.state.localUploadNeedsReconcile = false;
      plugin.state.localUploadPendingNames = [];
      plugin.state.localUploadPendingByEditor = new WeakMap();
      plugin.state.localUploadRejectedByEditor = new WeakSet();
      plugin.state.localUploadReconcileEditor = null;
      plugin.state.localUploadVerifiedNamesByEditor = new WeakMap();
    }
    plugin.state.matchStatusEditor = null;
    plugin.state.statusContentDirty = true;
    plugin.state.statusFailureDetails = new Map();
    plugin.state.statusRemainingCount = 0;
    plugin.state.statusRemainingNames = [];
    plugin.state.materialCheckPending = false;
    clearCandidateUsage();
    cachedSendButton = null;
    cachedSendEditor = null;
    cachedCreditCounter = null;
    cachedCreditSendButton = null;
    lastComposerContext = null;
    clearTimeout(materialCheckTimer);
    clearTimeout(plugin.state.toastTimer);
    document.getElementById(toastId)?.remove();
    plugin.editor.clearHighlights?.();
    updateMatchStatus({ contentDirty: true });
  }

  // Once matching begins, keep status parsing and positioning attached to that
  // exact editor. Pages can display several historical prompt editors at once.
  function trackMatchStatusEditor(editor) {
    if (!editor || plugin.state.matchStatusEditor === editor) return;
    clearMatchVerification({ clearMaterialBaseline: true });
    setExpectedMentionCounts(new Map());
    plugin.state.matchStatusEditor = editor;
    plugin.state.statusContentDirty = true;
    plugin.state.statusFailureDetails = new Map();
    plugin.state.statusRemainingCount = 0;
    plugin.state.statusRemainingNames = [];
    plugin.state.materialCheckPending = false;
    clearCandidateUsage();
    cachedSendButton = null;
    cachedSendEditor = null;
    cachedCreditCounter = null;
    cachedCreditSendButton = null;
    // The dock may have already proved the composer before the first match.
    // Keep that exact editor-bound context while Infinite Canvas temporarily
    // unmounts its paged @ control; a genuinely different editor must start
    // with no inherited context.
    if (lastComposerContext?.editor !== editor) lastComposerContext = null;
  }

  function resolveMatchStatusEditor() {
    const tracked = plugin.state.matchStatusEditor;
    // Canvas can keep the previous node mounted. DOM connectivity alone must
    // not carry its green state or catalogue into another node's composer.
    const canvasTracked = tracked?.closest?.('form[data-testid="video-generation-form"]');
    const active = canvasTracked ? plugin.editor.findEditor() : null;
    if (tracked && document.contains(tracked) && (!canvasTracked || active === tracked)) return tracked;
    if (tracked) {
      clearMatchVerification({ clearMaterialBaseline: true });
      plugin.state.matchStatusEditor = null;
      setExpectedMentionCounts(new Map());
      plugin.state.statusContentDirty = true;
      plugin.state.statusFailureDetails = new Map();
      plugin.state.statusRemainingCount = 0;
      plugin.state.statusRemainingNames = [];
      plugin.state.materialCheckPending = false;
      clearCandidateUsage();
      cachedSendButton = null;
      cachedSendEditor = null;
      cachedCreditCounter = null;
      cachedCreditSendButton = null;
      lastComposerContext = null;
    }
    return plugin.editor.findEditor();
  }

  function materialBaselineChanged(editor) {
    return Boolean(editor && plugin.state.verifiedMaterialSignature !== null &&
      plugin.state.verifiedMaterialSignature !== materialSignature(editor));
  }

  function candidateMaterialsChanged(editor) {
    return Boolean(editor && plugin.state.candidateMaterialSignature !== null &&
      plugin.state.candidateMaterialSignature !== materialSignature(editor));
  }

  // The lamp and the confirmation dialog call this same evaluator. A pending
  // image mutation is reconciled synchronously, so their messages cannot
  // disagree during the status render debounce window.
  function evaluateMatchStatus(editor, { refreshContent = false } = {}) {
    if (!editor) {
      return {
        remaining: [],
        remainingCount: 0,
        unexpectedMaterials: [],
        verified: false
      };
    }
    if (plugin.state.materialCheckPending) {
      const materialsChanged = materialBaselineChanged(editor) ||
        candidateMaterialsChanged(editor);
      if (materialsChanged) {
        clearMatchVerification();
        clearCandidateUsage();
        plugin.state.statusContentDirty = true;
      }
    }
    plugin.state.materialCheckPending = false;
    let remaining = plugin.state.statusRemainingNames.map((name) => ({ name }));
    if (refreshContent || plugin.state.statusContentDirty) {
      remaining = plugin.editor.unpairedPromptReferences(editor, plugin.state.candidateNamesSnapshot);
      plugin.state.statusRemainingCount = remaining.length;
      plugin.state.statusRemainingNames = remaining.map((item) => item.name);
      plugin.state.statusContentDirty = false;
    }
    const remainingCount = plugin.state.statusRemainingCount;
    const unexpectedMaterials = unacknowledgedUnexpectedMaterials();
    const verified = plugin.state.matchStatusVerified &&
      plugin.state.matchStatusEditor === editor && !remainingCount &&
      !unexpectedMaterials.length;
    return { remaining, remainingCount, unexpectedMaterials, verified };
  }

  function warningMessage(remaining, unexpectedMaterials) {
    const messages = [];
    const failures = Array.from(plugin.state.statusFailureDetails);
    if (failures.length) {
      const visible = failures.slice(0, 6)
        .map(([name, reason]) => `@${name}：${reason}`)
        .join("\n");
      messages.push(failures.length > 6
        ? `${visible}\n另有 ${failures.length - 6} 项，请查看红色标记。`
        : visible);
    }
    if (unexpectedMaterials.length) {
      messages.push(
        `可能多传：${unexpectedMaterials.map((name) => `@${name}`).join("、")}\n` +
        "这些素材已上传，但提示词中没有引用。"
      );
    }
    const names = Array.from(new Set((remaining || []).map((item) => item.name)));
    if (!failures.length && names.length) {
      messages.push(`未匹配：${names.map((name) => `@${name}`).join("、")}`);
    }
    return messages.join("\n") ||
      "先写好 @素材名，再上传素材并点击“自动匹配”。";
  }

  // Render outside Dreamina's flex layout so the lamp cannot wrap or move the
  // credit counter and send button. Yellow means incomplete; green means done.
  function renderMatchStatus() {
    const editor = resolveMatchStatusEditor();
    const controls = ensureMatchControls();
    if (matchControlsSuppressed || plugin.state.matching) {
      setControlsVisibility(controls, false);
      return;
    }
    setControlsVisibility(controls, false);
    const context = resolveActiveComposerContext(editor);
    let indicator = document.getElementById(statusId);
    if (!context) return;
    maybeShowFirstUseGuide();

    if (!indicator) {
      indicator = document.createElement("span");
      indicator.id = statusId;
      indicator.setAttribute("role", "status");
      indicator.setAttribute("aria-live", "polite");
      indicator.tabIndex = 0;
    }
    let tooltip = indicator.querySelector(".jam-status-tooltip");
    if (!tooltip) {
      tooltip = document.createElement("span");
      tooltip.className = "jam-status-tooltip";
      tooltip.setAttribute("aria-hidden", "true");
      indicator.appendChild(tooltip);
    }
    if (indicator.parentElement !== controls) {
      controls.appendChild(indicator);
    }
    positionMatchControlsNow(context);

    // Prompt parsing and image scans are cached. Scroll/resize updates only
    // reposition the lamp instead of walking the editor and all images again.
    const {
      remaining,
      remainingCount,
      unexpectedMaterials,
      verified
    } = evaluateMatchStatus(editor);
    const state = verified
      ? "success"
      : "warning";
    const message = state === "warning"
      ? warningMessage(remaining, unexpectedMaterials)
      : "素材已经全部匹配完成";
    const caption = verified ? "已匹配" : remainingCount ? `待匹配 ${remainingCount}` : "待检查";
    const signature = `${state}:${remainingCount}:${message}`;
    if (indicator.dataset.signature === signature) return;
    indicator.dataset.signature = signature;
    indicator.dataset.state = state;
    indicator.dataset.caption = caption;
    tooltip.textContent = message;
    indicator.removeAttribute("title");
    indicator.setAttribute("aria-label", message);
  }

  function updateMatchStatus({ contentDirty = false, materialsDirty = false } = {}) {
    plugin.state.statusContentDirty ||= contentDirty;
    plugin.state.materialCheckPending ||= materialsDirty;
    scheduleMatchControlPosition();
    clearTimeout(plugin.state.statusTimer);
    plugin.state.statusTimer = setTimeout(renderMatchStatus, 100);
  }

  function invalidateMatchStatus(options = {}) {
    clearMatchVerification();
    updateMatchStatus(options);
  }

  function markMatchVerified(
    editor = plugin.editor.findEditor(),
    expectedCounts = plugin.state.expectedMentionCounts
  ) {
    if (!editor) return invalidateMatchStatus();
    trackMatchStatusEditor(editor);
    setExpectedMentionCounts(expectedCounts);
    plugin.state.statusFailureDetails = new Map();
    plugin.state.verifiedMaterialSignature = materialSignature(editor);
    // Candidate-menu thumbnails may have dirtied this flag during matching;
    // the fresh baseline already includes every relevant material change.
    plugin.state.materialCheckPending = false;
    plugin.state.matchStatusVerified = true;
    plugin.state.verifiedEditorSignature = editorVerificationSignature(editor);
    updateMatchStatus({ contentDirty: true });
  }

  function installAssetChangeGuard() {
    if (plugin.state.assetGuardInstalled) return;
    plugin.state.assetGuardInstalled = true;
    document.addEventListener("click", (event) => {
      if (plugin.state.matching || !plugin.state.matchStatusVerified) return;
      const control = event.target.closest?.('button, [role="button"]');
      if (!control) return;
      const editor = resolveMatchStatusEditor();
      if (!shouldCheckMaterialControl(control, editor)) return;

      // Check the actual thumbnail signature after the page handles the click.
      // Preview buttons and a cancelled file picker therefore stay green,
      // while real add/remove operations are still caught by this check or by
      // the MutationObserver.
      clearTimeout(materialCheckTimer);
      materialCheckTimer = setTimeout(
        () => updateMatchStatus({ materialsDirty: true }),
        120
      );
    }, true);
  }

  function closeConfirmation() {
    document.getElementById(confirmId)?.remove();
  }

  function closeUnexpectedMaterialsReview() {
    document.getElementById(extraConfirmId)?.remove();
  }

  function showUnexpectedMaterialsReview(
    names = unacknowledgedUnexpectedMaterials()
  ) {
    if (!names.length || document.getElementById(extraConfirmId)) return;
    const backdrop = document.createElement("div");
    backdrop.id = extraConfirmId;
    backdrop.innerHTML = `
      <div class="jam-confirm-card" role="dialog" aria-modal="true"
        aria-labelledby="jam-extra-material-title">
        <div id="jam-extra-material-title" class="jam-confirm-title">发现未使用的上传素材</div>
        <div class="jam-confirm-message"></div>
        <div class="jam-confirm-actions">
          <button type="button" data-action="check">返回检查</button>
          <button type="button" data-action="keep">确认保留</button>
        </div>
      </div>`;
    backdrop.querySelector(".jam-confirm-message").textContent =
      `以下本次上传素材没有在提示词中使用：\n` +
      `${names.map((name) => `@${name}`).join("、")}\n\n` +
      "如果确实需要保留，请选择“确认保留”；否则请返回删除。";
    backdrop.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (event.target === backdrop || action === "check") {
        return closeUnexpectedMaterialsReview();
      }
      if (action === "keep") acknowledgeUnexpectedMaterials();
    });
    document.documentElement.appendChild(backdrop);
    backdrop.querySelector('[data-action="check"]').focus();
  }

  // Both Enter and the black arrow require an explicit second click.
  function showConfirmation(editor, sendButton) {
    if (document.getElementById(confirmId)) return;
    if (plugin.bgm?.flush(editor) === false) {
      toast("背景音乐设置未写入，请等输入结束后重试。", "warning");
      return;
    }
    const snapshot = evaluateMatchStatus(editor, { refreshContent: true });
    const remaining = snapshot.remaining || [];
    const warnings = [];
    if (remaining.length) {
      warnings.push(
        `仍有未匹配引用：${remaining.map((item) => `@${item.name}`).join("、")}`
      );
    }
    if (snapshot.unexpectedMaterials.length) {
      warnings.push(
        `可能多传素材：${snapshot.unexpectedMaterials
          .map((name) => `@${name}`).join("、")}。请确认是否有意保留。`
      );
    }
    const status = warnings.join("\n") || (snapshot.verified
      ? "所有可识别引用均已处理。"
      : "素材匹配状态尚未通过，请先点击“自动匹配”完成检查。");

    const backdrop = document.createElement("div");
    backdrop.id = confirmId;
    backdrop.innerHTML = `
      <div class="jam-confirm-card" role="dialog" aria-modal="true" aria-labelledby="jam-confirm-title">
        <div id="jam-confirm-title" class="jam-confirm-title">确认发送生成任务？</div>
        <div class="jam-confirm-message"></div>
        <div class="jam-confirm-actions">
          <button type="button" data-action="cancel">取消</button>
          <button type="button" data-action="confirm">确认发送</button>
        </div>
      </div>`;
    backdrop.querySelector(".jam-confirm-message").textContent =
      `${status}\n点击“确认发送”后才会真正提交；Esc 可取消。`;
    backdrop.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (event.target === backdrop || action === "cancel") return closeConfirmation();
      if (action !== "confirm") return;
      closeConfirmation();
      plugin.state.bypassSendConfirmation = true;
      sendButton.click();
      // The native click has already been delivered. End this match session
      // immediately instead of waiting for Slate's asynchronous clear event.
      resetMatchSession();
      setTimeout(() => {
        plugin.state.bypassSendConfirmation = false;
      }, 0);
    });
    document.documentElement.appendChild(backdrop);
    backdrop.querySelector('[data-action="cancel"]').focus();
  }

  function handleClick(event) {
    const onboarding = document.getElementById(onboardingId);
    if (onboarding) {
      if (!onboarding.contains?.(event.target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    if (plugin.state.bypassSendConfirmation ||
      document.getElementById(confirmId) || document.getElementById(extraConfirmId) ||
      document.getElementById(onboardingId)) return;
    const clicked = event.target.closest?.('button, [role="button"]');
    if (!clicked) return;

    // Prefer the editor already bound to the green status. Historical prompt
    // cards can otherwise make findEditor() choose a different composer.
    let editor = resolveMatchStatusEditor();
    let sendButton = findSendButton(editor);
    if (!sameControl(clicked, sendButton)) {
      const fallbackEditor = plugin.editor.findEditor();
      if (fallbackEditor !== editor) {
        const fallbackSend = findSendButton(fallbackEditor);
        if (sameControl(clicked, fallbackSend)) {
          editor = fallbackEditor;
          sendButton = fallbackSend;
        }
      }
    }
    if (!sameControl(clicked, sendButton)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (plugin.state.localUploading || plugin.state.matching) {
      toast("素材正在上传或匹配，完成后再发送。", "warning", 4200);
      return;
    }
    showConfirmation(editor, sendButton);
  }

  function handleKeydown(event) {
    const onboarding = document.getElementById(onboardingId);
    if (onboarding) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        return closeOnboarding();
      }
      const focusable = Array.from(onboarding.querySelectorAll?.("button") || [])
        .filter((element) => !element.disabled);
      if (event.key === "Tab" && focusable.length) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const current = focusable.indexOf(document.activeElement);
        const offset = event.shiftKey ? -1 : 1;
        const next = current < 0
          ? (event.shiftKey ? focusable.length - 1 : 0)
          : (current + offset + focusable.length) % focusable.length;
        focusable[next].focus();
        return;
      }
      if (!onboarding.contains?.(event.target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        focusable[0]?.focus?.();
      }
      return;
    }
    if (event.key === "Escape" && document.getElementById(extraConfirmId)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return closeUnexpectedMaterialsReview();
    }
    if (event.key === "Escape" && document.getElementById(confirmId)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return closeConfirmation();
    }
    if (event.key !== "Enter" || event.shiftKey || event.isComposing ||
      document.getElementById(confirmId) || document.getElementById(extraConfirmId) ||
      document.getElementById(onboardingId)) return;

    const editor = plugin.editor.findEditor();
    if (!editor || !(event.target === editor || editor.contains(event.target))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (plugin.state.localUploading || plugin.state.matching) {
      toast("素材正在上传或匹配，完成后再发送。", "warning", 4200);
      return;
    }
    const sendButton = findSendButton(editor);
    if (sendButton) showConfirmation(editor, sendButton);
    else toast("没有找到发送按钮，任务尚未发送", "error", 5000);
  }

  function installSendGuard() {
    if (plugin.state.sendGuardInstalled) return;
    plugin.state.sendGuardInstalled = true;
    document.addEventListener("click", handleClick, true);
    document.addEventListener("keydown", handleKeydown, true);
  }

  plugin.ui = {
    evaluateMatchStatus,
    editorVerificationSignature,
    acknowledgeUnexpectedMaterials,
    cacheCandidateCatalog,
    installMatchButton,
    installLocalUploadButton,
    installAssetChangeGuard,
    installSendGuard,
    invalidateCandidateCatalog: clearCandidateUsage,
    isActiveCreationComposer,
    isMaterialThumbnailControl,
    invalidateMatchStatus,
    markMatchVerified,
    maybeShowFirstUseGuide,
    materialBaselineChanged,
    matchControlLayout,
    rebaseExpectedMentionCounts,
    readCandidateCatalog,
    resolveActiveComposerContext,
    reviewCandidateUsage,
    resetMatchSession,
    resolveMatchStatusEditor,
    scheduleMatchControlPosition,
    setMatchControlsBusy,
    setActiveMatchCandidateNames,
    setMatchFailures,
    showOnboarding,
    showUnexpectedMaterialsReview,
    shouldCheckMaterialControl,
    setExpectedMentionCounts,
    trackMatchStatusEditor,
    toast,
    uploadedMaterialCount,
    updateMatchStatus,
    verifiedEditorChanged
  };
})(globalThis);
