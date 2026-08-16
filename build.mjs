// Build the store-ready ZIP containing only the files a browser actually loads.
// The same archive goes to both the Chrome Web Store and addons.mozilla.org —
// there is one manifest for both browsers (see docs/adr/0001).
//
// The file list lives in build-manifest.json so this script and package.ps1
// (the Windows packager) cannot drift apart.
//
// Usage:  node build.mjs   ->  web-ext-artifacts/dopamine-toll-<version>.zip

import { deflateRawSync, crc32 } from "node:zlib";
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

// Fixed DOS timestamp (1980-01-01) so the same sources always produce a
// byte-identical archive — a changing mtime would otherwise make every build
// look different to the stores' diffing tools.
const DOS_EPOCH = { time: 0, date: 0x0021 };

function readIncludeList(root = ROOT) {
  const path = join(root, "build-manifest.json");
  const { include } = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(include) || include.length === 0) {
    throw new Error(`build-manifest.json: expected a non-empty "include" array, got ${JSON.stringify(include)}`);
  }
  return include;
}

function walkDirectory(absolute) {
  const found = [];
  for (const name of readdirSync(absolute)) {
    const child = join(absolute, name);
    if (statSync(child).isDirectory()) found.push(...walkDirectory(child));
    else found.push(child);
  }
  return found;
}

// Expand each top-level include into absolute file paths, failing loudly when an
// entry is missing so a rename can't silently ship an incomplete package.
function collectFiles(include, root = ROOT) {
  const files = [];
  for (const entry of include) {
    const absolute = join(root, entry);
    let stats;
    try {
      stats = statSync(absolute);
    } catch {
      throw new Error(`build-manifest.json lists '${entry}', but nothing exists at '${absolute}'`);
    }
    files.push(...(stats.isDirectory() ? walkDirectory(absolute) : [absolute]));
  }
  return files.sort();
}

function readVersion(root = ROOT) {
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  if (!manifest.version) throw new Error("manifest.json is missing a 'version' field");
  return manifest.version;
}

// One archive member: the deflated bytes plus everything both headers need.
function buildEntry(absolute, root = ROOT) {
  const raw = readFileSync(absolute);
  const compressed = deflateRawSync(raw);
  // Storing uncompressed is smaller whenever deflate loses (already-compressed PNGs).
  const deflated = compressed.length < raw.length;
  return {
    name: relative(root, absolute).split("\\").join("/"),
    body: deflated ? compressed : raw,
    method: deflated ? 8 : 0,
    crc: crc32(raw),
    size: raw.length
  };
}

function localHeader(entry) {
  const name = Buffer.from(entry.name, "utf8");
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0);
  head.writeUInt16LE(20, 4); // version needed
  head.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
  head.writeUInt16LE(entry.method, 8);
  head.writeUInt16LE(DOS_EPOCH.time, 10);
  head.writeUInt16LE(DOS_EPOCH.date, 12);
  head.writeUInt32LE(entry.crc, 14);
  head.writeUInt32LE(entry.body.length, 18);
  head.writeUInt32LE(entry.size, 22);
  head.writeUInt16LE(name.length, 26);
  return Buffer.concat([head, name]);
}

function centralHeader(entry, offset) {
  const name = Buffer.from(entry.name, "utf8");
  const head = Buffer.alloc(46);
  head.writeUInt32LE(0x02014b50, 0);
  head.writeUInt16LE(20, 4); // version made by
  head.writeUInt16LE(20, 6); // version needed
  head.writeUInt16LE(0x0800, 8);
  head.writeUInt16LE(entry.method, 10);
  head.writeUInt16LE(DOS_EPOCH.time, 12);
  head.writeUInt16LE(DOS_EPOCH.date, 14);
  head.writeUInt32LE(entry.crc, 16);
  head.writeUInt32LE(entry.body.length, 20);
  head.writeUInt32LE(entry.size, 24);
  head.writeUInt16LE(name.length, 28);
  head.writeUInt32LE(offset, 42);
  return Buffer.concat([head, name]);
}

function endOfCentralDirectory(count, directorySize, directoryOffset) {
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(directorySize, 12);
  end.writeUInt32LE(directoryOffset, 16);
  return end;
}

/**
 * Serialize archive members into a ZIP buffer.
 *
 * @example
 *   const zip = packZip([buildEntry("/abs/manifest.json")]);
 */
function packZip(entries) {
  const parts = [];
  const directory = [];
  let offset = 0;
  for (const entry of entries) {
    directory.push(centralHeader(entry, offset));
    const local = localHeader(entry);
    parts.push(local, entry.body);
    offset += local.length + entry.body.length;
  }
  const directorySize = directory.reduce((sum, buf) => sum + buf.length, 0);
  return Buffer.concat([...parts, ...directory, endOfCentralDirectory(entries.length, directorySize, offset)]);
}

function main(root = ROOT) {
  const files = collectFiles(readIncludeList(root), root);
  const version = readVersion(root);
  const outputDir = join(root, "web-ext-artifacts");
  mkdirSync(outputDir, { recursive: true });
  const output = join(outputDir, `dopamine-toll-${version}.zip`);
  // Wrapped, not point-free: map passes the index as the second argument, which
  // would land in buildEntry's `root` parameter.
  writeFileSync(output, packZip(files.map((file) => buildEntry(file, root))));
  console.log(`packaged -> ${output}`);
  console.log(`files:     ${files.length}`);
}

// Only package when run as a script — importing this module (the test suite does)
// must not write an artifact as a side effect.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}

export {
  readIncludeList,
  walkDirectory,
  collectFiles,
  readVersion,
  buildEntry,
  localHeader,
  centralHeader,
  endOfCentralDirectory,
  packZip,
  main
};
