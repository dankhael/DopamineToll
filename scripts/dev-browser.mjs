// Open a throwaway Chromium-family browser (Helium by default) with this
// extension loaded unpacked, in a profile that holds none of the user's own data:
// no history, logins, other extensions or synced settings. The profile sits in the
// OS temp dir and is deleted when the browser closes, so every run starts as a
// first install — the state a new user meets, with onInstalled seeding the
// default toll list.
//
// Usage:
//   npm run dev                         # fresh profile, settings page open
//   npm run dev -- https://x.com        # also open a tolled site once the extension is up
//   npm run dev -- --keep               # reuse one profile across runs (settings survive)
//   npm run dev -- --browser chromium   # any Chromium build that honours --load-extension
//   npm run dev -- --verbose            # show the browser's own stderr

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Helium first: it is the browser this project is tried in day to day. Google
// Chrome is deliberately absent — branded Chrome 137+ ignores --load-extension.
const BROWSER_CANDIDATES = ["helium-browser", "helium", "chromium", "chromium-browser"];

const USAGE = "expected --browser <name|path>, --keep, --verbose, or http(s) URLs to open";
const POLL_MS = 250;
const STARTUP_TIMEOUT_MS = 20000;

/**
 * Chromium's ID for an unpacked extension: the first 128 bits of SHA-256 over the
 * absolute path, spelled with the letters a–p instead of hex digits. Knowing it up
 * front lets the script open chrome-extension:// pages without asking the browser.
 *
 * @example
 *   extensionIdForPath("/home/me/DopamineToll") // 32 letters in a–p, stable per path
 */
function extensionIdForPath(absolutePath) {
  if (typeof absolutePath !== "string" || !isAbsolute(absolutePath)) {
    throw new Error(`extensionIdForPath needs an absolute path, got: ${JSON.stringify(absolutePath)}`);
  }
  const hex = createHash("sha256").update(absolutePath).digest("hex").slice(0, 32);
  return [...hex].map((digit) => String.fromCharCode(97 + parseInt(digit, 16))).join("");
}

/**
 * Turn the command line into options, refusing anything it does not recognise so
 * a typo cannot silently launch with the wrong profile mode.
 *
 * @example
 *   parseDevArgs(["--keep", "https://x.com"]) // { browser: null, keep: true, verbose: false, urls: ["https://x.com"] }
 */
function parseDevArgs(argv) {
  const options = { browser: null, keep: false, verbose: false, urls: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--keep") options.keep = true;
    else if (arg === "--verbose") options.verbose = true;
    else if (arg === "--browser") options.browser = browserValue(argv[(index += 1)]);
    else if (/^https?:\/\//.test(arg)) options.urls.push(arg);
    else throw new Error(`unknown argument ${JSON.stringify(arg)}; ${USAGE}`);
  }
  return options;
}

function browserValue(value) {
  if (!value || value.startsWith("--")) {
    throw new Error(`--browser needs a name or path, got: ${JSON.stringify(value)}; ${USAGE}`);
  }
  return value;
}

function isExecutableFile(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Locate an executable the way the shell would: a name with a slash is taken as a
 * path, anything else is searched for along PATH.
 *
 * @example
 *   findOnPath("helium-browser", "/usr/local/bin:/usr/bin") // "/usr/bin/helium-browser" or null
 */
function findOnPath(name, pathEnv, isExecutable = isExecutableFile) {
  if (name.includes("/")) return isExecutable(name) ? resolve(name) : null;
  for (const dir of (pathEnv || "").split(delimiter)) {
    if (dir && isExecutable(join(dir, name))) return join(dir, name);
  }
  return null;
}

/**
 * The browser to launch: the one asked for, or the first known Chromium build found.
 *
 * @example
 *   resolveBrowser(null, process.env.PATH) // "/usr/bin/helium-browser"
 */
function resolveBrowser(requested, pathEnv, isExecutable = isExecutableFile) {
  const candidates = requested ? [requested] : BROWSER_CANDIDATES;
  for (const name of candidates) {
    const found = findOnPath(name, pathEnv, isExecutable);
    if (found) return found;
  }
  throw new Error(
    `no browser found: looked for ${candidates.join(", ")} on PATH; pass --browser <name|path> to a Chromium build`
  );
}

// Seeded so the first window is already useful: developer mode shows the reload
// button and "Inspect views: service worker" on chrome://extensions, and the pin
// puts the popup on the toolbar instead of behind the puzzle menu.
function seedPreferences(extensionId) {
  return { extensions: { ui: { developer_mode: true }, pinned_extensions: [extensionId] } };
}

// Helium opens a welcome flow on a new profile; marking it done puts the extension
// pages in front instead. Other Chromium builds ignore the unknown key.
const SEED_LOCAL_STATE = { helium: { completed_onboarding: true } };

/**
 * Write the starting prefs into a profile that has never been opened. A profile
 * that already has Preferences is left alone — it is a kept one with its own state.
 *
 * @example
 *   seedProfile("/tmp/dt-dev-profile-abc123", "ljnbbannggcalolajmjjjoifgodfdklj")
 */
function seedProfile(profileDir, extensionId) {
  const preferences = join(profileDir, "Default", "Preferences");
  if (existsSync(preferences)) return;
  mkdirSync(dirname(preferences), { recursive: true });
  writeFileSync(preferences, JSON.stringify(seedPreferences(extensionId)));
  writeFileSync(join(profileDir, "Local State"), JSON.stringify(SEED_LOCAL_STATE));
}

// Outside the repo on purpose: a Chromium profile inside it would be swept up by
// `web-ext lint --source-dir=.` and `web-ext run`.
function keptProfileDir(env) {
  const cache = env.XDG_CACHE_HOME || join(env.HOME || homedir(), ".cache");
  return join(cache, "dopamine-toll", "dev-profile");
}

/**
 * A profile directory plus how to get rid of it: a fresh temp dir deleted on
 * dispose, or the kept one, which dispose leaves in place.
 *
 * @example
 *   const profile = createProfile({ keep: false, env: process.env, extensionId });
 *   profile.dispose(); // the temp dir is gone
 */
function createProfile({ keep, env, extensionId, tempRoot = tmpdir() }) {
  const dir = keep ? keptProfileDir(env) : mkdtempSync(join(tempRoot, "dt-dev-profile-"));
  mkdirSync(dir, { recursive: true });
  // A kept profile still holds the port of its last run; reading it would point
  // the readiness check at a browser that is gone.
  rmSync(join(dir, "DevToolsActivePort"), { force: true });
  seedProfile(dir, extensionId);
  const dispose = keep ? () => {} : () => rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  return { dir, dispose };
}

/**
 * Command-line flags for the browser.
 *
 * @example
 *   browserArgs({ root: "/repo", profileDir: "/tmp/p" })
 */
function browserArgs({ root, profileDir }) {
  return [
    `--user-data-dir=${profileDir}`,
    `--load-extension=${root}`,
    // Keeps a kept profile down to this one extension even if something else was
    // installed into it. Helium's bundled uBlock Origin is a component extension
    // and stays on regardless.
    `--disable-extensions-except=${root}`,
    "--no-first-run",
    "--no-default-browser-check",
    // A new profile would otherwise ask the desktop keyring to unlock.
    "--password-store=basic",
    // Port 0 lets the OS pick; the browser writes it to <profile>/DevToolsActivePort.
    "--remote-debugging-port=0",
    // A placeholder, closed once the real pages are open. Neither of those can be
    // a startup URL: a headed Helium swaps chrome://extensions for a new tab page,
    // and a chrome-extension:// page loads blocked until the extension registers.
    STARTUP_TAB
  ];
}

const STARTUP_TAB = "about:blank";

/**
 * Pages to open once the extension is running: its card on chrome://extensions
 * (reload button, service worker inspector), its settings, then whatever the user
 * passed on the command line.
 *
 * @example
 *   startPages("abc…", ["https://x.com"])
 *   // ["chrome://extensions/?id=abc…", "chrome-extension://abc…/options/index.html", "https://x.com"]
 */
function startPages(extensionId, extraUrls) {
  return [
    `chrome://extensions/?id=${extensionId}`,
    `chrome-extension://${extensionId}/options/index.html`,
    ...extraUrls
  ];
}

function readDevToolsPort(profileDir) {
  try {
    const firstLine = readFileSync(join(profileDir, "DevToolsActivePort"), "utf8").split("\n")[0];
    const port = Number(firstLine);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null; // not written yet: the browser is still starting
  }
}

// The three DevTools HTTP endpoints this script needs. Small enough that a CDP
// client library would be more surface than it saves.
class DevToolsHttp {
  async listTargets(port) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    return response.json();
  }

  async openTab(port, url) {
    const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
    if (!response.ok) throw new Error(`DevTools refused to open ${url}: HTTP ${response.status}, expected 200`);
  }

  async closeTab(port, targetId) {
    const response = await fetch(`http://127.0.0.1:${port}/json/close/${encodeURIComponent(targetId)}`);
    if (!response.ok)
      throw new Error(`DevTools refused to close tab ${targetId}: HTTP ${response.status}, expected 200`);
  }
}

async function extensionIsRunning(devtools, port, extensionId) {
  const prefix = `chrome-extension://${extensionId}/`;
  try {
    const targets = await devtools.listTargets(port);
    return targets.some((target) => target.type === "service_worker" && target.url.startsWith(prefix));
  } catch {
    return false; // the endpoint is not accepting connections yet
  }
}

/**
 * Resolve with the DevTools port once the extension's service worker is up, or
 * null if the browser closed first.
 *
 * The wait exists because a chrome-extension:// page navigated before the
 * extension registers loads as ERR_BLOCKED_BY_CLIENT (seen on Helium 0.20.3.1,
 * Chromium 156). The worker is a reliable signal: Chromium reloads a
 * --load-extension extension on every launch, kept profile or not.
 *
 * @example
 *   const port = await waitForExtension({ profileDir, extensionId, devtools, sleep, isOpen: () => true });
 */
async function waitForExtension({ profileDir, extensionId, devtools, sleep, isOpen, timeoutMs = STARTUP_TIMEOUT_MS }) {
  for (let waited = 0; waited < timeoutMs; waited += POLL_MS) {
    if (!isOpen()) return null;
    const port = readDevToolsPort(profileDir);
    if (port && (await extensionIsRunning(devtools, port, extensionId))) return port;
    await sleep(POLL_MS);
  }
  throw new Error(
    `no service worker at chrome-extension://${extensionId}/ after ${timeoutMs}ms; ` +
      "expected the browser to honour --load-extension (branded Chrome 137+ does not)"
  );
}

/**
 * Open `urls`, then close the placeholder tab the browser started on. The
 * placeholders are listed before anything opens, so a page of ours — or an
 * about:blank the user opens later — is never the one closed.
 *
 * @example
 *   await replaceStartupTab(new DevToolsHttp(), 40097, ["chrome://extensions/"]);
 */
async function replaceStartupTab(devtools, port, urls) {
  const targets = await devtools.listTargets(port);
  const placeholders = targets.filter((target) => target.type === "page" && target.url === STARTUP_TAB);
  for (const url of urls) await devtools.openTab(port, url);
  for (const placeholder of placeholders) await devtools.closeTab(port, placeholder.id);
}

async function openWhenReady({ profile, extensionId, urls, isOpen, deps }) {
  const { devtools, sleep, log } = deps;
  try {
    const port = await waitForExtension({ profileDir: profile.dir, extensionId, devtools, sleep, isOpen });
    if (port === null) return;
    await replaceStartupTab(devtools, port, startPages(extensionId, urls));
  } catch (error) {
    // The browser is still worth keeping open to debug in; only the tabs are missing.
    log(`warning: ${error.message}`);
  }
}

function launchProcess(browser, args, verbose) {
  return spawn(browser, args, { stdio: verbose ? "inherit" : "ignore" });
}

// Resolves with the exit code. A spawn failure arrives as "error" with no "exit",
// and would otherwise leave the profile behind and the script hanging.
function whenClosed(child, log) {
  return new Promise((done) => {
    child.once("exit", (code) => done(code ?? 0));
    child.once("error", (error) => {
      log(`browser failed to start: ${error.message}`);
      done(1);
    });
  });
}

function printSummary(log, { browser, extensionId, profile, keep }) {
  log(`browser:      ${browser}`);
  log(`extension id: ${extensionId}`);
  log(`profile:      ${profile.dir} (${keep ? "kept between runs" : "deleted when the browser closes"})`);
}

/**
 * Launch the dev browser, open the extension's pages, and resolve with the
 * browser's exit code once it closes — after the throwaway profile is deleted.
 *
 * @example
 *   const code = await runDevBrowser(["--keep"], defaultDeps());
 */
async function runDevBrowser(argv, deps) {
  const options = parseDevArgs(argv);
  const browser = resolveBrowser(options.browser, deps.env.PATH, deps.isExecutable);
  const extensionId = extensionIdForPath(deps.root);
  const profile = createProfile({ keep: options.keep, env: deps.env, extensionId, tempRoot: deps.tempRoot });
  const child = deps.launch(browser, browserArgs({ root: deps.root, profileDir: profile.dir }), options.verbose);
  let open = true;
  const closed = whenClosed(child, deps.log);
  closed.then(() => (open = false));
  printSummary(deps.log, { browser, extensionId, profile, keep: options.keep });
  await openWhenReady({ profile, extensionId, urls: options.urls, isOpen: () => open, deps });
  const code = await closed;
  profile.dispose();
  return code;
}

function defaultDeps() {
  return {
    root: ROOT,
    env: process.env,
    tempRoot: tmpdir(),
    isExecutable: isExecutableFile,
    launch: launchProcess,
    devtools: new DevToolsHttp(),
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    log: (line) => console.log(line)
  };
}

// Only launch when run as a script — the test suite imports this module.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // Ctrl+C reaches the browser too (same process group). Stay alive until it has
  // closed so the throwaway profile is deleted after it, not out from under it.
  process.on("SIGINT", () => {});
  runDevBrowser(process.argv.slice(2), defaultDeps()).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error.message);
      process.exit(1);
    }
  );
}

export {
  BROWSER_CANDIDATES,
  extensionIdForPath,
  parseDevArgs,
  findOnPath,
  resolveBrowser,
  seedProfile,
  keptProfileDir,
  createProfile,
  browserArgs,
  startPages,
  readDevToolsPort,
  DevToolsHttp,
  waitForExtension,
  replaceStartupTab,
  launchProcess,
  whenClosed,
  runDevBrowser
};
