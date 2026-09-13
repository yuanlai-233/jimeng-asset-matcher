(function createEditorAdapter(scope) {
  "use strict";

  const plugin = scope.JimengAssetPlugin;
  const {
    matchPromptToCandidates,
    missingPromptReferences,
    normalizeAssetName,
    normalizeText
  } = plugin.matcher || scope.JimengAssetMatcher;
  const { highlightName, overlayId } = plugin.constants;
  const maxUnmatchedNameLength = 16;

  // These selectors cover Slate mentions used by both Jimeng and Dreamina.
  const mentionSelector = [
    '[data-slate-inline="true"][contenteditable="false"]',
    '[data-mention]',
    '[data-reference-type]',
    '[class*="mention"]',
    '[class*="Mention"]',
    '[contenteditable="false"]'
  ].join(",");

  // Highlighting uses a stricter selector than v0.2.5 matching. Keeping these
  // responsibilities separate prevents ordinary non-editable Slate leaves
  // from being skipped while preserving native mention detection.
  const highlightMentionSelector = [
    '[data-slate-inline="true"][contenteditable="false"]',
    '[data-slate-void="true"]',
    '[data-mention]',
    '[data-reference-type]',
    '[contenteditable="false"][class*="mention"]',
    '[contenteditable="false"][class*="reference"]'
  ].join(",");

  // Mention counts must include every node that plainText() masks as a
  // native mention. Exact candidate labels below keep the broad selector from
  // counting unrelated non-editable Slate controls.
  const countMentionSelector = `${mentionSelector},${highlightMentionSelector}`;

  // Pick the large, visible editor nearest the generation toolbar.
  function findEditor() {
    const elements = Array.from(
      document.querySelectorAll(
        '[data-slate-editor="true"], [contenteditable="true"][role="textbox"], [contenteditable="true"]'
      )
    ).filter(plugin.isVisible);

    let best = null;
    let bestScore = -Infinity;
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      const canvasForm = plugin.canvas?.formFor(element);
      // Canvas applies a transform to the entire node toolbar. Its semantic
      // form identity is authoritative; screen pixels shrink with zoom.
      if (!canvasForm && (rect.width < 280 || rect.height < 36)) continue;
      let score = Math.min(rect.width, 1200) / 10 + Math.min(rect.height, 420) / 8;
      if (canvasForm) score += 1200;
      if (canvasForm && element.contains(document.activeElement)) score += 2000;
      if (element.matches('[data-slate-editor="true"]')) score += 600;
      if (element.getAttribute("role") === "textbox") score += 240;
      if (rect.top > innerHeight * 0.35) score += 180;
      if (rect.bottom > innerHeight * 0.65) score += 160;
      score += Math.min(normalizeText(element.innerText).length, 500) / 4;
      if (score > bestScore) {
        best = element;
        bestScore = score;
      }
    }
    return best;
  }

  function isInsideMention(node, editor) {
    const mention = node.parentElement?.closest?.(mentionSelector);
    return Boolean(mention && mention !== editor && editor.contains(mention));
  }

  function isInsideHighlightMention(node, editor) {
    const mention = node.parentElement?.closest?.(highlightMentionSelector);
    return Boolean(mention && mention !== editor && editor.contains(mention));
  }

  function parentElement(node) {
    if (!node) return null;
    if (node.nodeType === 1) return node;
    return node.parentElement || node.parentNode || null;
  }

  // Prefer the nearest non-inline Slate element. The direct editor child is a
  // conservative fallback for contenteditable implementations without Slate
  // attributes. Root-level text belongs to the editor itself.
  function textBlock(node, editor) {
    let element = parentElement(node);
    let directChild = null;
    let slateBlock = null;
    while (element && element !== editor) {
      directChild = element;
      if (
        !slateBlock &&
        element.getAttribute?.("data-slate-node") === "element" &&
        element.getAttribute?.("data-slate-inline") !== "true"
      ) {
        slateBlock = element;
      }
      element = element.parentElement || element.parentNode || null;
    }
    if (element !== editor) return null;
    return slateBlock || directChild || editor;
  }

  function containsNode(editor, node) {
    if (!editor || !node) return false;
    if (editor === node) return true;
    if (typeof editor.contains === "function") return editor.contains(node);
    let current = node.parentElement || node.parentNode || null;
    while (current) {
      if (current === editor) return true;
      current = current.parentElement || current.parentNode || null;
    }
    return false;
  }

  // Build a character-to-text-node map so replacements preserve the prompt.
  function textNodeMap(editor) {
    const entries = [];
    let text = "";
    const addText = (node) => {
      const start = text.length;
      text += node.nodeValue || "";
      entries.push({ block: textBlock(node, editor), end: text.length,
        mention: isInsideMention(node, editor), node, start });
    };
    if (editor.matches?.(".ProseMirror") && editor.childNodes) {
      // textContent loses paragraphs and hard breaks. Keep virtual separators
      // in both the prompt and Range map, otherwise line-ending @name.Next
      // looks like one filename and later offsets drift.
      const newline = () => { if (text && !text.endsWith("\n")) text += "\n"; };
      const visit = (node) => {
        if (node.nodeType === 3) return addText(node);
        if (node.tagName === "BR") { text += "\n"; return; }
        const block = /^(P|DIV|LI|H[1-6]|BLOCKQUOTE)$/u.test(node.tagName || "");
        if (block) newline();
        for (const child of Array.from(node.childNodes || [])) visit(child);
        if (block) newline();
      };
      for (const child of Array.from(editor.childNodes)) visit(child);
    } else {
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) addText(node);
    }
    return { entries, text };
  }

  // Native mentions are masked so an incremental run never matches them twice.
  function plainText(editor) {
    const map = textNodeMap(editor);
    const pieces = [];
    let cursor = 0;
    for (const entry of map.entries) {
      pieces.push(map.text.slice(cursor, entry.start));
      const value = entry.node.nodeValue || "";
      pieces.push(entry.mention ? "\u0000".repeat(value.length) : value);
      cursor = entry.end;
    }
    pieces.push(map.text.slice(cursor));
    return pieces.join("");
  }

  function findAllRanges(editor, token) {
    const map = textNodeMap(editor);
    const results = [];
    let from = 0;
    let position;

    while ((position = map.text.indexOf(token, from)) !== -1) {
      const endPosition = position + token.length;
      const startEntry = map.entries.find(
        (entry) => position >= entry.start && position < entry.end
      );
      const endEntry = map.entries.find(
        (entry) => endPosition > entry.start && endPosition <= entry.end
      );
      const touched = map.entries.filter(
        (entry) => entry.end > position && entry.start < endPosition
      );

      if (startEntry && endEntry && !touched.some((entry) => entry.mention)) {
        const range = document.createRange();
        range.setStart(startEntry.node, position - startEntry.start);
        range.setEnd(endEntry.node, endPosition - endEntry.start);
        results.push({ position, range });
      }
      from = endPosition;
    }
    return results;
  }

  // Build one normalized DOM map for all visual-highlight lookups. Dreamina
  // may place zero-width characters between rendered text leaves.
  function highlightTextMap(editor) {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const points = [];
    let text = "";
    let node;
    while ((node = walker.nextNode())) {
      const value = node.nodeValue || "";
      const mention = isInsideHighlightMention(node, editor);
      for (let offset = 0; offset < value.length; offset += 1) {
        const character = value[offset];
        if (/^[\u200B-\u200D\u2060\uFEFF]$/u.test(character)) continue;
        text += character === "\u00a0" ? " " : character;
        points.push({ mention, node, offset });
      }
    }
    return { points, text };
  }

  // Derive the whitespace-free fallback without walking the editor again.
  function compactHighlightTextMap(map) {
    const points = [];
    let text = "";
    for (let index = 0; index < map.text.length; index += 1) {
      if (/^\s$/u.test(map.text[index])) continue;
      text += map.text[index];
      points.push(map.points[index]);
    }
    return { points, text };
  }

  function findHighlightRanges(map, token, compactWhitespace = false) {
    const wanted = String(token || "")
      .replace(/[\u200B-\u200D\u2060\uFEFF]/gu, "")
      .replace(/\u00a0/g, " ");
    const needle = compactWhitespace ? wanted.replace(/\s+/gu, "") : wanted;
    if (!needle) return [];

    const results = [];
    let from = 0;
    let position;
    while ((position = map.text.indexOf(needle, from)) !== -1) {
      const end = position + needle.length;
      const touched = map.points.slice(position, end);
      const first = touched[0];
      const last = touched[touched.length - 1];
      if (first && last && !touched.some((point) => point.mention)) {
        const range = document.createRange();
        range.setStart(first.node, first.offset);
        range.setEnd(last.node, last.offset + 1);
        results.push({ position, range });
      }
      from = end;
    }
    return results;
  }

  // Exact positions distinguish the intended explicit @ token from another
  // same-name occurrence after a failed first insertion attempt.
  function findRangeAt(editor, token, start, map = textNodeMap(editor)) {
    const end = start + token.length;
    if (!token || !Number.isInteger(start) || start < 0 || map.text.slice(start, end) !== token) return null;
    const touched = map.entries.filter((entry) => entry.end > start && entry.start < end);
    const first = touched[0];
    const last = touched[touched.length - 1];
    if (!first || !last || start < first.start || end > last.end || touched.some((entry) => entry.mention)) return null;
    const range = document.createRange();
    range.setStart(first.node, start - first.start);
    range.setEnd(last.node, end - last.start);
    return range;
  }

  // Focus first, then resolve a fresh range and collapse it at the end of the
  // exact source token. Absolute text offsets are ambiguous at Slate block
  // boundaries; using the token's own DOM range keeps an end-of-line mention
  // attached to the correct paragraph without deleting the source text.
  function placeCaretAfterMatch(editor, match) {
    if (!editor || !match?.token || !Number.isInteger(match.start)) return false;
    try {
      editor.focus({ preventScroll: true });
    } catch (_error) {
      editor.focus();
    }
    const range = findRangeAt(editor, match.token, match.start);
    if (!range) return false;
    const startBlock = textBlock(range.startContainer, editor);
    const endBlock = textBlock(range.endContainer, editor);
    if (startBlock && endBlock && startBlock !== endBlock) return false;
    try {
      range.collapse(false);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return syncNativeSelection(editor, match.token, "sync");
    } catch (_error) {
      return false;
    }
  }

  function syncNativeSelection(editor, token, mode) {
    if (!editor.matches?.(".ProseMirror")) return true;
    editor.removeAttribute("data-jimeng-selection-result");
    editor.setAttribute("data-jimeng-selection-request", JSON.stringify({ token, mode }));
    try {
      editor.dispatchEvent(new Event("jimeng-editor-selection-request", { bubbles: true }));
      const result = editor.getAttribute("data-jimeng-selection-result") || "unavailable";
      return result === "synced";
    } finally {
      editor.removeAttribute("data-jimeng-selection-request");
      editor.removeAttribute("data-jimeng-selection-result");
    }
  }

  // Remove only text explicitly inserted by the extension. Focus first and
  // then resolve a fresh range so Slate cannot invalidate a stale DOM Range.
  function deleteTextAt(editor, token, start) {
    if (!editor || !token || !Number.isInteger(start)) return false;
    try {
      editor.focus({ preventScroll: true });
    } catch (_error) {
      editor.focus();
    }
    const range = findRangeAt(editor, token, start);
    if (!range) return false;
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    try {
      return Boolean(document.execCommand("delete", false));
    } catch (_error) {
      return false;
    }
  }

  // Insert text using the same editing path a real keyboard uses.
  function insertText(editor, text) {
    const selection = getSelection();
    if (!selection?.rangeCount) return false;
    const intendedRange = selection.getRangeAt(0);
    if (!containsNode(editor, intendedRange.startContainer) ||
      !containsNode(editor, intendedRange.endContainer)) {
      return false;
    }

    // Every production caller focuses and places an exact Range first. If
    // focus has already moved elsewhere, fail closed; refocusing here can make
    // Slate collapse the caret to the prompt end.
    if (document.activeElement !== editor) return false;

    try {
      // Direct DOM insertion bypasses Slate's model and can be reconciled into
      // the wrong block. If the native editing command is rejected, fail
      // closed and let the caller preserve the original source token.
      return Boolean(document.execCommand("insertText", false, text));
    } catch (_error) {
      return false;
    }
  }

  function mentionRoots(editor) {
    const elements = Array.from(
      editor?.querySelectorAll?.(countMentionSelector) || []
    );
    return elements.filter((element) => !elements.some(
      (other) => other !== element && other.contains?.(element)
    ));
  }

  function mentionLabels(root) {
    const imageAlt = root.querySelector?.("img")?.alt || "";
    const values = [
      root.innerText,
      root.textContent,
      root.getAttribute?.("aria-label"),
      root.getAttribute?.("title"),
      imageAlt,
      // Canvas video chips shorten visible text but keep the exact filename
      // on a nested semantic chip. Never infer a full name from an ellipsis.
      ...Array.from(root.querySelectorAll?.('[aria-label], [title]') || [])
        .flatMap((element) => [element.getAttribute("aria-label"), element.getAttribute("title")])
    ];
    // Keep the unmodified label as the first form so valid names beginning
    // with an emoji, underscore or hyphen are never stripped accidentally.
    return values.flatMap((value) => {
      const raw = normalizeText(value).replace(/^@+/, "").trim();
      const withoutDecoration = raw.replace(/^[^\p{L}\p{N}_\-（(]+/u, "");
      return raw === withoutDecoration ? [raw] : [raw, withoutDecoration];
    }).filter(Boolean);
  }

  function mentionName(root, candidateNames) {
    const labels = mentionLabels(root);
    return candidateNames.find((candidate) => labels.some((label) => {
      if (label === candidate) return true;
      const compactLabel = label.replace(/\s+/gu, "");
      const compactCandidate = candidate.replace(/\s+/gu, "");
      if (!compactLabel || !compactCandidate ||
        compactLabel.length % compactCandidate.length) return false;
      return compactLabel === compactCandidate.repeat(
        compactLabel.length / compactCandidate.length
      );
    })) || "";
  }

  // Build a DOM-order stream that treats each outer native mention as one
  // atomic unit. This also catches image-only mention nodes whose labels live
  // in img.alt and therefore never appear in a text-node walker.
  function linearEditorEvents(editor) {
    const rootSet = new Set(mentionRoots(editor));
    const events = [];
    const visit = (node) => {
      if (rootSet.has(node)) {
        // Some Slate builds mark a void mention itself as data-slate-node=
        // element without also exposing data-slate-inline=true. Start at its
        // parent so the mention is assigned to the surrounding paragraph,
        // never mistaken for a separate block.
        events.push({
          block: textBlock(node.parentElement || node.parentNode || node, editor),
          root: node,
          type: "mention"
        });
        return;
      }
      if (node?.nodeType === 3) {
        events.push({
          block: textBlock(node, editor),
          node,
          type: "text",
          value: node.nodeValue || ""
        });
        return;
      }
      for (const child of Array.from(node?.childNodes || [])) visit(child);
    };
    visit(editor);
    return events;
  }

  function isSlateScaffoldText(node, editor) {
    let element = node?.parentElement || node?.parentNode || null;
    for (let depth = 0; element && element !== editor && depth < 4; depth += 1) {
      if (element.hasAttribute?.("data-slate-zero-width") ||
        element.hasAttribute?.("data-slate-spacer") ||
        element.getAttribute?.("data-slate-length") === "0") {
        return true;
      }
      element = element.parentElement || element.parentNode || null;
    }
    return false;
  }

  function meaningfulEventText(event, editor, from = 0) {
    if (isSlateScaffoldText(event.node, editor)) return "";
    return String(event.value || "").slice(from)
      .replace(/[\u200B-\u200D\u2060\uFEFF]/gu, "");
  }

  // A source slot is complete only when its original @name still exists and
  // the first meaningful DOM unit after it, in the same Slate block, is an
  // exact same-name native mention. Spaces, punctuation and ordinary text are
  // meaningful; only Slate's zero-width caret leaves may be skipped.
  function isMatchPaired(editor, match, snapshot = null) {
    const name = normalizeAssetName(match?.name);
    if (!editor || !name || !match?.token || !Number.isInteger(match.start)) {
      return false;
    }
    const range = findRangeAt(editor, match.token, match.start, snapshot?.map);
    if (!range?.endContainer || !Number.isInteger(range.endOffset)) return false;
    const events = snapshot?.events || linearEditorEvents(editor);
    const endpoint = snapshot ? (snapshot.endpoints.get(range.endContainer) ?? -1) : events.findIndex((event) =>
      event.type === "text" && event.node === range.endContainer
    );
    if (endpoint < 0) return false;
    const sourceBlock = textBlock(range.endContainer, editor);
    const tail = meaningfulEventText(events[endpoint], editor, range.endOffset);
    if (tail) return false;

    for (let index = endpoint + 1; index < events.length; index += 1) {
      const event = events[index];
      if (sourceBlock && event.block && event.block !== sourceBlock) return false;
      if (event.type === "mention") {
        return mentionName(event.root, [name]) === name;
      }
      const text = meaningfulEventText(event, editor);
      if (text) return false;
    }
    return false;
  }

  // Reuse DOM maps only within one synchronous read. Never cache across a
  // click/await: React can replace the document or change a native chip label.
  function pairedCandidateMatches(editor, matches) {
    if (!editor || !matches?.length) return [];
    const events = linearEditorEvents(editor);
    const snapshot = { map: textNodeMap(editor), events,
      endpoints: new Map(events.map((event, index) => [event.node, index])) };
    return matches.filter((match) => isMatchPaired(editor, match, snapshot));
  }

  function countPairedCandidateMentions(editor, matches) {
    const names = Array.from(new Set(
      (matches || []).map((match) => normalizeAssetName(match?.name)).filter(Boolean)
    ));
    const counts = new Map(names.map((name) => [name, 0]));
    for (const match of pairedCandidateMatches(editor, matches)) {
      const name = normalizeAssetName(match?.name);
      if (name) {
        counts.set(name, (counts.get(name) || 0) + 1);
      }
    }
    return counts;
  }

  function unpairedCandidateMatches(editor, candidateNames) {
    const matches = matchPromptToCandidates(plainText(editor), candidateNames || []);
    const paired = new Set(pairedCandidateMatches(editor, matches));
    return matches.filter((match) => !paired.has(match));
  }

  // Native chips remain available when the upload catalogue is invalidated.
  // Their full labels resolve spaced filenames for display only; they must
  // never manufacture upload candidates or satisfy a different source slot.
  function highlightCandidateNames(editor, candidateNames = []) {
    return Array.from(new Set([
      ...candidateNames,
      ...mentionRoots(editor).flatMap(mentionLabels)
    ].map(normalizeAssetName).filter(Boolean)));
  }

  // Absolute diagnostic counts use unique outer mention roots and exact labels.
  function countCandidateMentions(editor, candidateNames) {
    const names = Array.from(new Set(
      (candidateNames || []).map(normalizeAssetName).filter(Boolean)
    )).sort((a, b) => b.length - a.length);
    const counts = new Map(names.map((name) => [name, 0]));
    if (!names.length) return counts;

    for (const root of mentionRoots(editor)) {
      const name = mentionName(root, names);
      if (name) counts.set(name, counts.get(name) + 1);
    }
    return counts;
  }

  function removeOverlay() {
    document.getElementById(overlayId)?.remove();
  }

  function clearHighlights() {
    plugin.state.highlightActive = false;
    plugin.state.highlightCount = 0;
    scope.CSS?.highlights?.delete(highlightName);
    removeOverlay();
  }

  function compactName(name) {
    return name.length > maxUnmatchedNameLength
      ? `${name.slice(0, maxUnmatchedNameLength)}…`
      : name;
  }

  // Always show a separate warning above the editor. This remains visible even
  // when Dreamina prevents extensions from recoloring Slate text ranges.
  function addUnmatchedSummary(overlay, editor, names) {
    if (!names.length) return;
    const rect = editor.getBoundingClientRect();
    const left = Math.min(Math.max(12, rect.left), Math.max(12, innerWidth - 272));
    const summary = document.createElement("div");
    summary.className = "jam-unmatched-summary";
    const label = document.createElement("span");
    label.className = "jam-unmatched-summary-label";
    label.textContent = `未匹配 ${names.length} 项`;
    summary.appendChild(label);
    for (const name of names.slice(0, 3)) {
      const chip = document.createElement("span");
      chip.className = "jam-unmatched-summary-chip";
      chip.textContent = `@${compactName(name)}`;
      summary.appendChild(chip);
    }
    if (names.length > 3) {
      const more = document.createElement("span");
      more.className = "jam-unmatched-summary-more";
      more.textContent = `+${names.length - 3}`;
      summary.appendChild(more);
    }
    summary.style.left = `${left}px`;
    summary.style.top = `${Math.max(86, rect.top - 42)}px`;
    summary.style.maxWidth = `${Math.max(260, Math.min(rect.width, innerWidth - left - 12))}px`;
    overlay.appendChild(summary);
  }

  // The overlay lives outside Slate, so Dreamina cannot reconcile it away.
  function highlightReferences(editor, references, { exactPositions = false } = {}) {
    if (exactPositions && references?.length) {
      const pairedStarts = new Set(matchPromptToCandidates(
        plainText(editor),
        highlightCandidateNames(editor, references.map((reference) => reference.name))
      ).filter((match) => isMatchPaired(editor, match)).map((match) => match.start));
      references = references.filter((reference) => !pairedStarts.has(reference.start));
    }
    plugin.state.applyingHighlights = true;
    scope.CSS?.highlights?.delete(highlightName);
    removeOverlay();
    if (!references?.length) {
      plugin.state.highlightActive = false;
      plugin.state.highlightCount = 0;
      plugin.state.applyingHighlights = false;
      return [];
    }
    const names = [];
    const seen = new Set();
    const ranges = [];
    const usedRangeKeys = new Set();
    const rangeKey = (item) => `${item.position}:${item.range.toString()}`;
    const regularMap = highlightTextMap(editor);
    const compactMap = compactHighlightTextMap(regularMap);
    const atSigns = findHighlightRanges(regularMap, "@");
    for (const reference of references) {
      if (seen.has(reference.name)) continue;
      seen.add(reference.name);
      // Keep full names in state; truncation is presentation-only.
      names.push(reference.name);
      const markerName = reference.name.slice(0, maxUnmatchedNameLength);
      const token = `@${markerName}`;
      let matches = exactPositions
        ? references
          .filter((item) => item.name === reference.name)
          .map((item) => ({
            position: item.start,
            range: findRangeAt(editor, item.token, item.start)
          }))
          .filter((item) => item.range)
        : findHighlightRanges(regularMap, token);
      if (!matches.length && !exactPositions) {
        matches = findHighlightRanges(compactMap, token, true);
      }

      // If an overlong unseparated phrase was parsed as a name, mark its stable
      // prefix. As a final fallback, mark the nearest @ sign visibly.
      if (!matches.length && !exactPositions && markerName.length > 8) {
        const prefix = `@${markerName.slice(0, 8)}`;
        matches = findHighlightRanges(regularMap, prefix);
        if (!matches.length) matches = findHighlightRanges(compactMap, prefix, true);
      }
      if (!matches.length && !exactPositions) {
        let unusedAt = null;
        for (const item of atSigns) {
          if (usedRangeKeys.has(rangeKey(item))) continue;
          if (!unusedAt || Math.abs(item.position - reference.start) <
            Math.abs(unusedAt.position - reference.start)) {
            unusedAt = item;
          }
        }
        if (unusedAt) matches = [unusedAt];
      }

      for (const item of matches) {
        const key = rangeKey(item);
        if (usedRangeKeys.has(key)) continue;
        usedRangeKeys.add(key);
        ranges.push(item);
      }
    }

    const overlay = document.createElement("div");
    overlay.id = overlayId;
    overlay.setAttribute("aria-hidden", "true");
    let markedCount = 0;

    addUnmatchedSummary(overlay, editor, names);

    // Keep the browser-native range highlight as the first display channel.
    const nativeRanges = ranges.map((item) => item.range);
    if (
      nativeRanges.length &&
      scope.CSS?.highlights &&
      typeof scope.Highlight === "function"
    ) {
      scope.CSS.highlights.set(highlightName, new scope.Highlight(...nativeRanges));
    }

    // Draw only translucent line rectangles outside Slate. Copying the text
    // itself caused doubled glyphs and incorrect wrapping on Dreamina.
    const editorRect = editor.getBoundingClientRect();
    for (const item of ranges) {
      try {
        const rects = Array.from(item.range.getClientRects())
          .map((rect) => ({
            bottom: Math.min(rect.bottom, editorRect.bottom),
            left: Math.max(rect.left, editorRect.left),
            right: Math.min(rect.right, editorRect.right),
            top: Math.max(rect.top, editorRect.top)
          }))
          .map((rect) => ({
            ...rect,
            height: rect.bottom - rect.top,
            width: rect.right - rect.left
          }))
          .filter((rect) => rect.width > 0 && rect.height > 0);
        for (const rect of rects) {
          const mark = document.createElement("span");
          mark.className = "jam-unmatched-overlay-mark";
          mark.style.left = `${rect.left}px`;
          mark.style.top = `${rect.top}px`;
          mark.style.width = `${rect.width + 1}px`;
          mark.style.height = `${rect.height}px`;
          overlay.appendChild(mark);
        }
        if (rects.length) markedCount += 1;
      } catch (error) {
        console.warn("[即梦素材匹配] 无法绘制标红覆盖层", error);
      }
    }
    if (overlay.childElementCount > 0) document.documentElement.appendChild(overlay);
    plugin.state.highlightCount = Math.max(markedCount, nativeRanges.length);
    plugin.state.highlightActive = names.length > 0;
    setTimeout(() => {
      plugin.state.applyingHighlights = false;
    }, 80);
    return names;
  }

  // Shared by highlighting, the toolbar count and the send confirmation.
  // Neither an empty catalogue nor preserved source text proves a missing pair.
  function unpairedPromptReferences(editor, candidateNames = null) {
    const knownNames = highlightCandidateNames(
      editor, candidateNames || plugin.state.candidateNamesSnapshot || []
    );
    const missing = missingPromptReferences(plainText(editor), knownNames)
      .filter((reference) => !isMatchPaired(editor, reference));
    return [...unpairedCandidateMatches(editor, knownNames), ...missing]
      .sort((left, right) => left.start - right.start);
  }

  function highlightRemaining(editor, candidateNames = null) {
    return highlightReferences(editor, unpairedPromptReferences(editor, candidateNames),
      { exactPositions: true });
  }

  function refreshHighlights(event) {
    if (!plugin.state.highlightActive || plugin.state.applyingHighlights) return;
    const scrolling = event?.type === "scroll";
    if (scrolling) removeOverlay();
    clearTimeout(plugin.state.highlightTimer);
    plugin.state.highlightTimer = setTimeout(() => {
      const editor = findEditor();
      if (editor && plugin.state.highlightActive && !plugin.state.applyingHighlights) {
        highlightRemaining(editor, plugin.state.candidateNamesSnapshot || []);
      }
    }, scrolling ? 30 : 90);
  }

  plugin.editor = {
    clearHighlights,
    countCandidateMentions,
    countPairedCandidateMentions,
    deleteTextAt,
    findEditor,
    findRangeAt,
    pairedCandidateMatches,
    highlightReferences,
    highlightRemaining,
    insertText,
    isMatchPaired,
    placeCaretAfterMatch,
    plainText,
    refreshHighlights,
    verifyNativeSelection: (editor, match) => syncNativeSelection(editor, match.token, "verify"),
    nativeSelectionAction: (editor, mode) => syncNativeSelection(editor, "", mode),
    unpairedCandidateMatches,
    unpairedPromptReferences
  };
})(globalThis);
