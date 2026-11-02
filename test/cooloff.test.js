"use strict";

// The cooling-off lifecycle: arm, tick, cancel, complete — and the case that bit us
// in review, where one countdown finishing tears down the rows the others live on.
// This is the behaviour ADR-0003 promises, so it is tested rather than trusted.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PILL_CLASS,
  SLOT_CLASS,
  PENDING_CLASS,
  PAUSED_CLASS,
  LEFT_VAR,
  fuseLevel,
  createRunner
} = require("../shared/cooloff.js");

// ----- named fakes -----

class FakeClassList {
  constructor() {
    this.names = new Set();
  }

  add(...names) {
    names.forEach((name) => this.names.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.names.delete(name));
  }

  toggle(name, force) {
    if (force) this.names.add(name);
    else this.names.delete(name);
  }

  contains(name) {
    return this.names.has(name);
  }
}

class FakeStyle {
  constructor() {
    this.props = new Map();
  }

  setProperty(name, value) {
    this.props.set(name, value);
  }

  removeProperty(name) {
    this.props.delete(name);
  }

  getPropertyValue(name) {
    return this.props.get(name) || "";
  }
}

class FakeElement {
  constructor(tag = "div", doc = null) {
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = doc;
    this.className = "";
    this.classList = new FakeClassList();
    this.style = new FakeStyle();
    this.children = [];
    this.parent = null;
    this.dataset = {};
    this.listeners = {};
    this.rendered = true;
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

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  // Connected while it hangs off something; a host built by a test is its own root.
  get isConnected() {
    return this.parent !== null || this.children.length > 0;
  }

  getClientRects() {
    return this.rendered ? [{}] : [];
  }

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
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
  constructor() {
    this.activeElement = null;
  }

  createElement(tag) {
    return new FakeElement(tag, this);
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

// A clock with nothing to count: it reports the end before start() even returns,
// the way startFocusCountdown does for a zero-second wait.
class FakeFinishedCountdown {
  get start() {
    return (seconds, hooks) => {
      hooks.onTick(0);
      hooks.onDone();
      return { stop: () => {} };
    };
  }
}

function setup(clocks = new FakeCountdownFactory()) {
  const doc = new FakeDocument();
  const runner = createRunner({
    doc,
    seconds: 30,
    // Prefixed by the control's own word when it names one, like the real glue.
    label: (remaining, host) => `${host.dataset.verb ? host.dataset.verb + " " : ""}${remaining}s`,
    cancelText: "cancel",
    startCountdown: clocks.start
  });
  const host = () => new FakeElement("div", doc);
  return { runner, clocks, doc, host };
}

const pillOf = (host) => host.querySelector("." + PILL_CLASS);
const secondsOn = (host) => pillOf(host).querySelector(".cooloff-secs").textContent;
const cancelOf = (host) => pillOf(host).querySelector(".cooloff-cancel");
const fuseOn = (host) => host.style.getPropertyValue(LEFT_VAR);

// ----- the fuse -----

test("fuseLevel aims a running fuse one second ahead, so a 1s transition lands on the tick", () => {
  assert.equal(fuseLevel(30, 30, true), 29 / 30);
  assert.equal(fuseLevel(1, 30, true), 0, "and empties exactly as the wait ends");
});

test("fuseLevel shows a frozen fuse at exactly what is owed", () => {
  assert.equal(fuseLevel(12, 30, false), 12 / 30);
});

test("fuseLevel never draws past full or below empty", () => {
  assert.equal(fuseLevel(0, 30, true), 0);
  assert.equal(fuseLevel(45, 30, false), 1);
});

test("fuseLevel names a wait with no length instead of dividing by it", () => {
  assert.throws(() => fuseLevel(5, 0, true), /seconds above zero, got: 0/);
});

// ----- arming -----

test("starting a cooling-off puts the time owed and a cancel button inside the control", () => {
  const { runner, host } = setup();
  const row = host();
  runner.start(row, () => {});
  assert.ok(pillOf(row), "nothing was added");
  assert.equal(secondsOn(row), "30s");
  assert.equal(cancelOf(row).tagName, "BUTTON");
  assert.equal(cancelOf(row).textContent, "cancel");
});

test("the status reads the control it belongs to, so each can say what will happen", () => {
  const { runner, clocks, host } = setup();
  const row = host();
  row.dataset.verb = "removed in";
  runner.start(row, () => {});
  assert.equal(secondsOn(row), "removed in 30s");
  clocks.last.hooks.onTick(7);
  assert.equal(secondsOn(row), "removed in 7s");
});

test("the status lands in the control's slot when it has one, while the control is marked", () => {
  // A switch's card holds the switch on its own line; the status belongs on that
  // line, but the edge and the fuse belong to the whole card.
  const { runner, doc, host } = setup();
  const card = host();
  const line = card.appendChild(new FakeElement("div", doc));
  line.className = SLOT_CLASS;
  runner.start(card, () => {});
  assert.ok(pillOf(line), "the status is on the slot's line");
  assert.equal(pillOf(card), null, "and not tacked on below it");
  assert.equal(card.classList.contains(PENDING_CLASS), true);
});

test("the control itself is marked pending, with a full fuse, the moment it is armed", () => {
  const { runner, host } = setup();
  const row = host();
  runner.start(row, () => {});
  assert.equal(row.classList.contains(PENDING_CLASS), true);
  assert.equal(fuseOn(row), "1");
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

test("each tick relabels the pill and burns the fuse down", () => {
  const { runner, clocks, host } = setup();
  const row = host();
  runner.start(row, () => {});
  clocks.last.hooks.onTick(12);
  assert.equal(secondsOn(row), "12s");
  assert.equal(fuseOn(row), String(11 / 30));
});

test("a frozen countdown marks the control paused and holds the fuse at what is owed", () => {
  const { runner, clocks, host } = setup();
  const row = host();
  runner.start(row, () => {});
  clocks.last.hooks.onPause(20);
  assert.equal(row.classList.contains(PAUSED_CLASS), true);
  assert.equal(fuseOn(row), String(20 / 30));
});

test("resuming clears the paused mark and starts the fuse burning again", () => {
  const { runner, clocks, host } = setup();
  const row = host();
  runner.start(row, () => {});
  clocks.last.hooks.onPause(20);
  clocks.last.hooks.onResume(20);
  assert.equal(row.classList.contains(PAUSED_CLASS), false);
  assert.equal(fuseOn(row), String(19 / 30));
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
  assert.equal(row.classList.contains(PENDING_CLASS), false);
  assert.equal(fuseOn(row), "");
  assert.equal(runner.isPending(row), false);
});

test("a wait that finishes before start() returns applies once and leaves nothing pending", () => {
  // Regression: the wait used to be registered after the clock started, so a clock
  // that finished synchronously left a dead entry and the control refused every
  // later change.
  const { runner, host } = setup(new FakeFinishedCountdown());
  const row = host();
  let applied = 0;
  runner.start(row, () => {
    applied += 1;
  });
  assert.equal(applied, 1);
  assert.equal(runner.isPending(row), false);
  assert.equal(row.classList.contains(PENDING_CLASS), false);
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

test("clicking cancel stops the countdown and abandons the change", () => {
  const { runner, clocks, host } = setup();
  const row = host();
  let applied = 0;
  runner.start(row, () => {
    applied += 1;
  });
  cancelOf(row).click();
  assert.equal(clocks.last.stopped, true);
  assert.equal(pillOf(row), null);
  assert.equal(row.classList.contains(PENDING_CLASS), false, "the control is itself again");
  assert.equal(applied, 0, "a cancelled wait never commits");
});

test("cancelling a frozen wait clears the paused mark too", () => {
  const { runner, clocks, host } = setup();
  const row = host();
  runner.start(row, () => {});
  clocks.last.hooks.onPause(20);
  runner.stopAt(row);
  assert.equal(row.classList.contains(PAUSED_CLASS), false);
});

// ----- keyboard focus -----

function armFromKeyboard({ hideTrigger }) {
  const { runner, doc, host } = setup();
  const row = host();
  const trigger = row.appendChild(new FakeElement("button", doc));
  trigger.focus();
  // What the page's CSS does on arming: hide a remove button, keep a switch.
  trigger.rendered = !hideTrigger;
  runner.start(row, () => {});
  return { runner, doc, row, trigger };
}

test("focus moves onto cancel when the control that armed it is hidden", () => {
  const { doc, row } = armFromKeyboard({ hideTrigger: true });
  assert.equal(doc.activeElement, cancelOf(row), "Enter now cancels instead of landing nowhere");
});

test("focus stays on a control that is still showing, like a switch", () => {
  const { doc, trigger } = armFromKeyboard({ hideTrigger: false });
  assert.equal(doc.activeElement, trigger);
});

test("cancelling from the keyboard hands focus back to the control that armed it", () => {
  const { runner, doc, row, trigger } = armFromKeyboard({ hideTrigger: true });
  trigger.rendered = true;
  runner.stopAt(row);
  assert.equal(doc.activeElement, trigger);
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
  const complete = {
    doc: new FakeDocument(),
    seconds: 30,
    label: () => "",
    cancelText: "cancel",
    startCountdown: () => {}
  };
  const without = (name) => ({ ...complete, [name]: undefined });
  assert.throws(() => createRunner(without("doc")), /needs a document/);
  assert.throws(() => createRunner(without("label")), /needs a label function/);
  assert.throws(() => createRunner(without("cancelText")), /needs a cancelText string/);
  assert.throws(() => createRunner(without("startCountdown")), /needs a startCountdown function/);
});
