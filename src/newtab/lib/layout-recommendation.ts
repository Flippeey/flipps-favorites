// Resolution-aware layout recommendation for onboarding defaults.
//
// Maps the user's viewport/screen metrics to a recommended layout preset so a
// fresh install starts with sensibly-sized tiles: small laptops get a denser
// grid, large/4K monitors get roomier tiles instead of a sparse layout. The
// mapping is a PURE function of the metrics passed in (no window/screen reads)
// so it is unit-testable without a real DOM. Read the metrics at the call site
// via readViewportMetrics() and pass them in.
//
// A non-'custom' layoutPreset already resolves to a tile/width/gap spec inside
// applyDensity() (lib/accent.ts), so recommending a preset is enough to drive
// the whole density — we never need to emit raw pixel sizes here.

import type { LayoutPresetId } from '@/shared/models';

// Coarse sizing bucket the recommendation falls into. Maps 1:1 onto a non-custom
// preset, but is named by intent (screen class) for readability and assertions.
export type LayoutSizingBucket = 'small' | 'standard' | 'large' | 'xlarge';

export interface ViewportMetrics {
  // Effective CSS pixels available to the page (window.innerWidth/Height).
  innerWidth: number;
  innerHeight: number;
  // window.devicePixelRatio — physical pixels per CSS pixel.
  devicePixelRatio: number;
  // Physical screen extent in device pixels (window.screen.width/height).
  screenWidth: number;
  screenHeight: number;
}

export interface LayoutRecommendation {
  layoutPreset: Exclude<LayoutPresetId, 'custom'>;
  sizingBucket: LayoutSizingBucket;
}

// Effective-width cutoffs (CSS px). Each is the upper bound (exclusive) of its
// band; below the first → compact, then cascade upward.
const SMALL_LAPTOP_MAX = 1500;   // < 1500: 1366x768-class laptops, scaled 13" screens.
const STANDARD_MAX = 2100;       // 1500–2099: ~1080p (1920) desktops.
const LARGE_MAX = 5000;          // 2100–4999: 1440p/QHD (2560) through 4K (3840) → spacious.
//                                // >= 5000: only 5K-class width (e.g. a 5120 super-ultrawide)
//                                // is roomy enough that spacious reads sparse → presentation.
//                                // A single 4K / large flat panel stays spacious on purpose —
//                                // presentation tiles are oversized on one big monitor.

// Aspect ratio at/above which a display is treated as ultrawide. A 21:9 monitor
// is ~2.33; 16:9 is ~1.78. Ultrawide rows hold far more tiles horizontally, so a
// sparse preset looks empty — bump such displays one band roomier. The bump is
// capped at 'spacious' (see SPACIOUS_INDEX): presentation is reserved for true 5K+
// width and is never reached via the aspect bump, so a 3440x1440 ultrawide lands
// spacious, not presentation (user report — presentation tiles too large there).
const ULTRAWIDE_ASPECT = 2.1;

const BUCKET_BY_PRESET: Record<Exclude<LayoutPresetId, 'custom'>, LayoutSizingBucket> = {
  compact: 'small',
  balanced: 'standard',
  spacious: 'large',
  presentation: 'xlarge',
};

// Ordered densest → roomiest, so "bump one band roomier" is an index step.
const PRESET_LADDER: Exclude<LayoutPresetId, 'custom'>[] = [
  'compact',
  'balanced',
  'spacious',
  'presentation',
];

// Ceiling for the ultrawide bump. The aspect nudge may lift a display toward
// 'spacious' but never into 'presentation' — that band is earned only by 5K+ base
// width in basePreset().
const SPACIOUS_INDEX = PRESET_LADDER.indexOf('spacious');

// Effective CSS width, accounting for OS/browser scaling. A 4K panel viewed at
// 200% scale reports innerWidth ~1920 but screenWidth 3840 @ dpr 2 — physically
// 4K-class real estate. Take the larger of the reported CSS width and the
// scaled-down physical width so a scaled 4K display still reads as 4K-class.
function effectiveWidth(m: ViewportMetrics): number {
  const dpr = m.devicePixelRatio > 0 ? m.devicePixelRatio : 1;
  const physicalCssWidth = m.screenWidth / dpr;
  return Math.max(m.innerWidth, physicalCssWidth);
}

function basePreset(width: number): Exclude<LayoutPresetId, 'custom'> {
  if (width < SMALL_LAPTOP_MAX) return 'compact';
  if (width < STANDARD_MAX) return 'balanced';
  if (width < LARGE_MAX) return 'spacious';
  return 'presentation';
}

export function recommendLayout(metrics: ViewportMetrics): LayoutRecommendation {
  const width = effectiveWidth(metrics);
  let preset = basePreset(width);

  // Ultrawide displays fit many more columns; nudge one band roomier so the grid
  // doesn't read as sparse. Capped at 'spacious' — never into presentation (that is
  // 5K+ width only). max() guards against downgrading a base that is already roomier
  // (a 5K+ ultrawide keeps its presentation base).
  const aspect = metrics.innerHeight > 0 ? metrics.innerWidth / metrics.innerHeight : 0;
  if (aspect >= ULTRAWIDE_ASPECT) {
    const baseIndex = PRESET_LADDER.indexOf(preset);
    const bumped = Math.min(baseIndex + 1, SPACIOUS_INDEX);
    preset = PRESET_LADDER[Math.max(baseIndex, bumped)];
  }

  return { layoutPreset: preset, sizingBucket: BUCKET_BY_PRESET[preset] };
}

// Non-pure convenience reader: pulls live metrics from the newtab page globals.
// Kept separate from recommendLayout so the mapping stays testable. Uses only
// standard window/screen APIs — no extra permissions.
export function readViewportMetrics(): ViewportMetrics {
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
  };
}
