import { describe, expect, it } from 'vitest';
import {
  parseLargestSize, parseOriginIconCandidates,
  extractDuckDuckGoToken, isDataUrl, getFileNameFromUrl,
} from '@/background/icons/icon-parse';

describe('parseLargestSize', () => {
  it('picks the largest min-edge across all size tokens', () => {
    // Each token: min(w,h). Best = max across tokens.
    // '16x16' → 16, '32x32' → 32 → best = 32
    expect(parseLargestSize('16x16 32x32')).toBe(32);
    expect(parseLargestSize('any')).toBe(512);
    expect(parseLargestSize('')).toBe(0);
  });
});

describe('parseOriginIconCandidates', () => {
  it('extracts icon links and weights apple-touch-icon higher', () => {
    const html = '<link rel="apple-touch-icon" href="/a.png" sizes="180x180"><link rel="icon" href="/f.ico">';
    const out = parseOriginIconCandidates(html, 'https://acme.com');
    expect(out.some(c => c.url === 'https://acme.com/a.png' && c.weight === 100)).toBe(true);
    expect(out.some(c => c.url === 'https://acme.com/f.ico')).toBe(true);
  });
});

describe('extractDuckDuckGoToken', () => {
  it('finds vqd in several shapes', () => {
    expect(extractDuckDuckGoToken('var x; vqd="abc123";')).toBe('abc123');
    expect(extractDuckDuckGoToken('"vqd":"zzz"')).toBe('zzz');
    expect(extractDuckDuckGoToken('nothing')).toBeNull();
  });
});

describe('isDataUrl / getFileNameFromUrl', () => {
  it('recognizes image data URLs and derives file names', () => {
    expect(isDataUrl('data:image/png;base64,AAA')).toBe(true);
    expect(isDataUrl('https://x/y')).toBe(false);
    expect(getFileNameFromUrl('https://acme.com/path/logo.png')).toBe('logo.png');
    expect(getFileNameFromUrl('not a url')).toBe('icon');
  });
});
