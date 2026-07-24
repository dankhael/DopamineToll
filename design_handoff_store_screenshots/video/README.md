# Dopamine Toll — promo video

A ~33s Chrome Web Store promo, built from the **same brand system as the
screenshots** (`../store.css`, `../ui.css`, the real product-UI classes and the
placeholder photos in `../assets/img/`). No After Effects, no external assets —
the motion lives in code and renders to a clean 1920×1080 MP4.

## What it shows (4 beats)
1. **Gate** — the toll overlay drops over `instagram.com`, the countdown drains
   30 → 0, north star + your phrase appear, then the choice unlocks.
2. **Nudge** — an unlocked x.com feed; friction cards tumble in, wave after wave.
3. **Control** — your toll list + the countdown / unlock-window steppers.
4. **Outro** — privacy line, the countdown-gauge mark draws itself, *Add to Chrome*.

## Files
- `animation.html` — the 1920×1080 stage and the four scenes (reuses shared CSS).
- `timeline.js` — the motion engine. Every beat is a paused Web Animations API
  clip with a global start time; `window.seek(t)` renders any millisecond
  deterministically. **Edit the `SCENE` windows and the `build*()` calls here to
  retime or restyle a beat.**
- `strings.js` — all on-screen copy (`STRINGS`), i18n like the screenshots.
- `dopamine-toll.mp4` — the exported video (git-ignored; regenerate anytime).

## Preview it live (no render)
Open `animation.html` in Chrome — it loops itself in real time. Add `?lang=de`
to preview a locale, or `?capture=1` to freeze on the first frame.

## Render the MP4
Reuses the screenshots' toolchain — system Chrome + `puppeteer-core`, plus
**ffmpeg** on PATH for the mux.

```
cd ../tools
npm install        # once (shared with the screenshot renderer)
npm run record     # -> ../video/dopamine-toll.mp4   (60fps)
```

Frame capture is deterministic (it seeks the timeline, it does not screen-grab
in real time), so the result is perfectly smooth regardless of machine speed.

Options:
- `FPS=30 npm run record` — faster draft, ~half the frames / file size.
- `node record.mjs --lang de` — a localized cut (add the language to `strings.js`
  first, then to `LANGS` if you batch-export).
- `node record.mjs --music path/to/bed.mp3` — lay an audio bed under the video.
- `node record.mjs --keep` — keep the PNG frames in `frames/` after muxing.
- `SCALE=2 npm run record` — render at 2× (3840×2160) for a 4K master.

No ffmpeg? The frames are left in `frames/` and the exact ffmpeg command is
printed for you to run by hand.

## Publish
Upload `dopamine-toll.mp4` to YouTube (unlisted is fine), then paste the URL in
the Chrome Web Store dashboard → your item → **Store listing → Video**. It
becomes the first tile in the media carousel, before the screenshots.

## Add a language
Same as the screenshots: in `strings.js`, duplicate the whole `en: { … }` block,
rename the key (`de`, `fr`, `ja`, `pt`, `zh`), translate the **values** only —
keep the `{s}` token (live countdown seconds) and any HTML tags intact.

## Music
Keep it quiet and minimal — this brand reads as calm friction, not a hype reel.
Sources with a clear license: the YouTube Audio Library, Uppbeat, or a near-silent
bed plus a couple of soft UI ticks. Pass it with `--music`.
