(function createCanvasAdapter(scope) {
  "use strict";
  const plugin = scope.JimengAssetPlugin;
  const formSelector = 'form[data-testid="video-generation-form"]';
  const pickerTexts = new WeakMap();
  let activePickerEditor = null;
  const uploadStates = new Map();
  const uploadOwners = new WeakMap();
  function uploadStateFor(editor) {
    if (!editor) return null;
    if (uploadOwners.has(editor)) return uploadOwners.get(editor);
    const form = formFor(editor);
    const nodeId = form?.getAttribute?.("data-target-id");
    if (!nodeId) return null;
    const key = JSON.stringify([scope.location?.pathname || "", nodeId]);
    if (!uploadStates.has(key)) uploadStates.set(key, { pending: [], verified: new Set(), rejected: false });
    const state = uploadStates.get(key);
    uploadOwners.set(editor, state);
    return state;
  }
  function formFor(editor) {
    const form = editor?.closest?.(formSelector);
    const prompt = editor?.closest?.('[data-testid="generation-prompt-editor"]');
    if (!form || !prompt || !form.contains(prompt) || !plugin.isVisible(editor)) return null;
    const editors = Array.from(form.querySelectorAll('.ProseMirror[contenteditable="true"]'))
      .filter(plugin.isVisible);
    return editors.length === 1 && editors[0] === editor ? form : null;
  }
  function uniqueButton(editor, predicate) {
    const form = formFor(editor);
    if (!form) return null;
    const buttons = Array.from(form.querySelectorAll("button"))
      .filter((button) => plugin.isVisible(button) && predicate(button));
    return buttons.length === 1 ? buttons[0] : null;
  }
  function referenceButton(editor) {
    return uniqueButton(editor, (button) => button.getAttribute("aria-label") === "引用参考" &&
      !button.closest('[data-testid="generation-prompt-editor"]'));
  }
  function sendButton(editor) {
    return uniqueButton(editor, (button) => button.getAttribute("aria-label") === "生成" &&
      button.getAttribute("type") === "submit");
  }
  function editorArea(editor) {
    const form = formFor(editor);
    const area = editor?.closest?.('[data-slot="generation-prompt-area"]');
    return form && area && form.contains(area) ? area : editor;
  }
  function pickerIsOpen(editor) {
    const form = formFor(editor);
    return Boolean(form && Array.from(form.querySelectorAll('[role="listbox"]')).some(
      plugin.candidates?.isInteractiveElement || plugin.isVisible));
  }
  function materialSlots(editor) {
    const form = editor?.closest?.(formSelector);
    return form ? Array.from(form.querySelectorAll('[data-slot="generation-material-slot"]'))
      .filter((slot) => slot.hasAttribute("data-material-type")) : null;
  }
  function materialSignature(editor) {
    const slots = materialSlots(editor);
    if (!slots) return null;
    return JSON.stringify(slots.map((slot) => [
      slot.getAttribute("data-material-type"), slot.getAttribute("aria-busy"),
      slot.getAttribute("aria-label"),
      Array.from(slot.querySelectorAll('img, video, audio')).map((media) =>
        [media.currentSrc || media.src || "", media.poster || "", media.alt || ""])
    ]));
  }
  function materialState(editor) {
    const form = formFor(editor);
    if (!form?.dispatchEvent) return null;
    const key = "data-jimeng-canvas-material-state";
    form.removeAttribute(key);
    form.dispatchEvent(new Event("jimeng-canvas-material-state-request", { bubbles: true }));
    try {
      const entries = JSON.parse(form.getAttribute(key) || "null");
      const slots = materialSlots(editor);
      return Array.isArray(entries) && entries.length === slots.length &&
        entries.every((entry) => typeof entry.id === "string" && typeof entry.name === "string" &&
          ["ready", "failed", "uploading"].includes(entry.status)) ? entries : null;
    } catch (_error) { return null; }
    finally { form.removeAttribute(key); }
  }
  function capturePicker(editor) {
    // Shared by ordinary and canvas Tiptap editors. The upload state above
    // remains strictly per canvas node; these WeakMaps only own transient queries.
    if (!plugin.editor.nativeSelectionAction(editor, "capture-trigger")) return false;
    pickerTexts.set(editor, { before: plugin.editor.plainText(editor) });
    activePickerEditor = editor;
    return true;
  }
  async function waitForEditorSettled(editor) {
    plugin.editor.nativeSelectionAction(editor, "begin-settle");
    return Boolean(await plugin.waitFor(() => formFor(editor) &&
      plugin.editor.nativeSelectionAction(editor, "settle"), 2400, 50));
  }
  function acceptPicker(editor) {
    if (!plugin.editor.nativeSelectionAction(editor, "accept-trigger")) {
      if (!plugin.editor.nativeSelectionAction(editor, "append-trigger") ||
        !plugin.editor.nativeSelectionAction(editor, "accept-trigger")) return false;
    }
    const saved = pickerTexts.get(editor);
    if (!saved) return false;
    saved.after = plugin.editor.plainText(editor);
    return true;
  }
  function expectedPickerText(editor, before) {
    const saved = pickerTexts.get(editor);
    return saved?.before === before && saved.after ? saved.after : before;
  }
  function cleanupPicker(editor) {
    const owner = activePickerEditor || editor;
    if (!owner || !pickerTexts.has(owner)) return;
    plugin.editor.nativeSelectionAction(owner, "cleanup-inserted-trigger");
    const restored = plugin.editor.nativeSelectionAction(owner, "cleanup-trigger");
    pickerTexts.delete(owner);
    activePickerEditor = null;
    return restored;
  }
  function cleanupInsertedTrigger(editor) {
    if (pickerTexts.has(editor)) {
      plugin.editor.nativeSelectionAction(editor, "cleanup-inserted-trigger");
    }
  }
  plugin.canvas = { uploadStateFor, formFor, referenceButton, sendButton, editorArea, pickerIsOpen, materialSlots, materialSignature, materialState,
    waitForEditorSettled, capturePicker, acceptPicker, expectedPickerText, cleanupPicker, cleanupInsertedTrigger };
})(globalThis);
