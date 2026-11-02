"use strict";

// Whether one more north star fits. An animated GIF is stored as it is, so a few
// of them can fill Chrome's 10 MB storage.local quota; past it, the save fails
// with a quota error the user cannot act on. These rules refuse first, with the
// numbers that tell the user what to do.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_ANIMATED_BYTES,
  BUDGET_BYTES,
  storedSize,
  refuseForRoom,
  refuseTooBig
} = require("../shared/photobudget.js");

// An entry whose stored JSON is exactly `size` characters long.
function entryOfSize(size) {
  const shell = JSON.stringify({ name: "", src: "" }).length;
  return { name: "", src: "x".repeat(size - shell) };
}

// ----- storedSize -----

test("storedSize counts each photo the way the quota does, as its JSON", () => {
  const photos = [entryOfSize(100), entryOfSize(250)];
  assert.equal(storedSize(photos), 350);
});

test("storedSize counts legacy bare-string photos too", () => {
  assert.equal(storedSize(["data:image/jpeg;base64,AAAA"]), JSON.stringify("data:image/jpeg;base64,AAAA").length);
});

test("storedSize of no photos is zero", () => {
  assert.equal(storedSize([]), 0);
});

test("storedSize names what it got when the list is missing", () => {
  assert.throws(() => storedSize(undefined), /goalImages array, got: undefined/);
});

// ----- refuseForRoom -----

test("a photo that fits beside the others is let through", () => {
  assert.equal(refuseForRoom([entryOfSize(1000)], entryOfSize(1000)), null);
});

test("a photo that lands exactly on the budget still fits", () => {
  const kept = [entryOfSize(BUDGET_BYTES - 500)];
  assert.equal(refuseForRoom(kept, entryOfSize(500)), null);
});

test("a photo one byte over the budget is refused, with what is used and the ceiling", () => {
  const kept = [entryOfSize(BUDGET_BYTES - 500)];
  assert.deepEqual(refuseForRoom(kept, entryOfSize(501)), {
    reason: "noRoom",
    used: BUDGET_BYTES - 500,
    max: BUDGET_BYTES
  });
});

test("the budget leaves headroom under Chrome's 10 MB storage.local quota", () => {
  // The tally and the free-pass ledger live in storage.local too.
  assert.ok(BUDGET_BYTES < 10 * 1024 * 1024);
});

// ----- refuseTooBig -----

test("an animated GIF at the limit is kept", () => {
  assert.equal(refuseTooBig(MAX_ANIMATED_BYTES), null);
});

test("an animated GIF over the limit is refused, with its size and the limit", () => {
  assert.deepEqual(refuseTooBig(MAX_ANIMATED_BYTES + 1), {
    reason: "tooBig",
    size: MAX_ANIMATED_BYTES + 1,
    max: MAX_ANIMATED_BYTES
  });
});

test("one GIF at the limit fits in an empty budget, base64 and all", () => {
  // Base64 spends four characters per three bytes; the budget has to absorb that.
  const stored = 4 * Math.ceil(MAX_ANIMATED_BYTES / 3) + 100;
  assert.equal(refuseForRoom([], entryOfSize(stored)), null);
});

test("refuseTooBig names a size that is not a byte count", () => {
  assert.throws(() => refuseTooBig(1.5), /byte count, got: 1.5/);
  assert.throws(() => refuseTooBig("2MB"), /byte count, got: "2MB"/);
});
