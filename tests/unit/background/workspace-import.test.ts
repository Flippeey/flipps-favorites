import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookmarkNode, FolderIconOverrideRecord, IconOverrideRecord, WorkspaceRecord } from '@/shared/models';
import { WORKSPACE_SCHEMA, WORKSPACE_SCHEMA_VERSION, type ParsedWorkspaceImport } from '@/shared/sync-merge';
import { createBrowser, idbModule, setCurrentBrowser } from '../lib/sync-browser-fake';

// The apply plans from a snapshot, then writes. A user edit or delete that
// lands in between (the page stays usable during a sync) is newer than the
// plan and must survive the apply.

vi.mock('@/shared/icon-idb', () => idbModule);

const NOW = 1_800_000_000_000;

function record(id: string, extra: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
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
    ...extra,
  };
}

function syncPayload(workspaces: WorkspaceRecord[]): ParsedWorkspaceImport {
  return {
    schema: WORKSPACE_SCHEMA,
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    exportedAt: NOW,
    settings: {},
    settingsUpdatedAt: {},
    workspaces,
    workspaceWallpapers: {},
    iconOverrides: [],
    folderIcons: [],
    bookmarkUsage: [],
    deletions: [],
    skipped: { oversizedDataUrlCount: 0 },
  };
}

async function load() {
  vi.resetModules();
  const [storage, background] = await Promise.all([import('@/shared/storage'), import('@/background/workspace-import')]);
  return { storage, background };
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => NOW);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  setCurrentBrowser(createBrowser('solo'));
});

afterEach(() => {
  vi.restoreAllMocks();
  setCurrentBrowser(null);
});

describe('applyWorkspaceImport in the background', () => {
  it('keeps a user edit and a user delete that land while the plan runs', async () => {
    const { storage, background } = await load();
    await storage.writeWorkspace(record('a', { updatedAt: NOW - 1_000 }));
    await storage.writeWorkspace(record('b', { updatedAt: NOW - 1_000 }));

    // The snapshot has been read by the time the tree arrives; the user acts
    // in that window.
    let edited: WorkspaceRecord | undefined;
    const loadTree = async (): Promise<BookmarkNode[]> => {
      await new Promise(resolve => setTimeout(resolve, 0));
      edited = await storage.patchWorkspaceFromUser('a', { name: 'Renamed here' });
      await storage.deleteWorkspaceFromUser('b');
      return [];
    };

    const summary = await background.applyWorkspaceImport(
      syncPayload([record('a', { name: 'Remote a', updatedAt: NOW - 500 }), record('b', { name: 'Remote b', updatedAt: NOW - 500 })]),
      'merge',
      'sync',
      { loadTree, invalidateIcons: async () => undefined },
    );

    expect(await storage.readWorkspaces()).toEqual([edited]);
    expect((await storage.readDeletionMarkers()).map(m => m.key)).toContain('b');
    expect(summary.workspaceCount).toBe(0);
  });

  it('keeps the wallpaper of a workspace the user changed while the plan ran', async () => {
    const { storage, background } = await load();
    await storage.writeWorkspace(record('a', { backgroundMode: 'wallpaper', updatedAt: NOW - 1_000 }));
    await storage.writeWorkspaceWallpaper('a', 'data:image/png;base64,TE9DQUw=');
    const loadTree = async (): Promise<BookmarkNode[]> => {
      await new Promise(resolve => setTimeout(resolve, 0));
      await storage.writeWorkspaceWallpaper('a', 'data:image/png;base64,VVNFUg==');
      await storage.patchWorkspaceFromUser('a', {});
      return [];
    };
    const payload = {
      ...syncPayload([record('a', { backgroundMode: 'wallpaper', updatedAt: NOW - 500 })]),
      workspaceWallpapers: { a: 'data:image/png;base64,UkVNT1RF' },
    };

    await background.applyWorkspaceImport(payload, 'merge', 'sync', { loadTree, invalidateIcons: async () => undefined });

    expect(await storage.readWorkspaceWallpaper('a')).toBe('data:image/png;base64,VVNFUg==');
  });

  it('still applies incoming changes when nothing moved during the plan', async () => {
    const { storage, background } = await load();
    await storage.writeWorkspace(record('a', { updatedAt: NOW - 1_000 }));
    const incoming = record('a', { name: 'Remote a', updatedAt: NOW - 500 });

    const summary = await background.applyWorkspaceImport(syncPayload([incoming]), 'merge', 'sync', {
      loadTree: async () => [],
      invalidateIcons: async () => undefined,
    });

    expect(await storage.readWorkspaces()).toEqual([incoming]);
    expect(summary.workspaceCount).toBe(1);
  });
});

function override(url: string, updatedAt: number, fileName = 'icon.png'): IconOverrideRecord {
  return {
    overrideKey: `exact:${url}`,
    scope: 'exact',
    bookmarkUrl: url,
    dataUrl: 'data:image/png;base64,SUNPTg==',
    fileName,
    mimeType: 'image/png',
    updatedAt,
  };
}

function folderIcon(folderId: string, syncId: string, updatedAt: number, fileName = 'folder.png'): FolderIconOverrideRecord {
  return { folderId, syncId, dataUrl: 'data:image/png;base64,Rk9MREVS', fileName, mimeType: 'image/png', updatedAt };
}

// The user acts after the snapshot was read, before the plan's writes run.
function userActsDuringPlan(act: () => Promise<void>, tree: 'found' | 'unavailable' = 'found') {
  return {
    loadTree: async (): Promise<BookmarkNode[]> => {
      await new Promise(resolve => setTimeout(resolve, 0));
      await act();
      if (tree === 'unavailable') throw new Error('tree unavailable');
      return [];
    },
    invalidateIcons: async () => undefined,
  };
}

describe('planned settings, icon and usage writes keep what the user changed while the plan ran', () => {
  it('a setting the user changed keeps its value and stamp; other incoming settings still land', async () => {
    const { storage, background } = await load();
    const payload = {
      ...syncPayload([]),
      settings: { themeMode: 'dark' as const, showClock: true },
      settingsUpdatedAt: { themeMode: NOW - 500, showClock: NOW - 500 },
    };

    const summary = await background.applyWorkspaceImport(payload, 'merge', 'sync', userActsDuringPlan(async () => {
      await storage.patchSettingsFromUser({ themeMode: 'light' });
    }));

    const stored = await storage.readSettings();
    expect(stored.themeMode).toBe('light');
    expect(stored.settingsUpdatedAt?.themeMode).toBe(NOW);
    expect(stored.showClock).toBe(true);
    expect(stored.settingsUpdatedAt?.showClock).toBe(NOW - 500);
    expect(summary.settings.themeMode).toBe('light');
  });

  it('an icon override the user replaced is not overwritten, nor counted as imported', async () => {
    const { storage, background } = await load();
    const url = 'https://a.example/';
    await storage.writeIconOverrideRecord(override(url, NOW - 1_000));
    let mine: IconOverrideRecord | undefined;

    const summary = await background.applyWorkspaceImport(
      { ...syncPayload([]), iconOverrides: [{ ...override(url, NOW - 500, 'remote.png'), scope: 'exact' }] },
      'merge',
      'sync',
      userActsDuringPlan(async () => {
        mine = await storage.writeIconOverrideFromUser(override(url, 0, 'mine.png'));
      }),
    );

    expect((await storage.readIconOverrideRecords())[`exact:${url}`]).toEqual(mine);
    expect(summary.iconOverrideCount).toBe(0);
  });

  it('a planned override delete keeps an override the user replaced', async () => {
    const { storage, background } = await load();
    const url = 'https://a.example/';
    await storage.writeIconOverrideRecord(override(url, NOW - 1_000));
    let mine: IconOverrideRecord | undefined;

    // A link Replace mirrors a copy without the override.
    await background.applyWorkspaceImport(syncPayload([]), 'replace', 'sync', userActsDuringPlan(async () => {
      mine = await storage.writeIconOverrideFromUser(override(url, 0, 'mine.png'));
    }));

    expect((await storage.readIconOverrideRecords())[`exact:${url}`]).toEqual(mine);
  });

  it('an icon override the user set and removed again is not brought back', async () => {
    const { storage, background } = await load();
    const url = 'https://a.example/';

    const summary = await background.applyWorkspaceImport(
      { ...syncPayload([]), iconOverrides: [{ ...override(url, NOW - 500, 'remote.png'), scope: 'exact' }] },
      'merge',
      'sync',
      userActsDuringPlan(async () => {
        await storage.writeIconOverrideFromUser(override(url, 0, 'mine.png'));
        await storage.deleteIconOverridesForUrlFromUser(url);
      }),
    );

    expect(await storage.readIconOverrideRecords()).toEqual({});
    expect(summary.iconOverrideCount).toBe(0);
  });

  it('a folder icon the user replaced is not overwritten, nor counted as imported', async () => {
    const { storage, background } = await load();
    await storage.writeFolderIconOverride(folderIcon('f1', 's1', NOW - 1_000));
    let mine: FolderIconOverrideRecord | undefined;

    const summary = await background.applyWorkspaceImport(
      { ...syncPayload([]), folderIcons: [folderIcon('f1', 's1', NOW - 500, 'remote.png') as FolderIconOverrideRecord & { syncId: string }] },
      'merge',
      'sync',
      userActsDuringPlan(async () => {
        mine = await storage.writeFolderIconFromUser(folderIcon('f1', 's1', 0, 'mine.png'));
      }, 'unavailable'),
    );

    expect(await storage.readFolderIconOverride('f1')).toEqual(mine);
    expect(summary.folderIconCount).toBe(0);
  });

  it('a planned folder icon delete keeps a folder icon the user replaced', async () => {
    const { storage, background } = await load();
    await storage.writeFolderIconOverride(folderIcon('f1', 's1', NOW - 1_000));
    let mine: FolderIconOverrideRecord | undefined;

    await background.applyWorkspaceImport(syncPayload([]), 'replace', 'sync', userActsDuringPlan(async () => {
      mine = await storage.writeFolderIconFromUser(folderIcon('f1', 's1', 0, 'mine.png'));
    }));

    expect(await storage.readFolderIconOverride('f1')).toEqual(mine);
  });

  it('a pending folder icon placed while the plan ran is not written back as pending', async () => {
    const { storage, background } = await load();
    await storage.writePendingFolderIcon(folderIcon('elsewhere', 'p1', NOW - 1_000));

    const summary = await background.applyWorkspaceImport(
      { ...syncPayload([]), folderIcons: [folderIcon('elsewhere', 'p1', NOW - 500, 'remote.png') as FolderIconOverrideRecord & { syncId: string }] },
      'merge',
      'sync',
      userActsDuringPlan(async () => {
        await storage.deletePendingFolderIcon('p1');
      }, 'unavailable'),
    );

    expect(await storage.readPendingFolderIcons()).toEqual([]);
    expect(summary.folderIconCount).toBe(0);
  });

  it('a planned pending folder icon delete keeps one rewritten while the plan ran', async () => {
    const { storage, background } = await load();
    await storage.writePendingFolderIcon(folderIcon('elsewhere', 'p1', NOW - 1_000));
    const rewritten = folderIcon('elsewhere', 'p1', NOW - 200, 'newer.png');

    // A link Replace mirrors a copy without the icon.
    await background.applyWorkspaceImport(syncPayload([]), 'replace', 'sync', userActsDuringPlan(async () => {
      await storage.writePendingFolderIcon(rewritten);
    }, 'unavailable'));

    expect(await storage.readPendingFolderIcons()).toEqual([rewritten]);
  });

  it('a planned usage delete keeps a record the user bumped by opening the bookmark', async () => {
    const { storage, background } = await load();
    await storage.writeBookmarkUsageRecord({ bookmarkId: 'b1', usedAt: NOW - 1_000 });

    // A link Replace mirrors a copy without usage for this bookmark.
    await background.applyWorkspaceImport(syncPayload([]), 'replace', 'sync', userActsDuringPlan(async () => {
      await storage.writeBookmarkUsageRecord({ bookmarkId: 'b1', usedAt: NOW });
    }));

    expect(await storage.readBookmarkUsageRecords()).toEqual({ b1: { bookmarkId: 'b1', usedAt: NOW } });
  });

  it('a planned usage write never lowers a newer usedAt, so writes need no check of their own', async () => {
    const { storage } = await load();
    await storage.writeBookmarkUsageRecord({ bookmarkId: 'b1', usedAt: NOW });

    await storage.writeBookmarkUsageRecord({ bookmarkId: 'b1', usedAt: NOW - 500 });

    expect((await storage.readBookmarkUsageRecords()).b1?.usedAt).toBe(NOW);
  });
});
