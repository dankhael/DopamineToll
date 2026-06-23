# Dopamine Toll

A Chrome extension (Manifest V3) that intercepts blocked domains with a full-screen
motivational overlay. The user must wait out a countdown before they can choose to
either close the tab ("be productive") or unlock the site for a configurable window
("be lazy"). After the unlock window expires the overlay returns.

The goal is friction, not prohibition. Browsing Twitter is one click away — but you
have to look at your **north star** (a picture of what you said you wanted), read a
phrase you wrote to yourself, and stare at a 30-second countdown before that click is
even available.

## Design

Warm near-black surfaces with an amber / terracotta accent — the "V1 · Stark" toll
overlay, a matching popup and settings page, and a **countdown-gauge** primary mark
(an amber ring + center dot) used as the logo and toolbar icon. Type is Archivo for
voice and JetBrains Mono for the toll meter, domains, and labels; both degrade to the
system grotesque / monospace so **no web fonts are fetched** (see Privacy). Shared
tokens live in [`assets/theme.css`](assets/theme.css); the injected overlay keeps its
own scoped copy in [`content/blocker.css`](content/blocker.css).

Four accent themes — **Amber** (default), **Indigo**, **Emerald**, **Rose** — swap the
primary color via a `data-theme` attribute (the warm surfaces and terracotta "cost"
cue stay constant). The popup fills its window with no outer frame.

## Features

- **SPA-aware** — the background listens on `webNavigation.onHistoryStateUpdated`
  for `pushState` / `replaceState` route changes, and the content script listens for
  `popstate` / `hashchange`, so client-side navigation (Twitter, Reddit, YouTube,
  Instagram) re-triggers the overlay.
- **DOM-resilient** — overlay is mounted on `documentElement` at
  `z-index: 2147483647` and a `MutationObserver` re-injects it if the host page or
  DevTools removes it.
- **Per-tab session unlocks** — stored in `chrome.storage.session`, so closing the
  browser resets all unlocks. Cleaned up on tab close.
- **North star photos** — user-uploaded, resized client-side to ≤600px and stored as
  `{name, src}` (base64) in `chrome.storage.local` (max 8, warns past 300KB). Legacy
  bare-string entries are still read.
- **Daily tally** — the popup shows today's "walked away N× · paid M×", tracked in
  `chrome.storage.local` under `tollStats` and reset on the local calendar day.
- **Accent themes** — Amber / Indigo / Emerald / Rose, chosen in settings and applied
  across the overlay, popup, settings page, the **toolbar icon** (the service worker
  repaints the gauge in the active accent via OffscreenCanvas), and the **settings-tab
  favicon** (drawn client-side to a data URL). Synced via `chrome.storage.sync`.
- **Subdomain matching** — blocking `twitter.com` also blocks `mobile.twitter.com`.
- **No external dependencies** — vanilla JS + CSS, no web fonts. CSP-safe.

## Project structure

```
manifest.json
gen-icons.ps1           # regenerates the countdown-gauge toolbar icons
background/
  service-worker.js     # navigation listener, unlock state, daily tally, message router
content/
  blocker.js            # SPA hooks, overlay injection, MutationObserver
  blocker.css           # "V1 Stark" overlay, scoped under #dopamine-toll-overlay
options/
  index.html
  options.css           # settings page styles
  options.js            # toll list, north star, phrases, steppers — autosave
popup/
  popup.html
  popup.css             # popup styles
  popup.js              # enable toggle, current-tab status, daily tally
assets/
  theme.css             # shared design tokens (popup + options)
  icon16.png  icon48.png  icon128.png
```

## Install (load unpacked)

1. Open `chrome://extensions` in Chrome (or any Chromium browser: Edge, Brave, Arc).
2. Toggle **Developer mode** on (top right).
3. Click **Load unpacked** and select this project's root folder.
4. The Dopamine Toll icon should appear in the toolbar. Pin it for easier access.

The default toll list is seeded on install: `twitter.com`, `x.com`, `instagram.com`,
`tiktok.com`, and `youtube.com/shorts` (a path entry — Shorts tolls, the rest of
YouTube doesn't), with a 30s countdown and a 10min unlock window.

## Build

There is no build step. Files are loaded as-is by Chrome — vanilla JS, vanilla CSS,
no bundler, no transpiler, no `node_modules`. Edit a file → reload the extension.

To regenerate the toolbar icons (the amber countdown gauge — only needed if you
delete `assets/` or change the mark):

```powershell
./gen-icons.ps1
```

It draws the gauge with `System.Drawing` (supersampled for crisp small sizes) and
writes `assets/icon16.png`, `icon48.png`, and `icon128.png`. These are the fallback;
at runtime the service worker repaints the toolbar icon in the active theme's accent.

## Usage

**Toolbar popup** — toggle the extension on/off, see the size of your toll list,
the current tab's status (on your toll list · toll armed / window open M:SS, or not
listed), today's "walked away / paid" tally, and a button into settings.

**Settings page** — `chrome-extension://<id>/options/index.html`, or right-click the
toolbar icon → **Options**. Five cards, all autosaving:

- **Toll list** — type a hostname (or paste a URL — it gets cleaned), Enter to add.
  A path narrows the toll to one section (`youtube.com/shorts`). Subdomains of an
  entry are also tolled.
- **Your north star** — upload up to 8 photos (resized to a max 600×600 JPEG @ 0.85
  in the browser). One is shown at random per toll, with its filename.
- **Things you told yourself** — phrases; one is picked at random each toll. Add
  with the button or ⌘/Ctrl+Enter.
- **The toll** — Countdown stepper (10–120s, ±5) and Unlock window stepper
  (1–30min, ±1).
- **Theme** — pick the accent (Amber / Indigo / Emerald / Rose); applies everywhere
  immediately.

**On a tolled site** — the overlay appears, the countdown runs, then **Close tab**
("be productive") closes the tab while **Open anyway · N min** ("be lazy") unlocks
the site for the configured window.

## Testing locally

There are no automated tests — this is a small UI extension where the meaningful
tests are manual interaction tests in a real browser. The checklist:

**Initial load**
1. Load unpacked → no errors in `chrome://extensions` for the service worker
   ("Inspect views: service worker" should open without uncaught exceptions).
2. Visit `https://twitter.com`. Overlay appears immediately.
3. Wait the countdown — the "Open anyway" button unlocks (locked → ghost).
4. Click **Close tab** — tab closes; the popup tally shows "walked away 1×".

**SPA navigation** (the important one)
1. Unlock `twitter.com`. You're on the home feed.
2. Click into a tweet, then back, then a profile — overlay should NOT reappear
   while still inside the unlock window.
3. Wait out the unlock window. Navigate within Twitter again. Overlay returns.

**Overlay resilience**
1. Open DevTools while the overlay is shown, find `#dopamine-toll-overlay`, delete it.
2. The MutationObserver should re-inject within a frame.

**Per-tab isolation**
1. Unlock `twitter.com` in tab A. Open `twitter.com` in tab B → still blocked.
2. Close tab A. Open `twitter.com` in tab C → still blocked (state was per-tab).

**Subdomain matching**
- `mobile.twitter.com` and `m.instagram.com` should be tolled when the bare domain
  is on the list.

**Storage edge cases**
1. Remove all phrases in options → overlay falls back to the default phrase set.
2. Remove all north star photos → overlay shows the striped placeholder card.
3. Toggle the extension off in the popup → no overlays inject.

**Reload after code change**
- Edit `content/blocker.js`, then go to `chrome://extensions` and click the reload
  icon on Dopamine Toll. Reload the test tab. (The service worker auto-restarts;
  content scripts only reload on a page navigation.)

## Debugging

- **Service worker logs** — `chrome://extensions` → Dopamine Toll → "Inspect views:
  service worker". This is where `chrome.webNavigation` and message-routing errors
  show up.
- **Content script logs** — open DevTools on the affected page. The content script
  runs in the page's main world's isolated context; its `console.log` calls land in
  the page's DevTools console.
- **Storage inspection** — DevTools → **Application** tab → **Storage** →
  **Extension Storage** (sync, local, session). Useful for verifying `blockedDomains`
  shape or seeing live `unlocks` state.
- **MV3 service worker is ephemeral** — it sleeps after ~30s idle and wakes on the
  next event. State that needs to survive sleep must be in `chrome.storage`, not
  module-scoped variables.

## Permissions used

- `storage` — settings (`sync`), north star photos + daily tally (`local`), per-tab
  unlocks (`session`).
- `webNavigation` — `onCommitted` + `onHistoryStateUpdated` to detect navigation to
  blocked domains *before* the page paints (and on SPA route changes), ahead of
  where a content-script-only approach would react.
- `host_permissions: <all_urls>` — required so the content script and
  `webNavigation` see every site. It also makes `tab.url` readable from
  `chrome.tabs.query`, so the popup needs no separate `tabs` permission, and
  `chrome.tabs.remove` / `onRemoved` / `sendMessage` don't require it either.

## Known limitations

- **`window.close()`** is blocked in tabs that weren't opened by a script. The
  "be productive" button falls back to messaging the service worker to call
  `chrome.tabs.remove`, then `about:blank` as last resort.
- **`chrome://`, `edge://`, Chrome Web Store** — content scripts cannot run on
  these by browser policy. Not blockable.
- **Iframes** — the content script runs only in top frames (`all_frames: false`),
  so a blocked domain embedded as an iframe inside a non-blocked page will not
  be intercepted. Intentional, to avoid breaking embeds.
- **Sync storage size** — phrases and domain lists go in `chrome.storage.sync`
  (~100KB total). Images are deliberately in `chrome.storage.local` to avoid this.

## Privacy

Everything is local. The extension makes zero network requests — including fonts,
which fall back to the system grotesque / monospace rather than fetching web fonts.
Phrases, the toll list, and timer settings sync via the user's existing Chrome sync
account (Google) if it's enabled — the extension does not run its own sync. North
star photos and the daily tally stay in local storage on the device.
