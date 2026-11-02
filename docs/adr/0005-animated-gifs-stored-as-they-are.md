# Animated GIF north stars are stored as they are, under a size budget

A **north star** used to be downscaled to a JPEG of at most 600px on upload. That runs
the image through a `<canvas>`, which keeps only the first frame, so an animated GIF
froze on the gate. Now the settings page reads the file's bytes first
(`shared/gif.js`). A GIF with more than one frame is stored **byte for byte** as a
`data:image/gif` URL, and the gate's `<img>` plays it. Everything else, single-frame
GIFs included, still goes through the canvas.

## Why not shrink the GIF too

Shrinking an animated GIF means decoding every frame, scaling it, and encoding a new
GIF. Browsers can decode frames (`ImageDecoder`), but none ships a GIF encoder, so the
extension would have to carry one: a quantiser and an LZW encoder, written here or
vendored. That is a lot of code to review on every store submission, for a picture the
gate draws at 300×200. Keeping the file as it is costs nothing in code. It costs
storage, and that is bounded instead (below).

## The budget

`chrome.storage.local` is capped at 10 MB on Chrome unless the extension asks for
`unlimitedStorage`. Chrome grants that permission silently, but Firefox shows users a new
permission warning on update, for a feature most of them will never use. So the
permission is not requested, and `shared/photobudget.js` sets two limits instead:

- **2 MB per animated GIF**, checked before the file is read. Over it, the user is told
  to pick a shorter or smaller GIF, because removing other photos would not help.
- **8 MB for all photos together**, as stored, which includes base64's extra third. This
  leaves 2 MB of the quota for the daily tally, the free-pass ledger and whatever comes
  next. Over it, the user is told how much is in use and asked to remove a photo first,
  instead of meeting the bare quota error from `storage.local.set`.

Stills are counted against the same budget, but a 600px JPEG is small enough that it
only fills up when GIFs have used most of it.

## Consequences

- **Every gate reads the whole photo list** (`content/blocker.js` `loadConfig`), then
  picks one photo. The budget is therefore also the most data a gate waits on before it
  draws. With the budget full (about 8 MB stored), that read took about 50 ms on
  Chromium 156 on the machine this was built on. Storing each photo under its own
  key, so a gate reads only the photo it shows, is the fix if that read ever shows up
  as a visible delay. That changes the storage format and needs a migration, so it
  was not done here.
- Animated WebP and APNG are not detected, so they still freeze. Detecting them would
  take the same kind of byte walk as `shared/gif.js`, one per format.
- `prefers-reduced-motion` is not honoured: a GIF the user chose plays for them. If that
  changes, the gate would draw the first frame to a canvas when the media query
  matches. The stored file would stay as it is.
