"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

// ----- named fakes for the browser globals shared/i18n.js reaches for -----

// Stands in for chrome.i18n. getMessage mirrors the real contract: unknown keys
// return "" (which the helper turns into a visible fallback), and positional
// $1..$9 tokens are replaced from the substitutions array.
class FakeChromeI18n {
  constructor(messages, uiLanguage) {
    this.messages = messages;
    this.uiLanguage = uiLanguage;
    this.getMessage = (key, subs = []) => {
      const template = this.messages[key];
      if (template === undefined) return "";
      const list = Array.isArray(subs) ? subs : [subs];
      return template.replace(/\$(\d)/g, (_, d) => list[Number(d) - 1] ?? "");
    };
    this.getUILanguage = () => this.uiLanguage;
  }
}

// Minimal Element: enough surface for applyI18n (dataset, get/setAttribute,
// textContent, innerHTML). data-* attributes are mirrored into `dataset` the way
// the DOM does (data-i18n-html → dataset.i18nHtml).
class FakeElement {
  constructor(attributes = {}) {
    this._attributes = { ...attributes };
    this.dataset = FakeElement.datasetOf(attributes);
    this.textContent = "";
    this.innerHTML = "";
  }
  static datasetOf(attributes) {
    const dataset = {};
    for (const [name, value] of Object.entries(attributes)) {
      if (!name.startsWith("data-")) continue;
      const camel = name.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
      dataset[camel] = value;
    }
    return dataset;
  }
  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this._attributes, name);
  }
  getAttribute(name) {
    return this.hasAttribute(name) ? this._attributes[name] : null;
  }
  setAttribute(name, value) {
    this._attributes[name] = value;
  }
}

// Stands in for document: querySelectorAll understands the single-attribute
// selectors applyI18n uses ("[data-i18n]", "[data-i18n-label]", …).
class FakeDocument {
  constructor(elements) {
    this.elements = elements;
    this.documentElement = { lang: "" };
  }
  querySelectorAll(selector) {
    const attribute = selector.slice(1, -1);
    return this.elements.filter((el) => el.hasAttribute(attribute));
  }
}

// Load the real shared/i18n.js into an isolated context wired to the fakes, then
// hand back the window.DTI18n it installs.
function loadI18n({ messages = {}, uiLanguage = "en-US", document } = {}) {
  const sandbox = {
    window: {},
    document,
    chrome: { i18n: new FakeChromeI18n(messages, uiLanguage) }
  };
  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(__dirname, "..", "shared", "i18n.js"), "utf8");
  vm.runInContext(source, sandbox, { filename: "shared/i18n.js" });
  return sandbox.window.DTI18n;
}

// ----- t() -----

test("t returns the plain message for a known key", () => {
  const dt = loadI18n({ messages: { plain: "hello" } });
  assert.equal(dt.t("plain"), "hello");
});

test("t applies positional substitutions", () => {
  const dt = loadI18n({ messages: { greeting: "Hi $1 and $2" } });
  assert.equal(dt.t("greeting", ["a", "b"]), "Hi a and b");
});

test("t falls back to the raw key when the message is missing", () => {
  const dt = loadI18n({ messages: {} });
  assert.equal(dt.t("optionsSaved"), "optionsSaved");
});

test("t rejects an empty or non-string key with a descriptive error", () => {
  const dt = loadI18n({ messages: { plain: "hello" } });
  assert.throws(() => dt.t(""), /message key/);
  assert.throws(() => dt.t(null), /message key/);
});

// ----- applyI18n() -----

test("applyI18n localizes text, html, and attribute hooks", () => {
  const messages = { plain: "hello", bold: "<b>x</b>" };
  const elements = {
    text: new FakeElement({ "data-i18n": "plain" }),
    html: new FakeElement({ "data-i18n-html": "bold" }),
    placeholder: new FakeElement({ "data-i18n-placeholder": "plain" }),
    label: new FakeElement({ "data-i18n-label": "plain" }),
    title: new FakeElement({ "data-i18n-title": "plain" })
  };
  const document = new FakeDocument(Object.values(elements));
  const dt = loadI18n({ messages, uiLanguage: "pt-BR", document });

  dt.applyI18n();

  assert.equal(elements.text.textContent, "hello");
  assert.equal(elements.html.innerHTML, "<b>x</b>");
  assert.equal(elements.placeholder.getAttribute("placeholder"), "hello");
  assert.equal(elements.label.getAttribute("aria-label"), "hello");
  assert.equal(elements.title.getAttribute("title"), "hello");
});

test("applyI18n stamps the UI language on the document element", () => {
  const document = new FakeDocument([]);
  const dt = loadI18n({ messages: {}, uiLanguage: "ja", document });
  dt.applyI18n();
  assert.equal(document.documentElement.lang, "ja");
});

test("applyI18n shows the raw key for a missing translation instead of blanking", () => {
  const element = new FakeElement({ "data-i18n": "missingKey" });
  const document = new FakeDocument([element]);
  const dt = loadI18n({ messages: {}, document });
  dt.applyI18n();
  assert.equal(element.textContent, "missingKey");
});

test("applyI18n does not treat a data-i18n-html node as a text node", () => {
  const element = new FakeElement({ "data-i18n-html": "bold" });
  const document = new FakeDocument([element]);
  const dt = loadI18n({ messages: { bold: "<b>x</b>" }, document });
  dt.applyI18n();
  assert.equal(element.textContent, ""); // untouched by the text pass
  assert.equal(element.innerHTML, "<b>x</b>");
});
