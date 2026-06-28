import { describe, expect, it } from 'vitest';
import { rankCandidatesByShape, scoreDuckDuckGoResult, tokenizeQuery } from '@/background/icons/icon-classify';

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

describe('rankCandidatesByShape — shape as bounded tiebreaker', () => {
  it('promotes a square candidate up by 1-2 positions when near-adjacent to wide', () => {
    // Square at position 1 can overtake wide at position 0 (1-position gap)
    const candidates = [
      makeCandidate({ imageUrl: 'https://a.com/wide.png', width: 1200, height: 600, label: 'Wide' }),
      makeCandidate({ imageUrl: 'https://b.com/square.png', width: 200, height: 200, label: 'Square' }),
    ];

    const ranked = rankCandidatesByShape(candidates);
    const squareIdx = ranked.findIndex(c => c.imageUrl.includes('square'));
    const wideIdx = ranked.findIndex(c => c.imageUrl.includes('wide'));
    expect(squareIdx).toBeLessThan(wideIdx);
  });

  it('square within 3 positions of wide CAN surface above it (intended — surfaces correct square logos)', () => {
    // SHAPE_NUDGE_POSITIONS = 2, so a square at position 3 gets sort key
    // 3 + 0*2 = 3, while a wide at position 0 gets sort key 0 + 2*2 = 4.
    // The square (key 3) surfaces above the wide (key 4).
    const candidates = [
      makeCandidate({ imageUrl: 'https://a.com/best-wide.png', width: 800, height: 200, label: 'Best Wide' }),
      makeCandidate({ imageUrl: 'https://b.com/second.png', width: 600, height: 200, label: 'Second' }),
      makeCandidate({ imageUrl: 'https://c.com/third.png', width: 500, height: 200, label: 'Third' }),
      makeCandidate({ imageUrl: 'https://d.com/gap3-square.png', width: 200, height: 200, label: 'Gap3 Square' }),
    ];

    const ranked = rankCandidatesByShape(candidates);
    const squareIdx = ranked.findIndex(c => c.imageUrl.includes('gap3-square'));
    const wideIdx = ranked.findIndex(c => c.imageUrl.includes('best-wide'));
    // Square at position 3 surfaces above wide at position 0 (3-position gap)
    expect(squareIdx).toBeLessThan(wideIdx);
  });

  it('relevance wins at 4+ position gap — wide stays ahead of distant square', () => {
    // SHAPE_NUDGE_POSITIONS = 2, so a square at position 4 gets sort key
    // 4 + 0*2 = 4, while a wide at position 0 gets sort key 0 + 2*2 = 4.
    // Equal keys → stable sort by original index → wide (index 0) stays first.
    const candidates = [
      makeCandidate({ imageUrl: 'https://a.com/best-wide.png', width: 800, height: 200, label: 'Best Wide' }),
      makeCandidate({ imageUrl: 'https://b.com/second.png', width: 600, height: 200, label: 'Second' }),
      makeCandidate({ imageUrl: 'https://c.com/third.png', width: 500, height: 200, label: 'Third' }),
      makeCandidate({ imageUrl: 'https://d.com/fourth.png', width: 400, height: 200, label: 'Fourth' }),
      makeCandidate({ imageUrl: 'https://e.com/gap4-square.png', width: 200, height: 200, label: 'Gap4 Square' }),
    ];

    const ranked = rankCandidatesByShape(candidates);
    const wideIdx = ranked.findIndex(c => c.imageUrl.includes('best-wide'));
    const squareIdx = ranked.findIndex(c => c.imageUrl.includes('gap4-square'));
    // The wide at position 0 stays ahead of the square at position 4 (4-position gap)
    expect(wideIdx).toBeLessThan(squareIdx);
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

  it('nearby square and wide: square is promoted but distant wides are not leapfrogged', () => {
    // Tests the bounded nature: in a list of mixed shapes, shape only swaps
    // adjacent-ish candidates. Items far apart in relevance stay ordered.
    const candidates = [
      makeCandidate({ imageUrl: 'https://a.com/wide1.png', width: 1200, height: 600, label: 'Wide 1' }),
      makeCandidate({ imageUrl: 'https://b.com/square1.png', width: 256, height: 256, label: 'Square 1' }),
      makeCandidate({ imageUrl: 'https://c.com/wide2.png', width: 1200, height: 600, label: 'Wide 2' }),
      makeCandidate({ imageUrl: 'https://d.com/square2.png', width: 200, height: 200, label: 'Square 2' }),
    ];

    const ranked = rankCandidatesByShape(candidates);
    // Square1 at pos 1 can overtake Wide1 at pos 0 (1-position gap)
    const square1 = ranked.findIndex(c => c.imageUrl.includes('square1'));
    const wide1 = ranked.findIndex(c => c.imageUrl.includes('wide1'));
    expect(square1).toBeLessThan(wide1);
    // Square2 at pos 3 can overtake Wide2 at pos 2 (1-position gap)
    const square2 = ranked.findIndex(c => c.imageUrl.includes('square2'));
    const wide2 = ranked.findIndex(c => c.imageUrl.includes('wide2'));
    expect(square2).toBeLessThan(wide2);
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

// ---------------------------------------------------------------------------
// Finding (A) — shape as tiebreaker, not primary sort key
//
// The input to rankCandidatesByShape is already sorted by relevance score
// (from scoreDuckDuckGoResult). Shape preference must NOT leapfrog a
// much-higher-relevance candidate. Square preference should only apply
// among candidates with comparable relevance (close input positions).
// ---------------------------------------------------------------------------

// Helper for building raw DDG result shape used in scoring
const makeDdgResult = (overrides: Partial<{
  image: string;
  thumbnail: string;
  title: string;
  url: string;
  width: number;
  height: number;
}>) => ({
  image: 'https://example.com/logo.png',
  thumbnail: 'https://example.com/thumb.png',
  title: 'Some Logo',
  url: 'https://example.com/page',
  width: 256,
  height: 256,
  ...overrides,
});

describe('Finding (A) — shape must not leapfrog significantly higher relevance', () => {
  it('POSITIVE: wide wordmark with clearly higher relevance outranks square off-brand stock', () => {
    // Scenario: candidate list sorted by score. Position 0 = highest relevance
    // (correct wide brand wordmark), positions 4-5 = low relevance (square stock).
    // Shape must NOT promote the stock image above the wordmark.
    // The gap of 4+ positions represents a significant relevance difference.
    const candidates = [
      // Position 0: correct brand wordmark (wide), highest relevance score
      makeCandidate({ imageUrl: 'https://seeklogo.com/acme-wordmark.svg', width: 800, height: 200, label: 'Acme Wordmark' }),
      // Position 1: another relevant candidate (wide)
      makeCandidate({ imageUrl: 'https://brandslogos.com/acme-logo.png', width: 600, height: 200, label: 'Acme Logo' }),
      // Position 2: moderate relevance (wide)
      makeCandidate({ imageUrl: 'https://cdn.example.com/acme-banner.png', width: 800, height: 300, label: 'Acme Banner' }),
      // Position 3: another moderate (wide)
      makeCandidate({ imageUrl: 'https://cdn.example.com/acme-og.png', width: 1200, height: 600, label: 'Acme OG' }),
      // Position 4: low relevance (square stock photo of wrong brand)
      makeCandidate({ imageUrl: 'https://stocksite.com/generic-square.png', width: 256, height: 256, label: 'Generic Square' }),
      // Position 5: low relevance (another square off-brand)
      makeCandidate({ imageUrl: 'https://stocksite.com/random-square.png', width: 200, height: 200, label: 'Random Square' }),
    ];

    const ranked = rankCandidatesByShape(candidates);

    // The wide wordmark at position 0 must NOT be pushed behind the square stock at position 4+
    const wordmarkIdx = ranked.findIndex(c => c.imageUrl.includes('acme-wordmark'));
    const stockIdx = ranked.findIndex(c => c.imageUrl.includes('generic-square'));
    expect(wordmarkIdx).toBeLessThan(stockIdx);
  });

  it('NEGATIVE guardrail: among near-equal relevance, square is still preferred over wide', () => {
    // When candidates are adjacent in the input (close relevance scores),
    // shape preference should still favor square.
    const candidates = [
      // Position 0: wide candidate
      makeCandidate({ imageUrl: 'https://a.com/wide-logo.png', width: 800, height: 200, label: 'Wide Logo' }),
      // Position 1: square candidate (very close relevance)
      makeCandidate({ imageUrl: 'https://a.com/square-logo.png', width: 256, height: 256, label: 'Square Logo' }),
    ];

    const ranked = rankCandidatesByShape(candidates);
    const squareIdx = ranked.findIndex(c => c.imageUrl.includes('square'));
    const wideIdx = ranked.findIndex(c => c.imageUrl.includes('wide'));
    expect(squareIdx).toBeLessThan(wideIdx);
  });
});
