// Reads a GIF's structure straight from its bytes, to tell an animated one from a
// still. The settings page needs to know before it touches the file: a still is
// downscaled to a JPEG through a canvas, and a canvas keeps only the first frame,
// so an animated GIF sent down that path would freeze on the gate. One of three
// sniffers, with shared/webp.js and shared/apng.js; shared/animation.js asks all
// three.
//
// Only the block structure is walked — header, colour tables, extensions, image
// descriptors — never the pixel data, so this stays a few hops per frame and needs
// no decoder. Spec: https://www.w3.org/Graphics/GIF/spec-gif89a.txt
//
// Dual export: attaches window.DTGif as a classic script; under Node (require)
// it returns the same API via module.exports.
(function (root, factory) {
  const api = factory(
    typeof module !== "undefined" && module.exports ? require("./bytes.js") : root.DTBytes
  );
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DTGif = api;
})(typeof self !== "undefined" ? self : this, function (DTBytes) {
  "use strict";

  const SIGNATURES = ["GIF87a", "GIF89a"];
  // Header (6) + logical screen descriptor (7).
  const SCREEN_END = 13;
  const IMAGE_SEPARATOR = 0x2c;
  const EXTENSION_INTRODUCER = 0x21;
  const TRAILER = 0x3b;
  // An image descriptor after its separator: left, top, width, height, packed.
  const DESCRIPTOR_BYTES = 9;

  /**
   * Does this file start with a GIF signature? Sniffed rather than trusted from
   * the file's MIME type, which comes from its extension and can be anything.
   *
   * @example
   *   isGif(new Uint8Array(await file.arrayBuffer()))  // true for GIF87a / GIF89a
   */
  function isGif(bytes) {
    DTBytes.requireBytes(bytes);
    if (bytes.length < SCREEN_END) return false;
    return SIGNATURES.includes(DTBytes.ascii(bytes, 0, 6));
  }

  // A packed field's colour table: present when the top bit is set, holding
  // 2^(n+1) RGB entries for the size n in its low three bits.
  function colorTableBytes(packed) {
    if ((packed & 0x80) === 0) return 0;
    return 3 * (1 << ((packed & 0x07) + 1));
  }

  // Data sub-blocks: a size byte, that many bytes, repeated until a size of zero.
  function skipSubBlocks(bytes, pos) {
    let at = pos;
    while (at < bytes.length) {
      const size = bytes[at];
      at += 1 + size;
      if (size === 0) return at;
    }
    return at;
  }

  // From just after an image separator: the descriptor, its local colour table,
  // the LZW minimum code size byte, then the image data's sub-blocks.
  function skipImage(bytes, pos) {
    const packed = bytes[pos + DESCRIPTOR_BYTES - 1];
    return skipSubBlocks(bytes, pos + DESCRIPTOR_BYTES + colorTableBytes(packed) + 1);
  }

  // Where the block starting at `pos` ends and whether it was a frame; null for a
  // byte no GIF block starts with. An extension is its introducer, a label byte,
  // then sub-blocks.
  function readBlock(bytes, pos) {
    const marker = bytes[pos];
    if (marker === IMAGE_SEPARATOR) return { frame: true, end: skipImage(bytes, pos + 1) };
    if (marker === EXTENSION_INTRODUCER) return { frame: false, end: skipSubBlocks(bytes, pos + 2) };
    return null;
  }

  /**
   * How many frames the GIF holds. Counting stops at the trailer, at the end of
   * a truncated file (browsers still play the frames that arrived), or at a byte
   * no GIF block starts with. Not a GIF at all: zero.
   *
   * @example
   *   frameCount(bytesOfASpinner)  // 12
   */
  function frameCount(bytes) {
    if (!isGif(bytes)) return 0;
    let pos = SCREEN_END + colorTableBytes(bytes[10]);
    let frames = 0;
    while (pos < bytes.length && bytes[pos] !== TRAILER) {
      const block = readBlock(bytes, pos);
      if (!block) break;
      if (block.frame) frames += 1;
      pos = block.end;
    }
    return frames;
  }

  /**
   * A GIF with more than one frame. Those are kept byte for byte; everything else
   * can go through the canvas without losing anything.
   *
   * @example
   *   if (isAnimated(bytes)) keepAsIs(file); else downscaleToJpeg(file);
   */
  function isAnimated(bytes) {
    return frameCount(bytes) > 1;
  }

  return { isGif, frameCount, isAnimated };
});
