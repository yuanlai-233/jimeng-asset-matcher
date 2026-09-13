(function installCanvasUploadBridge() {
  "use strict";
  let active = false;
  const media = globalThis.JimengMediaFiles;
  const formSelector = 'form[data-testid="video-generation-form"]';
  const MAX_UPLOAD_BATCH_FILES = 50;
  const visible = (element) => Boolean(element?.isConnected &&
    element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
    element.getBoundingClientRect().height > 0);
  const slotSelector = '[data-slot="generation-material-slot"][data-material-type]';
  // Read only the props of this form's native material cards. Failed uploads
  // keep their filename here even when the @ menu omits them. Do not read
  // account state, URLs, file bytes, or unrelated React ancestors.
  function materialEntry(slot) {
    let fiber = slot[Object.keys(slot).find((key) => key.startsWith("__reactFiber"))];
    for (let depth = 0; fiber && depth < 6; depth++, fiber = fiber.return) {
      const props = fiber.memoizedProps;
      const material = props?.material;
      if (!material || typeof material.id !== "string" || typeof material.fileName !== "string") continue;
      const failed = props.task?.phase === "failed" || Boolean(slot.querySelector('[data-slot="generation-material-error-icon"]'));
      const busy = slot.getAttribute("aria-busy") === "true" ||
        Boolean(props.task && !["failed", "completed", "success", "succeeded"].includes(props.task.phase));
      return { slot, id: material.id, name: material.fileName, kind: material.type,
        status: failed ? "failed" : busy ? "uploading" : "ready" };
    }
    return null;
  }
  function materialsFor(form) {
    if (!form?.matches?.(formSelector)) return null;
    const slots = Array.from(form.querySelectorAll(slotSelector));
    const entries = slots.map(materialEntry);
    return entries.every(Boolean) ? entries : null;
  }
  document.addEventListener("jimeng-canvas-material-state-request", (event) => {
    const form = event.target;
    if (!form?.matches?.(formSelector) || !form.isConnected || !form.getAttribute("data-target-id")) return;
    const entries = materialsFor(form);
    form.setAttribute("data-jimeng-canvas-material-state", JSON.stringify(entries?.map(({ slot, ...entry }) => entry) ?? null));
  });

  document.addEventListener("jimeng-canvas-upload-request", async (event) => {
    const carrier = event.target;
    if (!(carrier instanceof HTMLInputElement) || carrier.type !== "file" ||
      !carrier.hasAttribute("data-jimeng-canvas-upload") || !carrier.isConnected) return;
    const report = (status) => {
      carrier.setAttribute("data-jimeng-picker-result", status);
      carrier.dispatchEvent(new Event("jimeng-local-picker-result"));
    };
    const form = carrier.parentElement;
    const editors = Array.from(form?.querySelectorAll?.('.ProseMirror[contenteditable="true"]') || []);
    const files = Array.from(carrier.files || []);
    const replaceId = carrier.getAttribute("data-jimeng-canvas-replace");
    const replacement = replaceId ? materialsFor(form)?.find((entry) => entry.id === replaceId) : null;
    const compact = (name) => String(name).normalize("NFC").replace(/\s+/gu, "");
    const fileStem = (file) => file.name.slice(0, -(media.extensionOf(file.name).length + 1));
    if (replaceId && (!replacement || replacement.status !== "failed" || files.length !== 1 ||
      compact(replacement.name) !== compact(fileStem(files[0])) ||
      ({ 2: "image", 3: "video", 4: "audio" })[replacement.kind] !== media.kindOf(files[0]))) return report("invalid-replacement");
    const buttons = replacement ? [replacement.slot] :
      Array.from(form?.querySelectorAll?.('button[aria-label="添加参考"]') || []).filter(visible);
    if (active || !form?.matches(formSelector) || !form.getAttribute("data-target-id") ||
      editors.length !== 1 || !visible(editors[0]) || buttons.length !== 1 ||
      buttons[0].disabled || buttons[0].getAttribute("aria-disabled") === "true" ||
      !files.length || files.length > MAX_UPLOAD_BATCH_FILES || files.some((file) => !file.size || !media.kindOf(file))) {
      return report("invalid-target");
    }
    const editor = editors[0];
    const originalText = editor.textContent;
    const targetId = form.getAttribute("data-target-id");
    const button = buttons[0];
    const originalClick = HTMLInputElement.prototype.click;
    const originalShowPicker = HTMLInputElement.prototype.showPicker;
    const originalOpen = window.showOpenFilePicker;
    const originalInputs = new Set(document.querySelectorAll('input[type="file"]'));
    let done = false;
    let armed = false;
    let timer;
    const current = () => visible(editor) && form.isConnected &&
      form.getAttribute("data-target-id") === targetId &&
      form.contains(editor) && editor.textContent === originalText;
    const cleanup = () => {
      done = true;
      clearTimeout(timer);
      if (HTMLInputElement.prototype.click === click) HTMLInputElement.prototype.click = originalClick;
      if (HTMLInputElement.prototype.showPicker === showPicker) HTMLInputElement.prototype.showPicker = originalShowPicker;
      if (window.showOpenFilePicker === open) window.showOpenFilePicker = originalOpen;
      document.removeEventListener("pointerdown", interrupt, true);
      document.removeEventListener("keydown", interrupt, true);
      active = false;
    };
    const stop = (status) => { if (!done) { cleanup(); report(status); } };
    const interrupt = (interaction) => { if (interaction.isTrusted) stop("interrupted"); };
    const consume = (input) => {
      if (!armed || done || input.type !== "file") return false;
      // Existing inputs replace a card or upload to the entire canvas. Only
      // the fresh input created by this node's native upload menu is eligible.
      const ownedReplacementInput = replacement && input.closest?.(formSelector) === form &&
        replacement.slot.closest?.('[data-generation-material-card]')?.contains(input);
      if (originalInputs.has(input) && !ownedReplacementInput || !current() || files.length > 1 && !input.multiple ||
        !media.acceptsFiles(String(input.accept || "").split(",").map((token) => token.trim()).filter(Boolean), files)) {
        stop("incompatible");
        return true;
      }
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files")?.set;
      if (!setter) { stop("unsupported"); return true; }
      try {
        input.value = "";
        setter.call(input, carrier.files);
        cleanup();
        // Lock the batch before the site's change handler owns its files.
        report("dispatched");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (_error) { stop("unavailable"); }
      return true;
    };
    function click(...args) { if (!consume(this)) return originalClick.apply(this, args); }
    function showPicker(...args) { if (!consume(this)) return originalShowPicker.apply(this, args); }
    async function open(options) {
      if (!armed || done || !current() || !media.pickerAcceptsFiles(options, files)) {
        stop("incompatible");
        throw new DOMException("Upload cancelled", "AbortError");
      }
      cleanup();
      report("dispatched");
      return files.map((file) => ({ kind: "file", name: file.name, getFile: async () => file }));
    }
    active = true;
    try {
      timer = setTimeout(() => stop("timeout"), 1800);
      document.addEventListener("pointerdown", interrupt, true);
      document.addEventListener("keydown", interrupt, true);
      if (replacement) {
        // Replace only an explicitly failed, same-name/same-kind card. Keep
        // its position and every successful reference instead of adding copies.
        replacement.slot.scrollIntoView({ block: "nearest", inline: "nearest" });
        HTMLInputElement.prototype.click = click;
        if (originalShowPicker) HTMLInputElement.prototype.showPicker = showPicker;
        if (typeof originalOpen === "function") window.showOpenFilePicker = open;
        armed = true;
        replacement.slot.click();
        return;
      }
      if (button.getAttribute("aria-expanded") !== "true") {
        button.dispatchEvent(new PointerEvent("pointerdown", {
          bubbles: true, button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true
        }));
      }
      let menu;
      while (!done && current()) {
        const controls = button.getAttribute("aria-controls");
        menu = controls ? document.getElementById(controls) :
          Array.from(document.querySelectorAll('[role="menu"]'))
            .find((element) => element.getAttribute("aria-labelledby") === button.id);
        if (visible(menu)) break;
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      if (done) return;
      if (!current() || !visible(menu)) return stop("target-changed");
      const items = Array.from(menu.querySelectorAll('[role="menuitem"]'))
        .filter((item) => visible(item) && item.textContent.trim() === "上传参考内容" &&
          item.getAttribute("aria-disabled") !== "true");
      if (items.length !== 1) return stop("menu-unavailable");
      HTMLInputElement.prototype.click = click;
      if (originalShowPicker) HTMLInputElement.prototype.showPicker = showPicker;
      if (typeof originalOpen === "function") window.showOpenFilePicker = open;
      armed = true;
      items[0].click();
    } catch (_error) { stop("unavailable"); }
  });
})();
