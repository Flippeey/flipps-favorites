import type { BookmarkNode, DeletionMarker } from '@/shared/models';
import {
  deletePlannedBookmarkUsage,
  deletePlannedFolderIcon,
  deletePlannedIconOverride,
  deletePlannedPendingFolderIcon,
  deletePlannedWorkspace,
  readDeletionMarkers,
  removeWorkspaceWallpaper,
  updateFolderBindings,
  writeBookmarkUsageRecord,
  writePendingUsage,
  writePlannedDeletionMarkers,
  writePlannedFolderIcon,
  writePlannedIconOverride,
  writePlannedPendingFolderIcon,
  writePlannedSettings,
  writePlannedWorkspace,
  writeWorkspaceWallpaper,
} from '@/shared/storage';
import { planWorkspaceImport } from '@/shared/sync-plan';
import { legacyFolderIconSyncId, markerId, markersAddedSince } from '@/shared/sync-stamps';
import type {
  HeldWallpaperWrite,
  ImportOrigin,
  ParsedWorkspaceImport,
  WorkspaceImportMode,
  WorkspaceImportSummary,
} from '@/shared/sync-merge';

export interface WorkspaceImportDeps {
  loadTree: () => Promise<BookmarkNode[]>;
  invalidateIcons: () => Promise<void>;
}

// Stands in for a wallpaper the caller held back, so the planner still sees
// that the workspace has one. The NUL byte keeps it from ever equalling a
// stored data URL.
const heldWallpaperRef = (sourceId: string): string => `\u0000held-wallpaper:${sourceId}`;

// Executes the planner's result; decides nothing itself. Runs in the
// background so its writes share the storage queues with user edits, which
// only serialize within one JS context: anything changed while the plan ran
// (a workspace, a setting, an icon, a usage record, a marker) keeps that
// newer change.
//
// `heldWallpaperIds` names payload workspaces whose wallpaper the caller kept
// out of `payload`; the ones to store come back in `heldWallpaperWrites`.
export async function applyWorkspaceImport(
  payload: ParsedWorkspaceImport,
  mode: WorkspaceImportMode,
  origin: ImportOrigin,
  deps: WorkspaceImportDeps,
  heldWallpaperIds: readonly string[] = [],
): Promise<WorkspaceImportSummary> {
  const heldRefs = new Map(heldWallpaperIds.map(id => [heldWallpaperRef(id), id]));
  const withRefs: ParsedWorkspaceImport = heldRefs.size
    ? {
        ...payload,
        workspaceWallpapers: {
          ...payload.workspaceWallpapers,
          ...Object.fromEntries([...heldRefs].map(([ref, id]) => [id, ref])),
        },
      }
    : payload;
  const { local, plan } = await planWorkspaceImport(withRefs, mode, origin, deps.loadTree);
  const basisById = new Map(local.workspaces.map(w => [w.id, w]));

  const activeRekey = plan.rekeys.find(k => k.from === local.settings.activeWorkspaceId);
  const settings = plan.settingsChanged || activeRekey
    ? await writePlannedSettings(
        { ...plan.settings, ...(activeRekey ? { activeWorkspaceId: activeRekey.to } : {}) },
        local.settings.settingsUpdatedAt ?? {},
      )
    : local.settings;

  let workspaceCount = 0;
  let workspaceFailedCount = 0;
  // Workspaces a concurrent edit kept: their wallpaper is the edit's too.
  const keptLocal = new Set<string>();
  for (const record of plan.workspaceWrites) {
    try {
      if (await writePlannedWorkspace(record, basisById.get(record.id))) workspaceCount += 1;
      else keptLocal.add(record.id);
    } catch (error) {
      // Quota or other storage failure mid-loop: keep going so later entries
      // still get a chance, and report what failed.
      workspaceFailedCount += 1;
      console.warn('Failed to store an imported workspace.', error);
    }
  }
  const heldWallpaperWrites: HeldWallpaperWrite[] = [];
  for (const { id, dataUrl } of plan.wallpaperWrites) {
    if (keptLocal.has(id)) continue;
    const sourceId = heldRefs.get(dataUrl);
    if (sourceId !== undefined) {
      heldWallpaperWrites.push({ workspaceId: id, sourceId });
      continue;
    }
    try {
      await writeWorkspaceWallpaper(id, dataUrl);
    } catch (error) {
      console.warn('Failed to store an imported wallpaper.', error);
    }
  }
  // Only the workspace record and its wallpaper go; bookmarks are never touched.
  const deleted = new Set<string>();
  for (const id of plan.workspaceDeletes) {
    try {
      if (!(await deletePlannedWorkspace(id, basisById.get(id)))) continue;
      deleted.add(id);
      await removeWorkspaceWallpaper(id);
    } catch (error) {
      console.warn('Failed to remove a workspace during import.', error);
    }
  }
  await updateFolderBindings(current => ({
    ...Object.fromEntries(Object.entries(current).filter(([id]) => !deleted.has(id))),
    ...plan.bindingWrites,
  }));

  // An icon the user set and removed again while the plan ran is absent from
  // storage, just as when the plan read it; only its fresh marker tells.
  const lateMarkers = new Set(
    markersAddedSince(await readDeletionMarkers(), local.deletions).map(m => markerId(m.kind, m.key)),
  );
  const deletedMeanwhile = (kind: DeletionMarker['kind'], key: string): boolean => lateMarkers.has(markerId(kind, key));
  const folderIconKey = (r: { folderId: string; syncId?: string }): string => r.syncId ?? legacyFolderIconSyncId(r.folderId);

  const basisOverrides = new Map(local.iconOverrides.map(r => [r.overrideKey, r]));
  let iconOverrideCount = 0;
  let overrideDeleteCount = 0;
  for (const record of plan.overrideWrites) {
    if (deletedMeanwhile('iconOverride', record.overrideKey)) continue;
    if (await writePlannedIconOverride(record, basisOverrides.get(record.overrideKey))) iconOverrideCount += 1;
  }
  for (const key of plan.overrideDeletes) {
    if (await deletePlannedIconOverride(key, basisOverrides.get(key))) overrideDeleteCount += 1;
  }

  const basisFolderIcons = new Map(local.folderIcons.map(r => [r.folderId, r]));
  const basisPending = new Map(local.pendingFolderIcons.map(r => [r.syncId ?? '', r]));
  let folderIconCount = 0;
  for (const record of plan.folderIconWrites) {
    if (deletedMeanwhile('folderIcon', folderIconKey(record))) continue;
    if (await writePlannedFolderIcon(record, basisFolderIcons.get(record.folderId))) folderIconCount += 1;
  }
  for (const folderId of plan.folderIconDeletes) await deletePlannedFolderIcon(folderId, basisFolderIcons.get(folderId));
  for (const record of plan.pendingFolderIconWrites) {
    if (deletedMeanwhile('folderIcon', folderIconKey(record))) continue;
    if (await writePlannedPendingFolderIcon(record, basisPending.get(record.syncId ?? ''))) folderIconCount += 1;
  }
  for (const syncId of plan.pendingFolderIconDeletes) await deletePlannedPendingFolderIcon(syncId, basisPending.get(syncId));

  const basisUsage = new Map(local.usage.map(r => [r.bookmarkId, r.usedAt]));
  for (const record of plan.usageWrites) await writeBookmarkUsageRecord(record);
  for (const bookmarkId of plan.usageDeletes) await deletePlannedBookmarkUsage(bookmarkId, basisUsage.get(bookmarkId));
  await writePendingUsage(plan.pendingUsage);
  await writePlannedDeletionMarkers(local.deletions, plan.deletions);

  if (iconOverrideCount + overrideDeleteCount > 0) {
    try {
      await deps.invalidateIcons();
    } catch (error) {
      // Cached icons refresh on the next page load anyway.
      console.warn('Icon cache invalidation failed after import.', error);
    }
  }

  return {
    mode,
    workspaceCount,
    workspaceSkippedCount: plan.workspaceSkippedCount,
    workspaceFailedCount,
    iconOverrideCount,
    iconOverrideSkippedCount: payload.skipped.oversizedDataUrlCount,
    folderIconCount,
    bookmarkUsageCount: plan.usageWrites.length,
    settings,
    heldWallpaperWrites,
    ...(origin === 'sync' ? { merged: plan.merged } : {}),
  };
}
