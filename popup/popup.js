// popup.js — Tab Cleaner Popup UI logic

const DEFAULT_SETTINGS = {
  enabled: true,
  idleThreshold: 30 * 60 * 1000, // 30 minutes = 1800000 ms
  protectAudio: true,
  protectInput: true,
  tabCountThreshold: 10, // only clean up once open-tab count exceeds this
  domainWhitelist: [], // hostnames (and their subdomains) exempt from cleanup, max MAX_WHITELIST_DOMAINS
};

// DOM elements
const enabledToggle = document.getElementById('enabled-toggle');
const statusText = document.getElementById('status-text');
const thresholdValue = document.getElementById('threshold-value');
const thresholdUnit = document.getElementById('threshold-unit');
const thresholdWarning = document.getElementById('threshold-warning');
const tabCountThresholdInput = document.getElementById('tab-count-threshold');
const tabCount = document.getElementById('tab-count');
const cleanupCount = document.getElementById('cleanup-count');
const protectAudioCheckbox = document.getElementById('protect-audio');
const protectInputCheckbox = document.getElementById('protect-input');
const whitelistInput = document.getElementById('whitelist-input');
const whitelistAddBtn = document.getElementById('whitelist-add');
const whitelistWarning = document.getElementById('whitelist-warning');
const whitelistCount = document.getElementById('whitelist-count');
const whitelistList = document.getElementById('whitelist-list');
const clearHistoryBtn = document.getElementById('clear-history');
const historyList = document.getElementById('history-list');

// --- Settings helpers ---

async function getSettings() {
  const data = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return data;
}

async function saveSetting(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

// --- Threshold save (with debounce for input event) ---

let thresholdSaveTimer = null;

function scheduleThresholdSave() {
  if (thresholdSaveTimer) clearTimeout(thresholdSaveTimer);
  thresholdSaveTimer = setTimeout(async () => {
    const value = Math.max(1, Number(thresholdValue.value) || 1);
    thresholdValue.value = value;
    const unitMs = Number(thresholdUnit.value);
    const totalMs = value * unitMs;
    await saveSetting('idleThreshold', totalMs);
    thresholdWarning.classList.toggle('hidden', totalMs >= 5 * 60 * 1000);
    updateUI(); // Refresh cleanup count with new threshold
  }, 300);
}

let tabCountThresholdSaveTimer = null;

function scheduleTabCountThresholdSave() {
  if (tabCountThresholdSaveTimer) clearTimeout(tabCountThresholdSaveTimer);
  tabCountThresholdSaveTimer = setTimeout(async () => {
    const value = Math.max(1, Math.round(Number(tabCountThresholdInput.value)) || 1);
    tabCountThresholdInput.value = value;
    await saveSetting('tabCountThreshold', value);
    updateUI(); // Refresh cleanup count with new threshold
  }, 300);
}

// --- UI update ---

async function updateUI() {
  const settings = await getSettings();

  // Enabled toggle
  enabledToggle.checked = settings.enabled;
  statusText.textContent = settings.enabled ? '● 已启用' : '● 已禁用';
  statusText.className = settings.enabled ? 'status-enabled' : 'status-disabled';

  // Threshold — display value in current dropdown unit
  const currentUnitMs = Number(thresholdUnit.value);
  const valueInUnit = Math.round(settings.idleThreshold / currentUnitMs);
  thresholdValue.value = valueInUnit;

  // Warning for small threshold
  const totalMs = settings.idleThreshold;
  thresholdWarning.classList.toggle('hidden', totalMs >= 5 * 60 * 1000); // hide if >= 5 min

  // Tab-count threshold
  tabCountThresholdInput.value = settings.tabCountThreshold;

  // Protection toggles
  protectAudioCheckbox.checked = settings.protectAudio;
  protectInputCheckbox.checked = settings.protectInput;

  // Stats
  const tabs = await chrome.tabs.query({});
  tabCount.textContent = tabs.length;

  // Count tabs that will be cleaned. Mirrors background.js's gate/active/idle/
  // audio/LRU-stop-early logic so the number matches what the next alarm tick
  // will actually close. Input protection is intentionally NOT applied here:
  // checking it requires injecting a script into each candidate tab, which
  // would wake up (undiscard) idle background tabs just from opening the
  // popup — so this count can still be a little higher than the real close
  // count when protectInput saves a tab.
  let count = 0;
  if (tabs.length > settings.tabCountThreshold) {
    const lastActivated = await chrome.storage.session.get('lastActivated');
    const map = lastActivated.lastActivated || {};
    const now = Date.now();
    const activeTabs = await chrome.tabs.query({ active: true });
    const activeTabIds = new Set(activeTabs.map(t => t.id));

    let eligible = 0;
    for (const tab of tabs) {
      if (activeTabIds.has(tab.id)) continue;
      const lastTime = map[tab.id];
      if (!lastTime || (now - lastTime) < settings.idleThreshold) continue;
      if (settings.protectAudio && tab.audible) continue;
      if (isWhitelistedDomain(safeHostname(tab.url), settings.domainWhitelist)) continue;
      eligible++;
    }
    // Cleanup stops as soon as tab count is back at/under the threshold, so
    // at most (tabs.length - tabCountThreshold) tabs will actually close.
    const maxCloseable = tabs.length - settings.tabCountThreshold;
    count = Math.min(eligible, maxCloseable);
  }
  cleanupCount.textContent = count;

  // Domain whitelist
  renderWhitelist(settings.domainWhitelist || []);

  // Close history
  await renderHistory();
}

// --- Event listeners ---

enabledToggle.addEventListener('change', async () => {
  await saveSetting('enabled', enabledToggle.checked);
  statusText.textContent = enabledToggle.checked ? '● 已启用' : '● 已禁用';
  statusText.className = enabledToggle.checked ? 'status-enabled' : 'status-disabled';
});

// Use 'input' event (fires on every keystroke) instead of 'change' (requires blur)
// This ensures threshold changes are saved even if the popup closes
thresholdValue.addEventListener('input', scheduleThresholdSave);

tabCountThresholdInput.addEventListener('input', scheduleTabCountThresholdSave);

thresholdUnit.addEventListener('change', async () => {
  const value = Math.max(1, Number(thresholdValue.value) || 1);
  thresholdValue.value = value;
  const unitMs = Number(thresholdUnit.value);
  const totalMs = value * unitMs;
  await saveSetting('idleThreshold', totalMs);
  thresholdWarning.classList.toggle('hidden', totalMs >= 5 * 60 * 1000);
  await updateUI();
});

protectAudioCheckbox.addEventListener('change', async () => {
  await saveSetting('protectAudio', protectAudioCheckbox.checked);
});

protectInputCheckbox.addEventListener('change', async () => {
  await saveSetting('protectInput', protectInputCheckbox.checked);
});

// --- Domain whitelist ---

function renderWhitelist(whitelist) {
  whitelistCount.textContent = whitelist.length + '/' + MAX_WHITELIST_DOMAINS;

  const atLimit = whitelist.length >= MAX_WHITELIST_DOMAINS;
  whitelistWarning.classList.toggle('hidden', !atLimit);
  whitelistInput.disabled = atLimit;
  whitelistAddBtn.disabled = atLimit;

  if (whitelist.length === 0) {
    whitelistList.innerHTML = '<div class="whitelist-empty">暂无白名单域名</div>';
    return;
  }

  whitelistList.innerHTML = '';
  for (const domain of whitelist) {
    const item = document.createElement('div');
    item.className = 'whitelist-item';

    const domainSpan = document.createElement('span');
    domainSpan.className = 'whitelist-domain';
    domainSpan.textContent = domain;
    item.appendChild(domainSpan);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'whitelist-remove';
    removeBtn.textContent = '×';
    removeBtn.setAttribute('aria-label', '移除 ' + domain);
    removeBtn.addEventListener('click', async () => {
      const settings = await getSettings();
      const next = (settings.domainWhitelist || []).filter((d) => d !== domain);
      await saveSetting('domainWhitelist', next);
      await updateUI();
    });
    item.appendChild(removeBtn);

    whitelistList.appendChild(item);
  }
}

async function addWhitelistDomain() {
  const domain = normalizeDomain(whitelistInput.value);
  whitelistInput.value = '';
  if (!domain) return;

  const settings = await getSettings();
  const current = settings.domainWhitelist || [];
  if (current.includes(domain) || current.length >= MAX_WHITELIST_DOMAINS) {
    await updateUI();
    return;
  }
  await saveSetting('domainWhitelist', current.concat(domain));
  await updateUI();
}

whitelistAddBtn.addEventListener('click', addWhitelistDomain);

whitelistInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addWhitelistDomain();
});

// --- Close history ---

function timeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return '刚刚';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + ' 分钟前';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + ' 小时前';
  const days = Math.floor(hours / 24);
  return days + ' 天前';
}

async function renderHistory() {
  const data = await chrome.storage.local.get('closeHistory');
  const history = data.closeHistory || [];

  if (history.length === 0) {
    historyList.innerHTML = '<div class="history-empty">暂无记录</div>';
    return;
  }

  historyList.innerHTML = '';
  for (const entry of history) {
    const item = document.createElement('div');
    item.className = 'history-item';

    // Favicon
    if (entry.favIconUrl) {
      const img = document.createElement('img');
      img.className = 'history-favicon';
      img.src = entry.favIconUrl;
      img.alt = '';
      img.onerror = function() { this.replaceWith(createPlaceholder()); };
      item.appendChild(img);
    } else {
      item.appendChild(createPlaceholder());
    }

    // Info (title + time)
    const info = document.createElement('div');
    info.className = 'history-info';

    const title = document.createElement('div');
    title.className = 'history-title';
    title.textContent = entry.title || entry.url;
    info.appendChild(title);

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
  }
}

function createPlaceholder() {
  const el = document.createElement('div');
  el.className = 'history-favicon-placeholder';
  el.textContent = '📄';
  return el;
}

clearHistoryBtn.addEventListener('click', async () => {
  await chrome.storage.local.set({ closeHistory: [] });
  await renderHistory();
});

// --- Initialize ---
updateUI();
