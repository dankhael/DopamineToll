// Runs the in-place cooling-off countdowns that guard weakening changes (ADR-0003).
// The control a change belongs to *becomes* the countdown: the whole card is
// marked pending, a fuse burns along its bottom edge, and a status line says what
// is about to happen ("removed in 28s") beside a cancel button. CSS decides what
// pending looks like per control (assets/controls.css) — a switch slides to its
// new side, a remove button gives its place to the status — so the response lands
// where the user just clicked, and nothing below it jumps.
//
// The document and the countdown factory are injected rather than reached for, so
// the whole lifecycle — arm, tick, pause, cancel, complete, and the
// cancel-on-rerender case — runs under Node against fakes. The surfaces that use
// it (shared/guardedchange.js) stay thin glue.
//
// Nothing here is persisted. Countdowns on different controls are independent, and
// dropping the page abandons every pending one, which costs the user the wait rather
// than saving progress toward weakening the toll.
//
// Dual export: attaches window.DTCoolOff as a classic script; under Node (require)
// it returns the same API via module.exports.
(function (root, factory) {
  const api = factory(
    typeof module !== "undefined" && module.exports ? require("./dom.js") : root.DTDom
  );
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DTCoolOff = api;
})(typeof self !== "undefined" ? self : this, function (DTDom) {
  "use strict";

  // The status + cancel pair the runner puts inside a control. It lands in the
  // control's .cooloff-slot when it has one (the line holding a switch or a
  // stepper's number), else at the end of the control itself.
  const PILL_CLASS = "cooloff";
  const SLOT_CLASS = "cooloff-slot";
  // On the control while a wait is owed, and while that wait is frozen because the
  // page is not in front of the user.
  const PENDING_CLASS = "cooloff-pending";
  const PAUSED_CLASS = "cooloff-paused";
  // The share of the wait still owed, 1 → 0. Set on the control, whose bottom edge
  // draws it as the fuse.
  const LEFT_VAR = "--cooloff-left";

  function requireDep(value, name) {
    if (!value) {
      throw new Error(`createRunner needs ${name}, got: ${JSON.stringify(value)}`);
    }
  }

  /**
   * How much of the fuse to draw, 1 = full. While the clock runs the bar aims at
   * where it will be at the next tick, so a one-second linear transition turns the
   * once-a-second updates into a continuous burn that empties exactly at zero.
   * Frozen, it shows precisely what is owed.
   *
   * @example
   *   fuseLevel(30, 30, true)   // 29/30 — draining toward the next tick
   *   fuseLevel(12, 30, false)  // 12/30 — paused, nothing in flight
   */
  function fuseLevel(remaining, seconds, running) {
    if (!(seconds > 0)) {
      throw new Error(`fuseLevel needs seconds above zero, got: ${JSON.stringify(seconds)}`);
    }
    const owed = running ? remaining - 1 : remaining;
    return Math.min(1, Math.max(0, owed / seconds));
  }

  function buildPill(state, host) {
    const pill = DTDom.el(state.doc, "span", PILL_CLASS);
    const secs = DTDom.el(state.doc, "span", "cooloff-secs", state.label(state.seconds, host));
    const cancel = DTDom.el(state.doc, "button", "cooloff-cancel", state.cancelText);
    pill.append(secs, cancel);
    return { pill, secs, cancel };
  }

  function paint(state, entry, remaining, running) {
    entry.secs.textContent = state.label(remaining, entry.host);
    entry.host.style.setProperty(LEFT_VAR, String(fuseLevel(remaining, state.seconds, running)));
    entry.host.classList.toggle(PAUSED_CLASS, !running);
  }

  const isRendered = (node) =>
    typeof node.getClientRects === "function" && node.getClientRects().length > 0;

  // The control that started the wait is often hidden by it — a remove button or a
  // stepper's −/+ gives its place to the status. If it had keyboard focus, focus
  // follows onto cancel, so Enter calls the wait off instead of landing on nothing.
  function adoptFocus(state, entry) {
    const active = state.doc.activeElement;
    if (!active || active === entry.host || !entry.host.contains(active)) return;
    entry.trigger = active;
    if (!isRendered(active)) entry.cancel.focus();
  }

  // And hands it back when cancel goes, if the trigger is still on the page.
  function returnFocus(state, entry) {
    if (!entry.trigger || state.doc.activeElement !== entry.cancel) return;
    if (entry.trigger.isConnected) entry.trigger.focus();
  }

  const slotOf = (host) => host.querySelector("." + SLOT_CLASS) || host;

  // Paint a full fuse and make the browser register it before the clock starts:
  // without the style flush, "full" and "one second down" land in the same frame
  // and the freshly drawn fuse starts a second ahead instead of burning from the
  // top. Reading offsetWidth is the flush; on a fake it is a harmless no-op.
  function mount(state, entry) {
    entry.host.classList.add(PENDING_CLASS);
    entry.host.style.setProperty(LEFT_VAR, "1");
    slotOf(entry.host).appendChild(entry.pill);
    void entry.host.offsetWidth;
    adoptFocus(state, entry);
  }

  function unmount(state, entry) {
    returnFocus(state, entry);
    entry.pill.remove();
    entry.host.classList.remove(PENDING_CLASS, PAUSED_CLASS);
    entry.host.style.removeProperty(LEFT_VAR);
  }

  function stopAt(state, host) {
    const entry = state.running.get(host);
    if (!entry) return;
    state.running.delete(host);
    if (entry.control) entry.control.stop();
    unmount(state, entry);
  }

  /**
   * Cancel every cooling-off inside `root`. Rebuilding a list destroys the rows its
   * countdowns are attached to, leaving them ticking invisibly against a copy of the
   * list that is already stale. Cancelling fails safe — the toll stays as it is.
   */
  function cancelWithin(state, root) {
    for (const host of [...state.running.keys()]) {
      if (root === host || root.contains(host)) stopAt(state, host);
    }
  }

  function hooksFor(state, entry, apply) {
    return {
      onTick: (remaining) => paint(state, entry, remaining, true),
      onResume: (remaining) => paint(state, entry, remaining, true),
      onPause: (remaining) => paint(state, entry, remaining, false),
      onDone: () => {
        state.running.delete(entry.host);
        unmount(state, entry);
        apply();
      }
    };
  }

  // Registered before the clock starts, because a clock may finish synchronously
  // (a zero-second wait does): registering afterwards left a finished wait marked
  // as pending forever, and the control refused every later change.
  function startAt(state, host, apply) {
    // A wait is already running here; its cancel button is how it gets called off.
    if (state.running.has(host)) return;
    const entry = { host, ...buildPill(state, host), control: null, trigger: null };
    mount(state, entry);
    state.running.set(host, entry);
    entry.control = state.startCountdown(state.seconds, hooksFor(state, entry, apply));
    entry.cancel.addEventListener("click", () => stopAt(state, host));
  }

  /**
   * Build a coordinator over one page's cooling-off countdowns.
   *
   * `label(remaining, host)` returns the status text for that control ("removed in
   * 28s") — the host is passed so each control can say what is about to happen to
   * it. `cancelText` labels the button beside it, and `startCountdown(seconds,
   * { onTick, onPause, onResume, onDone })` returns a control with stop() — inject
   * the focus-aware one from shared/countdown.js so the wait obeys the same rule as
   * the gate's toll.
   *
   * @example
   *   const runner = createRunner({
   *     doc: document,
   *     seconds: 30,
   *     label: (left, host) => `${host.dataset.verb} in ${left}s`,
   *     cancelText: "cancel",
   *     startCountdown: (s, hooks) =>
   *       DTCountdown.startFocusCountdown(s, { ...DTCountdown.pageActivity(document, window), ...hooks })
   *   });
   *   runner.start(row, () => removeTheSite());
   */
  function createRunner({ doc, seconds, label, cancelText, startCountdown }) {
    requireDep(doc, "a document");
    requireDep(typeof label === "function" || null, "a label function");
    requireDep(typeof cancelText === "string" || null, "a cancelText string");
    requireDep(typeof startCountdown === "function" || null, "a startCountdown function");

    // Every countdown currently running, by the control it belongs to.
    const state = { doc, seconds, label, cancelText, startCountdown, running: new Map() };

    return {
      start: (host, apply) => startAt(state, host, apply),
      stopAt: (host) => stopAt(state, host),
      cancelWithin: (root) => cancelWithin(state, root),
      isPending: (host) => state.running.has(host)
    };
  }

  return { PILL_CLASS, SLOT_CLASS, PENDING_CLASS, PAUSED_CLASS, LEFT_VAR, fuseLevel, createRunner };
});
