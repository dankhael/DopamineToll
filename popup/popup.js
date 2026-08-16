// Dopamine Toll popup logic.

const $ = (id) => document.getElementById(id);

// Apply the saved theme as early as possible (local mirror avoids a flash;
// chrome.storage.sync reconciles it on open).
try {
  const t = localStorage.getItem("dt-theme");
  if (t) document.documentElement.dataset.theme = t;
} catch {}

// Android renders the action popup as a full page instead of a sized popup window,
// so it needs a different width rule (see popup.css). Mirrored to localStorage so a
// re-open applies it before the async platform lookup resolves, avoiding a flash of
// the 300px desktop layout.
async function applyPlatformClass() {
  try {
    if (localStorage.getItem("dt-android") === "1") {
      document.documentElement.classList.add("android");
    }
  } catch {}
  const android = await DTPlatform.isAndroid(chrome.runtime);
  document.documentElement.classList.toggle("android", android);
  try { localStorage.setItem("dt-android", android ? "1" : "0"); } catch {}
}

async function applyThemeFromStorage() {
  const { theme = "amber" } = await chrome.storage.sync.get("theme");
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem("dt-theme", theme); } catch {}
}

// Local calendar day, e.g. "2026-06-01". Matches todayKey() in the service
// worker so the popup and the counter agree on when "today" rolls over.
function todayKey() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function setStatus({ host, meta, state }) {
  $("status-host").textContent = host;
  $("status-meta").textContent = meta || "";
  const el = $("status");
  el.classList.toggle("open", state === "open");
  el.classList.toggle("armed", state === "armed");
}

async function refreshStat() {
  const { tollStats } = await chrome.storage.local.get("tollStats");
  const fresh = tollStats && tollStats.date === todayKey() ? tollStats : { walkedAway: 0, paid: 0 };
  // Message carries the <b> wrapper and word order; counts are the substitutions.
  $("stat").innerHTML = DTI18n.t("popupStat", [String(fresh.walkedAway || 0), String(fresh.paid || 0)]);
}

// Firefox grants <all_urls> at install, but lets the user revoke it per-site or
// wholesale from the extensions menu at any time. Without it no content script
// injects and no gate can appear — so the popup says so instead of looking healthy
// while the toll is silently dead. Chrome keeps the permission granted, so this
// check is a no-op there.
const ALL_URLS = ["<all_urls>"];

const hasSiteAccess = () => DTPlatform.hasOriginAccess(chrome.permissions, ALL_URLS);

// permissions.request must run inside a user gesture, hence the click handler.
async function requestSiteAccess() {
  await DTPlatform.requestOriginAccess(chrome.permissions, ALL_URLS);
  refresh();
}

async function refresh() {
  if (!(await hasSiteAccess())) {
    $("grant-access").hidden = false;
    setStatus({ host: "—", meta: DTI18n.t("popupAccessRevoked"), state: "armed" });
    return;
  }
  $("grant-access").hidden = true;

  const { blockedDomains = [], enabled = true } = await chrome.storage.sync.get([
    "blockedDomains",
    "enabled"
  ]);
  $("count").textContent = String(blockedDomains.length);
  $("toggle").classList.toggle("on", enabled);
  $("toggle").setAttribute("aria-checked", String(enabled));
  refreshStat();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) {
    setStatus({ host: "—", meta: DTI18n.t("popupNoTab") });
    return;
  }
  let hostname = "";
  let pathname = "/";
  try {
    const url = new URL(tab.url);
    hostname = url.hostname;
    pathname = url.pathname;
  } catch {
    setStatus({ host: "—", meta: DTI18n.t("popupInternalPage") });
    return;
  }
  if (!hostname) {
    setStatus({ host: "—", meta: DTI18n.t("popupInternalPage") });
    return;
  }

  const resp = await chrome.runtime.sendMessage({
    type: "GET_TAB_STATUS",
    tabId: tab.id,
    hostname,
    pathname
  });
  if (!resp || !resp.blocked) {
    setStatus({ host: hostname, meta: DTI18n.t("popupNotOnList") });
    return;
  }
  if (resp.unlocked) {
    const remainingMs = (resp.unlockedUntil || 0) - Date.now();
    const mins = Math.max(0, Math.floor(remainingMs / 60000));
    const secs = Math.max(0, Math.floor((remainingMs % 60000) / 1000));
    const clock = `${mins}:${String(secs).padStart(2, "0")}`;
    setStatus({
      host: resp.domain,
      meta: DTI18n.t("popupWindowOpen", [clock]),
      state: "open"
    });
  } else {
    setStatus({ host: resp.domain, meta: DTI18n.t("popupTollArmed"), state: "armed" });
  }
}

async function toggleEnabled() {
  const { enabled = true } = await chrome.storage.sync.get("enabled");
  await chrome.storage.sync.set({ enabled: !enabled });
  refresh();
}

$("toggle").addEventListener("click", toggleEnabled);
$("toggle").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    toggleEnabled();
  }
});

$("grant-access").addEventListener("click", requestSiteAccess);

// The settings page opens in a tab behind the popup. On desktop the popup closes
// itself when it loses focus; on Android it is a full page that just sits there,
// hiding the tab that was opened and leaving the tap looking like it did nothing.
// Closing explicitly gives the same feedback on both.
$("open-options").addEventListener("click", async () => {
  await chrome.runtime.openOptionsPage();
  window.close();
});

document.addEventListener("DOMContentLoaded", () => {
  DTI18n.applyI18n();
  applyPlatformClass();
  applyThemeFromStorage();
  refresh();
});
// Live tick for the unlock-window countdown.
setInterval(refresh, 1000);
