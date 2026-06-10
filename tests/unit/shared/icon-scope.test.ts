import { describe, expect, it } from 'vitest';
import {
  getOverrideKeyForScope,
  getOverrideLookupKeys,
  getRegistrableDomain,
  getScopeHostname,
  normalizeOverrideScope,
} from '@/shared/icon-scope';

describe('getScopeHostname', () => {
  it('lowercases and strips www', () => {
    expect(getScopeHostname('https://WWW.Example.com/path')).toBe('example.com');
  });

  it('returns null for unparseable values', () => {
    expect(getScopeHostname('not a url')).toBeNull();
  });
});

describe('getRegistrableDomain', () => {
  it('keeps two-label hosts', () => {
    expect(getRegistrableDomain('example.com')).toBe('example.com');
  });

  it('collapses subdomains to the registrable root', () => {
    expect(getRegistrableDomain('dev.azure.com')).toBe('azure.com');
  });

  it('keeps three labels for ccSLD registries', () => {
    expect(getRegistrableDomain('shop.pogdesign.co.uk')).toBe('pogdesign.co.uk');
  });
});

describe('getOverrideKeyForScope', () => {
  it('derives one key per scope', () => {
    const url = 'https://dev.azure.com/org/project';
    expect(getOverrideKeyForScope(url, 'exact')).toBe(`exact:${url}`);
    expect(getOverrideKeyForScope(url, 'host')).toBe('host:dev.azure.com');
    expect(getOverrideKeyForScope(url, 'domain')).toBe('domain:azure.com');
  });

  it('returns null for host/domain scopes when the URL has no host', () => {
    expect(getOverrideKeyForScope('not a url', 'host')).toBeNull();
    expect(getOverrideKeyForScope('not a url', 'domain')).toBeNull();
    // exact scope always works — it never needs a parsed host
    expect(getOverrideKeyForScope('not a url', 'exact')).toBe('exact:not a url');
  });
});

describe('getOverrideLookupKeys', () => {
  it('orders keys most specific first so exact beats host beats domain', () => {
    // The resolver returns the first stored record it finds in this order; a
    // user fixing one bookmark specifically must win over a site-wide override.
    expect(getOverrideLookupKeys('https://app-acc.cadac.com/smartglobe/')).toEqual([
      'exact:https://app-acc.cadac.com/smartglobe/',
      'host:app-acc.cadac.com',
      'domain:cadac.com',
    ]);
  });

  it('falls back to the exact key alone for unparseable URLs', () => {
    expect(getOverrideLookupKeys('not a url')).toEqual(['exact:not a url']);
  });

  it('skips a duplicate domain key when host equals the registrable root', () => {
    const keys = getOverrideLookupKeys('https://example.com/');
    expect(keys[0]).toBe('exact:https://example.com/');
    expect(keys[1]).toBe('host:example.com');
    // domain key still present (same record key would be 'domain:example.com', distinct prefix)
    expect(keys[2]).toBe('domain:example.com');
  });
});

describe('normalizeOverrideScope', () => {
  it('defaults unknown or legacy values to exact', () => {
    expect(normalizeOverrideScope(undefined)).toBe('exact');
    expect(normalizeOverrideScope('everything')).toBe('exact');
    expect(normalizeOverrideScope('host')).toBe('host');
    expect(normalizeOverrideScope('domain')).toBe('domain');
  });
});
