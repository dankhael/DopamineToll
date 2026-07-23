# Dopamine Toll — Store screenshots 1–6 (translation handoff)

The six Chrome Web Store screenshots packaged so copy can be translated and
re-exported per language, without touching layout or styling.

Copy ships in the **6 locales the extension supports**: `en`, `de`, `fr`, `ja`,
`pt` (Portuguese, Brazil), `zh` (Chinese, Simplified). Terminology matches the
shipped extension (`_locales/`) — e.g. "toll" = Maut / péage / 通行料 / pedágio /
过路费. Rendered PNGs live in `png/` (`screenshot-0N-<lang>.png`, 36 total).

## Files
- `screenshot-1.html` … `screenshot-6.html` — the screenshots (fixed 1280×800).
  All visible copy is driven from the `STRINGS` object at the top of each file.
- `i18n.js` — shared renderer; injects the right language into `[data-t]` nodes.
- `store.css` / `ui.css` — brand + UI styles. Do not edit for translation.
- `assets/img/` — placeholder photos (ferrari, switch, pc).
- `png/` — exported 1280×800 PNGs, one per screenshot per language.
- `tools/` — `render.mjs` + `package.json`, the headless-Chrome exporter.

## What each screenshot says
- **1** — "Every scroll has a price" (the countdown toll overlay)
- **2** — "Look at what you actually want" (your chosen north-star photo)
- **3** — "Read back your own words" (your own phrases, not canned quotes)
- **4** — "You decide what costs you" (the toll list of gated sites)
- **5** — "Nothing leaves your machine" (privacy / zero network requests)
- **6** — "It doesn't stop at the door" (in-feed nudges past the toll)

## How to add a language
1. Open a `screenshot-N.html` and find the `STRINGS` object near the top.
2. Duplicate the whole `en: { ... }` block, rename the key to the language
   code (e.g. `es`, `it`, `ko`).
3. Translate the **values only**. Keep the HTML tags intact:
   - `<b>…</b>` = bold emphasis
   - `<span class="am">…</span>` / `<span class="u">…</span>` = the coloured word in the headline
   - `<code>…</code>` = the mono "path" chip (screenshot 4)
   - `\n` in `p2text` (screenshot 6) = line break in that tweet
4. Repeat in each file for that language, then add it to `LANGS` in
   `tools/render.mjs` so it gets exported.
5. View with `?lang=xx`, e.g. `screenshot-1.html?lang=de`. No query = English.

The renderer reads the page's `STRINGS` binding directly (not `window.STRINGS`),
because a top-level `const` is not a `window` property — keep `const STRINGS` as-is.

## Keys that are usually left as-is
Brand name ("Dopamine Toll" / "pay in seconds"), domain names
(instagram.com, tiktok.com…), file names (carro.jpg, pc.png…), timer digits
(00:26, 15 min) and step numbers (02 / 06) are hard-coded in the markup, not in
`STRINGS` — translate only if a locale truly needs it.

## Exporting the PNGs
All 36 images regenerate with one command (needs Node 18+ and Chrome or Edge
installed — it drives the system browser, no Chromium download):

```
cd tools
npm install            # once — pulls puppeteer-core
npm run render         # writes ../png/screenshot-0N-<lang>.png
```

Each PNG is the `.board` element captured at exactly 1280×800 (the Chrome Web
Store screenshot size). If Chrome/Edge is in a non-standard path, set
`CHROME_PATH` to the executable. To export by hand instead: open
`screenshot-N.html?lang=xx` at 1280×800 and capture the `.board` element.

## Notes
- Watch headline/lede length in longer languages (German, French). If a line
  overflows, nudge that screen's headline `font-size` down a few px for that
  language.
- Fonts (Archivo + JetBrains Mono) load from Google Fonts via `store.css`
  (needs internet on first load). Self-host the fonts for fully offline use.
