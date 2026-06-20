import { describe, expect, it } from 'vitest';
import { buildBrandSearchQuery, extractBrandInfo, getBrandName } from '@/shared/url-brand';

describe('extractBrandInfo — subdomain-aware brand', () => {
  it('keeps a meaningful subdomain distinct from the registrable brand', () => {
    expect(extractBrandInfo('https://drive.google.com')).toEqual({ brand: 'google', subdomain: 'drive', isPersonalInfra: false });
    expect(extractBrandInfo('https://play.google.com/store')).toEqual({ brand: 'google', subdomain: 'play', isPersonalInfra: false });
    expect(extractBrandInfo('https://mail.google.com')).toEqual({ brand: 'google', subdomain: 'mail', isPersonalInfra: false });
  });

  it('drops generic subdomains (www/m/app/login) — no subdomain brand', () => {
    expect(extractBrandInfo('https://www.google.com')).toEqual({ brand: 'google', subdomain: '', isPersonalInfra: false });
    expect(extractBrandInfo('https://m.youtube.com')).toEqual({ brand: 'youtube', subdomain: '', isPersonalInfra: false });
    expect(extractBrandInfo('https://login.example.com')).toEqual({ brand: 'example', subdomain: '', isPersonalInfra: false });
  });

  it('has no subdomain for bare registrable domains', () => {
    expect(extractBrandInfo('https://github.com')).toEqual({ brand: 'github', subdomain: '', isPersonalInfra: false });
  });

  it('handles multi-part SLDs (.co.uk) with and without a subdomain', () => {
    expect(extractBrandInfo('https://pogdesign.co.uk')).toEqual({ brand: 'pogdesign', subdomain: '', isPersonalInfra: false });
    expect(extractBrandInfo('https://shop.pogdesign.co.uk')).toEqual({ brand: 'pogdesign', subdomain: 'shop', isPersonalInfra: false });
  });

  it('flags personal-infra hosts and never attaches a subdomain brand', () => {
    expect(extractBrandInfo('https://jellyfin.local.flippflix.com')).toEqual({ brand: 'jellyfin', subdomain: '', isPersonalInfra: true });
    expect(extractBrandInfo('https://service.local')).toEqual({ brand: 'service', subdomain: '', isPersonalInfra: true });
  });
});

describe('getBrandName — unchanged display brand (root only)', () => {
  it('returns the registrable brand, ignoring subdomain', () => {
    expect(getBrandName('https://drive.google.com')).toBe('google');
    expect(getBrandName('https://github.com')).toBe('github');
  });
});

describe('extractBrandInfo — IDN/punycode decode', () => {
  it('decodes xn-- punycode labels to unicode so brand queries are human-readable', () => {
    // www.xn--bcher-kva.de → bücher (German bookshop)
    expect(extractBrandInfo('https://www.xn--bcher-kva.de')).toEqual({ brand: 'bücher', subdomain: '', isPersonalInfra: false });
    // xn--n3h.example.com → ☃ (snowman, single non-ASCII char)
    expect(extractBrandInfo('https://xn--n3h.example.com')).toEqual({ brand: 'example', subdomain: '☃', isPersonalInfra: false });
  });

  it('leaves non-punycode labels untouched', () => {
    expect(extractBrandInfo('https://example.com')).toEqual({ brand: 'example', subdomain: '', isPersonalInfra: false });
    expect(extractBrandInfo('https://www.google.com')).toEqual({ brand: 'google', subdomain: '', isPersonalInfra: false });
  });
});

describe('buildBrandSearchQuery — IDN/punycode decode', () => {
  it('produces a unicode brand query instead of xn-- gibberish', () => {
    expect(buildBrandSearchQuery('https://www.xn--bcher-kva.de')).toBe('bücher logo');
  });

  it('does not alter non-IDN queries (regression-safe)', () => {
    expect(buildBrandSearchQuery('https://github.com')).toBe('github logo');
    expect(buildBrandSearchQuery('https://www.google.com')).toBe('google logo');
    expect(buildBrandSearchQuery('https://drive.google.com')).toBe('google drive logo');
  });
});

describe('buildBrandSearchQuery — shared search seed (auto-resolve + edit dialog)', () => {
  it('combines brand + meaningful subdomain so multi-tenant products resolve themselves', () => {
    // This is the regression the edit dialog had: it seeded "google logo" instead
    // of the product-specific query, so the right icon never surfaced as a result.
    expect(buildBrandSearchQuery('https://calendar.google.com/')).toBe('google calendar logo');
    expect(buildBrandSearchQuery('https://drive.google.com')).toBe('google drive logo');
    expect(buildBrandSearchQuery('https://play.google.com/store')).toBe('google play logo');
  });

  it('uses the bare brand for plain hosts, generic subdomains, and personal-infra', () => {
    expect(buildBrandSearchQuery('https://github.com')).toBe('github logo');
    expect(buildBrandSearchQuery('https://www.google.com')).toBe('google logo');
    expect(buildBrandSearchQuery('https://jellyfin.local.flippflix.com')).toBe('jellyfin logo');
  });

  it('returns empty for missing/unparseable input so callers can fall back to the title', () => {
    expect(buildBrandSearchQuery(undefined)).toBe('');
    expect(buildBrandSearchQuery('')).toBe('');
  });
});
