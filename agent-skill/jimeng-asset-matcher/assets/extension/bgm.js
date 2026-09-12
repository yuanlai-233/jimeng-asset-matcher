(function createBackgroundMusicControl(scope) {
  "use strict";
  const plugin = scope.JimengAssetPlugin;
  const id = "jimeng-bgm-toggle";
  const states = new WeakMap();
  const canvasStates = new Map();
  let current = null;
  let button = null;
  let timer = null;
  let composing = false;
  let applying = false;

  function stateFor(editor) {
    if (states.has(editor)) return states.get(editor);
    const node = plugin.canvas?.formFor(editor)?.getAttribute("data-target-id");
    const key = node ? JSON.stringify([scope.location?.pathname, node]) : null;
    const state = (key && canvasStates.get(key)) || { enabled: false };
    if (key) canvasStates.set(key, state);
    states.set(editor, state);
    return state;
  }

  function request(editor, payload) {
    editor.setAttribute("data-jimeng-bgm-request", JSON.stringify(payload));
    try {
      editor.dispatchEvent(new Event("jimeng-bgm-request", { bubbles: true }));
      return JSON.parse(editor.getAttribute("data-jimeng-bgm-result") || "{}");
    } finally {
      editor.removeAttribute("data-jimeng-bgm-request");
      editor.removeAttribute("data-jimeng-bgm-result");
    }
  }

  function busy() { return plugin.state.matching || plugin.state.localUploading || composing; }
  function render() {
    if (!button || !current) return;
    const enabled = stateFor(current.editor).enabled;
    const label = `背景音乐：${enabled ? "开启，点击关闭" : "关闭，点击开启"}`;
    if (button.getAttribute("aria-label") !== label) {
      button.setAttribute("aria-label", label);
      button.setAttribute("aria-checked", String(enabled));
      button.title = label;
    }
    button.disabled = busy();
  }

  function flush(editor = current?.editor) {
    clearTimeout(timer);
    if (editor && !states.has(editor)) return true;
    if (!editor || applying || busy()) return !busy();
    applying = true;
    try {
      const wasVerified = plugin.state.matchStatusVerified && plugin.state.matchStatusEditor === editor &&
        plugin.state.verifiedEditorSignature === plugin.ui.editorVerificationSignature(editor) &&
        !plugin.ui.materialBaselineChanged(editor);
      const result = request(editor, { mode: "sync", enabled: stateFor(editor).enabled });
      if (result.ok && result.changed) {
        if (wasVerified) plugin.ui.markMatchVerified(editor);
        plugin.ui.updateMatchStatus({ contentDirty: true });
      }
      return result.ok === true;
    } finally { applying = false; }
  }

  function schedule() {
    if (applying || busy() || !current) return;
    clearTimeout(timer);
    timer = setTimeout(() => flush(), 500);
  }

  function setStyle(name, value) {
    if (button.style.getPropertyValue(name) !== value) button.style.setProperty(name, value);
  }

  function mount(context) {
    if (!context?.nativeAtButton || !context.editor.matches?.(".ProseMirror")) {
      button?.remove(); current = null; clearTimeout(timer); return;
    }
    const { nativeAtButton: at, editor, composerRoot } = context;
    // Insert after the native button's badge/wrapper, in the same layout row.
    let anchor = at;
    for (let depth = 0; anchor?.parentElement && depth < 4; depth++) {
      const parent = anchor.parentElement;
      if (parent === composerRoot || !composerRoot.contains(parent)) return;
      const style = getComputedStyle(parent);
      if (/flex|grid/.test(style.display) && !String(style.flexDirection).startsWith("column")) break;
      anchor = parent;
    }
    if (!anchor?.parentElement || !/flex|grid/.test(getComputedStyle(anchor.parentElement).display)) return;
    const changed = current?.editor !== editor;
    if (changed && !request(editor, { mode: "probe" }).ok) {
      button?.remove(); current = null; clearTimeout(timer); return;
    }
    current = context;
    if (!button) {
      document.getElementById(id)?.remove();
      button = document.createElement("button");
      button.id = id;
      button.type = "button";
      button.setAttribute("role", "switch");
      button.setAttribute("data-jimeng-bgm", "true");
      button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" preserveAspectRatio="xMidYMid meet"><path d="M9 18V5l11-2v13M9 9l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2.5"/><ellipse cx="17" cy="16" rx="3" ry="2.5"/><path class="jam-bgm-slash" d="m3 3 18 18"/></svg>';
      for (const type of ["pointerdown", "mousedown"]) button.addEventListener(type, (event) => {
        event.preventDefault(); event.stopPropagation();
      });
      button.addEventListener("click", (event) => {
        event.preventDefault(); event.stopPropagation();
        if (busy() || !current) return;
        const state = stateFor(current.editor);
        state.enabled = !state.enabled;
        if (!flush()) {
          state.enabled = !state.enabled;
          plugin.ui.toast("背景音乐设置未写入，请等输入结束后重试。", "warning");
        }
        render();
      });
    }
    const className = `${at.className} jam-bgm-toggle`;
    if (button.className !== className) button.className = className;
    const size = Math.max(24, Math.min(48, at.offsetHeight || 32));
    setStyle("--jam-bgm-size", `${size}px`);
    const icon = at.querySelector("svg");
    setStyle("--jam-bgm-icon", `${Math.max(14, Math.min(24, Number(icon?.getAttribute("width")) || 16))}px`);
    const rowGap = parseFloat(getComputedStyle(anchor.parentElement).columnGap) || 0;
    setStyle("--jam-bgm-gap", rowGap ? "0px" : "8px");
    if (anchor.nextElementSibling !== button) anchor.after(button);
    render();
    if (changed) schedule();
  }

  document.addEventListener("input", (event) => {
    if (current && (event.target === current.editor || current.editor.contains(event.target))) schedule();
  }, true);
  document.addEventListener("focusin", (event) => {
    if (event.target.matches?.('.ProseMirror[contenteditable="true"]')) plugin.ui.scheduleMatchControlPosition();
  }, true);
  document.addEventListener("compositionstart", () => { composing = true; clearTimeout(timer); render(); }, true);
  document.addEventListener("compositionend", () => { composing = false; render(); schedule(); }, true);
  plugin.bgm = { mount, flush, schedule, render };
})(globalThis);
