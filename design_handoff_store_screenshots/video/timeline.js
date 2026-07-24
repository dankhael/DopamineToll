/* Dopamine Toll — promo video timeline engine.
   Every motion is a paused Web Animations API animation created with fill:'both'
   and a global `delay` (its start time on the video clock). seek(t) then sets
   currentTime = t on ALL of them, so any frame is reproducible from t alone —
   no wall-clock dependency. tools/record.mjs drives seek(t) frame by frame;
   opened in a browser without ?capture the page plays itself on a rAF loop.

   Adding/retiming a beat = edit the SCENES data below. Keep transforms to
   translate/scale (composited independently of `transform`) so entrance and
   emphasis animations on the same node never clobber each other. */
(() => {
  "use strict";

  const FPS = 60;
  const DURATION = 33000; // ms — keep in sync with the ffmpeg mux
  const CAPTURE = new URLSearchParams(location.search).has("capture");

  // Scene windows [start, end] in ms on the video clock.
  const SCENE = {
    gate:  [0, 10500],
    nudge: [10500, 19000],
    ctrl:  [19000, 26500],
    outro: [26500, DURATION],
  };

  const EASE = {
    out:    "cubic-bezier(0.16, 1, 0.3, 1)",   // decelerate — entrances
    inout:  "cubic-bezier(0.65, 0, 0.35, 1)",  // symmetric — cross-fades
    back:   "cubic-bezier(0.34, 1.56, 0.64, 1)", // slight overshoot — tumble/pop
    linear: "linear",                          // the countdown only
  };

  const KF = {
    fadeUp:  [{ opacity: 0, translate: "0 20px" }, { opacity: 1, translate: "0 0" }],
    fadeIn:  [{ opacity: 0 }, { opacity: 1 }],
    fadeOut: [{ opacity: 1 }, { opacity: 0 }],
    pop:     [{ opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1 }],
  };

  const anims = [];

  /** Create paused animation(s) for every node matching `sel`.
   *  at/dur in ms on the video clock; `stagger` offsets each matched node. */
  function add(sel, keyframes, at, dur, ease = "out", stagger = 0) {
    const nodes = document.querySelectorAll(sel);
    nodes.forEach((el, i) => {
      const a = el.animate(keyframes, {
        delay: at + i * stagger,
        duration: dur,
        easing: EASE[ease] || ease,
        fill: "both",
      });
      a.pause();
      anims.push(a);
    });
  }

  /** Standard scene cross-fade: rise in at `start`, fall out before `end`.
   *  Pass fadeOut=false for the last scene so the final frame holds. */
  function sceneFade(name, appearAt, fadeOut = true) {
    const [a, b] = SCENE[name];
    add(`[data-scene="${name}"]`, KF.fadeUp, appearAt ?? a, 600, "out");
    if (fadeOut) add(`[data-scene="${name}"]`, KF.fadeOut, b - 450, 450, "inout");
  }

  // ─────────────────────────────── GATE ───────────────────────────────
  function buildGate() {
    const [s] = SCENE.gate;
    sceneFade("gate", s + 150);
    add("#g-cap", KF.fadeUp, s + 500, 700);
    add("#g-chrome", KF.pop, s + 250, 700);
    add("#g-toll", [{ opacity: 0, translate: "0 -22px" }, { opacity: 1, translate: "0 0" }], s + 750, 650);
    add("#g-photo", KF.pop, s + 1400, 700);
    add("#g-phrase", KF.fadeUp, s + 1850, 700);
    add("#g-tollblock", KF.fadeUp, s + 1500, 600);
    // meter drains left-to-right over the compressed countdown window.
    add("#g-meter", [{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], s + 1600, 7400, "linear");
    // at zero: the locked button un-ghosts and the cursor lands on Close tab.
    add("#g-open", [{ borderColor: "var(--line)", color: "var(--faint)" },
                    { borderColor: "rgba(233,162,76,0.5)", color: "var(--amber-soft)" }], s + 9000, 450);
    add("#g-cursor", [{ opacity: 0 }, { opacity: 1 }], s + 8200, 300);
    add("#g-cursor", { translate: ["120px 150px", "-70px 250px"] }, s + 8300, 1100, "out");
    add("#g-cursor", { scale: [1, 0.82, 1] }, s + 9500, 420, "back");
    add("#g-close", { scale: [1, 0.965, 1] }, s + 9520, 420, "back");
  }

  // ─────────────────────────────── NUDGE ──────────────────────────────
  function buildNudge() {
    const [s] = SCENE.nudge;
    sceneFade("nudge", s + 200);
    add("#n-cap", KF.fadeUp, s + 500, 700);
    add("#n-xb", KF.pop, s + 300, 700);
    add(".n-post", KF.fadeUp, s + 700, 550, "out", 160);
    // the tumble: one card, then a second, then a third — each wave piles on.
    add("#n-t1", [{ opacity: 0, translate: "0 -46px", rotate: "-7deg", scale: 0.9 },
                  { opacity: 1, translate: "0 0", rotate: "-2deg", scale: 1 }], s + 1500, 750, "back");
    add("#n-t2", [{ opacity: 0, translate: "0 -46px", rotate: "6deg", scale: 0.9 },
                  { opacity: 1, translate: "0 0", rotate: "2.5deg", scale: 1 }], s + 2700, 750, "back");
    add("#n-t3", [{ opacity: 0, translate: "0 -40px", rotate: "-4deg", scale: 0.9 },
                  { opacity: 1, translate: "0 0", rotate: "-1.5deg", scale: 1 }], s + 3600, 700, "back");
  }

  // ─────────────────────────────── CONTROL ────────────────────────────
  function buildCtrl() {
    const [s] = SCENE.ctrl;
    sceneFade("ctrl", s + 200);
    add("#c-cap", KF.fadeUp, s + 500, 700);
    add("#c-list", KF.pop, s + 350, 650);
    add(".c-item", KF.fadeUp, s + 900, 500, "out", 180); // items land like they were typed in
    add("#c-steps", KF.pop, s + 700, 650);
    add(".c-ctrl", KF.fadeUp, s + 1100, 500, "out", 180);
  }

  // ─────────────────────────────── OUTRO ──────────────────────────────
  function buildOutro() {
    const [s] = SCENE.outro;
    sceneFade("outro", s + 150, false);
    // the countdown-gauge mark draws itself (stroke offset 176 → 0 = full ring).
    add("#o-ring", { strokeDashoffset: [176, 0] }, s + 300, 900, "out");
    add("#o-wm", KF.fadeUp, s + 700, 700);
    add("#o-headline", KF.fadeUp, s + 1100, 700);
    add("#o-priv", KF.fadeUp, s + 1500, 700);
    add("#o-cta", KF.pop, s + 1900, 650, "back");
  }

  // ───────────────────────── dynamic (text) frames ────────────────────
  const pad = (n) => String(n).padStart(2, "0");

  /** Ease a whole-number counter from a→b across [t0,t1]. */
  function counter(t, t0, t1, a, b) {
    if (t <= t0) return a;
    if (t >= t1) return b;
    return Math.round(a + (b - a) * ((t - t0) / (t1 - t0)));
  }

  function dynamic(t) {
    const D = window.DICT || {};
    // gate countdown: 30 → 0 across the drain window, mirrored on the sub-label.
    const cs = 1600, ce = 9000;
    let rem = 30;
    if (t >= ce) rem = 0;
    else if (t > cs) rem = Math.ceil(30 * (1 - (t - cs) / (ce - cs)));
    const clock = document.getElementById("g-clock");
    if (clock) clock.textContent = "00:" + pad(rem);
    const sub = document.getElementById("g-open-sub");
    if (sub) {
      sub.textContent = t >= ce
        ? (D.gOpenReady || "10 min")
        : (D.gOpenLocked || "unlocks in {s}s").replace("{s}", rem);
    }
    // control steppers count up to their real defaults (30s / 10min).
    const cnt = document.getElementById("c-count-val");
    if (cnt) cnt.textContent = counter(t, 19700, 20500, 10, 30);
    const win = document.getElementById("c-win-val");
    if (win) win.textContent = counter(t, 19900, 20700, 1, 10);
  }

  // ─────────────────────────────── seek ───────────────────────────────
  function seek(t) {
    const clamped = t < 0 ? 0 : t;
    for (const a of anims) a.currentTime = clamped;
    dynamic(clamped);
  }

  function build() {
    buildGate();
    buildNudge();
    buildCtrl();
    buildOutro();
    window.seek = seek;
    window.VIDEO = { fps: FPS, durationMs: DURATION };
    seek(0);
    if (!CAPTURE) play();
  }

  // Live preview loop — only when a human opened the page (not during capture).
  function play() {
    let t0 = null;
    const loop = (ts) => {
      if (t0 == null) t0 = ts;
      seek((ts - t0) % DURATION);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
