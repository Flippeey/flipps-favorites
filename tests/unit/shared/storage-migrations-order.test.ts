import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceRecord } from '@/shared/models';

// ─────────────────────────────────────────────────────────────────────────────
// In-memory chrome.storage fake (same pattern as storage-workspace-migration.test.ts
// and storage-per-workspace-key.test.ts). The shared/browser.ts shim reads
// globalThis.chrome at module-load time, so the fake must be installed BEFORE
// the module under test is dynamically imported.
//
// The local area additionally records the ORDER `set()` is called with each
// key, so a test can assert which of the two migrations' persisted markers
// landed first without spying on same-module function calls (a spy on an
// imported binding doesn't intercept a direct in-module call in native ESM).
// ─────────────────────────────────────────────────────────────────────────────

interface StorageAreaFake {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

function createAreaFake(seed: Record<string, unknown> = {}): {
  api: StorageAreaFake;
  data: Record<string, unknown>;
  setKeyLog: string[];
} {
  const data: Record<string, unknown> = { ...seed };
  const setKeyLog: string[] = [];
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
      setKeyLog.push(...Object.keys(items));
      Object.assign(data, items);
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) delete data[key];
    },
  };
  return { api, data, setKeyLog };
}

function installChromeFake(opts: { syncSeed?: Record<string, unknown>; localSeed?: Record<string, unknown> }) {
  const local = createAreaFake(opts.localSeed ?? {});
  const sync = createAreaFake(opts.syncSeed ?? {});
  const chromeFake = {
    runtime: { id: 'test-extension' },
    storage: {
      local: local.api,
      sync: sync.api,
      onChanged: { addListener: () => undefined },
    },
  };
  (globalThis as unknown as { chrome?: unknown }).chrome = chromeFake;
  (globalThis as unknown as { browser?: unknown }).browser = undefined;
  return { local, sync };
}

const STORAGE_KEY = 'app-settings';
const WORKSPACES_KEY = 'workspaces';
const PER_KEY_MARKER = 'workspaces-per-key-migrated';
const VIEW_SORT_MARKER = 'workspace-view-sort-migrated';
const perKey = (id: string) => `workspace:${id}`;

// A legacy stored record lacking the per-workspace view/sort fields, as it
// would have looked before those fields (or per-key layout) existed.
function makeLegacyWorkspace(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
    // folderMode / bookmarkSortMode / bookmarkSortDirection intentionally absent
    ...overrides,
  };
}

async function importStorage(): Promise<typeof import('@/shared/storage')> {
  vi.resetModules();
  return import('@/shared/storage');
}

afterEach(() => {
  vi.resetModules();
  (globalThis as unknown as { chrome?: unknown }).chrome = undefined;
  (globalThis as unknown as { browser?: unknown }).browser = undefined;
});

// A doubly-legacy upgrade: the aggregate `workspaces` key still holds
// field-less records, AND the raw app-settings still carries the old GLOBAL
// view/sort values that predate per-workspace view/sort entirely.
function seedDoublyLegacyState() {
  return installChromeFake({
    syncSeed: {
      [STORAGE_KEY]: {
        activeWorkspaceId: 'a',
        folderMode: 'list',
        bookmarkSortMode: 'name',
        bookmarkSortDirection: 'desc',
      },
      [WORKSPACES_KEY]: {
        a: makeLegacyWorkspace('a'),
        b: makeLegacyWorkspace('b'),
      },
    },
  });
}

describe('ensureStorageMigrations — ordering', () => {
  it('splits the legacy aggregate into per-id keys and removes it', async () => {
    const { sync } = seedDoublyLegacyState();

    const storage = await importStorage();
    await storage.ensureStorageMigrations();

    expect(sync.data[WORKSPACES_KEY]).toBeUndefined();
    const a = sync.data[perKey('a')] as WorkspaceRecord;
    const b = sync.data[perKey('b')] as WorkspaceRecord;
    expect(a?.id).toBe('a');
    expect(a?.name).toBe('Workspace a');
    expect(b?.id).toBe('b');
    expect(b?.name).toBe('Workspace b');
  });

  // The load-bearing ordering test. It doesn't inspect business-logic fields
  // (folderMode etc.) — it inspects the actual, mechanical thing the entry
  // point is responsible for: which migration's persisted marker gets written
  // first. That's a direct, unambiguous readout of call order, and it goes
  // red the moment the two awaits inside ensureStorageMigrations are swapped,
  // without depending on any of either migration's own internal field-mapping
  // logic (see the "why order matters" test below for what's actually at
  // stake if this regresses).
  it('runs the per-key migration before the view/sort migration', async () => {
    const { local } = seedDoublyLegacyState();

    const storage = await importStorage();
    await storage.ensureStorageMigrations();

    const perKeyIndex = local.setKeyLog.indexOf(PER_KEY_MARKER);
    const viewSortIndex = local.setKeyLog.indexOf(VIEW_SORT_MARKER);
    expect(perKeyIndex).toBeGreaterThanOrEqual(0);
    expect(viewSortIndex).toBeGreaterThanOrEqual(0);
    expect(perKeyIndex).toBeLessThan(viewSortIndex);
  });

  // Documents WHY the order matters, isolated from the separate issue where
  // the per-key split's normalize-on-write can mask the view/sort migration's
  // "field absent" detection. This test never calls
  // ensureWorkspaceViewSortMigration at all: it shows that ANY per-key write
  // landing before ensureWorkspacePerKeyMigration runs — which is exactly
  // what happens if it ran second — gets silently discarded, because the
  // migration unconditionally re-derives every per-key record from the
  // legacy aggregate whenever that key is still present, with no awareness
  // that something else already wrote a newer value underneath it.
  it('a per-key write that lands before the per-key migration runs is discarded by it', async () => {
    const { sync } = seedDoublyLegacyState();
    const storage = await importStorage();

    await storage.writeWorkspace({
      ...(sync.data[WORKSPACES_KEY] as Record<string, Record<string, unknown>>).a,
      id: 'a',
      rootFolderId: 'a',
      name: 'Written before migration',
      folderMode: 'list',
      bookmarkSortMode: 'name',
      bookmarkSortDirection: 'desc',
    } as WorkspaceRecord);
    expect((sync.data[perKey('a')] as WorkspaceRecord).name).toBe('Written before migration');

    await storage.ensureWorkspacePerKeyMigration();

    expect((sync.data[perKey('a')] as WorkspaceRecord).name).toBe('Workspace a');
  });

  // View/sort run after a failed split would copy the globals onto per-key
  // records, strip them from app-settings and set its own marker; the retried
  // split then rewrites those records from the aggregate, and view/sort never
  // runs again to restore what it copied. So it waits until the split is done.
  it('a failed per-key split stops the chain until a later call retries it', async () => {
    const { sync, local } = seedDoublyLegacyState();
    const realSet = sync.api.set.bind(sync.api);
    let failNextSplit = true;
    sync.api.set = async items => {
      if (failNextSplit && Object.keys(items).some(key => key.startsWith('workspace:'))) {
        failNextSplit = false;
        throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
      }
      await realSet(items);
    };
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const storage = await importStorage();
    await storage.ensureStorageMigrations();

    expect(local.data[PER_KEY_MARKER]).toBeUndefined();
    expect(local.data[VIEW_SORT_MARKER]).toBeUndefined();
    expect(sync.data[perKey('a')]).toBeUndefined();
    expect((sync.data[STORAGE_KEY] as Record<string, unknown>).folderMode).toBe('list');

    await storage.ensureStorageMigrations();

    expect(local.data[PER_KEY_MARKER]).toBe(true);
    expect(local.data[VIEW_SORT_MARKER]).toBe(true);
    expect(local.setKeyLog.indexOf(PER_KEY_MARKER)).toBeLessThan(local.setKeyLog.indexOf(VIEW_SORT_MARKER));
    vi.restoreAllMocks();
  });
});
