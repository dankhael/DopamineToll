// Builds the gate overlay's DOM. Split out of content/blocker.js so the markup can
// be asserted under Node against a fake document — blocker.js itself is an IIFE
// wired to live chrome APIs and page events, and nothing inside it is reachable
// from a test.
//
// Every label is injected via the `copy` object rather than read from chrome.i18n,
// and the document is a parameter, so this module is a pure function of its inputs.
//
// Dual export: as a classic content script it attaches window.DTGateView; under
// Node (require) it returns the same API via module.exports.
(function (root, factory) {
  const api = factory(
    typeof module !== "undefined" && module.exports ? require("../shared/dom.js") : root.DTDom
  );
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DTGateView = api;
})(typeof self !== "undefined" ? self : this, function (DTDom) {
  "use strict";

  const el = DTDom.el;

  function buildEyebrow(doc, domain, onListLabel) {
    const eyebrow = el(doc, "div", "dt-eyebrow");
    eyebrow.append(el(doc, "b", null, domain), el(doc, "span", "dt-dotsep"));
    eyebrow.appendChild(doc.createTextNode(onListLabel));
    return eyebrow;
  }

  // With a north star uploaded the photo shows it; otherwise a striped placeholder.
  function buildPhoto(doc, imgSrc, altText) {
    const photo = el(doc, "div", "dt-photo");
    if (imgSrc) {
      const img = el(doc, "img", "dt-photo-img");
      img.src = imgSrc;
      img.alt = altText;
      photo.appendChild(img);
    } else {
      photo.appendChild(el(doc, "div", "dt-stripes"));
    }
    photo.appendChild(el(doc, "div", "dt-tint"));
    return photo;
  }

  function buildPhrase(doc, phrase, youLabel) {
    const node = el(doc, "div", "dt-phrase", phrase);
    node.appendChild(el(doc, "span", "dt-you", youLabel));
    return node;
  }

  function buildTollMeter(doc, clockText, chooseInLabel) {
    const toll = el(doc, "div", "dt-toll");
    const meter = el(doc, "div", "dt-meter");
    meter.appendChild(doc.createElement("i"));
    toll.append(el(doc, "div", "dt-label", chooseInLabel), el(doc, "div", "dt-clock", clockText), meter);
    return toll;
  }

  // The "open anyway" button starts disabled; blocker.js enables it when the toll
  // is fully paid.
  function buildActions(doc, copy) {
    const walkAway = el(doc, "button", "dt-btn dt-primary", copy.closeTab);
    walkAway.dataset.dtAction = "productive";
    walkAway.appendChild(el(doc, "small", null, copy.beProductive));

    const pay = el(doc, "button", "dt-btn dt-locked", copy.openAnyway);
    pay.dataset.dtAction = "lazy";
    pay.disabled = true;
    pay.appendChild(el(doc, "small", null, copy.unlocksIn));

    const actions = el(doc, "div", "dt-actions");
    actions.append(walkAway, pay);
    return actions;
  }

  /**
   * Assemble the whole gate. Returns the backdrop element, ready to append.
   *
   * @example
   *   const gate = buildGate(document, {
   *     domain: "x.com", phrase: "focus", imgSrc: null, clockText: "00:30",
   *     copy: { onList: "on your list", northStarAlt: "your north star", ... }
   *   });
   */
  function buildGate(doc, { domain, phrase, imgSrc, clockText, copy }) {
    const column = el(doc, "div", "dt-col");
    column.setAttribute("role", "dialog");
    column.setAttribute("aria-modal", "true");
    column.append(
      buildEyebrow(doc, domain, copy.onList),
      buildPhoto(doc, imgSrc, copy.northStarAlt),
      buildPhrase(doc, phrase, copy.youToYourself),
      buildTollMeter(doc, clockText, copy.chooseIn),
      buildActions(doc, copy)
    );

    const stage = el(doc, "div", "dt-stage");
    stage.appendChild(column);
    const backdrop = el(doc, "div", "dt-backdrop");
    backdrop.appendChild(stage);
    return backdrop;
  }

  /**
   * One friction reminder card. `timeHtml` carries the catalog's <b> wrapper, so it
   * is the single innerHTML assignment left in the content scripts — see
   * docs/amo-reviewer-notes.md.
   *
   * @example
   *   buildWarningCard(document, "focus", "<b>7 min</b> on this tab", copy)
   */
  function buildWarningCard(doc, phrase, timeHtml, copy) {
    const card = el(doc, "div", "dtf-card");
    const timeEl = el(doc, "div", "dtf-time");
    timeEl.innerHTML = timeHtml;

    const close = el(doc, "button", "dtf-close", "✕");
    close.setAttribute("aria-label", copy.dismissAria);

    card.append(el(doc, "div", "dtf-eyebrow", copy.eyebrow), el(doc, "div", "dtf-phrase", phrase), timeEl, close);
    return { card, close };
  }

  return { buildEyebrow, buildPhoto, buildPhrase, buildTollMeter, buildActions, buildGate, buildWarningCard };
});
