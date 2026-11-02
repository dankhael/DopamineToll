"use strict";

// Every surface here is built from classic scripts sharing globals — there is no
// bundler and no import graph to catch a missing one. Referencing DTCountdown from
// a page that never loads shared/countdown.js throws at runtime, in the browser,
// only on the code path that touches it. These tests catch it at `npm test`
// instead, by matching what each file uses against what its page actually loads.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));

const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

// `root.DTDom = api` / `window.DTI18n = {...}` — the two shapes used in this repo.
function globalsProvided(source) {
  return [...source.matchAll(/(?:root|window|self)\.(DT[A-Za-z]+)\s*=/g)].map((m) => m[1]);
}

function globalsUsed(source) {
  return [...new Set([...source.matchAll(/\b(DT[A-Za-z]+)\./g)].map((m) => m[1]))];
}

// <script src="..."> in document order, resolved relative to the page.
function pageScripts(pageFile) {
  const dir = path.posix.dirname(pageFile);
  return [...read(pageFile).matchAll(/<script\s+src="([^"]+)"/g)].map((m) =>
    path.posix.normalize(path.posix.join(dir, m[1]))
  );
}

// Assert every DT* global a file uses was defined by a file loaded before it.
function assertResolvable(loadOrder, label) {
  const defined = new Set();
  for (const file of loadOrder) {
    const source = read(file);
    for (const used of globalsUsed(source)) {
      if (globalsProvided(source).includes(used)) continue;
      assert.ok(
        defined.has(used),
        `${label}: ${file} uses ${used}, but no script before it defines it`
      );
    }
    for (const provided of globalsProvided(source)) defined.add(provided);
  }
}

for (const page of ["popup/popup.html", "options/index.html"]) {
  test(`${page} loads every shared module its scripts use`, () => {
    const scripts = pageScripts(page);
    assert.ok(scripts.length > 0, `${page} declares no scripts`);
    assertResolvable(scripts, page);
  });

  test(`${page} references only script files that exist`, () => {
    for (const file of pageScripts(page)) {
      assert.ok(fs.existsSync(path.join(ROOT, file)), `${page} loads missing script: ${file}`);
    }
  });
}

test("content scripts are ordered so every shared global is defined before use", () => {
  // The manifest's js array is the load order for the content scripts; getting it
  // wrong breaks the gate on every page rather than in one place.
  for (const entry of manifest.content_scripts) {
    assertResolvable(entry.js, "content_scripts");
  }
});

test("the background sees every shared global it uses", () => {
  // The worker's globals arrive through importScripts on Chrome and through
  // background.scripts on Firefox; both lists are pinned in manifest.test.js.
  assertResolvable(manifest.background.scripts, "background.scripts");
});
