// Element construction shared by the gate overlay, the friction cards, the popup,
// and the settings page. Exists because every one of those surfaces interleaves
// our own localized copy with user-supplied text, and AMO review flags dynamic
// innerHTML assignment (UNSAFE_VAR_ASSIGNMENT) — so nothing here touches innerHTML.
//
// The document is injected rather than read from the global so the whole module is
// a pure function of its arguments and can run against a fake DOM under Node.
//
// Dual export: as a classic content script it attaches window.DTDom; under Node
// (require) it returns the same API via module.exports.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DTDom = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * Build one element. `text` becomes textContent, so callers can pass user input
   * without escaping it.
   *
   * Example: el(document, "button", "remove", "Remove") → <button class="remove">Remove</button>
   */
  function el(doc, tag, className, text) {
    if (!doc || typeof doc.createElement !== "function") {
      throw new Error(`el needs a document with createElement, got: ${typeof doc}`);
    }
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /**
   * The block list and the phrase list are the same row shape: a value span the
   * caller fills in, plus a remove button. `removeLabel` is injected so this module
   * never reaches for chrome.i18n itself.
   *
   * Example: createRemovableRow(document, "item dom", "remove")
   */
  function createRemovableRow(doc, rowClass, removeLabel) {
    const row = el(doc, "div", rowClass);
    const value = el(doc, "span", "val");
    const remove = el(doc, "button", "remove", removeLabel);
    row.append(value, remove);
    return { row, value, remove };
  }

  return { el, createRemovableRow };
});
