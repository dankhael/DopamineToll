// Which setting changes weaken the toll, and therefore have to sit through a
// cooling-off before they apply (ADR-0003). Tightening the toll never waits.
//
// This lives apart from the settings page because the direction of two of these
// settings is inverted and easy to get backwards — a longer unlock window and a
// longer gap between friction reminders both make the toll *weaker*, not stronger.
// Getting either sign wrong opens a hole in silence, so the table is pinned by
// tests rather than trusted.
//
// Dual export: attaches window.DTTollGuard as a classic script; under Node
// (require) it returns the same API via module.exports.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DTTollGuard = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Short on purpose: this raises the price of an impulse, it is not a lock. See
  // ADR-0003 for what it deliberately does not try to protect.
  const COOL_OFF_SECONDS = 30;

  // Numeric settings where a HIGHER number means less friction.
  const HIGHER_IS_WEAKER = new Set(["unlockDuration", "frictionMinutes", "freePassAllowance"]);
  // Numeric settings where a LOWER number means less friction.
  const LOWER_IS_WEAKER = new Set(["lockDuration"]);
  // Switches that are protecting the user while they are on.
  const OFF_IS_WEAKER = new Set(["enabled", "frictionEnabled", "coolOffEnabled"]);

  function isWeakeningNumber(key, current, next) {
    if (HIGHER_IS_WEAKER.has(key)) return next > current;
    if (LOWER_IS_WEAKER.has(key)) return next < current;
    return false;
  }

  /**
   * Does changing `key` from `current` to `next` make the toll easier to get past?
   *
   * Lists weaken by getting shorter (a site removed) and tighten by getting longer.
   * Anything not named here — the theme, the phrases, the north star photos — is the
   * user's own content rather than a toll parameter, and never waits.
   *
   * @example
   *   isWeakening("lockDuration", 30, 10)    // true — a shorter wait
   *   isWeakening("unlockDuration", 10, 20)  // true — longer loose on the site
   *   isWeakening("unlockDuration", 20, 10)  // false — tightening is instant
   */
  function isWeakening(key, current, next) {
    if (typeof key !== "string" || !key) {
      throw new Error(`isWeakening needs a setting key, got: ${JSON.stringify(key)}`);
    }
    if (Array.isArray(current) && Array.isArray(next)) return next.length < current.length;
    if (OFF_IS_WEAKER.has(key)) return current !== false && next === false;
    if (typeof current === "number" && typeof next === "number") {
      return isWeakeningNumber(key, current, next);
    }
    return false;
  }

  return { COOL_OFF_SECONDS, isWeakening };
});
