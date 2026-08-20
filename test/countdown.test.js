"use strict";

// shared/countdown.js is the one clock behind the gate's toll and the settings
// page's cooling-off (ADR-0003). The rule it exists to guarantee: time only passes
// while the user is actually looking at the countdown — waiting it out in another
// tab is not waiting. These tests pin that, since neither surface can prove it.

const test = require("node:test");
const assert = require("node:assert/strict");

const { pageActivity, startFocusCountdown } = require("../shared/countdown.js");

// ----- named fakes -----

class FakeTimers {
  constructor() {
    this.handle = 0;
    this.pending = new Map();
  }

  get api() {
    return {
      setInterval: (fn) => {
        this.handle += 1;
        this.pending.set(this.handle, fn);
        return this.handle;
      },
      clearInterval: (id) => {
        this.pending.delete(id);
      }
    };
  }

  get running() {
    return this.pending.size;
  }

  // Fire every armed interval `times` times, as a second of wall clock would.
  advance(times = 1) {
    for (let i = 0; i < times; i += 1) {
      for (const fn of [...this.pending.values()]) fn();
    }
  }
}

class FakeActivity {
  constructor(active = true) {
    this.active = active;
    this.listeners = [];
  }

  get hooks() {
    return {
      isActive: () => this.active,
      watchActivity: (onChange) => {
        this.listeners.push(onChange);
        return () => {
          this.listeners = this.listeners.filter((fn) => fn !== onChange);
        };
      }
    };
  }

  // Flip visibility/focus the way a tab switch or Alt+Tab would.
  set(active) {
    this.active = active;
    for (const fn of [...this.listeners]) fn();
  }
}

// A countdown wired to fakes, with every callback recorded.
function startFake(seconds, { active = true } = {}) {
  const timers = new FakeTimers();
  const activity = new FakeActivity(active);
  const ticks = [];
  const paused = [];
  const resumed = [];
  let done = 0;

  const control = startFocusCountdown(seconds, {
    ...activity.hooks,
    timers: timers.api,
    onTick: (left) => ticks.push(left),
    onPause: (left) => paused.push(left),
    onResume: (left) => resumed.push(left),
    onDone: () => {
      done += 1;
    }
  });

  return { control, timers, activity, ticks, paused, resumed, doneCount: () => done };
}

// ----- counting down -----

test("counts down a second at a time and reports every value including zero", () => {
  const f = startFake(3);
  f.timers.advance(3);
  assert.deepEqual(f.ticks, [2, 1, 0]);
});

test("calls onDone exactly once, when the clock reaches zero", () => {
  const f = startFake(2);
  assert.equal(f.doneCount(), 0, "not before it has run out");
  f.timers.advance(2);
  assert.equal(f.doneCount(), 1);
  f.timers.advance(5);
  assert.equal(f.doneCount(), 1, "and never again, however long the page lives");
});

test("remaining() reports the seconds still owed", () => {
  const f = startFake(10);
  f.timers.advance(4);
  assert.equal(f.control.remaining(), 6);
});

test("clears its timer once finished", () => {
  const f = startFake(1);
  f.timers.advance(1);
  assert.equal(f.timers.running, 0);
});

// ----- the rule: time only passes while the user is looking -----

test("does not start ticking when the page is already in the background", () => {
  const f = startFake(30, { active: false });
  assert.equal(f.timers.running, 0, "no timer armed");
  f.timers.advance(10);
  assert.deepEqual(f.ticks, [], "and no time passes");
});

test("freezes when the tab is hidden and resumes from where it stopped", () => {
  const f = startFake(30);
  f.timers.advance(5); // 25 left
  f.activity.set(false);
  f.timers.advance(100); // a hundred seconds away from the tab
  assert.equal(f.control.remaining(), 25, "leaving the tab does not pay the toll");

  f.activity.set(true);
  f.timers.advance(5);
  assert.equal(f.control.remaining(), 20, "and it picks up exactly where it froze");
});

test("brackets each freeze with onPause and onResume carrying the remaining time", () => {
  const f = startFake(30);
  assert.deepEqual(f.resumed, [30], "resumes once on start, with the full duration");
  f.timers.advance(10);
  f.activity.set(false);
  assert.deepEqual(f.paused, [20], "a meter mid-drain needs to know where to stop");
  f.activity.set(true);
  assert.deepEqual(f.resumed, [30, 20], "and where to re-target from");
});

test("starts frozen in the background, then runs on the first look", () => {
  const f = startFake(30, { active: false });
  assert.deepEqual(f.paused, [30], "painted frozen at full, not left blank");
  f.activity.set(true);
  f.timers.advance(1);
  assert.equal(f.control.remaining(), 29);
});

test("repeated activity events do not stack up timers or double-tick", () => {
  const f = startFake(30);
  f.activity.set(true);
  f.activity.set(true);
  assert.equal(f.timers.running, 1, "one clock, however many focus events arrive");
  f.timers.advance(1);
  assert.equal(f.control.remaining(), 29);
});

// ----- stopping -----

test("stop() clears the timer and detaches the activity listeners", () => {
  const f = startFake(30);
  f.control.stop();
  assert.equal(f.timers.running, 0);
  assert.equal(f.activity.listeners.length, 0, "nothing left holding the page");
  f.timers.advance(60);
  assert.equal(f.doneCount(), 0, "a stopped countdown never completes");
});

test("stop() after completion is a no-op", () => {
  const f = startFake(1);
  f.timers.advance(1);
  f.control.stop();
  assert.equal(f.doneCount(), 1);
});

test("detaches its listeners on completion too, not only on stop()", () => {
  const f = startFake(1);
  f.timers.advance(1);
  assert.equal(f.activity.listeners.length, 0);
});

// ----- degenerate input -----

test("a zero-second countdown is already over and arms no timer", () => {
  const f = startFake(0);
  assert.equal(f.doneCount(), 1);
  assert.deepEqual(f.ticks, [0]);
  assert.equal(f.timers.running, 0);
});

test("a negative duration is treated as already over, never as an endless clock", () => {
  const f = startFake(-5);
  assert.equal(f.doneCount(), 1);
  assert.equal(f.control.remaining(), 0);
});

test("names the missing hook and what was passed instead", () => {
  const activity = new FakeActivity();
  assert.throws(
    () => startFocusCountdown(10, { ...activity.hooks }),
    /needs onDone to be a function, got: undefined/
  );
  assert.throws(
    () => startFocusCountdown(10, { onDone() {} }),
    /needs isActive to be a function, got: undefined/
  );
  assert.throws(() => startFocusCountdown(10), /needs isActive to be a function/);
});

// ----- pageActivity -----

class FakeEventTarget {
  constructor() {
    this.bound = {};
  }

  addEventListener(type, fn) {
    (this.bound[type] = this.bound[type] || []).push(fn);
  }

  removeEventListener(type, fn) {
    this.bound[type] = (this.bound[type] || []).filter((f) => f !== fn);
  }

  count(type) {
    return (this.bound[type] || []).length;
  }
}

class FakePageDocument extends FakeEventTarget {
  constructor(hidden, focused) {
    super();
    this.hidden = hidden;
    this.focused = focused;
  }

  hasFocus() {
    return this.focused;
  }
}

test("the page is active only when the tab is visible AND the window focused", () => {
  const win = new FakeEventTarget();
  assert.equal(pageActivity(new FakePageDocument(false, true), win).isActive(), true);
  assert.equal(
    pageActivity(new FakePageDocument(true, true), win).isActive(),
    false,
    "tab switched away"
  );
  assert.equal(
    pageActivity(new FakePageDocument(false, false), win).isActive(),
    false,
    "Alt+Tab blurs the window without hiding the tab"
  );
});

test("watchActivity listens on all three signals and unsubscribes cleanly", () => {
  const doc = new FakePageDocument(false, true);
  const win = new FakeEventTarget();
  const unwatch = pageActivity(doc, win).watchActivity(() => {});

  assert.equal(doc.count("visibilitychange"), 1);
  assert.equal(win.count("focus"), 1);
  assert.equal(win.count("blur"), 1);

  unwatch();
  assert.equal(doc.count("visibilitychange"), 0);
  assert.equal(win.count("focus"), 0);
  assert.equal(win.count("blur"), 0);
});
