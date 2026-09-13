(function createNativeTrigger(scope) {
  "use strict";

  const plugin = scope.JimengAssetPlugin;
  const { normalizeText } = scope.JimengAssetMatcher;
  const { buttonId } = plugin.constants;
  const trustedButtonScopeByEditor = new WeakMap();

  function pickerIsOpen(editor) {
    if (plugin.canvas?.pickerIsOpen?.(editor)) return true;
    return plugin.candidates.visibleRows().some((row) => {
      const semanticPopup = row.element.closest('[role="listbox"], [role="menu"]');
      if (semanticPopup && plugin.isVisible(semanticPopup)) return true;
      let ancestor = row.element.parentElement;
      for (let depth = 0; ancestor && depth < 6; depth += 1) {
        const text = normalizeText(ancestor.innerText || ancestor.textContent);
        if (/メンション|素材|参考|reference|mention|「@」|使用.*@/i.test(text)) {
          return plugin.isVisible(ancestor);
        }
        ancestor = ancestor.parentElement;
      }
      return false;
    });
  }

  function nearEditorToolbar(element, editor) {
    if (!editor) return true;
    const rect = element.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    return rect.left >= editorRect.left - 40 &&
      rect.right <= editorRect.right + 40 &&
      rect.top >= editorRect.bottom - 140 &&
      rect.bottom <= editorRect.bottom + 80;
  }

  // Infinite Canvas keeps the prompt toolbar in a horizontally paged card.
  // Its @ control can remain mounted just outside the editor's visible width,
  // so a pure geometry test mistakes the current control for a historical
  // card.  Accept the clipped control only when it shares a compact DOM scope
  // with this exact editor; a page-wide ancestor (body/html) never qualifies.
  function editorContextScore(element, editor) {
    if (!element || !editor) return 0;
    const editorRect = editor.getBoundingClientRect?.() || {};
    let scope = editor.parentElement;
    for (let depth = 0; scope && depth < 10; depth += 1) {
      if (scope === document.body || scope === document.documentElement) break;
      if (scope.contains?.(element)) {
        // A canvas may keep many prompt cards under one transformed root. Only
        // a nearby ancestor can represent this editor's own card/toolbar.
        if (depth > 6) return 0;
        const rect = scope.getBoundingClientRect?.() || {};
        const width = Number(rect.width);
        const height = Number(rect.height);
        const hasGeometry = Number.isFinite(width) && Number.isFinite(height);
        const compactWidth = !hasGeometry || width <= Math.max(
          Number(editorRect.width || 0) + 360,
          760
        );
        const compactHeight = !hasGeometry || height <= Math.max(
          Number(editorRect.height || 0) + 280,
          420
        );
        return compactWidth && compactHeight ? Math.max(1, 12 - depth) : 0;
      }
      scope = scope.parentElement;
    }
    return 0;
  }

  function withinExtendedToolbarBand(element, editor) {
    if (!element || !editor) return false;
    const rect = element.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    return rect.left >= editorRect.left - 120 &&
      rect.right <= editorRect.right + 260 &&
      rect.top >= editorRect.bottom - 190 &&
      rect.bottom <= editorRect.bottom + 120;
  }

  function nativeButtonLabel(element) {
    const attributes = ["aria-label", "title", "data-testid", "data-tooltip", "data-icon"];
    const values = [element.innerText, element.textContent, element.className];
    for (const name of attributes) values.push(element.getAttribute?.(name));
    const icon = element.querySelector?.("svg, [aria-label], [title], [data-testid], [data-icon]");
    if (icon && icon !== element) {
      for (const name of attributes) values.push(icon.getAttribute?.(name));
      values.push(icon.className?.baseVal || icon.className);
    }
    return normalizeText(values.filter(Boolean).join(" "));
  }

  function isSemanticAtControl(element) {
    const label = nativeButtonLabel(element);
    const visibleText = normalizeText(element.innerText || element.textContent);
    if (visibleText === "@" || visibleText === "＠") return true;
    if (/上传|添加|删除|移除|upload|add|remove|delete/i.test(label)) return false;
    return /mention|reference|at[-_ ]?sign|素材引用|引用素材|参考|参照|メンション/i
      .test(label);
  }

  function candidateScore(element, editor, exactButtons) {
    if (!element || element.id === buttonId || element.closest?.('[data-jimeng-bgm]') || !plugin.isVisible(element)) {
      return -Infinity;
    }
    const nearToolbar = nearEditorToolbar(element, editor);
    const contextScore = editorContextScore(element, editor);
    if (!nearToolbar && !(contextScore && withinExtendedToolbarBand(element, editor))) {
      return -Infinity;
    }
    const rect = element.getBoundingClientRect();
    const editorRect = editor?.getBoundingClientRect();
    let score = exactButtons.has(element) ? 1000 : 500;
    if (nearToolbar) score += 120;
    // DOM ownership outranks icon implementation details. A historical card
    // can expose the exact same SVG and happen to overlap the canvas viewport.
    if (contextScore) score += 2000 + contextScore * 12;
    if (editorRect) {
      score -= Math.abs(rect.bottom - editorRect.bottom);
      score -= Math.max(rect.left - editorRect.right, editorRect.left - rect.right, 0);
    }
    return score;
  }

  // Prefer the current editor's toolbar. Historical task cards may expose the
  // same @ control, and Dreamina may render it as a non-button clickable node.
  function compactLeafSearchRoot(editor, forcedRoot = null) {
    if (forcedRoot?.querySelectorAll) return forcedRoot;
    if (!editor) return document;
    const editorRect = editor.getBoundingClientRect?.() || {};
    let node = editor.parentElement;
    let best = null;
    for (let depth = 0; node && depth < 7; depth += 1) {
      if (node === document.body || node === document.documentElement) break;
      const rect = node.getBoundingClientRect?.() || {};
      const width = Number(rect.width);
      const height = Number(rect.height);
      const compact = !Number.isFinite(width) || !Number.isFinite(height) || (
        width <= Math.max(Number(editorRect.width || 0) + 360, 760) &&
        height <= Math.max(Number(editorRect.height || 0) + 280, 420)
      );
      if (!compact) break;
      if (typeof node.querySelectorAll === "function") best = node;
      node = node.parentElement;
    }
    return best || document;
  }

  function findNativeButton(editor, { scopeRoot = null, toolbarOnly = false } = {}) {
    if (plugin.canvas?.formFor(editor)) return plugin.canvas.referenceButton(editor);
    const queryRoot = scopeRoot?.querySelectorAll ? scopeRoot : document;
    const exactButtons = new Set(
      Array.from(queryRoot.querySelectorAll("svg path[d]"))
        .filter((path) => String(path.getAttribute("d") || "")
          .startsWith("M12.81 2.1c1.31"))
        .map((path) => path.closest('button, [role="button"], [tabindex]'))
        .filter(Boolean)
    );
    const controls = Array.from(queryRoot.querySelectorAll(
      'button, [role="button"], [tabindex], [data-testid], [data-icon]'
    )).filter((element) => exactButtons.has(element) || isSemanticAtControl(element));

    // Some builds render the visible @ as a leaf inside a clickable div with
    // no role. Promote that leaf to the smallest toolbar-sized ancestor.
    const leafRoot = compactLeafSearchRoot(editor, scopeRoot);
    for (const leaf of leafRoot.querySelectorAll("span, div")) {
      if (!/^[＠@]$/u.test(normalizeText(leaf.innerText || leaf.textContent))) continue;
      let control = leaf;
      for (let depth = 0; control?.parentElement && depth < 3; depth += 1) {
        const rect = control.getBoundingClientRect();
        if (rect.width >= 24 && rect.width <= 72 && rect.height >= 24 && rect.height <= 72) {
          controls.push(control);
        }
        control = control.parentElement;
      }
    }

    return Array.from(new Set(controls))
      .filter((element) => !scopeRoot || scopeRoot.contains?.(element))
      .filter((element) => !toolbarOnly || !editor?.contains?.(element))
      .map((element) => ({ element, score: candidateScore(element, editor, exactButtons) }))
      .filter((item) => Number.isFinite(item.score))
      .sort((a, b) => b.score - a.score)[0]?.element || null;
  }

  function toolbarPagerLabel(element) {
    const icon = element?.querySelector?.("svg, path, [aria-label], [title]");
    return normalizeText([
      nativeButtonLabel(element),
      icon?.getAttribute?.("aria-label"),
      icon?.getAttribute?.("title"),
      icon?.getAttribute?.("data-testid"),
      icon?.className?.baseVal || icon?.className
    ].filter(Boolean).join(" "));
  }

  function isRightChevronIcon(element) {
    const paths = Array.from(element?.querySelectorAll?.("path, polyline") || []);
    return paths.some((path) => {
      try {
        if (typeof path.getTotalLength !== "function" ||
          typeof path.getPointAtLength !== "function") return false;
        const length = path.getTotalLength();
        if (!Number.isFinite(length) || length <= 0) return false;
        const matrix = path.getScreenCTM?.() || path.getCTM?.() || null;
        const screenPoint = (point) => matrix ? {
          x: matrix.a * point.x + matrix.c * point.y + matrix.e,
          y: matrix.b * point.x + matrix.d * point.y + matrix.f
        } : point;
        const start = screenPoint(path.getPointAtLength(0));
        const middle = screenPoint(path.getPointAtLength(length / 2));
        const end = screenPoint(path.getPointAtLength(length));
        const xSpan = Math.max(start.x, middle.x, end.x) -
          Math.min(start.x, middle.x, end.x);
        const ySpan = Math.max(start.y, middle.y, end.y) -
          Math.min(start.y, middle.y, end.y);
        return xSpan > 2 && ySpan > 3 &&
          middle.x > start.x + 1 && middle.x > end.x + 1 &&
          Math.abs(start.x - end.x) <= Math.max(2, xSpan * 0.45);
      } catch (_error) {
        return false;
      }
    });
  }

  // A few Infinite Canvas builds unmount the clipped @ control instead of
  // merely translating it. Reveal it only with a same-toolbar pager that has
  // explicit forward semantics, or an anonymous chevron whose transformed
  // screen geometry is unambiguously rightward. Rotated send arrows fail this
  // direction check and must never be guessed from button shape alone.
  function findToolbarRevealButton(editor) {
    if (!editor) return null;
    const editorRect = editor.getBoundingClientRect();
    const queryRoot = compactLeafSearchRoot(editor);
    const forward = /(?:^|[-_\s])(next|right|forward|more|pager|carousel|scroll)(?:$|[-_\s])|下一|向右|右翻|更多|展开|chevron[-_\s]?right|arrow[-_\s]?right/iu;
    const backward = /(?:^|[-_\s])(prev|previous|left|back)(?:$|[-_\s])|上一|向左|左翻|返回|chevron[-_\s]?left|arrow[-_\s]?left/iu;
    return Array.from(queryRoot.querySelectorAll('button, [role="button"], [tabindex]'))
      .filter((element) => {
        if (!element || element.id === buttonId || !plugin.isVisible(element) ||
          !editorContextScore(element, editor)) return false;
        const rect = element.getBoundingClientRect();
        const controlSized = rect.width >= 24 && rect.width <= 72 &&
          rect.height >= 24 && rect.height <= 72;
        const inToolbarBand = rect.top >= editorRect.bottom - 150 &&
          rect.bottom <= editorRect.bottom + 90 &&
          rect.left >= editorRect.left - 80 &&
          rect.right <= editorRect.right + 80;
        const label = toolbarPagerLabel(element);
        const explicitForward = forward.test(label) || isRightChevronIcon(element);
        return controlSized && inToolbarBand && explicitForward &&
          !backward.test(label) && !isSemanticAtControl(element) &&
          element.disabled !== true && element.getAttribute?.("aria-disabled") !== "true" &&
          !/send|submit|发送|生成|upload|上传|添加|delete|删除/iu.test(label);
      })
      .sort((first, second) =>
        second.getBoundingClientRect().right - first.getBoundingClientRect().right
      )[0] || null;
  }

  function editorScopeFor(element, editor) {
    if (!element || !editor) return null;
    let scope = editor.parentElement;
    for (let depth = 0; scope && depth < 10; depth += 1) {
      if (scope === document.body || scope === document.documentElement) break;
      if (scope.contains?.(element)) return scope;
      scope = scope.parentElement;
    }
    return null;
  }

  function pagerOwnsButton(pager, button, editor) {
    const scope = editorScopeFor(pager, editor);
    return Boolean(scope && button && scope.contains?.(button));
  }

  async function resolveNativeButton(editor) {
    // The new canvas has an explicit per-node form and a native reference
    // button, not the legacy paged toolbar. Never probe another node's pager.
    if (plugin.canvas?.formFor(editor)) return plugin.canvas.referenceButton(editor);
    // Reuse only this editor's already-proved toolbar scope. Re-resolve its
    // live button each time, avoiding a scan of every historical card per tag.
    const trustedScope = trustedButtonScopeByEditor.get(editor);
    const trustedScopeLive = Boolean(trustedScope &&
      (typeof document.contains !== "function" || document.contains(trustedScope)) &&
      trustedScope.contains?.(editor));
    if (trustedScopeLive) {
      const trustedButton = findNativeButton(editor, { scopeRoot: trustedScope });
      if (trustedButton) return trustedButton;
    }
    let button = findNativeButton(editor);
    let pager = findToolbarRevealButton(editor);
    let pagerScope = editorScopeFor(pager, editor);
    const scopedButton = pagerScope
      ? findNativeButton(editor, { scopeRoot: pagerScope })
      : null;
    if (scopedButton) return scopedButton;
    if (button && (
      pager && pagerOwnsButton(pager, button, editor) ||
      trustedScopeLive && trustedScope.contains?.(button)
    )) return button;
    if (button && !pager) {
      // On the first interaction, allow a focus-driven canvas toolbar one
      // short mount window before accepting a geometrically nearby @. This
      // prevents a historical card under the same canvas root from winning
      // just before the current card's pager appears. Later interactions reuse
      // the already-proved editor-local scope and stay fast.
      await plugin.sleep(120);
      pager = findToolbarRevealButton(editor);
      pagerScope = editorScopeFor(pager, editor);
      button = findNativeButton(editor);
      if (button && (
        pager && pagerOwnsButton(pager, button, editor) || !pager
      )) return button;
    }
    // Give the focus-driven canvas expansion a short settle window before
    // touching its pager, but do not pay a half-second delay for every slot.
    button = await plugin.waitFor(() => {
      const currentPager = findToolbarRevealButton(editor);
      const currentScope = editorScopeFor(currentPager, editor);
      const candidate = currentScope
        ? findNativeButton(editor, { scopeRoot: currentScope })
        : findNativeButton(editor);
      return candidate && (!currentPager ||
        pagerOwnsButton(currentPager, candidate, editor)) ? candidate : null;
    }, 160, 40);
    if (button) return button;
    pager = findToolbarRevealButton(editor);
    if (pager) {
      pagerScope = editorScopeFor(pager, editor);
      pager.click();
      button = await plugin.waitFor(() => {
        const candidate = pagerScope
          ? findNativeButton(editor, { scopeRoot: pagerScope })
          : findNativeButton(editor);
        return pagerOwnsButton(pager, candidate, editor) ? candidate : null;
      }, 520, 40);
      return button || null;
    }
    // A toolbar can mount later without a pager transition. Keep one bounded
    // fallback wait so a slow React frame fails safely instead of typing text.
    button = await plugin.waitFor(() => findNativeButton(editor), 360, 40);
    return button || null;
  }

  async function ensurePicker(editor, {
    beforeClick = null,
    requireFresh = false
  } = {}) {
    const outcome = (ok, reason) => {
      if (plugin.state) plugin.state.lastNativeTriggerResult = { ok, reason };
      return ok;
    };
    // Both modern Tiptap toolbars can retain the user's last typed @ query.
    // Own a separate one-character trigger before allowing any candidate click.
    const ownsTrigger = Boolean(plugin.canvas?.capturePicker &&
      editor.matches?.(".ProseMirror") &&
      (plugin.canvas.formFor(editor) || editor.closest?.('[class*="generator-"]')));
    // Avoid scanning every toolbar button when the user already opened the
    // picker manually.
    if (pickerIsOpen(editor)) {
      if (!requireFresh) return outcome(true, "picker-already-open");
      if (!ownsTrigger) return outcome(false, "picker-already-open");
      plugin.candidates.closePicker();
      if (!await plugin.waitFor(() => !pickerIsOpen(editor), 720, 40)) {
        return outcome(false, "picker-already-open");
      }
    }
    // Focusing Slate can rerender its toolbar, so locate the @ control only
    // after focus settles instead of clicking a detached pre-focus node.
    try {
      editor.focus({ preventScroll: true });
    } catch (_error) {
      editor.focus();
    }
    await plugin.sleep(0);
    if (plugin.canvas?.formFor(editor) && plugin.canvas.waitForEditorSettled &&
      !await plugin.canvas.waitForEditorSettled(editor)) {
      return outcome(false, "editor-not-settled");
    }
    let button = await resolveNativeButton(editor);
    if (!button) return outcome(false, "native-button-missing");
    if (button.getAttribute("aria-expanded") === "true") {
      return outcome(!requireFresh, "button-already-expanded");
    }
    const buttonScope = plugin.canvas?.formFor(editor) || editorScopeFor(button, editor);

    // Mention insertion must use Dreamina's own toolbar control. The caller
    // places a fresh exact caret immediately before this native click. Modern
    // editors additionally isolate the toolbar query from the source token.
    if (typeof beforeClick === "function" && await beforeClick(button) === false) {
      return outcome(false, "caret-placement-failed");
    }

    // Infinite Canvas mirrors DOM Selection into its Slate state on the next
    // microtask. Let that synchronization finish, then re-resolve the live
    // toolbar node because the same update may remount the paged toolbar.
    await plugin.sleep(0);
    const liveButton = findNativeButton(editor, { scopeRoot: buttonScope });
    if (!liveButton || buttonScope && !buttonScope.contains?.(liveButton)) {
      return outcome(false, "toolbar-changed");
    }
    button = liveButton;

    if (ownsTrigger && !plugin.canvas.capturePicker(editor)) return outcome(false, "capture-failed");
    button.click();
    if (ownsTrigger) {
      await plugin.sleep(0);
      if (!plugin.canvas.acceptPicker(editor)) return outcome(false, "trigger-changed");
    }
    const opened = await plugin.waitFor(
      () => pickerIsOpen(editor) || button.getAttribute("aria-expanded") === "true",
      1200,
      60
    );
    if (opened && buttonScope) trustedButtonScopeByEditor.set(editor, buttonScope);
    if (!opened && ownsTrigger) plugin.candidates.closePicker();
    return outcome(Boolean(opened), opened ? "opened" : "menu-timeout");
  }

  plugin.nativeTrigger = {
    ensurePicker,
    findNativeButton,
    findToolbarRevealButton
  };
})(globalThis);
