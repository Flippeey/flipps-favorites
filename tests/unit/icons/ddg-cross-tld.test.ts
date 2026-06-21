import { describe, expect, it } from 'vitest';
import { isDdgFirstHitRelevant } from '@/background/icons/icon-classify';

// ---------------------------------------------------------------------------
// Cross-TLD same-brand gate (fixes mijn.ing.nl → ING)
//
// Real captured data: bookmark https://mijn.ing.nl/login/
// Winner (WRONG): assets.ing.com content photo "payment-account-1920" — score 1430
//   image host registrable domain: ing.com
//   bookmark registrable domain: ing.nl
//   These differ, so the same-domain gate never fires → lifestyle photo passes.
//
// The cross-TLD fix: when the root label (registrable domain minus TLD) matches
// between bookmark and image host, and the root label is >= 3 chars, treat the
// image as same-brand. Same-brand images require a logo signal to pass the gate.
// ---------------------------------------------------------------------------

describe('cross-TLD same-brand gate — ING (mijn.ing.nl)', () => {
  const ingBookmarkUrl = 'https://mijn.ing.nl/login/';

  it('REJECTS ING CDN content photo (payment-account-1920) — cross-TLD same-brand, no logo signal', () => {
    // REAL captured candidate: assets.ing.com lifestyle photo that won at score 1430
    expect(isDdgFirstHitRelevant(
      {
        label: 'ING - Pair your account',
        imageUrl: 'https://assets.ing.com/transform/a1b2c3d4-e5f6-7890-abcd-ef1234567890/payment-account-1920?io=transform:fill,width:480,height:480',
        sourcePageUrl: 'https://www.ing.com/personal-banking',
      },
      ingBookmarkUrl,
    )).toBe(false);
  });

  it('REJECTS ING CDN ING-Identifier.png — cross-TLD same-brand, ambiguous filename', () => {
    // REAL: assets.ing.com/m/.../ING-Identifier.png — brand name in filename but
    // "Identifier" is not a logo/icon token. Under strict same-brand gate this is
    // rejected (no explicit logo/icon path signal). This is acceptable — the resolver
    // falls through to a logo-site candidate or letter-tile.
    expect(isDdgFirstHitRelevant(
      {
        label: 'ING Group Logo',
        imageUrl: 'https://assets.ing.com/m/abc123def456/ING-Identifier.png',
        sourcePageUrl: 'https://www.ing.com/about-us',
      },
      ingBookmarkUrl,
    )).toBe(false);
  });

  it('ACCEPTS logo-site ING lion logo (pngwing — NOT same-brand CDN)', () => {
    // REAL: w7.pngwing.com ING Group logo — NOT same-brand (pngwing ≠ ing),
    // brand token "ing" appears in label, passes normally.
    expect(isDdgFirstHitRelevant(
      {
        label: 'ING Group ING-DiBa Logo Bank, bank, text, trademark, logo png | PNGWing',
        imageUrl: 'https://w7.pngwing.com/pngs/123/456/png-transparent-ing-group-logotipo-thumbnail.png',
        sourcePageUrl: 'https://www.pngwing.com/en/free-png-abc123',
      },
      ingBookmarkUrl,
    )).toBe(true);
  });

  it('ACCEPTS logo-site ING logo (logodix — NOT same-brand CDN)', () => {
    // REAL: logodix.com ING Logo — NOT same-brand, has brand token in label
    expect(isDdgFirstHitRelevant(
      {
        label: 'ING Logo - PNG and Vector - Logo Download',
        imageUrl: 'https://logodix.com/logo/789012/ING-Logo.png',
        sourcePageUrl: 'https://logodix.com/ing',
      },
      ingBookmarkUrl,
    )).toBe(true);
  });

  it('ACCEPTS cross-TLD same-brand image WITH explicit logo signal', () => {
    // Hypothetical: assets.ing.com with a proper logo path
    expect(isDdgFirstHitRelevant(
      {
        label: 'ING Logo',
        imageUrl: 'https://assets.ing.com/logos/ing-logo.png',
        sourcePageUrl: 'https://www.ing.com/',
      },
      ingBookmarkUrl,
    )).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Root-label length guard: short root labels (< 3 chars) must NOT trigger
// cross-TLD matching to avoid trivial collisions (e.g. "go.com" vs "go.nl").
// ---------------------------------------------------------------------------
describe('cross-TLD same-brand — short root label guard', () => {
  it('does NOT treat 2-char root labels as same-brand across TLDs', () => {
    // "go.com" vs "go.nl" — root label "go" is only 2 chars, too short
    // This candidate would normally pass because it has brand token in label.
    // The cross-TLD gate should NOT fire (< 3 chars), so this passes as-is.
    expect(isDdgFirstHitRelevant(
      {
        label: 'Go Airlines Logo',
        imageUrl: 'https://cdn.go.com/images/hero-banner.jpg',
        sourcePageUrl: 'https://go.com/',
      },
      'https://go.nl/',
    )).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Regression: exact same-registrable-domain still works as before
// ---------------------------------------------------------------------------
describe('cross-TLD — no regression on exact same-domain', () => {
  it('still ACCEPTS spotify.com/assets/spotify.png for spotify.com bookmark', () => {
    expect(isDdgFirstHitRelevant(
      {
        label: 'Spotify - Web Player',
        imageUrl: 'https://spotify.com/assets/spotify.png',
        sourcePageUrl: 'https://spotify.com/',
      },
      'https://open.spotify.com/browse/featured',
    )).toBe(true);
  });

  it('still REJECTS same-domain content image (spotify-wrapped-hero.jpg)', () => {
    expect(isDdgFirstHitRelevant(
      {
        label: 'Spotify Wrapped 2025',
        imageUrl: 'https://spotify.com/assets/spotify-wrapped-2025-hero.jpg',
        sourcePageUrl: 'https://spotify.com/wrapped',
      },
      'https://open.spotify.com/browse/featured',
    )).toBe(false);
  });

  it('still REJECTS foreign-brand image on same domain (Rabobank on twinq.nl)', () => {
    expect(isDdgFirstHitRelevant(
      {
        label: 'VvE Portaal - TwinQ',
        imageUrl: 'https://twinq.nl/wp-content/uploads/2024/08/Rabobank-Logo-937x1080.jpg',
        sourcePageUrl: 'https://twinq.nl/vve-portaal/',
      },
      'https://phidec.twinq.nl/apex/f?p=TPL:101',
    )).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Regression: dela.nl + brandslogos.com must NOT be affected by cross-TLD gate
//
// brandslogos.com root label = "brandslogos", dela.nl root label = "dela"
// These do NOT match, so the cross-TLD gate must NOT fire, and the
// brandslogos dela-verzekeringen-logo.png candidate must still PASS.
// ---------------------------------------------------------------------------
describe('cross-TLD — dela.nl + brandslogos regression', () => {
  it('brandslogos dela-verzekeringen-logo.png still PASSES for dela.nl bookmark', () => {
    // REAL winning candidate from prior verified runs — must not be affected
    expect(isDdgFirstHitRelevant(
      {
        label: 'Dela Verzekeringen Logo PNG Vector (SVG) Free Download',
        imageUrl: 'https://brandslogos.com/wp-content/uploads/images/dela-verzekeringen-logo.png',
        sourcePageUrl: 'https://brandslogos.com/d/dela-verzekeringen-logo/',
      },
      'https://www.dela.nl/mijndela',
    )).toBe(true);
  });

  it('seeklogo dela logo still PASSES for dela.nl bookmark (gate, not scoring)', () => {
    expect(isDdgFirstHitRelevant(
      {
        label: 'Dela Logo PNG Vector (SVG) Free Download',
        imageUrl: 'https://seeklogo.com/images/D/dela-logo-ABC123-seeklogo.com.png',
        sourcePageUrl: 'https://seeklogo.com/vector-logo/999/dela',
      },
      'https://www.dela.nl/mijndela',
    )).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Non-matching root labels across TLDs must NOT trigger the gate
// ---------------------------------------------------------------------------
describe('cross-TLD — non-matching root labels', () => {
  it('does NOT treat "pngwing.com" as same-brand for "ing.nl" (root labels differ)', () => {
    // Root label of pngwing.com = "pngwing", root label of ing.nl = "ing"
    // These should NOT be considered same-brand
    expect(isDdgFirstHitRelevant(
      {
        label: 'ING Group Logo PNG',
        imageUrl: 'https://w7.pngwing.com/pngs/123/456/ing-logo.png',
        sourcePageUrl: 'https://www.pngwing.com/en/free-png-abc',
      },
      'https://mijn.ing.nl/login/',
    )).toBe(true); // passes because brand "ing" is in label — NOT because of same-brand
  });
});
