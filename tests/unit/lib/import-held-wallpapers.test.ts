import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookmarkNode, WorkspaceRecord } from '@/shared/models';
import type { ApplyWorkspaceImportRequest } from '@/shared/messages';
import { WORKSPACE_SCHEMA, WORKSPACE_SCHEMA_VERSION, type ParsedWorkspaceImport } from '@/shared/sync-merge';
import { buildFolderLocator } from '@/shared/folder-locator';
import { createBrowser, idbModule, setCurrentBrowser } from './sync-browser-fake';

// A backup file's wallpapers can outgrow one runtime message, so the page
// keeps them and writes the ones the background names. These pin that the
// request carries none, and that each lands under the id stored here.

vi.mock('@/shared/icon-idb', () => idbModule);

const NOW = 1_800_000_000_000;
const TREE: BookmarkNode[] = [{ id: '0', title: '', children: [{ id: '1', title: 'Bookmarks bar', children: [] }] }];
const WALLPAPER = 'data:image/png;base64,RklMRQ==';

let sent: Omit<ApplyWorkspaceImportRequest, 'type'> | null = null;
let beforeTree: () => Promise<void> = async () => undefined;

vi.mock('@/newtab/lib/messaging', () => ({
  getBookmarkTree: async () => TREE,
  applyWorkspaceImport: async (...[payload, mode, origin, heldWallpaperIds]: [ParsedWorkspaceImport, 'merge' | 'replace', 'file' | 'sync', string[] | undefined]) => {
    sent = { payload, mode, origin, ...(heldWallpaperIds ? { heldWallpaperIds } : {}) };
    // Through structured cloning, like a runtime message.
    const background = await import('@/background/workspace-import');
    return structuredClone(await background.applyWorkspaceImport(structuredClone(payload), mode, origin, {
      loadTree: async () => {
        await beforeTree();
        return TREE;
      },
      invalidateIcons: async () => undefined,
    }, heldWallpaperIds));
  },
}));

function record(id: string, extra: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
  return {
    id,
    name: `Workspace ${id}`,
    rootFolderId: `folder-${id}`,
    themeMode: 'system',
    accentColor: '#3F72DC',
    backgroundMode: 'wallpaper',
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

function filePayload(workspaces: WorkspaceRecord[], workspaceWallpapers: Record<string, string>): ParsedWorkspaceImport {
  return {
    schema: WORKSPACE_SCHEMA,
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    exportedAt: NOW,
    settings: {},
    settingsUpdatedAt: {},
    workspaces,
    workspaceWallpapers,
    iconOverrides: [],
    folderIcons: [],
    bookmarkUsage: [],
    skipped: { oversizedDataUrlCount: 0 },
  };
}

async function load() {
  vi.resetModules();
  const [storage, transfer] = await Promise.all([import('@/shared/storage'), import('@/newtab/lib/workspace-transfer')]);
  return { storage, transfer };
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => NOW);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  setCurrentBrowser(createBrowser('solo'));
  sent = null;
  beforeTree = async () => undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  setCurrentBrowser(null);
});

describe('importWorkspaceFile wallpapers', () => {
  it('sends no wallpaper data to the background and writes the wallpaper of a new workspace', async () => {
    const { storage, transfer } = await load();

    const summary = await transfer.importWorkspaceFile(filePayload([record('new', { updatedAt: NOW - 500 })], { new: WALLPAPER }), 'merge');

    expect(JSON.stringify(sent)).not.toContain('data:');
    expect(sent?.heldWallpaperIds).toEqual(['new']);
    expect(JSON.stringify(summary)).not.toContain('data:');
    expect(summary.merged).toBeUndefined();
    expect(await storage.readWorkspaceWallpaper('new')).toBe(WALLPAPER);
  });

  it('writes the wallpaper of an incoming workspace paired with a local one under the local id', async () => {
    const { storage, transfer } = await load();
    const rootFolder = buildFolderLocator(TREE, '1') ?? undefined;
    await storage.writeWorkspace(record('aa-local', { name: 'Favorites', rootFolderId: '1', rootFolder, updatedAt: NOW - 1_000 }));

    await transfer.importWorkspaceFile(
      filePayload([record('zz-file', { name: 'Favorites', rootFolderId: '1', rootFolder, updatedAt: NOW - 500 })], { 'zz-file': WALLPAPER }),
      'merge',
    );

    expect((await storage.readWorkspaces()).map(w => w.id)).toEqual(['aa-local']);
    expect(await storage.readWorkspaceWallpaper('aa-local')).toBe(WALLPAPER);
    expect(await storage.readWorkspaceWallpaper('zz-file')).toBe('');
  });

  it('leaves the wallpaper of a workspace the user changed while the plan ran', async () => {
    const { storage, transfer } = await load();
    await storage.writeWorkspace(record('a', { updatedAt: NOW - 1_000 }));
    await storage.writeWorkspaceWallpaper('a', 'data:image/png;base64,TE9DQUw=');
    beforeTree = async () => {
      await storage.writeWorkspaceWallpaper('a', 'data:image/png;base64,VVNFUg==');
      await storage.patchWorkspaceFromUser('a', {});
    };

    await transfer.importWorkspaceFile(filePayload([record('a', { updatedAt: NOW - 500 })], { a: WALLPAPER }), 'merge');

    expect(await storage.readWorkspaceWallpaper('a')).toBe('data:image/png;base64,VVNFUg==');
  });
});
