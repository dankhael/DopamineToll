"use strict";

// Telling an animated PNG from a still one. An APNG decodes on the settings page's
// canvas like any PNG and silently loses every frame but the first, so the chunk
// walk is tested against the rules browsers apply: acTL counts only before the
// image data, and only chunk types are read, never their data.

const test = require("node:test");
const assert = require("node:assert/strict");

const { isPng, frameCount, isAnimated } = require("../shared/apng.js");
const { PngBytes, WebpBytes } = require("./fakes/image-bytes.js");

// ----- isPng -----

test("isPng recognises the PNG signature", () => {
  assert.equal(isPng(new PngBytes().imageData().end().bytes()), true);
});

test("isPng turns down other formats and anything shorter than the signature", () => {
  assert.equal(isPng(new WebpBytes().still().bytes()), false);
  assert.equal(isPng(Uint8Array.from([0x89, 0x50, 0x4e, 0x47])), false);
});

// ----- frameCount -----

test("frameCount of a plain PNG is one", () => {
  assert.equal(frameCount(new PngBytes().imageData().end().bytes()), 1);
});

test("frameCount of an APNG is the frame count its acTL declares", () => {
  assert.equal(frameCount(new PngBytes().animation(8).imageData().end().bytes()), 8);
});

test("frameCount ignores an acTL that comes after the image data, as browsers do", () => {
  assert.equal(frameCount(new PngBytes().imageData().animation(8).end().bytes()), 1);
});

test("frameCount reads chunk types, not data that happens to spell acTL", () => {
  assert.equal(frameCount(new PngBytes().text().imageData().end().bytes()), 1);
});

test("frameCount finds an acTL behind other chunks", () => {
  const png = new PngBytes().text("Software\u0000ffmpeg").animation(12).imageData().end();
  assert.equal(frameCount(png.bytes()), 12);
});

test("frameCount of a PNG cut off before its image data is one", () => {
  assert.equal(frameCount(new PngBytes().bytes()), 1);
});

test("frameCount of something that is not a PNG is zero", () => {
  assert.equal(frameCount(new WebpBytes().still().bytes()), 0);
});

// ----- isAnimated -----

test("isAnimated is false for an APNG that declares a single frame", () => {
  assert.equal(isAnimated(new PngBytes().animation(1).imageData().end().bytes()), false);
});

test("isAnimated is true for an APNG with two frames or more", () => {
  assert.equal(isAnimated(new PngBytes().animation(2).imageData().end().bytes()), true);
});

test("isAnimated is false for a plain PNG", () => {
  assert.equal(isAnimated(new PngBytes().imageData().end().bytes()), false);
});
