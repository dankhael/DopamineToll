/* Dopamine Toll — promo video copy (i18n).
   Same mechanism as the store screenshots: a global `STRINGS = { en:{...} }`,
   nodes carry data-t="key", open with ?lang=xx to switch. To add a language,
   duplicate the whole `en` block, rename the key (de/fr/ja/pt/zh), translate the
   VALUES only, keep the {s} token and any HTML tags. Then register it in
   tools/record.mjs LANGS so it exports.

   Dynamic strings (the ticking clock, the "unlocks in {s}s" sub-label) are read
   from window.DICT by video/timeline.js — that's why the resolved dict is
   published here rather than only applied to the DOM. */
const STRINGS = {
  en: {
    // ── scene captions (kicker + headline) ──
    capGateK:  "every scroll has a price",
    capGateH:  "A countdown you can't skip.",
    capNudgeK: "it doesn't stop at the door",
    capNudgeH: "Nudges, in your own words.",
    capCtrlK:  "your list, your rules",
    capCtrlH:  "You set the price.",

    // ── gate scene (the toll overlay) ──
    gArmed:     "● toll armed",
    gOnList:    "on your toll list",
    gPin:       "north star",
    gPhrase:    "your future self will thank you",
    gYou:       "— you, to yourself",
    gTollLabel: "you can choose in",
    gClose:     "Close tab",
    gCloseSub:  "be productive",
    gOpen:      "Open anyway · 10 min",
    gOpenLocked: "unlocks in {s}s", // {s} = live remaining seconds
    gOpenReady:  "10 min",

    // ── nudge scene (in-feed cards) ──
    nArmed:  "toll armed",
    nP1name: "Jordan Reyes",
    nP1text: "wait until the very end 😭 this edit goes so hard, watched it like six times already",
    nP2name: "Sam Okafor",
    nP2text: "nobody:\nme at 2am: just one more video and then i'll actually go to bed i promise this time for real",
    nT1msg:  "every minute here is a minute away from what matters",
    nT2msg:  "you have bigger goals than this",
    nTime:   "15 min",
    nOnTab:  "on this tab",

    // ── control scene (settings) ──
    cListH:   "Toll list",
    cRowtag:  "one section only",
    cRemove:  "remove",
    cInputPh: "example.com or youtube.com/shorts",
    cAdd:     "Add",
    cCountK:  "Countdown",
    cCountD:  "before you can choose",
    cWinK:    "Unlock window",
    cWinD:    "how long a pass lasts",

    // ── outro ──
    oHeadline: "Put a price on <span class=\"am\">distraction.</span>",
    oPriv:     "Runs entirely on your device — no accounts, no trackers, no network.",
    oCta:      "Add to Chrome",
  },
};

/* Resolve the active language once, publish the dict for the timeline, and
   fill every [data-t] node. Kept tiny and self-contained so the video folder
   has no dependency on the screenshots' i18n.js. */
(function applyStrings() {
  const lang = new URLSearchParams(location.search).get("lang") || "en";
  const dict = STRINGS[lang] || STRINGS.en;
  window.DICT = dict;
  const fill = () => {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-t]").forEach((el) => {
      const key = el.getAttribute("data-t");
      if (dict[key] != null) el.innerHTML = dict[key];
    });
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fill);
  } else {
    fill();
  }
})();
