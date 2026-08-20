// The cooling-off that guards every weakening change on the settings page
// (ADR-0003). A change that makes the toll easier to get past sits through 30
// seconds before it applies; the countdown runs in place, inside the control it
// belongs to, and clicking it cancels.
//
// Split out of options.js so that file stays about rendering the settings, and this
// one is about one thing: making a change wait.
//
// Nothing here is persisted. Countdowns on different controls run independently —
// each weakening change pays its own wait — and closing the page abandons every
// pending one, which costs the user the wait rather than saving progress toward
// weakening the toll.
(() => {
  const COOL_OFF_CLASS = "cooloff";

  // Every countdown currently running, by the control it belongs to. Needed because
  // countdowns are parallel: one finishing can re-render a list and destroy the rows
  // the others are attached to.
  const running = new Map();

  async function coolOffIsOn() {
    const { coolOffEnabled } = await chrome.storage.sync.get("coolOffEnabled");
    return coolOffEnabled === true;
  }

  function coolOffLabel(seconds) {
    return DTI18n.t("optionsCoolOffWait", [String(seconds)]);
  }

  function stopCoolOff(host) {
    const control = running.get(host);
    if (!control) return;
    control.stop();
    running.delete(host);
    host.querySelector("." + COOL_OFF_CLASS)?.remove();
  }

  /**
   * Cancel every cooling-off inside `root`. A list re-render destroys the rows its
   * countdowns are attached to, leaving them ticking invisibly against a copy of the
   * list that is already stale. Cancelling fails safe — the toll stays as it is.
   *
   * Example: DTCoolOff.cancelWithin(document.getElementById("domain-list"))
   */
  function cancelWithin(root) {
    for (const host of [...running.keys()]) {
      if (root.contains(host)) stopCoolOff(host);
    }
  }

  function startCoolOff(host, apply) {
    // A wait is already running here; the pill itself is how it gets cancelled.
    if (running.has(host)) return;

    const pill = DTDom.el(document, "button", COOL_OFF_CLASS, coolOffLabel(DTTollGuard.COOL_OFF_SECONDS));
    host.appendChild(pill);

    // The same clock as the gate's toll, and the same rule: it only runs while this
    // page is in front of the user. Waiting it out in another tab is not waiting.
    const control = DTCountdown.startFocusCountdown(DTTollGuard.COOL_OFF_SECONDS, {
      ...DTCountdown.pageActivity(document, window),
      onTick: (remaining) => {
        pill.textContent = coolOffLabel(remaining);
      },
      onDone: () => {
        running.delete(host);
        pill.remove();
        apply();
      }
    });

    running.set(host, control);
    pill.addEventListener("click", () => stopCoolOff(host));
  }

  /**
   * Apply a settings change, or make it wait first if it weakens the toll.
   * `host` is the row or control the countdown should appear inside.
   *
   * Example: DTCoolOff.commit(row, "blockedDomains", current, next, () => save(next))
   */
  async function commit(host, key, current, next, apply) {
    if (DTTollGuard.isWeakening(key, current, next) && (await coolOffIsOn())) {
      startCoolOff(host, apply);
      return;
    }
    await apply();
  }

  window.DTCoolOff = { isOn: coolOffIsOn, commit, cancelWithin };
})();
