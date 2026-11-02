# A 30-second cooling-off per weakening change — and what it cannot protect

Turning the extension off, or emptying the block list, used to cost one click, so the toll
was only ever as strong as the user's worst thirty seconds. We now charge a **cooling-off**:
a 30-second countdown, in place, on each individual change that weakens the toll (see
`CONTEXT.md` for the exact set). It is deliberately short and deliberately narrow — it
raises the price of an impulse, and does not pretend to be a lock.

## The constraint that shapes everything here

**No extension — Chrome or Firefox, MV2 or MV3 — can intercept, delay, or block being
disabled or removed from `chrome://extensions` / `about:addons`.** No hook exists.
`chrome.management` observes *other* extensions, never itself; `runtime.onSuspend` fires too
late and is not a veto. On Firefox there is a second, equally unpluggable hole: the user can
revoke `<all_urls>` from the extensions menu at any time, after which no content script
injects at all (`popup.js` already detects this and says so rather than looking healthy).

So the cooling-off guards **this extension's own off switch and its own settings page**, and
nothing else. Uninstall-and-reinstall clears `storage.sync` and `storage.local` and resets
every guard in about thirty seconds. That is accepted, not overlooked: the feature is a
commitment device against the impulse, not a defence against the decision.

## Considered options

- **A long wait (hours) before a disable takes effect** — rejected. It forces a pending
  request persisted in background storage, and it inverts the goal: an impulsive click at
  09:00 becomes a *guaranteed* disable at 11:00, when the urge has already passed. A short
  wait the user must sit through, and can simply abandon, kills the impulse instead of
  scheduling its reward.
- **A single "settings unlocked" window** — arm once, wait, then edit freely for N minutes.
  Rejected once the wait was fixed at 30 seconds: at that length, per-change costs nothing
  extra and there is no queue, no global "a request is pending" state, and nothing to
  persist. Each countdown lives on its own row and dies with the page.
- **Detecting after the fact that the extension had been disabled** — rejected as
  unimplementable. The MV3 service worker is recycled constantly, so "we were switched off"
  and "the worker was asleep" are indistinguishable from inside. The detector would cry wolf
  all day. An honest sentence in the settings page is worth more than a system that lies.

## Consequences

- The cooling-off freezes when the tab is hidden or the window blurred, exactly like the
  gate's countdown (`!document.hidden && document.hasFocus()`). Waiting it out in another
  tab is not waiting.
- That rule forced `startTollCountdown` out of the `content/blocker.js` IIFE into `shared/`,
  where the gate, the settings page and the popup all use one implementation — and where it
  is finally unit-testable, like `DTFormat` and `DTDom` before it.
- In the popup the countdown dies when the popup closes, because desktop popups close on
  blur. This is the intended behaviour, not a bug to paper over with resumable state:
  abandoning the wait costs you the wait, same as walking away from the gate. Storing
  progress toward disabling the extension would be storing progress in the wrong direction.
- **Direction matters, and two settings invert.** Raising `unlockDuration` (longer time
  loose on the site) and raising `frictionMinutes` (fewer reminders) both *weaken* the toll,
  so those pay the cooling-off while lowering them is instant. Getting either sign backwards
  silently opens a hole.
- Off by default. Turning it on tightens the toll and so is instant; turning it off pays the
  cooling-off. `onInstalled` only seeds absent keys, so existing installs are unaffected
  until the user opts in.
- The settings page states plainly that the cooling-off does not cover the browser's own
  extensions page. Users are told the shape of the guard rather than left to assume it is
  taller than it is.
