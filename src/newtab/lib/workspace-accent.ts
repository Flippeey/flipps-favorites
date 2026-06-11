import { ACCENT_PRESETS } from '../components/settings-controls';

/**
 * Pick a distinct accent for a newly created workspace.
 *
 * Rotates through the curated {@link ACCENT_PRESETS} palette, returning the first
 * preset not already used by an existing workspace so multi-workspace users get
 * instant visual differentiation without manual color picking. Comparison is
 * case-insensitive (stored accents may differ in hex casing).
 *
 * Deterministic — depends only on the palette order and the accents already in
 * use, never on render timing or randomness. Once every preset is taken the
 * palette is exhausted, so it wraps around by least usage: the preset used the
 * fewest times (ties broken by palette order) is returned, keeping reuse even.
 */
export function pickNextAccent(usedAccents: readonly string[]): string {
  const used = usedAccents.map(a => a.toLowerCase());

  const firstUnused = ACCENT_PRESETS.find(
    p => !used.includes(p.value.toLowerCase()),
  );
  if (firstUnused) return firstUnused.value;

  // Palette exhausted — wrap around to the least-used preset (ties → palette order).
  let best = ACCENT_PRESETS[0];
  let bestCount = Infinity;
  for (const preset of ACCENT_PRESETS) {
    const value = preset.value.toLowerCase();
    const count = used.filter(a => a === value).length;
    if (count < bestCount) {
      bestCount = count;
      best = preset;
    }
  }
  return best.value;
}
