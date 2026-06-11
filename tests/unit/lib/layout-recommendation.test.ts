import { describe, expect, it } from 'vitest';
import {
  recommendLayout,
  type ViewportMetrics,
} from '@/newtab/lib/layout-recommendation';

// Build full metrics from a screen size; window matches the screen (maximized,
// unscaled) unless overridden. Keeps fixtures focused on the breakpoint under test.
function metrics(overrides: Partial<ViewportMetrics> & Pick<ViewportMetrics, 'screenWidth' | 'screenHeight'>): ViewportMetrics {
  const { screenWidth, screenHeight } = overrides;
  return {
    innerWidth: screenWidth,
    innerHeight: screenHeight,
    devicePixelRatio: 1,
    ...overrides,
  };
}

describe('recommendLayout', () => {
  // WHY: a 1366x768 laptop has little room; oversized tiles would force scrolling
  // and waste the cramped canvas — it must default to the densest preset.
  it('small laptop (1366x768) -> compact', () => {
    const rec = recommendLayout(metrics({ screenWidth: 1366, screenHeight: 768 }));
    expect(rec.layoutPreset).toBe('compact');
    expect(rec.sizingBucket).toBe('small');
  });

  // WHY: 1080p is the mainstream desktop size the stored default ('balanced') is
  // tuned for; the recommender must agree so it isn't a no-op regression there.
  it('1080p (1920x1080) -> balanced', () => {
    const rec = recommendLayout(metrics({ screenWidth: 1920, screenHeight: 1080 }));
    expect(rec.layoutPreset).toBe('balanced');
    expect(rec.sizingBucket).toBe('standard');
  });

  // WHY: a 1440p panel has noticeably more room; balanced tiles read small, so it
  // should step up to spacious.
  it('1440p (2560x1440) -> spacious', () => {
    const rec = recommendLayout(metrics({ screenWidth: 2560, screenHeight: 1440 }));
    expect(rec.layoutPreset).toBe('spacious');
    expect(rec.sizingBucket).toBe('large');
  });

  // WHY: native 4K real estate would look sparse with mid-size tiles; it should
  // default to the roomiest preset.
  it('4K (3840x2160) -> presentation', () => {
    const rec = recommendLayout(metrics({ screenWidth: 3840, screenHeight: 2160 }));
    expect(rec.layoutPreset).toBe('presentation');
    expect(rec.sizingBucket).toBe('xlarge');
  });

  // WHY: a 4K panel maximized at 200% OS scale exposes only ~1920 effective CSS
  // px — the usable canvas IS 1080p-class, so 1080p sizing is correct. This locks
  // that we key off EFFECTIVE width, not raw physical pixels.
  it('4K at 200% scale (effective 1920) -> balanced', () => {
    const rec = recommendLayout({
      innerWidth: 1920,
      innerHeight: 1080,
      devicePixelRatio: 2,
      screenWidth: 3840,
      screenHeight: 2160,
    });
    expect(rec.layoutPreset).toBe('balanced');
  });

  // WHY: a non-maximized window on a big screen still reports a small innerWidth,
  // but the physical screen (screenWidth/dpr) reveals the real real-estate class.
  // effectiveWidth takes the larger signal so an un-maximized 4K window isn't
  // mis-sized as a tiny laptop.
  it('small window on a 4K screen falls back to physical width', () => {
    const rec = recommendLayout({
      innerWidth: 900,
      innerHeight: 700,
      devicePixelRatio: 1,
      screenWidth: 3840,
      screenHeight: 2160,
    });
    expect(rec.layoutPreset).toBe('presentation');
  });

  // WHY: ultrawide rows fit many more columns; the same width band would look
  // sparse, so an ultrawide is bumped one band roomier. 2560x1080 (UW-FHD) is
  // 2560-class width (spacious) but its 2.37 aspect bumps it to presentation.
  it('ultrawide (2560x1080) -> presentation (bumped one band from spacious)', () => {
    const rec = recommendLayout(metrics({ screenWidth: 2560, screenHeight: 1080 }));
    expect(rec.layoutPreset).toBe('presentation');
    expect(rec.sizingBucket).toBe('xlarge');
  });

  // --- boundary locks: pin the exact cutoffs so a threshold change fails a test ---

  // WHY: 1500 is the small-laptop/standard divide. Just under stays compact...
  it('just below the small-laptop cutoff (1499) -> compact', () => {
    expect(recommendLayout(metrics({ screenWidth: 1499, screenHeight: 900 })).layoutPreset).toBe('compact');
  });

  // ...and exactly at the cutoff crosses into balanced.
  it('at the small-laptop cutoff (1500) -> balanced', () => {
    expect(recommendLayout(metrics({ screenWidth: 1500, screenHeight: 900 })).layoutPreset).toBe('balanced');
  });

  // WHY: 2100 is the standard/large divide.
  it('at the standard cutoff (2100) -> spacious', () => {
    expect(recommendLayout(metrics({ screenWidth: 2100, screenHeight: 1200 })).layoutPreset).toBe('spacious');
  });

  // WHY: 3000 is the large/4K divide.
  it('at the 4K cutoff (3000) -> presentation', () => {
    expect(recommendLayout(metrics({ screenWidth: 3000, screenHeight: 1600 })).layoutPreset).toBe('presentation');
  });

  // WHY: the ultrawide bump must be capped — a band already at the roomiest preset
  // stays there rather than overflowing the ladder.
  it('ultrawide 4K stays at presentation (bump is capped)', () => {
    expect(recommendLayout(metrics({ screenWidth: 5120, screenHeight: 1440 })).layoutPreset).toBe('presentation');
  });
});
