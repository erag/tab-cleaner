# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Tab Cleaner is a Chrome Manifest V3 extension that automatically closes browser tabs that have been idle
(not the active tab in their window) for longer than a configurable threshold. It has no build step — the
source files are loaded by Chrome directly.

## Development / testing

There is no build tool, package manager, linter, or test suite in this repo — it's plain unbundled JS loaded
straight into Chrome.

To try changes:
1. Open `chrome://extensions`, enable "Developer mode".
2. "Load unpacked" and select this directory (or "Reload" the extension if already loaded).
3. Background service worker logs are visible via the "service worker" link on the extension's card in
   `chrome://extensions` (look for `[TabCleaner]`-prefixed `console.log`/`console.warn`/`console.error` lines).
4. Popup UI logic can be debugged by right-clicking the extension's toolbar icon → "Inspect popup".

The one exception is `scripts/history-utils.js`, whose logic is pure (no `chrome.*` calls) and has a real
Node test suite: run `node --test tests/` (requires Node 18+; no install needed, it's `node:test`/
`node:assert` from the standard library).

## Architecture

Three independent runtime contexts communicate only through `chrome.storage` (no message passing between
popup and background):

- **`background.js`** — the MV3 service worker; the only place that decides when to close a tab and does
  the closing. Runs on a `chrome.alarms` timer (`tab-cleaner-check`, fires every 1 minute).
- **`popup/`** — the toolbar popup UI (`popup.html`/`.js`/`.css`). Reads/writes the same
  `chrome.storage.local` settings and independently recomputes an idle-tab count for display; it does not
  trigger closes itself.
- **`scripts/detect-input.js`** — a standalone script injected via `chrome.scripting.executeScript` into a
  *candidate-for-closing* tab, on demand, right before closing it. Returns `true` if the page has
  form fields with user-modified (unsaved) values, in which case the close is aborted for that tab.

### State model

- `chrome.storage.local`: persisted settings (`enabled`, `idleThreshold` in ms, `protectAudio`,
  `protectInput`) plus `closeHistory` (ring buffer of up to `MAX_HISTORY` = 50 closed-tab records, newest
  first, used to render the "recently closed" list and let the user reopen a tab from it).
- `chrome.storage.session`: `lastActivated`, a `{ tabId: timestamp }` map of when each tab was last
  focused/created. Rebuilt from scratch in `initLastActivated()` on `onInstalled`/`onStartup`, and kept
  current incrementally by the `chrome.tabs.onActivated`/`onCreated`/`onRemoved` listeners in
  `background.js`. This is the source of truth the alarm handler uses to compute idle time — the popup only
  reads it for display.

### Close decision flow (`chrome.alarms.onAlarm` in `background.js`)

For each tracked tab, in order:
1. Skip if `idleTime < idleThreshold` or the extension is disabled.
2. Never close a tab that is the active tab in its window (checked via `chrome.tabs.query({ active: true })`).
3. Skip if `protectAudio` is on and the tab is `audible`.
4. If the tab's URL matches `RESTRICTED_SCHEMES` (`chrome:`, `about:`, `chrome-extension:`, `devtools:`,
   `data:`, `javascript:`, `blob:` — scripts can't be injected into these), it's closed directly without a
   form-input check.
5. Otherwise, if `protectInput` is on, `scripts/detect-input.js` is injected to check for unsaved form
   input; if injection itself fails, the tab is protected (not closed) rather than assuming it's safe.
6. Every tab actually closed is recorded via `recordClose()` into `closeHistory` before `chrome.tabs.remove`.

When changing this flow, keep the ordering intent: cheap/synchronous protections (active tab, audio,
restricted scheme) are checked before the async form-input injection, since the injection is the expensive
step and only applies to ordinary http(s)-like pages.

### Settings

Both `background.js` and `popup/popup.js` independently define the same `DEFAULT_SETTINGS` object and read
settings via `chrome.storage.local.get(DEFAULT_SETTINGS)` (which uses the passed object as per-key
defaults). If you add or rename a setting, update `DEFAULT_SETTINGS` in *both* files.
