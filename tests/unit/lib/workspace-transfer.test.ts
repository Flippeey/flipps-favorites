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
  readAllFolderIconRecords: async () => ({}),
  readFolderIconRecord: async () => null,
  writeFolderIconRecord: async () => undefined,
  deleteFolderIconRecord: async () => undefined,
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

  it('rejects a concrete future v5 backup', async () => {
    const transfer = await importTransfer();
    const file = makeFile({
      schema: WORKSPACE_SCHEMA,
      schemaVersion: 5,
      settings: {},
      workspaces: [baseRecordBody('a')],
      workspaceWallpapers: {},
      iconOverrides: [],
      folderIcons: [],
      bookmarkUsage: [],
    });

    await expect(transfer.parseWorkspaceFile(file)).rejects.toThrow();
  });
});

describe('applyWorkspaceImport — MAX_WORKSPACES cap', () => {
  it('caps import at MAX_WORKSPACES and reports the rest as skipped (empty existing set)', async () => {
    installChromeFake({ localSeed: { 'workspaces-per-key-migrated': true } });
    const transfer = await importTransfer();

    // Importing into an EMPTY workspace set: without the cap, all 30 would be
    // written and blow past the intended 20-workspace ceiling. This assertion
    // fails if the cap is removed (30 landed / 0 skipped).
    const workspaces = Array.from({ length: 30 }, (_, i) => baseRecordBody(`w${i}`)) as unknown as WorkspaceRecord[];
    const payload = {
      schema: WORKSPACE_SCHEMA,
      schemaVersion: transfer.WORKSPACE_SCHEMA_VERSION,
      exportedAt: Date.now(),
      settings: {},
      workspaces,
      workspaceWallpapers: {},
      iconOverrides: [],
      bookmarkUsage: [],
      skipped: { oversizedDataUrlCount: 0 },
    } as unknown as Parameters<typeof transfer.applyWorkspaceImport>[0];

    const summary = await transfer.applyWorkspaceImport(payload, 'merge');

    expect(summary.workspaceCount).toBe(20);
    expect(summary.workspaceSkippedCount).toBe(10);
    expect(summary.workspaceFailedCount).toBe(0);
  });

  it('merge mode respects existing workspace count so total never exceeds MAX_WORKSPACES', async () => {
    // Seed 15 existing workspaces via per-key entries.
    const syncSeed: Record<string, unknown> = { 'app-settings': { activeWorkspaceId: 'e0' } };
    for (let i = 0; i < 15; i++) {
      syncSeed[`workspace:e${i}`] = baseRecordBody(`e${i}`);
    }
    installChromeFake({ syncSeed, localSeed: { 'workspaces-per-key-migrated': true } });
    const transfer = await importTransfer();

    // 10 incoming new workspaces; only 5 slots remain (20 - 15).
    const workspaces = Array.from({ length: 10 }, (_, i) => baseRecordBody(`n${i}`)) as unknown as WorkspaceRecord[];
    const payload = {
      schema: WORKSPACE_SCHEMA,
      schemaVersion: transfer.WORKSPACE_SCHEMA_VERSION,
      exportedAt: Date.now(),
      settings: {},
      workspaces,
      workspaceWallpapers: {},
      iconOverrides: [],
      bookmarkUsage: [],
      skipped: { oversizedDataUrlCount: 0 },
    } as unknown as Parameters<typeof transfer.applyWorkspaceImport>[0];

    const summary = await transfer.applyWorkspaceImport(payload, 'merge');

    expect(summary.workspaceCount).toBe(5);
    expect(summary.workspaceSkippedCount).toBe(5);
  });

  it('reports a mid-loop write failure without silently dropping it from the count', async () => {
    installChromeFake({ localSeed: { 'workspaces-per-key-migrated': true } });
    const transfer = await importTransfer();

    // Make the sync fake throw for exactly one workspace key to simulate a
    // quota/storage failure mid-loop.
    const chromeFake = (globalThis as unknown as { chrome: { storage: { sync: { set: (items: Record<string, unknown>) => Promise<void> } } } }).chrome;
    const originalSet = chromeFake.storage.sync.set.bind(chromeFake.storage.sync);
    chromeFake.storage.sync.set = async (items: Record<string, unknown>) => {
      if ('workspace:bad' in items) {
        throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
      }
      return originalSet(items);
    };

    const workspaces = [baseRecordBody('good'), baseRecordBody('bad')] as unknown as WorkspaceRecord[];
    const payload = {
      schema: WORKSPACE_SCHEMA,
      schemaVersion: transfer.WORKSPACE_SCHEMA_VERSION,
      exportedAt: Date.now(),
      settings: {},
      workspaces,
      workspaceWallpapers: {},
      iconOverrides: [],
      bookmarkUsage: [],
      skipped: { oversizedDataUrlCount: 0 },
    } as unknown as Parameters<typeof transfer.applyWorkspaceImport>[0];

    const summary = await transfer.applyWorkspaceImport(payload, 'merge');

    // "good" landed, "bad" failed — the caller can tell exactly what happened
    // instead of getting a bare thrown error that hides the partial success.
    expect(summary.workspaceCount).toBe(1);
    expect(summary.workspaceFailedCount).toBe(1);
  });
});

describe('parseWorkspaceFile — oversized data URL caps', () => {
  function dataUrlOfLength(length: number): string {
    const prefix = 'data:image/png;base64,';
    return prefix + 'A'.repeat(Math.max(0, length - prefix.length));
  }

  it('skips an icon override whose data URL exceeds the cap and reports it', async () => {
    const transfer = await importTransfer();
    const oversized = dataUrlOfLength(6 * 1024 * 1024); // 6 MB > 5 MB cap
    const fine = dataUrlOfLength(1024); // well under cap

    const file = makeFile({
      schema: WORKSPACE_SCHEMA,
      schemaVersion: 3,
      settings: {},
      workspaces: [],
      workspaceWallpapers: {},
      iconOverrides: [
        { bookmarkUrl: 'https://big.example.com', dataUrl: oversized, fileName: 'a.png', mimeType: 'image/png', updatedAt: 1 },
        { bookmarkUrl: 'https://small.example.com', dataUrl: fine, fileName: 'b.png', mimeType: 'image/png', updatedAt: 2 },
      ],
      bookmarkUsage: [],
    });

    const result = await transfer.parseWorkspaceFile(file);

    expect(result.iconOverrides).toHaveLength(1);
    expect(result.iconOverrides[0].bookmarkUrl).toBe('https://small.example.com');
    expect(result.skipped.oversizedDataUrlCount).toBe(1);
  });

  it('skips an oversized workspace wallpaper and reports it, leaving under-cap wallpapers untouched', async () => {
    const transfer = await importTransfer();
    const oversized = dataUrlOfLength(6 * 1024 * 1024);
    const fine = dataUrlOfLength(2048);

    const file = makeFile({
      schema: WORKSPACE_SCHEMA,
      schemaVersion: 3,
      settings: {},
      workspaces: [baseRecordBody('a'), baseRecordBody('b')],
      workspaceWallpapers: { a: oversized, b: fine },
      iconOverrides: [],
      bookmarkUsage: [],
    });

    const result = await transfer.parseWorkspaceFile(file);

    expect(result.workspaceWallpapers.a).toBeUndefined();
    expect(result.workspaceWallpapers.b).toBe(fine);
    expect(result.skipped.oversizedDataUrlCount).toBe(1);
  });

  it('passes through data URLs at or under the cap unchanged', async () => {
    const transfer = await importTransfer();
    const atCap = dataUrlOfLength(1024); // small, well under cap — sanity check for false positives

    const file = makeFile({
      schema: WORKSPACE_SCHEMA,
      schemaVersion: 3,
      settings: {},
      workspaces: [],
      workspaceWallpapers: {},
      iconOverrides: [
        { bookmarkUrl: 'https://ok.example.com', dataUrl: atCap, fileName: 'a.png', mimeType: 'image/png', updatedAt: 1 },
      ],
      bookmarkUsage: [],
    });

    const result = await transfer.parseWorkspaceFile(file);

    expect(result.iconOverrides).toHaveLength(1);
    expect(result.iconOverrides[0].dataUrl).toBe(atCap);
    expect(result.skipped.oversizedDataUrlCount).toBe(0);
  });
});

describe('buildWorkspaceExport — schema v4', () => {
  it('emits schemaVersion 4 and per-record view/sort fields', async () => {
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

    expect(payload.schemaVersion).toBe(4);
    const exported = payload.workspaces.find((w: WorkspaceRecord) => w.id === 'a');
    expect(exported?.folderMode).toBe('list');
    expect(exported?.bookmarkSortMode).toBe('name');
    expect(exported?.bookmarkSortDirection).toBe('desc');
  });
});

// Folder custom icons (issue #44) round-trip through export/import, and a v3-
// and-earlier backup (predating the feature) upcasts to an empty list rather
// than failing to parse.
describe('folder icon export/import round-trip', () => {
  it('a v3 (pre-feature) backup with no folderIcons key upcasts to an empty list', async () => {
    const transfer = await importTransfer();
    const file = makeFile({
      schema: WORKSPACE_SCHEMA,
      schemaVersion: 3,
      settings: {},
      workspaces: [],
      workspaceWallpapers: {},
      iconOverrides: [],
      bookmarkUsage: [],
      // no folderIcons field at all
    });

    const result = await transfer.parseWorkspaceFile(file);

    expect(result.folderIcons).toEqual([]);
  });

  it('valid folder icon entries pass through parseWorkspaceFile unchanged', async () => {
    const transfer = await importTransfer();
    const file = makeFile({
      schema: WORKSPACE_SCHEMA,
      schemaVersion: 4,
      settings: {},
      workspaces: [],
      workspaceWallpapers: {},
      iconOverrides: [],
      folderIcons: [
        { folderId: 'f1', dataUrl: 'data:image/png;base64,AAAA', fileName: 'icon.png', mimeType: 'image/png', updatedAt: 5 },
      ],
      bookmarkUsage: [],
    });

    const result = await transfer.parseWorkspaceFile(file);

    expect(result.folderIcons).toHaveLength(1);
    expect(result.folderIcons[0].folderId).toBe('f1');
    expect(result.folderIcons[0].dataUrl).toBe('data:image/png;base64,AAAA');
  });

  it('skips a folder icon whose data URL exceeds the size cap and reports it', async () => {
    const transfer = await importTransfer();
    const oversized = 'data:image/png;base64,' + 'A'.repeat(6 * 1024 * 1024);
    const file = makeFile({
      schema: WORKSPACE_SCHEMA,
      schemaVersion: 4,
      settings: {},
      workspaces: [],
      workspaceWallpapers: {},
      iconOverrides: [],
      folderIcons: [
        { folderId: 'big', dataUrl: oversized, mimeType: 'image/png', updatedAt: 1 },
      ],
      bookmarkUsage: [],
    });

    const result = await transfer.parseWorkspaceFile(file);

    expect(result.folderIcons).toHaveLength(0);
    expect(result.skipped.oversizedDataUrlCount).toBe(1);
  });

  it('applyWorkspaceImport dedupes folder icons by folderId, most recent wins', async () => {
    installChromeFake({ localSeed: { 'workspaces-per-key-migrated': true } });
    const transfer = await importTransfer();
    const payload = {
      schema: WORKSPACE_SCHEMA,
      schemaVersion: transfer.WORKSPACE_SCHEMA_VERSION,
      exportedAt: Date.now(),
      settings: {},
      workspaces: [],
      workspaceWallpapers: {},
      iconOverrides: [],
      folderIcons: [
        { folderId: 'f1', dataUrl: 'data:image/png;base64,OLD', mimeType: 'image/png', updatedAt: 1 },
        { folderId: 'f1', dataUrl: 'data:image/png;base64,NEW', mimeType: 'image/png', updatedAt: 99 },
      ],
      bookmarkUsage: [],
      skipped: { oversizedDataUrlCount: 0 },
    } as unknown as Parameters<typeof transfer.applyWorkspaceImport>[0];

    const summary = await transfer.applyWorkspaceImport(payload, 'merge');

    expect(summary.folderIconCount).toBe(1);
  });

  it('a manually-built payload lacking the folderIcons field defaults to zero imported (no crash)', async () => {
    installChromeFake({ localSeed: { 'workspaces-per-key-migrated': true } });
    const transfer = await importTransfer();
    const payload = {
      schema: WORKSPACE_SCHEMA,
      schemaVersion: transfer.WORKSPACE_SCHEMA_VERSION,
      exportedAt: Date.now(),
      settings: {},
      workspaces: [],
      workspaceWallpapers: {},
      iconOverrides: [],
      bookmarkUsage: [],
      skipped: { oversizedDataUrlCount: 0 },
    } as unknown as Parameters<typeof transfer.applyWorkspaceImport>[0];

    const summary = await transfer.applyWorkspaceImport(payload, 'merge');

    expect(summary.folderIconCount).toBe(0);
  });
});
