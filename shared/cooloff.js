// Runs the in-place cooling-off countdowns that guard weakening changes (ADR-0003):
// the control a change belongs to grows a pill showing the seconds left, clicking
// the pill cancels, and only reaching zero applies the change.
//
// The document and the countdown factory are injected rather than reached for, so
// the whole lifecycle — arm, tick, cancel, complete, and the cancel-on-rerender case
// — runs under Node against fakes. The surfaces that use it (options/cooloff.js)
// stay thin glue with nothing to test.
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

  const PILL_CLASS = "cooloff";

  function requireDep(value, name) {
    if (!value) {
      throw new Error(`createRunner needs ${name}, got: ${JSON.stringify(value)}`);
    }
  }

  function stopAt(state, host) {
    const pending = state.running.get(host);
    if (!pending) return;
    pending.control.stop();
    pending.pill.remove();
    state.running.delete(host);
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

  function startAt(state, host, apply) {
    // A wait is already running here; the pill itself is how it gets cancelled.
    if (state.running.has(host)) return;

    const pill = DTDom.el(state.doc, "button", PILL_CLASS, state.label(state.seconds));
    host.appendChild(pill);

    const control = state.startCountdown(state.seconds, {
      onTick: (remaining) => {
        pill.textContent = state.label(remaining);
      },
      onDone: () => {
        state.running.delete(host);
        pill.remove();
        apply();
      }
    });

    state.running.set(host, { control, pill });
    pill.addEventListener("click", () => stopAt(state, host));
  }

  /**
   * Build a coordinator over one page's cooling-off countdowns.
   *
   * `label(remaining)` returns the pill's text, `startCountdown(seconds, { onTick,
   * onDone })` returns a control with stop() — inject the focus-aware one from
   * shared/countdown.js so the wait obeys the same rule as the gate's toll.
   *
   * @example
   *   const runner = createRunner({
   *     doc: document,
   *     seconds: 30,
   *     label: (left) => `${left}s · cancel`,
   *     startCountdown: (s, hooks) =>
   *       DTCountdown.startFocusCountdown(s, { ...DTCountdown.pageActivity(document, window), ...hooks })
   *   });
   *   runner.start(row, () => removeTheSite());
   */
  function createRunner({ doc, seconds, label, startCountdown }) {
    requireDep(doc, "a document");
    requireDep(typeof label === "function" || null, "a label function");
    requireDep(typeof startCountdown === "function" || null, "a startCountdown function");

    // Every countdown currently running, by the control it belongs to.
    const state = { doc, seconds, label, startCountdown, running: new Map() };

    return {
      start: (host, apply) => startAt(state, host, apply),
      stopAt: (host) => stopAt(state, host),
      cancelWithin: (root) => cancelWithin(state, root),
      isPending: (host) => state.running.has(host)
    };
  }

  return { PILL_CLASS, createRunner };
});
