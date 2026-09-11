(function installCanvasUploadBridge() {
  "use strict";
  let active = false;
  const media = globalThis.JimengMediaFiles;
  const formSelector = 'form[data-testid="video-generation-form"]';
  const visible = (element) => Boolean(element?.isConnected &&
    element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
    element.getBoundingClientRect().height > 0);

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
    const buttons = Array.from(form?.querySelectorAll?.('button[aria-label="添加参考"]') || [])
      .filter(visible);
    const files = Array.from(carrier.files || []);
    if (active || !form?.matches(formSelector) || !form.getAttribute("data-target-id") ||
      editors.length !== 1 || !visible(editors[0]) || buttons.length !== 1 ||
      buttons[0].disabled || buttons[0].getAttribute("aria-disabled") === "true" ||
      !files.length || files.length > 100 || files.some((file) => !file.size || !media.kindOf(file))) {
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
      if (originalInputs.has(input) || !current() || files.length > 1 && !input.multiple ||
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
