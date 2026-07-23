// Thin wrapper over chrome.i18n so every surface fetches localized copy the same
// way and static markup can be localized declaratively. Loaded as a classic
// script (not a module) so the popup, options page, and both content scripts can
// all share it — the service worker (a module) calls chrome.i18n directly.
//
// Declarative markup hooks (localized by applyI18n):
//   data-i18n="key"             -> element.textContent
//   data-i18n-html="key"        -> element.innerHTML (copy that carries markup)
//   data-i18n-placeholder="key" -> placeholder attribute
//   data-i18n-label="key"       -> aria-label attribute
//   data-i18n-title="key"       -> title attribute
(() => {
  if (window.DTI18n) return;

  const ATTR_HOOKS = {
    "data-i18n-placeholder": "placeholder",
    "data-i18n-label": "aria-label",
    "data-i18n-title": "title"
  };

  // Falls back to the raw key so a missing translation is visible in the UI
  // instead of blanking the element. subs are positional ($1..$9) strings.
  function t(key, subs) {
    if (!key) throw new Error(`t() needs a message key, got: ${JSON.stringify(key)}`);
    return chrome.i18n.getMessage(key, subs) || key;
  }

  function localizeText(root) {
    for (const el of root.querySelectorAll("[data-i18n]")) {
      el.textContent = t(el.dataset.i18n);
    }
  }

  function localizeHtml(root) {
    for (const el of root.querySelectorAll("[data-i18n-html]")) {
      el.innerHTML = t(el.dataset.i18nHtml);
    }
  }

  function localizeAttrs(root) {
    for (const [dataAttr, target] of Object.entries(ATTR_HOOKS)) {
      for (const el of root.querySelectorAll(`[${dataAttr}]`)) {
        el.setAttribute(target, t(el.getAttribute(dataAttr)));
      }
    }
  }

  // Localize every marked node under root and stamp the UI language on <html>
  // so screen readers and :lang() selectors see the active locale.
  //
  // Example: DTI18n.applyI18n(); // localizes the whole document on load
  function applyI18n(root = document) {
    localizeText(root);
    localizeHtml(root);
    localizeAttrs(root);
    document.documentElement.lang = chrome.i18n.getUILanguage();
  }

  window.DTI18n = { t, applyI18n };
})();
