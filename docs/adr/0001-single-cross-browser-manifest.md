# One manifest for both Chrome and Firefox

Shipping to the Firefox Add-ons store alongside the Chrome Web Store needed a way to
express two incompatible background models: Chrome MV3 requires
`background.service_worker`, Firefox MV3 does not support it and uses an event page via
`background.scripts`. We declare **both keys in a single `manifest.json`** — each browser
reads the one it supports and ignores the other — rather than maintaining per-browser
manifests or a build-time merge step.

## Considered options

- **Two full manifests** (`manifest.chrome.json` / `manifest.firefox.json`) — rejected:
  ~90% identical, and a permission added to one but not the other ships a broken package
  to one store with nothing to catch it.
- **A base manifest plus per-browser overlays merged at build time** — rejected once the
  single-manifest approach was proven viable; it buys nothing and adds a build step that
  both packagers (`build.mjs` and `package.ps1`) would have to implement identically.

## Consequences

- `web-ext lint` emits `BACKGROUND_SERVICE_WORKER_IGNORED` on every run. It is
  informational — the documented cross-browser pattern — and must not be "fixed" by
  removing `service_worker`, which would break the Chrome build.
- `background.type: "module"` was removed. Nothing in the codebase uses `import` or
  `export`, so it was gratuitous, and dropping it avoids the question of ES-module
  support in Firefox event pages entirely.
- `options_page` became `options_ui` with `open_in_tab: true` — both browsers support
  `options_ui`, only Chrome supports `options_page`.
- `manifest.json` stays a single file at the repo root, so `package.ps1` keeps working
  unchanged.
- Verified empirically: `web-ext lint` reports 0 errors, and Firefox 153 installs the
  unified manifest against the real source without a load error. The Chrome side rests on
  documented behaviour (unknown keys warn but load) — no Chromium was available to test.
