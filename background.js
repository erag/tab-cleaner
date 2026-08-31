// background.js — Tab Cleaner Service Worker

importScripts('scripts/history-utils.js');

const DEFAULT_SETTINGS = {
  enabled: true,
  idleThreshold: 30 * 60 * 1000, // 30 minutes in ms
  protectAudio: true,
  protectInput: true,
};

const ALARM_NAME = 'tab-cleaner-check';
const MAX_HISTORY = 50;

// Restricted URL schemes where script injection is impossible
const RESTRICTED_SCHEMES = ['chrome:', 'about:', 'chrome-extension:', 'devtools:', 'data:', 'javascript:', 'blob:'];

function isRestrictedUrl(url) {
  if (!url) return true; // No URL = restricted
  return RESTRICTED_SCHEMES.some(scheme => url.startsWith(scheme));
}

// --- Settings helpers ---

async function getSettings() {
  const data = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return data;
}

async function getLastActivated() {
  const data = await chrome.storage.session.get('lastActivated');
  return data.lastActivated || {};
}

async function setLastActivated(map) {
  await chrome.storage.session.set({ lastActivated: map });
}

async function getTabCreated() {
  const data = await chrome.storage.session.get('tabCreated');
  return data.tabCreated || {};
}

async function setTabCreated(map) {
  await chrome.storage.session.set({ tabCreated: map });
}

// --- Close history ---

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

// --- Initialization ---

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

async function ensureAlarm() {
  const alarm = await chrome.alarms.get(ALARM_NAME);
  if (!alarm) {
    await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
    console.log('[TabCleaner] Alarm created (every 1 min)');
  }
}

// --- Tab event handlers ---

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const map = await getLastActivated();
  map[activeInfo.tabId] = Date.now();
  await setLastActivated(map);
});

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

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const activatedMap = await getLastActivated();
  delete activatedMap[tabId];
  await setLastActivated(activatedMap);

  const createdMap = await getTabCreated();
  delete createdMap[tabId];
  await setTabCreated(createdMap);
});

// --- Startup ---

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[TabCleaner] onInstalled — initializing');
  await initTabTimestamps();
  await ensureAlarm();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('[TabCleaner] onStartup — initializing');
  await initTabTimestamps();
  await ensureAlarm();
});

// Ensure alarm on first service worker spawn
ensureAlarm();

// --- Alarm handler ---

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
