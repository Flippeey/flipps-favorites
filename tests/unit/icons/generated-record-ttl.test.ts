import { describe, expect, it } from 'vitest';
import { createGeneratedRecord } from '@/background/icons/icon-image';
import { generatedTtlMs } from '@/background/icons/icon-constants';

/**
 * Generated letter-tiles are a low-confidence "nothing found yet" fallback. They
 * must carry a short expiresAt so the read path can background-refresh them — a
 * tile cached during a re-resolution storm then self-heals on a later calm load
 * instead of persisting until the next browser restart (sweepGeneratedRecords).
 */
describe('createGeneratedRecord — TTL', () => {
  it('stamps an expiresAt exactly generatedTtlMs after updatedAt', () => {
    const record = createGeneratedRecord('https://example.com', 'Example', 'icon:host:example.com');
    expect(record.sourceKind).toBe('generated');
    expect(typeof record.expiresAt).toBe('number');
    expect(record.expiresAt! - record.updatedAt).toBe(generatedTtlMs);
  });

  it('uses a TTL shorter than the standard 30-day cache TTL', () => {
    expect(generatedTtlMs).toBeGreaterThan(0);
    expect(generatedTtlMs).toBeLessThan(30 * 24 * 60 * 60 * 1000);
  });
});
