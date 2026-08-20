// The countdown that only advances while the user is actually looking at it.
//
// Extracted from content/blocker.js (where it was trapped inside an IIFE, wired to
// live page events and unreachable from any test) because the cooling-off on the
// settings page and the popup must obey the identical rule — see ADR-0003. Waiting
// a toll out in another tab is not waiting, and that has to mean the same thing on
// every surface.
//
// The DOM is injected and every side effect is a callback, so the clock itself is a
// pure function of its inputs and runs under Node against fake timers.
//
// Dual export: as a classic script it attaches window.DTCountdown; under Node
// (require) it returns the same API via module.exports.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DTCountdown = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * "The user is looking at this" for a real page: the tab is visible AND the
   * window has focus. Both signals are needed — switching tabs flips
   * document.hidden, while Alt+Tab to another app blurs the window without
   * hiding the tab.
   *
   * Example: startFocusCountdown(30, { ...pageActivity(document, window), onDone })
   */
  function pageActivity(doc, win) {
    return {
      isActive: () => !doc.hidden && doc.hasFocus(),
      watchActivity(onChange) {
        doc.addEventListener("visibilitychange", onChange);
        win.addEventListener("focus", onChange);
        win.addEventListener("blur", onChange);
        return () => {
          doc.removeEventListener("visibilitychange", onChange);
          win.removeEventListener("focus", onChange);
          win.removeEventListener("blur", onChange);
        };
      }
    };
  }

  function requireFn(fn, name) {
    if (typeof fn !== "function") {
      throw new Error(`startFocusCountdown needs ${name} to be a function, got: ${typeof fn}`);
    }
  }

  /**
   * Count `seconds` down to zero, freezing whenever `isActive()` goes false and
   * resuming from where it stopped. Returns a controller; call stop() to clear the
   * timer and detach the activity listeners.
   *
   * onTick(remaining) fires every second including the final 0, then onDone().
   * onPause/onResume(remaining) bracket every freeze, so a caller animating a meter
   * knows both how long is left and that it must re-target.
   *
   * @example
   *   const control = startFocusCountdown(30, {
   *     ...pageActivity(document, window),
   *     onTick: (left) => { clockEl.textContent = fmtClock(left); },
   *     onDone: () => unlockTheGate()
   *   });
   *   control.stop();
   */
  function startFocusCountdown(seconds, hooks) {
    const total = Math.max(0, Math.floor(seconds));
    const { isActive, watchActivity, onTick, onDone, onPause, onResume, timers } = hooks || {};
    requireFn(isActive, "isActive");
    requireFn(watchActivity, "watchActivity");
    requireFn(onDone, "onDone");

    const clock = timers || { setInterval, clearInterval };
    const tickOnce = typeof onTick === "function" ? onTick : () => {};
    const freeze = typeof onPause === "function" ? onPause : () => {};
    const thaw = typeof onResume === "function" ? onResume : () => {};

    let remaining = total;
    let ticker = null;
    let finished = false;
    let unwatch = null;

    function stopTicker() {
      if (ticker === null) return;
      clock.clearInterval(ticker);
      ticker = null;
    }

    function finish() {
      finished = true;
      stopTicker();
      if (unwatch) unwatch();
      unwatch = null;
    }

    function tick() {
      remaining -= 1;
      tickOnce(Math.max(0, remaining));
      if (remaining > 0) return;
      remaining = 0;
      finish();
      onDone();
    }

    function resume() {
      if (finished || ticker !== null || remaining <= 0 || !isActive()) return;
      thaw(remaining);
      ticker = clock.setInterval(tick, 1000);
    }

    function pause() {
      if (ticker === null) return;
      stopTicker();
      freeze(remaining);
    }

    function syncToActivity() {
      if (isActive()) resume();
      else pause();
    }

    function stop() {
      if (finished) return;
      finish();
    }

    // A zero-second countdown is already over; report it without arming a timer.
    if (total === 0) {
      tickOnce(0);
      onDone();
      return { stop, remaining: () => 0 };
    }

    unwatch = watchActivity(syncToActivity);
    if (isActive()) {
      thaw(remaining);
      ticker = clock.setInterval(tick, 1000);
    } else {
      freeze(remaining);
    }

    return { stop, remaining: () => remaining };
  }

  return { pageActivity, startFocusCountdown };
});
