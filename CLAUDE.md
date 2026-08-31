# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Tab Cleaner is a Chrome Manifest V3 extension that automatically closes browser tabs that have been idle
(not the active tab in their window) for longer than a configurable threshold. It has no build step — the
source files are loaded by Chrome directly.

## Development / testing

There is no build tool, package manager, or linter in this repo — it's plain unbundled JS loaded straight
into Chrome. The one exception is `scripts/history-utils.js`, whose logic is pure (no `chrome.*` calls) and
has a real Node test suite: run `node --test tests/*.test.js` from the repo root (no install needed, it's
`node:test`/`node:assert` from the standard library). Plain `node --test` with no arguments also works (it
auto-discovers `tests/`), but on current Node the seemingly-equivalent `node --test tests/` does not — Node
treats a bare directory argument as a single file/glob rather than expanding it, and errors with "Cannot
find module".

To try changes:
1. Open `chrome://extensions`, enable "Developer mode".
2. "Load unpacked" and select this directory (or "Reload" the extension if already loaded).
3. Background service worker logs are visible via the "service worker" link on the extension's card in
   `chrome://extensions` (look for `[TabCleaner]`-prefixed `console.log`/`console.warn`/`console.error` lines).
4. Popup UI logic can be debugged by right-clicking the extension's toolbar icon → "Inspect popup".

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
  first, used to render the "recently closed" list and let the user reopen a tab from it). Each entry also
  carries an `openedAt` timestamp alongside the pre-existing `closedAt`, so the popup can show a lifetime
  range (see `buildHistoryEntry()`/`formatLifetime()` in `scripts/history-utils.js`). For tabs that already
  existed before the extension's `onInstalled`/`onStartup` ran, `openedAt` is only an approximation — the
  true creation time isn't knowable, so it's backfilled to that startup time (the same approximation
  `lastActivated` init already made, now extended to `tabCreated` below).
- `chrome.storage.session`: two parallel `{ tabId: timestamp }` maps, both rebuilt from scratch in
  `initTabTimestamps()` on `onInstalled`/`onStartup` and kept current incrementally by the same
  `chrome.tabs.onActivated`/`onCreated`/`onRemoved` listeners in `background.js`:
  - `lastActivated` — when each tab was last focused/created. This is the source of truth the alarm handler
    uses to compute idle time — the popup only reads it for display.
  - `tabCreated` — when each tab was created (not updated on focus). The alarm handler reads this to
    compute a closed tab's `openedAt` when recording it into `closeHistory`.

  `lastActivated` and `tabCreated` must be kept in sync: every listener/handler that reads, writes, or
  deletes one (`onActivated`, `onCreated`, `onRemoved`, and the alarm handler's cleanup of stale/closed tab
  IDs) does the same to the other. If you add a new event handler that touches tab timestamps, update both
  maps together.

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
