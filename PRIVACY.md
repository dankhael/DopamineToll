# Privacy Policy — Dopamine Toll

**Effective date:** August 15, 2026

Dopamine Toll does **not collect, transmit, sell, or share any personal data**, and
makes **no network requests of any kind**. There is no analytics, no tracking, and no
remote server operated by the developer.

This applies identically to the Chrome and Firefox versions, which are built from the
same source.

## What the extension stores, and where

Everything you create stays inside your own browser, via the standard
[extension storage API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage):

| Data | Storage area | Leaves your device? |
|---|---|---|
| Block list, phrases, countdown / unlock timers, theme | `storage.sync` | No — see "Browser sync" below |
| Uploaded "north star" images, daily counter | `storage.local` | No |
| Per-tab unlock state | `storage.session` | No (cleared when the browser closes) |

## Browser sync

Settings saved in `storage.sync` are synchronized **only through your own browser
account, by the browser itself** — your Google account in Chrome, your Mozilla account in
Firefox — so they follow you across your signed-in devices. The developer does not run
this sync, never receives this data, and has no way to access it. If you have browser
sync turned off, this data stays only on the current device.

## Permissions

- **Host access (`<all_urls>`)** and **`webNavigation`** are used solely to detect when
  the current tab navigates to a site on *your* block list and to draw the friction
  overlay. Page content is never read, stored, or transmitted.
- **`storage`** is used to keep the settings and images described above inside the
  browser.

On Firefox, the extension declares `data_collection_permissions: { required: ["none"] }`
in its manifest — the browser's own machine-readable statement that it collects nothing.

## Data retention and deletion

The extension keeps your data until you remove it. You can delete individual items in the
settings page, and **uninstalling the extension removes all locally stored data**.

## Children's privacy

Dopamine Toll is a general-purpose productivity tool and is not directed at children. It
collects no data from anyone.

## Changes to this policy

If this policy changes, the updated version will be published at this same location with a
new effective date.

## Contact

Questions about this policy: **eraserheadsoftware@gmail.com**
