"use strict";

// The free-pass rules that are easy to state and easy to get wrong: the refill
// happens at local midnight and never accumulates, raising the allowance only
// lands the next day (ADR-0003's cooling-off would otherwise be a 30-second
// detour to the bypass it guards), and lowering it bites immediately.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DAILY_CAP,
  ledgerToPin,
  dayKey,
  clampAllowance,
  openLedger,
  currentLedger,
  passesLeft,
  spendPass
} = require("../shared/freepass.js");

const TODAY = "2026-08-20";
const YESTERDAY = "2026-08-19";

// ----- dayKey -----

test("dayKey formats the local calendar day, zero-padded", () => {
  assert.equal(dayKey(new Date(2026, 7, 20)), "2026-08-20");
  assert.equal(dayKey(new Date(2026, 0, 3)), "2026-01-03");
});

test("dayKey reads local time, not UTC — the refill is at the user's midnight", () => {
  // 23:30 local on the 20th is already the 21st in UTC for anyone east of London.
  const lateEvening = new Date(2026, 7, 20, 23, 30);
  assert.equal(dayKey(lateEvening), "2026-08-20");
});

// ----- allowance clamping -----

test("the allowance is capped at three a day and floored at zero", () => {
  assert.equal(DAILY_CAP, 3);
  assert.equal(clampAllowance(9), 3);
  assert.equal(clampAllowance(-2), 0);
  assert.equal(clampAllowance(2), 2);
});

test("a missing or nonsense allowance reads as zero, never as unlimited", () => {
  assert.equal(clampAllowance(undefined), 0);
  assert.equal(clampAllowance("3"), 0);
  assert.equal(clampAllowance(NaN), 0);
  assert.equal(clampAllowance(Infinity), 0, "an infinite allowance is nonsense, not three");
});

// ----- refill -----

test("a ledger from an earlier day is replaced, not carried over", () => {
  const stale = { date: YESTERDAY, allowance: 3, spent: 3 };
  assert.deepEqual(currentLedger(stale, TODAY, 3), { date: TODAY, allowance: 3, spent: 0 });
});

test("unspent passes do not accumulate across days", () => {
  const untouched = { date: YESTERDAY, allowance: 3, spent: 0 };
  const today = currentLedger(untouched, TODAY, 3);
  assert.equal(passesLeft(today, 3), 3, "three, not six");
});

test("today's ledger is kept as it stands", () => {
  const inProgress = { date: TODAY, allowance: 2, spent: 1 };
  assert.deepEqual(currentLedger(inProgress, TODAY, 2), inProgress);
});

test("a missing or corrupt stored ledger opens a fresh one", () => {
  for (const junk of [undefined, null, "", 7, []]) {
    const fresh = currentLedger(junk, TODAY, 1);
    assert.equal(fresh.date, TODAY);
    assert.equal(fresh.spent, 0);
  }
});

test("a ledger with a garbled spend count is read as unspent, not as a negative", () => {
  const garbled = { date: TODAY, allowance: 2, spent: -5 };
  assert.equal(currentLedger(garbled, TODAY, 2).spent, 0);
});

// ----- the ratchet, in both directions -----

test("raising the allowance does not grant passes until the next refill", () => {
  const opened = openLedger(TODAY, 1);
  assert.equal(passesLeft(opened, 3), 1, "the raise waits for midnight");
  assert.equal(passesLeft(currentLedger(opened, "2026-08-21", 3), 3), 3, "and lands then");
});

test("lowering the allowance takes effect immediately — tightening never waits", () => {
  const opened = openLedger(TODAY, 3);
  assert.equal(passesLeft(opened, 1), 1);
});

test("lowering below what is already spent leaves nothing, never a negative", () => {
  const spentTwo = { date: TODAY, allowance: 3, spent: 2 };
  assert.equal(passesLeft(spentTwo, 1), 0);
});

test("lowering the allowance to zero closes the door for the rest of the day", () => {
  assert.equal(passesLeft({ date: TODAY, allowance: 3, spent: 0 }, 0), 0);
});

// ----- pinning the day, so a raise cannot land on it -----

test("a day with no ledger yet gets one pinned at the allowance being replaced", () => {
  // The hole this closes: passesLeft() keeps a raise from landing today by comparing
  // against the ledger's snapshot, but the ledger is only written when a pass is
  // spent. Someone who has not reached for one yet today has no snapshot, so a fresh
  // ledger would open at the NEW number and hand the passes over immediately.
  const pinned = ledgerToPin(undefined, TODAY, 0);
  assert.deepEqual(pinned, { date: TODAY, allowance: 0, spent: 0 });
  assert.equal(passesLeft(pinned, 3), 0, "raising to three grants nothing today");
});

test("a ledger already covering today is left alone", () => {
  const existing = { date: TODAY, allowance: 1, spent: 1 };
  assert.equal(ledgerToPin(existing, TODAY, 1), null);
});

test("a ledger from an earlier day is repinned rather than reused", () => {
  const stale = { date: YESTERDAY, allowance: 3, spent: 3 };
  assert.deepEqual(ledgerToPin(stale, TODAY, 1), { date: TODAY, allowance: 1, spent: 0 });
});

test("the first raise after a fresh install grants nothing until tomorrow", () => {
  // Install at allowance 0, no ledger written yet, user raises to 1 at 2pm.
  const pinned = ledgerToPin(undefined, TODAY, 0);
  assert.equal(passesLeft(pinned, 1), 0, "not today");
  const tomorrow = currentLedger(pinned, "2026-08-21", 1);
  assert.equal(passesLeft(tomorrow, 1), 1, "but from the next refill");
});

// ----- spending -----

test("spending one pass leaves the rest of the day's balance intact", () => {
  const ledger = openLedger(TODAY, 3);
  const after = spendPass(ledger, 3);
  assert.equal(after.spent, 1);
  assert.equal(passesLeft(after, 3), 2);
  assert.equal(ledger.spent, 0, "and the ledger passed in is not mutated");
});

test("spending the last pass empties the balance", () => {
  let ledger = openLedger(TODAY, 1);
  ledger = spendPass(ledger, 1);
  assert.equal(passesLeft(ledger, 1), 0);
});

test("spending with nothing left throws, naming the ledger and the allowance", () => {
  const empty = { date: TODAY, allowance: 1, spent: 1 };
  assert.throws(
    () => spendPass(empty, 1),
    /no free pass left to spend: ledger \{"date":"2026-08-20","allowance":1,"spent":1\}, allowance 1/
  );
});

test("an allowance of zero — the default — hands out nothing", () => {
  const ledger = openLedger(TODAY, 0);
  assert.equal(passesLeft(ledger, 0), 0);
  assert.throws(() => spendPass(ledger, 0), /no free pass left/);
});
