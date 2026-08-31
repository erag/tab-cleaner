# Tab Close-History Lifetime Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correctly record each auto-closed tab's URL and its full lifetime range (opened → closed) in the
close history, and let the user click a history entry to reopen its URL.

**Architecture:** Add a small pure-JS helper module (`scripts/history-utils.js`) that both the background
service worker and the popup load as a classic script, and that a Node test suite can `require()` directly.
Track each tab's creation time in a new `chrome.storage.session` map (`tabCreated`), parallel to the
existing `lastActivated` map, so `recordClose()` can capture a real `openedAt`/`closedAt` pair instead of
only a close timestamp. Surface the recorded range in the popup's history list, and harden the
already-present click-to-reopen behavior against entries with a missing or malformed URL.

**Tech Stack:** Vanilla JS, Chrome Extension Manifest V3 APIs (`chrome.storage`, `chrome.tabs`,
`chrome.alarms`, `chrome.scripting`), Node.js built-in test runner (`node:test` / `node:assert`) — no new
dependencies, no bundler.

**Spec:** No separate spec document exists — this plan implements the feature request directly:
"当前没有正确记录清理的历史tab信息，需要记录tab的url、存活时间范围，并支持点击后直接打开该tab" (the
close-history currently isn't recorded correctly; it needs to record each tab's URL, its lifetime range,
and support opening it directly by clicking). The "Current State" section below documents what already
exists vs. what's missing, standing in for a design doc.

## Current State (read this before starting)

- `background.js`'s `recordClose(tab)` already stores `url`, `title`, `favIconUrl`, and `closedAt` for every
  tab the alarm handler closes — but **not** when the tab was opened, so there is no lifetime range today.
- `chrome.storage.session`'s `lastActivated` map is a `{ tabId: timestamp }` map, but it's overwritten on
  every `chrome.tabs.onActivated` event, so by the time a tab closes, its original creation time has already
  been lost — it holds "last focused", not "created".
- `popup/popup.js`'s `renderHistory()` already attaches a click handler that calls
  `chrome.tabs.create({ url: entry.url })` — clicking to reopen already works for well-formed entries. It
  has one latent bug worth fixing as part of this work: `new URL(entry.url).hostname` throws if `entry.url`
  is `''` (possible for a tab that had no URL yet), which would break the whole history list's rendering.

## Global Constraints

- No bundler, package manager, or new runtime dependency — matches the existing repo (see `CLAUDE.md`).
- This repo has no `chrome.*` mocking/test harness. Pure logic goes in `scripts/history-utils.js` and gets
  real Node unit tests (Task 1). `chrome.tabs`/`chrome.storage`/`chrome.alarms` wiring in `background.js`
  and `popup.js` is verified by manually reloading the unpacked extension and checking the service worker
  console / popup inspector, per the project's existing (test-tool-free) conventions for that code.
- All new user-facing strings are Simplified Chinese, matching the existing popup UI (e.g. `刚刚`,
  `分钟前`).
- Shared logic between `background.js` and `popup.js` goes in `scripts/history-utils.js` instead of being
  copy-pasted into both, to avoid growing the existing `DEFAULT_SETTINGS` duplication pattern noted in
  `CLAUDE.md`.

---

### Task 1: Add `scripts/history-utils.js` (pure helpers) with a Node test suite

**Files:**
- Create: `scripts/history-utils.js`
- Create: `tests/history-utils.test.js`
- Modify: `CLAUDE.md` (add a one-line "Development / testing" note)

**Interfaces:**
- Produces: `buildHistoryEntry(tab, openedAt, closedAt) -> { url, title, favIconUrl, openedAt, closedAt }`
  — used by Task 2 in `background.js`.
- Produces: `formatLifetime(openedAt, closedAt) -> string` — used by Task 3 in `popup.js`.
- Produces: `safeHostname(url) -> string` — used by Task 3 in `popup.js`.
- All three are pure functions (no `chrome.*` calls), exported via `module.exports` when `module` exists,
  and otherwise left as global function declarations (so a classic `<script>`/`importScripts()` load
  exposes them as bare identifiers).

- [ ] **Step 1: Write the failing test suite**

Create `tests/history-utils.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildHistoryEntry, formatLifetime, safeHostname } = require('../scripts/history-utils.js');

test('buildHistoryEntry copies url/title/favIconUrl from the tab', () => {
  const tab = { url: 'https://example.com', title: 'Example', favIconUrl: 'https://example.com/f.ico' };
  const entry = buildHistoryEntry(tab, 1000, 2000);
  assert.deepEqual(entry, {
    url: 'https://example.com',
    title: 'Example',
    favIconUrl: 'https://example.com/f.ico',
    openedAt: 1000,
    closedAt: 2000,
  });
});

test('buildHistoryEntry defaults missing tab fields to empty strings', () => {
  const entry = buildHistoryEntry({}, 1000, 2000);
  assert.equal(entry.url, '');
  assert.equal(entry.title, '');
  assert.equal(entry.favIconUrl, '');
});

test('buildHistoryEntry falls back openedAt to closedAt when openedAt is unknown', () => {
  const entry = buildHistoryEntry({ url: 'https://example.com' }, undefined, 2000);
  assert.equal(entry.openedAt, 2000);
});

test('buildHistoryEntry preserves an openedAt of 0 instead of treating it as unknown', () => {
  const entry = buildHistoryEntry({ url: 'https://example.com' }, 0, 2000);
  assert.equal(entry.openedAt, 0);
});

test('formatLifetime returns 未知 when either timestamp is not a number', () => {
  assert.equal(formatLifetime(undefined, 2000), '未知');
  assert.equal(formatLifetime(1000, undefined), '未知');
});

test('formatLifetime returns 不到 1 分钟 for spans under a minute', () => {
  assert.equal(formatLifetime(1000, 1000), '不到 1 分钟');
  assert.equal(formatLifetime(0, 45 * 1000), '不到 1 分钟');
});

test('formatLifetime returns 不到 1 分钟 for a negative span (clock skew)', () => {
  assert.equal(formatLifetime(5000, 1000), '不到 1 分钟');
});

test('formatLifetime formats whole minutes', () => {
  assert.equal(formatLifetime(0, 5 * 60 * 1000), '5 分钟');
});

test('formatLifetime formats hours and minutes', () => {
  assert.equal(formatLifetime(0, 65 * 60 * 1000), '1 小时 5 分钟');
});

test('formatLifetime omits the minutes part on an exact hour', () => {
  assert.equal(formatLifetime(0, 120 * 60 * 1000), '2 小时');
});

test('formatLifetime formats days and hours', () => {
  assert.equal(formatLifetime(0, 26 * 60 * 60 * 1000), '1 天 2 小时');
});

test('formatLifetime omits the hours part on an exact day', () => {
  assert.equal(formatLifetime(0, 48 * 60 * 60 * 1000), '2 天');
});

test('safeHostname extracts the hostname from a valid URL', () => {
  assert.equal(safeHostname('https://example.com/path?x=1'), 'example.com');
});

test('safeHostname returns an empty string for an empty URL', () => {
  assert.equal(safeHostname(''), '');
});

test('safeHostname falls back to the raw string for an unparseable URL', () => {
  assert.equal(safeHostname('not a url'), 'not a url');
});

test('safeHostname handles restricted extension-page schemes', () => {
  assert.equal(safeHostname('chrome://newtab/'), 'newtab');
});
```

- [ ] **Step 2: Run the suite to verify it fails**

Run: `node --test tests/history-utils.test.js`
Expected: fails with something like `Cannot find module '../scripts/history-utils.js'` (the file doesn't
exist yet).

- [ ] **Step 3: Implement `scripts/history-utils.js`**

```js
// scripts/history-utils.js — pure helpers for building & formatting tab
// close-history records.
//
// Loaded as a classic script in two browser contexts (importScripts() in
// background.js, a <script> tag in popup/popup.html) and required
// directly by the Node test suite (tests/history-utils.test.js). Every
// function here must stay free of chrome.* calls so it keeps working in
// plain Node.

function buildHistoryEntry(tab, openedAt, closedAt) {
  return {
    url: (tab && tab.url) || '',
    title: (tab && tab.title) || '',
    favIconUrl: (tab && tab.favIconUrl) || '',
    openedAt: typeof openedAt === 'number' ? openedAt : closedAt,
    closedAt,
  };
}

function formatLifetime(openedAt, closedAt) {
  if (typeof openedAt !== 'number' || typeof closedAt !== 'number') {
    return '未知';
  }
  const diff = closedAt - openedAt;
  if (diff < 60 * 1000) {
    return '不到 1 分钟';
  }
  const minutes = Math.floor(diff / (60 * 1000));
  if (minutes < 60) {
    return minutes + ' 分钟';
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) {
    return remMinutes > 0 ? hours + ' 小时 ' + remMinutes + ' 分钟' : hours + ' 小时';
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? days + ' 天 ' + remHours + ' 小时' : days + ' 天';
}

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return url || '';
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildHistoryEntry, formatLifetime, safeHostname };
}
```

- [ ] **Step 4: Run the suite to verify it passes**

Run: `node --test tests/history-utils.test.js`
Expected: all 15 tests pass (`# pass 15`, `# fail 0`).

- [ ] **Step 5: Document the test command in `CLAUDE.md`**

In `CLAUDE.md`, under the existing `## Development / testing` heading, add this line right after the
"There is no build tool..." paragraph (don't remove the existing paragraph — this is a new addition next to
it):

```markdown
The one exception is `scripts/history-utils.js`, whose logic is pure (no `chrome.*` calls) and has a real
Node test suite: run `node --test tests/` (requires Node 18+; no install needed, it's `node:test`/
`node:assert` from the standard library).
```

- [ ] **Step 6: Commit**

```bash
git add scripts/history-utils.js tests/history-utils.test.js CLAUDE.md
git commit -m "test: add history-utils pure helpers with Node test suite"
```

---

### Task 2: Track each tab's creation time and record it in `background.js`

**Files:**
- Modify: `background.js`

**Interfaces:**
- Consumes: `buildHistoryEntry(tab, openedAt, closedAt)` from `scripts/history-utils.js` (Task 1).
- Produces: `closeHistory` entries in `chrome.storage.local` now include a real `openedAt` (previously
  absent) in addition to the existing `url`/`title`/`favIconUrl`/`closedAt` — consumed by Task 3's popup
  rendering.

- [ ] **Step 1: Load the shared helpers into the service worker**

At the very top of `background.js`, right after the header comment (`// background.js — Tab Cleaner Service
Worker`), add:

```js
importScripts('scripts/history-utils.js');
```

- [ ] **Step 2: Add `tabCreated` session-map helpers**

Right after the existing `setLastActivated` function (in the `// --- Settings helpers ---` section), add:

```js
async function getTabCreated() {
  const data = await chrome.storage.session.get('tabCreated');
  return data.tabCreated || {};
}

async function setTabCreated(map) {
  await chrome.storage.session.set({ tabCreated: map });
}
```

- [ ] **Step 3: Use `buildHistoryEntry` and an `openedAt` parameter in `recordClose`**

Replace the whole `recordClose` function with:

```js
async function recordClose(tab, openedAt) {
  const entry = buildHistoryEntry(tab, openedAt, Date.now());
  const data = await chrome.storage.local.get('closeHistory');
  const history = data.closeHistory || [];
  history.unshift(entry); // newest first
  if (history.length > MAX_HISTORY) {
    history.length = MAX_HISTORY;
  }
  await chrome.storage.local.set({ closeHistory: history });
}
```

- [ ] **Step 4: Initialize both timestamp maps together**

Replace `initLastActivated` with `initTabTimestamps`, which sets both maps in one pass:

```js
async function initTabTimestamps() {
  const tabs = await chrome.tabs.query({});
  const now = Date.now();
  const activatedMap = {};
  const createdMap = {};
  for (const tab of tabs) {
    activatedMap[tab.id] = now;
    createdMap[tab.id] = now;
  }
  await setLastActivated(activatedMap);
  await setTabCreated(createdMap);
  console.log('[TabCleaner] Initialized timestamps for', tabs.length, 'tabs');
}
```

Then update both call sites (in `chrome.runtime.onInstalled` and `chrome.runtime.onStartup`) from
`await initLastActivated();` to `await initTabTimestamps();`.

Note: for tabs that already existed before install/startup, `openedAt` is approximated as "now" (their true
creation time isn't knowable) — same approximation the existing code already makes for `lastActivated`.

- [ ] **Step 5: Maintain `tabCreated` in the tab-created/removed listeners**

Replace the `chrome.tabs.onCreated` listener with:

```js
chrome.tabs.onCreated.addListener(async (tab) => {
  if (tab.id === undefined) return;
  const now = Date.now();

  const activatedMap = await getLastActivated();
  activatedMap[tab.id] = now;
  await setLastActivated(activatedMap);

  const createdMap = await getTabCreated();
  createdMap[tab.id] = now;
  await setTabCreated(createdMap);
});
```

Replace the `chrome.tabs.onRemoved` listener with:

```js
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const activatedMap = await getLastActivated();
  delete activatedMap[tabId];
  await setLastActivated(activatedMap);

  const createdMap = await getTabCreated();
  delete createdMap[tabId];
  await setTabCreated(createdMap);
});
```

(Note `chrome.tabs.onActivated` is unchanged — activation should keep updating `lastActivated` only, not
`tabCreated`.)

- [ ] **Step 6: Thread `createdMap` through the alarm handler**

Replace the entire `chrome.alarms.onAlarm.addListener(async (alarm) => { ... });` block with:

```js
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  try {
    const settings = await getSettings();
    if (!settings.enabled) {
      console.log('[TabCleaner] Alarm fired but plugin is disabled, skipping');
      return;
    }

    const map = await getLastActivated();
    const createdMap = await getTabCreated();
    const now = Date.now();
    const tabsToClose = [];

    // Get all currently active tabs (one per window) to never close them
    const activeTabs = await chrome.tabs.query({ active: true });
    const activeTabIds = new Set(activeTabs.map(t => t.id));

    // Get full tab objects for protection checks
    const allTabs = await chrome.tabs.query({});
    const tabMap = {};
    for (const tab of allTabs) {
      tabMap[tab.id] = tab;
    }

    for (const [tabIdStr, lastTime] of Object.entries(map)) {
      const tabId = Number(tabIdStr);
      const idleTime = now - lastTime;

      if (idleTime < settings.idleThreshold) continue;

      // Never close currently active tab
      if (activeTabIds.has(tabId)) {
        console.log('[TabCleaner] Tab', tabId, 'is active, skipping');
        continue;
      }

      const tab = tabMap[tabId];
      if (!tab) {
        // Tab no longer exists, clean up
        delete map[tabIdStr];
        delete createdMap[tabIdStr];
        continue;
      }

      // Audio protection
      if (settings.protectAudio && tab.audible) {
        console.log('[TabCleaner] Tab', tabId, 'is playing audio, skipping');
        continue;
      }

      // Restricted URL schemes — skip form-input check, close directly
      // (these pages don't have meaningful user form input)
      if (settings.protectInput && isRestrictedUrl(tab.url)) {
        // Restricted pages like chrome://newtab, about:blank have no user form data
        // Close them directly without form-input protection
        console.log('[TabCleaner] Tab', tabId, 'has restricted URL:', tab.url, '— closing directly (no form-input check)');
        tabsToClose.push(tabId);
        continue;
      }

      tabsToClose.push(tabId);
    }

    // Save cleaned maps
    await setLastActivated(map);
    await setTabCreated(createdMap);

    if (tabsToClose.length === 0) {
      console.log('[TabCleaner] Alarm fired — no tabs to close (idle threshold:', settings.idleThreshold / 60000, 'min)');
      return;
    }

    console.log('[TabCleaner] Alarm fired —', tabsToClose.length, 'idle tab(s) to check for closing');

    // Close idle tabs (with form-input protection if enabled)
    for (const tabId of tabsToClose) {
      const tab = tabMap[tabId];
      if (!tab) continue;

      let shouldClose = true;

      // Form-input protection (only for regular http/https pages)
      if (settings.protectInput && !isRestrictedUrl(tab.url)) {
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId },
            files: ['scripts/detect-input.js'],
          });
          if (results && results[0] && results[0].result === true) {
            console.log('[TabCleaner] Tab', tabId, 'has unsaved form input, skipping');
            shouldClose = false;
          }
        } catch (e) {
          // Injection failed on a non-restricted page — this is unexpected
          // Protect by default since we can't determine form state
          console.warn('[TabCleaner] Script injection failed for tab', tabId, ':', e.message, '— protecting tab');
          shouldClose = false;
        }
      }

      if (shouldClose) {
        await recordClose(tab, createdMap[tabId]);
        try {
          await chrome.tabs.remove(tabId);
          console.log('[TabCleaner] Closed idle tab', tabId, ':', tab.url);
        } catch (e) {
          // Tab already closed or cannot be closed — silently ignore
          console.warn('[TabCleaner] Failed to close tab', tabId, ':', e.message);
        }
        // Remove from maps regardless
        delete map[tabId];
        delete createdMap[tabId];
      }
    }

    // Final map cleanup after closes
    await setLastActivated(map);
    await setTabCreated(createdMap);
  } catch (e) {
    console.error('[TabCleaner] Alarm handler error:', e);
  }
});
```

- [ ] **Step 7: Manually verify in Chrome**

1. Open `chrome://extensions`, enable Developer mode, "Load unpacked" (or "Reload" if already loaded) this
   directory.
2. Open the popup, set "空闲阈值" to `1` 分钟 (so you don't have to wait 30 minutes).
3. Open a couple of new tabs, then switch focus away from them and leave them idle for a bit over a minute.
4. On the extension's card in `chrome://extensions`, click "service worker" to open its console. Wait for
   the next `tab-cleaner-check` alarm (fires every minute) and confirm you see
   `[TabCleaner] Closed idle tab ...` logs.
5. In that same console, run:
   ```js
   chrome.storage.local.get('closeHistory', console.log)
   ```
   Confirm the newest entry has `openedAt` and `closedAt` as numbers with `closedAt > openedAt`, and that
   the gap roughly matches how long the tab was actually open.
6. Also run `chrome.storage.session.get(['lastActivated', 'tabCreated'], console.log)` and confirm the
   closed tab's id is no longer a key in either map.

- [ ] **Step 8: Commit**

```bash
git add background.js
git commit -m "feat: record each closed tab's openedAt alongside closedAt"
```

---

### Task 3: Show the lifetime range in the popup and harden click-to-reopen

**Files:**
- Modify: `popup/popup.html`
- Modify: `popup/popup.js`

**Interfaces:**
- Consumes: `formatLifetime(openedAt, closedAt)` and `safeHostname(url)` from `scripts/history-utils.js`
  (Task 1); reads `entry.openedAt`/`entry.closedAt`/`entry.url` as written by Task 2's `recordClose`.

- [ ] **Step 1: Load the shared helpers into the popup**

In `popup/popup.html`, right before `<script src="popup.js"></script>`, add:

```html
<script src="../scripts/history-utils.js"></script>
```

So the end of the body reads:

```html
  <script src="../scripts/history-utils.js"></script>
  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Render the lifetime range and guard click-to-reopen**

In `popup/popup.js`'s `renderHistory()`, replace this block:

```js
    const meta = document.createElement('div');
    meta.className = 'history-meta';
    meta.textContent = timeAgo(entry.closedAt) + ' · ' + new URL(entry.url).hostname;
    info.appendChild(meta);

    item.appendChild(info);

    // Reopen hint
    const reopen = document.createElement('span');
    reopen.className = 'history-reopen';
    reopen.textContent = '打开';
    item.appendChild(reopen);

    // Click to reopen
    item.addEventListener('click', () => {
      chrome.tabs.create({ url: entry.url });
    });

    historyList.appendChild(item);
```

with:

```js
    const meta = document.createElement('div');
    meta.className = 'history-meta';
    meta.textContent = '存活 ' + formatLifetime(entry.openedAt, entry.closedAt) +
      ' · ' + timeAgo(entry.closedAt) + ' · ' + safeHostname(entry.url);
    info.appendChild(meta);

    item.appendChild(info);

    // Reopen hint + click-to-reopen — only when the entry actually has a URL
    if (entry.url) {
      const reopen = document.createElement('span');
      reopen.className = 'history-reopen';
      reopen.textContent = '打开';
      item.appendChild(reopen);

      item.addEventListener('click', () => {
        chrome.tabs.create({ url: entry.url });
      });
    }

    historyList.appendChild(item);
```

This fixes the `new URL(entry.url).hostname` crash-on-empty-URL noted in "Current State", adds the lifetime
range to the display, and only makes an entry clickable/labeled "打开" when it actually has a URL to open.

- [ ] **Step 3: Manually verify in Chrome**

1. Reload the unpacked extension in `chrome://extensions` (picks up both Task 2 and Task 3 changes).
2. Repeat the idle-tab-close flow from Task 2's Step 7 (short threshold, let a tab or two get closed).
3. Open the popup and look at "关闭历史": each entry's second line should now read something like
   `存活 2 分钟 · 刚刚 · example.com`.
4. Click a history entry and confirm it opens a new tab at that URL.
5. In the service worker console, run this to simulate a pre-existing entry from before this feature
   shipped (no `openedAt`), then reopen the popup and confirm it renders `存活 未知 · ...` instead of
   throwing:
   ```js
   chrome.storage.local.get('closeHistory', (d) => {
     const h = d.closeHistory || [];
     h.unshift({ url: 'https://example.com', title: 'Legacy entry', favIconUrl: '', closedAt: Date.now() });
     chrome.storage.local.set({ closeHistory: h });
   });
   ```

- [ ] **Step 4: Commit**

```bash
git add popup/popup.html popup/popup.js
git commit -m "feat: show lifetime range in close history and harden click-to-reopen"
```
