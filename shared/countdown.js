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

  // The three required hooks, plus no-op defaults for the optional ones, so every
  // function below can call them without checking first.
  function readHooks(hooks) {
    const { isActive, watchActivity, onTick, onDone, onPause, onResume, timers } = hooks || {};
    requireFn(isActive, "isActive");
    requireFn(watchActivity, "watchActivity");
    requireFn(onDone, "onDone");
    const noop = () => {};
    return {
      isActive,
      watchActivity,
      onDone,
      onTick: typeof onTick === "function" ? onTick : noop,
      onPause: typeof onPause === "function" ? onPause : noop,
      onResume: typeof onResume === "function" ? onResume : noop,
      clock: timers || { setInterval, clearInterval }
    };
  }

  function stopTicker(state) {
    if (state.ticker === null) return;
    state.hooks.clock.clearInterval(state.ticker);
    state.ticker = null;
  }

  // Release everything the countdown holds: its timer and its activity listeners.
  // Called on completion and on stop() alike, so neither leaves the page hooked.
  function finish(state) {
    state.finished = true;
    stopTicker(state);
    if (state.unwatch) state.unwatch();
    state.unwatch = null;
  }

  function tick(state) {
    state.remaining -= 1;
    state.hooks.onTick(Math.max(0, state.remaining));
    if (state.remaining > 0) return;
    state.remaining = 0;
    finish(state);
    state.hooks.onDone();
  }

  function resume(state) {
    if (state.finished || state.ticker !== null || state.remaining <= 0) return;
    if (!state.hooks.isActive()) return;
    state.hooks.onResume(state.remaining);
    state.ticker = state.hooks.clock.setInterval(() => tick(state), 1000);
  }

  function pause(state) {
    if (state.ticker === null) return;
    stopTicker(state);
    state.hooks.onPause(state.remaining);
  }

  // Start watching, and paint the initial state: running if the user is looking at
  // it, frozen at full otherwise.
  function arm(state) {
    state.unwatch = state.hooks.watchActivity(() => {
      if (state.hooks.isActive()) resume(state);
      else pause(state);
    });
    if (state.hooks.isActive()) {
      state.hooks.onResume(state.remaining);
      state.ticker = state.hooks.clock.setInterval(() => tick(state), 1000);
    } else {
      state.hooks.onPause(state.remaining);
    }
  }

  function makeControl(state) {
    return {
      stop: () => {
        if (!state.finished) finish(state);
      },
      remaining: () => state.remaining
    };
  }

  // A countdown of zero seconds is already over; report it without arming a timer.
  function finishImmediately(state) {
    state.finished = true;
    state.hooks.onTick(0);
    state.hooks.onDone();
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
    const state = {
      remaining: Math.max(0, Math.floor(seconds)),
      ticker: null,
      finished: false,
      unwatch: null,
      hooks: readHooks(hooks)
    };
    if (state.remaining === 0) finishImmediately(state);
    else arm(state);
    return makeControl(state);
  }

  return { pageActivity, startFocusCountdown };
});
