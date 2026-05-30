import { describe, expect, it } from 'vitest';
import {
  extractHostname, getDomainRoot, tokenizeQuery, isStockPhotoHost,
  isLogoAggregatorHost, isLikelyAggregatorHost, isCollageTitle, stripHtml,
  scoreDuckDuckGoResult, clampFaviconSize,
} from '../../../src/background/icons/icon-classify';

describe('extractHostname', () => {
  it('strips www and tolerates scheme-less input', () => {
    expect(extractHostname('https://www.example.com/x')).toBe('example.com');
    expect(extractHostname('example.com')).toBe('example.com');
    expect(extractHostname(undefined)).toBeNull();
  });
});

describe('getDomainRoot', () => {
  it('returns the registrable-ish last two labels', () => {
    expect(getDomainRoot('a.b.example.com')).toBe('example.com');
    expect(getDomainRoot('localhost')).toBe('localhost');
    expect(getDomainRoot(null)).toBeNull();
  });
});

describe('tokenizeQuery', () => {
  it('drops short tokens and logo/icon noise', () => {
    expect(tokenizeQuery('Notion logo icon a')).toEqual(['notion']);
  });
});

describe('host classifiers', () => {
  it('flags stock-photo, logo-aggregator, and likely-aggregator hosts', () => {
    expect(isStockPhotoHost('images.shutterstock.com')).toBe(true);
    expect(isLogoAggregatorHost('seeklogo.com')).toBe(true);
    expect(isLikelyAggregatorHost('i.pinimg.com')).toBe(true);
    expect(isStockPhotoHost('example.com')).toBe(false);
    expect(isStockPhotoHost(null)).toBe(false);
  });
});

describe('isCollageTitle / stripHtml', () => {
  it('detects collage words and strips tags', () => {
    expect(isCollageTitle('Logo set bundle')).toBe(true);
    expect(isCollageTitle('Acme logo')).toBe(false);
    expect(stripHtml('<b>Hi</b> there')).toBe('Hi there');
  });
});

describe('clampFaviconSize', () => {
  it('clamps to [128,256]', () => {
    expect(clampFaviconSize(64)).toBe(128);
    expect(clampFaviconSize(999)).toBe(256);
    expect(clampFaviconSize(200)).toBe(200);
  });
});

describe('scoreDuckDuckGoResult', () => {
  const base = { image: 'https://acme.com/logo.svg', thumbnail: 't', title: 'Acme logo', url: 'https://acme.com/page', width: 256, height: 256 };
  it('rewards exact-host + svg + square over a stock-photo banner', () => {
    const good = scoreDuckDuckGoResult(base, 'acme.com', ['acme']);
    const bad = scoreDuckDuckGoResult(
      { ...base, image: 'https://shutterstock.com/banner-hero.jpg', url: 'https://shutterstock.com/x', width: 1600, height: 400, title: 'banner' },
      'acme.com', ['acme'],
    );
    expect(good).toBeGreaterThan(bad);
  });
});
