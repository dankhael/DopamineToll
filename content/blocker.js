// Dopamine Toll content script. Runs at document_start in every frame's top doc.
// Hooks into SPA navigation and re-checks domain on every transition.

(() => {
  if (window.__dopamineTollLoaded) return;
  window.__dopamineTollLoaded = true;

  const OVERLAY_ID = "dopamine-toll-overlay";
  // Shown only when the user has no phrases of their own; localized to the
  // browser locale via _locales (see shared/i18n.js, loaded before this script).
  const FALLBACK_PHRASES = [
    DTI18n.t("defaultPhrase1"),
    DTI18n.t("defaultPhrase3")
  ];

  let lastHref = location.href;
  let mutationObserver = null;
  let countdownControl = null;
  let currentDomain = null;

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          if (chrome.runtime.lastError) return resolve(null);
          resolve(resp);
        });
      } catch {
        resolve(null);
      }
    });
  }

  async function loadConfig() {
    const defaults = {
      phrases: FALLBACK_PHRASES,
      lockDuration: 30,
      unlockDuration: 10,
      goalImages: [],
      theme: "amber"
    };
    try {
      const sync = await chrome.storage.sync.get(["phrases", "lockDuration", "unlockDuration", "theme"]);
      const local = await chrome.storage.local.get(["goalImages"]);
      return {
        phrases: Array.isArray(sync.phrases) && sync.phrases.length ? sync.phrases : defaults.phrases,
        lockDuration: typeof sync.lockDuration === "number" ? sync.lockDuration : defaults.lockDuration,
        unlockDuration: typeof sync.unlockDuration === "number" ? sync.unlockDuration : defaults.unlockDuration,
        goalImages: Array.isArray(local.goalImages) ? local.goalImages : [],
        theme: typeof sync.theme === "string" ? sync.theme : defaults.theme
      };
    } catch {
      return defaults;
    }
  }

  function pickRandom(arr) {
    if (!arr || arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // Feed the friction reminder script (content/friction.js, loaded before this
  // one) the gate state so it only counts tab time while the toll is paid and
  // the site is actually in use.
  function reportGateState(onTollSite, gateUp) {
    window.__dopamineTollFriction?.setGateState({ onTollSite, gateUp });
  }

  // Pure formatters live in shared/format.js (loaded before this script) so
  // they can be unit-tested in Node. Aliased here to keep the call sites terse.
  const fmtClock = DTFormat.fmtClock;
  const escapeHTML = DTFormat.escapeHTML;

  // goalImages entries are either a legacy base64 string or {name, src}.
  function imageSrc(entry) {
    if (!entry) return null;
    return typeof entry === "string" ? entry : entry.src || null;
  }

  function ensureBodyReady() {
    return new Promise((resolve) => {
      if (document.body) return resolve();
      const obs = new MutationObserver(() => {
        if (document.body) {
          obs.disconnect();
          resolve();
        }
      });
      obs.observe(document.documentElement, { childList: true });
    });
  }

  async function checkAndMaybeShow() {
    const hostname = window.location.hostname;
    if (!hostname) return;
    const pathname = window.location.pathname;
    const resp = await send({ type: "CHECK_DOMAIN", hostname, pathname });
    if (!resp || !resp.blocked) {
      removeOverlay();
      reportGateState(false, false);
      return;
    }
    if (resp.unlocked) {
      removeOverlay();
      reportGateState(true, false);
      return;
    }
    currentDomain = resp.domain;
    await ensureBodyReady();
    await injectOverlay(resp.domain);
  }

  function removeOverlay() {
    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }
    if (countdownControl) {
      countdownControl.stop();
      countdownControl = null;
    }
    const el = document.getElementById(OVERLAY_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  // The gate is "active" only while its tab is visible and its window focused.
  // Switching tabs flips document.hidden; Alt+Tab to another app blurs the
  // window without hiding the tab — so we need both signals.
  function isGateActive() {
    return !document.hidden && document.hasFocus();
  }

  // Runs the toll clock, but only while the gate is in front of the user.
  // Leaving the tab/window freezes the clock and the meter; returning resumes
  // from where it stopped, so stepping away doesn't pay the toll. Returns a
  // controller whose stop() clears the timer and detaches the focus listeners.
  function startTollCountdown({ clockEl, meterBar, lazyNote }, lockSeconds, onUnlock) {
    let remaining = lockSeconds;
    let ticker = null;

    // Animate the meter draining to empty over the seconds still owed.
    function drainMeter(seconds) {
      meterBar.style.transition = `width ${seconds}s linear`;
      requestAnimationFrame(() => {
        meterBar.style.width = "0%";
      });
    }

    // Stop the meter mid-drain at the fraction of time still remaining.
    function freezeMeter() {
      meterBar.style.transition = "none";
      meterBar.style.width = `${Math.max(0, (remaining / lockSeconds) * 100)}%`;
    }

    function stopTicker() {
      if (!ticker) return;
      clearInterval(ticker);
      ticker = null;
    }

    function tick() {
      remaining -= 1;
      if (remaining > 0) {
        clockEl.textContent = fmtClock(remaining);
        lazyNote.textContent = DTI18n.t("overlayUnlocksIn", [String(remaining)]);
        return;
      }
      stopTicker();
      clockEl.textContent = fmtClock(0);
      onUnlock();
    }

    function resume() {
      if (ticker || remaining <= 0 || !isGateActive()) return;
      drainMeter(remaining);
      ticker = setInterval(tick, 1000);
    }

    function pause() {
      if (!ticker) return;
      stopTicker();
      freezeMeter();
    }

    function syncToFocus() {
      if (isGateActive()) resume();
      else pause();
    }

    function stop() {
      stopTicker();
      document.removeEventListener("visibilitychange", syncToFocus);
      window.removeEventListener("focus", syncToFocus);
      window.removeEventListener("blur", syncToFocus);
    }

    document.addEventListener("visibilitychange", syncToFocus);
    window.addEventListener("focus", syncToFocus);
    window.addEventListener("blur", syncToFocus);

    if (isGateActive()) {
      drainMeter(lockSeconds);
      ticker = setInterval(tick, 1000);
    } else {
      freezeMeter();
    }

    return { pause, resume, stop };
  }

  async function injectOverlay(domain) {
    reportGateState(true, true);
    const cfg = await loadConfig();
    const phrase = pickRandom(cfg.phrases) || FALLBACK_PHRASES[0];
    const imgSrc = imageSrc(pickRandom(cfg.goalImages));
    const lockSeconds = Math.max(1, Math.floor(cfg.lockDuration));
    const unlockMinutes = Math.max(1, Math.floor(cfg.unlockDuration));

    // Remove existing overlay first to reset state.
    const existing = document.getElementById(OVERLAY_ID);
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.dataset.theme = cfg.theme;
    // Inline critical positioning so host CSS resets can't kill it.
    overlay.setAttribute(
      "style",
      "position:fixed!important;inset:0!important;z-index:2147483647!important;"
    );

    // With a north star uploaded, the photo shows it; otherwise a striped
    // placeholder card. Localized copy comes from _locales; it is our own text
    // (no user HTML) so it is interpolated directly, while `domain`, `phrase`,
    // and `imgSrc` stay escaped.
    const photoFill = imgSrc
      ? `<img class="dt-photo-img" src="${escapeHTML(imgSrc)}" alt="${escapeHTML(DTI18n.t("overlayNorthStarAlt"))}">`
      : `<div class="dt-stripes"></div>`;

    overlay.innerHTML = `
      <div class="dt-backdrop">
        <div class="dt-stage">
          <div class="dt-col" role="dialog" aria-modal="true">
            <div class="dt-eyebrow"><b>${escapeHTML(domain)}</b><span class="dt-dotsep"></span>${DTI18n.t("overlayOnList")}</div>

            <div class="dt-photo">
              ${photoFill}
              <div class="dt-tint"></div>
            </div>

            <div class="dt-phrase">${escapeHTML(phrase)}<span class="dt-you">${DTI18n.t("overlayYouToYourself")}</span></div>

            <div class="dt-toll">
              <div class="dt-label">${DTI18n.t("overlayChooseIn")}</div>
              <div class="dt-clock">${fmtClock(lockSeconds)}</div>
              <div class="dt-meter"><i></i></div>
            </div>

            <div class="dt-actions">
              <button class="dt-btn dt-primary" data-dt-action="productive">${DTI18n.t("overlayCloseTab")}<small>${DTI18n.t("overlayBeProductive")}</small></button>
              <button class="dt-btn dt-locked" data-dt-action="lazy" disabled>${DTI18n.t("overlayOpenAnyway", [String(unlockMinutes)])}<small>${DTI18n.t("overlayUnlocksIn", [String(lockSeconds)])}</small></button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.documentElement.appendChild(overlay);

    const clockEl = overlay.querySelector(".dt-clock");
    const labelEl = overlay.querySelector(".dt-label");
    const meterBar = overlay.querySelector(".dt-meter > i");
    const lazyBtn = overlay.querySelector('[data-dt-action="lazy"]');
    const lazyNote = lazyBtn.querySelector("small");
    const prodBtn = overlay.querySelector('[data-dt-action="productive"]');

    // Flip the gate to its unlocked state once the toll is fully paid.
    const onUnlock = () => {
      labelEl.textContent = DTI18n.t("overlayChooseNow");
      lazyBtn.disabled = false;
      lazyBtn.classList.remove("dt-locked");
      lazyBtn.classList.add("dt-ghost");
      lazyNote.textContent = DTI18n.t("overlayBeLazy");
    };

    // The toll only counts down while this tab/window has the user's attention —
    // Alt+Tab or a tab switch freezes it, so they can wait elsewhere.
    if (countdownControl) countdownControl.stop();
    countdownControl = startTollCountdown({ clockEl, meterBar, lazyNote }, lockSeconds, onUnlock);

    prodBtn.addEventListener("click", () => {
      // Try to close. If blocked, navigate away.
      send({ type: "CLOSE_TAB" });
      try {
        window.close();
      } catch {}
      setTimeout(() => {
        try {
          location.replace("about:blank");
        } catch {}
      }, 150);
    });

    lazyBtn.addEventListener("click", async () => {
      if (lazyBtn.disabled) return;
      const resp = await send({ type: "REGISTER_UNLOCK", domain });
      if (resp && resp.ok) {
        scheduleRelock(resp.unlockedUntil);
        removeOverlay();
        reportGateState(true, false);
      }
    });

    // Re-inject if the host page (or DevTools) removes the overlay.
    if (mutationObserver) mutationObserver.disconnect();
    mutationObserver = new MutationObserver(() => {
      if (!document.getElementById(OVERLAY_ID)) {
        // Only re-inject if we're still on the same blocked domain and not unlocked.
        checkAndMaybeShow();
      }
    });
    mutationObserver.observe(document.documentElement, { childList: true, subtree: false });
    if (document.body) {
      mutationObserver.observe(document.body, { childList: true, subtree: false });
    }
  }

  function scheduleRelock(unlockedUntil) {
    const ms = unlockedUntil - Date.now();
    if (ms <= 0) {
      checkAndMaybeShow();
      return;
    }
    setTimeout(() => {
      checkAndMaybeShow();
    }, ms + 250);
  }

  // SPA navigation hooks. pushState / replaceState can't be patched from here: the
  // content script's isolated world has its own `history` wrapper, so the page's
  // own pushState calls never reach a patch installed here. Those route changes are
  // caught in the background via webNavigation.onHistoryStateUpdated instead.
  // popstate and hashchange are real DOM events that do reach this world, so we
  // still re-check on them directly for an instant local response (back/forward, #).
  function watchSpaNavigation() {
    window.addEventListener("popstate", onUrlChanged);
    window.addEventListener("hashchange", onUrlChanged);
  }

  function onUrlChanged() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    checkAndMaybeShow();
  }

  // Listen for proactive show-overlay messages from background.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "SHOW_OVERLAY") {
      currentDomain = msg.domain;
      ensureBodyReady().then(() => injectOverlay(msg.domain));
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });

  watchSpaNavigation();
  // Initial check.
  checkAndMaybeShow();
  document.addEventListener("DOMContentLoaded", checkAndMaybeShow);
})();
