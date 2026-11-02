# Free passes live in `storage.local`, not `storage.sync`

A **free pass** skips the gate's countdown and grants the unlock outright; the user is
allowed up to three a day, refilled at local midnight. The daily balance is kept in
`chrome.storage.local` — **per device** — even though every other configurable setting in
this extension lives in `chrome.storage.sync`.

**Do not "unify" this by moving the balance to `sync`.** The inconsistency is the decision.

## Why

`storage.sync` propagation is best-effort and delayed by design — there is no transaction,
no compare-and-swap, and no ordering guarantee. Two browsers open at once both read a
balance of 1, both spend it, and both write 0: the same pass is spent twice, and the second
write silently wins. Storing it locally trades a rigour that `sync` cannot actually deliver
for a rule that is always true on the device where it is enforced.

The cost is real and accepted: someone running a laptop and a desktop gets three passes on
each. That is a leniency, not a hole — and it is a smaller one than a counter that
double-spends and cannot be reasoned about.

## Consequences

- The balance resets lazily on read by comparing a stored local-calendar date key, the same
  pattern `tollStats` already uses in the service worker. No alarm, no `alarms` permission.
- The *allowance* (0–3, the user's chosen ceiling) stays in `storage.sync` with the rest of
  the settings; only the *balance spent today* is local. Two keys, two storage areas, on
  purpose.
- Raising the allowance takes effect at the next refill, never the same day — otherwise the
  cooling-off that guards it (ADR-0003) becomes a 30-second detour to the very bypass it
  exists to slow down.
