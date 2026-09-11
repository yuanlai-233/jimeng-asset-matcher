(function installBackgroundMusicBridge() {
  "use strict";
  const phrase = "不需要背景音乐";
  const records = new WeakMap();
  const textOf = (doc) => doc.textBetween(0, doc.content.size, "\n", "\ufffc");

  function validOwned(doc, owned) {
    return owned && owned.from >= 0 && owned.to <= doc.content.size &&
      owned.to - owned.from === phrase.length &&
      doc.textBetween(owned.from, owned.to, "\n", "\ufffc") === phrase;
  }

  function recordFor(element, host) {
    const previous = records.get(element);
    if (previous?.host === host) return previous;
    previous?.dispose();
    const record = { host, doc: host.view.state.doc, owned: null };
    const track = ({ transaction: tr }) => {
      if (!tr.docChanged) return;
      // Controlled editors sometimes publish an equal document copy.
      if (record.doc.eq(tr.doc)) { record.doc = tr.doc; return; }
      if (record.owned && record.doc.eq(tr.before)) {
        const from = tr.mapping.mapResult(record.owned.from, 1);
        const to = tr.mapping.mapResult(record.owned.to, -1);
        const mapped = { from: from.pos, to: to.pos };
        record.owned = !from.deletedAcross && !to.deletedAcross && validOwned(tr.doc, mapped)
          ? mapped : null;
      } else record.owned = null;
      record.doc = tr.doc;
    };
    record.dispose = () => {
      host.off("transaction", track);
      host.off("destroy", record.dispose);
      records.delete(element);
    };
    host.on("transaction", track);
    host.on("destroy", record.dispose);
    records.set(element, record);
    return record;
  }

  function removeOwned(tr, owned) {
    const start = tr.doc.resolve(owned.from);
    // Remove the entire paragraph only when it contains our sentence alone.
    if (start.depth === 1 && start.parent.type.name === "paragraph" &&
      start.parent.textContent === phrase && start.parent.content.size === phrase.length) {
      return tr.delete(start.before(), start.after());
    }
    return tr.delete(owned.from, owned.to);
  }

  document.addEventListener("jimeng-bgm-request", (event) => {
    const element = event.target;
    const report = (result) => element.setAttribute("data-jimeng-bgm-result", JSON.stringify(result));
    if (!element?.matches?.('.ProseMirror[contenteditable="true"]') || !element.isConnected) return;
    const canvas = element.closest('form[data-testid="video-generation-form"]');
    if (!canvas && !element.closest('[class*="generator-"]')) return;
    try {
      const request = JSON.parse(element.getAttribute("data-jimeng-bgm-request") || "{}");
      const host = element.editor;
      const view = host?.view;
      if (!view || view.dom !== element || view.isDestroyed ||
        typeof host.on !== "function" || typeof host.off !== "function" ||
        !view.state.schema.nodes.paragraph ||
        !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) ||
        element.getBoundingClientRect().height < (canvas ? 1 : 36)) return report({ ok: false });
      if (request.mode === "probe") return report({ ok: true });
      if (request.mode !== "sync" || typeof request.enabled !== "boolean" || view.composing) {
        return report({ ok: false });
      }
      const record = recordFor(element, host);
      const before = view.state.doc;
      if (!record.doc.eq(before) || !validOwned(before, record.owned)) record.owned = null;
      let tr = view.state.tr;
      let owned = record.owned;
      if (owned) {
        const preceding = before.textBetween(0, owned.from, "\n", "\ufffc").trim();
        const without = removeOwned(view.state.tr, owned).doc;
        if (request.enabled || preceding || !textOf(without).trim()) {
          tr = removeOwned(tr, owned);
          owned = null;
        }
      }
      // An existing user-authored instruction is never deleted or duplicated.
      const text = textOf(tr.doc);
      if (!request.enabled && text.trim() && !text.includes(phrase)) {
        const node = view.state.schema.nodes.paragraph.create(null, view.state.schema.text(phrase));
        const pos = 0;
        tr = tr.insert(pos, node);
        owned = { from: pos + 1, to: pos + 1 + phrase.length };
      }
      if (tr.docChanged) {
        // A native transaction preserves all other text, marks, mentions and
        // the mapped selection. Never replace editor HTML or focus the caret.
        tr.setMeta("addToHistory", false);
        view.dispatch(tr);
        if (!view.state.doc.eq(tr.doc)) return report({ ok: false });
      }
      record.doc = view.state.doc;
      record.owned = validOwned(record.doc, owned) ? owned : null;
      report({ ok: true, changed: tr.docChanged, owned: Boolean(record.owned) });
    } catch (_error) { report({ ok: false }); }
  });
})();
