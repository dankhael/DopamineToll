// How much north star photo the extension can keep, and whether one more fits.
//
// A still photo is downscaled to a small JPEG, so it never strains anything. An
// animated GIF is kept byte for byte (shrinking one means re-encoding every frame,
// with a GIF encoder this extension does not ship), so its size is whatever the
// user picked. That makes room a real question: Chrome caps storage.local at 10 MB
// unless the extension asks for unlimitedStorage, which Firefox shows users as a
// new permission warning on update. See ADR-0005.
//
// Dual export: attaches window.DTPhotoBudget as a classic script; under Node
// (require) it returns the same API via module.exports.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DTPhotoBudget = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // The file size of one animated GIF. Already a long, wide GIF, for a frame the
  // gate draws at 300×200.
  const MAX_ANIMATED_BYTES = 2 * 1024 * 1024;
  // Every photo together, as stored. Leaves 2 MB of the 10 MB quota for the tally,
  // the free-pass ledger and what comes next — and every gate reads the whole list
  // before it can draw, so this is also the most a gate ever waits on.
  const BUDGET_BYTES = 8 * 1024 * 1024;

  function requireList(goalImages) {
    if (!Array.isArray(goalImages)) {
      throw new Error(`expected the goalImages array, got: ${JSON.stringify(goalImages)}`);
    }
  }

  /**
   * What the photos take in storage now, counted the way the storage quota counts
   * a value: its JSON. Covers legacy bare-string entries as well as {name, src}.
   *
   * @example
   *   storedSize([{ name: "a.jpg", src: "data:image/jpeg;base64,…" }])  // ≈ src length + 22
   */
  function storedSize(goalImages) {
    requireList(goalImages);
    return goalImages.reduce((sum, entry) => sum + JSON.stringify(entry).length, 0);
  }

  /**
   * null when `entry` — the {name, src} about to be saved — still fits beside the
   * photos already kept; otherwise why not, with the numbers the message needs.
   *
   * @example
   *   refuseForRoom(goalImages, { name: file.name, src })  // null, or { reason: "noRoom", used, max }
   */
  function refuseForRoom(goalImages, entry) {
    const used = storedSize(goalImages);
    if (used + JSON.stringify(entry).length <= BUDGET_BYTES) return null;
    return { reason: "noRoom", used, max: BUDGET_BYTES };
  }

  /**
   * null when an animated GIF of `fileBytes` is small enough to keep as it is;
   * otherwise why not. Checked before room, because only a different GIF fixes
   * this one — removing photos would not.
   *
   * @example
   *   refuseTooBig(file.size)  // null, or { reason: "tooBig", size, max }
   */
  function refuseTooBig(fileBytes) {
    if (!Number.isInteger(fileBytes) || fileBytes < 0) {
      throw new Error(`refuseTooBig needs a byte count, got: ${JSON.stringify(fileBytes)}`);
    }
    if (fileBytes <= MAX_ANIMATED_BYTES) return null;
    return { reason: "tooBig", size: fileBytes, max: MAX_ANIMATED_BYTES };
  }

  return { MAX_ANIMATED_BYTES, BUDGET_BYTES, storedSize, refuseForRoom, refuseTooBig };
});
