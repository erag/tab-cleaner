const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_WHITELIST_DOMAINS, normalizeDomain, isWhitelistedDomain } = require('../scripts/domain-utils.js');

test('MAX_WHITELIST_DOMAINS is 10', () => {
  assert.equal(MAX_WHITELIST_DOMAINS, 10);
});

test('normalizeDomain passes through a plain domain, lowercased', () => {
  assert.equal(normalizeDomain('Example.com'), 'example.com');
});

test('normalizeDomain extracts the hostname from a full URL', () => {
  assert.equal(normalizeDomain('https://www.Example.com/path?x=1#frag'), 'www.example.com');
});

test('normalizeDomain strips a path/query pasted without a scheme', () => {
  assert.equal(normalizeDomain('example.com/some/path?x=1'), 'example.com');
});

test('normalizeDomain strips a trailing port', () => {
  assert.equal(normalizeDomain('localhost:8080'), 'localhost');
  assert.equal(normalizeDomain('example.com:443'), 'example.com');
});

test('normalizeDomain trims surrounding whitespace', () => {
  assert.equal(normalizeDomain('  example.com  '), 'example.com');
});

test('normalizeDomain returns empty string for empty/whitespace-only input', () => {
  assert.equal(normalizeDomain(''), '');
  assert.equal(normalizeDomain('   '), '');
});

test('normalizeDomain returns empty string for non-string input', () => {
  assert.equal(normalizeDomain(undefined), '');
  assert.equal(normalizeDomain(null), '');
  assert.equal(normalizeDomain(42), '');
});

test('normalizeDomain rejects invalid characters', () => {
  assert.equal(normalizeDomain('exa mple.com'), '');
  assert.equal(normalizeDomain('exa_mple.com'), '');
});

test('normalizeDomain rejects a domain starting or ending with a hyphen or dot', () => {
  assert.equal(normalizeDomain('-example.com'), '');
  assert.equal(normalizeDomain('example.com-'), '');
  assert.equal(normalizeDomain('.example.com'), '');
  assert.equal(normalizeDomain('example.com.'), '');
});

test('normalizeDomain returns empty string for an unparseable full URL', () => {
  assert.equal(normalizeDomain('http://'), '');
});

test('isWhitelistedDomain matches an exact hostname', () => {
  assert.equal(isWhitelistedDomain('example.com', ['example.com']), true);
});

test('isWhitelistedDomain matches a subdomain of a whitelisted domain', () => {
  assert.equal(isWhitelistedDomain('mail.google.com', ['google.com']), true);
});

test('isWhitelistedDomain does not match an unrelated domain', () => {
  assert.equal(isWhitelistedDomain('example.org', ['example.com']), false);
});

test('isWhitelistedDomain does not match a domain that merely ends with the same letters', () => {
  assert.equal(isWhitelistedDomain('notexample.com', ['example.com']), false);
});

test('isWhitelistedDomain is case-insensitive', () => {
  assert.equal(isWhitelistedDomain('Mail.Google.com', ['GOOGLE.COM']), true);
});

test('isWhitelistedDomain returns false for an empty hostname or whitelist', () => {
  assert.equal(isWhitelistedDomain('', ['example.com']), false);
  assert.equal(isWhitelistedDomain('example.com', []), false);
  assert.equal(isWhitelistedDomain('example.com', undefined), false);
});
