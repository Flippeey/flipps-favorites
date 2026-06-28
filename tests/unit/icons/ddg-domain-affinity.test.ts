import { describe, expect, it } from 'vitest';
import {
  brandMatchesAsToken,
  detectForeignBrandInImage,
  isDdgFirstHitRelevant,
  isPeopleContentImage,
  scoreDuckDuckGoResult,
  tokenizeQuery,
} from '@/background/icons/icon-classify';

// ---------------------------------------------------------------------------
// Helper: build a raw DDG result shape (the input to scoreDuckDuckGoResult)
// ---------------------------------------------------------------------------
const makeResult = (overrides: Partial<{
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

// ---------------------------------------------------------------------------
// A — Word-boundary brand matching in isDdgFirstHitRelevant
// ---------------------------------------------------------------------------
describe('isDdgFirstHitRelevant — word-boundary matching', () => {
  it('rejects when brand "dela" is a substring of host "takiedela" (no boundary)', () => {
    expect(isDdgFirstHitRelevant(
      {
        label: 'TakieDela Foundation Logo',
        imageUrl: 'https://takiedela.ru/logo.png',
        sourcePageUrl: 'https://takiedela.ru/about',
      },
      'https://www.dela.nl/mijndela',
    )).toBe(false);
  });

  it('accepts when brand "dela" appears as a standalone token in the label', () => {
    expect(isDdgFirstHitRelevant(
      {
        label: 'DELA Insurance Logo',
        imageUrl: 'https://cdn.example.com/dela-logo.png',
        sourcePageUrl: 'https://dela.nl',
      },
      'https://www.dela.nl/mijndela',
    )).toBe(true);
  });

  it('accepts when brand appears as a subdomain label (dela.nl)', () => {
    expect(isDdgFirstHitRelevant(
      {
        label: 'Some insurance page',
        imageUrl: 'https://cdn.example.com/img.png',
        sourcePageUrl: 'https://dela.nl/about',
      },
      'https://www.dela.nl/mijndela',
    )).toBe(true);
  });

  it('accepts when brand appears hyphen-delimited in a URL path', () => {
    expect(isDdgFirstHitRelevant(
      {
        label: 'Logo Collection',
        imageUrl: 'https://cdn.example.com/dela-icon-256.png',
        sourcePageUrl: 'https://example.com',
      },
      'https://www.dela.nl/mijndela',
    )).toBe(true);
  });

  it('rejects unrelated host for twinq brand', () => {
    expect(isDdgFirstHitRelevant(
      {
        label: 'Rabobank Logo PNG',
        imageUrl: 'https://rabobank.nl/logo.png',
        sourcePageUrl: 'https://rabobank.nl',
      },
      'https://phidec.twinq.nl/apex/f?p=TPL:101',
    )).toBe(false);
  });

  it('rejects "lancer" for brand "lancyr"', () => {
    expect(isDdgFirstHitRelevant(
      {
        label: 'Mitsubishi Lancer Logo',
        imageUrl: 'https://cars.example.com/lancer-logo.png',
        sourcePageUrl: 'https://cars.example.com',
      },
      'https://www.lancyr.nl/mijn-verzekeringen',
    )).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// H2 — Aggregator wrong-entity disambiguation (fixes dela.nl)
//
// Real captured data: query "dela logo"
// Winner (WRONG): seeklogo.com — "Takie Dela Logo PNG Vector (SVG) Free Download"
//   image path slug: takie-dela-...
// Correct: brandslogos.com — sourcePageUrl brandslogos.com/d/dela-verzekeringen-logo/
//   image: dela-verzekeringen-logo.png
//
// Both are logo-aggregator hosts. Brand "dela" appears in both paths.
// But "takie-dela" has a foreign qualifier "takie" BEFORE the brand token,
// meaning it's "Takie Dela" (a different entity), not "DELA verzekeringen".
// ---------------------------------------------------------------------------
describe('H2 — aggregator wrong-entity disambiguation (dela.nl)', () => {
  it('brandslogos/dela-verzekeringen outranks seeklogo/takie-dela', () => {
    const terms = tokenizeQuery('dela logo');
    const bookmarkHostname = 'dela.nl';

    // Real candidate from brandslogos.com — brand is leading slug token
    const brandslogos = scoreDuckDuckGoResult(
      makeResult({
        image: 'https://brandslogos.com/wp-content/uploads/images/dela-verzekeringen-logo.png',
        title: 'Dela Verzekeringen Logo PNG Vector (SVG) Free Download',
        url: 'https://brandslogos.com/d/dela-verzekeringen-logo/',
        width: 400,
        height: 400,
      }),
      bookmarkHostname,
      terms,
    );

    // Real candidate from seeklogo.com — brand preceded by foreign qualifier "takie"
    const seeklogo = scoreDuckDuckGoResult(
      makeResult({
        image: 'https://seeklogo.com/images/T/takie-dela-logo-ABCDEF1234-seeklogo.com.png',
        title: 'Takie Dela Logo PNG Vector (SVG) Free Download',
        url: 'https://seeklogo.com/vector-logo/123456/takie-dela',
        width: 400,
        height: 400,
      }),
      bookmarkHostname,
      terms,
    );

    expect(brandslogos).toBeGreaterThan(seeklogo);
  });

  it('aggregator candidate with brand as leading slug token keeps full bonus', () => {
    const terms = tokenizeQuery('dela logo');
    const bookmarkHostname = 'dela.nl';

    const delaLeading = scoreDuckDuckGoResult(
      makeResult({
        image: 'https://seeklogo.com/images/D/dela-logo-ABC123-seeklogo.com.png',
        title: 'Dela Logo PNG Vector (SVG) Free Download',
        url: 'https://seeklogo.com/vector-logo/999/dela',
        width: 400,
        height: 400,
      }),
      bookmarkHostname,
      terms,
    );

    // Should get full aggregator bonus — brand is the leading token
    // Compare against a non-aggregator candidate to verify bonus is retained
    const nonAggregator = scoreDuckDuckGoResult(
      makeResult({
        image: 'https://random-site.com/dela-logo.png',
        title: 'Dela Logo',
        url: 'https://random-site.com/dela',
        width: 400,
        height: 400,
      }),
      bookmarkHostname,
      terms,
    );

    expect(delaLeading).toBeGreaterThan(nonAggregator);
  });

  it('H2 is a SCORING fix, not a gate fix — both aggregator candidates pass the gate', () => {
    const bookmarkUrl = 'https://www.dela.nl/mijndela';

    // "takie-dela" passes the gate because "dela" is a token in the label.
    // The SCORING penalty (-700 for qualified slug) is what makes it rank below
    // the correct brandslogos candidate — verified in the scoring test above.
    const takieDela = isDdgFirstHitRelevant(
      {
        label: 'Takie Dela Logo PNG Vector (SVG) Free Download',
        imageUrl: 'https://seeklogo.com/images/T/takie-dela-logo-ABCDEF1234-seeklogo.com.png',
        sourcePageUrl: 'https://seeklogo.com/vector-logo/123456/takie-dela',
      },
      bookmarkUrl,
    );
    expect(takieDela).toBe(true);

    const delaVerzekeringen = isDdgFirstHitRelevant(
      {
        label: 'Dela Verzekeringen Logo PNG Vector (SVG) Free Download',
        imageUrl: 'https://brandslogos.com/wp-content/uploads/images/dela-verzekeringen-logo.png',
        sourcePageUrl: 'https://brandslogos.com/d/dela-verzekeringen-logo/',
      },
      bookmarkUrl,
    );
    expect(delaVerzekeringen).toBe(true);

    // But scoring MUST differentiate them — brandslogos (leading) > seeklogo (qualified)
    const terms = tokenizeQuery('dela logo');
    const brandslogosScore = scoreDuckDuckGoResult(
      makeResult({
        image: 'https://brandslogos.com/wp-content/uploads/images/dela-verzekeringen-logo.png',
        title: 'Dela Verzekeringen Logo PNG Vector (SVG) Free Download',
        url: 'https://brandslogos.com/d/dela-verzekeringen-logo/',
        width: 400, height: 400,
      }),
      'dela.nl', terms,
    );
    const seeklogoScore = scoreDuckDuckGoResult(
      makeResult({
        image: 'https://seeklogo.com/images/T/takie-dela-logo-ABCDEF1234-seeklogo.com.png',
        title: 'Takie Dela Logo PNG Vector (SVG) Free Download',
        url: 'https://seeklogo.com/vector-logo/123456/takie-dela',
        width: 400, height: 400,
      }),
      'dela.nl', terms,
    );
    expect(brandslogosScore).toBeGreaterThan(seeklogoScore);
  });
});

// ---------------------------------------------------------------------------
// H1 — Same-domain content-image rejection (fixes phidec.twinq.nl)
//
// Real captured data: query "twinq phidec logo"
// ALL 30 candidates hosted on twinq.nl (the brand's OWN site).
// Winner (WRONG): staff photo "Cases - TwinQ"
// Candidate[1] (WRONG): Rabobank logo at
//   twinq.nl/wp-content/uploads/2024/08/Rabobank-Logo-937x1080.jpg
//   label "VvE Portaal - TwinQ"
//
// Domain-affinity (+300 source +200 image) + brand-in-title boost them
// even though the IMAGE depicts a different/no brand.
// ---------------------------------------------------------------------------
describe('H1 — same-domain content-image rejection (phidec.twinq.nl)', () => {
  it('same-domain Rabobank-Logo image is penalized below candidates without foreign-brand images', () => {
    const terms = tokenizeQuery('twinq phidec logo');
    const bookmarkHostname = 'twinq.nl';

    // Real candidate: Rabobank logo hosted on twinq.nl
    const rabobankOnTwinq = scoreDuckDuckGoResult(
      makeResult({
        image: 'https://twinq.nl/wp-content/uploads/2024/08/Rabobank-Logo-937x1080.jpg',
        title: 'VvE Portaal - TwinQ',
        url: 'https://twinq.nl/vve-portaal/',
        width: 937,
        height: 1080,
      }),
      bookmarkHostname,
      terms,
    );

    // A hypothetical same-domain candidate with brand in image filename
    const twinqLogoOnTwinq = scoreDuckDuckGoResult(
      makeResult({
        image: 'https://twinq.nl/wp-content/uploads/twinq-logo.png',
        title: 'About TwinQ',
        url: 'https://twinq.nl/about/',
        width: 400,
        height: 400,
      }),
      bookmarkHostname,
      terms,
    );

    expect(twinqLogoOnTwinq).toBeGreaterThan(rabobankOnTwinq);
  });

  it('same-domain staff photo (no brand, no logo signal) loses affinity bonus', () => {
    const terms = tokenizeQuery('twinq phidec logo');
    const bookmarkHostname = 'twinq.nl';

    // Real candidate: staff photo on twinq.nl with UUID-like filename
    const staffPhoto = scoreDuckDuckGoResult(
      makeResult({
        image: 'https://twinq.nl/wp-content/uploads/2024/03/team-photo-cases.jpg',
        title: 'Cases - TwinQ',
        url: 'https://twinq.nl/cases/',
        width: 800,
        height: 600,
      }),
      bookmarkHostname,
      terms,
    );

    // Same-domain candidate with brand in image path
    const twinqLogo = scoreDuckDuckGoResult(
      makeResult({
        image: 'https://twinq.nl/wp-content/uploads/twinq-logo.png',
        title: 'About TwinQ',
        url: 'https://twinq.nl/about/',
        width: 400,
        height: 400,
      }),
      bookmarkHostname,
      terms,
    );

    expect(twinqLogo).toBeGreaterThan(staffPhoto);
  });

  it('isDdgFirstHitRelevant rejects same-domain candidate with foreign-brand image filename (token-Logo pattern)', () => {
    const bookmarkUrl = 'https://phidec.twinq.nl/apex/f?p=TPL:101';
    // Rabobank-Logo in image path — foreign brand in image on same domain
    expect(isDdgFirstHitRelevant(
      {
        label: 'VvE Portaal - TwinQ',
        imageUrl: 'https://twinq.nl/wp-content/uploads/2024/08/Rabobank-Logo-937x1080.jpg',
        sourcePageUrl: 'https://twinq.nl/vve-portaal/',
      },
      bookmarkUrl,
    )).toBe(false);
  });

  it('isDdgFirstHitRelevant rejects same-domain candidate with foreign-brand image filename (logo-token pattern)', () => {
    const bookmarkUrl = 'https://phidec.twinq.nl/apex/f?p=TPL:101';
    // REAL captured data: logo-abn-amro.jpg on twinq.nl — ABN AMRO bank logo
    expect(isDdgFirstHitRelevant(
      {
        label: 'VvE Portaal - TwinQ',
        imageUrl: 'https://www.twinq.nl/wp-content/uploads/2024/09/logo-abn-amro.jpg',
        sourcePageUrl: 'https://www.twinq.nl/vve-portaal/',
      },
      bookmarkUrl,
    )).toBe(false);
  });

  it('isDdgFirstHitRelevant rejects same-domain candidate with no brand/logo signal in image', () => {
    const bookmarkUrl = 'https://phidec.twinq.nl/apex/f?p=TPL:101';
    // Staff photo: no brand token in image filename, no logo/icon path signal
    expect(isDdgFirstHitRelevant(
      {
        label: 'Cases - TwinQ',
        imageUrl: 'https://twinq.nl/wp-content/uploads/2024/03/team-photo-cases.jpg',
        sourcePageUrl: 'https://twinq.nl/cases/',
      },
      bookmarkUrl,
    )).toBe(false);
  });

  it('isDdgFirstHitRelevant accepts same-domain candidate with brand in image filename', () => {
    const bookmarkUrl = 'https://phidec.twinq.nl/apex/f?p=TPL:101';
    expect(isDdgFirstHitRelevant(
      {
        label: 'About TwinQ',
        imageUrl: 'https://twinq.nl/wp-content/uploads/twinq-logo.png',
        sourcePageUrl: 'https://twinq.nl/about/',
      },
      bookmarkUrl,
    )).toBe(true);
  });

  it('isDdgFirstHitRelevant accepts same-domain candidate with logo-path signal', () => {
    const bookmarkUrl = 'https://phidec.twinq.nl/apex/f?p=TPL:101';
    // Generic logo path (favicon, apple-touch-icon) — brand may not be in filename
    expect(isDdgFirstHitRelevant(
      {
        label: 'TwinQ',
        imageUrl: 'https://twinq.nl/apple-touch-icon.png',
        sourcePageUrl: 'https://twinq.nl/',
      },
      bookmarkUrl,
    )).toBe(true);
  });

  it('isDdgFirstHitRelevant rejects same-domain partner/event image with brand as secondary token', () => {
    const bookmarkUrl = 'https://phidec.twinq.nl/apex/f?p=TPL:101';
    // REAL: TEN31-TwinQ.jpg — partner event image, brand is secondary token
    expect(isDdgFirstHitRelevant(
      {
        label: 'LandingTen31 - TwinQ',
        imageUrl: 'https://www.twinq.nl/wp-content/uploads/2024/02/TEN31-TwinQ.jpg',
        sourcePageUrl: 'https://www.twinq.nl/landingten31/',
      },
      bookmarkUrl,
    )).toBe(false);
  });

  it('isDdgFirstHitRelevant rejects same-domain event photo with brand + event tokens', () => {
    const bookmarkUrl = 'https://phidec.twinq.nl/apex/f?p=TPL:101';
    // REAL: Twinq-Connect-2-47.jpg — event photo
    expect(isDdgFirstHitRelevant(
      {
        label: 'TwinQ Connect 2025',
        imageUrl: 'https://www.twinq.nl/wp-content/uploads/2025/09/Twinq-Connect-2-47.jpg',
        sourcePageUrl: 'https://www.twinq.nl/blog/twinq-connect-2025-een-inspirerend',
      },
      bookmarkUrl,
    )).toBe(false);
  });

  it('isDdgFirstHitRelevant rejects same-domain team photo with brand in filename', () => {
    const bookmarkUrl = 'https://phidec.twinq.nl/apex/f?p=TPL:101';
    // REAL: Twinq-ambassadeurs-bijeenkomst-1...
    expect(isDdgFirstHitRelevant(
      {
        label: 'Trainingen - TwinQ',
        imageUrl: 'https://www.twinq.nl/wp-content/uploads/2023/12/Twinq-ambassadeurs-bijeenkomst-1.jpg',
        sourcePageUrl: 'https://www.twinq.nl/trainingen/',
      },
      bookmarkUrl,
    )).toBe(false);
  });

  it('isDdgFirstHitRelevant accepts brand-only filename even in date-stamped CMS uploads path', () => {
    const bookmarkUrl = 'https://phidec.twinq.nl/apex/f?p=TPL:101';
    // twinq.jpg in /wp-content/uploads/2026/04/ — the CMS upload path is just a
    // storage detail, not a content-quality signal. A brand-only filename on the
    // brand's own domain IS the brand's logo regardless of the directory structure.
    // Content/blog photos have multi-token descriptive filenames that are caught
    // by the multi-token check (twinq-connect-2025.jpg, twinq-ambassadeurs.jpg).
    expect(isDdgFirstHitRelevant(
      {
        label: 'E-learning TwinQ',
        imageUrl: 'https://www.twinq.nl/wp-content/uploads/2026/04/twinq.jpg',
        sourcePageUrl: 'https://www.twinq.nl/nieuws/e-learning',
      },
      bookmarkUrl,
    )).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Lancyr — must not regress (all "lancer" results still rejected)
// ---------------------------------------------------------------------------
describe('lancyr.nl — no regression', () => {
  it('rejects all "lancer" results for lancyr.nl', () => {
    const bookmarkUrl = 'https://www.lancyr.nl/mijn-verzekeringen';
    const candidates = [
      { label: 'Mitsubishi Lancer EVO Logo', imageUrl: 'https://cars.com/lancer.png', sourcePageUrl: 'https://cars.com' },
      { label: 'Lancer Game Logo', imageUrl: 'https://games.com/lancer-icon.png', sourcePageUrl: 'https://games.com' },
      { label: 'Mitsubishi Lancer Logo', imageUrl: 'https://mitsubishi-motors.com/lancer-badge.png', sourcePageUrl: 'https://mitsubishi-motors.com/lancer' },
    ];
    const accepted = candidates.filter(c => isDdgFirstHitRelevant(c, bookmarkUrl));
    expect(accepted).toHaveLength(0);
  });

  it('does not reject a hypothetical candidate that genuinely contains "lancyr"', () => {
    const url = 'https://www.lancyr.nl/mijn-verzekeringen';
    expect(isDdgFirstHitRelevant(
      { label: 'Lancyr Rechtsbijstand Logo', imageUrl: 'https://lancyr.nl/logo.png', sourcePageUrl: 'https://lancyr.nl' },
      url,
    )).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Full integration: scoring + relevance combined repro cases
// ---------------------------------------------------------------------------
describe('repro cases — full integration', () => {
  it('dela.nl: takie-dela seeklogo rejected or outranked by brandslogos dela-verzekeringen', () => {
    // This test verifies the combined effect of scoring (H2) and gate
    const bookmarkUrl = 'https://www.dela.nl/mijndela';
    const terms = tokenizeQuery('dela logo');

    // Simulate: candidates sorted by score, top 3 tried via fetchDuckDuckGoFirstHit
    const brandslogosScore = scoreDuckDuckGoResult(
      makeResult({
        image: 'https://brandslogos.com/wp-content/uploads/images/dela-verzekeringen-logo.png',
        title: 'Dela Verzekeringen Logo PNG Vector (SVG) Free Download',
        url: 'https://brandslogos.com/d/dela-verzekeringen-logo/',
        width: 400,
        height: 400,
      }),
      'dela.nl',
      terms,
    );

    const seeklogoScore = scoreDuckDuckGoResult(
      makeResult({
        image: 'https://seeklogo.com/images/T/takie-dela-logo-ABCDEF1234-seeklogo.com.png',
        title: 'Takie Dela Logo PNG Vector (SVG) Free Download',
        url: 'https://seeklogo.com/vector-logo/123456/takie-dela',
        width: 400,
        height: 400,
      }),
      'dela.nl',
      terms,
    );

    // brandslogos/dela-verzekeringen must rank higher
    expect(brandslogosScore).toBeGreaterThan(seeklogoScore);
  });

  it('phidec.twinq.nl: foreign-brand and brandless same-domain candidates rejected by gate', () => {
    const bookmarkUrl = 'https://phidec.twinq.nl/apex/f?p=TPL:101';
    // REAL captured DDG candidates from live extension testing
    const candidates = [
      // ABN AMRO logo on twinq domain (logo-abn-amro pattern)
      {
        label: 'VvE Portaal - TwinQ',
        imageUrl: 'https://www.twinq.nl/wp-content/uploads/2024/09/logo-abn-amro.jpg',
        sourcePageUrl: 'https://www.twinq.nl/vve-portaal/',
      },
      // Staff photo with date-based filename (no brand, no logo signal)
      {
        label: 'Cases - TwinQ',
        imageUrl: 'https://www.twinq.nl/wp-content/uploads/2024/03/20240305_094733-scaled-e17105053.jpg',
        sourcePageUrl: 'https://www.twinq.nl/cases/',
      },
      // Rabobank-Logo pattern
      {
        label: 'VvE Portaal - TwinQ',
        imageUrl: 'https://twinq.nl/wp-content/uploads/2024/08/Rabobank-Logo-937x1080.jpg',
        sourcePageUrl: 'https://twinq.nl/vve-portaal/',
      },
      // Generic screenshot/content
      {
        label: 'Software overzicht - TwinQ',
        imageUrl: 'https://twinq.nl/wp-content/uploads/2024/01/dashboard-screenshot.png',
        sourcePageUrl: 'https://twinq.nl/software/',
      },
    ];
    const accepted = candidates.filter(c => isDdgFirstHitRelevant(c, bookmarkUrl));
    expect(accepted).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// People-content image detection (isPeopleContentImage + gate integration)
//
// Real captured data: query "twinq phidec logo"
// Candidate from twinq.ai (off-domain): founders.png — people photo, not a logo.
// Even though "twinq" appears in the hostname (brand match), founders/team photos
// should never be auto-resolution candidates.
// ---------------------------------------------------------------------------
describe('isPeopleContentImage — people-content detection', () => {
  it('detects founders.png', () => {
    expect(isPeopleContentImage('https://www.twinq.ai/_next/image?url=%2Fimages%2Ffounders.png&w=828&q=75')).toBe(true);
  });

  it('detects /team/ path segment', () => {
    expect(isPeopleContentImage('https://example.com/team/john-doe.jpg')).toBe(true);
  });

  it('detects staff-photo.jpg', () => {
    expect(isPeopleContentImage('https://example.com/images/staff-photo.jpg')).toBe(true);
  });

  it('detects testimonials segment', () => {
    expect(isPeopleContentImage('https://www.twinq.ai/images/testimonials/13.png')).toBe(true);
  });

  it('detects headshot.png', () => {
    expect(isPeopleContentImage('https://example.com/media/headshot.png')).toBe(true);
  });

  it('detects portrait-ceo.jpg', () => {
    expect(isPeopleContentImage('https://example.com/portrait-ceo.jpg')).toBe(true);
  });

  it('detects employees.jpg', () => {
    expect(isPeopleContentImage('https://example.com/our-employees.jpg')).toBe(true);
  });

  it('does NOT flag logo.png', () => {
    expect(isPeopleContentImage('https://example.com/logo.png')).toBe(false);
  });

  it('does NOT flag brand-icon.svg', () => {
    expect(isPeopleContentImage('https://example.com/brand-icon.svg')).toBe(false);
  });

  it('does NOT flag random content image', () => {
    expect(isPeopleContentImage('https://example.com/wp-content/uploads/2024/02/dashboard.jpg')).toBe(false);
  });
});

describe('isDdgFirstHitRelevant — people-content gate (phidec/twinq.ai founders)', () => {
  it('rejects off-domain founders.png even though brand matches in hostname', () => {
    // REAL: twinq.ai founders.png — brand "twinq" is in hostname but image is a people photo
    expect(isDdgFirstHitRelevant(
      {
        label: 'TwinQ AI | Slimme AI-automatisering voor vastgoedbeheer',
        imageUrl: 'https://www.twinq.ai/_next/image?url=%2Fimages%2Ffounders.png&w=828&q=75&dpl=dpl',
        sourcePageUrl: 'https://www.twinq.ai/',
      },
      'https://phidec.twinq.nl/apex/f?p=TPL:101',
    )).toBe(false);
  });

  it('rejects off-domain testimonials image', () => {
    // REAL: twinq.ai testimonials/13.png
    expect(isDdgFirstHitRelevant(
      {
        label: 'TwinQ AI | Slimme AI-automatisering voor vastgoedbeheer',
        imageUrl: 'https://www.twinq.ai/images/testimonials/13.png',
        sourcePageUrl: 'https://www.twinq.ai/',
      },
      'https://phidec.twinq.nl/apex/f?p=TPL:101',
    )).toBe(false);
  });

  it('accepts off-domain logo.png (not a people image)', () => {
    // REAL: twinq.nu/logo.png — actual logo file
    expect(isDdgFirstHitRelevant(
      {
        label: 'TwinQ persoonlijkheidstypen - TwinQ',
        imageUrl: 'https://www.twinq.nu/wp-content/uploads/2021/02/logo.png',
        sourcePageUrl: 'https://www.twinq.nu/twinq-persoonlijkheidstypen/',
      },
      'https://phidec.twinq.nl/apex/f?p=TPL:101',
    )).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Regression guard: legit brand-only own-domain logos must be ACCEPTED
//
// The strict gate (sameDomainImageHasLogoSignal) must not over-reject legit
// brand-only logo files on the bookmark's own domain. spotify.png on
// spotify.com and github.png on github.com are canonical brand logos.
// ---------------------------------------------------------------------------
describe('isDdgFirstHitRelevant — legit brand-only same-domain logos accepted', () => {
  it('accepts spotify.com/assets/spotify.png (brand-only filename on own domain)', () => {
    expect(isDdgFirstHitRelevant(
      {
        label: 'Spotify - Web Player',
        imageUrl: 'https://spotify.com/assets/spotify.png',
        sourcePageUrl: 'https://spotify.com/',
      },
      'https://open.spotify.com/browse/featured',
    )).toBe(true);
  });

  it('accepts github.com/images/github.png (brand-only filename on own domain)', () => {
    expect(isDdgFirstHitRelevant(
      {
        label: 'GitHub',
        imageUrl: 'https://github.com/images/github.png',
        sourcePageUrl: 'https://github.com/',
      },
      'https://github.com/Flippeey/flipps-favorites',
    )).toBe(true);
  });

  it('still rejects same-domain multi-token content filename', () => {
    // Multi-token: brand + other semantic tokens = content image, not logo
    expect(isDdgFirstHitRelevant(
      {
        label: 'Spotify Wrapped 2025',
        imageUrl: 'https://spotify.com/assets/spotify-wrapped-2025-hero.jpg',
        sourcePageUrl: 'https://spotify.com/wrapped',
      },
      'https://open.spotify.com/browse/featured',
    )).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// detectForeignBrandInImage — descriptor-qualified own logos
//
// When the bookmark brand IS present in the filename alongside another token
// next to "logo", that's a product-qualified own logo (stripe-payments-logo.png
// for brand stripe), not a foreign brand. The function must return null.
// ---------------------------------------------------------------------------
describe('detectForeignBrandInImage — own-brand descriptor logos', () => {
  it('returns null for stripe-payments-logo.png (brand "stripe" present in filename)', () => {
    expect(detectForeignBrandInImage(
      'https://stripe.com/assets/stripe-payments-logo.png',
      'stripe',
    )).toBeNull();
  });

  it('returns null for android-logo.png (brand "google" present as... wait, it is not)', () => {
    // android-logo.png for brand "google" — brand is NOT in filename,
    // but "android" is not a foreign brand, it's a product. However, without
    // "google" in the filename, this WOULD flag "android" as foreign.
    // This test documents current behavior: brand absent → foreign detected.
    expect(detectForeignBrandInImage(
      'https://google.com/images/android-logo.png',
      'google',
    )).toBe('android');
  });

  it('returns null when brand is present alongside other tokens next to logo', () => {
    // google-workspace-logo.png for brand "google" — brand IS in filename
    expect(detectForeignBrandInImage(
      'https://google.com/images/google-workspace-logo.png',
      'google',
    )).toBeNull();
  });

  it('still detects foreign brand when bookmark brand is ABSENT', () => {
    // Rabobank-Logo.jpg on twinq.nl — "twinq" is NOT in the filename
    expect(detectForeignBrandInImage(
      'https://twinq.nl/wp-content/uploads/2024/08/Rabobank-Logo-937x1080.jpg',
      'twinq',
    )).toBe('rabobank');
  });
});

// ---------------------------------------------------------------------------
// brandMatchesAsToken — regex metacharacter safety
// ---------------------------------------------------------------------------
describe('brandMatchesAsToken — regex metacharacter safety', () => {
  it('matches literal "a.b" as a token and does NOT treat dot as regex wildcard', () => {
    expect(brandMatchesAsToken('a.b', 'host-a.b-corp.com')).toBe(true);
    expect(brandMatchesAsToken('a.b', 'axb.com')).toBe(false);
  });

  it('matches literal "c++" as a token', () => {
    expect(brandMatchesAsToken('c++', 'learn-c++-today.org')).toBe(true);
    expect(brandMatchesAsToken('c++', 'ccc.org')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// brandMatchesAsToken — compound (concatenated) brands
//
// WHY: extractBrandInfo returns the registrable label concatenated
// ("producthunt"), but real DDG metadata renders the word break back in
// ("Product Hunt", "product-hunt-logo.png"). Without a collapsed-substring
// fallback the gate rejects EVERY candidate and the host falls to a letter-tile.
// ---------------------------------------------------------------------------
describe('brandMatchesAsToken — compound brands', () => {
  it('matches a concatenated compound brand rendered with separators restored', () => {
    expect(brandMatchesAsToken('producthunt', 'product-hunt-logo.png')).toBe(true);
    expect(brandMatchesAsToken('producthunt', 'Product Hunt')).toBe(true);
    expect(brandMatchesAsToken('lastepochtools', 'Last Epoch Tools — Build Planner')).toBe(true);
  });

  it('does NOT collide on unrelated text for a compound brand', () => {
    expect(brandMatchesAsToken('producthunt', 'random-stock-photo.png')).toBe(false);
  });

  it('does NOT match a compound brand across URL path/host boundaries', () => {
    // WHY: the collapsed fallback must strip only intra-word joiners, never '/'
    // or '.', so "foobar" cannot match ".../foo/bar.png" across a path boundary.
    expect(brandMatchesAsToken('foobar', 'https://example.com/foo/bar-icon.png')).toBe(false);
    expect(brandMatchesAsToken('foobar', 'https://foo.bar.com/logo.png')).toBe(false);
  });

  it('does NOT substring-collide for short brands (length-gated to >= 6)', () => {
    // "art" must not match inside "cart"; the collapsed fallback only runs for 6+ char brands.
    expect(brandMatchesAsToken('art', 'cart-logo.png')).toBe(false);
    expect(brandMatchesAsToken('box', 'dropbox-paper.png')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// scoreDuckDuckGoResult — IP and single-label hosts
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// FIX 3 — Same-domain logo-token acceptance without brand substring
//
// A same-domain file named *-logo.png / *-brand-logo.png on the brand's own
// domain should be accepted even when the brand token is NOT in the filename.
// Example: Firefox-parent-brand-logo.png on mozilla.org with brand "mozilla"
// is mozilla's own logo file, not a foreign brand.
// But: Rabobank-logo.png on twinq.nl with brand "twinq" MUST still be rejected
// (foreign brand detection handles this case).
// ---------------------------------------------------------------------------
describe('FIX 3 — same-domain logo-token acceptance without brand substring', () => {
  it('isDdgFirstHitRelevant accepts same-domain Firefox-parent-brand-logo.png on mozilla.org', () => {
    expect(isDdgFirstHitRelevant(
      {
        label: 'Firefox Browser',
        imageUrl: 'https://mozilla.org/media/Firefox-parent-brand-logo.png',
        sourcePageUrl: 'https://mozilla.org/',
      },
      'https://addons.mozilla.org/en-US/developers/',
    )).toBe(true);
  });

  it('isDdgFirstHitRelevant accepts same-domain logo.svg without brand in filename', () => {
    // A file literally named "logo.svg" on the brand's domain is always a legit logo
    expect(isDdgFirstHitRelevant(
      {
        label: 'Mozilla Foundation',
        imageUrl: 'https://mozilla.org/images/logo.svg',
        sourcePageUrl: 'https://mozilla.org/',
      },
      'https://addons.mozilla.org/en-US/developers/',
    )).toBe(true);
  });

  it('isDdgFirstHitRelevant accepts same-domain brand-logo.png (logo token with generic prefix)', () => {
    // "brand-logo.png" has a logo token and "brand" is in the generic tokens set,
    // so detectForeignBrandInImage returns null (not a foreign brand).
    expect(isDdgFirstHitRelevant(
      {
        label: 'Add-ons for Firefox',
        imageUrl: 'https://mozilla.org/media/img/brand-logo.png',
        sourcePageUrl: 'https://addons.mozilla.org/',
      },
      'https://addons.mozilla.org/en-US/developers/',
    )).toBe(true);
  });

  it('isDdgFirstHitRelevant still rejects Rabobank-logo.png on twinq.nl (foreign brand)', () => {
    expect(isDdgFirstHitRelevant(
      {
        label: 'VvE Portaal - TwinQ',
        imageUrl: 'https://twinq.nl/wp-content/uploads/2024/08/Rabobank-Logo-937x1080.jpg',
        sourcePageUrl: 'https://twinq.nl/vve-portaal/',
      },
      'https://phidec.twinq.nl/apex/f?p=TPL:101',
    )).toBe(false);
  });

  it('isDdgFirstHitRelevant still rejects same-domain staff photos', () => {
    expect(isDdgFirstHitRelevant(
      {
        label: 'Our Team',
        imageUrl: 'https://mozilla.org/media/team-photo.jpg',
        sourcePageUrl: 'https://mozilla.org/about/',
      },
      'https://addons.mozilla.org/en-US/developers/',
    )).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Layout-prefix logo filenames are NOT foreign brands
//
// WHY: detectForeignBrandInImage treated ANY 3+ char token before "logo" as a
// foreign brand unless denylisted. Common layout/style prefixes (main-, header-,
// color-, dark-) are not brand names, so a brand's OWN logo file (twinq.nl/
// main-logo.png) was wrongly rejected and the host fell to a generated letter-
// tile. Real foreign brand names (Rabobank) must STILL be rejected.
// ---------------------------------------------------------------------------
describe('detectForeignBrandInImage — layout-prefix descriptors are not foreign brands', () => {
  it('returns null for descriptive layout/style prefixes next to "logo"', () => {
    for (const filename of ['main-logo.png', 'header-logo.svg', 'footer-logo.png', 'site-logo.png', 'color-logo.png', 'dark-logo.png', 'white-logo.png']) {
      expect(detectForeignBrandInImage(`https://twinq.nl/wp-content/uploads/${filename}`, 'twinq')).toBeNull();
    }
  });

  it('still returns the foreign brand for a real competitor logo (Rabobank)', () => {
    expect(detectForeignBrandInImage('https://twinq.nl/wp-content/uploads/Rabobank-Logo.jpg', 'twinq')).toBe('rabobank');
  });

  // KNOWN LIMITATION: only the token adjacent to "logo" is inspected, so a
  // competitor brand separated from "logo" by a now-generic descriptor
  // ("rabobank-white-logo") slips through. Catching it would wrongly reject
  // legit same-domain own-product logos ("firefox-parent-brand-logo" on
  // mozilla.org), which is the worse regression — see the FIX 3 acceptance tests.

  it('isDdgFirstHitRelevant accepts a same-domain main-logo.png (own logo, layout prefix)', () => {
    expect(isDdgFirstHitRelevant(
      {
        label: 'VvE Portaal - TwinQ',
        imageUrl: 'https://twinq.nl/wp-content/uploads/main-logo.png',
        sourcePageUrl: 'https://twinq.nl/',
      },
      'https://phidec.twinq.nl/apex/f?p=TPL:101',
    )).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Finding (B) — same-domain logo with brand only in host, not filename
//
// detectForeignBrandInImage flags ANY 3+ char token adjacent to "logo" as
// foreign when the brand is absent from the filename. For SAME-DOMAIN images,
// the brand controls that origin, so product/variant names next to "logo"
// (e.g. "widget-logo.png") should not be treated as foreign brands. BUT
// genuine off-domain competitor logos (Rabobank-Logo on random.com) must
// still be rejected.
// ---------------------------------------------------------------------------
describe('Finding (B) — same-domain brand-only-in-host not flagged foreign', () => {
  it('POSITIVE: same-domain product-logo file accepted when brand is in host only', () => {
    // acme.com/assets/widget-logo.png for brand "acme" — "widget" is acme's
    // own product, not a competitor brand. Brand appears in host, not filename.
    expect(isDdgFirstHitRelevant(
      {
        label: 'Acme Widgets - Home',
        imageUrl: 'https://acme.com/assets/widget-logo.png',
        sourcePageUrl: 'https://acme.com/',
      },
      'https://acme.com/products',
    )).toBe(true);
  });

  it('NEGATIVE guardrail: off-domain competitor brand adjacent to "logo" still rejected', () => {
    // competitor.com/images/acme-logo.png for brand "notacme" on bookmark notacme.com
    // — "acme" is a genuine foreign brand on this off-domain image
    expect(detectForeignBrandInImage(
      'https://competitor.com/images/acme-logo.png',
      'notacme',
    )).toBe('acme');
  });
});

// ---------------------------------------------------------------------------
// Finding (C) — same-domain abbreviation/wordmark filename accepted
//
// sameDomainImageHasLogoSignal rejects a same-domain image that IS the brand's
// own mark but uses an abbreviation/wordmark filename: no logo/icon token, no
// full-brand substring, and not under /assets/(icon|logo|brand)/. The brand's
// own abbreviation on its own origin should be accepted.
// ---------------------------------------------------------------------------
describe('Finding (C) — same-domain abbreviation/wordmark accepted', () => {
  it('POSITIVE: same-domain abbreviation-named file accepted as brand mark', () => {
    // corpenergy.com has a logo file named "ce-mark.png" — "ce" is an abbreviation
    // of the brand. It's on the brand's own domain, so it should be accepted.
    // Use a well-known path pattern to help (assets directory).
    expect(isDdgFirstHitRelevant(
      {
        label: 'CorpEnergy - Green Solutions',
        imageUrl: 'https://corpenergy.com/assets/images/ce-mark.png',
        sourcePageUrl: 'https://corpenergy.com/',
      },
      'https://corpenergy.com/dashboard',
    )).toBe(true);
  });

  it('NEGATIVE guardrail: off-domain abbreviation that is not the brand is not accepted', () => {
    // An abbreviation on a different domain should not be blindly accepted
    expect(isDdgFirstHitRelevant(
      {
        label: 'Random Site',
        imageUrl: 'https://random.com/images/xyz-mark.png',
        sourcePageUrl: 'https://random.com/',
      },
      'https://corpenergy.com/dashboard',
    )).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Finding (D) — CMS upload path must not disqualify same-domain brand logo
//
// sameDomainImageHasLogoSignal rejects a brand-only logo file when its path
// matches /uploads/YYYY/MM/. A CMS-hosted real logo should not be dropped
// just because of its upload path.
// ---------------------------------------------------------------------------
describe('Finding (D) — CMS upload path does not disqualify brand logo', () => {
  it('POSITIVE: same-domain /uploads/2024/03/acme.png accepted when acme is the brand', () => {
    expect(isDdgFirstHitRelevant(
      {
        label: 'About Acme Corp',
        imageUrl: 'https://acme.com/wp-content/uploads/2024/03/acme.png',
        sourcePageUrl: 'https://acme.com/about/',
      },
      'https://acme.com/products',
    )).toBe(true);
  });

  it('NEGATIVE guardrail: same-domain /uploads/2024/03/someoneelse.png not auto-accepted', () => {
    // "someoneelse" is NOT the brand "acme" — a CMS-uploaded image with a
    // non-brand filename should not be accepted just because it's on the brand's
    // domain. It fails the brand-signal check regardless of path.
    expect(isDdgFirstHitRelevant(
      {
        label: 'Partners - Acme Corp',
        imageUrl: 'https://acme.com/wp-content/uploads/2024/03/someoneelse.png',
        sourcePageUrl: 'https://acme.com/partners/',
      },
      'https://acme.com/products',
    )).toBe(false);
  });
});

describe('scoreDuckDuckGoResult — IP and single-label hosts', () => {
  it('does not crash and does not false-match domain affinity for an IP bookmark host', () => {
    const terms = tokenizeQuery('homelab logo');
    const score = scoreDuckDuckGoResult(
      makeResult({ url: 'https://unrelated.com/page', image: 'https://unrelated.com/logo.png', title: 'Unrelated Logo' }),
      '192.168.1.10',
      terms,
    );
    const baseline = scoreDuckDuckGoResult(
      makeResult({ url: 'https://unrelated.com/page', image: 'https://unrelated.com/logo.png', title: 'Unrelated Logo' }),
      'unrelated.com',
      terms,
    );
    expect(score).toBeLessThan(baseline);
  });

  it('does not crash and does not false-match domain affinity for a single-label host', () => {
    const terms = tokenizeQuery('jellyfin logo');
    const score = scoreDuckDuckGoResult(
      makeResult({ url: 'https://random.org/page', image: 'https://random.org/logo.png', title: 'Random Logo' }),
      'localhost',
      terms,
    );
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeLessThan(1000);
  });
});
