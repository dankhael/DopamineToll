"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { fmtClock, fmtElapsed, escapeHTML } = require("../shared/format.js");

// A named fake translator standing in for DTI18n.t — records the call and
// renders "key:sub1,sub2" so tests can assert both the chosen message key and
// the substitutions without pulling in chrome.i18n.
class FakeTranslator {
  constructor() {
    this.calls = [];
  }
  translate = (key, subs = []) => {
    this.calls.push({ key, subs });
    return `${key}:${subs.join(",")}`;
  };
}

test("fmtClock formats seconds as zero-padded MM:SS", () => {
  assert.equal(fmtClock(0), "00:00");
  assert.equal(fmtClock(5), "00:05");
  assert.equal(fmtClock(65), "01:05");
  assert.equal(fmtClock(75), "01:15");
  assert.equal(fmtClock(3599), "59:59");
  assert.equal(fmtClock(3600), "60:00");
});

test("fmtClock clamps negatives to zero and floors fractional seconds", () => {
  assert.equal(fmtClock(-5), "00:00");
  assert.equal(fmtClock(9.9), "00:09");
});

test("fmtElapsed uses the minutes message under an hour", () => {
  const fake = new FakeTranslator();
  assert.equal(fmtElapsed(0, fake.translate), "frictionElapsedMin:0");
  assert.equal(fmtElapsed(7 * 60, fake.translate), "frictionElapsedMin:7");
  assert.equal(fmtElapsed(59 * 60 + 59, fake.translate), "frictionElapsedMin:59");
  assert.deepEqual(fake.calls.at(-1), { key: "frictionElapsedMin", subs: ["59"] });
});

test("fmtElapsed switches to the hours message at 60 minutes with zero-padded remainder", () => {
  const fake = new FakeTranslator();
  assert.equal(fmtElapsed(60 * 60, fake.translate), "frictionElapsedHour:1,00");
  assert.equal(fmtElapsed(65 * 60, fake.translate), "frictionElapsedHour:1,05");
  assert.equal(fmtElapsed(125 * 60, fake.translate), "frictionElapsedHour:2,05");
  assert.deepEqual(fake.calls.at(-1), { key: "frictionElapsedHour", subs: ["2", "05"] });
});

test("fmtElapsed rejects a missing translator with a descriptive error", () => {
  assert.throws(() => fmtElapsed(60, undefined), /translator function/);
});

test("escapeHTML escapes the five HTML-significant characters", () => {
  assert.equal(escapeHTML(`<b>a&b "c" 'd'</b>`), "&lt;b&gt;a&amp;b &quot;c&quot; &#39;d&#39;&lt;/b&gt;");
});

test("escapeHTML leaves safe text untouched and coerces non-strings", () => {
  assert.equal(escapeHTML("plain text 123"), "plain text 123");
  assert.equal(escapeHTML(42), "42");
});
