// Dopamine Toll background service worker (MV3).
//
// shared/freepass.js carries the free-pass ledger rules (ADR-0004) and has to be
// loaded two different ways, because the two browsers run this file in two
// different contexts (ADR-0001): Chrome runs a classic service worker, where
// importScripts is the only way to pull a file in, while Firefox runs an event
// page, which has no importScripts at all — there the manifest's
// background.scripts array has already loaded it by the time this line runs.
if (typeof importScripts === "function") {
  importScripts("../shared/freepass.js");
}

// Responsibilities:
//   - Seed default config on install.
//   - Track per-tab unlocks in chrome.storage.session.
//   - Tell content scripts when a navigation lands on a blocked domain.
//   - Clean up unlock state when tabs close.
//   - Keep the daily free-pass ledger and spend from it.
//   - Paint the toolbar icon in the active theme's accent.

// Built fresh (not a top-level const) so the seeded phrases pick up the
// browser locale via chrome.i18n at install time. Everything else is static.
function defaultConfig() {
  return {
    blockedDomains: ["twitter.com", "x.com", "instagram.com", "tiktok.com", "youtube.com/shorts"],
    phrases: [
      chrome.i18n.getMessage("defaultPhrase1"),
      chrome.i18n.getMessage("defaultPhrase2"),
      chrome.i18n.getMessage("defaultPhrase3"),
      chrome.i18n.getMessage("defaultPhrase4")
    ],
    lockDuration: 30,
    unlockDuration: 10,
    frictionEnabled: true,
    frictionMinutes: 5,
    freePassAllowance: 0,
    coolOffEnabled: false,
    enabled: true,
    theme: "amber"
  };
}

const SESSION_KEY = "unlocks"; // { [tabId:domain]: unlockedUntilEpochMs }

// ---- themed toolbar icon ----
// The action icon is the countdown-gauge mark drawn in the active theme's accent,
// rendered on the fly with OffscreenCanvas so we don't ship a PNG per theme. The
// static manifest icons stay as the fallback. Geometry matches gen-icons.ps1
// (72px grid: cx/cy 36, r 28, stroke 6, dot r 7).
const THEME_ACCENT = {
  amber: "#e9a24c",
  indigo: "#8b9cff",
  emerald: "#34d399",
  rose: "#fb7185"
};

function drawTollIcon(size, accent) {
  const c = new OffscreenCanvas(size, size);
  const ctx = c.getContext("2d");
  const s = size / 72;
  ctx.clearRect(0, 0, size, size);

  // rounded near-black tile
  ctx.fillStyle = "#0a0908";
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, 16 * s);
  ctx.fill();

  const cx = 36 * s;
  const cy = 36 * s;
  const r = 28 * s;
  ctx.lineWidth = 6 * s;
  ctx.lineCap = "round";

  // ring track
  ctx.strokeStyle = "#2a2419";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // accent arc (~234° clockwise from top)
  const start = -Math.PI / 2;
  ctx.strokeStyle = accent;
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, start + (234 * Math.PI) / 180);
  ctx.stroke();

  // center dot
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(cx, cy, 7 * s, 0, Math.PI * 2);
  ctx.fill();

  return ctx.getImageData(0, 0, size, size);
}

async function applyThemeIcon(theme) {
  const accent = THEME_ACCENT[theme] || THEME_ACCENT.amber;
  try {
    await chrome.action.setIcon({
      imageData: {
        16: drawTollIcon(16, accent),
        32: drawTollIcon(32, accent),
        48: drawTollIcon(48, accent),
        128: drawTollIcon(128, accent)
      }
    });
  } catch {
    // OffscreenCanvas/setIcon can be unavailable in rare contexts — the static
    // manifest icon remains as the fallback.
  }
}

async function refreshThemeIcon() {
  const { theme } = await chrome.storage.sync.get("theme");
  await applyThemeIcon(typeof theme === "string" ? theme : "amber");
}

chrome.runtime.onInstalled.addListener(async () => {
  const config = defaultConfig();
  const existing = await chrome.storage.sync.get(Object.keys(config));
  const patch = {};
  for (const [k, v] of Object.entries(config)) {
    if (existing[k] === undefined) patch[k] = v;
  }
  if (Object.keys(patch).length) await chrome.storage.sync.set(patch);

  // North star photos live in local storage (too large for sync); seed an empty
  // array on first install so readers never hit `undefined`.
  const local = await chrome.storage.local.get("goalImages");
  if (!Array.isArray(local.goalImages)) {
    await chrome.storage.local.set({ goalImages: [] });
  }
  await refreshThemeIcon();
});

// Repaint the toolbar icon the moment the theme changes in settings.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (changes.theme) {
    applyThemeIcon(changes.theme.newValue || "amber").catch(() => {});
  }
  if (changes.freePassAllowance) {
    pinAllowanceBefore(changes.freePassAllowance.oldValue).catch(() => {});
  }
});

// Re-apply on every worker start (the icon can reset to the manifest default when
// the ephemeral worker is recycled).
refreshThemeIcon().catch(() => {});

function hostnameMatches(hostname, host) {
  return hostname === host || hostname.endsWith("." + host);
}

async function getBlockedDomains() {
  const { blockedDomains, enabled } = await chrome.storage.sync.get(["blockedDomains", "enabled"]);
  if (enabled === false) return [];
  return Array.isArray(blockedDomains) ? blockedDomains : [];
}

// A blocked entry is either "host" or "host/path". The optional path narrows
// the block to one section of a site — e.g. "youtube.com/shorts" gates Shorts
// while leaving the rest of YouTube reachable. Subdomains of host always match.
function parseBlockedEntry(entry) {
  const slash = entry.indexOf("/");
  if (slash === -1) return { host: entry, path: "" };
  let path = entry.slice(slash);
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return { host: entry.slice(0, slash), path };
}

// Prefix match on path segments: "/shorts" matches "/shorts" and "/shorts/abc"
// but not "/shortstories". Empty path matches the whole host.
function pathMatches(pathname, path) {
  if (path === "") return true;
  return pathname === path || pathname.startsWith(path + "/");
}

function findBlockedEntry(hostname, pathname, blockedList) {
  if (!hostname) return null;
  for (const entry of blockedList) {
    const { host, path } = parseBlockedEntry(entry);
    if (hostnameMatches(hostname, host) && pathMatches(pathname || "/", path)) {
      return entry;
    }
  }
  return null;
}

function unlockKey(tabId, domain) {
  return `${tabId}:${domain}`;
}

async function getUnlocks() {
  const got = await chrome.storage.session.get(SESSION_KEY);
  return got[SESSION_KEY] || {};
}

async function setUnlocks(unlocks) {
  await chrome.storage.session.set({ [SESSION_KEY]: unlocks });
}

async function isUnlocked(tabId, domain) {
  const unlocks = await getUnlocks();
  const until = unlocks[unlockKey(tabId, domain)];
  if (!until) return { unlocked: false };
  if (Date.now() >= until) {
    delete unlocks[unlockKey(tabId, domain)];
    await setUnlocks(unlocks);
    return { unlocked: false };
  }
  return { unlocked: true, unlockedUntil: until };
}

async function registerUnlock(tabId, domain) {
  const { unlockDuration } = await chrome.storage.sync.get("unlockDuration");
  const minutes = typeof unlockDuration === "number" ? unlockDuration : 10;
  const until = Date.now() + minutes * 60_000;
  const unlocks = await getUnlocks();
  unlocks[unlockKey(tabId, domain)] = until;
  await setUnlocks(unlocks);
  return until;
}

// ---- daily stats: walked away vs paid vs spent a free pass ----
// Kept in chrome.storage.local under "tollStats" and reset when the local calendar
// day rolls over. The popup reads this to show today's tally. Records written before
// free passes existed simply have no spentFreePass key, which reads as zero.
async function bumpStat(kind) {
  const today = DTFreePass.dayKey(new Date());
  const { tollStats } = await chrome.storage.local.get("tollStats");
  const stats =
    tollStats && tollStats.date === today
      ? tollStats
      : { date: today, walkedAway: 0, paid: 0, spentFreePass: 0 };
  stats[kind] = (stats[kind] || 0) + 1;
  await chrome.storage.local.set({ tollStats: stats });
}

// ---- the daily free-pass ledger ----
// The balance is per device and never synced (ADR-0004). The refill is lazy: the
// ledger is only rewritten when a pass is actually spent, so a day that rolls over
// costs no storage write until the user reaches for a pass.
const LEDGER_KEY = DTFreePass.STORAGE_KEY;

// Reading also *pins* the day: a stale or missing ledger is written back at the
// allowance in force right now. Without that snapshot on disk, raising the allowance
// later today would open a fresh ledger at the new number and grant the passes
// immediately — the very bypass the cooling-off in front of that setting exists to
// slow down (ADR-0004). Costs one write per day, on the first read.
async function readLedger() {
  const [local, sync] = await Promise.all([
    chrome.storage.local.get(LEDGER_KEY),
    chrome.storage.sync.get("freePassAllowance")
  ]);
  const allowance = DTFreePass.clampAllowance(sync.freePassAllowance);
  const today = DTFreePass.dayKey(new Date());
  const pin = DTFreePass.ledgerToPin(local[LEDGER_KEY], today, allowance);
  if (pin) await chrome.storage.local.set({ [LEDGER_KEY]: pin });
  return { ledger: pin || DTFreePass.currentLedger(local[LEDGER_KEY], today, allowance), allowance };
}

async function countFreePasses() {
  const { ledger, allowance } = await readLedger();
  return DTFreePass.passesLeft(ledger, allowance);
}

// The other half of the same guarantee: a user who has not hit a blocked site yet
// today has no ledger for readLedger() to have pinned, so an allowance change pins
// one itself — at the value being replaced, not the new one.
async function pinAllowanceBefore(previousAllowance) {
  const local = await chrome.storage.local.get(LEDGER_KEY);
  const today = DTFreePass.dayKey(new Date());
  const pin = DTFreePass.ledgerToPin(local[LEDGER_KEY], today, previousAllowance);
  if (pin) await chrome.storage.local.set({ [LEDGER_KEY]: pin });
}

// Returns what is left after the attempt, and whether one was actually spent —
// the gate hides its button at zero, so a false here means the balance changed
// under an already-open gate.
async function applySpend() {
  const { ledger, allowance } = await readLedger();
  if (DTFreePass.passesLeft(ledger, allowance) <= 0) return { spent: false, left: 0 };
  const next = DTFreePass.spendPass(ledger, allowance);
  await chrome.storage.local.set({ [LEDGER_KEY]: next });
  return { spent: true, left: DTFreePass.passesLeft(next, allowance) };
}

// Spends are serialised. The worker is single-threaded, but every await inside
// applySpend yields, so two gates spending at the same moment could both read a
// balance of one, both write a spend, and both be let through — handing out the same
// pass twice and breaking the one guarantee ADR-0004 rests on.
let spendChain = Promise.resolve();

function spendFreePass() {
  const spend = spendChain.then(applySpend, applySpend);
  spendChain = spend.then(
    () => {},
    () => {}
  );
  return spend;
}

async function cleanupTab(tabId) {
  const unlocks = await getUnlocks();
  let changed = false;
  for (const k of Object.keys(unlocks)) {
    if (k.startsWith(tabId + ":")) {
      delete unlocks[k];
      changed = true;
    }
  }
  if (changed) await setUnlocks(unlocks);
}

chrome.tabs.onRemoved.addListener((tabId) => {
  cleanupTab(tabId).catch(() => {});
});

// Fires on full document navigations (onCommitted) and on SPA route changes that
// keep the same document (onHistoryStateUpdated — i.e. history.pushState /
// replaceState). The content script runs in an isolated world and so cannot patch
// the page's own history methods; catching pushState here in the background is what
// keeps the gate SPA-aware on Twitter / Reddit / YouTube / Instagram.
async function handleNavigation(details) {
  if (details.frameId !== 0) return;
  let url;
  try {
    url = new URL(details.url);
  } catch {
    return;
  }
  if (!/^https?:$/.test(url.protocol)) return;

  const blockedList = await getBlockedDomains();
  const matched = findBlockedEntry(url.hostname, url.pathname, blockedList);
  if (!matched) return;

  const status = await isUnlocked(details.tabId, matched);
  if (status.unlocked) return;

  try {
    await chrome.tabs.sendMessage(details.tabId, {
      type: "SHOW_OVERLAY",
      domain: matched,
      hostname: url.hostname,
      freePassesLeft: await countFreePasses()
    });
  } catch {
    // Content script may not yet be ready; it will request status on its own.
  }
}

chrome.webNavigation.onCommitted.addListener(handleNavigation);
chrome.webNavigation.onHistoryStateUpdated.addListener(handleNavigation);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const tabId = sender.tab?.id ?? msg.tabId;
    try {
      if (msg.type === "CHECK_DOMAIN") {
        const blockedList = await getBlockedDomains();
        const matched = findBlockedEntry(msg.hostname, msg.pathname, blockedList);
        if (!matched) return sendResponse({ blocked: false });
        const status = await isUnlocked(tabId, matched);
        sendResponse({
          blocked: true,
          domain: matched,
          unlocked: status.unlocked,
          unlockedUntil: status.unlockedUntil ?? null,
          // The gate needs this to decide whether to offer a free pass at all: at
          // zero it shows nothing rather than a disabled button, which would only
          // taunt someone already trying to leave.
          freePassesLeft: await countFreePasses()
        });
      } else if (msg.type === "REGISTER_UNLOCK") {
        const until = await registerUnlock(tabId, msg.domain);
        await bumpStat("paid");
        sendResponse({ ok: true, unlockedUntil: until });
      } else if (msg.type === "SPEND_FREE_PASS") {
        // A free pass buys the same unlock window paying the toll buys — it skips
        // the wait, it does not buy a bigger reward.
        const { spent, left } = await spendFreePass();
        if (!spent) return sendResponse({ ok: false, freePassesLeft: 0 });
        const until = await registerUnlock(tabId, msg.domain);
        await bumpStat("spentFreePass");
        sendResponse({ ok: true, unlockedUntil: until, freePassesLeft: left });
      } else if (msg.type === "GET_TAB_STATUS") {
        // Used by popup. msg.tabId + msg.hostname provided by caller.
        const freePassesLeft = await countFreePasses();
        const blockedList = await getBlockedDomains();
        const matched = findBlockedEntry(msg.hostname || "", msg.pathname, blockedList);
        if (!matched) return sendResponse({ blocked: false, freePassesLeft });
        const status = await isUnlocked(msg.tabId, matched);
        sendResponse({ blocked: true, domain: matched, freePassesLeft, ...status });
      } else if (msg.type === "CLOSE_TAB") {
        await bumpStat("walkedAway");
        if (tabId !== undefined) {
          chrome.tabs.remove(tabId).catch(() => {});
        }
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: "unknown message" });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  })();
  return true; // async response
});
