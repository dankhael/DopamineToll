"use strict";

// Invariants for the single cross-browser manifest (docs/adr/0001). These exist
// because the failure mode is silent: a manifest that drops one of the two
// background keys still loads fine in the browser you happen to be testing, and
// only breaks in the store you are not looking at.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const buildManifest = JSON.parse(fs.readFileSync(path.join(ROOT, "build-manifest.json"), "utf8"));

// ----- background: both browsers, one manifest -----

test("declares a background entry point for both Chrome and Firefox", () => {
  assert.equal(
    typeof manifest.background.service_worker,
    "string",
    "Chrome MV3 requires background.service_worker"
  );
  assert.deepEqual(
    manifest.background.scripts,
    [manifest.background.service_worker],
    "Firefox reads background.scripts and must point at the same file as service_worker"
  );
});

test("background is not an ES module", () => {
  // Nothing in the codebase imports or exports; declaring type:module would
  // reopen the question of ES-module event pages in Firefox for no benefit.
  assert.equal(manifest.background.type, undefined);
});

test("minimum_chrome_version is at least 121", () => {
  // Chrome refused to load a manifest carrying background.scripts before 121.
  const min = Number(manifest.minimum_chrome_version);
  assert.ok(min >= 121, `minimum_chrome_version must be >= 121, got ${manifest.minimum_chrome_version}`);
});

// ----- Firefox / AMO required keys -----

test("gecko id is present and email-shaped", () => {
  const id = manifest.browser_specific_settings.gecko.id;
  assert.match(id, /^[^@\s]+@[^@\s]+\.[^@\s]+$/, `gecko.id must look like an email, got '${id}'`);
});

test("declares data collection, required by AMO for new extensions", () => {
  const declared = manifest.browser_specific_settings.gecko.data_collection_permissions;
  assert.deepEqual(
    declared.required,
    ["none"],
    "PRIVACY.md states the extension collects nothing; the manifest must say the same"
  );
});

test("strict_min_version supports every manifest key in use", () => {
  // data_collection_permissions landed in Firefox 140 (desktop) and 142 (Android).
  const { gecko, gecko_android: geckoAndroid } = manifest.browser_specific_settings;
  assert.ok(
    parseFloat(gecko.strict_min_version) >= 140,
    `gecko.strict_min_version must be >= 140 for data_collection_permissions, got ${gecko.strict_min_version}`
  );
  assert.ok(
    parseFloat(geckoAndroid.strict_min_version) >= 142,
    `gecko_android.strict_min_version must be >= 142, got ${geckoAndroid.strict_min_version}`
  );
});

test("options page uses the key both browsers support", () => {
  // Only Chrome supports options_page; both support options_ui.
  assert.equal(manifest.options_page, undefined, "options_page is Chrome-only — use options_ui");
  assert.equal(typeof manifest.options_ui.page, "string");
});

// ----- packaging -----

test("every path the packagers ship actually exists", () => {
  for (const entry of buildManifest.include) {
    assert.ok(
      fs.existsSync(path.join(ROOT, entry)),
      `build-manifest.json lists '${entry}', but it is missing from the repo`
    );
  }
});

test("every file the manifest references is inside a shipped path", () => {
  const referenced = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_ui.page,
    ...manifest.content_scripts.flatMap((script) => [...script.js, ...script.css]),
    ...Object.values(manifest.icons)
  ];
  for (const file of referenced) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `manifest references missing file: ${file}`);
    const top = file.split("/")[0];
    assert.ok(
      buildManifest.include.includes(top),
      `manifest references '${file}', but '${top}' is not in build-manifest.json — it would not ship`
    );
  }
});
