// scripts/domain-utils.js — pure helpers for the domain whitelist feature.
//
// Loaded as a classic script in two browser contexts (importScripts() in
// background.js, a <script> tag in popup/popup.html) and required
// directly by the Node test suite (tests/domain-utils.test.js). Every
// function here must stay free of chrome.* calls so it keeps working in
// plain Node.

const MAX_WHITELIST_DOMAINS = 10;

// Cleans up whatever a user typed/pasted into the whitelist input into a bare
// hostname: strips a scheme+path if they pasted a full URL, strips a trailing
// port, lowercases. Returns '' if the result isn't a plausible hostname.
function normalizeDomain(raw) {
  if (typeof raw !== 'string') return '';
  let s = raw.trim().toLowerCase();
  if (!s) return '';

  if (s.includes('://')) {
    try {
      s = new URL(s).hostname;
    } catch (e) {
      return '';
    }
  } else {
    s = s.split('/')[0].split('?')[0].split('#')[0];
  }
  s = s.split(':')[0]; // strip a trailing port

  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(s)) {
    return '';
  }
  return s;
}

// True if hostname is, or is a subdomain of, any domain in whitelist.
// e.g. isWhitelistedDomain('mail.google.com', ['google.com']) === true
function isWhitelistedDomain(hostname, whitelist) {
  if (!hostname || !Array.isArray(whitelist) || whitelist.length === 0) return false;
  const h = String(hostname).toLowerCase();
  return whitelist.some(function (entry) {
    const d = String(entry).toLowerCase();
    if (!d) return false;
    return h === d || h.endsWith('.' + d);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MAX_WHITELIST_DOMAINS, normalizeDomain, isWhitelistedDomain };
}
