"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const LOCALES_DIR = path.join(ROOT, "_locales");
const REFERENCE_LOCALE = "en";
const TARGET_LOCALES = ["en", "pt_BR", "ja", "zh_CN", "fr", "de"];

function readCatalog(locale) {
  return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, locale, "messages.json"), "utf8"));
}

function localeNames() {
  return fs
    .readdirSync(LOCALES_DIR)
    .filter((name) => fs.statSync(path.join(LOCALES_DIR, name)).isDirectory());
}

// Named placeholders the message text references, e.g. "$TIME$" → "time".
function placeholderTokens(message) {
  return [...message.matchAll(/\$([A-Za-z0-9_]+)\$/g)].map((m) => m[1].toLowerCase());
}

const locales = localeNames();
const reference = readCatalog(REFERENCE_LOCALE);
const referenceKeys = Object.keys(reference).sort();

// ----- catalog shape, per locale -----

for (const locale of locales) {
  test(`${locale}: every entry has a non-empty string message`, () => {
    for (const [key, entry] of Object.entries(readCatalog(locale))) {
      assert.equal(typeof entry.message, "string", `${locale}/${key}.message must be a string`);
      assert.ok(entry.message.length > 0, `${locale}/${key}.message must not be empty`);
    }
  });

  test(`${locale}: declares a placeholder for every $TOKEN$ it uses`, () => {
    for (const [key, entry] of Object.entries(readCatalog(locale))) {
      const tokens = placeholderTokens(entry.message);
      if (tokens.length === 0) continue;
      const declared = Object.keys(entry.placeholders || {}).map((name) => name.toLowerCase());
      for (const token of tokens) {
        assert.ok(
          declared.includes(token),
          `${locale}/${key}: message uses $${token}$ but declares no matching placeholder`
        );
      }
    }
  });
}

// ----- key parity against the reference locale -----

for (const locale of locales.filter((name) => name !== REFERENCE_LOCALE)) {
  test(`${locale}: has exactly the same keys as ${REFERENCE_LOCALE}`, () => {
    const keys = Object.keys(readCatalog(locale)).sort();
    const missing = referenceKeys.filter((key) => !keys.includes(key));
    const extra = keys.filter((key) => !referenceKeys.includes(key));
    assert.deepEqual(missing, [], `${locale} is missing keys that ${REFERENCE_LOCALE} has`);
    assert.deepEqual(extra, [], `${locale} has keys ${REFERENCE_LOCALE} does not`);
  });
}

// ----- the requested locale set is actually shipped -----

test("all target locales are present", () => {
  for (const locale of TARGET_LOCALES) {
    assert.ok(locales.includes(locale), `missing locale folder: _locales/${locale}`);
  }
});

test("manifest default_locale resolves to a shipped locale folder", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  assert.ok(manifest.default_locale, "manifest.json is missing default_locale");
  assert.ok(
    locales.includes(manifest.default_locale),
    `default_locale '${manifest.default_locale}' has no _locales/${manifest.default_locale} folder`
  );
});

// ----- source ↔ catalog integrity: no dangling message keys -----

// shared/i18n.js is intentionally excluded: it is the generic helper (message
// keys reach it as variables, never literals) and its doc comment contains
// illustrative data-i18n="key" markup that would otherwise be scanned as a key.
const SOURCE_FILES = [
  "popup/popup.js",
  "options/options.js",
  "content/blocker.js",
  "content/friction.js",
  "background/service-worker.js",
  "shared/format.js",
  "popup/popup.html",
  "options/index.html"
];

// Matches chrome.i18n.getMessage("key" ...) and translator calls t("key" ...)
// (including DTI18n.t and the injected `t` in shared/format.js).
const JS_KEY = /(?:i18n\.getMessage|\bt)\(\s*"([^"]+)"/g;
const HTML_KEY = /data-i18n(?:-html|-placeholder|-label|-title)?="([^"]+)"/g;

function keysReferencedInSource() {
  const keys = new Set();
  for (const rel of SOURCE_FILES) {
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    for (const match of text.matchAll(JS_KEY)) keys.add(match[1]);
    for (const match of text.matchAll(HTML_KEY)) keys.add(match[1]);
  }
  return keys;
}

test("every message key referenced in source exists in the en catalog", () => {
  const referenced = [...keysReferencedInSource()];
  assert.ok(referenced.length > 0, "found no referenced keys — the scanner is probably broken");
  const missing = referenced.filter((key) => !(key in reference)).sort();
  assert.deepEqual(missing, [], `referenced in source but absent from _locales/en: ${missing.join(", ")}`);
});

test("every __MSG_*__ reference in the manifest exists in the en catalog", () => {
  const manifest = fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8");
  const refs = [...manifest.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)].map((m) => m[1]);
  assert.ok(refs.length >= 2, "expected at least appName and appDesc as __MSG__ references");
  const missing = refs.filter((key) => !(key in reference)).sort();
  assert.deepEqual(missing, [], `manifest references missing messages: ${missing.join(", ")}`);
});
