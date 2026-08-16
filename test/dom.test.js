"use strict";

// shared/dom.js exists so no surface builds markup with innerHTML — user-supplied
// text (block-list entries, phrases, the current domain) must reach the page as
// text nodes, never as parsed HTML. These tests pin that guarantee.

const test = require("node:test");
const assert = require("node:assert/strict");

const { el, createRemovableRow } = require("../shared/dom.js");

// ----- named fake: the slice of the DOM these builders touch -----

class FakeNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.className = "";
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this._text = "";
    this.disabled = false;
  }

  get textContent() {
    return this._text;
  }

  // Matches the DOM: assigning textContent replaces all children with one text node.
  set textContent(value) {
    this._text = String(value);
    this.children = [];
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  appendChild(node) {
    this.children.push(node);
    return node;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
}

class FakeTextNode {
  constructor(text) {
    this.tagName = "#text";
    this._text = String(text);
  }

  get textContent() {
    return this._text;
  }
}

class FakeDocument {
  createElement(tag) {
    return new FakeNode(tag);
  }

  createTextNode(text) {
    return new FakeTextNode(text);
  }
}

const doc = new FakeDocument();

// ----- el -----

test("el sets tag, class and text", () => {
  const node = el(doc, "button", "remove", "Remove");
  assert.equal(node.tagName, "BUTTON");
  assert.equal(node.className, "remove");
  assert.equal(node.textContent, "Remove");
});

test("el leaves class and text alone when not given", () => {
  const node = el(doc, "div");
  assert.equal(node.className, "");
  assert.equal(node.textContent, "");
});

test("el accepts empty string as text", () => {
  // undefined means "don't set"; "" is a real value a caller may want.
  assert.equal(el(doc, "span", null, "").textContent, "");
});

test("el puts markup-looking text in the text node, never as markup", () => {
  const hostile = '<img src=x onerror="alert(1)">';
  const node = el(doc, "span", null, hostile);
  assert.equal(node.textContent, hostile, "stored verbatim as text");
  assert.equal(node.children.length, 0, "and never parsed into child elements");
});

test("el names the offending value when the document is unusable", () => {
  assert.throws(() => el(null, "div"), /needs a document with createElement, got: object/);
  assert.throws(() => el({}, "div"), /needs a document with createElement/);
});

// ----- createRemovableRow -----

test("createRemovableRow builds a value span and a labelled remove button", () => {
  const { row, value, remove } = createRemovableRow(doc, "item dom", "remove");
  assert.equal(row.className, "item dom");
  assert.equal(value.className, "val");
  assert.equal(remove.tagName, "BUTTON");
  assert.equal(remove.textContent, "remove");
  assert.deepEqual(row.children, [value, remove], "value first, then the button");
});

test("createRemovableRow takes its label by parameter, not from chrome.i18n", () => {
  // The label is injected so the module stays pure and locale-agnostic.
  const { remove } = createRemovableRow(doc, "item", "entfernen");
  assert.equal(remove.textContent, "entfernen");
});

test("createRemovableRow leaves the value empty for the caller to fill", () => {
  const { value } = createRemovableRow(doc, "item", "remove");
  assert.equal(value.textContent, "", "callers set user text via textContent afterwards");
});
