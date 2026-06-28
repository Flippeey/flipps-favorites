import { describe, expect, it } from 'vitest';
import { isRecordStale, restampedGeneratedRecord } from '@/background/icons/icon-cache-policy';
import { createGeneratedRecord } from '@/background/icons/icon-image';
import { generatedTtlMs } from '@/background/icons/icon-constants';
import type { IconCacheRecord } from '@/shared/messages';

const baseRecord: IconCacheRecord = {
  cacheKey: 'icon:host:example.com',
  bookmarkUrl: 'https://example.com',
  sourceKind: 'search',
  dataUrl: 'data:image/png;base64,AAAA',
  mimeType: 'image/png',
  updatedAt: 0,
  pipelineVersion: 'test',
};

describe('isRecordStale', () => {
  // WHY: records without a TTL (user overrides, legacy rows) must never be
  // treated as stale or they'd trigger an endless background refresh.
  it('is not stale when expiresAt is absent', () => {
    expect(isRecordStale({ expiresAt: undefined }, 1_000)).toBe(false);
  });

  // WHY: the read path schedules a refresh only once the TTL has truly passed;
  // the boundary is strict so a record is not stale at the exact expiry instant.
  it('is fresh before expiry, fresh at the boundary, stale after', () => {
    expect(isRecordStale({ expiresAt: 100 }, 99)).toBe(false);
    expect(isRecordStale({ expiresAt: 100 }, 100)).toBe(false);
    expect(isRecordStale({ expiresAt: 100 }, 101)).toBe(true);
  });

  // WHY: this is the cache-storm fix. The old guard excluded generated tiles from
  // refresh, so a storm-induced letter-tile stuck until browser restart. A past-TTL
  // generated record must now read as stale so it self-heals on a later load.
  it('treats a generated tile as refreshable once its TTL passes (self-heal)', () => {
    const tile = createGeneratedRecord('https://x.com', 'X', 'icon:host:x.com');
    expect(isRecordStale(tile, tile.updatedAt)).toBe(false);
    expect(isRecordStale(tile, tile.updatedAt + generatedTtlMs)).toBe(false); // strict boundary
    expect(isRecordStale(tile, tile.updatedAt + generatedTtlMs + 1)).toBe(true);
  });
});

describe('restampedGeneratedRecord', () => {
  // WHY: only generated fallbacks get re-stamped; a real-source record left a
  // null refresh for some other reason and must not be rewritten here.
  it('returns null for a non-generated record', () => {
    expect(restampedGeneratedRecord({ ...baseRecord, sourceKind: 'search' }, 5_000)).toBeNull();
  });

  it('returns null when there is no existing record', () => {
    expect(restampedGeneratedRecord(null, 5_000)).toBeNull();
  });

  // WHY: a re-resolution that still finds nothing must push the TTL forward so an
  // icon-less host doesn't re-trigger a refresh on every single load — while
  // preserving the existing tile bytes and never mutating the input.
  it('re-stamps a generated tile TTL, preserves its data, and does not mutate the input', () => {
    const existing: IconCacheRecord = { ...baseRecord, sourceKind: 'generated', updatedAt: 0, expiresAt: 1 };
    const restamped = restampedGeneratedRecord(existing, 5_000);
    expect(restamped).not.toBeNull();
    expect(restamped!.expiresAt).toBe(5_000 + generatedTtlMs);
    expect(restamped!.updatedAt).toBe(5_000);
    expect(restamped!.dataUrl).toBe(existing.dataUrl);
    // input untouched
    expect(existing.expiresAt).toBe(1);
    expect(existing.updatedAt).toBe(0);
  });
});
