import { describe, expect, it } from 'vitest';
import { rankCandidatesByShape } from '@/background/icons/icon-classify';

// ---------------------------------------------------------------------------
// FIX 1 — Shape pre-ranking for auto-selection
//
// The auto path (fetchDuckDuckGoFirstHit) should try roughly-SQUARE candidates
// before wide/tall ones, so the fetch budget is not exhausted on unfetchable
// wide OpenGraph cards while the correct square logo sits just below.
// ---------------------------------------------------------------------------

interface TestCandidate {
  imageUrl: string;
  previewUrl: string;
  label: string;
  sourceKind: 'search';
  sourcePageUrl: string;
  width?: number;
  height?: number;
}

function makeCandidate(overrides: Partial<TestCandidate> & { imageUrl: string }): TestCandidate {
  return {
    previewUrl: overrides.imageUrl,
    label: 'Test',
    sourceKind: 'search',
    sourcePageUrl: 'https://example.com',
    ...overrides,
  };
}

describe('rankCandidatesByShape — shape pre-ranking for auto path', () => {
  it('surfaces a square candidate above wide ones when wide are scored higher', () => {
    // Simulates the Photino case: top 3 by score are wide GitHub OG cards (1200x600),
    // the valid square Photino logo (200x200) is at rank #4.
    const candidates = [
      makeCandidate({ imageUrl: 'https://opengraph.github.com/wide1.png', width: 1200, height: 600, label: 'Wide OG 1' }),
      makeCandidate({ imageUrl: 'https://opengraph.github.com/wide2.png', width: 1200, height: 600, label: 'Wide OG 2' }),
      makeCandidate({ imageUrl: 'https://opengraph.github.com/wide3.png', width: 1200, height: 600, label: 'Wide OG 3' }),
      makeCandidate({ imageUrl: 'https://photino.io/logo.png', width: 200, height: 200, label: 'Photino Logo' }),
    ];

    const ranked = rankCandidatesByShape(candidates);

    // The square Photino logo must appear before all wide OG cards
    const squareIndex = ranked.findIndex(c => c.imageUrl === 'https://photino.io/logo.png');
    const firstWideIndex = ranked.findIndex(c => c.imageUrl.includes('opengraph'));
    expect(squareIndex).toBeLessThan(firstWideIndex);
  });

  it('preserves original score order within the same shape band', () => {
    // Two square candidates should keep their relative order (higher-scored first)
    const candidates = [
      makeCandidate({ imageUrl: 'https://a.com/logo1.png', width: 256, height: 256, label: 'First square' }),
      makeCandidate({ imageUrl: 'https://b.com/logo2.png', width: 200, height: 200, label: 'Second square' }),
      makeCandidate({ imageUrl: 'https://c.com/wide.png', width: 1200, height: 600, label: 'Wide' }),
    ];

    const ranked = rankCandidatesByShape(candidates);
    const idx1 = ranked.findIndex(c => c.imageUrl === 'https://a.com/logo1.png');
    const idx2 = ranked.findIndex(c => c.imageUrl === 'https://b.com/logo2.png');
    expect(idx1).toBeLessThan(idx2);
  });

  it('treats candidates without reported dimensions as neutral (between square and wide)', () => {
    const candidates = [
      makeCandidate({ imageUrl: 'https://a.com/wide.png', width: 1200, height: 600, label: 'Wide' }),
      makeCandidate({ imageUrl: 'https://b.com/unknown.png', label: 'Unknown dims' }), // no width/height
      makeCandidate({ imageUrl: 'https://c.com/square.png', width: 200, height: 200, label: 'Square' }),
    ];

    const ranked = rankCandidatesByShape(candidates);

    // Square should be first, unknown in the middle, wide last
    const squareIdx = ranked.findIndex(c => c.imageUrl === 'https://c.com/square.png');
    const unknownIdx = ranked.findIndex(c => c.imageUrl === 'https://b.com/unknown.png');
    const wideIdx = ranked.findIndex(c => c.imageUrl === 'https://a.com/wide.png');
    expect(squareIdx).toBeLessThan(unknownIdx);
    expect(unknownIdx).toBeLessThan(wideIdx);
  });

  it('near-square aspect ratio (1.15) is treated as square band', () => {
    const candidates = [
      makeCandidate({ imageUrl: 'https://a.com/wide.png', width: 1200, height: 600, label: 'Wide' }),
      makeCandidate({ imageUrl: 'https://b.com/near-square.png', width: 256, height: 230, label: 'Near-square' }),
    ];

    const ranked = rankCandidatesByShape(candidates);
    const nearSquareIdx = ranked.findIndex(c => c.imageUrl === 'https://b.com/near-square.png');
    const wideIdx = ranked.findIndex(c => c.imageUrl === 'https://a.com/wide.png');
    expect(nearSquareIdx).toBeLessThan(wideIdx);
  });

  it('returns empty array for empty input', () => {
    expect(rankCandidatesByShape([])).toEqual([]);
  });

  it('handles all-square candidates (no reordering needed)', () => {
    const candidates = [
      makeCandidate({ imageUrl: 'https://a.com/logo1.png', width: 256, height: 256, label: 'First' }),
      makeCandidate({ imageUrl: 'https://b.com/logo2.png', width: 200, height: 200, label: 'Second' }),
    ];

    const ranked = rankCandidatesByShape(candidates);
    expect(ranked[0].imageUrl).toBe('https://a.com/logo1.png');
    expect(ranked[1].imageUrl).toBe('https://b.com/logo2.png');
  });
});
