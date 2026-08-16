# Notes for the AMO reviewer

Paste the section below into the "Notes for reviewers" field when submitting a new
version to addons.mozilla.org. Keep it current — a stale note is worse than none.

**AMO caps that field at 3000 characters and this document does not fit.** Paste
[amo-reviewer-notes-3000.txt](./amo-reviewer-notes-3000.txt) instead — it is this
document trimmed to 2869 characters, keeping the four points that decide the review
(why `<all_urls>` is unavoidable, no network or data collection, the remaining
`innerHTML` uses, and the intentional dual `background` keys). Edit both together, or
the short version silently goes stale — the field is editable after submission, so
there is no excuse to paste an outdated one.

---

**Source:** this add-on is unminified, unobfuscated, dependency-free vanilla JavaScript.
Every file in the package is the original source. Public repository:
https://github.com/dankhael/DopamineToll

**What it does:** when the user navigates to a site on a list *they* configured, the
extension covers the page with a full-screen overlay and runs a countdown. When it ends
the user chooses: close the tab, or open the site anyway for a time limit they set. There
is no hard block — the extension only adds friction.

**Why `<all_urls>` is required.** The block list is user-defined and editable at runtime
(default seeds: twitter.com, x.com, instagram.com, tiktok.com, youtube.com/shorts). The
extension cannot know at install time which hosts a given user will add, so it cannot
declare a static host list. The permission is used for exactly two things:

1. `webNavigation.onCommitted` / `onHistoryStateUpdated` to learn that the active tab
   moved to a listed host — `onHistoryStateUpdated` is required because the target sites
   are single-page apps whose route changes never trigger a document load.
2. Injecting the overlay content script that draws the gate.

Page content is never read, inspected, stored, or transmitted. The content script only
appends its own overlay node and observes for its removal.

**Network:** the extension makes no network requests of any kind. There is no remote
code, no analytics, no telemetry, no accounts, no ads, and no server operated by the
developer. `data_collection_permissions` is declared as `required: ["none"]`. Full
policy: https://github.com/dankhael/DopamineToll/blob/main/PRIVACY.md

**Storage:** `storage.sync` for settings, `storage.local` for user-uploaded images and
the daily counter, `storage.session` for per-tab unlock state. All browser-local.

**About the three `innerHTML` assignments flagged by the linter**
(`content/friction.js`, `popup/popup.js`, `shared/i18n.js`): these render localized
strings from the extension's own `_locales` catalogs, which contain `<b>` markup so
translators can control emphasis and word order — a requirement for the ja/de/zh_CN
translations, where splitting the sentence would break grammatical order. The
substituted values are never user input: they are integers (`String(count)`) and the
extension's own formatted elapsed-time string. Every value that *does* originate from the
user — block-list entries, phrases, north-star image data, the current domain — is
written with `textContent` or assigned to `img.src`, never interpolated into markup. The
remaining overlay and list rendering was converted to DOM construction for this release.

**Manifest note:** `background` declares both `service_worker` (Chrome) and `scripts`
(Firefox) so a single manifest serves both stores. Firefox ignores the former; the
`BACKGROUND_SERVICE_WORKER_IGNORED` linter warning is expected and intentional.

**Testing the gate:** install, open the popup to confirm the toll list is seeded, then
visit `https://x.com`. The overlay should appear before the page paints, with a
countdown. Note the countdown deliberately pauses when the tab loses focus — this is by
design (users must not be able to wait it out in a background tab), so keep the tab
focused while testing.
