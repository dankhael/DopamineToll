# Manual testing & debugging

`npm test` covers the pure pieces (locales, manifest, packager, DOM builders, gate
view, platform queries). What it can't cover is the extension living inside a real
browser — navigation timing, SPAs, the overlay fighting the host page. This is the
checklist for that.

## Checklist

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

**Countdown honesty**
1. Start a toll, switch to another tab or app mid-countdown.
2. Come back — the countdown resumed where it paused, it did not keep running.

**Friction reminders**
1. Pay the toll with reminders on and a 1-minute interval.
2. Each wave drops one more warning card than the last; each must be closed by hand.
3. Turn reminders off in settings → no more cards on the next wave.

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
  show up. On Firefox: `about:debugging` → **Inspect**.
- **Content script logs** — open DevTools on the affected page. The content script
  runs in an isolated world, but its `console.log` calls land in the page's
  DevTools console.
- **Storage inspection** — DevTools → **Application** tab → **Storage** →
  **Extension Storage** (sync, local, session). Useful for verifying `blockedDomains`
  shape or seeing live `unlocks` state.
- **MV3 service worker is ephemeral** — it sleeps after ~30s idle and wakes on the
  next event. State that needs to survive sleep must be in `chrome.storage`, not
  module-scoped variables.
