# Privacy Policy — Dopamine Toll

**Effective date:** June 22, 2026

Dopamine Toll does **not collect, transmit, sell, or share any personal data**, and
makes **no network requests of any kind**. There is no analytics, no tracking, and no
remote server operated by the developer.

## What the extension stores, and where

Everything you create stays inside your own browser, via the standard
[`chrome.storage`](https://developer.chrome.com/docs/extensions/reference/api/storage)
API:

| Data | Storage area | Leaves your device? |
|---|---|---|
| Block list, phrases, countdown / unlock timers, theme | `chrome.storage.sync` | No — see "Chrome Sync" below |
| Uploaded "north star" images, daily counter | `chrome.storage.local` | No |
| Per-tab unlock state | `chrome.storage.session` | No (cleared when the browser closes) |

## Chrome Sync

Settings saved in `chrome.storage.sync` are synchronized **only through your own
Google/Chrome account, by the browser itself**, so they follow you across your signed-in
devices. The developer does not run this sync, never receives this data, and has no way
to access it. If you have Chrome Sync turned off, this data stays only on the current
device.

## Permissions

- **Host access (`<all_urls>`)** and **`webNavigation`** are used solely to detect when
  the current tab navigates to a site on *your* block list and to draw the friction
  overlay. Page content is never read, stored, or transmitted.
- **`storage`** is used to keep the settings and images described above inside the
  browser.

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
