import { describe, expect, it } from 'vitest';
import { nextCollapsed } from '@/newtab/lib/useScrollCollapsed';

// These tests pin the anti-oscillation invariant behind the scroll-collapse
// behavior. The glitch they guard against: on a page that overflows by only a
// little, collapsing the hero/nav removes more height than the page could
// scroll, snapping scrollY back to the top and un-collapsing — a flicker loop.

const BIG_OVERFLOW = 800; // page overflows by far more than collapse reclaims
const SMALL_OVERFLOW = 120; // page barely overflows

describe('nextCollapsed', () => {
  it('collapses once scrolled past the threshold when there is ample overflow', () => {
    expect(nextCollapsed(false, 0, BIG_OVERFLOW)).toBe(false);
    expect(nextCollapsed(false, 9, BIG_OVERFLOW)).toBe(true);
  });

  it('never collapses when the page barely overflows (prevents the flicker loop)', () => {
    // Even scrolled well past the trigger, too little overflow must stay expanded —
    // otherwise collapsing would remove the scroll room and oscillate.
    expect(nextCollapsed(false, 50, SMALL_OVERFLOW)).toBe(false);
  });

  it('stays collapsed across the messy threshold zone once collapsed', () => {
    // Once collapsed, a shrinking overflow (a side effect of collapsing) must not
    // flip it back; only returning near the top expands again.
    expect(nextCollapsed(true, 30, SMALL_OVERFLOW)).toBe(true);
    expect(nextCollapsed(true, 9, BIG_OVERFLOW)).toBe(true);
  });

  it('re-expands only when scrolled back near the very top', () => {
    expect(nextCollapsed(true, 2, BIG_OVERFLOW)).toBe(false);
    expect(nextCollapsed(true, 3, BIG_OVERFLOW)).toBe(true);
  });
});
