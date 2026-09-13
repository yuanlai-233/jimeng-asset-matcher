(function installNativePickerBridge() {
  "use strict";

  // MAIN world is needed only for the site's new native file-picker API.
  // File bytes come from a short-lived DOM FileList supplied by the isolated
  // uploader. Never read a directory, fetch a URL, or keep a global file cache.
  const requestEvent = "jimeng-local-picker-request";
  const resultEvent = "jimeng-local-picker-result";
  let active = false;
  const media = globalThis.JimengMediaFiles;

  document.addEventListener(requestEvent, (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "file" ||
      !input.hasAttribute("data-jimeng-picker-request") || !input.isConnected) return;
    const report = (status) => {
      input.setAttribute("data-jimeng-picker-result", status);
      input.dispatchEvent(new Event(resultEvent));
    };
    if (active || typeof window.showOpenFilePicker !== "function") return report("unavailable");
    const root = input.parentElement;
    if (!root?.matches('[class*="generator-"]') ||
      !root.querySelector('.ProseMirror[contenteditable="true"]')) return report("invalid-target");
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      return element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
        rect.width > 1 && rect.height > 1;
    };
    const targets = Array.from(root.querySelectorAll('[class*="reference-upload-"]'))
      .filter(visible);
    const files = Array.from(input.files || []);
    if (targets.length !== 1 || !files.length || files.length > 100 ||
      files.some((file) => !media.kindOf(file))) return report("invalid-target");

    active = true;
    const original = window.showOpenFilePicker;
    let timer;
    let done = false;
    const cleanup = () => {
      done = true;
      clearTimeout(timer);
      if (window.showOpenFilePicker === picker) window.showOpenFilePicker = original;
      document.removeEventListener("pointerdown", interrupt, true);
      document.removeEventListener("keydown", interrupt, true);
      active = false;
    };
    const interrupt = (interaction) => {
      if (!interaction.isTrusted) return;
      cleanup();
      report("interrupted");
    };
    const picker = async (options) => {
      if (done) throw new DOMException("Upload cancelled", "AbortError");
      if (!media.pickerAcceptsFiles(options, files)) {
        cleanup();
        report("incompatible");
        throw new DOMException("Incompatible upload picker", "AbortError");
      }
      cleanup();
      // The native uploader consumes getFile(); no filesystem write methods
      // or extra files are exposed. Restore the real picker before delivery.
      report("dispatched");
      return files.map((file) => ({
        kind: "file", name: file.name, getFile: async () => file
      }));
    };
    try {
      window.showOpenFilePicker = picker;
      if (window.showOpenFilePicker !== picker) throw new Error("Picker is read-only");
      document.addEventListener("pointerdown", interrupt, true);
      document.addEventListener("keydown", interrupt, true);
      timer = setTimeout(() => { cleanup(); report("timeout"); }, 1800);
      targets[0].click();
    } catch (_error) {
      cleanup();
      report("unavailable");
    }
  });
})();

// The isolated content script can select DOM text, but Tiptap's toolbar reads
// EditorState, not that DOM selection. Synchronize through the editor's own
// transaction API. Both modern editors may own a single temporary trigger; native rows
// remain the only mechanism that constructs mention nodes.
(function installEditorSelectionBridge() {
  const pinned = new WeakMap();
  const settling = new WeakMap();
  document.addEventListener("jimeng-editor-selection-request", (event) => {
    const editor = event.target;
    if (!editor?.matches?.('.ProseMirror[contenteditable="true"]') ||
      !editor.isConnected) return;
    const canvasForm = editor.closest('form[data-testid="video-generation-form"]');
    if (!editor.closest('[class*="generator-"]') && !canvasForm) return;
    const result = (value) => editor.setAttribute("data-jimeng-selection-result", value);
    try {
      const request = JSON.parse(editor.getAttribute("data-jimeng-selection-request") || "{}");
      const ownedCleanup = request.mode === "cleanup-trigger";
      if (!ownedCleanup && (!editor.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) ||
        editor.getBoundingClientRect().height < (canvasForm ? 1 : 36))) return result("hidden");
      const view = editor.editor?.view;
      if (!view || view.dom !== editor || view.isDestroyed) return result("unsupported");
      if (request.mode === "begin-settle" || request.mode === "settle") {
        if (!canvasForm) return result("unsupported");
        const saved = settling.get(editor);
        // Canvas can asynchronously replace its controlled document and reset
        // selection after the preceding native chip was already visible. Wait
        // for rich-document stability BEFORE pinning the next source caret.
        if (request.mode === "begin-settle" || !saved || !saved.doc.eq(view.state.doc)) {
          settling.set(editor, { doc: view.state.doc, since: Date.now() });
          return result("settling");
        }
        return result(Date.now() - saved.since >= 300 ? "synced" : "settling");
      }
      if (request.mode === "capture-trigger") {
        if (view.state.selection.from !== view.state.selection.to) return result("invalid-selection");
        // Catalogue discovery has no source-token caret to pin. Reveal the
        // existing native selection too, before the toolbar anchors its popup.
        if (canvasForm) view.dispatch(view.state.tr.scrollIntoView());
        const previous = pinned.get(editor);
        pinned.set(editor, { doc: view.state.doc, pos: view.state.selection.from,
          token: previous?.token || "", beforeTrigger: true });
        return result("synced");
      }
      if (request.mode === "append-trigger") {
        const saved = pinned.get(editor);
        // Either modern toolbar can reuse an existing @query. Its candidate would
        // replace that source token. Only after the real toolbar was opened,
        // create a separate single-character query using Tiptap's transaction.
        // Discovery also needs an empty query: the caret may currently follow
        // a missing name. A changed document/selection must always fail.
        if (!saved?.beforeTrigger ||
          !view.state.doc.eq(saved.doc) || view.state.selection.from !== saved.pos ||
          view.state.selection.to !== saved.pos ||
          (saved.token && saved.doc.textBetween(saved.pos - saved.token.length, saved.pos, "", "\ufffc") !== saved.token)) {
          return result("changed");
        }
        const triggerTr = view.state.tr.insertText("@", saved.pos, saved.pos);
        if (canvasForm) triggerTr.scrollIntoView();
        view.dispatch(triggerTr);
        view.focus();
        return result("synced");
      }
      if (request.mode === "accept-trigger") {
        const saved = pinned.get(editor);
        if (!saved?.beforeTrigger || view.state.selection.from !== saved.pos + 1 ||
          view.state.selection.to !== saved.pos + 1 ||
          view.state.doc.textBetween(saved.pos, saved.pos + 1) !== "@" ||
          !view.state.tr.delete(saved.pos, saved.pos + 1).doc.eq(saved.doc)) return result("changed");
        pinned.set(editor, { doc: view.state.doc, originalDoc: saved.doc,
          pos: saved.pos + 1, token: saved.token, ownsTrigger: true });
        return result("synced");
      }
      if (request.mode === "cleanup-trigger") {
        const saved = pinned.get(editor);
        pinned.delete(editor);
        // Canvas collaboration may replace the document with an equal copy.
        // Full rich-document equality still rejects user edits and chip commits.
        if (!saved?.ownsTrigger || !saved.doc.eq(view.state.doc)) return result("unchanged");
        const tr = view.state.tr.delete(saved.pos - 1, saved.pos);
        if (!tr.doc.eq(saved.originalDoc)) return result("changed");
        view.dispatch(tr);
        return result("synced");
      }
      if (request.mode === "cleanup-inserted-trigger") {
        const saved = pinned.get(editor);
        // The ordinary page appends its native atom without consuming our @.
        // Remove only that owned character when the ONLY other document change
        // is one observed native reference atom immediately after it. Comparing
        // the entire projected rich document also protects old chips/attributes.
        const doc = view.state.doc;
        const mention = saved?.ownsTrigger && doc.nodeAt(saved.pos);
        if (canvasForm || !mention || mention.type.name !== "reference-mention-tag" ||
          !mention.isInline || !mention.isAtom || mention.nodeSize !== 1 ||
          doc.textBetween(saved.pos - 1, saved.pos) !== "@" ||
          !view.state.tr.delete(saved.pos - 1, saved.pos + mention.nodeSize).doc.eq(saved.originalDoc)) {
          return result("unchanged");
        }
        view.dispatch(view.state.tr.delete(saved.pos - 1, saved.pos));
        pinned.delete(editor);
        return result("synced");
      }
      if (request.mode === "verify") {
        const saved = pinned.get(editor);
        // Both editors can commit an equal immutable document between native
        // picker renders. Full structural equality includes old chip attributes.
        const equalDoc = saved && (saved.doc === view.state.doc || saved.doc.eq?.(view.state.doc));
        return result(saved && equalDoc && saved.token === request.token &&
          view.state.selection.from === saved.pos && view.state.selection.to === saved.pos
          ? "synced" : "changed");
      }
      pinned.delete(editor);
      const selection = window.getSelection();
      if (!selection?.rangeCount || !selection.isCollapsed || !request.token?.startsWith("@")) {
        return result("invalid-selection");
      }
      const range = selection.getRangeAt(0);
      if (!editor.contains(range.endContainer)) return result("outside-editor");
      const pos = view.posAtDOM(range.endContainer, range.endOffset, -1);
      const doc = view.state.doc;
      if (pos < request.token.length ||
        doc.textBetween(pos - request.token.length, pos, "", "\ufffc") !== request.token) {
        return result("source-changed");
      }
      const next = view.state.selection.constructor.near(doc.resolve(pos), -1);
      if (next.from !== pos || next.to !== pos) return result("invalid-position");
      const selectionTr = view.state.tr.setSelection(next);
      // Long canvas prompts keep off-screen paragraphs mounted. The mention
      // popup anchors to the caret, so make the native selection visible before
      // opening it; otherwise the popup exists entirely outside the viewport.
      if (canvasForm) selectionTr.scrollIntoView();
      view.dispatch(selectionTr);
      view.focus();
      if (view.state.doc !== doc || view.state.selection.from !== pos || view.state.selection.to !== pos) {
        return result("changed");
      }
      pinned.set(editor, { doc, pos, token: request.token });
      result("synced");
    } catch (_error) {
      pinned.delete(editor);
      result("unsupported");
    }
  });
})();
