# Tab Cleaner

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Manifest](https://img.shields.io/badge/Manifest-V3-blue.svg)](./manifest.json)
[![No build step](https://img.shields.io/badge/build-none-lightgrey.svg)](#development)

A Chrome extension that automatically closes tabs you've forgotten about — idle for too long, and safe to close.

**English** (this page) · [中文说明](./README.zh-CN.md)

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Permissions](#permissions)
- [Development](#development)
- [Project Structure](#project-structure)
- [Known Limitations](#known-limitations)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Idle threshold** — configure how long a tab must sit unfocused before it's considered idle (default 30
  minutes), in minutes or hours.
- **Protection rules**
  - Tabs playing audio (video/music) are never closed.
  - Tabs with unsaved form input (a modified but not-yet-submitted field) are never closed — checked by
    injecting a detection script right before closing.
  - The currently active tab in every window is never closed.
- **Live stats** — the popup shows how many tabs are open and how many are already past the idle threshold
  and eligible for the next cleanup pass.
- **Close history** — every tab the extension auto-closes is recorded (URL, title, and how long it was
  open for). Click an entry to reopen it.

## Installation

There's no build step — the extension loads straight from source:

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select this repository's root directory.
5. Done — the Tab Cleaner icon appears in your toolbar.

After pulling updates, click the reload icon on the extension's card in `chrome://extensions` — no need to
load it again.

## Usage

Click the toolbar icon to open the popup:

- The toggle in the top right enables/disables the extension entirely.
- **Idle threshold** sets how long before a tab counts as idle.
- **Protection rules** lets you opt tabs with audio or unsaved input out of auto-closing.
- **Close history** lists recently closed tabs — click one to reopen it.

In the background, the extension checks every minute and closes any tab that's idle, not the active tab in
its window, and not excluded by a protection rule.

## Permissions

| Permission | Why it's needed |
|---|---|
| `tabs` | Read each tab's URL/title/audio state, and close tabs |
| `alarms` | Run the idle check once a minute |
| `storage` | Save settings and close history (persisted), and per-tab activity timestamps (session-only) |
| `scripting` | Inject a detection script before closing a tab, to check for unsaved form input |
| `host_permissions: <all_urls>` | Required for the script injection above to work on any site |

No data ever leaves your browser — everything is stored locally.

## Development

There's no build tool, package manager, or linter — it's plain, unbundled JS loaded directly by Chrome.

`scripts/history-utils.js` is the one piece of pure logic (no `chrome.*` calls) and has a real test suite:

```bash
node --test tests/*.test.js
```

Everything else touches `chrome.tabs`/`chrome.storage`/`chrome.alarms` (`background.js`, `popup/popup.js`)
and needs manual verification in Chrome — load the extension per [Installation](#installation), then use
the "service worker" link on its card in `chrome://extensions` for background logs, or right-click the
toolbar icon → "Inspect popup" for the popup.

See [`CLAUDE.md`](./CLAUDE.md) for a deeper architecture walkthrough.

## Project Structure

```
manifest.json           Extension manifest
background.js           Service worker: idle detection and auto-close logic
popup/                  Toolbar popup UI
  popup.html / .js / .css
scripts/
  detect-input.js         Injected into pages to detect unsaved form input
  history-utils.js        Pure helpers for close-history entries, shared by background.js and popup.js
tests/
  history-utils.test.js   Node test suite for history-utils.js
icons/                   Extension icons
```

## Known Limitations

- The popup's "about to be cleaned" count applies the audio protection rule but **not** input protection —
  checking form input requires injecting a script into every candidate tab, and doing that every time the
  popup opens would force Chrome to wake up (undiscard) idle background tabs, defeating the point of the
  extension. So this number can run a little higher than what actually gets closed.
- For tabs that already existed when the extension was installed or the browser started, "time open" is
  measured from that install/startup moment (the tab's true creation time isn't knowable), not from when
  the tab was actually opened.

## License

MIT © Tab Cleaner Authors — see [LICENSE](./LICENSE).
