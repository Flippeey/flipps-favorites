import { describe, expect, it } from 'vitest';
import { hasUrlScheme, normalizeBookmarkUrl } from '@/newtab/lib/url';
import { isValidBookmarkUrl } from '@/newtab/lib/icon-helpers';

describe('hasUrlScheme', () => {
  it('detects real schemes', () => {
    for (const v of ['http://x.com', 'https://x.com', 'chrome://flags', 'file:///etc', 'about:blank', 'mailto:a@b.com']) {
      expect(hasUrlScheme(v)).toBe(true);
    }
  });
  it('does NOT treat bare host:port as a scheme', () => {
    expect(hasUrlScheme('localhost:3000')).toBe(false);
    expect(hasUrlScheme('example.com')).toBe(false);
    expect(hasUrlScheme('example.com/path')).toBe(false);
  });
});

describe('isValidBookmarkUrl', () => {
  it('accepts the browser-internal allowlist', () => {
    for (const v of ['http://x.com', 'https://x.com', 'chrome://flags', 'edge://settings', 'about:blank', 'file:///etc/hosts']) {
      expect(isValidBookmarkUrl(v)).toBe(true);
    }
  });
  it('rejects disallowed schemes and junk', () => {
    for (const v of ['javascript:alert(1)', 'mailto:a@b.com', 'ftp://x.com', 'data:text/html,x', 'not a url', '', 'localhost:3000']) {
      expect(isValidBookmarkUrl(v)).toBe(false);
    }
  });
});

describe('normalizeBookmarkUrl', () => {
  it('preserves any real scheme (no double-prefix)', () => {
    expect(normalizeBookmarkUrl('chrome://flags')).toBe('chrome://flags');
    expect(normalizeBookmarkUrl('http://x.com')).toBe('http://x.com');
    expect(normalizeBookmarkUrl('https://x.com')).toBe('https://x.com');
    expect(normalizeBookmarkUrl('file:///etc/hosts')).toBe('file:///etc/hosts');
  });
  it('prepends https to bare hosts (incl. host:port)', () => {
    expect(normalizeBookmarkUrl('example.com')).toBe('https://example.com');
    expect(normalizeBookmarkUrl('localhost:3000')).toBe('https://localhost:3000');
  });
});
