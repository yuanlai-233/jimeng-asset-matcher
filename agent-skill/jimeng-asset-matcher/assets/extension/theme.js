(function createPageTheme(scope) {
  "use strict";
  const plugin = (scope.JimengAssetPlugin ||= {});
  const document = scope.document;
  const attributes = ["lv-theme", "data-theme", "theme", "arco-theme", "data-color-mode", "data-color-scheme", "class", "style"];
  let anchor = null;
  let watched = [];
  let frame = null;
  const media = scope.matchMedia?.("(prefers-color-scheme: dark)");

  function explicitTheme(element) {
    for (const name of attributes.slice(0, -2)) {
      const value = element?.getAttribute?.(name)?.toLowerCase();
      if (value === "light" || value === "dark") return value;
    }
    const classes = String(element?.getAttribute?.("class") || "");
    const match = classes.match(/(?:^|\s)(?:theme[-_])?(light|dark)(?:[-_]theme)?(?:\s|$)/i);
    return match?.[1].toLowerCase() || null;
  }

  function ancestors(element) {
    const nodes = [];
    for (let node = element; node && nodes.length < 16; node = node.parentElement) nodes.push(node);
    for (const node of [document?.body, document?.documentElement]) {
      if (node && !nodes.includes(node)) nodes.push(node);
    }
    return nodes;
  }

  function detect(nodes) {
    // Page preferences take precedence over OS preferences. No site setting is changed.
    for (const node of nodes) {
      const explicit = explicitTheme(node);
      if (explicit) return explicit;
    }
    for (const node of nodes) {
      const style = scope.getComputedStyle?.(node);
      if (style?.colorScheme === "dark" || style?.colorScheme === "light") return style.colorScheme;
      const rgb = String(style?.backgroundColor || "").match(/^rgba?\(([^)]+)\)$/);
      if (!rgb) continue;
      const values = rgb[1].split(/[,\s/]+/).map(Number);
      if (values.length < 3 || values.some(Number.isNaN) || (values[3] ?? 1) < 0.9) continue;
      return values[0] * .2126 + values[1] * .7152 + values[2] * .0722 > 150 ? "light" : "dark";
    }
    return media?.matches ? "dark" : "light";
  }

  function refresh() {
    frame = null;
    const root = document?.documentElement;
    if (!root) return;
    const next = detect(ancestors(anchor?.isConnected ? anchor : document.body));
    if (root.getAttribute("data-jimeng-theme") !== next) root.setAttribute("data-jimeng-theme", next);
  }

  function schedule() {
    if (frame !== null) return;
    frame = (scope.requestAnimationFrame || ((fn) => setTimeout(fn, 16)))(refresh);
  }

  const observer = typeof scope.MutationObserver === "function" ? new scope.MutationObserver(schedule) : null;
  function follow(element) {
    anchor = element || null;
    const nodes = ancestors(anchor);
    if (nodes.length !== watched.length || nodes.some((node, i) => node !== watched[i])) {
      observer?.disconnect();
      for (const node of nodes) observer?.observe(node, { attributes: true, attributeFilter: attributes });
      watched = nodes;
      refresh();
    }
  }
  media?.addEventListener?.("change", schedule);
  plugin.theme = { follow, refresh, detect, explicitTheme };
  if (document?.documentElement) follow(null);
})(globalThis);
