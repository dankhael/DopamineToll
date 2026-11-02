"use strict";

// Telling an animated GIF from a still, from the bytes alone. Getting this wrong
// either freezes the user's GIF on the gate (an animated one sent through the
// canvas) or stores a still at full size for nothing — so the block walk is
// tested against the shapes real GIFs take: colour tables of every kind, loop and
// comment extensions, data that happens to contain marker bytes, truncation.

const test = require("node:test");
const assert = require("node:assert/strict");

const { isGif, frameCount, isAnimated } = require("../shared/gif.js");

// ----- a named builder for real GIF bytes -----

// Builds a well-formed GIF one block at a time. Each frame is a 1×1 image whose
// LZW data (02 02 44 01 00) is the classic minimal one browsers decode.
class GifBytes {
  constructor({ signature = "GIF89a", globalTable = true } = {}) {
    this.parts = [...Buffer.from(signature, "ascii")];
    // 1×1 screen; packed: global table flag + size 0 (two colours, six bytes).
    this.parts.push(1, 0, 1, 0, globalTable ? 0x80 : 0x00, 0, 0);
    if (globalTable) this.parts.push(0, 0, 0, 255, 255, 255);
  }

  loop() {
    this.parts.push(0x21, 0xff, 0x0b, ...Buffer.from("NETSCAPE2.0", "ascii"), 0x03, 0x01, 0, 0, 0x00);
    return this;
  }

  comment(text) {
    const body = [...Buffer.from(text, "ascii")];
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

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49]);

// ----- isGif -----

test("isGif recognises both GIF signatures", () => {
  assert.equal(isGif(new GifBytes({ signature: "GIF89a" }).frame().bytes()), true);
  assert.equal(isGif(new GifBytes({ signature: "GIF87a" }).frame().bytes()), true);
});

test("isGif turns down other formats and files too short to hold a GIF header", () => {
  assert.equal(isGif(PNG_SIGNATURE), false);
  assert.equal(isGif(Uint8Array.from(Buffer.from("GIF89a", "ascii"))), false);
});

test("isGif names what it was given instead of the bytes it wanted", () => {
  assert.throws(() => isGif("GIF89a"), /Uint8Array, got: \[object String\]/);
  assert.throws(() => isGif(new ArrayBuffer(16)), /got: \[object ArrayBuffer\]/);
});

// ----- frameCount -----

test("frameCount counts one image as one frame", () => {
  assert.equal(frameCount(new GifBytes().frame().bytes()), 1);
});

test("frameCount counts every frame of a looping animation", () => {
  const gif = new GifBytes().loop().frame().frame().frame().bytes();
  assert.equal(frameCount(gif), 3);
});

test("frameCount steps over comment extensions between frames", () => {
  const gif = new GifBytes().frame().comment("made with love").frame().bytes();
  assert.equal(frameCount(gif), 2);
});

test("frameCount skips local colour tables, even ones full of separator bytes", () => {
  // The fake table is all 0x2C — an image separator. Miscounting its length
  // would land the walk inside it and count phantom frames.
  const gif = new GifBytes().frame({ localTable: true }).frame({ localTable: true }).bytes();
  assert.equal(frameCount(gif), 2);
});

test("frameCount walks a GIF with no global colour table", () => {
  const gif = new GifBytes({ globalTable: false }).frame({ localTable: true }).frame().bytes();
  assert.equal(frameCount(gif), 2);
});

test("frameCount is not fooled by image data that contains marker bytes", () => {
  const data = [0x2c, 0x21, 0x3b, 0x2c];
  const gif = new GifBytes().frame({ data }).frame({ data }).bytes();
  assert.equal(frameCount(gif), 2);
});

test("frameCount still counts the frames of a truncated file", () => {
  // Browsers play the frames that arrived, so a cut-off upload still animates.
  const whole = new GifBytes().frame().frame().frame().bytes({ trailer: false });
  assert.equal(frameCount(whole.subarray(0, whole.length - 4)), 3);
});

test("frameCount stops at a byte no GIF block starts with, keeping what it found", () => {
  const gif = new GifBytes().frame().bytes({ trailer: false });
  const corrupt = Uint8Array.from([...gif, 0x99, 0x2c, 0, 0]);
  assert.equal(frameCount(corrupt), 1);
});

test("frameCount of something that is not a GIF is zero", () => {
  assert.equal(frameCount(PNG_SIGNATURE), 0);
});

// ----- isAnimated -----

test("isAnimated is false for a single-frame GIF, which can go through the canvas", () => {
  assert.equal(isAnimated(new GifBytes().loop().frame().bytes()), false);
});

test("isAnimated is true from the second frame on", () => {
  assert.equal(isAnimated(new GifBytes().frame().frame().bytes()), true);
});

test("isAnimated is false for anything that is not a GIF", () => {
  assert.equal(isAnimated(PNG_SIGNATURE), false);
});
