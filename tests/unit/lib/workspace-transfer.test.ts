import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookmarkNode, WorkspaceRecord } from '@/shared/models';

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

// workspace-transfer calls getBookmarkTree() for cross-browser folder
// re-matching (best-effort) and invalidateIcon() after imports. Mock the
// messaging boundary: the default rejected tree keeps every non-rematch test
// on the no-rematch path (records keep their pointers, as before the repair
// existed); rematch tests point it at a fixture tree.
const mockGetBookmarkTree = vi.fn();
vi.mock('@/newtab/lib/messaging', () => ({
  invalidateIcon: async () => undefined,
  getBookmarkTree: (...args: unknown[]) => mockGetBookmarkTree(...args),
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
  mockGetBookmarkTree.mockReset().mockRejectedValue(new Error('tree unavailable'));
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

// ─────────────────────────────────────────────────────────────────────────────
// Cross-browser folder re-matching (#7). rootFolderId is browser-local, so a
// record imported from another browser points at a folder that doesn't exist
// here. The repair must fix the pointer ONLY when it can do so unambiguously —
// a wrong guess silently rebinds a workspace to the wrong folder, which is
// worse than leaving it visibly unresolved.
// ─────────────────────────────────────────────────────────────────────────────

describe('applyWorkspaceImport — cross-browser folder re-matching', () => {
  const REMATCH_TREE: BookmarkNode[] = [
    {
      id: '0',
      title: '',
      children: [
        {
          id: '1',
          title: 'Bookmarks Bar',
          children: [
            { id: 'f-jason', title: 'Jason', children: [] },
            { id: 'f-dup-a', title: 'Duplicate', children: [] },
            { id: 'b1', title: 'Some bookmark', url: 'https://example.com' },
          ],
        },
        {
          id: '2',
          title: 'Other Bookmarks',
          children: [{ id: 'f-dup-b', title: 'Duplicate', children: [] }],
        },
      ],
    },
  ];

  function rematchPayload(records: Array<Record<string, unknown>>): Record<string, unknown> {
    return {
      schema: WORKSPACE_SCHEMA,
      settings: {},
      workspaces: records,
      workspaceWallpapers: {},
      iconOverrides: [],
      bookmarkUsage: [],
    };
  }

  async function storedWorkspace(id: string): Promise<WorkspaceRecord | undefined> {
    const sync = (globalThis as unknown as { chrome: { storage: { sync: StorageAreaFake } } }).chrome.storage.sync;
    const all = await sync.get(null);
    return all[`workspace:${id}`] as WorkspaceRecord | undefined;
  }

  it('keeps a pointer that already resolves in this browser', async () => {
    mockGetBookmarkTree.mockReset().mockResolvedValue(REMATCH_TREE);
    const transfer = await importTransfer();

    const parsed = transfer.normalizeWorkspaceExportPayload(
      rematchPayload([{ ...baseRecordBody('w1'), rootFolderId: 'f-jason' }]),
    );
    await transfer.applyWorkspaceImport(parsed, 'merge');

    expect((await storedWorkspace('w1'))?.rootFolderId).toBe('f-jason');
  });

  it('re-matches a broken pointer by unique folder title', async () => {
    mockGetBookmarkTree.mockReset().mockResolvedValue(REMATCH_TREE);
    const transfer = await importTransfer();

    const parsed = transfer.normalizeWorkspaceExportPayload(
      rematchPayload([{ ...baseRecordBody('w2'), rootFolderId: 'firefox-guid-123', name: 'Jason' }]),
    );
    await transfer.applyWorkspaceImport(parsed, 'merge');

    expect((await storedWorkspace('w2'))?.rootFolderId).toBe('f-jason');
  });

  it('leaves a broken pointer unchanged when the title match is ambiguous', async () => {
    mockGetBookmarkTree.mockReset().mockResolvedValue(REMATCH_TREE);
    const transfer = await importTransfer();

    const parsed = transfer.normalizeWorkspaceExportPayload(
      rematchPayload([{ ...baseRecordBody('w3'), rootFolderId: 'firefox-guid-123', name: 'Duplicate' }]),
    );
    await transfer.applyWorkspaceImport(parsed, 'merge');

    // Two folders are named "Duplicate" — guessing either could bind the
    // workspace to the wrong one, so the foreign pointer must survive intact.
    expect((await storedWorkspace('w3'))?.rootFolderId).toBe('firefox-guid-123');
  });

  it('on id collision, keeps the resolving local pointer while the rest of the record still comes from the payload', async () => {
    installChromeFake({
      syncSeed: {
        'workspace:w4': {
          ...baseRecordBody('w4'),
          rootFolderId: 'f-jason',
          folderMode: 'grid',
          bookmarkSortMode: 'manual',
          bookmarkSortDirection: 'asc',
        },
      },
      localSeed: { 'workspaces-per-key-migrated': true },
    });
    mockGetBookmarkTree.mockReset().mockResolvedValue(REMATCH_TREE);
    const transfer = await importTransfer();

    const parsed = transfer.normalizeWorkspaceExportPayload(
      rematchPayload([{
        ...baseRecordBody('w4'),
        rootFolderId: 'firefox-guid-123',
        name: 'Duplicate',
        accentColor: '#112233',
      }]),
    );
    await transfer.applyWorkspaceImport(parsed, 'merge');

    const stored = await storedWorkspace('w4');
    // The working local folder link survives the collision...
    expect(stored?.rootFolderId).toBe('f-jason');
    // ...but the record content still follows the payload (remote wins).
    expect(stored?.accentColor).toBe('#112233');
  });

  it('imports unchanged when the bookmark tree cannot be fetched (best-effort repair)', async () => {
    // Default mock from beforeEach: getBookmarkTree rejects.
    const transfer = await importTransfer();

    const parsed = transfer.normalizeWorkspaceExportPayload(
      rematchPayload([{ ...baseRecordBody('w5'), rootFolderId: 'firefox-guid-123', name: 'Jason' }]),
    );
    const summary = await transfer.applyWorkspaceImport(parsed, 'merge');

    // The import itself must succeed — repair is opportunistic, not required.
    expect(summary.workspaceCount).toBe(1);
    expect((await storedWorkspace('w5'))?.rootFolderId).toBe('firefox-guid-123');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildSyncPreview — the link dialog's dry run. Its numbers must mirror what
// a confirming applyWorkspaceImport actually does (same cap and dedupe math),
// or the dialog shows one thing and the confirm does another.
// ─────────────────────────────────────────────────────────────────────────────

describe('buildSyncPreview — link-dialog dry run', () => {
  function previewPayload(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
    return {
      schema: WORKSPACE_SCHEMA,
      settings: {},
      workspaces: [],
      workspaceWallpapers: {},
      iconOverrides: [],
      bookmarkUsage: [],
      ...overrides,
    };
  }

  it('splits incoming workspaces into new vs updated and dedupes override/usage counts', async () => {
    installChromeFake({
      syncSeed: {
        'workspace:a': { ...baseRecordBody('a'), folderMode: 'grid', bookmarkSortMode: 'manual', bookmarkSortDirection: 'asc' },
      },
      localSeed: { 'workspaces-per-key-migrated': true },
    });
    const transfer = await importTransfer();

    const parsed = transfer.normalizeWorkspaceExportPayload(previewPayload({
      workspaces: [baseRecordBody('a'), baseRecordBody('b')],
      iconOverrides: [
        { bookmarkUrl: 'https://x.com/a', dataUrl: 'data:image/png;base64,AAA', fileName: 'a.png', mimeType: 'image/png', updatedAt: 1 },
        { bookmarkUrl: 'https://x.com/a', dataUrl: 'data:image/png;base64,BBB', fileName: 'b.png', mimeType: 'image/png', updatedAt: 2 },
      ],
      bookmarkUsage: [{ bookmarkId: 'b1', usedAt: 1 }],
    }));
    const preview = await transfer.buildSyncPreview(parsed, 'merge');

    expect(preview.newWorkspaceNames).toEqual(['Workspace b']);
    expect(preview.updatedWorkspaceNames).toEqual(['Workspace a']);
    expect(preview.workspaceSkippedCount).toBe(0);
    // Two overrides for the same URL/scope collapse to one, exactly as apply dedupes.
    expect(preview.iconOverrideIncomingCount).toBe(1);
    expect(preview.iconOverrideRemovedCount).toBe(0);
    expect(preview.bookmarkUsageIncomingCount).toBe(1);
  });

  it('reports cap-skipped workspaces the same way apply would drop them', async () => {
    const syncSeed: Record<string, unknown> = {};
    for (let i = 0; i < 20; i += 1) {
      syncSeed[`workspace:e${i}`] = { ...baseRecordBody(`e${i}`), folderMode: 'grid', bookmarkSortMode: 'manual', bookmarkSortDirection: 'asc' };
    }
    installChromeFake({ syncSeed, localSeed: { 'workspaces-per-key-migrated': true } });
    const transfer = await importTransfer();

    const parsed = transfer.normalizeWorkspaceExportPayload(previewPayload({
      workspaces: [baseRecordBody('incoming')],
    }));
    const preview = await transfer.buildSyncPreview(parsed, 'merge');

    // MAX_WORKSPACES already reached locally: merge mode has zero slots, so
    // the preview must show the incoming workspace as skipped, not as new.
    expect(preview.newWorkspaceNames).toEqual([]);
    expect(preview.workspaceSkippedCount).toBe(1);
  });
});
