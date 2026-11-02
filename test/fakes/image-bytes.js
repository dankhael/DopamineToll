"use strict";

// Named builders for real image bytes, one block or chunk at a time, for the
// format sniffers' tests (shared/gif.js, shared/webp.js, shared/apng.js and
// shared/animation.js). Each lays out the container exactly as its spec does —
// signatures, sizes, padding — so the sniffers are tested against the structure
// they will meet, and each makes it easy to plant the traps a naive scan falls
// into: marker bytes inside payloads, odd sizes, truncation.
//
// Lives under test/fakes/, outside the `*.test.js` glob in package.json, so the
// runner loads it only when a test requires it.

const u32LE = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const u32BE = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const asciiBytes = (text) => [...Buffer.from(text, "ascii")];

// Builds a well-formed GIF one block at a time. Each frame is a 1×1 image whose
// LZW data (02 02 44 01 00) is the classic minimal one browsers decode.
class GifBytes {
  constructor({ signature = "GIF89a", globalTable = true } = {}) {
    this.parts = asciiBytes(signature);
    // 1×1 screen; packed: global table flag + size 0 (two colours, six bytes).
    this.parts.push(1, 0, 1, 0, globalTable ? 0x80 : 0x00, 0, 0);
    if (globalTable) this.parts.push(0, 0, 0, 255, 255, 255);
  }

  loop() {
    this.parts.push(0x21, 0xff, 0x0b, ...asciiBytes("NETSCAPE2.0"), 0x03, 0x01, 0, 0, 0x00);
    return this;
  }

  comment(text) {
    const body = asciiBytes(text);
    this.parts.push(0x21, 0xfe, body.length, ...body, 0x00);
    return this;
  }

  // A graphic control extension (10/100 s delay) and one image.
  frame({ localTable = false, data = [0x44, 0x01] } = {}) {
    this.parts.push(0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00);
    this.parts.push(0x2c, 0, 0, 0, 0, 1, 0, 1, 0, localTable ? 0x81 : 0x00);
    if (localTable) this.parts.push(...new Array(12).fill(0x2c));
    this.parts.push(0x02, data.length, ...data, 0x00);
    return this;
  }

  bytes({ trailer = true } = {}) {
    return Uint8Array.from(trailer ? [...this.parts, 0x3b] : this.parts);
  }
}

// Builds a RIFF WebP: "RIFF", size, "WEBP", then chunks of name + little-endian
// size + payload + a pad byte when the size is odd.
class WebpBytes {
  constructor({ form = "WEBP" } = {}) {
    this.form = form;
    this.chunks = [];
  }

  chunk(name, payload) {
    this.chunks.push([...asciiBytes(name), ...u32LE(payload.length), ...payload]);
    if (payload.length % 2 === 1) this.chunks[this.chunks.length - 1].push(0);
    return this;
  }

  // The extended header; flag 0x02 is "animation".
  extended({ animated }) {
    return this.chunk("VP8X", [animated ? 0x02 : 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  }

  // A lossy still image's chunk, payload stubbed.
  still() {
    return this.chunk("VP8 ", [0x9d, 0x01, 0x2a, 1, 0, 1, 0]);
  }

  loop() {
    return this.chunk("ANIM", [0, 0, 0, 0, 0, 0]);
  }

  // One animation frame. The default payload is odd-sized, so padding is always
  // exercised, and spells "ANMF" inside, so a byte scan would double-count it.
  frame(payload = [...asciiBytes("ANMF"), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) {
    return this.chunk("ANMF", payload);
  }

  bytes() {
    const body = [...asciiBytes(this.form), ...this.chunks.flat()];
    return Uint8Array.from([...asciiBytes("RIFF"), ...u32LE(body.length), ...body]);
  }
}

// Builds a PNG: the signature, then chunks of big-endian length + type + data +
// CRC. The CRC is left as zeros, since no sniffer here reads it.
class PngBytes {
  constructor() {
    this.chunks = [];
    this.chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  }

  chunk(type, data) {
    this.chunks.push([...u32BE(data.length), ...asciiBytes(type), ...data, 0, 0, 0, 0]);
    return this;
  }

  // The animation control chunk: frame count, then play count (0 = forever).
  animation(frames) {
    return this.chunk("acTL", [...u32BE(frames), ...u32BE(0)]);
  }

  // A text chunk whose data spells "acTL", for a scan that reads data as chunks.
  text(content = "acTL\u0000\u0000\u0000\u0009") {
    return this.chunk("tEXt", asciiBytes(content));
  }

  imageData() {
    return this.chunk("IDAT", [0x78, 0x9c, 0x63, 0x00, 0x00]);
  }

  end() {
    return this.chunk("IEND", []);
  }

  bytes() {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return Uint8Array.from([...signature, ...this.chunks.flat()]);
  }
}

// The first bytes of a JPEG: a format none of the sniffers reads.
const JPEG_START = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);

module.exports = { GifBytes, WebpBytes, PngBytes, JPEG_START };
