// Platform and permission queries, with the browser APIs injected as parameters so
// each function is testable against named fakes instead of a live browser.
//
// Two facts drive this module, both measured on a device rather than assumed:
//   - Firefox for Android renders the action popup as a full page, not a sized
//     popup window, so the popup needs a different width rule there.
//   - Firefox grants <all_urls> at install but lets the user revoke it at any time
//     from the extensions menu, which silently stops every content script.
//
// Dual export: as a classic script it attaches window.DTPlatform; under Node
// (require) it returns the same API via module.exports.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DTPlatform = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * True when running on Firefox for Android. Falls back to false — the desktop
   * layout is the safe default — when the API is unavailable.
   *
   * Example: await isAndroid(chrome.runtime) → false on desktop
   */
  async function isAndroid(runtime) {
    try {
      const info = await runtime.getPlatformInfo();
      return info.os === "android";
    } catch {
      return false;
    }
  }

  /**
   * Whether the extension still holds the given origins. Assumes access when the
   * API is unavailable, so a missing API never shows the user a warning we cannot
   * substantiate.
   *
   * Example: await hasOriginAccess(chrome.permissions, ["<all_urls>"]) → true
   */
  async function hasOriginAccess(permissions, origins) {
    if (!permissions || typeof permissions.contains !== "function") return true;
    try {
      return await permissions.contains({ origins });
    } catch {
      return true;
    }
  }

  /**
   * Ask for the origins back. Must be called from a user gesture. Resolves false
   * when the user dismisses the prompt or the browser refuses.
   *
   * Example: await requestOriginAccess(chrome.permissions, ["<all_urls>"])
   */
  async function requestOriginAccess(permissions, origins) {
    if (!permissions || typeof permissions.request !== "function") return false;
    try {
      return await permissions.request({ origins });
    } catch {
      return false;
    }
  }

  return { isAndroid, hasOriginAccess, requestOriginAccess };
});
