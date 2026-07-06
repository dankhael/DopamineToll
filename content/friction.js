// Dopamine Toll friction reminders. Loads before blocker.js (see manifest).
// While an unlocked toll-list site is in front of the user, a small corner
// toast pops up every `frictionMinutes` of active time, showing one of their
// phrases and how long this tab has held their attention. Time accrues only
// while the tab is visible and its window focused — same pause-on-blur rule
// as the toll clock in blocker.js.

(() => {
  if (window.__dopamineTollFrictionLoaded) return;
  window.__dopamineTollFrictionLoaded = true;

  const TOAST_ID = "dopamine-toll-friction";
  const TOAST_VISIBLE_MS = 12_000;
  const FALLBACK_PHRASES = [
    "your future self will thank you",
    "focus. discipline. results."
  ];

  let frictionConfig = { enabled: true, minutes: 5, phrases: FALLBACK_PHRASES, theme: "amber" };
  let onTollSite = false;
  let gateUp = false;
  let secondsOnTab = 0;
  let secondsSinceToast = 0;
  let ticker = null;
  let toastHideTimer = null;

  async function loadFrictionConfig() {
    try {
      const sync = await chrome.storage.sync.get(["frictionEnabled", "frictionMinutes", "phrases", "theme"]);
      frictionConfig = {
        enabled: sync.frictionEnabled !== false,
        minutes: typeof sync.frictionMinutes === "number" ? sync.frictionMinutes : 5,
        phrases: Array.isArray(sync.phrases) && sync.phrases.length ? sync.phrases : FALLBACK_PHRASES,
        theme: typeof sync.theme === "string" ? sync.theme : "amber"
      };
    } catch {
      // Storage unavailable (extension reloading) — keep current values.
    }
  }

  // Same two signals as the gate: switching tabs flips document.hidden,
  // Alt+Tab blurs the window without hiding the tab.
  function isTabInFront() {
    return !document.hidden && document.hasFocus();
  }

  function shouldCountTime() {
    return frictionConfig.enabled && onTollSite && !gateUp && isTabInFront();
  }

  function tickSecond() {
    secondsOnTab += 1;
    secondsSinceToast += 1;
    if (secondsSinceToast >= frictionConfig.minutes * 60) {
      secondsSinceToast = 0;
      showFrictionToast();
    }
  }

  function syncTicker() {
    if (shouldCountTime()) {
      if (!ticker) ticker = setInterval(tickSecond, 1000);
      return;
    }
    if (ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  }

  // "7 min" under an hour, "1h 05m" past it.
  function fmtElapsed(totalSeconds) {
    const mins = Math.floor(totalSeconds / 60);
    if (mins < 60) return `${mins} min`;
    return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
  }

  function pickRandom(arr) {
    if (!arr || arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function removeToast() {
    if (toastHideTimer) {
      clearTimeout(toastHideTimer);
      toastHideTimer = null;
    }
    const el = document.getElementById(TOAST_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function buildToast(phrase) {
    const toast = document.createElement("div");
    toast.id = TOAST_ID;
    toast.dataset.theme = frictionConfig.theme;
    // Inline critical positioning so host CSS resets can't kill it.
    toast.setAttribute(
      "style",
      "position:fixed!important;right:20px!important;bottom:20px!important;z-index:2147483647!important;"
    );
    // Static markup only — the phrase is user text, so it goes in via textContent.
    toast.innerHTML = `
      <div class="dtf-card">
        <div class="dtf-eyebrow">dopamine toll</div>
        <div class="dtf-phrase"></div>
        <div class="dtf-time"><b></b> on this tab</div>
        <button class="dtf-close" aria-label="dismiss">✕</button>
      </div>
    `;
    toast.querySelector(".dtf-phrase").textContent = phrase;
    toast.querySelector(".dtf-time > b").textContent = fmtElapsed(secondsOnTab);
    toast.querySelector(".dtf-close").addEventListener("click", removeToast);
    return toast;
  }

  function showFrictionToast() {
    removeToast();
    const phrase = pickRandom(frictionConfig.phrases) || FALLBACK_PHRASES[0];
    (document.body || document.documentElement).appendChild(buildToast(phrase));
    toastHideTimer = setTimeout(removeToast, TOAST_VISIBLE_MS);
  }

  // blocker.js reports the gate's state through this hook; the clock only runs
  // while the toll is paid and the site is actually usable. Leaving the
  // toll-list site resets the tab clock.
  window.__dopamineTollFriction = {
    setGateState(next) {
      const wasOnTollSite = onTollSite;
      onTollSite = !!next.onTollSite;
      gateUp = !!next.gateUp;
      if (wasOnTollSite && !onTollSite) {
        secondsOnTab = 0;
        secondsSinceToast = 0;
        removeToast();
      }
      syncTicker();
    }
  };

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    if (changes.frictionEnabled || changes.frictionMinutes || changes.phrases || changes.theme) {
      loadFrictionConfig().then(syncTicker);
    }
  });

  document.addEventListener("visibilitychange", syncTicker);
  window.addEventListener("focus", syncTicker);
  window.addEventListener("blur", syncTicker);

  loadFrictionConfig().then(syncTicker);
})();
