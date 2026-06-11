import { describe, expect, it } from 'vitest';
import { pickNextAccent } from '@/newtab/lib/workspace-accent';
import { ACCENT_PRESETS } from '@/newtab/components/settings-controls';

// pickNextAccent gives each new workspace a distinct accent so multi-workspace
// users get instant visual differentiation. The behavior that matters: it never
// reuses a color while fresh ones remain, it is deterministic (no randomness),
// and it degrades sanely once the curated palette is exhausted.

const PALETTE = ACCENT_PRESETS.map(p => p.value);

describe('pickNextAccent', () => {
  it('returns the first palette color for the very first workspace', () => {
    expect(pickNextAccent([])).toBe(PALETTE[0]);
  });

  it('skips colors already in use, walking the palette in order', () => {
    expect(pickNextAccent([PALETTE[0]])).toBe(PALETTE[1]);
    expect(pickNextAccent([PALETTE[0], PALETTE[1]])).toBe(PALETTE[2]);
  });

  it('assigns a unique color to each workspace until the palette is exhausted', () => {
    const used: string[] = [];
    for (let i = 0; i < PALETTE.length; i++) {
      const next = pickNextAccent(used);
      expect(used).not.toContain(next); // never a duplicate while fresh ones remain
      used.push(next);
    }
    // Every preset got handed out exactly once.
    expect(new Set(used).size).toBe(PALETTE.length);
    expect(new Set(used)).toEqual(new Set(PALETTE));
  });

  it('is deterministic — same input yields the same output', () => {
    const used = [PALETTE[0], PALETTE[2]];
    expect(pickNextAccent(used)).toBe(pickNextAccent(used));
  });

  it('matches case-insensitively so hex casing differences still count as used', () => {
    expect(pickNextAccent([PALETTE[0].toLowerCase()])).toBe(PALETTE[1]);
    expect(pickNextAccent([PALETTE[0].toUpperCase()])).toBe(PALETTE[1]);
  });

  it('wraps around to the least-used color once every preset is taken', () => {
    // Full palette in use exactly once → wrap to the least-used, which is the
    // first preset (all tied at 1, ties broken by palette order).
    expect(pickNextAccent([...PALETTE])).toBe(PALETTE[0]);

    // First preset already doubled-up → it is no longer least-used, so the next
    // pick rotates to the second preset, keeping reuse spread evenly.
    expect(pickNextAccent([...PALETTE, PALETTE[0]])).toBe(PALETTE[1]);
  });

  it('ignores custom (non-palette) accents when choosing the next color', () => {
    // A user-set custom hex is not in the palette; it must not block palette picks.
    expect(pickNextAccent(['#123456'])).toBe(PALETTE[0]);
  });
});
