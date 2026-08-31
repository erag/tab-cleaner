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
