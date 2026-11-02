"use strict";

// Telling an animated WebP from a still. Animations saved from the web are often
// WebP, and one sent through the settings page's canvas freezes on the gate — so
// the chunk walk is tested against what real files do: odd sizes and their pad
// byte, payloads that spell chunk names, truncation, other RIFF formats.

const test = require("node:test");
const assert = require("node:assert/strict");

const { isWebp, frameCount, isAnimated } = require("../shared/webp.js");
const { WebpBytes, PngBytes } = require("./fakes/image-bytes.js");

const animatedWebp = (frames) => {
  const webp = new WebpBytes().extended({ animated: true }).loop();
  for (let i = 0; i < frames; i += 1) webp.frame();
  return webp.bytes();
};

// ----- isWebp -----

test("isWebp recognises a RIFF container holding a WebP", () => {
  assert.equal(isWebp(new WebpBytes().still().bytes()), true);
});

test("isWebp turns down other RIFF files, like a WAV", () => {
  assert.equal(isWebp(new WebpBytes({ form: "WAVE" }).chunk("fmt ", [0, 0]).bytes()), false);
});

test("isWebp turns down other formats and files too short to hold a chunk", () => {
  assert.equal(isWebp(new PngBytes().bytes()), false);
  assert.equal(isWebp(Uint8Array.from(Buffer.from("RIFF\0\0\0\0WEBP", "ascii"))), false);
});

// ----- frameCount -----

test("frameCount of a simple still WebP is one", () => {
  assert.equal(frameCount(new WebpBytes().still().bytes()), 1);
});

test("frameCount of an extended still WebP is one", () => {
  assert.equal(frameCount(new WebpBytes().extended({ animated: false }).still().bytes()), 1);
});

test("frameCount counts one per ANMF chunk", () => {
  assert.equal(frameCount(animatedWebp(3)), 3);
});

test("frameCount steps over the pad byte after an odd-sized chunk", () => {
  // Every frame here is odd-sized; missing one pad byte throws the walk off for
  // every chunk after it.
  assert.equal(frameCount(animatedWebp(5)), 5);
});

test("frameCount reads chunk names, not text that happens to spell one", () => {
  const webp = new WebpBytes().extended({ animated: false }).chunk("EXIF", [...Buffer.from("ANMFANMF", "ascii")]).still();
  assert.equal(frameCount(webp.bytes()), 1);
});

test("frameCount still counts the frames whose header arrived in a truncated file", () => {
  const whole = animatedWebp(3);
  assert.equal(frameCount(whole.subarray(0, whole.length - 10)), 3);
});

test("frameCount stops at a chunk size that runs past the end of the file", () => {
  const webp = new WebpBytes().extended({ animated: true }).frame().chunk("ANMF", []).bytes();
  // Corrupt the last chunk's size so it claims far more than the file holds.
  webp.set([0xff, 0xff, 0xff, 0x7f], webp.length - 4);
  assert.equal(frameCount(webp), 2);
});

test("frameCount of something that is not a WebP is zero", () => {
  assert.equal(frameCount(new PngBytes().bytes()), 0);
});

// ----- isAnimated -----

test("isAnimated is false for a one-frame animation, which loses nothing on the canvas", () => {
  assert.equal(isAnimated(animatedWebp(1)), false);
});

test("isAnimated is true from the second frame on", () => {
  assert.equal(isAnimated(animatedWebp(2)), true);
});
