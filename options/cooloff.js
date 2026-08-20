// Binds the shared cooling-off runner to this page: the real document, the
// focus-aware countdown, and this locale's label. The lifecycle itself lives in
// shared/cooloff.js, where it is tested — everything here is glue.

(() => {
  const runner = DTCoolOff.createRunner({
    doc: document,
    seconds: DTTollGuard.COOL_OFF_SECONDS,
    label: (remaining) => DTI18n.t("optionsCoolOffWait", [String(remaining)]),
    // The same clock as the gate's toll, and the same rule: it only runs while this
    // page is in front of the user. Waiting it out in another tab is not waiting.
    startCountdown: (seconds, hooks) =>
      DTCountdown.startFocusCountdown(seconds, {
        ...DTCountdown.pageActivity(document, window),
        ...hooks
      })
  });

  /**
   * Apply a settings change, or make it wait first if it weakens the toll.
   * `host` is the row or control the countdown should appear inside.
   *
   * Example: DTGuardedChange.apply(row, "blockedDomains", current, next, () => save())
   */
  async function apply(host, key, current, next, save) {
    if (DTTollGuard.isWeakening(key, current, next) && (await DTTollGuard.isOn(chrome.storage.sync))) {
      runner.start(host, save);
      return;
    }
    await save();
  }

  window.DTGuardedChange = { apply, cancelWithin: runner.cancelWithin };
})();
