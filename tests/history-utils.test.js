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
