import { describe, expect, it } from 'vitest';
import { buildFallbackSvgDataUrl, colorFromLabel, escapeSvgText } from '../../../src/shared/icon-fallback';

describe('escapeSvgText', () => {
  it('escapes all five XML entities', () => {
    expect(escapeSvgText(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});

describe('colorFromLabel', () => {
  it('is deterministic and 36deg apart', () => {
    // 'AB' → char codes 65+66 = 131; 131 % 360 = 131
    expect(colorFromLabel('AB')).toEqual({
      start: 'hsl(131 70% 58%)',
      end: 'hsl(167 68% 40%)',
    });
  });
});

describe('buildFallbackSvgDataUrl', () => {
  it('reproduces the icon-service generated SVG byte-for-byte', () => {
    // Snapshot of the pre-refactor createGeneratedRecord output for label 'Calendar'.
    const label = 'Calendar';
    const initials = 'CA';
    const { start, end } = colorFromLabel(label);
    const expectedSvg = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" role="img" aria-hidden="true">',
      '<defs>',
      `<linearGradient id="bookmark-gradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${start}" /><stop offset="100%" stop-color="${end}" /></linearGradient>`,
      '</defs>',
      '<rect width="96" height="96" rx="24" fill="url(#bookmark-gradient)" />',
      `<text x="48" y="54" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="32" font-weight="700" fill="#FFFFFF">${initials}</text>`,
      '</svg>',
    ].join('');
    const expected = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(expectedSvg)}`;
    expect(buildFallbackSvgDataUrl(label)).toBe(expected);
  });

  it('uses • when there are no usable initials', () => {
    expect(buildFallbackSvgDataUrl('')).toContain(encodeURIComponent('•'));
  });
});
