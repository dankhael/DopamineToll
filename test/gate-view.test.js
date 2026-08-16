"use strict";

// The gate overlay is the product's whole surface, and it is assembled from the
// user's own domain, phrase and photo. These tests assert the structure the CSS
// and blocker.js both depend on (class names, node order, the disabled button)
// and that no user value ever becomes markup.

const test = require("node:test");
const assert = require("node:assert/strict");

const view = require("../content/gate-view.js");

// ----- named fake: the slice of the DOM these builders touch -----

class FakeNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.className = "";
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.innerHTML = "";
    this._text = "";
    this.disabled = false;
  }

  get textContent() {
    return this._text;
  }

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

  // Depth-first lookup by class name, mirroring querySelector closely enough.
  find(className) {
    for (const child of this.children) {
      if (child.className === className) return child;
      const deeper = child.find && child.find(className);
      if (deeper) return deeper;
    }
    return null;
  }
}

class FakeDocument {
  createElement(tag) {
    return new FakeNode(tag);
  }

  createTextNode(text) {
    const node = new FakeNode("#text");
    node.textContent = text;
    return node;
  }
}

const doc = new FakeDocument();

const COPY = {
  onList: "on your toll list",
  northStarAlt: "your north star",
  youToYourself: "— you, to yourself",
  chooseIn: "choose in",
  closeTab: "Close the tab",
  beProductive: "be productive",
  openAnyway: "Open anyway for 10 min",
  unlocksIn: "unlocks in 30s"
};

function gate(overrides = {}) {
  return view.buildGate(doc, {
    domain: "x.com",
    phrase: "focus. discipline. results.",
    imgSrc: null,
    clockText: "00:30",
    copy: COPY,
    ...overrides
  });
}

// ----- individual builders -----

test("buildEyebrow puts the domain in bold before the label", () => {
  const eyebrow = view.buildEyebrow(doc, "instagram.com", COPY.onList);
  assert.equal(eyebrow.className, "dt-eyebrow");
  const [bold, dot, label] = eyebrow.children;
  assert.equal(bold.tagName, "B");
  assert.equal(bold.textContent, "instagram.com");
  assert.equal(dot.className, "dt-dotsep");
  assert.equal(label.textContent, COPY.onList);
});

test("buildEyebrow keeps a markup-shaped domain as text", () => {
  const eyebrow = view.buildEyebrow(doc, '<script>alert(1)</script>', COPY.onList);
  const bold = eyebrow.children[0];
  assert.equal(bold.textContent, '<script>alert(1)</script>');
  assert.equal(bold.children.length, 0);
});

test("buildPhoto renders the north star when there is one", () => {
  const photo = view.buildPhoto(doc, "data:image/png;base64,AAA", COPY.northStarAlt);
  const img = photo.children[0];
  assert.equal(img.tagName, "IMG");
  assert.equal(img.className, "dt-photo-img");
  assert.equal(img.src, "data:image/png;base64,AAA");
  assert.equal(img.alt, COPY.northStarAlt);
  assert.equal(photo.children[1].className, "dt-tint", "tint always sits on top");
});

test("buildPhoto falls back to stripes with no photo uploaded", () => {
  const photo = view.buildPhoto(doc, null, COPY.northStarAlt);
  assert.equal(photo.children[0].className, "dt-stripes");
  assert.equal(photo.children.length, 2);
});

test("buildPhrase keeps the user's phrase as text and appends the attribution", () => {
  const node = view.buildPhrase(doc, "<b>not bold</b>", COPY.youToYourself);
  assert.equal(node.className, "dt-phrase");
  // textContent assignment wipes children, so the attribution must come after.
  assert.equal(node.children[0].className, "dt-you");
  assert.equal(node.children[0].textContent, COPY.youToYourself);
});

test("buildTollMeter shows the clock and an empty meter bar", () => {
  const toll = view.buildTollMeter(doc, "00:45", COPY.chooseIn);
  assert.equal(toll.children[0].textContent, COPY.chooseIn);
  assert.equal(toll.children[1].className, "dt-clock");
  assert.equal(toll.children[1].textContent, "00:45");
  const meter = toll.children[2];
  assert.equal(meter.className, "dt-meter");
  assert.equal(meter.children[0].tagName, "I", "blocker.js animates '.dt-meter > i'");
});

test("buildActions starts the pay button disabled and tags both with actions", () => {
  const actions = view.buildActions(doc, COPY);
  const [walkAway, pay] = actions.children;
  assert.equal(walkAway.dataset.dtAction, "productive");
  assert.equal(walkAway.disabled, false, "walking away is always available");
  assert.equal(pay.dataset.dtAction, "lazy");
  assert.equal(pay.disabled, true, "paying unlocks only when the countdown ends");
  assert.ok(pay.className.includes("dt-locked"));
});

test("buildActions nests the sub-label that the countdown rewrites each tick", () => {
  const [walkAway, pay] = view.buildActions(doc, COPY).children;
  assert.equal(walkAway.children[0].tagName, "SMALL");
  assert.equal(pay.children[0].tagName, "SMALL");
  assert.equal(pay.children[0].textContent, COPY.unlocksIn);
});

// ----- buildGate: the assembled overlay -----

test("buildGate nests backdrop > stage > col", () => {
  const backdrop = gate();
  assert.equal(backdrop.className, "dt-backdrop");
  const stage = backdrop.children[0];
  assert.equal(stage.className, "dt-stage");
  assert.equal(stage.children[0].className, "dt-col");
});

test("buildGate marks the column as a modal dialog", () => {
  const column = gate().children[0].children[0];
  assert.equal(column.attributes.role, "dialog");
  assert.equal(column.attributes["aria-modal"], "true");
});

test("buildGate lays the five sections out in reading order", () => {
  const column = gate().children[0].children[0];
  assert.deepEqual(
    column.children.map((child) => child.className),
    ["dt-eyebrow", "dt-photo", "dt-phrase", "dt-toll", "dt-actions"]
  );
});

test("buildGate exposes every hook blocker.js queries for", () => {
  // These selectors are the contract between this module and blocker.js; renaming
  // one silently breaks the countdown rather than throwing.
  const backdrop = gate();
  for (const selector of ["dt-clock", "dt-label", "dt-meter", "dt-phrase", "dt-photo"]) {
    assert.ok(backdrop.find(selector), `missing .${selector}`);
  }
  const actions = backdrop.find("dt-actions");
  assert.equal(actions.children.filter((c) => c.dataset.dtAction).length, 2);
});

test("buildGate never writes innerHTML anywhere in the tree", () => {
  const walk = (node) => {
    assert.equal(node.innerHTML ?? "", "", `${node.className || node.tagName} used innerHTML`);
    for (const child of node.children ?? []) walk(child);
  };
  walk(gate({ domain: "<b>x</b>", phrase: "<i>y</i>", imgSrc: "javascript:alert(1)" }));
});

// ----- buildWarningCard -----

test("buildWarningCard orders eyebrow, phrase, time and close", () => {
  const { card } = view.buildWarningCard(doc, "focus", "<b>7 min</b> here", {
    eyebrow: "dopamine toll",
    dismissAria: "dismiss"
  });
  assert.equal(card.className, "dtf-card");
  assert.deepEqual(
    card.children.map((child) => child.className),
    ["dtf-eyebrow", "dtf-phrase", "dtf-time", "dtf-close"]
  );
});

test("buildWarningCard keeps the phrase as text but renders the time as markup", () => {
  // The time string is the one deliberate innerHTML left in the content scripts:
  // catalogs carry a <b> wrapper so ja/de/zh word order survives translation.
  const { card } = view.buildWarningCard(doc, "<b>phrase</b>", "<b>7 min</b> here", {
    eyebrow: "e",
    dismissAria: "d"
  });
  assert.equal(card.children[1].textContent, "<b>phrase</b>", "user phrase stays text");
  assert.equal(card.children[2].innerHTML, "<b>7 min</b> here", "our own catalog copy is markup");
});

test("buildWarningCard returns the close button with its aria label", () => {
  const { close } = view.buildWarningCard(doc, "p", "t", { eyebrow: "e", dismissAria: "dispensar" });
  assert.equal(close.className, "dtf-close");
  assert.equal(close.textContent, "✕");
  assert.equal(close.attributes["aria-label"], "dispensar");
});
