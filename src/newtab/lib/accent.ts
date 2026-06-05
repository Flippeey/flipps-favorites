interface Rgb { r: number; g: number; b: number }

function parseHex(hex: string): Rgb {
  const m = hex.replace('#', '');
  return {
    r: parseInt(m.substring(0, 2), 16),
    g: parseInt(m.substring(2, 4), 16),
    b: parseInt(m.substring(4, 6), 16),
  };
}

function mix(a: string, b: string, t: number): string {
  const A = parseHex(a), B = parseHex(b);
  const r = Math.round(A.r + (B.r - A.r) * t);
  const g = Math.round(A.g + (B.g - A.g) * t);
  const blue = Math.round(A.b + (B.b - A.b) * t);
  return `rgb(${r}, ${g}, ${blue})`;
}

function hexAlpha(hex: string, a: number): string {
  const { r, g, b } = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// ── Contrast math (WCAG 2.1) ───────────────────────────────────────────────
// The accent palette spans the full luminance range (#C9A227 Yellow → #4B5360
// Graphite), so no single hard-coded foreground is legible across all of it.
// These helpers let applyAccent() derive a contrast-correct foreground per accent.

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

function toHex({ r, g, b }: Rgb): string {
  const h = (n: number): string => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const DARK_FG = '#1A1110';
const AA_BODY = 4.5;

// Page background per theme (tokens.css --ink-0 / its [data-theme="light"] override).
const SURFACE_BASE: Record<'light' | 'dark', Rgb> = {
  light: parseHex('#F5F2EC'),
  dark: parseHex('#141414'),
};

/**
 * Foreground color for text/glyphs painted *on top of* the accent fill
 * (primary button, active segmented option, folder count badge). Three-tier
 * preference, each rung guaranteed to clear AA before it's chosen:
 *   1. white — for the dark-enough accents (Graphite/Purple/Blue), matching the review;
 *   2. soft near-black (#1A1110) — softer than pure black on the bright accents (Yellow/Lime/Orange);
 *   3. pure black — only for the two borderline mids (Teal/Red) where the soft
 *      ink dips just under 4.5; pure black is provably ≥4.58 whenever white falls short.
 * A fixed luminance split would instead leave the mid accents white at 3.6–4.4:1.
 */
export function accentContrast(hex: string): string {
  const accent = parseHex(hex);
  if (contrastRatio(WHITE, accent) >= AA_BODY) return '#FFFFFF';
  if (contrastRatio(parseHex(DARK_FG), accent) >= AA_BODY) return DARK_FG;
  return '#000000';
}

/**
 * Accent shade legible as *text on the current theme surface* (section title/
 * icon, active sort/folder-picker option, breadcrumb + context-menu hover).
 * Returns the accent unchanged when it already clears AA on the base, otherwise
 * mixes toward white (dark theme) or black (light theme) until it does — fixing
 * bright accents washing out on light and Graphite vanishing on dark.
 */
export function accentOnSurface(hex: string, theme: 'light' | 'dark'): string {
  const accent = parseHex(hex);
  const base = SURFACE_BASE[theme];
  if (contrastRatio(accent, base) >= AA_BODY) return hex;
  const pole = theme === 'light' ? BLACK : WHITE;
  for (let t = 0.08; t < 1; t += 0.08) {
    const shade = mixRgb(accent, pole, t);
    if (contrastRatio(shade, base) >= AA_BODY) return toHex(shade);
  }
  return toHex(pole);
}

function currentTheme(): 'light' | 'dark' {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function applyAccent(hex: string, theme: 'light' | 'dark' = currentTheme()): void {
  const root = document.documentElement;
  root.style.setProperty('--accent', hex);
  root.style.setProperty('--accent-500', hex);
  root.style.setProperty('--accent-300', mix(hex, '#FFFFFF', 0.4));
  root.style.setProperty('--accent-600', mix(hex, '#000000', 0.2));
  root.style.setProperty('--accent-glow', hexAlpha(hex, 0.32));
  root.style.setProperty('--accent-soft', hexAlpha(hex, 0.10));
  root.style.setProperty('--accent-border', hexAlpha(hex, 0.28));
  root.style.setProperty('--accent-contrast', accentContrast(hex));
  root.style.setProperty('--accent-on-surface', accentOnSurface(hex, theme));
}

interface DensitySpec {
  tile: number;
  width: number;
  gap: number;
}

const DENSITY_PRESETS: Record<string, DensitySpec> = {
  compact:      { tile: 56,  width: 84,  gap: 14 },
  balanced:     { tile: 76,  width: 112, gap: 22 },
  spacious:     { tile: 92,  width: 132, gap: 28 },
  presentation: { tile: 116, width: 168, gap: 36 },
};

export interface CustomDensityValues {
  tileSize: number;   // bookmarkIconSize
  tileWidth: number;  // bookmarkTileWidth
  gapX: number;       // favoritesColumnGap
  gapY: number;       // favoritesRowGap
}

export function applyDensity(preset: string, custom?: CustomDensityValues): void {
  const root = document.documentElement;
  if (preset === 'custom' && custom) {
    root.style.setProperty('--tile-size', custom.tileSize + 'px');
    root.style.setProperty('--tile-width', custom.tileWidth + 'px');
    root.style.setProperty('--grid-gap-x', custom.gapX + 'px');
    root.style.setProperty('--grid-gap-y', custom.gapY + 'px');
    return;
  }
  const spec = DENSITY_PRESETS[preset] ?? DENSITY_PRESETS.balanced;
  root.style.setProperty('--tile-size', spec.tile + 'px');
  root.style.setProperty('--tile-width', spec.width + 'px');
  root.style.setProperty('--grid-gap-x', spec.gap + 'px');
  root.style.setProperty('--grid-gap-y', spec.gap + 'px');
}

export function resolveThemeAttr(mode: string): 'light' | 'dark' {
  if (mode === 'light') return 'light';
  if (mode === 'dark') return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
