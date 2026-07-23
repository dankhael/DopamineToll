/* Dopamine Toll store screenshots — shared i18n renderer.
   Each page defines a global `STRINGS = { en: {...}, es: {...}, ... }`.
   Elements carry data-t="key". Open with ?lang=xx to switch language. */
document.addEventListener("DOMContentLoaded", () => {
  const lang = new URLSearchParams(location.search).get("lang") || "en";
  // `const STRINGS` on a page lives in the global lexical scope, NOT on `window`,
  // so reference the bare binding (guarded) rather than `window.STRINGS`.
  const bag = (typeof STRINGS !== "undefined" && STRINGS) || (window.STRINGS || {});
  const dict = bag[lang] || bag.en || {};
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-t]").forEach(el => {
    const k = el.getAttribute("data-t");
    if (dict[k] != null) el.innerHTML = dict[k];
  });
});
