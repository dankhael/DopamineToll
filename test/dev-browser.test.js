"use strict";

// scripts/dev-browser.mjs drives a real browser, so its logic is tested here
// against named fakes for the three things it talks to: PATH, the browser process
// and the DevTools endpoint. Two failures matter most, and both fail quietly: a
// wrong extension ID opens pages for an extension that does not exist, and a
// profile left on disk defeats the point of a throwaway one.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const dev = require("../scripts/dev-browser.mjs");

// Pinned against a real browser: Helium 0.20.3.1 (Chromium 156) loaded this repo
// from this path and listed its service worker under this ID.
const KNOWN_PATH = "/home/dankhael/Gitcodes/extensions/DopamineToll";
const KNOWN_ID = "ljnbbannggcalolajmjjjoifgodfdklj";

// A macrotask, not a resolved promise: the browser's "exit" in these fakes is
// scheduled with setImmediate, and a microtask-only loop would never see it.
const nextTurn = () => new Promise((done) => setImmediate(done));

// ----- named fakes -----

class FakePathLookup {
  constructor(executables) {
    this.executables = new Set(executables);
    this.isExecutable = (candidate) => this.executables.has(candidate);
  }
}

class ScratchDir {
  constructor() {
    this.root = fs.mkdtempSync(path.join(os.tmpdir(), "dt-dev-test-"));
  }

  path(...parts) {
    return path.join(this.root, ...parts);
  }

  cleanup() {
    fs.rmSync(this.root, { recursive: true, force: true });
  }
}

class FakeBrowserProcess extends EventEmitter {
  close(code) {
    this.emit("exit", code);
  }
}

function profileDirFrom(args) {
  return args.find((arg) => arg.startsWith("--user-data-dir=")).slice("--user-data-dir=".length);
}

// Plays the browser's part on launch: writes DevToolsActivePort into the profile it
// was pointed at, as Chromium does once its DevTools server is listening.
class FakeLauncher {
  constructor({ port = 9222, writesPort = true, closesAtOnce = false } = {}) {
    Object.assign(this, { port, writesPort, closesAtOnce, calls: [] });
    this.process = new FakeBrowserProcess();
    this.launch = (browser, args, verbose) => this.record(browser, args, verbose);
  }

  record(browser, args, verbose) {
    this.calls.push({ browser, args, verbose });
    const portFile = path.join(profileDirFrom(args), "DevToolsActivePort");
    if (this.writesPort) fs.writeFileSync(portFile, `${this.port}\n/devtools/browser/fake`);
    if (this.closesAtOnce) setImmediate(() => this.process.close(0));
    return this.process;
  }

  get profileDir() {
    return profileDirFrom(this.calls[0].args);
  }
}

// Starts with the browser's about:blank startup tab. The worker shows up after
// `readyAfter` polls, the way a real one does a moment after the DevTools port is
// already open.
class FakeDevTools {
  constructor({ readyAfter = 0, extensionId = KNOWN_ID } = {}) {
    Object.assign(this, { readyAfter, extensionId, listCalls: 0, opened: [], closed: [] });
    this.pages = [{ id: "startup", type: "page", url: "about:blank" }];
    this.tabWaiters = [];
  }

  async listTargets() {
    this.listCalls += 1;
    if (this.listCalls <= this.readyAfter) return [...this.pages];
    const worker = { id: "sw", type: "service_worker", url: `chrome-extension://${this.extensionId}/sw.js` };
    return [...this.pages, worker];
  }

  async openTab(port, url) {
    this.opened.push({ port, url });
    this.pages.push({ id: `tab-${this.opened.length}`, type: "page", url });
    this.tabWaiters.filter((waiter) => this.opened.length >= waiter.count).forEach((waiter) => waiter.done());
  }

  async closeTab(port, targetId) {
    this.closed.push(targetId);
    this.pages = this.pages.filter((page) => page.id !== targetId);
  }

  waitForTabs(count) {
    return new Promise((done) => this.tabWaiters.push({ count, done }));
  }
}

// A local HTTP server answering like the DevTools endpoint, so DevToolsHttp is
// tested over a real socket instead of a stubbed fetch.
class FakeDevToolsServer {
  constructor(status = 200) {
    this.requests = [];
    this.server = http.createServer((request, response) => this.answer(request, response, status));
  }

  answer(request, response, status) {
    this.requests.push({ method: request.method, url: request.url });
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify([{ type: "page", url: "about:blank" }]));
  }

  listen() {
    return new Promise((done) => this.server.listen(0, "127.0.0.1", () => done(this.server.address().port)));
  }

  close() {
    return new Promise((done) => this.server.close(done));
  }
}

function makeDeps(scratch, overrides = {}) {
  fs.mkdirSync(scratch.path("tmp"), { recursive: true });
  return {
    root: KNOWN_PATH,
    env: { PATH: "/usr/bin", XDG_CACHE_HOME: scratch.path("cache") },
    tempRoot: scratch.path("tmp"),
    isExecutable: new FakePathLookup(["/usr/bin/helium-browser"]).isExecutable,
    launch: new FakeLauncher().launch,
    devtools: new FakeDevTools(),
    sleep: nextTurn,
    log: () => {},
    ...overrides
  };
}

// ----- extensionIdForPath -----

test("extensionIdForPath: matches the ID Chromium gave this repo", () => {
  assert.equal(dev.extensionIdForPath(KNOWN_PATH), KNOWN_ID);
});

test("extensionIdForPath: always 32 letters from a to p", () => {
  assert.match(dev.extensionIdForPath("/somewhere/else"), /^[a-p]{32}$/);
});

test("extensionIdForPath: refuses a relative path, naming it", () => {
  assert.throws(() => dev.extensionIdForPath("DopamineToll"), /absolute path, got: "DopamineToll"/);
});

// ----- parseDevArgs -----

test("parseDevArgs: no arguments means Helium-or-fallback, fresh profile, quiet", () => {
  assert.deepEqual(dev.parseDevArgs([]), { browser: null, keep: false, verbose: false, urls: [] });
});

test("parseDevArgs: reads every flag and keeps URLs in order", () => {
  const options = dev.parseDevArgs(["--keep", "https://x.com", "--browser", "chromium", "--verbose", "http://a.test"]);
  assert.deepEqual(options, {
    browser: "chromium",
    keep: true,
    verbose: true,
    urls: ["https://x.com", "http://a.test"]
  });
});

test("parseDevArgs: an unknown argument fails, naming it", () => {
  assert.throws(() => dev.parseDevArgs(["--kepp"]), /unknown argument "--kepp"; expected --browser/);
});

test("parseDevArgs: --browser without a value fails instead of eating the next flag", () => {
  assert.throws(() => dev.parseDevArgs(["--browser"]), /--browser needs a name or path, got: undefined/);
  assert.throws(() => dev.parseDevArgs(["--browser", "--keep"]), /got: "--keep"/);
});

// ----- findOnPath / resolveBrowser -----

test("findOnPath: takes the first PATH entry that has it", () => {
  const lookup = new FakePathLookup(["/opt/bin/chromium", "/usr/bin/chromium"]);
  assert.equal(
    dev.findOnPath("chromium", "/usr/local/bin:/opt/bin:/usr/bin", lookup.isExecutable),
    "/opt/bin/chromium"
  );
});

test("findOnPath: a name with a slash is a path, not a PATH search", () => {
  const lookup = new FakePathLookup(["/opt/helium/helium"]);
  assert.equal(dev.findOnPath("/opt/helium/helium", "/usr/bin", lookup.isExecutable), "/opt/helium/helium");
  assert.equal(dev.findOnPath("/opt/other/helium", "/opt/helium", lookup.isExecutable), null);
});

test("findOnPath: an empty PATH finds nothing", () => {
  assert.equal(dev.findOnPath("helium", undefined, new FakePathLookup(["helium"]).isExecutable), null);
});

test("resolveBrowser: prefers Helium when Chromium is also installed", () => {
  const lookup = new FakePathLookup(["/usr/bin/chromium", "/usr/bin/helium-browser"]);
  assert.equal(dev.resolveBrowser(null, "/usr/bin", lookup.isExecutable), "/usr/bin/helium-browser");
});

test("resolveBrowser: an explicit choice wins over the defaults", () => {
  const lookup = new FakePathLookup(["/usr/bin/brave", "/usr/bin/helium-browser"]);
  assert.equal(dev.resolveBrowser("brave", "/usr/bin", lookup.isExecutable), "/usr/bin/brave");
});

test("resolveBrowser: nothing found lists what it looked for", () => {
  assert.throws(
    () => dev.resolveBrowser(null, "/usr/bin", new FakePathLookup([]).isExecutable),
    new RegExp(`looked for ${dev.BROWSER_CANDIDATES.join(", ")} on PATH`)
  );
});

// ----- profile -----

test("seedProfile: a new profile gets developer mode, the toolbar pin and no onboarding", (t) => {
  const scratch = new ScratchDir();
  t.after(() => scratch.cleanup());
  dev.seedProfile(scratch.root, KNOWN_ID);
  const preferences = JSON.parse(fs.readFileSync(scratch.path("Default", "Preferences"), "utf8"));
  const localState = JSON.parse(fs.readFileSync(scratch.path("Local State"), "utf8"));
  assert.equal(preferences.extensions.ui.developer_mode, true);
  assert.deepEqual(preferences.extensions.pinned_extensions, [KNOWN_ID]);
  assert.equal(localState.helium.completed_onboarding, true);
});

test("seedProfile: leaves a profile that already has Preferences alone", (t) => {
  const scratch = new ScratchDir();
  t.after(() => scratch.cleanup());
  fs.mkdirSync(scratch.path("Default"));
  fs.writeFileSync(scratch.path("Default", "Preferences"), '{"mine":true}');
  dev.seedProfile(scratch.root, KNOWN_ID);
  assert.equal(fs.readFileSync(scratch.path("Default", "Preferences"), "utf8"), '{"mine":true}');
});

test("keptProfileDir: lives under XDG_CACHE_HOME, else ~/.cache", () => {
  assert.equal(dev.keptProfileDir({ XDG_CACHE_HOME: "/c" }), "/c/dopamine-toll/dev-profile");
  assert.equal(dev.keptProfileDir({ HOME: "/home/u" }), "/home/u/.cache/dopamine-toll/dev-profile");
});

test("createProfile: a fresh profile is a temp dir that dispose deletes", (t) => {
  const scratch = new ScratchDir();
  t.after(() => scratch.cleanup());
  const profile = dev.createProfile({ keep: false, env: {}, extensionId: KNOWN_ID, tempRoot: scratch.root });
  assert.ok(profile.dir.startsWith(path.join(scratch.root, "dt-dev-profile-")));
  assert.ok(fs.existsSync(path.join(profile.dir, "Default", "Preferences")));
  profile.dispose();
  assert.equal(fs.existsSync(profile.dir), false);
});

test("createProfile: a kept profile survives dispose and drops last run's port", (t) => {
  const scratch = new ScratchDir();
  t.after(() => scratch.cleanup());
  const env = { XDG_CACHE_HOME: scratch.root };
  const first = dev.createProfile({ keep: true, env, extensionId: KNOWN_ID });
  fs.writeFileSync(path.join(first.dir, "DevToolsActivePort"), "4444\n");
  first.dispose();
  const second = dev.createProfile({ keep: true, env, extensionId: KNOWN_ID });
  assert.equal(second.dir, first.dir);
  assert.equal(dev.readDevToolsPort(second.dir), null);
});

// ----- browser arguments and pages -----

test("browserArgs: isolated profile, this extension only, DevTools on a free port", () => {
  const args = dev.browserArgs({ root: "/repo", profileDir: "/tmp/p" });
  assert.ok(args.includes("--user-data-dir=/tmp/p"));
  assert.ok(args.includes("--load-extension=/repo"));
  assert.ok(args.includes("--disable-extensions-except=/repo"));
  assert.ok(args.includes("--remote-debugging-port=0"));
});

// Regression: a headed Helium 0.20.3.1 replaced a chrome://extensions startup URL
// with a new tab page, and a chrome-extension:// one loads ERR_BLOCKED_BY_CLIENT.
test("browserArgs: starts on about:blank, never on an extension or chrome:// page", () => {
  const args = dev.browserArgs({ root: "/repo", profileDir: "/tmp/p" });
  assert.equal(args.at(-1), "about:blank");
  assert.equal(
    args.some((arg) => /^chrome(-extension)?:\/\//.test(arg)),
    false
  );
});

test("startPages: the extension's card, its settings, then the user's URLs", () => {
  assert.deepEqual(dev.startPages(KNOWN_ID, ["https://x.com"]), [
    `chrome://extensions/?id=${KNOWN_ID}`,
    `chrome-extension://${KNOWN_ID}/options/index.html`,
    "https://x.com"
  ]);
});

test("replaceStartupTab: opens the pages, then closes only the tab that was there first", async () => {
  const devtools = new FakeDevTools();
  await dev.replaceStartupTab(devtools, 9555, ["chrome://extensions/", "about:blank"]);
  assert.deepEqual(
    devtools.opened.map((tab) => tab.url),
    ["chrome://extensions/", "about:blank"]
  );
  assert.deepEqual(devtools.closed, ["startup"]);
});

test("readDevToolsPort: reads the first line, ignores missing or garbled files", (t) => {
  const scratch = new ScratchDir();
  t.after(() => scratch.cleanup());
  assert.equal(dev.readDevToolsPort(scratch.root), null);
  fs.writeFileSync(scratch.path("DevToolsActivePort"), "not-a-port\n");
  assert.equal(dev.readDevToolsPort(scratch.root), null);
  fs.writeFileSync(scratch.path("DevToolsActivePort"), "40097\n/devtools/browser/abc");
  assert.equal(dev.readDevToolsPort(scratch.root), 40097);
});

// ----- waitForExtension -----

test("waitForExtension: resolves with the port once the worker appears", async (t) => {
  const scratch = new ScratchDir();
  t.after(() => scratch.cleanup());
  fs.writeFileSync(scratch.path("DevToolsActivePort"), "9333\n");
  const devtools = new FakeDevTools({ readyAfter: 3 });
  const port = await dev.waitForExtension({
    profileDir: scratch.root,
    extensionId: KNOWN_ID,
    devtools,
    sleep: nextTurn,
    isOpen: () => true
  });
  assert.equal(port, 9333);
  assert.equal(devtools.listCalls, 4);
});

test("waitForExtension: another extension's worker does not count", async (t) => {
  const scratch = new ScratchDir();
  t.after(() => scratch.cleanup());
  fs.writeFileSync(scratch.path("DevToolsActivePort"), "9333\n");
  const devtools = new FakeDevTools({ extensionId: "blockjmkbacgjkknlgpkjjiijinjdanf" });
  const waiting = dev.waitForExtension({
    profileDir: scratch.root,
    extensionId: KNOWN_ID,
    devtools,
    sleep: nextTurn,
    isOpen: () => true,
    timeoutMs: 1000
  });
  await assert.rejects(waiting, new RegExp(`no service worker at chrome-extension://${KNOWN_ID}/ after 1000ms`));
});

test("waitForExtension: gives up quietly when the browser has closed", async (t) => {
  const scratch = new ScratchDir();
  t.after(() => scratch.cleanup());
  const devtools = new FakeDevTools();
  const port = await dev.waitForExtension({
    profileDir: scratch.root,
    extensionId: KNOWN_ID,
    devtools,
    sleep: nextTurn,
    isOpen: () => false
  });
  assert.equal(port, null);
  assert.equal(devtools.listCalls, 0);
});

// ----- runDevBrowser -----

test("runDevBrowser: opens the extension's pages and the given URLs, then deletes the profile on close", async (t) => {
  const scratch = new ScratchDir();
  t.after(() => scratch.cleanup());
  const launcher = new FakeLauncher({ port: 9444 });
  const devtools = new FakeDevTools({ readyAfter: 2 });
  const deps = makeDeps(scratch, { launch: launcher.launch, devtools });
  const running = dev.runDevBrowser(["https://x.com"], deps);
  devtools.waitForTabs(3).then(() => launcher.process.close(0));
  assert.equal(await running, 0);
  assert.deepEqual(devtools.opened, [
    { port: 9444, url: `chrome://extensions/?id=${KNOWN_ID}` },
    { port: 9444, url: `chrome-extension://${KNOWN_ID}/options/index.html` },
    { port: 9444, url: "https://x.com" }
  ]);
  assert.deepEqual(devtools.closed, ["startup"]);
  assert.equal(launcher.calls[0].browser, "/usr/bin/helium-browser");
  assert.equal(fs.existsSync(launcher.profileDir), false);
});

test("runDevBrowser: a browser that closes before the extension is up opens nothing", async (t) => {
  const scratch = new ScratchDir();
  t.after(() => scratch.cleanup());
  const launcher = new FakeLauncher({ writesPort: false, closesAtOnce: true });
  const devtools = new FakeDevTools();
  const code = await dev.runDevBrowser([], makeDeps(scratch, { launch: launcher.launch, devtools }));
  assert.equal(code, 0);
  assert.deepEqual(devtools.opened, []);
  assert.equal(fs.existsSync(launcher.profileDir), false);
});

test("runDevBrowser: --keep leaves the profile in the cache dir", async (t) => {
  const scratch = new ScratchDir();
  t.after(() => scratch.cleanup());
  const launcher = new FakeLauncher({ closesAtOnce: true, writesPort: false });
  await dev.runDevBrowser(["--keep"], makeDeps(scratch, { launch: launcher.launch }));
  assert.equal(launcher.profileDir, scratch.path("cache", "dopamine-toll", "dev-profile"));
  assert.ok(fs.existsSync(launcher.profileDir));
});

test("whenClosed: a spawn error resolves with 1 instead of hanging", async () => {
  const child = new FakeBrowserProcess();
  const lines = [];
  const closed = dev.whenClosed(child, (line) => lines.push(line));
  child.emit("error", new Error("spawn helium ENOENT"));
  assert.equal(await closed, 1);
  assert.deepEqual(lines, ["browser failed to start: spawn helium ENOENT"]);
});

// ----- the real adapters -----

test("DevToolsHttp: lists targets, opens and closes tabs with values escaped", async (t) => {
  const server = new FakeDevToolsServer();
  const port = await server.listen();
  t.after(() => server.close());
  const devtools = new dev.DevToolsHttp();
  assert.deepEqual(await devtools.listTargets(port), [{ type: "page", url: "about:blank" }]);
  await devtools.openTab(port, "chrome://extensions/?id=abc");
  await devtools.closeTab(port, "ABC 123");
  assert.deepEqual(server.requests, [
    { method: "GET", url: "/json/list" },
    { method: "PUT", url: "/json/new?chrome%3A%2F%2Fextensions%2F%3Fid%3Dabc" },
    { method: "GET", url: "/json/close/ABC%20123" }
  ]);
});

test("DevToolsHttp: a refused close fails, naming the target and status", async (t) => {
  const server = new FakeDevToolsServer(404);
  const port = await server.listen();
  t.after(() => server.close());
  await assert.rejects(new dev.DevToolsHttp().closeTab(port, "gone"), /refused to close tab gone: HTTP 404/);
});

test("DevToolsHttp: a refused tab fails, naming the URL and status", async (t) => {
  const server = new FakeDevToolsServer(500);
  const port = await server.listen();
  t.after(() => server.close());
  await assert.rejects(
    new dev.DevToolsHttp().openTab(port, "https://x.com"),
    /refused to open https:\/\/x\.com: HTTP 500/
  );
});

test("launchProcess: hands back a child whose exit code comes through", async () => {
  const child = dev.launchProcess(process.execPath, ["-e", "process.exit(3)"], false);
  assert.equal(await dev.whenClosed(child, () => {}), 3);
});
