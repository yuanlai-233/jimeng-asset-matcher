const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { Schema } = require("prosemirror-model");
const { EditorState, TextSelection } = require("prosemirror-state");

const phrase = "不需要背景音乐";
const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
    mention: { inline: true, group: "inline", atom: true, attrs: { name: {} } }
  },
  marks: { strong: {} }
});
const paragraph = (...content) => schema.nodes.paragraph.create(null, content);
const t = (text) => schema.text(text);

function fixture(content = [paragraph(t("主体 @测试图"), schema.nodes.mention.create({ name: "测试图" }))]) {
  const listeners = new Map();
  const attrs = new Map();
  const hooks = new Map();
  const element = {
    isConnected: true, matches: () => true, closest: () => ({}),
    checkVisibility: () => true, getBoundingClientRect: () => ({ height: 80 }),
    setAttribute: (k, v) => attrs.set(k, v), getAttribute: (k) => attrs.get(k)
  };
  const view = {
    dom: element, composing: false,
    state: EditorState.create({ schema, doc: schema.nodes.doc.create(null, content) }),
    dispatch(tr) {
      this.state = this.state.apply(tr);
      hooks.get("transaction")?.({ transaction: tr });
    }
  };
  element.editor = { view, on: (k, fn) => hooks.set(k, fn), off: (k) => hooks.delete(k) };
  vm.runInNewContext(fs.readFileSync(require.resolve("../bgm-bridge.js"), "utf8"), {
    document: { addEventListener: (name, fn) => listeners.set(name, fn) }, WeakMap, JSON
  });
  const request = (enabled = false) => {
    attrs.set("data-jimeng-bgm-request", JSON.stringify({ mode: "sync", enabled }));
    listeners.get("jimeng-bgm-request")({ target: element });
    return JSON.parse(attrs.get("data-jimeng-bgm-result"));
  };
  return { element, view, request };
}

{
  const { view, request } = fixture();
  const original = view.state.doc;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(original, 3)));
  assert.equal(request().ok, true);
  assert.equal(view.state.doc.firstChild.textContent, phrase);
  assert.equal(view.state.selection.from, 3 + phrase.length + 2, "the caret follows the same original text");
  assert(view.state.doc.lastChild.eq(original.firstChild), "all original mentions and text survive");
  for (let n = 0; n < 8; n++) assert.equal(request().changed, false);
  assert.equal(view.state.doc.childCount, 2);
  assert.equal(request(true).ok, true);
  assert(view.state.doc.eq(original), "enabling music removes only the generated paragraph");
  for (let n = 0; n < 4; n++) { request(false); request(true); }
  assert(view.state.doc.eq(original), "repeated toggles are lossless");
}
{
  const { view, request } = fixture();
  request();
  view.dispatch(view.state.tr.insertText("开场：", view.state.doc.firstChild.nodeSize + 1));
  view.dispatch(view.state.tr.insert(view.state.doc.content.size, paragraph(t("最后定格。"))));
  request();
  assert.equal(view.state.doc.firstChild.textContent, phrase, "the owned sentence stays at the start while typing");
  request(true);
  assert.equal(view.state.doc.childCount, 2);
  assert.equal(view.state.doc.firstChild.textContent, "开场：主体 @测试图");
  assert.equal(view.state.doc.lastChild.textContent, "最后定格。");
  assert.equal(view.state.doc.firstChild.lastChild.type.name, "mention");
}
{
  const { view, request } = fixture(); request();
  view.dispatch(view.state.tr.insertText("，保留脚步声", phrase.length + 1));
  request(true);
  assert.equal(view.state.doc.firstChild.textContent, "，保留脚步声", "typing after our sentence remains intact");
}
{
  const { view, request } = fixture([paragraph(t("手写：不需要背景音乐。保留人声。"))]);
  const original = view.state.doc;
  request(false); request(true);
  assert(view.state.doc.eq(original), "a user-written instruction is neither removed nor duplicated");
}
{
  const { view, request } = fixture([paragraph()]);
  assert.equal(request().changed, false, "never fill an empty task with boilerplate");
  view.dispatch(view.state.tr.insertText("镜头推进", 1)); request();
  const bodyStart = view.state.doc.firstChild.nodeSize;
  view.dispatch(view.state.tr.delete(bodyStart, view.state.doc.content.size)); request();
  assert.equal(view.state.doc.textContent, "", "clearing all creative text does not resurrect a task");
}
{
  const { view, request } = fixture(); request();
  const after = view.state.doc;
  view.dispatch(view.state.tr.replaceWith(0, after.content.size, schema.nodeFromJSON(after.toJSON()).content));
  request(true);
  assert.equal(view.state.doc.childCount, 1, "equal controlled-value copies retain ownership");
  view.composing = true;
  assert.equal(request().ok, false, "do not interrupt IME composition");
}
{
  const a = fixture(), b = fixture();
  a.request(false); b.request(false); a.request(true);
  assert.equal(b.view.state.doc.firstChild.textContent, phrase, "different editors remain independent");
}
{
  const { view, request } = fixture(); request();
  view.dispatch(view.state.tr.insert(0, paragraph(t("新开头"))));
  request();
  assert.equal(view.state.doc.firstChild.textContent, phrase, "pasting before the instruction moves only our sentence back to the start");
  assert.equal(view.state.doc.child(1).textContent, "新开头");
  assert.equal(view.state.doc.lastChild.lastChild.type.name, "mention");
}
console.log("✓ BGM toggles preserve real ProseMirror mentions/selection, track edits, avoid duplicates and respect manual text/IME/empty tasks");
