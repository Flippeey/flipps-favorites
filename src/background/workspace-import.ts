import type { BookmarkNode } from '@/shared/models';
import {
  deleteBookmarkUsageRecord,
  deleteFolderIconOverride,
  deleteIconOverrideRecord,
  deletePendingFolderIcon,
  deletePlannedWorkspace,
  removeWorkspaceWallpaper,
  updateFolderBindings,
  writeBookmarkUsageRecord,
  writeFolderIconOverride,
  writeIconOverrideRecord,
  writePendingFolderIcon,
  writePendingUsage,
  writePlannedDeletionMarkers,
  writePlannedWorkspace,
  writeSettings,
  writeWorkspaceWallpaper,
} from '@/shared/storage';
import { planWorkspaceImport } from '@/shared/sync-plan';
import type { ImportOrigin, ParsedWorkspaceImport, WorkspaceImportMode, WorkspaceImportSummary } from '@/shared/sync-merge';

export interface WorkspaceImportDeps {
  loadTree: () => Promise<BookmarkNode[]>;
  invalidateIcons: () => Promise<void>;
}

// Executes the planner's result; decides nothing itself. Runs in the
// background so its writes share the storage queues with user edits, which
// only serialize within one JS context: a workspace or marker changed while
// the plan ran keeps that newer change.
export async function applyWorkspaceImport(
  payload: ParsedWorkspaceImport,
  mode: WorkspaceImportMode,
  origin: ImportOrigin,
  deps: WorkspaceImportDeps,
): Promise<WorkspaceImportSummary> {
  const { local, plan } = await planWorkspaceImport(payload, mode, origin, deps.loadTree);
  const basisById = new Map(local.workspaces.map(w => [w.id, w]));

  const activeRekey = plan.rekeys.find(k => k.from === local.settings.activeWorkspaceId);
  const settings = plan.settingsChanged || activeRekey
    ? await writeSettings({ ...plan.settings, ...(activeRekey ? { activeWorkspaceId: activeRekey.to } : {}) })
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
  for (const { id, dataUrl } of plan.wallpaperWrites) {
    if (keptLocal.has(id)) continue;
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

  for (const record of plan.overrideWrites) await writeIconOverrideRecord(record);
  for (const key of plan.overrideDeletes) await deleteIconOverrideRecord(key);
  for (const record of plan.folderIconWrites) await writeFolderIconOverride(record);
  for (const folderId of plan.folderIconDeletes) await deleteFolderIconOverride(folderId);
  for (const record of plan.pendingFolderIconWrites) await writePendingFolderIcon(record);
  for (const syncId of plan.pendingFolderIconDeletes) await deletePendingFolderIcon(syncId);
  for (const record of plan.usageWrites) await writeBookmarkUsageRecord(record);
  for (const bookmarkId of plan.usageDeletes) await deleteBookmarkUsageRecord(bookmarkId);
  await writePendingUsage(plan.pendingUsage);
  await writePlannedDeletionMarkers(local.deletions, plan.deletions);

  if (plan.overrideWrites.length || plan.overrideDeletes.length) {
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
    iconOverrideCount: plan.overrideWrites.length,
    iconOverrideSkippedCount: payload.skipped.oversizedDataUrlCount,
    folderIconCount: plan.folderIconWrites.length + plan.pendingFolderIconWrites.length,
    bookmarkUsageCount: plan.usageWrites.length,
    settings,
    merged: plan.merged,
  };
}
