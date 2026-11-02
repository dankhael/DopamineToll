// Is this upload an animation, and in which format? Asks each sniffer in turn —
// shared/gif.js, shared/webp.js, shared/apng.js — and answers with the MIME type
// the file has to be stored under to keep playing. The settings page sends
// anything else through its canvas, which keeps only a first frame (ADR-0005).
//
// Dual export: attaches window.DTAnimation as a classic script; under Node
// (require) it returns the same API via module.exports.
(function (root, factory) {
  const node = typeof module !== "undefined" && module.exports;
  const api = node
    ? factory(require("./gif.js"), require("./webp.js"), require("./apng.js"))
    : factory(root.DTGif, root.DTWebp, root.DTApng);
  if (node) module.exports = api;
  else root.DTAnimation = api;
})(typeof self !== "undefined" ? self : this, function (DTGif, DTWebp, DTApng) {
  "use strict";

  // Each format, and the type its data: URL is stored under. The type comes from
  // here, never from the file's own MIME type, which only reflects its extension.
  const FORMATS = [
    { mime: "image/gif", isAnimated: DTGif.isAnimated },
    { mime: "image/webp", isAnimated: DTWebp.isAnimated },
    { mime: "image/png", isAnimated: DTApng.isAnimated }
  ];

  /**
   * The MIME type to keep an animated image under, or null for a still — or for a
   * format none of the sniffers reads — which is safe to downscale.
   *
   * @example
   *   animatedType(bytesOfAGiphyDownload)  // "image/webp"
   *   animatedType(bytesOfAPhoto)          // null
   */
  function animatedType(bytes) {
    const match = FORMATS.find((format) => format.isAnimated(bytes));
    return match ? match.mime : null;
  }

  return { animatedType };
});
