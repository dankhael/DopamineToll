// Dopamine Toll friction reminders. Loads before blocker.js (see manifest).
// While an unlocked toll-list site is in front of the user, warning cards drop
// in from the top of the page, tumbling under gravity (see content/friction.css)
// and landing at random spots to clutter the view. Each shows one of their
// phrases and how long this tab has held their attention.
//
// Escalation: every `frictionMinutes` of active time drops a fresh wave, and
// each wave holds one more card than the last (1, then 2, then 3, …). Cards do
// NOT auto-dismiss — every one must be closed by hand, so ignoring them makes
// the mess grow. Everything resets when the user leaves the toll-list site.
//
// Time accrues only while the tab is visible and its window focused — same
// pause-on-blur rule as the toll clock in blocker.js.

(() => {
  if (window.__dopamineTollFrictionLoaded) return;
  window.__dopamineTollFrictionLoaded = true;

  const WARNING_CLASS = "dopamine-toll-friction";
  const MAX_CONCURRENT = 40;   // safety cap so ignored waves can't flood the DOM
  const WAVE_STAGGER_MS = 180; // rain a wave's cards in one after another
  const LEAVE_MS = 450;        // must match the dtf-leave duration in friction.css
  // Used until the user writes their own phrases; localized via _locales
  // (shared/i18n.js is loaded before this script in the manifest).
  const FALLBACK_PHRASES = [
    DTI18n.t("defaultPhrase1"),
    DTI18n.t("defaultPhrase3")
  ];

  let frictionConfig = { enabled: true, minutes: 5, phrases: FALLBACK_PHRASES, theme: "amber" };
  let onTollSite = false;
  let gateUp = false;
  let secondsOnTab = 0;
  let secondsSinceWave = 0;
  let waveCount = 0; // escalation counter; wave N drops N cards
  let ticker = null;

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
    secondsSinceWave += 1;
    if (secondsSinceWave >= frictionConfig.minutes * 60) {
      secondsSinceWave = 0;
      dropWave();
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

  // "7 min" under an hour, "1h 05m" past it — both localized via _locales.
  // Formatting logic lives in shared/format.js (unit-tested); the translator is
  // injected so that module never touches chrome.i18n directly.
  const fmtElapsed = (totalSeconds) => DTFormat.fmtElapsed(totalSeconds, DTI18n.t);

  function pickRandom(arr) {
    if (!arr || arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function randBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function countWarnings() {
    return document.getElementsByClassName(WARNING_CLASS).length;
  }

  function canSpawn() {
    return frictionConfig.enabled && onTollSite && !gateUp && countWarnings() < MAX_CONCURRENT;
  }

  // Immediate removal of every card — used when leaving the site or disabling.
  function removeAllWarnings() {
    const nodes = document.getElementsByClassName(WARNING_CLASS);
    // Live collection: walk from the end while removing.
    for (let i = nodes.length - 1; i >= 0; i--) nodes[i].remove();
  }

  // User dismiss (the ✕): let this specific card fall off the bottom, then drop it.
  function dismissWarning(el) {
    el.classList.add("dtf-leaving");
    setTimeout(() => el.remove(), LEAVE_MS);
  }

  // Random landing spot, resting tilt, and start spin so a pile of cards
  // scatters across the page instead of stacking in one place. The physics live
  // in friction.css; these per-instance values feed it through CSS variables.
  function buildWarning(phrase) {
    const el = document.createElement("div");
    el.className = WARNING_CLASS;
    el.dataset.theme = frictionConfig.theme;
    const x = randBetween(18, 82).toFixed(1);
    const y = randBetween(22, 78).toFixed(1);
    const tilt = randBetween(-7, 7).toFixed(1);
    const spin = ((Math.random() < 0.5 ? -1 : 1) * randBetween(160, 250)).toFixed(0);
    el.setAttribute(
      "style",
      `position:fixed!important;left:${x}%!important;top:${y}%!important;` +
        `z-index:2147483647!important;--dtf-tilt:${tilt}deg;--dtf-spin:${spin}deg;`
    );
    // Markup construction lives in content/gate-view.js so it can be asserted in
    // Node. The time string carries the catalog's <b> wrapper and word order; the
    // elapsed time (our own formatted string, no markup) is the substitution.
    const { card, close } = DTGateView.buildWarningCard(
      document,
      phrase,
      DTI18n.t("frictionTimeOnTab", [fmtElapsed(secondsOnTab)]),
      { eyebrow: DTI18n.t("frictionEyebrow"), dismissAria: DTI18n.t("frictionDismissAria") }
    );
    el.appendChild(card);
    close.addEventListener("click", () => dismissWarning(el));
    return el;
  }

  function spawnWarning() {
    if (!canSpawn()) return;
    const phrase = pickRandom(frictionConfig.phrases) || FALLBACK_PHRASES[0];
    (document.body || document.documentElement).appendChild(buildWarning(phrase));
  }

  // Each interval drops one more card than the last — friction that grows the
  // longer the user stays. Stagger the spawns so a wave rains down.
  function dropWave() {
    waveCount += 1;
    for (let i = 0; i < waveCount; i++) {
      setTimeout(spawnWarning, i * WAVE_STAGGER_MS);
    }
  }

  function resetOnLeave() {
    secondsOnTab = 0;
    secondsSinceWave = 0;
    waveCount = 0;
    removeAllWarnings();
  }

  // blocker.js reports the gate's state through this hook; the clock only runs
  // while the toll is paid and the site is actually usable. Leaving the
  // toll-list site clears the pile and resets the escalation.
  window.__dopamineTollFriction = {
    setGateState(next) {
      const wasOnTollSite = onTollSite;
      onTollSite = !!next.onTollSite;
      gateUp = !!next.gateUp;
      if (wasOnTollSite && !onTollSite) resetOnLeave();
      syncTicker();
    }
  };

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    if (changes.frictionEnabled || changes.frictionMinutes || changes.phrases || changes.theme) {
      loadFrictionConfig().then(() => {
        if (!frictionConfig.enabled) removeAllWarnings();
        syncTicker();
      });
    }
  });

  document.addEventListener("visibilitychange", syncTicker);
  window.addEventListener("focus", syncTicker);
  window.addEventListener("blur", syncTicker);

  loadFrictionConfig().then(syncTicker);
})();
