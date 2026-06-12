import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceRecord } from '@/shared/models';

// ─────────────────────────────────────────────────────────────────────────────
// In-memory chrome.storage fake. The shared/browser.ts shim reads
// globalThis.chrome at module-load time and throws if runtime is missing, so the
// fake must be installed BEFORE the module under test is dynamically imported.
// ─────────────────────────────────────────────────────────────────────────────

interface StorageAreaFake {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

function createAreaFake(seed: Record<string, unknown> = {}): { api: StorageAreaFake; data: Record<string, unknown> } {
  const data: Record<string, unknown> = { ...seed };
  const api: StorageAreaFake = {
    async get(keys) {
      if (keys === null) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const key of list) {
        if (key in data) out[key] = data[key];
      }
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

function installChromeFake(opts: { syncSeed?: Record<string, unknown>; localSeed?: Record<string, unknown>; withSync?: boolean }) {
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

const STORAGE_KEY = 'app-settings';
const WORKSPACES_KEY = 'workspaces';

function makeWorkspace(id: string, overrides: Partial<WorkspaceRecord> = {}): Record<string, unknown> {
  // A minimal record lacking the new view/sort fields, as a legacy stored record would be.
  return {
    id,
    name: `Workspace ${id}`,
    rootFolderId: id,
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
    ...overrides,
  };
}

async function importStorage(): Promise<typeof import('@/shared/storage')> {
  // Fresh module instance each import → memoized migration promise resets,
  // simulating a service-worker restart.
  vi.resetModules();
  return import('@/shared/storage');
}

afterEach(() => {
  vi.resetModules();
  (globalThis as unknown as { chrome?: unknown }).chrome = undefined;
  (globalThis as unknown as { browser?: unknown }).browser = undefined;
});

describe('ensureWorkspaceViewSortMigration — upgrade', () => {
  it('copies raw legacy global view/sort into every workspace record exactly once', async () => {
    const { sync } = installChromeFake({
      syncSeed: {
        [STORAGE_KEY]: {
          activeWorkspaceId: 'a',
          folderMode: 'list',
          bookmarkSortMode: 'name',
          bookmarkSortDirection: 'desc',
        },
        [WORKSPACES_KEY]: {
          a: makeWorkspace('a'),
          b: makeWorkspace('b'),
        },
      },
    });

    const storage = await importStorage();
    await storage.ensureWorkspaceViewSortMigration();

    const records = (sync!.data[WORKSPACES_KEY] ?? {}) as Record<string, WorkspaceRecord>;
    expect(records.a.folderMode).toBe('list');
    expect(records.a.bookmarkSortMode).toBe('name');
    expect(records.a.bookmarkSortDirection).toBe('desc');
    expect(records.b.folderMode).toBe('list');
    expect(records.b.bookmarkSortMode).toBe('name');
    expect(records.b.bookmarkSortDirection).toBe('desc');
  });

  it('clears the legacy view/sort keys from raw app-settings after copying', async () => {
    const { sync } = installChromeFake({
      syncSeed: {
        [STORAGE_KEY]: {
          activeWorkspaceId: 'a',
          folderMode: 'list',
          bookmarkSortMode: 'name',
          bookmarkSortDirection: 'desc',
        },
        [WORKSPACES_KEY]: { a: makeWorkspace('a') },
      },
    });

    const storage = await importStorage();
    await storage.ensureWorkspaceViewSortMigration();

    const rawSettings = (sync!.data[STORAGE_KEY] ?? {}) as Record<string, unknown>;
    expect('folderMode' in rawSettings).toBe(false);
    expect('bookmarkSortMode' in rawSettings).toBe(false);
    expect('bookmarkSortDirection' in rawSettings).toBe(false);
    // Untouched keys remain.
    expect(rawSettings.activeWorkspaceId).toBe('a');
  });

  it('fresh install — no legacy keys present → no copy, records untouched', async () => {
    const { sync } = installChromeFake({
      syncSeed: {
        [STORAGE_KEY]: { activeWorkspaceId: 'a' },
        [WORKSPACES_KEY]: {
          a: makeWorkspace('a', { folderMode: 'grid', bookmarkSortMode: 'manual', bookmarkSortDirection: 'asc' }),
        },
      },
    });

    const storage = await importStorage();
    await storage.ensureWorkspaceViewSortMigration();

    const records = (sync!.data[WORKSPACES_KEY] ?? {}) as Record<string, WorkspaceRecord>;
    expect(records.a.folderMode).toBe('grid');
    expect(records.a.bookmarkSortMode).toBe('manual');
    expect(records.a.bookmarkSortDirection).toBe('asc');
  });
});

describe('ensureWorkspaceViewSortMigration — idempotency', () => {
  it('second run within the same SW lifetime is a no-op (memoized)', async () => {
    const { sync } = installChromeFake({
      syncSeed: {
        [STORAGE_KEY]: { folderMode: 'list', bookmarkSortMode: 'name', bookmarkSortDirection: 'desc' },
        [WORKSPACES_KEY]: { a: makeWorkspace('a') },
      },
    });

    const storage = await importStorage();
    await storage.ensureWorkspaceViewSortMigration();

    // Simulate a sync peer flipping a record's view AFTER migration. A second
    // call in the same lifetime must NOT re-copy stale globals over it.
    const records = sync!.data[WORKSPACES_KEY] as Record<string, Record<string, unknown>>;
    records.a.folderMode = 'grid';

    await storage.ensureWorkspaceViewSortMigration();

    expect((sync!.data[WORKSPACES_KEY] as Record<string, WorkspaceRecord>).a.folderMode).toBe('grid');
  });

  it('cross-restart — marker present + legacy keys gone → migration does NOT re-apply', async () => {
    // First lifetime: run migration.
    const first = installChromeFake({
      syncSeed: {
        [STORAGE_KEY]: { folderMode: 'list', bookmarkSortMode: 'name', bookmarkSortDirection: 'desc' },
        [WORKSPACES_KEY]: { a: makeWorkspace('a') },
      },
    });
    const storage1 = await importStorage();
    await storage1.ensureWorkspaceViewSortMigration();

    // Capture post-migration state (sync data carries records + cleared settings;
    // local data carries the persisted one-shot marker).
    const syncData = { ...first.sync!.data };
    const localData = { ...first.local.data };

    // Simulate a sync peer flipping a record AFTER migration, then a SW restart.
    (syncData[WORKSPACES_KEY] as Record<string, Record<string, unknown>>).a.folderMode = 'grid';

    // Second lifetime: fresh module (memoized promise reset), marker persisted.
    const second = installChromeFake({ syncSeed: syncData, localSeed: localData });
    const storage2 = await importStorage();
    await storage2.ensureWorkspaceViewSortMigration();

    // No flip: the peer's value survives; migration short-circuited on the marker.
    expect((second.sync!.data[WORKSPACES_KEY] as Record<string, WorkspaceRecord>).a.folderMode).toBe('grid');
  });
});

describe('normalizeWorkspaceRecord (deserialize-on-read) — sync-peer race', () => {
  it('fills missing view/sort fields with defaults on read; never crashes', async () => {
    installChromeFake({
      syncSeed: {
        [WORKSPACES_KEY]: { a: makeWorkspace('a') }, // no view/sort fields
      },
    });

    const storage = await importStorage();
    const records = await storage.readWorkspaces();
    const a = records.find(r => r.id === 'a');
    expect(a).toBeDefined();
    expect(a!.folderMode).toBe('grid');
    expect(a!.bookmarkSortMode).toBe('manual');
    expect(a!.bookmarkSortDirection).toBe('asc');
  });

  it('rejects malformed values, falling back to defaults (unknown narrowing)', async () => {
    installChromeFake({
      syncSeed: {
        [WORKSPACES_KEY]: {
          a: makeWorkspace('a', {
            // Deliberately invalid literals.
            folderMode: 'sideways' as unknown as WorkspaceRecord['folderMode'],
            bookmarkSortMode: 42 as unknown as WorkspaceRecord['bookmarkSortMode'],
            bookmarkSortDirection: null as unknown as WorkspaceRecord['bookmarkSortDirection'],
          }),
        },
      },
    });

    const storage = await importStorage();
    const records = await storage.readWorkspaces();
    const a = records.find(r => r.id === 'a');
    expect(a!.folderMode).toBe('grid');
    expect(a!.bookmarkSortMode).toBe('manual');
    expect(a!.bookmarkSortDirection).toBe('asc');
  });

  it('drops records missing required identity fields (returns null → excluded)', async () => {
    installChromeFake({
      syncSeed: {
        [WORKSPACES_KEY]: {
          good: makeWorkspace('good'),
          bad: { name: 'no id' }, // missing id/rootFolderId
        },
      },
    });

    const storage = await importStorage();
    const records = await storage.readWorkspaces();
    expect(records.map(r => r.id)).toEqual(['good']);
  });

  it('preserves explicit valid view/sort values from sync peers', async () => {
    installChromeFake({
      syncSeed: {
        [WORKSPACES_KEY]: {
          a: makeWorkspace('a', { folderMode: 'list', bookmarkSortMode: 'created', bookmarkSortDirection: 'desc' }),
        },
      },
    });

    const storage = await importStorage();
    const records = await storage.readWorkspaces();
    const a = records.find(r => r.id === 'a');
    expect(a!.folderMode).toBe('list');
    expect(a!.bookmarkSortMode).toBe('created');
    expect(a!.bookmarkSortDirection).toBe('desc');
  });
});

describe('migration on a local-only profile (no sync area)', () => {
  it('reads raw legacy globals from local and copies into records', async () => {
    const { local } = installChromeFake({
      withSync: false,
      localSeed: {
        [STORAGE_KEY]: { folderMode: 'list', bookmarkSortMode: 'name', bookmarkSortDirection: 'desc' },
        [WORKSPACES_KEY]: { a: makeWorkspace('a') },
      },
    });

    const storage = await importStorage();
    await storage.ensureWorkspaceViewSortMigration();

    const records = (local.data[WORKSPACES_KEY] ?? {}) as Record<string, WorkspaceRecord>;
    expect(records.a.folderMode).toBe('list');
    expect(records.a.bookmarkSortMode).toBe('name');
    expect(records.a.bookmarkSortDirection).toBe('desc');
  });
});
