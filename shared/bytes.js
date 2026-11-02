// Reading fixed-size fields out of a file's bytes, for the format sniffers in
// shared/gif.js, shared/webp.js and shared/apng.js. Every read is bounds-checked
// by the caller's loop, never here: a field that runs past the end reads as
// undefined bytes, which the sniffers treat as "the file stops here".
//
// Dual export: attaches window.DTBytes as a classic script; under Node (require)
// it returns the same API via module.exports.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DTBytes = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * Refuse anything but a Uint8Array, naming what arrived — an ArrayBuffer or a
   * string here means the caller forgot to wrap the file's bytes.
   *
   * @example
   *   requireBytes(new Uint8Array(await file.arrayBuffer()))
   */
  function requireBytes(bytes) {
    if (!(bytes instanceof Uint8Array)) {
      throw new Error(`expected the file's bytes as a Uint8Array, got: ${Object.prototype.toString.call(bytes)}`);
    }
  }

  /**
   * `length` bytes from `start` as ASCII text — signatures and chunk names.
   *
   * @example
   *   ascii(bytes, 8, 4)  // "WEBP" in a WebP file
   */
  function ascii(bytes, start, length) {
    return String.fromCharCode(...bytes.subarray(start, start + length));
  }

  /**
   * An unsigned 32-bit integer, little-endian (RIFF, so WebP).
   *
   * @example
   *   uint32LE(Uint8Array.from([1, 0, 0, 0]), 0)  // 1
   */
  function uint32LE(bytes, at) {
    return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
  }

  /**
   * An unsigned 32-bit integer, big-endian (PNG).
   *
   * @example
   *   uint32BE(Uint8Array.from([0, 0, 0, 1]), 0)  // 1
   */
  function uint32BE(bytes, at) {
    return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
  }

  return { requireBytes, ascii, uint32LE, uint32BE };
});
