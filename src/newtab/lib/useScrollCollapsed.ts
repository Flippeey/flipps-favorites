import { useEffect, useState } from 'react';

// Shared source of truth for the "page is scrolled" state that collapses the
// hero (clock + inline search) and condenses the top nav.
//
// Both the nav and the hero reclaim vertical space when collapsed. On a page
// that overflows by only a little, naively collapsing at `scrollY > 8` removes
// more height than the page had to scroll, so the browser clamps scrollY back
// toward the top, which un-collapses, which restores the height — an
// oscillation that reads as glitchy scrolling near the threshold.
//
// The overflow gate fixes this: we only allow collapsing while the page is
// still expanded *and* it overflows by more than the height collapsing can
// reclaim. Once collapsed we keep that state until the user returns near the
// very top (hysteresis), so collapsing can never feed back into expanding.

const COLLAPSE_AT = 8; // px scrolled before the hero/nav may collapse
const EXPAND_AT = 2; // re-expand only when back near the very top
const MIN_OVERFLOW = 360; // required expanded overflow before collapsing is allowed

/**
 * Decide the next collapsed state from the previous state and current metrics.
 * Pure so the anti-oscillation invariant can be unit-tested without layout.
 */
export function nextCollapsed(prev: boolean, scrollY: number, overflow: number): boolean {
  if (prev) {
    // Stay collapsed until the user scrolls back near the top.
    return scrollY > EXPAND_AT;
  }
  // Only collapse when there is enough room that collapsing stays stable.
  return scrollY > COLLAPSE_AT && overflow > MIN_OVERFLOW;
}

export function useScrollCollapsed(): boolean {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const update = () => {
      const overflow = document.documentElement.scrollHeight - window.innerHeight;
      setCollapsed(prev => nextCollapsed(prev, window.scrollY, overflow));
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  return collapsed;
}
