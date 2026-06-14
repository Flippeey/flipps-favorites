import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceRecord } from '@/shared/models';

// buildWorkspaceExport reads icon overrides from IndexedDB, which the node test
// environment has no implementation for. Stub the IDB-backed reads (export
// content of overrides is out of scope for this schema-version test).
vi.mock('@/shared/icon-idb', () => ({
  readAllIconOverrides: async () => ({}),
  clearCachedIcons: async () => undefined,
  clearIconOverrides: async () => undefined,
  deleteCachedIcon: async () => undefined,
  deleteIconOverride: async () => undefined,
  readAllCachedIcons: async () => ({}),
  readCachedIcon: async () => null,
  readIconOverride: async () => null,
  writeIconOverride: async () => undefined,
  writeCachedIcon: async () => undefined,
}));

// ─────────────────────────────────────────────────────────────────────────────
// workspace-transfer imports @/shared/storage, whose shared/browser.ts shim
// reads globalThis.chrome at module-load time and throws if runtime is missing.
// Install an in-memory chrome.storage fake BEFORE dynamically importing the
// module under test. (Same approach as storage-workspace-migration.test.ts.)
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

function installChromeFake(opts: { syncSeed?: Record<string, unknown>; localSeed?: Record<string, unknown> } = {}): void {
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
}

async function importTransfer(): Promise<typeof import('@/newtab/lib/workspace-transfer')> {
  vi.resetModules();
  return import('@/newtab/lib/workspace-transfer');
}

beforeEach(() => {
  installChromeFake();
});

afterEach(() => {
  vi.resetModules();
  (globalThis as unknown as { chrome?: unknown }).chrome = undefined;
  (globalThis as unknown as { browser?: unknown }).browser = undefined;
});

const WORKSPACE_SCHEMA = 'flipps-workspace-transfer';

// A full WorkspaceRecord body lacking ONLY the view/sort fields, as a v2 export
// (where view/sort lived on the global settings, not the record) would carry.
function baseRecordBody(id: string): Record<string, unknown> {
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
  };
}

function makeFile(payload: unknown): File {
  return new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' });
}

describe('parseWorkspaceFile — v2 import upcast', () => {
  it('copies the payload global view/sort into every imported record that lacks them', async () => {
    const transfer = await importTransfer();
    const file = makeFile({
      schema: WORKSPACE_SCHEMA,
      schemaVersion: 2,
      exportedAt: 1700000000000,
      // v2 exports embed view/sort as GLOBAL settings, not per-record.
      settings: { folderMode: 'list', bookmarkSortMode: 'name', bookmarkSortDirection: 'desc' },
      workspaces: [baseRecordBody('a'), baseRecordBody('b')],
      workspaceWallpapers: {},
      iconOverrides: [],
      bookmarkUsage: [],
    });

    const result = await transfer.parseWorkspaceFile(file);

    expect(result.schemaVersion).toBe(2);
    for (const ws of result.workspaces) {
      expect(ws.folderMode).toBe('list');
      expect(ws.bookmarkSortMode).toBe('name');
      expect(ws.bookmarkSortDirection).toBe('desc');
    }
  });

  it('upcast value WINS over the plain default for v2 files', async () => {
    const transfer = await importTransfer();
    const file = makeFile({
      schema: WORKSPACE_SCHEMA,
      schemaVersion: 2,
      settings: { folderMode: 'list', bookmarkSortMode: 'created', bookmarkSortDirection: 'desc' },
      workspaces: [baseRecordBody('a')],
      workspaceWallpapers: {},
      iconOverrides: [],
      bookmarkUsage: [],
    });

    const result = await transfer.parseWorkspaceFile(file);

    // Defaults would be grid/manual/asc — the v2 global must override them.
    expect(result.workspaces[0].folderMode).toBe('list');
    expect(result.workspaces[0].bookmarkSortMode).toBe('created');
    expect(result.workspaces[0].bookmarkSortDirection).toBe('desc');
  });

  it('falls back to defaults when a very old v2 payload also lacks the global fields', async () => {
    const transfer = await importTransfer();
    const file = makeFile({
      schema: WORKSPACE_SCHEMA,
      schemaVersion: 2,
      settings: {}, // ancient export with no view/sort anywhere
      workspaces: [baseRecordBody('a')],
      workspaceWallpapers: {},
      iconOverrides: [],
      bookmarkUsage: [],
    });

    const result = await transfer.parseWorkspaceFile(file);

    expect(result.workspaces[0].folderMode).toBe('grid');
    expect(result.workspaces[0].bookmarkSortMode).toBe('manual');
    expect(result.workspaces[0].bookmarkSortDirection).toBe('asc');
  });

  it('treats an absent (versionless) payload as legacy and upcasts the globals', async () => {
    const transfer = await importTransfer();
    const file = makeFile({
      schema: WORKSPACE_SCHEMA,
      // no schemaVersion at all — must be treated as legacy (<=2), not current
      settings: { folderMode: 'list', bookmarkSortMode: 'name', bookmarkSortDirection: 'desc' },
      workspaces: [baseRecordBody('a')],
      workspaceWallpapers: {},
      iconOverrides: [],
      bookmarkUsage: [],
    });

    const result = await transfer.parseWorkspaceFile(file);

    expect(result.workspaces[0].folderMode).toBe('list');
    expect(result.workspaces[0].bookmarkSortMode).toBe('name');
    expect(result.workspaces[0].bookmarkSortDirection).toBe('desc');
  });
});

describe('parseWorkspaceFile — v3 import passthrough', () => {
  it('keeps explicit per-record view/sort untouched', async () => {
    const transfer = await importTransfer();
    const file = makeFile({
      schema: WORKSPACE_SCHEMA,
      schemaVersion: 3,
      // v3 settings no longer carry the globals; if present they must NOT override records.
      settings: { folderMode: 'grid', bookmarkSortMode: 'manual', bookmarkSortDirection: 'asc' },
      workspaces: [
        { ...baseRecordBody('a'), folderMode: 'list', bookmarkSortMode: 'name', bookmarkSortDirection: 'desc' },
      ],
      workspaceWallpapers: {},
      iconOverrides: [],
      bookmarkUsage: [],
    });

    const result = await transfer.parseWorkspaceFile(file);

    expect(result.schemaVersion).toBe(3);
    expect(result.workspaces[0].folderMode).toBe('list');
    expect(result.workspaces[0].bookmarkSortMode).toBe('name');
    expect(result.workspaces[0].bookmarkSortDirection).toBe('desc');
  });

  it('falls back to defaults for v3 records that are missing the fields', async () => {
    const transfer = await importTransfer();
    const file = makeFile({
      schema: WORKSPACE_SCHEMA,
      schemaVersion: 3,
      settings: {},
      workspaces: [baseRecordBody('a')],
      workspaceWallpapers: {},
      iconOverrides: [],
      bookmarkUsage: [],
    });

    const result = await transfer.parseWorkspaceFile(file);

    expect(result.workspaces[0].folderMode).toBe('grid');
    expect(result.workspaces[0].bookmarkSortMode).toBe('manual');
    expect(result.workspaces[0].bookmarkSortDirection).toBe('asc');
  });
});

describe('parseWorkspaceFile — forward-compat guard', () => {
  it('rejects a payload whose schemaVersion is newer than the current constant', async () => {
    const transfer = await importTransfer();
    const file = makeFile({
      schema: WORKSPACE_SCHEMA,
      schemaVersion: transfer.WORKSPACE_SCHEMA_VERSION + 1,
      settings: {},
      workspaces: [baseRecordBody('a')],
      workspaceWallpapers: {},
      iconOverrides: [],
      bookmarkUsage: [],
    });

    await expect(transfer.parseWorkspaceFile(file)).rejects.toThrow(/newer/i);
  });

  it('rejects a concrete future v4 backup', async () => {
    const transfer = await importTransfer();
    const file = makeFile({
      schema: WORKSPACE_SCHEMA,
      schemaVersion: 4,
      settings: {},
      workspaces: [baseRecordBody('a')],
      workspaceWallpapers: {},
      iconOverrides: [],
      bookmarkUsage: [],
    });

    await expect(transfer.parseWorkspaceFile(file)).rejects.toThrow();
  });
});

describe('buildWorkspaceExport — schema v3', () => {
  it('emits schemaVersion 3 and per-record view/sort fields', async () => {
    // Seed using the per-key layout (workspace:<id>) — the storage refactor
    // stores each workspace record under its own sync key.
    installChromeFake({
      syncSeed: {
        'app-settings': { activeWorkspaceId: 'a' },
        'workspace:a': { ...baseRecordBody('a'), folderMode: 'list', bookmarkSortMode: 'name', bookmarkSortDirection: 'desc' },
      },
      localSeed: { 'workspaces-per-key-migrated': true },
    });
    const transfer = await importTransfer();

    const payload = await transfer.buildWorkspaceExport();

    expect(payload.schemaVersion).toBe(3);
    const exported = payload.workspaces.find((w: WorkspaceRecord) => w.id === 'a');
    expect(exported?.folderMode).toBe('list');
    expect(exported?.bookmarkSortMode).toBe('name');
    expect(exported?.bookmarkSortDirection).toBe('desc');
  });
});
