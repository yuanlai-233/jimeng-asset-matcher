const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const listeners = new Map();
const attrs = new Map();
class Doc {
  constructor(content) { this.content = typeof content === 'string' ? Array.from(content) : content; }
  textBetween(a, b) { return this.content.slice(a, b).map(x => typeof x === 'string' ? x : '\ufffc').join(''); }
  eq(other) { return JSON.stringify(this.content) === JSON.stringify(other.content); }
  resolve(pos) { return pos; }
  nodeAt(pos) { const n = this.content[pos]; return typeof n === 'object' ? {...n, isInline: true, isAtom: true, nodeSize: 1} : null; }
}
class Selection { constructor(pos) { this.from = this.to = pos; } static near(pos) { return new Selection(pos); } }
const editor = { matches: () => true, isConnected: true,
  closest: selector => selector.startsWith('form') ? null : {},
  checkVisibility: () => true, getBoundingClientRect: () => ({height: 60}), contains: () => true,
  getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value) };
let doc, selection;
const state = { get doc() { return doc; }, get selection() { return selection; }, get tr() {
  return {doc, setSelection(s) { this.selection = s; return this; },
    insertText(text, a, b) { this.doc = new Doc([...doc.content.slice(0,a), ...text, ...doc.content.slice(b)]); this.selection = new Selection(a+text.length); return this; },
    delete(a,b) { this.doc = new Doc([...doc.content.slice(0,a), ...doc.content.slice(b)]); return this; }};
}};
const view = {dom: editor, state, focus() {}, posAtDOM: (_n,o) => o,
  dispatch(tr) { doc = tr.doc; if(tr.selection) selection = tr.selection; }};
editor.editor = {view};
vm.runInNewContext(fs.readFileSync(require.resolve('../upload-bridge.js'),'utf8'), {
  document: {addEventListener: (name, fn) => listeners.set(name,fn)},
  window: {getSelection: () => ({rangeCount:1,isCollapsed:true,getRangeAt: () => ({endContainer:{},endOffset:selection.from})})}, WeakMap, JSON
});
function request(mode, token = '') {
  attrs.set('data-jimeng-selection-request', JSON.stringify({mode,token}));
  listeners.get('jimeng-editor-selection-request')({target:editor});
  return attrs.get('data-jimeng-selection-result');
}
const atom = {type:{name:'reference-mention-tag'}, attrs:{id:'native-sample'}};
function prepare(text = 'before @sample after') {
  doc = new Doc(text); selection = new Selection(text.indexOf('@sample') + 7);
  const original = doc; const end = selection.from;
  assert.equal(request('sync','@sample'),'synced');
  assert.equal(request('capture-trigger'),'synced');
  assert.equal(request('accept-trigger'),'changed');
  assert.equal(request('append-trigger'),'synced');
  assert.equal(request('accept-trigger'),'synced');
  return {original,end};
}
for (const text of ['@sample','before @sample after','@sample and @sample']) {
  const {original,end} = prepare(text);
  doc = new Doc([...doc.content]);
  assert.equal(request('verify','@sample'),'synced','equal immutable documents remain safe');
  assert.equal(request('verify','@other'),'changed','source token must still match');
  doc = new Doc([...doc.content.slice(0,end+1), atom, ...doc.content.slice(end+1)]);
  assert.equal(request('cleanup-inserted-trigger'),'synced');
  assert.ok(doc.eq(new Doc([...original.content.slice(0,end),atom,...original.content.slice(end)])));
  assert.equal(request('cleanup-inserted-trigger'),'unchanged','cleanup cannot delete a second character');
}
for (const change of ['edit-text','edit-old-attribute','wrong-atom','consumed-trigger']) {
  const oldAtom = {type:{name:'reference-mention-tag'},attrs:{id:'old'}};
  const {end} = prepare('before @sample after');
  // Add an old atom to BOTH full snapshots through a fresh capture.
  request('cleanup-trigger');
  doc = new Doc([...doc.content,oldAtom]); selection = new Selection(end);
  request('sync','@sample'); request('capture-trigger'); request('append-trigger'); request('accept-trigger');
  const selectedAtom = change === 'wrong-atom' ? {type:{name:'other-node'},attrs:{}} : atom;
  doc = new Doc([...doc.content.slice(0,end+1),selectedAtom,...doc.content.slice(end+1)]);
  if(change === 'edit-text') doc = new Doc([...doc.content,'!']);
  if(change === 'edit-old-attribute') doc = new Doc([...doc.content.slice(0,-1),{...oldAtom,attrs:{id:'changed'}}]);
  if(change === 'consumed-trigger') doc = new Doc([...doc.content.slice(0,end),...doc.content.slice(end+1)]);
  const changed = doc;
  assert.equal(request('verify','@sample'),'changed','real rich-document changes invalidate the pin');
  assert.equal(request('cleanup-inserted-trigger'),'unchanged',change);
  assert.equal(doc,changed,'must never rewrite a changed rich document');
  request('cleanup-trigger');
}
console.log('✓ ordinary typed queries preserve each source token and remove only the owned trigger beside one native atom');
console.log('✓ trigger cleanup rejects concurrent text/attribute edits, unrelated atoms, consumed triggers and repeated cleanup');
