(function createCandidateAdapter(scope) {
  "use strict";

  const plugin = scope.JimengAssetPlugin;
  const { normalizeAssetName, normalizeText } = scope.JimengAssetMatcher;

  const candidateSelector = [
    '[role="option"]',
    '[role="menuitem"]',
    'li[class*="option"]',
    '.lv-select-option',
    '[class*="mention"][class*="item"]',
    '[class*="reference"][class*="item"]',
    '[class*="option-item"]'
  ].join(",");

  // Escape closes Dreamina's menu without submitting the prompt.
  function closePicker() {
    const editor = plugin.editor?.findEditor?.();
    // Removing our temporary trigger can reactivate the preceding @query.
    // Clean up before Escape so the native suggestion plugin closes last.
    const restoredTrigger = plugin.canvas?.cleanupPicker(editor);
    const canvasForm = editor?.closest?.('form[data-testid="video-generation-form"]');
    // Removing our query already dismisses the native menu. An extra Escape
    // would close the expanded generator dialog (or deselect its canvas node).
    if (canvasForm && (restoredTrigger || !plugin.canvas?.pickerIsOpen?.(editor))) return;
    const target = typeof document.activeElement?.dispatchEvent === "function"
      ? document.activeElement
      : document;
    for (const type of ["keydown", "keyup"]) {
      target.dispatchEvent?.(
        new KeyboardEvent(type, { bubbles: true, key: "Escape" })
      );
    }
    // Tiptap's portal listens for outside interaction rather than Escape.
    // This surface is not an upload, send, or @ toggle button.
    // Canvas handles Escape itself. A fabricated outside click on its form
    // bubbles into the canvas and deselects the node between two insertions.
    if (canvasForm) return;
    const surface = editor?.matches?.(".ProseMirror") &&
      editor.closest?.('[class*="generator-"]');
    if (surface && typeof MouseEvent === "function") {
      for (const type of ["mousedown", "mouseup", "click"]) {
        surface.dispatchEvent(new MouseEvent(type, { bubbles: true }));
      }
    }
  }

  // Keep the last clicked popup root even when its rows temporarily unmount.
  // A skeleton-only portal is invisible to activeMenuSessions(), but opening a
  // second portal while it is still interactive reproduces the stacked boxes
  // seen in the recording.
  let pendingPickerRoot = null;

  const ignoredRowName = /^(添加|Add|メンション)$/i;
  const systemMenuName = /^(?:创建主体|灵感|生成|资产|画布|参考内容|Create subject|Inspiration|Generate|Assets?|Canvas|Reference content)$/iu;

  function isSystemMenuEntry(value) {
    const name = normalizeAssetName(value);
    return Boolean(name && (
      /^Octo(?:$|[\s（(：:].*)/iu.test(name) ||
      /^会员\s*\d+(?:\.\d+)?折$/u.test(name) ||
      systemMenuName.test(name)
    ));
  }

  function assetThumbnail(row) {
    // Audio uploads use an SVG inside the native option's cover container.
    // A generic SVG check would also admit commands and subject-management rows.
    // Modern canvas options can render video/audio (and pending image) covers
    // as icons. Their typed native thumbnail is still a reference; otherwise
    // one image row makes the mixed list silently discard all icon-only rows.
    return row.querySelector('img, picture, video, audio, canvas, [class*="option-cover-container-"] svg, ' +
      '[data-mention-option-thumbnail][data-kind="image"], ' +
      '[data-mention-option-thumbnail][data-kind="video"], ' +
      '[data-mention-option-thumbnail][data-kind="audio"]');
  }

  // Saved subjects share the same @ popup and thumbnail layout as uploaded
  // materials, but expose subject-management metadata or an overflow menu.
  // They are available account-wide and must never enter the current task's
  // upload whitelist.
  function isSubjectLibraryRow(value) {
    const row = value?.element || value;
    if (!row) return false;
    const metadata = (element) => [
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("title"),
      element.getAttribute?.("data-testid"),
      element.getAttribute?.("data-type"),
      element.getAttribute?.("data-item-type"),
      element.className?.baseVal || element.className
    ].filter(Boolean).join(" ");
    const subjectMetadata = /(?:subject|character)[-_ ]?(?:library|collection|preset)|(?:library|collection)[-_ ]?(?:subject|character)|主体库|主体管理/iu;
    if (subjectMetadata.test(metadata(row))) return true;
    let ancestor = row.parentElement;
    for (let depth = 0; ancestor && depth < 4; depth += 1) {
      if (subjectMetadata.test(metadata(ancestor))) return true;
      ancestor = ancestor.parentElement;
    }
    return Array.from(row.querySelectorAll?.(
      'button, [role="button"], [aria-haspopup="menu"], [data-testid]'
    ) || []).some((control) => {
      if (control === row) return false;
      const text = normalizeText(control.innerText || control.textContent);
      const details = `${text} ${metadata(control)}`;
      return control.getAttribute?.("aria-haspopup") === "menu" ||
        /^(?:…|⋯|\.\.\.)$/u.test(text) ||
        /更多|more|ellipsis|overflow|操作|管理主体|编辑主体|删除主体/iu.test(details);
    });
  }

  // Prefer a complete structured label. Dreamina may split a leading index
  // into its own short span, so choosing the shortest leaf can turn `06_name`
  // into the false candidate `6` and corrupt ordinary time expressions.
  function nameFromRow(row) {
    const elements = Array.from(row.querySelectorAll(
      '[data-testid*="name"], [class*="name"], [class*="title"], span, p'
    ));
    const labels = elements
      .filter((element) => element.children.length === 0)
      .map((element) => normalizeAssetName(element.textContent))
      .filter((name) => name && !ignoredRowName.test(name));
    const lines = String(row.innerText || row.textContent || "")
      .split(/[\n\r]+/u)
      .map((value) => normalizeAssetName(value))
      .filter((name) => name && !ignoredRowName.test(name));
    return Array.from(new Set([...labels, ...lines]))
      .sort((a, b) => b.length - a.length)[0] || "";
  }

  function dedupe(rows) {
    const names = new Set();
    return rows.filter((row) => {
      if (!row.name || names.has(row.name)) return false;
      names.add(row.name);
      return true;
    });
  }

  // `创建主体` is a system row inside the list, not proof that its nearest
  // role=menu container is the stable popup root.
  const menuMarkerName = /^(?:可能@的内容|Possible @ content|メンション可能な内容)$/iu;
  const menuContextName = /(?:可能@的内容|Possible @ content|メンション可能な内容)/iu;
  const closedPopupState = /^(?:closed|closing|exiting|hidden)$/iu;

  function hasMenuContext(element) {
    return menuContextName.test(
      normalizeText(element?.innerText || element?.textContent)
    );
  }

  function styleFor(element) {
    try {
      return typeof getComputedStyle === "function"
        ? getComputedStyle(element)
        : {};
    } catch (_error) {
      return {};
    }
  }

  // `plugin.isVisible` checks the element itself and the browser viewport.
  // Popup portals also animate by hiding a parent, so interaction checks must
  // reject a row when any ancestor has become inert/transparent/non-clickable.
  function styleTreeAllows(element, { requirePointerEvents = true } = {}) {
    // pointer-events is inherited but descendants can explicitly restore auto.
    // The expanded canvas dialog does this beneath body { pointer-events:none }.
    if (requirePointerEvents && styleFor(element).pointerEvents === "none") return false;
    let current = element;
    for (let depth = 0; current && depth < 40; depth += 1) {
      const style = styleFor(current);
      const opacity = style.opacity === "" || style.opacity === undefined ||
        style.opacity === null ? 1 : Number(style.opacity);
      const state = current.getAttribute?.("data-state") || "";
      if (current.hidden || current.inert || current.hasAttribute?.("hidden") ||
        current.getAttribute?.("aria-hidden") === "true" ||
        closedPopupState.test(state) || style.display === "none" ||
        style.visibility === "hidden" || style.visibility === "collapse" ||
        Number.isFinite(opacity) && opacity <= 0) {
        return false;
      }
      current = current.parentElement;
    }
    return true;
  }

  function isInteractiveElement(element) {
    return Boolean(element && plugin.isVisible(element) &&
      styleTreeAllows(element, { requirePointerEvents: true }));
  }

  function isMountedElement(element, menuRoot = null) {
    if (!element || menuRoot && !menuRoot.contains?.(element)) return false;
    if (typeof document.contains === "function" && !document.contains(element)) {
      return false;
    }
    // Deliberately do not use viewport intersection here. A trusted popup can
    // mount all rows while its overflow viewport only exposes the first page.
    return styleTreeAllows(element, { requirePointerEvents: false });
  }

  function finiteRect(rect) {
    return rect && [rect.left, rect.right, rect.top, rect.bottom]
      .every(Number.isFinite);
  }

  function rectsOverlap(first, second) {
    return first.right > second.left + 1 && first.left < second.right - 1 &&
      first.bottom > second.top + 1 && first.top < second.bottom - 1;
  }

  // Programmatic click() can fire on an overflow-clipped DOM row. Guard the
  // selection path by requiring overlap with every clipping ancestor. This is
  // intentionally not used by discovery, where clipped mounted rows are data.
  function isInsideInteractiveClip(element, menuRoot) {
    const rowRect = element?.getBoundingClientRect?.();
    if (!finiteRect(rowRect)) return true;
    let current = element.parentElement;
    for (let depth = 0; current && depth < 30; depth += 1) {
      const style = styleFor(current);
      const overflow = `${style.overflow || ""} ${style.overflowX || ""} ` +
        `${style.overflowY || ""}`;
      if (/(?:auto|scroll|hidden|clip|overlay)/iu.test(overflow)) {
        const ancestorRect = current.getBoundingClientRect?.();
        if (finiteRect(ancestorRect) && !rectsOverlap(rowRect, ancestorRect)) {
          return false;
        }
      }
      if (current === menuRoot) break;
      current = current.parentElement;
    }
    const rootRect = menuRoot?.getBoundingClientRect?.();
    return !finiteRect(rootRect) || rectsOverlap(rowRect, rootRect);
  }

  function explicitlyOpenScore(element) {
    let score = 0;
    let current = element;
    for (let depth = 0; current && depth < 5; depth += 1) {
      if (current.getAttribute?.("data-state") === "open") score += 4;
      if (current.getAttribute?.("aria-expanded") === "true") score += 3;
      if (current.getAttribute?.("aria-hidden") === "false") score += 2;
      current = current.parentElement;
    }
    return score;
  }

  function findAssetMenuRoots(seedRows = []) {
    const roots = new Map();
    const remember = (element, details) => {
      if (!element || !isInteractiveElement(element) || !hasMenuContext(element)) {
        return;
      }
      const existing = roots.get(element);
      const value = {
        area: details.area,
        depth: details.depth,
        element,
        explicitOpen: explicitlyOpenScore(element),
        semantic: details.semantic
      };
      if (!existing || value.semantic > existing.semantic ||
        value.depth < existing.depth) {
        roots.set(element, value);
      }
    };

    for (const row of seedRows) {
      const semantic = row.element.closest?.('[role="listbox"], [role="menu"]');
      if (semantic) {
        const rect = semantic.getBoundingClientRect?.() || {};
        remember(semantic, {
          area: (rect.width || 0) * (rect.height || 0),
          depth: 0,
          semantic: 1
        });
      }
    }

    // Semantic listbox/menu roots are authoritative and much cheaper than a
    // full-page marker scan. Walk titles only when no semantic root exists or
    // when another popup exposes rows outside the roots already found.
    const semanticRoots = Array.from(roots.keys());
    const hasUncoveredRows = seedRows.some((row) => !semanticRoots.some(
      (root) => root.contains?.(row.element)
    ));
    const markers = roots.size && !hasUncoveredRows ? [] : Array.from(
      document.querySelectorAll("span, p, div, button")
    ).filter((element) => {
      const text = normalizeText(element.innerText || element.textContent);
      return menuMarkerName.test(text) && isInteractiveElement(element);
    });
    const viewportHeight = Number(scope.innerHeight) || 1200;
    for (const marker of markers) {
      let ancestor = marker.parentElement;
      for (let depth = 0; ancestor && depth < 14; depth += 1) {
        const rect = ancestor.getBoundingClientRect();
        const containsSeed = seedRows.length
          ? seedRows.some((row) => ancestor.contains?.(row.element))
          : Boolean(assetThumbnail(ancestor));
        if (containsSeed && isInteractiveElement(ancestor) &&
          rect.width >= 160 && rect.width <= 720 &&
          rect.height >= 100 && rect.height <= viewportHeight) {
          remember(ancestor, {
            area: rect.width * rect.height,
            depth,
            semantic: 0
          });
        }
        ancestor = ancestor.parentElement;
      }
    }
    return Array.from(roots.values())
      .sort((a, b) =>
        b.explicitOpen - a.explicitOpen ||
        b.semantic - a.semantic ||
        a.area - b.area ||
        a.depth - b.depth
      )
      .map((item) => item.element);
  }

  function findAssetMenuRoot(seedRows = []) {
    return findAssetMenuRoots(seedRows)[0] || null;
  }

  function fallbackRows(menuRoot, { interactive = true } = {}) {
    if (!menuRoot) return [];
    return dedupe(
      Array.from(menuRoot.querySelectorAll("div, li, button"))
        .filter((element) => {
          const usable = interactive
            ? isInteractiveElement(element) && isInsideInteractiveClip(element, menuRoot)
            : isMountedElement(element, menuRoot);
          if (!usable || !assetThumbnail(element)) return false;
          const rect = element.getBoundingClientRect();
          const text = normalizeText(element.innerText || element.textContent);
          return rect.width >= 100 && rect.width <= 520 && rect.height >= 28 &&
            rect.height <= 100 && text.length >= 1 && text.length <= 80;
        })
        .map((element) => ({ element, name: nameFromRow(element) }))
        .filter((row) => row.name && !isSystemMenuEntry(row.name) &&
          !isSubjectLibraryRow(row))
    );
  }

  function rowsInsideMenu(menuRoot, { interactive = true } = {}) {
    if (!menuRoot || !isInteractiveElement(menuRoot)) return [];
    // Once a picker root is locked, never rescan candidate-shaped elements on
    // the whole page. Historical cards can contain hundreds of similar nodes.
    const queryRoot = typeof menuRoot.querySelectorAll === "function"
      ? menuRoot
      : document;
    const allExplicitRows = Array.from(queryRoot.querySelectorAll(candidateSelector))
      .filter((element) => menuRoot.contains?.(element))
      .filter((element) => interactive
        ? isInteractiveElement(element) &&
          isInsideInteractiveClip(element, menuRoot)
        : isMountedElement(element, menuRoot))
      .map((element) => ({ element, name: nameFromRow(element) }));
    const explicit = allExplicitRows
      .filter((row) => row.name && !ignoredRowName.test(row.name) &&
        !isSystemMenuEntry(row.name) && !isSubjectLibraryRow(row));
    if (explicit.length) {
      // Dreamina puts commands such as 创建主体 / 灵感 / 生成 in the same
      // role=menuitem list as uploads. Require a media cover, including audio's
      // native cover icon, when media rows are present.
      const uploads = explicit.filter((row) => assetThumbnail(row.element));
      if (uploads.length) return dedupe(uploads);
    }

    // Unlabelled rows must be scoped to the currently open @ popup. A global
    // document scan can mistake unrelated promotion cards such as 会员6折 for
    // uploaded materials.
    const scoped = fallbackRows(menuRoot, { interactive });
    return scoped.length ? scoped : dedupe(explicit);
  }

  function visibleRows(lockedMenuRoot = null) {
    if (lockedMenuRoot) {
      return rowsInsideMenu(lockedMenuRoot, { interactive: true });
    }
    const seedRows = Array.from(document.querySelectorAll(candidateSelector))
      .filter(isInteractiveElement)
      .map((element) => ({ element, name: nameFromRow(element) }));
    const menuRoot = findAssetMenuRoot(seedRows);
    return rowsInsideMenu(menuRoot, { interactive: true });
  }

  function mountedRows(menuRoot) {
    return rowsInsideMenu(menuRoot, { interactive: false });
  }

  function looksLikeAssetMenu(rows) {
    return rows.some((row) => {
      if (assetThumbnail(row.element)) return true;
      let ancestor = row.element.parentElement;
      for (let depth = 0; ancestor && depth < 4; depth += 1) {
        const text = normalizeText(ancestor.innerText || ancestor.textContent);
        if (/メンション|素材|参考|reference|mention|「@」|使用.*@/i.test(text)) return true;
        ancestor = ancestor.parentElement;
      }
      return false;
    });
  }

  function rowMatches(row, name) {
    const target = normalizeAssetName(name);
    const rowName = normalizeAssetName(row.name);
    const rowText = normalizeAssetName(
      row.element.innerText || row.element.textContent
    );
    // Uploaded candidate names are authoritative. Use full-row text only when
    // no structured row name exists; never let it override a known upload.
    return Boolean(target && (rowName ? rowName === target : rowText === target));
  }

  function interactiveMenuSnapshot(menu, menuRoot) {
    // The render signature must use mounted row contents, not only clipped
    // interactive rows. Scrolling can move old nodes outside the clip before a
    // virtual list renders the next page; a visible-only signature would treat
    // that geometry change as a completed React render and skip middle pages.
    const mounted = mountedRows(menuRoot)
      .filter((row) => menu.contains?.(row.element));
    const rows = mounted.filter((row) => isInteractiveElement(row.element) &&
      isInsideInteractiveClip(row.element, menuRoot));
    return {
      maxScrollTop: Math.max(menu.scrollHeight - menu.clientHeight, 0),
      rows,
      scrollHeight: menu.scrollHeight,
      scrollTop: Number(menu.scrollTop) || 0,
      signature: mounted.map((row) => row.name).join("\u001f")
    };
  }

  async function moveMenuForExactRow(menu, menuRoot, target, before, name) {
    setMenuScroll(menu, target);
    await plugin.sleep(0);
    let latest = interactiveMenuSnapshot(menu, menuRoot);
    let row = latest.rows.find((item) => rowMatches(item, name)) || null;
    if (row) return { row, snapshot: latest };

    const requestedMovement = Math.abs(target - before.scrollTop) > 2;
    const moved = Math.abs(latest.scrollTop - before.scrollTop) > 1;
    const renderedImmediately = latest.signature !== before.signature;
    if (requestedMovement && moved && !renderedImmediately) {
      const rendered = await plugin.waitFor(() => {
        const current = interactiveMenuSnapshot(menu, menuRoot);
        latest = current;
        const exact = current.rows.find((item) => rowMatches(item, name));
        if (exact) return { row: exact, snapshot: current };
        return current.signature !== before.signature
          ? { row: null, snapshot: current }
          : null;
      }, 480, 40);
      if (rendered) return rendered;
    }
    row = latest.rows.find((item) => rowMatches(item, name)) || null;
    return {
      row,
      snapshot: latest
    };
  }

  // Once a native @ picker is open, locate the exact live candidate without
  // typing its filename into Slate. Mounted static rows are revealed first;
  // virtual lists are then scanned in bounded viewport steps. A row is clicked
  // only after it is genuinely interactive inside this picker session.
  async function seekExactVisibleRow(name, menuRoot) {
    let row = visibleRows(menuRoot).find((item) => rowMatches(item, name)) || null;
    if (row) return row;

    // Read mounted rows once. Virtualized DOM nodes are still re-read after
    // every scroll; this snapshot is used only to find the viewport and reveal
    // a statically mounted, clipped target.
    const scanRows = mountedRows(menuRoot);
    const mountedTarget = scanRows.find((item) => rowMatches(item, name));
    if (mountedTarget?.element?.scrollIntoView) {
      try {
        mountedTarget.element.scrollIntoView({
          behavior: "instant",
          block: "nearest",
          inline: "nearest"
        });
      } catch (_error) {
        mountedTarget.element.scrollIntoView();
      }
      row = await plugin.waitFor(
        () => visibleRows(menuRoot).find((item) => rowMatches(item, name)) || null,
        480,
        40
      );
      if (row) return row;
    }

    const menus = scrollableMenuCandidates(
      scanRows.length ? scanRows : visibleRows(menuRoot),
      menuRoot
    ).slice(0, 4);
    for (const menu of menus) {
      // A title/content wrapper can sit inside the real virtual-list viewport
      // and be recycled on later pages. Promote that viewport to the stable
      // scan root, matching the full-catalogue scanner.
      const scanRoot = menu.contains?.(menuRoot) ? menu : menuRoot;
      const originalScrollTop = Number(menu.scrollTop) || 0;
      let found = null;
      try {
        let snapshot = interactiveMenuSnapshot(menu, scanRoot);
        if (snapshot.scrollTop > 1) {
          const moved = await moveMenuForExactRow(
            menu,
            scanRoot,
            0,
            snapshot,
            name
          );
          snapshot = moved.snapshot;
          if (moved.row) {
            found = moved.row;
            return found;
          }
        }

        for (let scan = 0; scan < 40; scan += 1) {
          row = snapshot.rows.find((item) => rowMatches(item, name)) || null;
          if (row) {
            found = row;
            return found;
          }

          const atBottom = snapshot.scrollTop >= snapshot.maxScrollTop - 2;
          if (atBottom) {
            setMenuScroll(menu, snapshot.maxScrollTop);
            const updated = await plugin.waitFor(() => {
              const current = interactiveMenuSnapshot(menu, scanRoot);
              const exact = current.rows.find((item) => rowMatches(item, name));
              if (exact) return { row: exact, snapshot: current };
              return current.scrollHeight !== snapshot.scrollHeight ||
                current.maxScrollTop !== snapshot.maxScrollTop ||
                current.signature !== snapshot.signature
                ? { row: null, snapshot: current }
                : null;
            }, 900, 90);
            if (!updated) break;
            snapshot = updated.snapshot;
            if (updated.row) {
              found = updated.row;
              return found;
            }
            continue;
          }

          const step = Math.max(Math.floor(menu.clientHeight * 0.78), 64);
          const target = Math.min(snapshot.scrollTop + step, snapshot.maxScrollTop);
          const moved = await moveMenuForExactRow(
            menu,
            scanRoot,
            target,
            snapshot,
            name
          );
          if (moved.row) {
            found = moved.row;
            return found;
          }
          if (moved.snapshot.scrollTop <= snapshot.scrollTop + 1) break;
          snapshot = moved.snapshot;
        }
      } finally {
        if (!found) {
          setMenuScroll(menu, originalScrollTop);
        }
      }
    }
    return null;
  }

  function scrollableMenuCandidates(rows, menuRoot = null) {
    const candidates = new Map();
    for (const row of rows || []) {
      let ancestor = row.element.parentElement;
      let levelsAboveRoot = 0;
      let passedRoot = false;
      for (let depth = 0; ancestor && depth < 22; depth += 1) {
        if (menuRoot) {
          if (ancestor === menuRoot) {
            passedRoot = true;
          } else if (!passedRoot && !menuRoot.contains(ancestor)) {
            break;
          } else if (passedRoot) {
            levelsAboveRoot += 1;
            // The marker fallback can lock a content wrapper just inside the
            // real viewport. Inspect a few popup-sized parents, but never walk
            // far enough to select the page itself.
            if (levelsAboveRoot > 4 || !ancestor.contains?.(menuRoot)) break;
          }
        }
        const scrollRange = ancestor.scrollHeight - ancestor.clientHeight;
        const rect = ancestor.getBoundingClientRect?.() || {
          height: ancestor.clientHeight,
          width: 0
        };
        const popupSized = !menuRoot || !passedRoot || levelsAboveRoot === 0 || (
          rect.width >= 140 && rect.width <= 760 &&
          rect.height >= 80 && rect.height <= (Number(scope.innerHeight) || 1200)
        );
        if (scrollRange > 8 && popupSized) {
          let overflowY = "";
          try {
            overflowY = getComputedStyle(ancestor).overflowY || "";
          } catch (_error) {
            overflowY = "";
          }
          const explicitViewport = ancestor.matches?.(
            '[data-radix-scroll-area-viewport], [data-scroll-viewport], ' +
            '[class*="scroll"][class*="viewport"], [class*="Scroll"][class*="Viewport"]'
          );
          const overflowRank = /^(?:auto|scroll|overlay)$/u.test(overflowY)
            ? 2
            : overflowY === "hidden" ? 1 : 0;
          if (!explicitViewport && !overflowRank) {
            ancestor = ancestor.parentElement;
            continue;
          }
          const existing = candidates.get(ancestor);
          const candidate = {
            depth: depth + levelsAboveRoot * 4,
            element: ancestor,
            explicitViewport: Boolean(explicitViewport),
            overflowRank,
            scrollRange
          };
          if (!existing || candidate.depth < existing.depth) {
            candidates.set(ancestor, candidate);
          }
        }
        ancestor = ancestor.parentElement;
      }
    }
    return Array.from(candidates.values())
      .sort((a, b) =>
        b.scrollRange - a.scrollRange ||
        Number(b.explicitViewport) - Number(a.explicitViewport) ||
        b.overflowRank - a.overflowRank ||
        a.depth - b.depth
      )
      .map((item) => item.element);
  }

  function setMenuScroll(menu, position) {
    try {
      menu.scrollTo?.({ behavior: "instant", left: menu.scrollLeft || 0, top: position });
    } catch (_error) {
      // Direct scrollTop assignment below is supported by every target build.
    }
    menu.scrollTop = position;
    try {
      menu.dispatchEvent(new Event("scroll", { bubbles: true }));
    } catch (_error) {
      // Assigning scrollTop still schedules a native scroll event in browsers.
    }
  }

  function menuSnapshot(menu, menuRoot) {
    const rows = mountedRows(menuRoot).filter((row) => menu.contains(row.element));
    return {
      maxScrollTop: Math.max(menu.scrollHeight - menu.clientHeight, 0),
      rows,
      scrollHeight: menu.scrollHeight,
      scrollTop: Number(menu.scrollTop) || 0,
      signature: rows.map((row) => row.name).join("\u001f")
    };
  }

  async function scrollAndRead(menu, menuRoot, target, before) {
    setMenuScroll(menu, target);
    await plugin.sleep(0);
    let snapshot = menuSnapshot(menu, menuRoot);
    const requestedMovement = Math.abs(target - before.scrollTop) > 2;
    const actualMovement = Math.abs(snapshot.scrollTop - before.scrollTop) > 1;
    if (requestedMovement && actualMovement &&
      snapshot.signature === before.signature) {
      let latest = snapshot;
      let lastKey = "";
      let stableChecks = 0;
      const rendered = await plugin.waitFor(() => {
        const current = menuSnapshot(menu, menuRoot);
        latest = current;
        if (current.signature === before.signature &&
          current.scrollHeight === before.scrollHeight) {
          stableChecks = 0;
          lastKey = "";
          return null;
        }
        const key = `${current.scrollHeight}\u0000${current.signature}`;
        stableChecks = key === lastKey ? stableChecks + 1 : 1;
        lastKey = key;
        return stableChecks >= 2 ? current : null;
      }, 700, 40);
      snapshot = rendered || latest;
    }
    return snapshot;
  }

  async function waitForBottomUpdate(menu, menuRoot, baseline) {
    // Re-dispatching at the current bottom wakes IntersectionObserver/custom
    // virtual-list loaders that append rows without changing scrollTop first.
    setMenuScroll(menu, baseline.maxScrollTop);
    return plugin.waitFor(() => {
      const current = menuSnapshot(menu, menuRoot);
      return current.scrollHeight !== baseline.scrollHeight ||
        current.maxScrollTop !== baseline.maxScrollTop ||
        current.signature !== baseline.signature
        ? current
        : null;
    }, 1100, 100);
  }

  async function scanScrollableMenu(menu, lockedRoot, remember) {
    const originalScrollTop = Number(menu.scrollTop) || 0;
    // If the initially locked marker wrapper sits inside the real viewport,
    // use the viewport itself as the stable scan scope.
    const menuRoot = menu.contains?.(lockedRoot) ? menu : lockedRoot;
    const step = Math.max(Math.floor(menu.clientHeight * 0.78), 64);
    let reachedBottom = false;
    try {
      let snapshot = menuSnapshot(menu, menuRoot);
      remember(snapshot.rows);

      if (snapshot.scrollTop > 1) {
        snapshot = await scrollAndRead(menu, menuRoot, 0, snapshot);
        remember(snapshot.rows);
      }

      let noProgress = 0;
      let unchangedViews = 0;
      for (let scan = 0; scan < 40; scan += 1) {
        snapshot = menuSnapshot(menu, menuRoot);
        remember(snapshot.rows);
        const atBottom = snapshot.scrollTop >= snapshot.maxScrollTop - 2;
        if (atBottom) {
          const updated = await waitForBottomUpdate(menu, menuRoot, snapshot);
          if (!updated) {
            reachedBottom = true;
            break;
          }
          snapshot = updated;
          remember(snapshot.rows);
          noProgress = 0;
          continue;
        }

        const target = Math.min(snapshot.scrollTop + step, snapshot.maxScrollTop);
        const previousTop = snapshot.scrollTop;
        const previousSignature = snapshot.signature;
        const previousHeight = snapshot.scrollHeight;
        const next = await scrollAndRead(menu, menuRoot, target, snapshot);
        remember(next.rows);
        if (next.scrollTop <= previousTop + 1) {
          noProgress += 1;
          if (noProgress >= 2) break;
        } else {
          noProgress = 0;
        }
        if (next.signature === previousSignature &&
          next.scrollHeight === previousHeight) {
          unchangedViews += 1;
          // A real 0.78-viewport move must recycle at least part of a virtual
          // row window. Reject wrappers whose scrollTop changes but rows do not.
          if (unchangedViews >= 2) break;
        } else {
          unchangedViews = 0;
        }
        snapshot = next;
      }
    } finally {
      setMenuScroll(menu, originalScrollTop);
    }
    return { reachedBottom };
  }

  // Upload lists are scrollable and may be virtualized. Read them in bounded
  // viewport-sized steps, then restore the user's original scroll position.
  async function collectMenuRows(seedRows) {
    const collected = new Map();
    const requireThumbnails = (seedRows || []).some((row) =>
      assetThumbnail(row.element)
    );
    const remember = (rows) => {
      for (const row of rows || []) {
        if (requireThumbnails && !assetThumbnail(row.element)) continue;
        if (isSystemMenuEntry(row.name)) continue;
        if (isSubjectLibraryRow(row)) continue;
        const key = normalizeAssetName(row.name);
        if (key && !collected.has(key)) {
          collected.set(key, { element: row.element, name: row.name });
        } else if (key) {
          // Virtual lists recycle their row nodes. Keep the latest live node
          // while preserving the first-seen name/order snapshot.
          collected.get(key).element = row.element;
        }
      }
    };
    remember(seedRows);

    // Keep using the popup that was verified before scrolling. Dreamina's
    // virtual list can recycle the title/marker row while it renders later
    // pages; rediscovering the popup at every step can therefore return no
    // rows after the first viewport and make a 29-item upload look like 17.
    const menuRoot = findAssetMenuRoot(seedRows);
    if (!menuRoot) return Array.from(collected.values());
    const mounted = mountedRows(menuRoot);
    remember(mounted);
    const scanSeeds = mounted.length ? mounted : seedRows;
    const menus = scrollableMenuCandidates(scanSeeds, menuRoot).slice(0, 4);
    if (!menus.length) return Array.from(collected.values());
    // Static heuristics can still rank a scrollable decoration above the real
    // virtual-list viewport. Probe bounded candidates and keep the first one
    // that actually reveals new uploaded names.
    let completedScan = false;
    let revealedNewNames = false;
    for (const menu of menus) {
      const beforeCount = collected.size;
      const result = await scanScrollableMenu(menu, menuRoot, remember);
      const revealed = collected.size > beforeCount;
      revealedNewNames ||= revealed;
      if (revealed && result.reachedBottom) {
        completedScan = true;
        break;
      }
    }
    // Never present a bounded-but-incomplete scan as the full upload list;
    // returning [] activates the existing single discovery retry instead.
    if (revealedNewNames && !completedScan) return [];
    return Array.from(collected.values());
  }

  function activeMenuSessions() {
    const seedRows = Array.from(document.querySelectorAll(candidateSelector))
      .filter(isInteractiveElement)
      .map((element) => ({ element, name: nameFromRow(element) }));
    return findAssetMenuRoots(seedRows)
      .map((root) => ({ root, rows: rowsInsideMenu(root, { interactive: true }) }))
      .filter((session) => session.rows.length && looksLikeAssetMenu(session.rows));
  }

  // A portal in its exit animation may still satisfy the element-level
  // viewport test. Every previous portal must become inactive before another
  // trigger is allowed; a different root is not proof that the old one closed.
  async function pickerBoundaryBeforeTrigger(editor = null) {
    const previousRoots = new Set(activeMenuSessions().map((item) => item.root));
    if (pendingPickerRoot) {
      if (isInteractiveElement(pendingPickerRoot)) {
        previousRoots.add(pendingPickerRoot);
      } else {
        pendingPickerRoot = null;
      }
    }
    if (!previousRoots.size) return { previousRoots, settled: true };
    closePicker();
    const rowlessChecks = new Map();
    const explicitlyOpen = (root) => {
      let current = root;
      for (let depth = 0; current && depth < 5; depth += 1) {
        if (current.getAttribute?.("data-state") === "open" ||
          current.getAttribute?.("aria-expanded") === "true") return true;
        current = current.parentElement;
      }
      return false;
    };
    const rootStillOpen = (root) => {
      if (!isInteractiveElement(root)) return false;
      const rows = rowsInsideMenu(root, { interactive: true });
      if (rows.length && looksLikeAssetMenu(rows) || explicitlyOpen(root)) {
        rowlessChecks.set(root, 0);
        return true;
      }
      // Some builds keep an empty, visible portal shell mounted permanently.
      // Treat it as closed only after several consecutive rowless checks, so a
      // single virtual-list recycle frame cannot open a second popup.
      const checks = (rowlessChecks.get(root) || 0) + 1;
      rowlessChecks.set(root, checks);
      return checks < 3;
    };
    const checkSettled = () => {
      const active = activeMenuSessions();
      for (const item of active) previousRoots.add(item.root);
      const oldRootStillInteractive = Array.from(previousRoots)
        .some(rootStillOpen);
      return active.length || oldRootStillInteractive ? null : true;
    };
    let settled = await plugin.waitFor(checkSettled, 240, 40);
    if (!settled) {
      // When Dreamina exposes a confirmed expanded toolbar button, toggling
      // that same control is a stronger close signal than a synthetic Escape.
      // Never click an unconfirmed button here because that could open another
      // popup instead of closing the old one.
      const nativeButton = plugin.nativeTrigger?.findNativeButton?.(editor);
      if (nativeButton?.getAttribute?.("aria-expanded") === "true") {
        nativeButton.click();
      }
      settled = await plugin.waitFor(checkSettled, 480, 40);
    }
    if (settled) pendingPickerRoot = null;
    return { previousRoots, settled: Boolean(settled) };
  }

  function triggeredPickerSession(boundary) {
    if (!boundary?.settled) return null;
    return activeMenuSessions()[0] || null;
  }

  // Read only an already-open native menu. The caller opens it through the
  // page's own @ toolbar control; discovery must never mutate the prompt with
  // a temporary @, because that mutation can be mistaken for a user edit.
  async function discover(_editor) {
    const openRows = visibleRows();
    if (openRows.length && looksLikeAssetMenu(openRows)) {
      return collectMenuRows(openRows);
    }
    return [];
  }

  const uploadCountLabel = /^(?:全部|图片|All|Images?)\s*[（(]\s*(\d{1,3})\s*[）)]$/iu;

  function uploadCountControl(element) {
    const role = element.getAttribute?.("role") || "";
    const metadata = [];
    let current = element;
    for (let depth = 0; current && depth < 5; depth += 1) {
      metadata.push(
        current.className?.baseVal || current.className || "",
        current.getAttribute?.("data-testid") || "",
        current.getAttribute?.("aria-label") || "",
        current.getAttribute?.("role") || ""
      );
      current = current.parentElement;
    }
    const ariaSelected = element.getAttribute?.("aria-selected");
    const nativeTabHint = /(?:tab|upload|asset|material|reference|image)/iu
      .test(metadata.join(" ")) || /素材|上传/iu.test(metadata.join(" "));
    return role === "tab" ||
      ariaSelected !== null && ariaSelected !== undefined || nativeTabHint;
  }

  function rectGap(first, second) {
    return {
      horizontal: Math.max(first.left - second.right, second.left - first.right, 0),
      vertical: Math.max(first.top - second.bottom, second.top - first.bottom, 0)
    };
  }

  // The native upload tray exposes compact tabs such as `全部（29）` and
  // `Images (29)`. Restrict the count to semantic tab/control nodes near the
  // active editor so prompt numbers, durations and unrelated page text cannot
  // become an expected upload total.
  function expectedUploadCount(editor) {
    const slots = plugin.canvas?.materialSlots?.(editor);
    if (slots) return slots.length;
    const editorRect = editor?.getBoundingClientRect?.();
    if (!finiteRect(editorRect)) return 0;
    const selector = [
      "button",
      '[role="tab"]',
      '[role="button"]',
      "[aria-selected]",
      '[data-testid*="tab"]',
      '[data-testid*="upload"]',
      '[class*="tab"]'
    ].join(",");
    const counts = [];
    for (const element of document.querySelectorAll(selector)) {
      if (editor.contains?.(element) || !uploadCountControl(element) ||
        !isInteractiveElement(element)) continue;
      const label = normalizeText(element.innerText || element.textContent);
      const match = label.match(uploadCountLabel);
      if (!match) continue;
      const rect = element.getBoundingClientRect?.();
      if (!finiteRect(rect) || rect.width <= 1 || rect.height <= 1 ||
        rect.width > 360 || rect.height > 100) continue;
      const gap = rectGap(rect, editorRect);
      if (gap.horizontal > 420 || gap.vertical > 520) continue;
      const count = Number(match[1]);
      if (Number.isSafeInteger(count) && count >= 0 && count <= 500) {
        counts.push(count);
      }
    }
    return counts.length ? Math.max(...counts) : 0;
  }

  function connectedEditor(preferred) {
    if (!preferred) return null;
    try {
      const connected = typeof document.contains !== "function" ||
        document.contains(preferred);
      return connected ? preferred : null;
    } catch (_error) {
      return null;
    }
  }

  function currentEditor(preferred) {
    if (preferred) {
      const connected = connectedEditor(preferred);
      if (connected && (!plugin.isVisible || plugin.isVisible(connected))) {
        return connected;
      }
      // Once an operation is bound to an editor, never fall through to a
      // different active editor after a SPA task switch.
      return null;
    }
    return plugin.editor.findEditor?.() || null;
  }

  function assertCandidateOperation(options, editor) {
    options?.assertEditorCurrent?.(editor);
  }

  function assertCandidateOperationOrClose(options, editor) {
    try {
      assertCandidateOperation(options, editor);
    } catch (error) {
      plugin.canvas?.cleanupPicker?.(editor);
      throw error;
    }
  }

  function failBeforeCandidateClick(reason) {
    closePicker();
    return {
      ok: false,
      reason: `${reason}；原文字已保留且未改动`,
      retryable: false,
      stopRun: true
    };
  }

  function operationCommitted(editor, match) {
    const liveEditor = currentEditor(editor);
    return Boolean(liveEditor &&
      plugin.editor.findRangeAt?.(liveEditor, match.token, match.start) &&
      plugin.editor.isMatchPaired?.(liveEditor, match));
  }

  function candidateOperationOutcome(editor, match) {
    const liveEditor = currentEditor(editor);
    if (!liveEditor) return null;
    if (!plugin.editor.findRangeAt?.(liveEditor, match.token, match.start)) {
      return { sourceChanged: true };
    }
    return plugin.editor.isMatchPaired?.(liveEditor, match)
      ? { inserted: true }
      : null;
  }

  // Preserve one explicit @name and append the native mention immediately
  // after that exact occurrence. The picker is opened with Dreamina's native
  // toolbar @ control; this function never inserts or deletes prompt text.
  // A candidate row is clicked at most once per operation, and an uncertain
  // click is never automatically repeated.
  async function insertMention(editor, match, options = {}) {
    assertCandidateOperation(options, editor);
    let liveEditor = currentEditor(editor);
    if (!liveEditor) return {
      ok: false,
      reason: "没有找到提示词编辑器",
      retryable: false,
      stopRun: true
    };
    if (operationCommitted(liveEditor, match)) {
      return { alreadyPaired: true, ok: true };
    }
    const beforeText = plugin.editor.plainText(liveEditor);
    const matchEnd = Number.isInteger(match.end)
      ? match.end
      : match.start + match.token.length;
    if (beforeText.slice(match.start, matchEnd) !== match.token) {
      return {
        ok: false,
        reason: "原引用位置已经变化，已停止操作",
        retryable: false,
        stopRun: true
      };
    }

    const boundary = await pickerBoundaryBeforeTrigger(liveEditor);
    assertCandidateOperation(options, liveEditor);
    if (!boundary.settled) {
      return {
        ok: false,
        reason: "上一个素材选择框尚未关闭，已停止下一项以避免重复标签",
        retryable: false,
        stopRun: true
      };
    }
    liveEditor = currentEditor(liveEditor);
    const pickerOpened = await plugin.nativeTrigger?.ensurePicker?.(liveEditor, {
      assertCurrent: () => assertCandidateOperationOrClose(options, liveEditor),
      beforeClick: async () => {
        assertCandidateOperation(options, liveEditor);
        // The site's queued controlled-value update can briefly restore the
        // preceding owned @ after cleanup, then commit the corrected document.
        // Wait only on that mismatch; the unchanged fast path has no delay.
        if (plugin.editor.plainText(liveEditor) !== beforeText) {
          await plugin.waitFor(() => {
            assertCandidateOperation(options, liveEditor);
            const current = currentEditor(liveEditor);
            return current && plugin.editor.plainText(current) === beforeText;
          }, 720, 20);
        }
        const pinnedEditor = currentEditor(liveEditor);
        if (!pinnedEditor ||
          plugin.editor.plainText(pinnedEditor) !== beforeText) return false;
        return plugin.editor.placeCaretAfterMatch?.(pinnedEditor, match) === true;
      },
      requireFresh: true
    });
    assertCandidateOperationOrClose(options, liveEditor);
    if (!pickerOpened) {
      return failBeforeCandidateClick(
        "无法通过网页原生 @ 按钮在原文字后打开素材菜单"
      );
    }

    const pickerSession = await plugin.waitFor(
      () => triggeredPickerSession(boundary),
      1400,
      16
    );
    assertCandidateOperationOrClose(options, liveEditor);
    if (!pickerSession) {
      return failBeforeCandidateClick(
        "点击网页原生 @ 按钮后素材菜单没有打开"
      );
    }

    const pickerRoot = pickerSession.root;
    // Pin this portal before virtual-list lookup. Even a missing/recycled row
    // must leave enough session identity for the next manual run to wait until
    // the old shell has actually settled instead of stacking another popup.
    pendingPickerRoot = pickerRoot;
    const row = await seekExactVisibleRow(match.name, pickerRoot);
    assertCandidateOperationOrClose(options, liveEditor);

    if (!row) {
      return failBeforeCandidateClick(
        "候选菜单中没有同名素材"
      );
    }

    assertCandidateOperation(options, liveEditor);
    // Virtual lists recycle row elements. Re-read the current interactive
    // rows immediately before click and require the exact name again; never
    // click a stale node returned by an earlier scroll frame.
    const liveRow = visibleRows(pickerRoot)
      .find((item) => rowMatches(item, match.name)) || null;
    if (!liveRow) {
      return failBeforeCandidateClick(
        "同名候选在点击前已经离开当前素材菜单"
      );
    }
    const expectedPickerText = plugin.canvas?.expectedPickerText(liveEditor, beforeText) || beforeText;
    if (plugin.editor.plainText(liveEditor) !== expectedPickerText ||
      !plugin.editor.findRangeAt?.(liveEditor, match.token, match.start)) {
      return failBeforeCandidateClick(
        "候选点击前原引用位置已经变化，已停止操作"
      );
    }
    if (plugin.editor.verifyNativeSelection?.(liveEditor, match) === false) {
      return failBeforeCandidateClick("编辑器光标位置未同步，已停止以避免插错位置");
    }
    // New ProseMirror menus bind insertion on the inner option content.
    // The surrounding LI only updates the select highlight. Click once on
    // the content a real pointer targets, retaining the exact-name guards.
    const nativeContent = liveEditor.matches?.(".ProseMirror")
      ? liveRow.element.querySelector?.('[class*="option-content-"]') : null;
    (nativeContent || liveRow.element).click();
    let outcome = await plugin.waitFor(
      () => {
        assertCandidateOperationOrClose(options, liveEditor);
        plugin.canvas?.cleanupInsertedTrigger?.(liveEditor);
        return candidateOperationOutcome(liveEditor, match);
      },
      4500,
      16
    );
    assertCandidateOperation(options, liveEditor);
    if (outcome?.sourceChanged) {
      closePicker();
      return {
        clicked: true,
        ok: false,
        reason: "网页候选插入动作改动了原素材名，已立即停止后续项目；请撤销本次网页编辑后重试",
        retryable: false,
        sourceChanged: true,
        uncertain: true
      };
    }
    if (outcome?.inserted) {
      closePicker();
      const popupClosed = await plugin.waitFor(
        () => !isInteractiveElement(pickerRoot) && !activeMenuSessions().length,
        720,
        40
      );
      if (popupClosed) pendingPickerRoot = null;
      return { ok: true, popupClosed: Boolean(popupClosed) };
    }

    // Closing the picker can flush a queued Slate commit. Observe once more,
    // but never issue a second row click in this run.
    closePicker();
    outcome = await plugin.waitFor(
      () => candidateOperationOutcome(liveEditor, match),
      600,
      50
    );
    assertCandidateOperation(options, liveEditor);
    if (outcome?.sourceChanged) {
      return {
        clicked: true,
        ok: false,
        reason: "网页候选插入动作改动了原素材名，已立即停止后续项目；请撤销本次网页编辑后重试",
        retryable: false,
        sourceChanged: true,
        uncertain: true
      };
    }
    if (outcome?.inserted) return { ok: true, popupClosed: false };
    return {
      clicked: true,
      ok: false,
      reason: "候选已点击但没有确认生成相邻原生标签；原文字未改动，本轮不会重复点击",
      retryable: false,
      uncertain: true
    };
  }

  plugin.candidates = {
    closePicker,
    discover,
    expectedUploadCount,
    findAssetMenuRoot,
    insertMention,
    isInteractiveElement,
    isSubjectLibraryRow,
    isSystemMenuEntry,
    nameFromRow,
    rowMatches,
    seekExactVisibleRow,
    scrollableMenuCandidates,
    visibleRows
  };
})(globalThis);
