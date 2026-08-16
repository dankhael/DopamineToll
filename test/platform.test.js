"use strict";

// shared/platform.js encodes two browser facts this extension depends on, both of
// which fail in the direction of "look normal" if the query goes wrong: Android
// needs a different popup layout, and a revoked host permission silently disables
// every content script. Each function must therefore have a defined answer even
// when the underlying API is missing or throws.

const test = require("node:test");
const assert = require("node:assert/strict");

const { isAndroid, hasOriginAccess, requestOriginAccess } = require("../shared/platform.js");

// ----- named fakes for the two chrome APIs involved -----

class FakeRuntime {
  constructor(os) {
    this.os = os;
  }

  async getPlatformInfo() {
    return { os: this.os, arch: "x86-64" };
  }
}

class ThrowingRuntime {
  async getPlatformInfo() {
    throw new Error("getPlatformInfo is not available in this context");
  }
}

class FakePermissions {
  constructor({ granted = [], grantOnRequest = true } = {}) {
    this.granted = new Set(granted);
    this.grantOnRequest = grantOnRequest;
    this.requests = [];
  }

  async contains({ origins }) {
    return origins.every((origin) => this.granted.has(origin));
  }

  async request({ origins }) {
    this.requests.push(origins);
    if (!this.grantOnRequest) return false;
    for (const origin of origins) this.granted.add(origin);
    return true;
  }
}

class ThrowingPermissions {
  async contains() {
    throw new Error("permissions.contains blew up");
  }

  async request() {
    throw new Error("permissions.request blew up");
  }
}

const ALL_URLS = ["<all_urls>"];

// ----- isAndroid -----

test("isAndroid is true only on android", async () => {
  assert.equal(await isAndroid(new FakeRuntime("android")), true);
  assert.equal(await isAndroid(new FakeRuntime("linux")), false);
  assert.equal(await isAndroid(new FakeRuntime("win")), false);
  assert.equal(await isAndroid(new FakeRuntime("mac")), false);
});

test("isAndroid falls back to the desktop layout when the API throws", async () => {
  // Guessing "android" on an unknown platform would break the desktop popup,
  // whose width is what makes it size correctly.
  assert.equal(await isAndroid(new ThrowingRuntime()), false);
});

// ----- hasOriginAccess -----

test("hasOriginAccess reports what the browser actually granted", async () => {
  assert.equal(await hasOriginAccess(new FakePermissions({ granted: ["<all_urls>"] }), ALL_URLS), true);
  assert.equal(await hasOriginAccess(new FakePermissions(), ALL_URLS), false);
});

test("hasOriginAccess assumes access when the API is missing or throws", async () => {
  // A false negative here shows the user a warning banner we cannot substantiate,
  // which is worse than staying quiet.
  assert.equal(await hasOriginAccess(undefined, ALL_URLS), true);
  assert.equal(await hasOriginAccess({}, ALL_URLS), true);
  assert.equal(await hasOriginAccess(new ThrowingPermissions(), ALL_URLS), true);
});

test("hasOriginAccess requires every requested origin", async () => {
  const permissions = new FakePermissions({ granted: ["https://a.example/*"] });
  assert.equal(await hasOriginAccess(permissions, ["https://a.example/*"]), true);
  assert.equal(await hasOriginAccess(permissions, ["https://a.example/*", "https://b.example/*"]), false);
});

// ----- requestOriginAccess -----

test("requestOriginAccess asks for exactly the origins given", async () => {
  const permissions = new FakePermissions();
  assert.equal(await requestOriginAccess(permissions, ALL_URLS), true);
  assert.deepEqual(permissions.requests, [ALL_URLS]);
  assert.equal(await permissions.contains({ origins: ALL_URLS }), true, "grant took effect");
});

test("requestOriginAccess reports false when the user dismisses the prompt", async () => {
  const permissions = new FakePermissions({ grantOnRequest: false });
  assert.equal(await requestOriginAccess(permissions, ALL_URLS), false);
});

test("requestOriginAccess reports false when the API is missing or throws", async () => {
  assert.equal(await requestOriginAccess(undefined, ALL_URLS), false);
  assert.equal(await requestOriginAccess({}, ALL_URLS), false);
  assert.equal(await requestOriginAccess(new ThrowingPermissions(), ALL_URLS), false);
});
