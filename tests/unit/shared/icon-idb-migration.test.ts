/**
 * Tests for the v2→v3 IDB migration logic for IconOverrideRecord.
 *
 * WHY: The v3 migration backfills `fit: 'contain'` onto records that predate
 * the fit field so that upgrading users don't lose their existing icon overrides
 * and see the same visual behaviour they always had (contained icons).
 *
 * The actual IDB versionchange callback can't be tested in a node environment.
 * Instead, we test the pure data transformation: records without `fit` get
 * `fit: 'contain'`; records with `fit` are left unchanged.
 */
import { describe, expect, it } from 'vitest';
import type { IconOverrideRecord } from '@/shared/models';

// The migration body as a pure function, extracted from icon-idb.ts for testability.
// Must mirror the upgrade logic exactly.
function migrateV2ToV3(records: IconOverrideRecord[]): IconOverrideRecord[] {
  return records.map(record => (record.fit === undefined ? { ...record, fit: 'contain' as const } : record));
}

const baseRecord: IconOverrideRecord = {
  overrideKey: 'host:example.com',
  scope: 'host',
  bookmarkUrl: 'https://example.com/path',
  dataUrl: 'data:image/png;base64,abc',
  fileName: 'icon.png',
  mimeType: 'image/png',
  updatedAt: 1_000_000,
};

describe('icon-idb v2→v3 migration', () => {
  it('record without fit gets fit:contain — no other fields changed', () => {
    const legacy: IconOverrideRecord = { ...baseRecord };
    // Simulate a pre-v3 record: no `fit` field at all
    delete (legacy as Partial<IconOverrideRecord>).fit;

    const [migrated] = migrateV2ToV3([legacy]);
    expect(migrated.fit).toBe('contain');
    // All other fields must round-trip unchanged
    expect(migrated.overrideKey).toBe(baseRecord.overrideKey);
    expect(migrated.scope).toBe(baseRecord.scope);
    expect(migrated.bookmarkUrl).toBe(baseRecord.bookmarkUrl);
    expect(migrated.dataUrl).toBe(baseRecord.dataUrl);
    expect(migrated.fileName).toBe(baseRecord.fileName);
    expect(migrated.mimeType).toBe(baseRecord.mimeType);
    expect(migrated.updatedAt).toBe(baseRecord.updatedAt);
  });

  it('record with fit:cover is left unchanged', () => {
    const record: IconOverrideRecord = { ...baseRecord, fit: 'cover' };
    const [migrated] = migrateV2ToV3([record]);
    expect(migrated.fit).toBe('cover');
  });

  it('record with fit:contain is left unchanged', () => {
    const record: IconOverrideRecord = { ...baseRecord, fit: 'contain' };
    const [migrated] = migrateV2ToV3([record]);
    expect(migrated.fit).toBe('contain');
  });

  it('mixed batch: only records missing fit are patched', () => {
    const withCover: IconOverrideRecord = { ...baseRecord, overrideKey: 'exact:https://a.com', fit: 'cover' };
    const legacy: IconOverrideRecord = { ...baseRecord, overrideKey: 'host:b.com' };
    delete (legacy as Partial<IconOverrideRecord>).fit;
    const withContain: IconOverrideRecord = { ...baseRecord, overrideKey: 'domain:c.com', fit: 'contain' };

    const migrated = migrateV2ToV3([withCover, legacy, withContain]);

    expect(migrated[0].fit).toBe('cover');    // unchanged
    expect(migrated[1].fit).toBe('contain');  // backfilled
    expect(migrated[2].fit).toBe('contain');  // unchanged
  });

  it('empty batch produces empty result', () => {
    expect(migrateV2ToV3([])).toHaveLength(0);
  });

  it('migration is non-destructive: original records are not mutated', () => {
    const record: IconOverrideRecord = { ...baseRecord };
    delete (record as Partial<IconOverrideRecord>).fit;
    const original = { ...record };

    migrateV2ToV3([record]);

    // Original must be unchanged (immutable spread in migration)
    expect((record as Partial<IconOverrideRecord>).fit).toBeUndefined();
    expect(record.overrideKey).toBe(original.overrideKey);
  });
});
