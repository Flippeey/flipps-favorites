import { describe, expect, it } from 'vitest';
import {
  isHardJunkCandidate,
  selectBestSafeFallback,
  scoreDuckDuckGoResult,
  tokenizeQuery,
} from '@/background/icons/icon-classify';
import type { IconSearchCandidate } from '@/shared/messages';

// ---------------------------------------------------------------------------
// Helper to build test candidates with sensible defaults
// ---------------------------------------------------------------------------

function makeCandidate(overrides: Partial<IconSearchCandidate> & { imageUrl: string }): IconSearchCandidate {
  return {
    previewUrl: overrides.imageUrl,
    label: 'Test Logo',
    sourceKind: 'search',
    sourcePageUrl: 'https://example.com',
    width: 256,
    height: 256,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isHardJunkCandidate — HARD-JUNK predicate
//
// Returns true ONLY for candidates that should produce a letter-tile over
// being shown. Two classes of hard junk:
//   (1) People-content images (team photos, headshots, founders)
//   (2) Off-domain foreign-brand logos (competitor logo on a different domain)
//
// Everything else (missing brand signal, low relevance, same-domain content
// images) is SOFT — those are exactly what the fallback rescues.
// ---------------------------------------------------------------------------

describe('isHardJunkCandidate', () => {
  describe('detects hard junk', () => {
    it('rejects people-content images (team photo)', () => {
      const candidate = makeCandidate({
        imageUrl: 'https://cdn.example.com/team/photo.jpg',
        label: 'Our Amazing Team',
      });
      expect(isHardJunkCandidate(candidate, 'https://acme.com')).toBe(true);
    });

    it('rejects people-content images (founder headshot)', () => {
      const candidate = makeCandidate({
        imageUrl: 'https://cdn.example.com/founders/jane-doe.jpg',
        label: 'Jane Doe, CEO',
      });
      expect(isHardJunkCandidate(candidate, 'https://acme.com')).toBe(true);
    });

    it('rejects people-content images (staff directory)', () => {
      const candidate = makeCandidate({
        imageUrl: 'https://cdn.example.com/staff/employee.jpg',
        label: 'Staff Directory',
      });
      expect(isHardJunkCandidate(candidate, 'https://acme.com')).toBe(true);
    });

    it('rejects off-domain foreign-brand logo', () => {
      // Image is on a totally different domain, filename says "Rabobank-Logo"
      // while bookmark is acme.com — this is a competitor logo
      const candidate = makeCandidate({
        imageUrl: 'https://cdn.banking.nl/Rabobank-Logo.png',
        label: 'Banking Partners',
        sourcePageUrl: 'https://banking.nl/partners',
      });
      expect(isHardJunkCandidate(candidate, 'https://acme.com')).toBe(true);
    });

    it('rejects off-domain foreign-brand logo with logo-after pattern', () => {
      const candidate = makeCandidate({
        imageUrl: 'https://cdn.other.com/logo-microsoft.svg',
        label: 'Tech Partners',
        sourcePageUrl: 'https://other.com/partners',
      });
      expect(isHardJunkCandidate(candidate, 'https://acme.com')).toBe(true);
    });
  });

  describe('does NOT flag soft rejections as hard junk', () => {
    it('allows a candidate with no brand signal (soft rejection in the primary gate)', () => {
      // A real logo on a hashed CDN path with generic title — no brand token
      // anywhere. isDdgFirstHitRelevant would reject this, but it is NOT hard junk.
      const candidate = makeCandidate({
        imageUrl: 'https://cdn.brandfetch.io/id_abc123/w/400/h/400/theme/dark/icon.png',
        label: 'Company Logo - Download PNG',
        sourcePageUrl: 'https://brandfetch.com/acme',
      });
      expect(isHardJunkCandidate(candidate, 'https://acme.com')).toBe(false);
    });

    it('allows a same-domain image without logo signal (soft, not hard)', () => {
      // Image is on the brand's own domain but has no logo path signal.
      // This is a soft rejection (no logo signal) not hard junk.
      const candidate = makeCandidate({
        imageUrl: 'https://acme.com/uploads/2024/03/product-screenshot.jpg',
        label: 'Acme Product Screenshot',
        sourcePageUrl: 'https://acme.com/products',
      });
      expect(isHardJunkCandidate(candidate, 'https://acme.com')).toBe(false);
    });

    it('allows a relevant candidate with brand in title', () => {
      const candidate = makeCandidate({
        imageUrl: 'https://seeklogo.com/acme-logo.svg',
        label: 'Acme Logo SVG Vector',
        sourcePageUrl: 'https://seeklogo.com/acme',
      });
      expect(isHardJunkCandidate(candidate, 'https://acme.com')).toBe(false);
    });

    it('allows same-domain foreign-brand (brand controls the origin)', () => {
      // A file named "Rabobank-Logo" on acme.com — the brand owns the domain,
      // so this might be a partner section. isDdgFirstHitRelevant handles this
      // via the same-domain gate; isHardJunkCandidate does NOT flag it because
      // it is same-domain.
      const candidate = makeCandidate({
        imageUrl: 'https://acme.com/partners/Rabobank-Logo.png',
        label: 'Our Partners',
        sourcePageUrl: 'https://acme.com/partners',
      });
      expect(isHardJunkCandidate(candidate, 'https://acme.com')).toBe(false);
    });

    it('allows cross-TLD same-brand images', () => {
      // Image from ing.com for bookmark ing.nl — same brand, different TLD
      const candidate = makeCandidate({
        imageUrl: 'https://assets.ing.com/logo-microsoft.svg',
        label: 'ING Logo',
        sourcePageUrl: 'https://ing.com/brand',
      });
      expect(isHardJunkCandidate(candidate, 'https://ing.nl/accounts')).toBe(false);
    });

    it('allows a candidate with short brand (< 3 chars) — no gating possible', () => {
      const candidate = makeCandidate({
        imageUrl: 'https://cdn.other.com/competitor-logo.png',
        label: 'Some Logo',
      });
      // Brand "hp" is too short for foreign-brand detection to work reliably
      expect(isHardJunkCandidate(candidate, 'https://hp.com')).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// selectBestSafeFallback — pure selection function
//
// Given an array of candidates already rejected by isDdgFirstHitRelevant,
// filter out hard junk, rank by relevance + shape, return the ordered safe list.
// The caller iterates this list, trying fetchAndValidateImage on each.
// ---------------------------------------------------------------------------

describe('selectBestSafeFallback', () => {
  const bookmarkUrl = 'https://acme.com';

  it('POSITIVE: rescues soft-rejected candidates (returns non-empty for soft-only list)', () => {
    // ALL candidates were soft-rejected by isDdgFirstHitRelevant (no brand token
    // in metadata — e.g. a real logo on a hashed/encoded CDN path with generic title).
    // The fallback should rescue them, ranked by relevance + shape.
    const candidates: IconSearchCandidate[] = [
      makeCandidate({
        imageUrl: 'https://cdn.brandfetch.io/id_abc123/w/400/h/400/icon.png',
        label: 'Company Logo - Download PNG',
        sourcePageUrl: 'https://brandfetch.com/some-company',
        width: 400,
        height: 400,
      }),
      makeCandidate({
        imageUrl: 'https://cdn.other.com/img/5f3a2b1c.png',
        label: 'Logo Design Resources',
        sourcePageUrl: 'https://other.com/logos',
        width: 256,
        height: 256,
      }),
    ];

    const result = selectBestSafeFallback(candidates, bookmarkUrl);
    expect(result.length).toBe(2);
    // Both are valid fallback candidates (neither is hard junk)
  });

  it('NEGATIVE: returns empty when all candidates are people-content (hard junk)', () => {
    const candidates: IconSearchCandidate[] = [
      makeCandidate({
        imageUrl: 'https://cdn.example.com/team/founder.jpg',
        label: 'Meet Our Team',
        sourcePageUrl: 'https://example.com/about',
      }),
      makeCandidate({
        imageUrl: 'https://cdn.example.com/staff/ceo-headshot.jpg',
        label: 'Leadership',
        sourcePageUrl: 'https://example.com/leadership',
      }),
    ];

    const result = selectBestSafeFallback(candidates, bookmarkUrl);
    expect(result.length).toBe(0);
  });

  it('NEGATIVE: returns empty when all candidates are off-domain foreign-brand logos', () => {
    const candidates: IconSearchCandidate[] = [
      makeCandidate({
        imageUrl: 'https://cdn.banking.nl/Rabobank-Logo.png',
        label: 'Bank Logos',
        sourcePageUrl: 'https://banking.nl/logos',
      }),
      makeCandidate({
        imageUrl: 'https://cdn.finance.com/logo-barclays.svg',
        label: 'Finance Logos',
        sourcePageUrl: 'https://finance.com/brands',
      }),
    ];

    const result = selectBestSafeFallback(candidates, bookmarkUrl);
    expect(result.length).toBe(0);
  });

  it('MIXED: filters out hard junk, keeps soft-rejected candidates', () => {
    // Mix of a soft-rejected real logo and a hard-junk people photo.
    // Fallback should return only the real logo.
    const candidates: IconSearchCandidate[] = [
      // Hard junk: people photo
      makeCandidate({
        imageUrl: 'https://cdn.example.com/team/group-photo.jpg',
        label: 'Team Photo',
        sourcePageUrl: 'https://example.com/about',
        width: 800,
        height: 600,
      }),
      // Soft rejection: real logo on hashed CDN path, no brand token
      makeCandidate({
        imageUrl: 'https://cdn.brandfetch.io/id_xyz789/theme/dark/symbol.png',
        label: 'Logo Download - PNG Vector',
        sourcePageUrl: 'https://brandfetch.com/company',
        width: 256,
        height: 256,
      }),
    ];

    const result = selectBestSafeFallback(candidates, bookmarkUrl);
    expect(result.length).toBe(1);
    expect(result[0].imageUrl).toContain('brandfetch');
  });

  it('MIXED: filters out off-domain foreign-brand, keeps soft-rejected candidate', () => {
    const candidates: IconSearchCandidate[] = [
      // Hard junk: off-domain competitor logo
      makeCandidate({
        imageUrl: 'https://cdn.banking.nl/Rabobank-Logo.png',
        label: 'Banking Partners',
        sourcePageUrl: 'https://banking.nl/partners',
        width: 300,
        height: 300,
      }),
      // Soft rejection: logo with no brand token in metadata
      makeCandidate({
        imageUrl: 'https://cdn.logos.com/img/hexagonal-icon.svg',
        label: 'Modern Icon Design',
        sourcePageUrl: 'https://logos.com/gallery',
        width: 200,
        height: 200,
      }),
    ];

    const result = selectBestSafeFallback(candidates, bookmarkUrl);
    expect(result.length).toBe(1);
    expect(result[0].imageUrl).toContain('hexagonal-icon');
  });

  it('ranks safe fallback candidates by relevance score then shape', () => {
    // Two safe candidates: one has higher relevance signals (logo aggregator host),
    // the other is a generic CDN. The aggregator one should rank first.
    const candidates: IconSearchCandidate[] = [
      makeCandidate({
        imageUrl: 'https://cdn.random.com/img/generic.png',
        label: 'Generic Image',
        sourcePageUrl: 'https://random.com',
        width: 256,
        height: 256,
      }),
      makeCandidate({
        imageUrl: 'https://seeklogo.com/acme-vector.svg',
        label: 'Acme Logo Vector SVG',
        sourcePageUrl: 'https://seeklogo.com/acme',
        width: 256,
        height: 256,
      }),
    ];

    const result = selectBestSafeFallback(candidates, bookmarkUrl);
    expect(result.length).toBe(2);
    // seeklogo (logo aggregator) should rank higher due to aggregator bonus + brand match
    expect(result[0].imageUrl).toContain('seeklogo');
  });

  it('returns empty array for empty input', () => {
    expect(selectBestSafeFallback([], bookmarkUrl)).toEqual([]);
  });
});
