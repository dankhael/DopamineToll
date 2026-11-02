"use strict";

// The field readers every format sniffer leans on. A sign or byte-order slip here
// would misread every WebP or PNG chunk size at once, so each is pinned.

const test = require("node:test");
const assert = require("node:assert/strict");

const { requireBytes, ascii, uint32LE, uint32BE } = require("../shared/bytes.js");

test("requireBytes lets a Uint8Array through", () => {
  requireBytes(new Uint8Array(4));
});

test("requireBytes names what it got when it is not the file's bytes", () => {
  assert.throws(() => requireBytes(new ArrayBuffer(4)), /Uint8Array, got: \[object ArrayBuffer\]/);
  assert.throws(() => requireBytes([1, 2, 3]), /got: \[object Array\]/);
});

test("ascii reads a run of bytes as text", () => {
  const bytes = Uint8Array.from(Buffer.from("RIFF....WEBP", "ascii"));
  assert.equal(ascii(bytes, 8, 4), "WEBP");
});

test("uint32LE reads little-endian, least significant byte first", () => {
  assert.equal(uint32LE(Uint8Array.from([0x78, 0x56, 0x34, 0x12]), 0), 0x12345678);
});

test("uint32BE reads big-endian, most significant byte first", () => {
  assert.equal(uint32BE(Uint8Array.from([0, 0x12, 0x34, 0x56, 0x78]), 1), 0x12345678);
});

test("both read the top bit as part of the number, never as a sign", () => {
  const max = Uint8Array.from([0xff, 0xff, 0xff, 0xff]);
  assert.equal(uint32LE(max, 0), 4294967295);
  assert.equal(uint32BE(max, 0), 4294967295);
});
