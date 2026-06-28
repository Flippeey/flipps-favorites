import type { IconCacheRecord } from '@/shared/messages';
import { generatedTtlMs } from './icon-constants';

/**
 * Pure cache-eligibility policy for the icon resolver. Kept browser-free so the
 * read-path / background-refresh decisions are unit-testable without IndexedDB,
 * the network providers, or the resolution semaphore.
 */

/**
 * True when a cached record carries a TTL that has already passed — the signal
 * the read path uses to schedule a background refresh. Records without an
 * `expiresAt` (e.g. user overrides) are never stale. The comparison is strict
 * (`now > expiresAt`), so a record is not yet stale at the exact expiry instant.
 *
 * NOTE: there is intentionally NO `sourceKind` exclusion — generated letter-tiles
 * now carry a short TTL and ARE eligible for refresh, so a tile cached during a
 * re-resolution storm self-heals on a later calm load.
 */
export function isRecordStale(record: Pick<IconCacheRecord, 'expiresAt'>, now: number): boolean {
  return typeof record.expiresAt === 'number' && now > record.expiresAt;
}

/**
 * When a background refresh finds nothing better than the cached tile, return a
 * TTL-restamped copy of it IF it is a generated fallback — so an icon-less host
 * doesn't re-trigger a refresh on every subsequent load. Returns null when there
 * is nothing to re-stamp (missing record, or a real-source record). Does not
 * mutate the input.
 */
export function restampedGeneratedRecord(existing: IconCacheRecord | null, now: number): IconCacheRecord | null {
  if (existing?.sourceKind !== 'generated') return null;
  return { ...existing, updatedAt: now, expiresAt: now + generatedTtlMs };
}
