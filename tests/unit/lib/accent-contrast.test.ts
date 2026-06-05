import { describe, expect, it } from 'vitest';
import { accentContrast, accentOnSurface } from '@/newtab/lib/accent';
import { ACCENT_PRESETS } from '@/newtab/components/settings-controls';

// Regression guard for the v2.3.4 design-review P1 findings: the accent palette
// spans the full luminance range, so a hard-coded foreground breaks AA at one
// end. accentContrast()/accentOnSurface() must keep every shipped accent legible
// in both themes. WCAG 2.1 AA needs 4.5:1 for body text.
//
// Contrast is recomputed here from scratch (not reusing the implementation's
// math) so the test genuinely fails if the derivation regresses, rather than
// mirroring it. Surface bases mirror tokens.css --ink-0 / its light override.
const AA_BODY = 4.5;
const SURFACE_BASE = { light: '#F5F2EC', dark: '#141414' } as const;

function srgbToLinear(c: number): number {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const m = hex.replace('#', '');
  const r = parseInt(m.substring(0, 2), 16);
  const g = parseInt(m.substring(2, 4), 16);
  const b = parseInt(m.substring(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// The custom color picker (AppearanceSection) accepts any hex, so the foreground
// pick must hold for arbitrary input, not only the curated presets. These sit on
// the luminance boundaries that broke a fixed split: pure grey (white/black
// near-tie), max-bright yellow (white fails hard), near-black (accent-as-text
// fails on dark, must lighten).
const CUSTOM_ADVERSARIAL = ['#808080', '#FFFF00', '#0A0A0A', '#7F7F7F', '#FEFEFE', '#010101'];
const ALL: { label: string; value: string }[] = [
  ...ACCENT_PRESETS.map(p => ({ label: p.label, value: p.value })),
  ...CUSTOM_ADVERSARIAL.map(v => ({ label: `custom ${v}`, value: v })),
];

describe('accentContrast — foreground on the accent fill (button / segmented / count badge)', () => {
  for (const c of ALL) {
    it(`${c.label} (${c.value}) clears AA against its own fill`, () => {
      const ratio = contrast(accentContrast(c.value), c.value);
      expect(ratio).toBeGreaterThanOrEqual(AA_BODY);
    });
  }
});

describe('accentOnSurface — accent as text on the theme surface (section title / sort / ctx)', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const c of ALL) {
      it(`${c.label} (${c.value}) clears AA on the ${theme} surface`, () => {
        const ratio = contrast(accentOnSurface(c.value, theme), SURFACE_BASE[theme]);
        expect(ratio).toBeGreaterThanOrEqual(AA_BODY);
      });
    }
  }
});
