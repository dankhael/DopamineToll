# No `browser.*` shim — `chrome.*` is used directly on Firefox

The codebase calls `chrome.*` with `await` in ~35 places. Mozilla's porting documentation
says Firefox exposes `chrome.*` with **callbacks** and `browser.*` with promises, which
would mean every one of those calls returns `undefined` on Firefox. That guidance
describes **Manifest V2**: under **MV3, Firefox returns promises from the `chrome.*`
namespace**. This extension is MV3, so we ship `chrome.*` unchanged — no
`webextension-polyfill`, no hand-rolled `const api = globalThis.browser ?? chrome` shim.

**Do not "fix" this by adding a polyfill.** Seeing `chrome.*` in a codebase that runs on
Firefox looks like a bug and is not one.

## Evidence

Measured, not assumed — an MV3 test extension loaded into Firefox 153 via `web-ext`:

```
chromeNS=object          browserNS=object
getReturns=[object Promise]        isThenable=true
destructureOK=yes                  ← await + destructuring both work
```

## Consequences

- Zero source changes were needed for the Firefox port at the API layer; the port is a
  manifest and packaging concern (see ADR-0001).
- This ties us to `browser_specific_settings.gecko.strict_min_version`. The behaviour was
  verified on Firefox 153; the declared minimum is 140. If the minimum is ever lowered
  below the version where MV3 promise support landed, re-test — the shim question reopens.
