// Pure formatting helpers shared by the content scripts and exercised directly
// by the Node test suite. No DOM, no chrome APIs — locale-dependent output is
// delegated to an injected translator `t`, so every function here is a pure
// function of its arguments (F.I.R.S.T-friendly).
//
// Dual export: as a classic content script it attaches window.DTFormat; under
// Node (require) it returns the same API via module.exports.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DTFormat = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Seconds → "MM:SS" for the toll clock. Negatives clamp to 0.
  // Example: fmtClock(75) === "01:15"
  function fmtClock(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }

  // Elapsed tab time as localized copy: "7 min" under an hour, "1h 05m" past it.
  // `t` is the DTI18n translator (key, substitutions[]) → string, injected so
  // this module never reaches for chrome.i18n itself.
  // Example: fmtElapsed(65 * 60, t) → t("frictionElapsedHour", ["1", "05"])
  function fmtElapsed(totalSeconds, t) {
    if (typeof t !== "function") {
      throw new Error(`fmtElapsed needs a translator function, got: ${typeof t}`);
    }
    const mins = Math.floor(totalSeconds / 60);
    if (mins < 60) return t("frictionElapsedMin", [String(mins)]);
    const hours = String(Math.floor(mins / 60));
    const rem = String(mins % 60).padStart(2, "0");
    return t("frictionElapsedHour", [hours, rem]);
  }

  // Escape the five HTML-significant characters for safe interpolation into an
  // innerHTML template. Example: escapeHTML("<b>") === "&lt;b&gt;"
  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[c]);
  }

  return { fmtClock, fmtElapsed, escapeHTML };
});
