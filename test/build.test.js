"use strict";

// The packager writes the ZIP byte by byte with no library behind it, and its
// output is what gets uploaded to two stores. A subtly malformed archive is the
// worst failure mode here: it either bounces at submission or, worse, unpacks
// wrong on someone else's machine. These tests read the bytes back and assert the
// container structure directly rather than trusting a successful write.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");

const build = require("../build.mjs");

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const END_SIG = 0x06054b50;

// ----- named fake: a throwaway project tree on disk -----
// The packager is filesystem I/O by nature, so rather than stub `fs` we give it a
// real but disposable tree with a known shape.
class FakeProjectTree {
  constructor(files) {
    this.root = fs.mkdtempSync(path.join(os.tmpdir(), "dt-build-"));
    for (const [relative, contents] of Object.entries(files)) {
      const absolute = path.join(this.root, relative);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, contents);
    }
  }

  path(relative) {
    return path.join(this.root, relative);
  }

  cleanup() {
    fs.rmSync(this.root, { recursive: true, force: true });
  }
}

function standardTree(overrides = {}) {
  return new FakeProjectTree({
    "build-manifest.json": JSON.stringify({ include: ["manifest.json", "shared"] }),
    "manifest.json": JSON.stringify({ version: "9.9.9" }),
    "shared/a.js": "console.log('a');\n".repeat(40),
    "shared/nested/b.css": "body { color: red; }",
    ...overrides
  });
}

// ----- a minimal independent ZIP reader, so the tests don't reuse the writer -----

function readEndOfCentralDirectory(zip) {
  const offset = zip.length - 22;
  assert.equal(zip.readUInt32LE(offset), END_SIG, "end-of-central-directory signature missing");
  return {
    count: zip.readUInt16LE(offset + 10),
    directorySize: zip.readUInt32LE(offset + 12),
    directoryOffset: zip.readUInt32LE(offset + 16)
  };
}

function readCentralDirectory(zip) {
  const { count, directoryOffset } = readEndOfCentralDirectory(zip);
  const entries = [];
  let cursor = directoryOffset;
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(cursor), CENTRAL_SIG, `central header ${i} signature missing`);
    const nameLength = zip.readUInt16LE(cursor + 28);
    entries.push({
      method: zip.readUInt16LE(cursor + 10),
      crc: zip.readUInt32LE(cursor + 16),
      compressedSize: zip.readUInt32LE(cursor + 20),
      uncompressedSize: zip.readUInt32LE(cursor + 24),
      localOffset: zip.readUInt32LE(cursor + 42),
      name: zip.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8")
    });
    cursor += 46 + nameLength;
  }
  return entries;
}

// Follow the central directory's offset into the local header and inflate.
function extract(zip, entry) {
  assert.equal(zip.readUInt32LE(entry.localOffset), LOCAL_SIG, `local header for ${entry.name} missing`);
  const nameLength = zip.readUInt16LE(entry.localOffset + 26);
  const extraLength = zip.readUInt16LE(entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const body = zip.subarray(start, start + entry.compressedSize);
  return entry.method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body);
}

// ----- readIncludeList -----

test("readIncludeList returns the include array", () => {
  const tree = standardTree();
  try {
    assert.deepEqual(build.readIncludeList(tree.root), ["manifest.json", "shared"]);
  } finally {
    tree.cleanup();
  }
});

test("readIncludeList rejects a missing or empty include list", () => {
  const tree = standardTree({ "build-manifest.json": JSON.stringify({ include: [] }) });
  try {
    assert.throws(() => build.readIncludeList(tree.root), /non-empty "include" array/);
  } finally {
    tree.cleanup();
  }
});

// ----- walkDirectory / collectFiles -----

test("walkDirectory finds files at every depth", () => {
  const tree = standardTree();
  try {
    const found = build.walkDirectory(tree.path("shared")).map((f) => path.basename(f)).sort();
    assert.deepEqual(found, ["a.js", "b.css"]);
  } finally {
    tree.cleanup();
  }
});

test("collectFiles expands directories and keeps single files", () => {
  const tree = standardTree();
  try {
    const files = build.collectFiles(["manifest.json", "shared"], tree.root);
    const names = files.map((f) => path.relative(tree.root, f)).sort();
    assert.deepEqual(names, ["manifest.json", "shared/a.js", "shared/nested/b.css"]);
  } finally {
    tree.cleanup();
  }
});

test("collectFiles names the missing entry when a path is gone", () => {
  const tree = standardTree();
  try {
    assert.throws(
      () => build.collectFiles(["manifest.json", "does-not-exist"], tree.root),
      /lists 'does-not-exist'/,
      "the error must name the offending value so a rename is diagnosable"
    );
  } finally {
    tree.cleanup();
  }
});

// ----- readVersion -----

test("readVersion reads the manifest version", () => {
  const tree = standardTree();
  try {
    assert.equal(build.readVersion(tree.root), "9.9.9");
  } finally {
    tree.cleanup();
  }
});

test("readVersion rejects a manifest with no version", () => {
  const tree = standardTree({ "manifest.json": JSON.stringify({ name: "x" }) });
  try {
    assert.throws(() => build.readVersion(tree.root), /missing a 'version' field/);
  } finally {
    tree.cleanup();
  }
});

// ----- buildEntry -----

test("buildEntry deflates compressible content and records the real CRC", () => {
  const tree = standardTree();
  try {
    const entry = build.buildEntry(tree.path("shared/a.js"), tree.root);
    const raw = fs.readFileSync(tree.path("shared/a.js"));
    assert.equal(entry.name, "shared/a.js");
    assert.equal(entry.method, 8, "highly repetitive JS must compress");
    assert.equal(entry.size, raw.length);
    assert.equal(entry.crc, zlib.crc32(raw));
    assert.deepEqual(zlib.inflateRawSync(entry.body), raw);
  } finally {
    tree.cleanup();
  }
});

test("buildEntry stores content verbatim when deflate would grow it", () => {
  // Random bytes stand in for the already-compressed PNGs in assets/.
  const incompressible = require("node:crypto").randomBytes(4096);
  const tree = standardTree({ "shared/noise.bin": incompressible });
  try {
    const entry = build.buildEntry(tree.path("shared/noise.bin"), tree.root);
    assert.equal(entry.method, 0, "storing must win when deflate loses");
    assert.deepEqual(entry.body, incompressible);
  } finally {
    tree.cleanup();
  }
});

test("buildEntry always emits forward slashes", () => {
  const tree = standardTree();
  try {
    const entry = build.buildEntry(tree.path("shared/nested/b.css"), tree.root);
    // Windows would otherwise produce "shared\nested\b.css", which unpacks as one
    // literal filename on macOS and Linux.
    assert.equal(entry.name, "shared/nested/b.css");
    assert.ok(!entry.name.includes("\\"));
  } finally {
    tree.cleanup();
  }
});

// ----- headers -----

test("localHeader and centralHeader agree on name, sizes and CRC", () => {
  const entry = { name: "a/b.js", body: Buffer.from("xy"), method: 8, crc: 0x12345678, size: 99 };
  const local = build.localHeader(entry);
  const central = build.centralHeader(entry, 4242);

  assert.equal(local.readUInt32LE(0), LOCAL_SIG);
  assert.equal(central.readUInt32LE(0), CENTRAL_SIG);
  assert.equal(local.readUInt32LE(14), entry.crc);
  assert.equal(central.readUInt32LE(16), entry.crc);
  assert.equal(local.readUInt32LE(18), entry.body.length);
  assert.equal(central.readUInt32LE(20), entry.body.length);
  assert.equal(local.readUInt32LE(22), entry.size);
  assert.equal(central.readUInt32LE(24), entry.size);
  assert.equal(central.readUInt32LE(42), 4242, "central header must carry the local offset");
});

test("headers set the UTF-8 filename flag", () => {
  const entry = { name: "配置.js", body: Buffer.from("x"), method: 0, crc: 1, size: 1 };
  // Without bit 11 set, non-ASCII names are read as CP437 and mojibake.
  assert.equal(build.localHeader(entry).readUInt16LE(6) & 0x0800, 0x0800);
  assert.equal(build.centralHeader(entry).readUInt16LE(8) & 0x0800, 0x0800);
});

test("endOfCentralDirectory records the entry count twice and the directory extent", () => {
  const end = build.endOfCentralDirectory(7, 350, 900);
  assert.equal(end.readUInt32LE(0), END_SIG);
  assert.equal(end.readUInt16LE(8), 7, "entries on this disk");
  assert.equal(end.readUInt16LE(10), 7, "entries total");
  assert.equal(end.readUInt32LE(12), 350);
  assert.equal(end.readUInt32LE(16), 900);
});

// ----- packZip: the whole container -----

test("packZip round-trips every file's exact bytes", () => {
  const tree = standardTree();
  try {
    const files = build.collectFiles(build.readIncludeList(tree.root), tree.root);
    const zip = build.packZip(files.map((f) => build.buildEntry(f, tree.root)));
    const entries = readCentralDirectory(zip);

    assert.equal(entries.length, 3);
    for (const entry of entries) {
      const original = fs.readFileSync(path.join(tree.root, entry.name));
      assert.deepEqual(extract(zip, entry), original, `${entry.name} did not survive the round trip`);
      assert.equal(entry.crc, zlib.crc32(original), `${entry.name} has a wrong CRC`);
      assert.equal(entry.uncompressedSize, original.length);
    }
  } finally {
    tree.cleanup();
  }
});

test("packZip local offsets point at real local headers", () => {
  const tree = standardTree();
  try {
    const files = build.collectFiles(build.readIncludeList(tree.root), tree.root);
    const zip = build.packZip(files.map((f) => build.buildEntry(f, tree.root)));
    for (const entry of readCentralDirectory(zip)) {
      assert.equal(zip.readUInt32LE(entry.localOffset), LOCAL_SIG, `${entry.name} offset is wrong`);
    }
  } finally {
    tree.cleanup();
  }
});

test("packZip writes a valid empty archive", () => {
  const zip = build.packZip([]);
  assert.equal(zip.length, 22, "an empty ZIP is just the end-of-central-directory record");
  assert.deepEqual(readEndOfCentralDirectory(zip), { count: 0, directorySize: 0, directoryOffset: 0 });
});

test("packZip is deterministic — same input, byte-identical output", () => {
  const tree = standardTree();
  try {
    const files = build.collectFiles(build.readIncludeList(tree.root), tree.root);
    const first = build.packZip(files.map((f) => build.buildEntry(f, tree.root)));
    const second = build.packZip(files.map((f) => build.buildEntry(f, tree.root)));
    // The fixed DOS timestamp exists for this: a changing mtime would make every
    // build look different to the stores' diffing tools.
    assert.deepEqual(first, second);
  } finally {
    tree.cleanup();
  }
});

// ----- main -----

test("main writes a versioned archive containing every included file", () => {
  const tree = standardTree();
  try {
    build.main(tree.root);
    const output = tree.path("web-ext-artifacts/dopamine-toll-9.9.9.zip");
    assert.ok(fs.existsSync(output), "archive named from the manifest version");
    const names = readCentralDirectory(fs.readFileSync(output)).map((e) => e.name).sort();
    assert.deepEqual(names, ["manifest.json", "shared/a.js", "shared/nested/b.css"]);
  } finally {
    tree.cleanup();
  }
});

test("main maps over files without leaking the array index into the root", () => {
  // Regression: `files.map(buildEntry)` passed the index as buildEntry's `root`,
  // which crashed path.relative with a number.
  const tree = standardTree();
  try {
    build.main(tree.root);
    const zip = fs.readFileSync(tree.path("web-ext-artifacts/dopamine-toll-9.9.9.zip"));
    for (const entry of readCentralDirectory(zip)) {
      assert.ok(!path.isAbsolute(entry.name), `${entry.name} must be repo-relative`);
    }
  } finally {
    tree.cleanup();
  }
});
