// Dopamine Toll popup logic.

const $ = (id) => document.getElementById(id);

// Apply the saved theme as early as possible (local mirror avoids a flash;
// chrome.storage.sync reconciles it on open).
try {
  const t = localStorage.getItem("dt-theme");
  if (t) document.documentElement.dataset.theme = t;
} catch {}

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
  $("stat").innerHTML = `today — <b>walked away ${fresh.walkedAway || 0}×</b> · paid ${fresh.paid || 0}×`;
}

async function refresh() {
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
    setStatus({ host: "—", meta: "no active tab" });
    return;
  }
  let hostname = "";
  let pathname = "/";
  try {
    const url = new URL(tab.url);
    hostname = url.hostname;
    pathname = url.pathname;
  } catch {
    setStatus({ host: "—", meta: "internal page" });
    return;
  }
  if (!hostname) {
    setStatus({ host: "—", meta: "internal page" });
    return;
  }

  const resp = await chrome.runtime.sendMessage({
    type: "GET_TAB_STATUS",
    tabId: tab.id,
    hostname,
    pathname
  });
  if (!resp || !resp.blocked) {
    setStatus({ host: hostname, meta: "not on your toll list" });
    return;
  }
  if (resp.unlocked) {
    const remainingMs = (resp.unlockedUntil || 0) - Date.now();
    const mins = Math.max(0, Math.floor(remainingMs / 60000));
    const secs = Math.max(0, Math.floor((remainingMs % 60000) / 1000));
    setStatus({
      host: resp.domain,
      meta: `on your toll list · window open ${mins}:${String(secs).padStart(2, "0")}`,
      state: "open"
    });
  } else {
    setStatus({ host: resp.domain, meta: "on your toll list · toll armed", state: "armed" });
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

$("open-options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.addEventListener("DOMContentLoaded", () => {
  applyThemeFromStorage();
  refresh();
});
// Live tick for the unlock-window countdown.
setInterval(refresh, 1000);
