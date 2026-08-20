// The daily free-pass ledger: how many passes exist today, how many are left, and
// what spending one does to that. Pure functions over a plain record and a day key,
// so every rule below is exercised under Node instead of being trusted.
//
// The balance lives in chrome.storage.local, per device — see ADR-0004 for why it
// is deliberately not synced. The *allowance* (the user's chosen ceiling) lives in
// storage.sync with the rest of the settings; only today's spending is local.
//
// Dual export: attaches window/self.DTFreePass as a classic script; under Node
// (require) it returns the same API via module.exports.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DTFreePass = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Three a day is the ceiling the user can choose from; zero is the default, so
  // nobody gets an escape hatch they did not ask for.
  const DAILY_CAP = 3;

  // Where the ledger lives in chrome.storage.local. Named here so the service
  // worker (which writes it) and the popup (which reads it) cannot drift apart.
  const STORAGE_KEY = "freePassLedger";

  /**
   * Local calendar day as "YYYY-MM-DD". Local, not UTC: the refill happens at the
   * user's midnight, not at a midnight somewhere else.
   *
   * Example: dayKey(new Date(2026, 7, 20)) === "2026-08-20"
   */
  function dayKey(date) {
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${mm}-${dd}`;
  }

  function clampAllowance(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0;
    return Math.min(DAILY_CAP, Math.max(0, Math.floor(value)));
  }

  /**
   * A fresh ledger for `today`, snapshotting the allowance in force at the moment
   * the day opened.
   *
   * Example: openLedger("2026-08-20", 2) → { date: "2026-08-20", allowance: 2, spent: 0 }
   */
  function openLedger(today, allowance) {
    return { date: today, allowance: clampAllowance(allowance), spent: 0 };
  }

  /**
   * The ledger in force right now. A stored ledger from an earlier day (or a
   * missing/corrupt one) is replaced by a fresh one — the refill is lazy, on read,
   * so no alarm and no `alarms` permission is needed.
   *
   * Example: currentLedger(yesterdaysLedger, "2026-08-20", 1) → a full ledger
   */
  function currentLedger(stored, today, allowance) {
    if (!stored || typeof stored !== "object") return openLedger(today, allowance);
    if (stored.date !== today) return openLedger(today, allowance);
    return {
      date: today,
      allowance: clampAllowance(stored.allowance),
      spent: Math.max(0, Math.floor(stored.spent) || 0)
    };
  }

  /**
   * How many passes are still available today.
   *
   * The allowance counted is the *lower* of today's snapshot and what the settings
   * say right now, which is what makes the ratchet work in both directions: raising
   * the allowance only lands at the next refill (otherwise the cooling-off guarding
   * it would be a 30-second detour to the very bypass it slows down), while lowering
   * it tightens the toll and so takes effect immediately.
   *
   * Example: passesLeft({ allowance: 1, spent: 0 }, 3) === 1  // the raise waits
   */
  function passesLeft(ledger, allowance) {
    const inForce = Math.min(clampAllowance(ledger.allowance), clampAllowance(allowance));
    return Math.max(0, inForce - Math.max(0, ledger.spent));
  }

  /**
   * Spend one pass, returning the ledger that results. Refuses when none are left
   * rather than going negative — a caller that gets here with an empty balance has
   * a bug worth surfacing.
   *
   * Example: spendPass({ date: d, allowance: 2, spent: 0 }, 2) → { ..., spent: 1 }
   */
  function spendPass(ledger, allowance) {
    const left = passesLeft(ledger, allowance);
    if (left <= 0) {
      throw new Error(
        `no free pass left to spend: ledger ${JSON.stringify(ledger)}, allowance ${allowance}`
      );
    }
    return { ...ledger, spent: ledger.spent + 1 };
  }

  return { DAILY_CAP, STORAGE_KEY, dayKey, clampAllowance, openLedger, currentLedger, passesLeft, spendPass };
});
