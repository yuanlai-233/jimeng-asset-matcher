const assert = require("assert").strict;

class TestElement {
  constructor(tagName) {
    this._listeners = new Map();
    this.children = [];
    this.className = "";
    this.dataset = {};
    this.disabled = false;
    this.id = "";
    this.parentElement = null;
    this.style = {};
    this.tagName = String(tagName || "div").toUpperCase();
    this.textContent = "";
  }

  addEventListener(type, listener) {
    this._listeners.set(type, listener);
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  closest(selector) {
    if (selector === "[data-action]" && this.dataset.action) return this;
    return this.parentElement?.closest?.(selector) || null;
  }

  contains(target) {
    return target === this || this.children.some((child) => child.contains(target));
  }

  focus() {
    document.activeElement = this;
  }

  querySelectorAll(selector) {
    const matches = [];
    for (const child of this.children) {
      if (selector === "button" && child.tagName === "BUTTON") matches.push(child);
      matches.push(...child.querySelectorAll(selector));
    }
    return matches;
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children
      .filter((child) => child !== this);
    this.parentElement = null;
  }

  setAttribute(name, value) {
    this[name] = value;
  }
}

const listeners = new Map();
const root = new TestElement("html");
const outsideButton = new TestElement("button");
root.appendChild(outsideButton);

function findById(element, id) {
  if (element.id === id) return element;
  for (const child of element.children) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

globalThis.document = {
  activeElement: outsideButton,
  addEventListener(type, listener) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(listener);
  },
  contains: (element) => root.contains(element),
  createElement: (tagName) => new TestElement(tagName),
  documentElement: root,
  getElementById: (id) => findById(root, id),
  images: [],
  querySelectorAll: () => []
};

globalThis.JimengAssetMatcher = {
  matchPromptToCandidates: () => [],
  normalizeText: (value) => String(value || "").trim(),
  parsePromptReferences: () => [],
  pruneInactiveMentionTargets: (value) => value,
  unexpectedCandidateNames: () => []
};
require("../runtime.js");

const plugin = globalThis.JimengAssetPlugin;
let resolveSeen;
const seenPromise = new Promise((resolve) => { resolveSeen = resolve; });
plugin.onboarding = {
  hasSeen: () => seenPromise,
  markSeen: async () => {},
  steps: Array.from({ length: 5 }, (_, index) => ({
    text: `虚构说明 ${index + 1}`,
    title: `步骤 ${index + 1}`
  }))
};
plugin.candidates = { isSystemMenuEntry: () => false };
plugin.editor = { findEditor: () => null };
plugin.isVisible = () => true;
require("../ui.js");

function event(type, target, extra = {}) {
  return {
    defaultPrevented: false,
    immediateStopped: false,
    key: type,
    shiftKey: false,
    target,
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.immediateStopped = true; },
    ...extra
  };
}

(async () => {
  plugin.ui.maybeShowFirstUseGuide();
  assert.equal(plugin.state.onboardingCheckStarted, true);

  const manualGuide = plugin.ui.showOnboarding({ automatic: false });
  const start = manualGuide.querySelectorAll("button")
    .find((button) => button.dataset.action === "start");
  manualGuide._listeners.get("click")({ target: start });
  assert.equal(document.getElementById(plugin.constants.onboardingId), null);

  resolveSeen(false);
  await seenPromise;
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    document.getElementById(plugin.constants.onboardingId),
    null,
    "a delayed automatic result must not reopen a manually handled guide"
  );

  plugin.ui.installSendGuard();
  const guide = plugin.ui.showOnboarding({ automatic: false });
  const buttons = guide.querySelectorAll("button");
  const keydown = listeners.get("keydown")[0];
  const click = listeners.get("click")[0];

  const tab = event("Tab", outsideButton);
  keydown(tab);
  assert.equal(tab.defaultPrevented, true);
  assert.equal(tab.immediateStopped, true);
  assert.equal(document.activeElement, buttons[0]);

  const enter = event("Enter", outsideButton);
  keydown(enter);
  assert.equal(enter.defaultPrevented, true);
  assert.equal(enter.immediateStopped, true);

  const outsideClick = event("click", outsideButton);
  click(outsideClick);
  assert.equal(outsideClick.defaultPrevented, true);
  assert.equal(outsideClick.immediateStopped, true);

  console.log("✓ onboarding resists delayed reopen and traps keyboard/outside interaction");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
