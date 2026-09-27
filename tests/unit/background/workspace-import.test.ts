import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookmarkNode, WorkspaceRecord } from '@/shared/models';
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
