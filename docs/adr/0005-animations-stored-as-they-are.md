# Animated north stars are stored as they are, under a size budget

A **north star** used to be downscaled to a JPEG of at most 600px on upload. That runs
the image through a `<canvas>`, which keeps only the first frame, so an animated image
froze on the gate. Now the settings page reads the file's bytes first. If it is an
animated GIF, WebP or PNG (APNG) with more than one frame, it is stored **byte for
byte** as a `data:` URL of that type, and the gate's `<img>` plays it. Everything else,
single-frame animations included, still goes through the canvas.

Each format has its own sniffer, which walks only the container's structure and never
decodes pixels: `shared/gif.js` reads blocks, `shared/webp.js` counts RIFF `ANMF`
chunks, and `shared/apng.js` reads the `acTL` frame count before the image data.
`shared/animation.js` asks all three and returns the MIME type to store the file
under. The type always comes from the bytes, never from the file name. WebP matters
in practice: sites like Giphy and Tenor often serve animations as WebP, so a "GIF"
saved from the web is frequently a `.webp`.

## Why not shrink the animation too

Shrinking an animation means decoding every frame, scaling it, and encoding a new
file. Browsers can decode frames (`ImageDecoder`), but none ships an encoder for an
animated GIF, WebP or PNG, so the extension would have to carry one: for GIF, a
quantiser and an LZW encoder, written here or vendored. That is a lot of code to review on every store submission, for a picture the
gate draws at 300×200. Keeping the file as it is costs nothing in code. It costs
storage, and that is bounded instead (below).

## The budget

`chrome.storage.local` is capped at 10 MB on Chrome unless the extension asks for
`unlimitedStorage`. Chrome grants that permission silently, but Firefox shows users a new
permission warning on update, for a feature most of them will never use. So the
permission is not requested, and `shared/photobudget.js` sets two limits instead:

- **2 MB per animation**, checked before the file is stored. Over it, the user is told
  to pick a shorter or smaller one, because removing other photos would not help. The
  same animation as WebP usually comes in well under the GIF's size.
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
- Video "GIFs" are not supported. X, and Giphy's download button, hand out short
  MP4s rather than images, and those fail to decode, so the upload reports the decode
  error. Supporting them means the gate rendering a muted, looping `<video>`. That is
  its own feature, with heavier files.
- `prefers-reduced-motion` is not honoured: an animation the user chose plays for them. If that
  changes, the gate would draw the first frame to a canvas when the media query
  matches. The stored file would stay as it is.
