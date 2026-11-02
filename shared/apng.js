// Reads a PNG's chunk list straight from its bytes, to tell an animated PNG (APNG)
// from a still one. An APNG is a valid PNG, so it decodes on the settings page's
// canvas without complaint, and loses every frame but the first. One of three
// sniffers, with shared/gif.js and shared/webp.js; shared/animation.js asks all
// three.
//
// After the 8-byte signature, a PNG is chunks: a big-endian data length, a
// four-letter type, the data, a CRC. An APNG declares its frame count in an acTL
// chunk, which the spec requires before the first IDAT (image data), so the walk
// stops at whichever comes first. Spec: https://www.w3.org/TR/png-3/#apng-frame-based-animation
//
// Dual export: attaches window.DTApng as a classic script; under Node (require)
// it returns the same API via module.exports.
(function (root, factory) {
  const api = factory(
    typeof module !== "undefined" && module.exports ? require("./bytes.js") : root.DTBytes
  );
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DTApng = api;
})(typeof self !== "undefined" ? self : this, function (DTBytes) {
  "use strict";

  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  // A chunk's length and type; the CRC follows its data.
  const CHUNK_HEADER = 8;
  const CRC_BYTES = 4;

  /**
   * Does this file start with the PNG signature? Sniffed rather than trusted from
   * the file's MIME type, which comes from its extension.
   *
   * @example
   *   isPng(new Uint8Array(await file.arrayBuffer()))  // true for any PNG or APNG
   */
  function isPng(bytes) {
    DTBytes.requireBytes(bytes);
    return bytes.length >= SIGNATURE.length && SIGNATURE.every((byte, i) => bytes[i] === byte);
  }

  /**
   * How many frames the PNG declares: acTL's num_frames for an APNG, 1 for a plain
   * PNG. An acTL that comes after the image data is not an APNG by the spec, and
   * browsers show it still, so it counts as 1 too. Not a PNG at all: zero.
   *
   * @example
   *   frameCount(bytesOfALoadingSpinner)  // 8
   */
  function frameCount(bytes) {
    if (!isPng(bytes)) return 0;
    let pos = SIGNATURE.length;
    while (pos + CHUNK_HEADER <= bytes.length) {
      const type = DTBytes.ascii(bytes, pos + 4, 4);
      if (type === "acTL") return DTBytes.uint32BE(bytes, pos + CHUNK_HEADER);
      if (type === "IDAT") return 1;
      pos += CHUNK_HEADER + DTBytes.uint32BE(bytes, pos) + CRC_BYTES;
    }
    return 1;
  }

  /**
   * A PNG that declares more than one frame, which has to be kept byte for byte.
   *
   * @example
   *   if (isAnimated(bytes)) keepAsIs(file); else downscaleToJpeg(file);
   */
  function isAnimated(bytes) {
    return frameCount(bytes) > 1;
  }

  return { isPng, frameCount, isAnimated };
});
