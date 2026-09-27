import type { BookmarkNode } from './models';
import {
  defaultSettings,
  readAllFolderIconOverrides,
  readBookmarkUsageRecords,
  readDeletionMarkers,
  readFolderBindings,
  readIconOverrideRecords,
  readPendingFolderIcons,
  readPendingUsage,
  readSettings,
  readWorkspaces,
  readStoredWorkspaceWallpaper,
  withoutPerBrowserSettings,
} from './storage';
import {
  planIncomingWorkspaces,
  type ImportOrigin,
  type LocalSyncSnapshot,
  type SyncPlan,
  type WorkspaceExportPayload,
  type WorkspaceImportMode,
  type WorkspaceWallpaperMap,
} from './sync-merge';

// Read-only planning shared by the page (export, link preview) and the
// background (apply). How the bookmark tree is read differs per context, so
// the caller supplies it.

export async function readLocalSnapshot(): Promise<LocalSyncSnapshot> {
  const [settings, workspaces, overrides, folderIcons, usage, deletions, bindings, pendingFolderIcons, pendingUsage] = await Promise.all([
    readSettings(),
    readWorkspaces(),
    readIconOverrideRecords(),
    readAllFolderIconOverrides(),
    readBookmarkUsageRecords(),
    readDeletionMarkers(),
    readFolderBindings(),
    readPendingFolderIcons(),
    readPendingUsage(),
  ]);
  const wallpapers: WorkspaceWallpaperMap = {};
  for (const ws of workspaces.filter(w => w.backgroundMode === 'wallpaper')) {
    const dataUrl = await readStoredWorkspaceWallpaper(ws.id);
    if (dataUrl !== null) wallpapers[ws.id] = dataUrl;
  }
  return {
    settings,
    workspaces,
    wallpapers,
    iconOverrides: Object.values(overrides),
    folderIcons: Object.values(folderIcons),
    usage: Object.values(usage),
    deletions,
    bindings,
    pendingFolderIcons,
    pendingUsage,
  };
}

export async function planWorkspaceImport(
  payload: WorkspaceExportPayload,
  mode: WorkspaceImportMode,
  origin: ImportOrigin,
  loadTree: () => Promise<BookmarkNode[]>,
): Promise<{ local: LocalSyncSnapshot; plan: SyncPlan }> {
  // Best-effort tree fetch for finding folders here and identity pairing. A
  // failed fetch must not fail the import: nothing new is placed, and the
  // next page load resolves what it can.
  let tree: BookmarkNode[] | null = null;
  const [local] = await Promise.all([
    readLocalSnapshot(),
    loadTree().then(nodes => { tree = nodes; }, (error: unknown) => {
      console.warn('Bookmark tree unavailable; imported items wait for their folders.', error);
    }),
  ]);
  const { settingsUpdatedAt: _stamps, ...defaults } = withoutPerBrowserSettings(defaultSettings);
  const plan = planIncomingWorkspaces(payload, local, { mode, origin, tree, now: Date.now(), defaults });
  return { local, plan };
}
