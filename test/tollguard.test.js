"use strict";

// The direction table from the design session, pinned. Two of these settings are
// inverted — a longer unlock window and a longer gap between friction reminders
// both make the toll weaker — and getting either backwards would leave a hole that
// no other test would notice.

const test = require("node:test");
const assert = require("node:assert/strict");

const { COOL_OFF_SECONDS, isWeakening } = require("../shared/tollguard.js");

test("the cooling-off is thirty seconds", () => {
  // Deliberately short: it prices an impulse, it does not pretend to be a lock.
  assert.equal(COOL_OFF_SECONDS, 30);
});

// ----- switches -----

test("switching the extension off weakens the toll; switching it on does not", () => {
  assert.equal(isWeakening("enabled", true, false), true);
  assert.equal(isWeakening("enabled", false, true), false);
});

test("switching friction reminders off weakens the toll", () => {
  assert.equal(isWeakening("frictionEnabled", true, false), true);
  assert.equal(isWeakening("frictionEnabled", false, true), false);
});

test("switching the cooling-off itself off has to pay the cooling-off", () => {
  // Otherwise the guard is one click from being removed, and guards nothing.
  assert.equal(isWeakening("coolOffEnabled", true, false), true);
  assert.equal(isWeakening("coolOffEnabled", false, true), false);
});

test("a switch that was never set counts as on, so turning it off still waits", () => {
  assert.equal(isWeakening("enabled", undefined, false), true);
});

// ----- the countdown: shorter is weaker -----

test("shortening the countdown weakens the toll, lengthening it does not", () => {
  assert.equal(isWeakening("lockDuration", 30, 10), true);
  assert.equal(isWeakening("lockDuration", 30, 60), false);
});

// ----- the inverted pair -----

test("a LONGER unlock window is weaker — more time loose on the site", () => {
  assert.equal(isWeakening("unlockDuration", 10, 20), true);
  assert.equal(isWeakening("unlockDuration", 20, 10), false, "tightening never waits");
});

test("a LONGER gap between friction reminders is weaker — fewer reminders", () => {
  assert.equal(isWeakening("frictionMinutes", 5, 30), true);
  assert.equal(isWeakening("frictionMinutes", 30, 5), false);
});

// ----- free passes -----

test("granting more free passes weakens the toll; granting fewer tightens it", () => {
  assert.equal(isWeakening("freePassAllowance", 1, 3), true);
  assert.equal(isWeakening("freePassAllowance", 3, 1), false);
});

// ----- lists -----

test("removing a site from the block list weakens the toll", () => {
  assert.equal(isWeakening("blockedDomains", ["x.com", "tiktok.com"], ["x.com"]), true);
});

test("adding a site tightens the toll and applies at once", () => {
  assert.equal(isWeakening("blockedDomains", ["x.com"], ["x.com", "tiktok.com"]), false);
});

test("emptying the block list entirely weakens the toll", () => {
  assert.equal(isWeakening("blockedDomains", ["x.com"], []), true);
});

// ----- what is deliberately not guarded -----

test("the user's own content is never held up", () => {
  // Phrases, photos and the theme are what the user wrote for themselves, not toll
  // parameters. Charging a wait to delete your own sentence is patronising.
  assert.equal(isWeakening("phrases", 3, 1), false);
  assert.equal(isWeakening("theme", "amber", "rose"), false);
  assert.equal(isWeakening("goalImages", 4, 2), false, "counted as numbers, still free");
});

test("an unchanged value is not a weakening change", () => {
  assert.equal(isWeakening("lockDuration", 30, 30), false);
  assert.equal(isWeakening("enabled", false, false), false);
  assert.equal(isWeakening("blockedDomains", ["x.com"], ["x.com"]), false);
});

test("names the offending key when it is missing", () => {
  assert.throws(() => isWeakening("", 1, 2), /needs a setting key, got: ""/);
  assert.throws(() => isWeakening(undefined, 1, 2), /needs a setting key, got: undefined/);
});
