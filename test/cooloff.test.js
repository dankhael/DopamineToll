"use strict";

// The cooling-off lifecycle: arm, tick, cancel, complete — and the case that bit us
// in review, where one countdown finishing tears down the rows the others live on.
// This is the behaviour ADR-0003 promises, so it is tested rather than trusted.

const test = require("node:test");
const assert = require("node:assert/strict");

const { PILL_CLASS, createRunner } = require("../shared/cooloff.js");

// ----- named fakes -----

class FakeElement {
  constructor(tag = "div") {
    this.tagName = String(tag).toUpperCase();
    this.className = "";
    this.children = [];
    this.parent = null;
    this.dataset = {};
    this.listeners = {};
    this._text = "";
  }

  get textContent() {
    return this._text;
  }

  set textContent(value) {
    this._text = String(value);
  }

  appendChild(node) {
    node.parent = this;
    this.children.push(node);
    return node;
  }

  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }

  contains(node) {
    if (node === this) return true;
    return this.children.some((child) => child.contains(node));
  }

  querySelector(selector) {
    const wanted = selector.replace(".", "");
    return this.children.find((c) => c.className === wanted) || null;
  }

  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }

  click() {
    for (const fn of this.listeners.click || []) fn();
  }
}

class FakeDocument {
  createElement(tag) {
    return new FakeElement(tag);
  }
}

// Hands back the hooks so a test can drive the clock by hand.
class FakeCountdownFactory {
  constructor() {
    this.started = [];
  }

  get start() {
    return (seconds, hooks) => {
      const record = { seconds, hooks, stopped: false };
      this.started.push(record);
      return {
        stop: () => {
          record.stopped = true;
        }
      };
    };
  }

  get last() {
    return this.started[this.started.length - 1];
  }
}

function setup() {
  const clocks = new FakeCountdownFactory();
  const applied = [];
  const runner = createRunner({
    doc: new FakeDocument(),
    seconds: 30,
    label: (remaining) => `${remaining}s · cancel`,
    startCountdown: clocks.start
  });
  const host = () => new FakeElement();
  return { runner, clocks, applied, host };
}

const pillOf = (host) => host.querySelector("." + PILL_CLASS);

// ----- arming -----

test("starting a cooling-off puts a labelled pill inside the control", () => {
  const { runner, host } = setup();
  const row = host();
  runner.start(row, () => {});
  const pill = pillOf(row);
  assert.ok(pill, "no pill was added");
  assert.equal(pill.tagName, "BUTTON");
  assert.equal(pill.textContent, "30s · cancel");
});

test("the change does not apply when the countdown is merely armed", () => {
  const { runner, host } = setup();
  let applied = 0;
  runner.start(host(), () => {
    applied += 1;
  });
  assert.equal(applied, 0, "arming is not committing");
});

test("the countdown is asked for the configured number of seconds", () => {
  const { runner, clocks, host } = setup();
  runner.start(host(), () => {});
  assert.equal(clocks.last.seconds, 30);
});

test("a second click on the same control does not stack a second countdown", () => {
  const { runner, clocks, host } = setup();
  const row = host();
  runner.start(row, () => {});
  runner.start(row, () => {});
  assert.equal(clocks.started.length, 1);
  assert.equal(row.children.length, 1);
});

// ----- ticking and completing -----

test("each tick relabels the pill with the time still owed", () => {
  const { runner, clocks, host } = setup();
  const row = host();
  runner.start(row, () => {});
  clocks.last.hooks.onTick(12);
  assert.equal(pillOf(row).textContent, "12s · cancel");
});

test("reaching zero applies the change and clears the pill away", () => {
  const { runner, clocks, host } = setup();
  const row = host();
  let applied = 0;
  runner.start(row, () => {
    applied += 1;
  });
  clocks.last.hooks.onDone();
  assert.equal(applied, 1, "the change lands");
  assert.equal(pillOf(row), null, "and the countdown leaves nothing behind");
  assert.equal(runner.isPending(row), false);
});

test("a control whose countdown completed can be armed again", () => {
  const { runner, clocks, host } = setup();
  const row = host();
  runner.start(row, () => {});
  clocks.last.hooks.onDone();
  runner.start(row, () => {});
  assert.equal(clocks.started.length, 2, "the next weakening change pays its own wait");
});

// ----- cancelling -----

test("clicking the pill stops the countdown and abandons the change", () => {
  const { runner, clocks, host } = setup();
  const row = host();
  let applied = 0;
  runner.start(row, () => {
    applied += 1;
  });
  pillOf(row).click();
  assert.equal(clocks.last.stopped, true);
  assert.equal(pillOf(row), null);
  assert.equal(applied, 0, "a cancelled wait never commits");
});

test("stopAt on a control with nothing running is a no-op", () => {
  const { runner, host } = setup();
  runner.stopAt(host());
});

// ----- independence, and the re-render case -----

test("countdowns on different controls are independent", () => {
  // ADR-0003: each weakening change pays its own wait. Finishing one must not
  // disturb another that is still counting.
  const { runner, clocks, host } = setup();
  const first = host();
  const second = host();
  let secondApplied = 0;
  runner.start(first, () => {});
  runner.start(second, () => {
    secondApplied += 1;
  });

  clocks.started[0].hooks.onDone();
  assert.equal(runner.isPending(second), true, "the other wait keeps running");
  assert.equal(clocks.started[1].stopped, false);
  assert.equal(secondApplied, 0);

  clocks.started[1].hooks.onDone();
  assert.equal(secondApplied, 1, "and lands on its own schedule");
});

test("cancelWithin stops only the countdowns inside the container given", () => {
  const { runner, clocks, host } = setup();
  const list = host();
  const insideRow = list.appendChild(new FakeElement());
  const elsewhere = host();
  runner.start(insideRow, () => {});
  runner.start(elsewhere, () => {});

  runner.cancelWithin(list);
  assert.equal(clocks.started[0].stopped, true, "the row inside the list was cancelled");
  assert.equal(clocks.started[1].stopped, false, "the control outside it was not");
  assert.equal(runner.isPending(elsewhere), true);
});

test("cancelWithin fails safe — a cancelled wait never applies its change", () => {
  const { runner, host } = setup();
  const list = host();
  const row = list.appendChild(new FakeElement());
  let applied = 0;
  runner.start(row, () => {
    applied += 1;
  });
  runner.cancelWithin(list);
  assert.equal(applied, 0, "the toll stays as it is");
});

// ----- wiring mistakes -----

test("names the missing dependency rather than failing later at the first click", () => {
  assert.throws(() => createRunner({ seconds: 30, label: () => "", startCountdown: () => {} }),
    /needs a document/);
  assert.throws(() => createRunner({ doc: new FakeDocument(), seconds: 30, startCountdown: () => {} }),
    /needs a label function/);
  assert.throws(() => createRunner({ doc: new FakeDocument(), seconds: 30, label: () => "" }),
    /needs a startCountdown function/);
});
