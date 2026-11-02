# Dopamine Toll

A browser extension that charges a *toll* — a timed, deliberate pause — before a
distracting site opens. It is friction, never a hard block: the user always keeps
the choice, but has to slow down and make it on purpose.

## Language

### The gate

**Toll**:
The price paid in time and attention before a site on the block list opens.
_Avoid_: block, ban, lock

**Gate**:
The full-screen overlay that covers a blocked page while the toll is owed.
_Avoid_: modal, popup, screen, splash

**Countdown**:
The interval the gate holds the user before either choice becomes available.
Runs only while the tab is visible and the window focused.
_Avoid_: timer, delay, wait

**Unlock**:
Permission to use one blocked site in one tab for a bounded window, granted by
paying the toll. Scoped to a single tab and lost when the browser closes.
_Avoid_: allow, whitelist, bypass, grant

**Free pass**:
A daily allowance that skips the countdown and grants the unlock outright. The
allowance refills at local midnight, never accumulates, and is capped at three a
day. Zero by default — the user has to ask for it.
_Avoid_: lifeline, extra life, token, skip, cheat

### The block list

**Blocked entry**:
One line of the user's list, either `host` or `host/path`. Subdomains of `host`
always match; the optional path narrows the toll to one section of a site.
_Avoid_: rule, pattern, filter, URL

**Block list**:
The user's full set of blocked entries.
_Avoid_: blacklist, denylist, domains

### Guarding the toll

**Cooling-off**:
The countdown a setting sits through before a change that would weaken the toll
takes effect. Charged per change, in place, and paid again for the next one.
_Avoid_: cooldown, delay, lockout, penalty, armed

**Weakening change**:
Any edit that makes the toll easier to get past — turning the extension off,
removing a blocked entry, shortening the countdown, granting more free passes.
Changes that tighten the toll never wait.
_Avoid_: loosening, unsafe change, downgrade

### What the user brings

**North star**:
A photo of a goal the user uploaded, shown on the gate as the reason to walk away.
An animated GIF counts as a photo, and keeps moving on the gate.
_Avoid_: goal image, motivation picture, wallpaper

**Phrase**:
A reminder the user wrote to themselves, shown on the gate beside the north star.
_Avoid_: message, quote, affirmation, note

### The outcome

**Walked away**:
The user closed the tab when the countdown ended. One third of the daily tally.
_Avoid_: quit, cancelled, bounced

**Paid**:
The user opened the site anyway when the countdown ended, having waited it out.
Carries no judgement — paying is a legitimate outcome.
_Avoid_: failed, gave in, relapsed

**Friction reminder**:
A warning card that tumbles onto an unlocked page while the user is still there.
Ignoring one makes the next wave larger, and every card is closed by hand.
_Avoid_: nag, notification, toast, alert

**Spent a free pass**:
The user skipped the countdown with a free pass. The last leg of the daily tally,
kept apart from *paid* so the count of tolls actually waited out stays honest.
_Avoid_: skipped, cheated, bypassed
