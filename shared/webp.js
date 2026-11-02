// Reads a WebP's chunk list straight from its bytes, to tell an animated one from
// a still: sites like Giphy and Tenor often serve animations as WebP, so a "GIF"
// saved from the web is frequently a .webp, and the canvas the settings page
// downscales stills through would freeze it. One of three sniffers, with
// shared/gif.js and shared/apng.js; shared/animation.js asks all three.
//
// A WebP is a RIFF container: "RIFF", a size, "WEBP", then chunks, each a
// four-letter name, a little-endian size, the payload and a pad byte when the size
// is odd. An animation holds one ANMF chunk per frame. Only chunk headers are
// read, never pixel data. Spec: https://developers.google.com/speed/webp/docs/riff_container
//
// Dual export: attaches window.DTWebp as a classic script; under Node (require)
// it returns the same API via module.exports.
(function (root, factory) {
  const api = factory(
    typeof module !== "undefined" && module.exports ? require("./bytes.js") : root.DTBytes
  );
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DTWebp = api;
})(typeof self !== "undefined" ? self : this, function (DTBytes) {
  "use strict";

  // "RIFF", the file size, "WEBP".
  const RIFF_HEADER = 12;
  // A chunk's name and size.
  const CHUNK_HEADER = 8;

  /**
   * Does this file start like a WebP? Sniffed rather than trusted from the file's
   * MIME type, which comes from its extension.
   *
   * @example
   *   isWebp(new Uint8Array(await file.arrayBuffer()))  // true for RIFF…WEBP
   */
  function isWebp(bytes) {
    DTBytes.requireBytes(bytes);
    if (bytes.length < RIFF_HEADER + CHUNK_HEADER) return false;
    return DTBytes.ascii(bytes, 0, 4) === "RIFF" && DTBytes.ascii(bytes, 8, 4) === "WEBP";
  }

  // Where the chunk starting at `pos` ends, its odd-size pad byte included. A
  // corrupt size jumps past the end of the file, which ends the walk.
  function chunkEnd(bytes, pos) {
    const size = DTBytes.uint32LE(bytes, pos + 4);
    return pos + CHUNK_HEADER + size + (size & 1);
  }

  /**
   * How many frames the WebP holds: one per ANMF chunk, or 1 for a still, which
   * has none. Counting the frames rather than trusting VP8X's animation flag
   * keeps a one-frame "animation" on the still path, where nothing is lost. Not
   * a WebP at all: zero.
   *
   * @example
   *   frameCount(bytesOfAnAnimatedSticker)  // 24
   */
  function frameCount(bytes) {
    if (!isWebp(bytes)) return 0;
    let frames = 0;
    for (let pos = RIFF_HEADER; pos + CHUNK_HEADER <= bytes.length; pos = chunkEnd(bytes, pos)) {
      if (DTBytes.ascii(bytes, pos, 4) === "ANMF") frames += 1;
    }
    return Math.max(frames, 1);
  }

  /**
   * A WebP with more than one frame, which has to be kept byte for byte.
   *
   * @example
   *   if (isAnimated(bytes)) keepAsIs(file); else downscaleToJpeg(file);
   */
  function isAnimated(bytes) {
    return frameCount(bytes) > 1;
  }

  return { isWebp, frameCount, isAnimated };
});
