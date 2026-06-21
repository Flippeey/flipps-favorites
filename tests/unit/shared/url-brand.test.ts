import { describe, expect, it } from 'vitest';
import { buildBrandSearchQuery, extractBrandInfo, getBrandName, stripKnownVanityPrefix } from '@/shared/url-brand';

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

// ---------------------------------------------------------------------------
// FIX 2 — Curated vanity-prefix stripping
//
// extractBrandInfo always returns the RAW brand (no stripping). Vanity stripping
// is done via a curated allow-list (stripKnownVanityPrefix) used only by
// buildBrandSearchQuery and isDdgFirstHitRelevant. This avoids false positives
// like applemusic→lemusic, goodreads→odreads, gopro→pro.
// ---------------------------------------------------------------------------
describe('extractBrandInfo — returns raw brand (no vanity stripping)', () => {
  it('returns raw "tryphotino" for tryphotino.io (strip happens downstream)', () => {
    expect(extractBrandInfo('https://www.tryphotino.io/').brand).toBe('tryphotino');
  });

  it('returns raw "applemusic" for applemusic.com (must NOT strip)', () => {
    expect(extractBrandInfo('https://applemusic.com/').brand).toBe('applemusic');
  });

  it('returns raw "goodreads" for goodreads.com (must NOT strip)', () => {
    expect(extractBrandInfo('https://goodreads.com/').brand).toBe('goodreads');
  });

  it('returns raw "useragent" for useragent.com (must NOT strip)', () => {
    expect(extractBrandInfo('https://useragent.com/').brand).toBe('useragent');
  });

  it('returns raw "gopro" for gopro.com (must NOT strip)', () => {
    expect(extractBrandInfo('https://gopro.com/').brand).toBe('gopro');
  });

  it('returns raw "golangtools" for golangtools.com (must NOT strip)', () => {
    expect(extractBrandInfo('https://golangtools.com/').brand).toBe('golangtools');
  });

  it('returns "google" for google.com unchanged', () => {
    expect(extractBrandInfo('https://www.google.com/').brand).toBe('google');
  });

  it('returns "myspace" for myspace.com unchanged', () => {
    expect(extractBrandInfo('https://www.myspace.com/').brand).toBe('myspace');
  });

  it('returns "ing" for mijn.ing.nl (mijn is a generic subdomain, not brand)', () => {
    expect(extractBrandInfo('https://mijn.ing.nl/login/').brand).toBe('ing');
  });
});

describe('stripKnownVanityPrefix — curated allow-list', () => {
  it('strips "try" from tryphotino (in curated list)', () => {
    expect(stripKnownVanityPrefix('tryphotino')).toBe('photino');
  });

  it('strips "get" from getpostman (in curated list)', () => {
    expect(stripKnownVanityPrefix('getpostman')).toBe('postman');
  });

  it('strips "use" from usefathom (in curated list)', () => {
    expect(stripKnownVanityPrefix('usefathom')).toBe('fathom');
  });

  it('strips "my" from myshopify (in curated list)', () => {
    expect(stripKnownVanityPrefix('myshopify')).toBe('shopify');
  });

  it('strips "mijn" from mijndomein (in curated list)', () => {
    expect(stripKnownVanityPrefix('mijndomein')).toBe('domein');
  });

  it('does NOT strip applemusic (not in curated list)', () => {
    expect(stripKnownVanityPrefix('applemusic')).toBe('applemusic');
  });

  it('does NOT strip goodreads (not in curated list)', () => {
    expect(stripKnownVanityPrefix('goodreads')).toBe('goodreads');
  });

  it('does NOT strip useragent (not in curated list)', () => {
    expect(stripKnownVanityPrefix('useragent')).toBe('useragent');
  });

  it('does NOT strip gopro (not in curated list)', () => {
    expect(stripKnownVanityPrefix('gopro')).toBe('gopro');
  });

  it('does NOT strip golangtools (not in curated list)', () => {
    expect(stripKnownVanityPrefix('golangtools')).toBe('golangtools');
  });

  it('does NOT strip google (not in curated list)', () => {
    expect(stripKnownVanityPrefix('google')).toBe('google');
  });

  it('returns unknown brands unchanged', () => {
    expect(stripKnownVanityPrefix('github')).toBe('github');
  });
});

describe('buildBrandSearchQuery — vanity-prefix stripping in queries', () => {
  it('produces "photino logo" for tryphotino.io (curated strip)', () => {
    expect(buildBrandSearchQuery('https://www.tryphotino.io/')).toBe('photino logo');
  });

  it('produces "applemusic logo" for applemusic.com (NO strip)', () => {
    expect(buildBrandSearchQuery('https://applemusic.com/')).toBe('applemusic logo');
  });

  it('produces "goodreads logo" for goodreads.com (NO strip)', () => {
    expect(buildBrandSearchQuery('https://goodreads.com/')).toBe('goodreads logo');
  });
});

