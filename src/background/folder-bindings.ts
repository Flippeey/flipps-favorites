import type { BookmarkNode, FolderBinding, WorkspaceRecord, WorkspaceView } from '@/shared/models';
import {
  addDeletionMarkers,
  deletePendingFolderIcon,
  markBindingsBackfilled,
  readBindingsBackfilled,
  readBookmarkUsageRecords,
  readFolderBindings,
  readFolderIconOverride,
  readNotUsedWorkspaceIds,
  readPendingFolderIcons,
  readPendingUsage,
  readWorkspaces,
  updateFolderBindings,
  writeBookmarkUsageRecord,
  writeFolderIconOverride,
  writePendingUsage,
} from '@/shared/storage';
import { compareFolderIcons, retiredFolderIconMarker } from '@/shared/sync-stamps';
import { folderExists, locatorHash, resolveFolder, uniqueBookmarkForUrl } from '@/newtab/lib/folder-locator';

// A workspace as this browser shows it. Only a bound binding yields a folder:
// the synced rootFolderId names a folder in some other browser and is never
// shown as-is.
export function overlayWorkspace(record: WorkspaceRecord, bindings: Record<string, FolderBinding>, notUsed: string[]): WorkspaceView {
  const binding = bindings[record.id];
  if (notUsed.includes(record.id)) return { ...record, rootFolderId: '', folderState: 'unused' };
  if (binding?.state === 'bound') return { ...record, rootFolderId: binding.localId };
  return { ...record, rootFolderId: '', folderState: binding ? 'lost' : 'waiting' };
}

// One-time, for records stored before bindings existed: this browser already
// showed their rootFolderId, so it keeps showing it.
export function backfillBindings(
  records: WorkspaceRecord[],
  bindings: Record<string, FolderBinding>,
  tree: BookmarkNode[],
): Record<string, FolderBinding> {
  const added = records
    .filter(r => !bindings[r.id] && folderExists(tree, r.rootFolderId))
    .map(r => [r.id, { localId: r.rootFolderId, locatorHash: locatorHash(r.rootFolder), state: 'bound' as const }]);
  return { ...bindings, ...Object.fromEntries(added) };
}

// One resolution pass. A found folder binds; a bound folder that vanished
// turns lost and keeps being looked for; a binding made for an older locator
// is dropped, so the record waits rather than showing the old folder.
export function nextBindings(
  records: WorkspaceRecord[],
  bindings: Record<string, FolderBinding>,
  tree: BookmarkNode[],
): Record<string, FolderBinding> {
  const next = { ...bindings };
  for (const record of records) {
    const binding = bindings[record.id];
    const hash = locatorHash(record.rootFolder);
    const localId = resolveFolder(record.rootFolder, tree, { binding, hintId: record.rootFolderId, title: record.name });
    if (localId) next[record.id] = { localId, locatorHash: hash, state: 'bound' };
    else if (binding && binding.locatorHash !== hash) delete next[record.id];
    else if (binding) next[record.id] = { ...binding, state: 'lost' };
  }
  return next;
}

export async function resolveFolderBindings(tree: BookmarkNode[]): Promise<void> {
  const records = await readWorkspaces();
  if (!(await readBindingsBackfilled())) {
    await updateFolderBindings(current => backfillBindings(records, current, tree));
    await markBindingsBackfilled();
  }
  await updateFolderBindings(current => nextBindings(records, current, tree));
  await placePendingFolderIcons(tree);
  await placePendingUsage(tree);
}

async function placePendingFolderIcons(tree: BookmarkNode[]): Promise<void> {
  for (const pending of await readPendingFolderIcons()) {
    const folderId = resolveFolder(pending.locator, tree, { hintId: pending.folderId });
    if (!folderId) continue;
    const placed = { ...pending, folderId };
    const holder = await readFolderIconOverride(folderId);
    const [keeper, retired] = holder && holder.syncId !== placed.syncId
      ? [holder, placed].sort(compareFolderIcons)
      : [placed, null];
    if (retired) await addDeletionMarkers([retiredFolderIconMarker(keeper, retired)]);
    if (keeper === placed) await writeFolderIconOverride(placed);
    await deletePendingFolderIcon(pending.syncId ?? '');
  }
}

async function placePendingUsage(tree: BookmarkNode[]): Promise<void> {
  const pending = await readPendingUsage();
  const entries = Object.entries(pending);
  if (!entries.length) return;
  const stored = await readBookmarkUsageRecords();
  const rest: Record<string, number> = {};
  for (const [url, usedAt] of entries) {
    const bookmarkId = uniqueBookmarkForUrl(tree, url);
    if (!bookmarkId) rest[url] = usedAt;
    else if ((stored[bookmarkId]?.usedAt ?? 0) < usedAt) await writeBookmarkUsageRecord({ bookmarkId, usedAt });
  }
  await writePendingUsage(rest);
}

export async function readWorkspaceViews(): Promise<WorkspaceView[]> {
  const [records, bindings, notUsed] = await Promise.all([readWorkspaces(), readFolderBindings(), readNotUsedWorkspaceIds()]);
  return records.map(record => overlayWorkspace(record, bindings, notUsed));
}
