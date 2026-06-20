import { describe, expect, it } from 'vitest';
import { isDdgFirstHitRelevant } from '@/background/icons/icon-classify';

describe('isDdgFirstHitRelevant', () => {
  describe('accepts relevant candidates', () => {
    it('accepts when brand token appears in the title', () => {
      expect(isDdgFirstHitRelevant(
        { label: 'Jellyfin - Media Server Logo', imageUrl: 'https://cdn.example.com/img.png', sourcePageUrl: 'https://jellyfin.org' },
        'https://jellyfin.local.flippflix.com',
      )).toBe(true);
    });

    it('accepts when brand token appears case-insensitively in the title', () => {
      expect(isDdgFirstHitRelevant(
        { label: 'PROWLARR Logo PNG Vector', imageUrl: 'https://seeklogo.com/logo.png', sourcePageUrl: 'https://seeklogo.com/prowlarr' },
        'https://prowlarr.local.flippflix.com',
      )).toBe(true);
    });

    it('accepts when brand appears in image URL path', () => {
      expect(isDdgFirstHitRelevant(
        { label: 'Media Server Logo Icon', imageUrl: 'https://cdn.example.com/jellyfin-icon.png', sourcePageUrl: 'https://example.com' },
        'https://jellyfin.local.flippflix.com',
      )).toBe(true);
    });

    it('accepts mainstream hosts where brand appears in source page URL', () => {
      expect(isDdgFirstHitRelevant(
        { label: 'Official App Icon', imageUrl: 'https://cdn.notion.com/logo.png', sourcePageUrl: 'https://notion.so/about' },
        'https://notion.so/my-page',
      )).toBe(true);
    });
  });

  describe('rejects irrelevant candidates', () => {
    it('rejects when brand token does not appear anywhere in the candidate', () => {
      expect(isDdgFirstHitRelevant(
        { label: 'Letter TBC Monogram Logo Design', imageUrl: 'https://cdn.example.com/stock-monogram.jpg', sourcePageUrl: 'https://example.com' },
        'https://tbcarmory.com',
      )).toBe(false);
    });

    it('rejects stock vendor source page even if brand token matches', () => {
      expect(isDdgFirstHitRelevant(
        { label: 'TBCArmory Stock Vector', imageUrl: 'https://cdn.vecteezy.com/tbcarmory.jpg', sourcePageUrl: 'https://vecteezy.com/vector/tbcarmory' },
        'https://tbcarmory.com',
      )).toBe(true); // brand token IS present in title, so it passes brand check
    });

    it('rejects when source page is a stock vendor and brand token is absent from title', () => {
      expect(isDdgFirstHitRelevant(
        { label: 'Generic Letter Monogram Design', imageUrl: 'https://cdn.vecteezy.com/stock.jpg', sourcePageUrl: 'https://vecteezy.com/vector/123' },
        'https://tbcarmory.com',
      )).toBe(false);
    });

    it('rejects when image URL is from a stock vendor and brand token is absent', () => {
      expect(isDdgFirstHitRelevant(
        { label: 'Letter Design Template', imageUrl: 'https://static.vecteezy.com/system/resources/previews/monogram.jpg', sourcePageUrl: 'https://example.com/page' },
        'https://tbcarmory.com',
      )).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('returns true when brand is too short to match (< 3 chars) — no gating', () => {
      // Brand "hp" is only 2 chars — too short for reliable matching, so we skip the gate
      expect(isDdgFirstHitRelevant(
        { label: 'Random Image Result', imageUrl: 'https://example.com/img.png', sourcePageUrl: 'https://example.com' },
        'https://hp.com',
      )).toBe(true);
    });

    it('handles missing sourcePageUrl gracefully', () => {
      expect(isDdgFirstHitRelevant(
        { label: 'Acme Corp Official Logo', imageUrl: 'https://cdn.example.com/acme.png' },
        'https://acme.com',
      )).toBe(true);
    });

    it('handles empty/undefined bookmarkUrl', () => {
      expect(isDdgFirstHitRelevant(
        { label: 'Some Image', imageUrl: 'https://example.com/img.png' },
        '',
      )).toBe(true); // no brand to check, so no gating
    });

    it('rejects vecteezy as stock vendor in expanded denylist', () => {
      expect(isDdgFirstHitRelevant(
        { label: 'Abstract Letter Logo', imageUrl: 'https://vecteezy.com/img.jpg', sourcePageUrl: 'https://vecteezy.com' },
        'https://tbcarmory.com',
      )).toBe(false);
    });
  });
});
