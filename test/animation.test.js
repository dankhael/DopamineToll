"use strict";

// Which MIME type an upload is kept under. The answer decides whether a north star
// keeps moving: an animation stored under the wrong type, or sent down the still
// path, freezes on the gate. The type comes from the bytes, never the file name.

const test = require("node:test");
const assert = require("node:assert/strict");

const { animatedType } = require("../shared/animation.js");
const { GifBytes, WebpBytes, PngBytes, JPEG_START } = require("./fakes/image-bytes.js");

test("an animated GIF is kept as image/gif", () => {
  assert.equal(animatedType(new GifBytes().frame().frame().bytes()), "image/gif");
});

test("an animated WebP is kept as image/webp", () => {
  const webp = new WebpBytes().extended({ animated: true }).loop().frame().frame().bytes();
  assert.equal(animatedType(webp), "image/webp");
});

test("an animated PNG is kept as image/png", () => {
  assert.equal(animatedType(new PngBytes().animation(4).imageData().end().bytes()), "image/png");
});

test("a still in any of the three formats goes down the still path", () => {
  assert.equal(animatedType(new GifBytes().frame().bytes()), null);
  assert.equal(animatedType(new WebpBytes().still().bytes()), null);
  assert.equal(animatedType(new PngBytes().imageData().end().bytes()), null);
});

test("a format none of the sniffers reads goes down the still path", () => {
  assert.equal(animatedType(JPEG_START), null);
});

test("animatedType names what it got when it is not the file's bytes", () => {
  assert.throws(() => animatedType(new ArrayBuffer(8)), /Uint8Array, got: \[object ArrayBuffer\]/);
});
