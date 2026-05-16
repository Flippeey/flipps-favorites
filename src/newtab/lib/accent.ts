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

export function applyAccent(hex: string): void {
  const root = document.documentElement;
  root.style.setProperty('--accent', hex);
  root.style.setProperty('--accent-500', hex);
  root.style.setProperty('--accent-300', mix(hex, '#FFFFFF', 0.4));
  root.style.setProperty('--accent-600', mix(hex, '#000000', 0.2));
  root.style.setProperty('--accent-glow', hexAlpha(hex, 0.32));
  root.style.setProperty('--accent-soft', hexAlpha(hex, 0.10));
  root.style.setProperty('--accent-border', hexAlpha(hex, 0.28));
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

export function applyDensity(preset: string): void {
  const spec = DENSITY_PRESETS[preset] ?? DENSITY_PRESETS.balanced;
  const root = document.documentElement;
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
