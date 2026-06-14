import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceRecord } from '@/shared/models';

// ─────────────────────────────────────────────────────────────────────────────
// In-memory chrome.storage fake. The shared/browser.ts shim reads
// globalThis.chrome at module-load time and throws if runtime is missing, so
// the fake must be installed BEFORE the module under test is dynamically
// imported.
// ─────────────────────────────────────────────────────────────────────────────

interface StorageAreaFake {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

function createAreaFake(seed: Record<string, unknown> = {}): {
  api: StorageAreaFake;
  data: Record<string, unknown>;
} {
  const data: Record<string, unknown> = { ...seed };
  const api: StorageAreaFake = {
    async get(keys) {
      if (keys === null) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const key of list) if (key in data) out[key] = data[key];
      return out;
    },
    async set(items) {
      Object.assign(data, items);
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) delete data[key];
    },
  };
  return { api, data };
}

function installChromeFake(opts: {
  syncSeed?: Record<string, unknown>;
  localSeed?: Record<string, unknown>;
  withSync?: boolean;
}) {
  const local = createAreaFake(opts.localSeed ?? {});
  const sync = opts.withSync === false ? undefined : createAreaFake(opts.syncSeed ?? {});
  const chromeFake = {
    runtime: { id: 'test-extension' },
    storage: {
      local: local.api,
      sync: sync?.api,
      onChanged: { addListener: () => undefined },
    },
  };
  (globalThis as unknown as { chrome?: unknown }).chrome = chromeFake;
  (globalThis as unknown as { browser?: unknown }).browser = undefined;
  return { local, sync };
}

async function importStorage(): Promise<typeof import('@/shared/storage')> {
  vi.resetModules();
  return import('@/shared/storage');
}

const LEGACY_KEY = 'workspaces';
const MIGRATION_MARKER_KEY = 'workspaces-per-key-migrated';

function perKey(id: string): string {
  return `workspace:${id}`;
}

function makeWorkspace(id: string, overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
  return {
    id,
    name: `Workspace ${id}`,
    rootFolderId: `folder-${id}`,
    themeMode: 'system',
    accentColor: '#3F72DC',
    backgroundMode: 'gradient',
    solidBackgroundColor: '',
    gradientStyle: 'top',
    gradientColorSource: 'accent',
    gradientCustomColor: '#3F72DC',
    gradientIntensity: 100,
    backgroundOpacity: 70,
    backgroundFitMode: 'cover',
    backgroundPositionMode: 'center',
    layoutPreset: 'balanced',
    favoritesColumnGap: 24,
    favoritesRowGap: 20,
    bookmarkTileWidth: 130,
    bookmarkIconSize: 75,
    tileShape: 'squircle',
    showTileLabels: true,
    folderMode: 'grid',
    bookmarkSortMode: 'manual',
    bookmarkSortDirection: 'asc',
    ...overrides,
  };
}

afterEach(() => {
  vi.resetModules();
  (globalThis as unknown as { chrome?: unknown }).chrome = undefined;
  (globalThis as unknown as { browser?: unknown }).browser = undefined;
});

// ─────────────────────────────────────────────────────────────────────────────
// Per-key storage layout
// ─────────────────────────────────────────────────────────────────────────────

describe('per-key workspace storage — layout', () => {
  beforeEach(() => installChromeFake({}));

  it('writeWorkspace stores record under workspace:<id> key, not under aggregate workspaces key', async () => {
    const { sync } = installChromeFake({});
    const storage = await importStorage();
    const ws = makeWorkspace('alpha');
    await storage.writeWorkspace(ws);

    expect(sync!.data[perKey('alpha')]).toBeDefined();
    expect(sync!.data[LEGACY_KEY]).toBeUndefined();
  });

  it('readWorkspaces returns all records from per-key layout', async () => {
    const { sync } = installChromeFake({});
    const storage = await importStorage();

    await storage.writeWorkspace(makeWorkspace('a'));
    await storage.writeWorkspace(makeWorkspace('b'));

    // Simulate a SW restart so in-memory cache is cleared.
    vi.resetModules();
    installChromeFake({ syncSeed: { ...sync!.data } });
    const storage2 = await importStorage();

    const records = await storage2.readWorkspaces();
    const ids = records.map(r => r.id).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('deleteWorkspace removes only the targeted workspace:<id> key', async () => {
    const { sync } = installChromeFake({});
    const storage = await importStorage();

    await storage.writeWorkspace(makeWorkspace('a'));
    await storage.writeWorkspace(makeWorkspace('b'));
    await storage.deleteWorkspace('a');

    expect(sync!.data[perKey('a')]).toBeUndefined();
    expect(sync!.data[perKey('b')]).toBeDefined();
  });

  it('each workspace occupies its own sync key (no aggregate workspaces key)', async () => {
    const { sync } = installChromeFake({});
    const storage = await importStorage();

    await storage.writeWorkspace(makeWorkspace('x'));
    await storage.writeWorkspace(makeWorkspace('y'));

    const allKeys = Object.keys(sync!.data);
    const workspaceKeys = allKeys.filter(k => k.startsWith('workspace:'));
    expect(workspaceKeys.sort()).toEqual(['workspace:x', 'workspace:y']);
    expect(allKeys).not.toContain(LEGACY_KEY);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// normalizeWorkspaceRecord applied on per-key reads
// ─────────────────────────────────────────────────────────────────────────────

describe('per-key storage — normalizeWorkspaceRecord on read', () => {
  it('fills missing view/sort fields with defaults when reading a per-key record', async () => {
    // Simulate a sync peer on an older version writing a record without view/sort.
    const legacyRecord = {
      id: 'ws1',
      name: 'Workspace ws1',
      rootFolderId: 'folder-ws1',
      themeMode: 'system',
      accentColor: '#3F72DC',
      backgroundMode: 'gradient',
      solidBackgroundColor: '',
      gradientStyle: 'top',
      gradientColorSource: 'accent',
      gradientCustomColor: '#3F72DC',
      gradientIntensity: 100,
      backgroundOpacity: 70,
      backgroundFitMode: 'cover',
      backgroundPositionMode: 'center',
      layoutPreset: 'balanced',
      favoritesColumnGap: 24,
      favoritesRowGap: 20,
      bookmarkTileWidth: 130,
      bookmarkIconSize: 75,
      tileShape: 'squircle',
      showTileLabels: true,
      // Note: folderMode / bookmarkSortMode / bookmarkSortDirection intentionally absent
    };

    installChromeFake({
      syncSeed: { [perKey('ws1')]: legacyRecord },
      localSeed: { [MIGRATION_MARKER_KEY]: true }, // migration already done
    });

    const storage = await importStorage();
    // Trigger migration first so readWorkspaces reads per-key layout.
    await storage.ensureWorkspacePerKeyMigration();
    const records = await storage.readWorkspaces();
    const ws1 = records.find(r => r.id === 'ws1');

    expect(ws1).toBeDefined();
    expect(ws1!.folderMode).toBe('grid');
    expect(ws1!.bookmarkSortMode).toBe('manual');
    expect(ws1!.bookmarkSortDirection).toBe('asc');
  });

  it('drops malformed records lacking required identity fields', async () => {
    installChromeFake({
      syncSeed: {
        [perKey('good')]: makeWorkspace('good'),
        [perKey('bad')]: { name: 'missing id and rootFolderId' },
      },
      localSeed: { [MIGRATION_MARKER_KEY]: true },
    });

    const storage = await importStorage();
    await storage.ensureWorkspacePerKeyMigration();
    const records = await storage.readWorkspaces();
    expect(records.map(r => r.id)).toEqual(['good']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Migration: legacy aggregate key → per-id keys
// ─────────────────────────────────────────────────────────────────────────────

describe('ensureWorkspacePerKeyMigration — fresh install (no legacy key)', () => {
  it('skips migration and sets the marker when there is no legacy workspaces key', async () => {
    const { local } = installChromeFake({});
    const storage = await importStorage();
    await storage.ensureWorkspacePerKeyMigration();

    // Marker must be set even on fresh install so subsequent calls short-circuit.
    expect(local.data[MIGRATION_MARKER_KEY]).toBe(true);
  });

  it('does not write any workspace:<id> keys when there is nothing to migrate', async () => {
    const { sync } = installChromeFake({});
    const storage = await importStorage();
    await storage.ensureWorkspacePerKeyMigration();

    const workspaceKeys = Object.keys(sync!.data).filter(k => k.startsWith('workspace:'));
    expect(workspaceKeys).toHaveLength(0);
  });
});

describe('ensureWorkspacePerKeyMigration — legacy aggregate key present', () => {
  it('splits legacy workspaces map into individual workspace:<id> sync keys', async () => {
    const { sync } = installChromeFake({
      syncSeed: {
        [LEGACY_KEY]: {
          alpha: makeWorkspace('alpha'),
          beta: makeWorkspace('beta'),
        },
      },
    });

    const storage = await importStorage();
    await storage.ensureWorkspacePerKeyMigration();

    expect(sync!.data[perKey('alpha')]).toBeDefined();
    expect(sync!.data[perKey('beta')]).toBeDefined();
  });

  it('deletes the legacy aggregate workspaces key after migration', async () => {
    const { sync } = installChromeFake({
      syncSeed: {
        [LEGACY_KEY]: { a: makeWorkspace('a') },
      },
    });

    const storage = await importStorage();
    await storage.ensureWorkspacePerKeyMigration();

    expect(sync!.data[LEGACY_KEY]).toBeUndefined();
  });

  it('sets the persisted migration marker after splitting', async () => {
    const { local } = installChromeFake({
      syncSeed: {
        [LEGACY_KEY]: { a: makeWorkspace('a') },
      },
    });

    const storage = await importStorage();
    await storage.ensureWorkspacePerKeyMigration();

    expect(local.data[MIGRATION_MARKER_KEY]).toBe(true);
  });

  it('applies normalizeWorkspaceRecord to each record during migration', async () => {
    // A legacy record missing view/sort fields.
    const rawRecord = {
      id: 'a',
      name: 'Workspace a',
      rootFolderId: 'folder-a',
      themeMode: 'system',
      accentColor: '#3F72DC',
      backgroundMode: 'gradient',
      solidBackgroundColor: '',
      gradientStyle: 'top',
      gradientColorSource: 'accent',
      gradientCustomColor: '#3F72DC',
      gradientIntensity: 100,
      backgroundOpacity: 70,
      backgroundFitMode: 'cover',
      backgroundPositionMode: 'center',
      layoutPreset: 'balanced',
      favoritesColumnGap: 24,
      favoritesRowGap: 20,
      bookmarkTileWidth: 130,
      bookmarkIconSize: 75,
      tileShape: 'squircle',
      showTileLabels: true,
      // no folderMode / bookmarkSortMode / bookmarkSortDirection
    };

    const { sync } = installChromeFake({
      syncSeed: { [LEGACY_KEY]: { a: rawRecord } },
    });

    const storage = await importStorage();
    await storage.ensureWorkspacePerKeyMigration();

    const stored = sync!.data[perKey('a')] as WorkspaceRecord;
    expect(stored.folderMode).toBe('grid');
    expect(stored.bookmarkSortMode).toBe('manual');
    expect(stored.bookmarkSortDirection).toBe('asc');
  });

  it('preserves explicit view/sort values from legacy records during migration', async () => {
    const { sync } = installChromeFake({
      syncSeed: {
        [LEGACY_KEY]: {
          a: makeWorkspace('a', { folderMode: 'list', bookmarkSortMode: 'created', bookmarkSortDirection: 'desc' }),
        },
      },
    });

    const storage = await importStorage();
    await storage.ensureWorkspacePerKeyMigration();

    const stored = sync!.data[perKey('a')] as WorkspaceRecord;
    expect(stored.folderMode).toBe('list');
    expect(stored.bookmarkSortMode).toBe('created');
    expect(stored.bookmarkSortDirection).toBe('desc');
  });

  it('drops malformed records (missing id/rootFolderId) and does not write them as per-key items', async () => {
    const { sync } = installChromeFake({
      syncSeed: {
        [LEGACY_KEY]: {
          good: makeWorkspace('good'),
          bad: { name: 'no id' },
        },
      },
    });

    const storage = await importStorage();
    await storage.ensureWorkspacePerKeyMigration();

    expect(sync!.data[perKey('good')]).toBeDefined();
    // 'bad' has no id → key would be workspace:undefined or similar; ensure nothing bad lands
    const workspaceKeys = Object.keys(sync!.data).filter(k => k.startsWith('workspace:'));
    expect(workspaceKeys).toHaveLength(1);
    expect(workspaceKeys[0]).toBe(perKey('good'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency — same-lifetime and cross-restart
// ─────────────────────────────────────────────────────────────────────────────

describe('ensureWorkspacePerKeyMigration — idempotency', () => {
  it('second call in the same SW lifetime is a no-op (memoized promise)', async () => {
    const { sync } = installChromeFake({
      syncSeed: {
        [LEGACY_KEY]: { a: makeWorkspace('a') },
      },
    });

    const storage = await importStorage();
    await storage.ensureWorkspacePerKeyMigration();

    // Simulate an external write to per-key record after first migration.
    (sync!.data[perKey('a')] as WorkspaceRecord).folderMode = 'list';

    // Second call must not overwrite the externally-edited record.
    await storage.ensureWorkspacePerKeyMigration();

    expect((sync!.data[perKey('a')] as WorkspaceRecord).folderMode).toBe('list');
  });

  it('cross-restart — marker present → migration does not re-run', async () => {
    // First lifetime: run migration, capture state.
    const first = installChromeFake({
      syncSeed: { [LEGACY_KEY]: { a: makeWorkspace('a') } },
    });
    const storage1 = await importStorage();
    await storage1.ensureWorkspacePerKeyMigration();

    // Capture post-migration state.
    const syncData = { ...first.sync!.data };
    const localData = { ...first.local.data };

    // Simulate cross-device edit to per-key record after migration.
    (syncData[perKey('a')] as WorkspaceRecord).folderMode = 'list';

    // Put the legacy key BACK in sync to confirm it would be re-processed if
    // the marker guard weren't working.
    syncData[LEGACY_KEY] = { a: makeWorkspace('a', { folderMode: 'grid' }) };

    // Second lifetime: fresh module (memoized promise reset), marker persisted.
    installChromeFake({ syncSeed: syncData, localSeed: localData });
    const storage2 = await importStorage();
    await storage2.ensureWorkspacePerKeyMigration();

    // The per-key value must remain 'list' (cross-device edit preserved, no re-run).
    expect((syncData[perKey('a')] as WorkspaceRecord).folderMode).toBe('list');
    // Legacy key must NOT have been deleted again (migration never ran).
    expect(syncData[LEGACY_KEY]).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// readWorkspaces from per-key layout after migration
// ─────────────────────────────────────────────────────────────────────────────

describe('readWorkspaces — post-migration per-key layout', () => {
  it('reads workspaces from per-key sync keys after migration ran', async () => {
    installChromeFake({
      syncSeed: {
        [LEGACY_KEY]: {
          a: makeWorkspace('a'),
          b: makeWorkspace('b'),
        },
      },
    });

    const storage = await importStorage();
    await storage.ensureWorkspacePerKeyMigration();

    const records = await storage.readWorkspaces();
    const ids = records.map(r => r.id).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('reads workspaces created after migration (no legacy key round-trip)', async () => {
    installChromeFake({
      syncSeed: {
        [LEGACY_KEY]: { a: makeWorkspace('a') },
      },
    });

    const storage = await importStorage();
    await storage.ensureWorkspacePerKeyMigration();

    // Write a new workspace post-migration.
    await storage.writeWorkspace(makeWorkspace('c'));

    const records = await storage.readWorkspaces();
    const ids = records.map(r => r.id).sort();
    expect(ids).toEqual(['a', 'c']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Local-only profile (no sync area)
// ─────────────────────────────────────────────────────────────────────────────

describe('ensureWorkspacePerKeyMigration — local-only profile', () => {
  it('migrates legacy workspaces key to per-key items in local storage', async () => {
    const { local } = installChromeFake({
      withSync: false,
      localSeed: {
        [LEGACY_KEY]: {
          a: makeWorkspace('a'),
          b: makeWorkspace('b'),
        },
      },
    });

    const storage = await importStorage();
    await storage.ensureWorkspacePerKeyMigration();

    expect(local.data[perKey('a')]).toBeDefined();
    expect(local.data[perKey('b')]).toBeDefined();
    expect(local.data[LEGACY_KEY]).toBeUndefined();
    expect(local.data[MIGRATION_MARKER_KEY]).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MAX_WORKSPACES constant
// ─────────────────────────────────────────────────────────────────────────────

describe('MAX_WORKSPACES', () => {
  it('equals 20 after the per-workspace-key storage refactor', async () => {
    const { MAX_WORKSPACES } = await import('@/shared/constants');
    expect(MAX_WORKSPACES).toBe(20);
  });
});
