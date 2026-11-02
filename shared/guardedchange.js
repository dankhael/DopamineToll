// Binds the shared cooling-off runner to this page: the real document, the
// focus-aware countdown, and this locale's labels. The lifecycle itself lives in
// shared/cooloff.js, where it is tested — everything here is glue.
//
// Loaded by both the settings page and the popup, so switching the extension off
// and removing a site wait through the same code and look the same while they do.

(() => {
  const runner = DTCoolOff.createRunner({
    doc: document,
    seconds: DTTollGuard.COOL_OFF_SECONDS,
    // Each control names its own sentence in data-cooloff-label ("removed in 28s",
    // "off in 28s"), so the status says what is about to happen rather than only
    // how long is left. A control that names none shows the bare seconds.
    label: (remaining, host) =>
      DTI18n.t(host.dataset.cooloffLabel || "coolOffSeconds", [String(remaining)]),
    cancelText: DTI18n.t("coolOffCancel"),
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
   * `host` is the control the countdown takes over. Acting on that control again
   * while it waits calls the wait off — a switch clicked twice is a switch put back.
   *
   * Example: DTGuardedChange.apply(row, "blockedDomains", current, next, () => save())
   */
  async function apply(host, key, current, next, save) {
    if (runner.isPending(host)) return runner.stopAt(host);
    if (!DTTollGuard.isWeakening(key, current, next)) return save();
    // The only path with an await before start(), reachable only in the moments
    // before the first read lands.
    const on = coolOffOn === null ? await DTTollGuard.isOn(chrome.storage.sync) : coolOffOn;
    if (!on) return save();
    runner.start(host, save);
  }

  window.DTGuardedChange = { apply, cancelWithin: runner.cancelWithin };
})();
