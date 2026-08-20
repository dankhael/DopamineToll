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

  // Mirrored here rather than read on every click. The runner refuses to arm twice on
  // one control, but that guard only holds if the check and the arming happen with no
  // await between them — with a storage read in the way, three fast clicks all got
  // past it before any of them registered, and stacked three countdowns on the same
  // setting. null means "not read yet".
  let coolOffOn = null;

  DTTollGuard.isOn(chrome.storage.sync).then((on) => {
    coolOffOn = on;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.coolOffEnabled) {
      coolOffOn = changes.coolOffEnabled.newValue === true;
    }
  });

  /**
   * Apply a settings change, or make it wait first if it weakens the toll.
   * `host` is the row or control the countdown should appear inside.
   *
   * Example: DTGuardedChange.apply(row, "blockedDomains", current, next, () => save())
   */
  async function apply(host, key, current, next, save) {
    if (!DTTollGuard.isWeakening(key, current, next)) return save();
    // The only path with an await before start(), reachable only in the moments
    // before the first read lands.
    const on = coolOffOn === null ? await DTTollGuard.isOn(chrome.storage.sync) : coolOffOn;
    if (!on) return save();
    runner.start(host, save);
  }

  window.DTGuardedChange = { apply, cancelWithin: runner.cancelWithin };
})();
