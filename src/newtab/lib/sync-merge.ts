import type {
  AppSettings,
  BookmarkNode,
  BookmarkUsageRecord,
  DeletionMarker,
  DeletionMarkerKind,
  FolderIconOverrideRecord,
  FolderLocator,
  IconOverrideRecord,
  SettingsStamps,
  SyncedSettingKey,
  SyncedSettings,
  WorkspaceRecord,
} from '@/shared/models';
import { getOverrideKeyForScope, normalizeOverrideScope, type IconOverrideScope } from '@/shared/icon-scope';
import { MAX_WORKSPACES } from '@/shared/constants';
import { compareText, legacyFolderIconSyncId, markerId, nextStamp, pruneDeletionMarkers, readStamp, sameValue } from '@/shared/sync-stamps';
import { findFolder, isFolder } from './tree';

export const WORKSPACE_SCHEMA = 'flipps-workspace-transfer' as const;
// v3: per-workspace view/sort. v4: folder custom icons. v5: stamps, deletion
// markers, folder-icon syncId; per-browser settings and usage bookmark ids
// no longer required.
export const WORKSPACE_SCHEMA_VERSION = 5;

export type WorkspaceImportMode = 'merge' | 'replace';
// 'sync' covers Sync now and the link flow; 'file' is a backup file.
export type ImportOrigin = 'file' | 'sync';

export interface IconOverrideTransferRecord {
  bookmarkUrl: string;
  dataUrl: string;
  fileName: string;
  mimeType: string;
  updatedAt: number;
  // Absent in exports made before scoped overrides existed — treated as 'exact'.
  scope?: IconOverrideScope;
}

export interface FolderIconTransferRecord {
  folderId: string;
  dataUrl: string;
  fileName?: string;
  mimeType: string;
  updatedAt: number;
  syncId: string;
  locator?: FolderLocator;
}

export interface BookmarkUsageTransferRecord {
  bookmarkId?: string;
  url?: string;
  usedAt: number;
}

// Wallpapers can be MBs of data URL, so they travel as a sidecar map keyed by
// workspace id rather than inside WorkspaceRecord.
export type WorkspaceWallpaperMap = Record<string, string>;

export interface WorkspaceExportPayload {
  schema: typeof WORKSPACE_SCHEMA;
  schemaVersion: number;
  exportedAt: number;
  settings: Partial<SyncedSettings>;
  settingsUpdatedAt?: SettingsStamps;
  workspaces: WorkspaceRecord[];
  workspaceWallpapers: WorkspaceWallpaperMap;
  iconOverrides: IconOverrideTransferRecord[];
  folderIcons: FolderIconTransferRecord[];
  bookmarkUsage: BookmarkUsageTransferRecord[];
  // Sync payloads only: a backup file is a snapshot, not a deletion log.
  deletions?: DeletionMarker[];
}

export interface LocalSyncSnapshot {
  settings: AppSettings;
  workspaces: WorkspaceRecord[];
  wallpapers: WorkspaceWallpaperMap;
  iconOverrides: IconOverrideRecord[];
  folderIcons: FolderIconOverrideRecord[];
  usage: BookmarkUsageRecord[];
  deletions: DeletionMarker[];
}

export interface PlanContext {
  mode: WorkspaceImportMode;
  origin: ImportOrigin;
  tree: BookmarkNode[] | null;
  now: number;
  defaults: SyncedSettings;
}

export type PlannedSettings = SyncedSettings & { settingsUpdatedAt: SettingsStamps };

export interface SyncPlan {
  settings: PlannedSettings;
  settingsChanged: boolean;
  workspaceWrites: WorkspaceRecord[];
  // Includes the old ids of re-keyed workspaces.
  workspaceDeletes: string[];
  rekeys: Array<{ from: string; to: string }>;
  wallpaperWrites: Array<{ id: string; dataUrl: string }>;
  newWorkspaceNames: string[];
  updatedWorkspaceNames: string[];
  removedWorkspaceNames: string[];
  // Local workspaces whose version the merged copy carries to other browsers.
  outboundWorkspaceNames: string[];
  // New workspaces beyond MAX_WORKSPACES: not stored here, kept in `merged`.
  workspaceSkippedCount: number;
  overrideWrites: IconOverrideRecord[];
  overrideDeletes: string[];
  folderIconWrites: FolderIconOverrideRecord[];
  folderIconDeletes: string[];
  usageWrites: BookmarkUsageRecord[];
  usageDeletes: string[];
  deletions: DeletionMarker[];
  // The shared copy to push: every winner, including ones not stored here.
  merged: WorkspaceExportPayload;
}

interface Winner<T> {
  record: T;
  fromRemote: boolean;
}

const workspaceStamp = (record: { updatedAt?: number }): number => readStamp(record.updatedAt);

// Newest stamp wins. A record beats a marker at an equal stamp (a resurrected
// item can be deleted again, a lost one can't come back); between two records
// an equal stamp goes to the server copy, so every browser converges.
export function pickWinner<T>(
  local: T | undefined,
  remote: T | undefined,
  stamp: (record: T) => number,
  marker: DeletionMarker | undefined,
): Winner<T> | null {
  const fromRemote = remote !== undefined && (local === undefined || stamp(remote) >= stamp(local));
  const record = fromRemote ? remote : local;
  if (record === undefined) return null;
  if (marker && marker.deletedAt > stamp(record)) return null;
  return { record, fromRemote };
}

// Single pure planner for every item kind, behind Sync now, the link flow,
// the link preview and file import. Modes:
// - sync merge: newest wins per item and per setting, markers travel, and a
//   workspace created separately on both sides converges on the smaller id;
// - sync replace (link): mirror of the incoming copy, stamps kept, no markers;
// - file merge: newest wins against this browser's own markers;
// - file replace: the file's values win and are stamped now; workspaces are
//   never deleted.
export function planIncomingWorkspaces(
  payload: WorkspaceExportPayload,
  local: LocalSyncSnapshot,
  ctx: PlanContext,
): SyncPlan {
  const syncMerge = ctx.origin === 'sync' && ctx.mode === 'merge';
  const mirror = ctx.origin === 'sync' && ctx.mode === 'replace';
  const fileReplace = ctx.origin === 'file' && ctx.mode === 'replace';

  const markers = new Map<string, DeletionMarker>();
  const addMarker = (marker: DeletionMarker): void => {
    const id = markerId(marker.kind, marker.key);
    const existing = markers.get(id);
    if (!existing || marker.deletedAt > existing.deletedAt) markers.set(id, marker);
  };
  if (!mirror) {
    const incoming = syncMerge ? payload.deletions ?? [] : [];
    pruneDeletionMarkers([...local.deletions, ...incoming], ctx.now).forEach(addMarker);
  }
  const markerFor = (kind: DeletionMarkerKind, key: string): DeletionMarker | undefined => markers.get(markerId(kind, key));
  const restamp = (previous: number | undefined, kind: DeletionMarkerKind, key: string): number =>
    nextStamp(Math.max(readStamp(previous), markerFor(kind, key)?.deletedAt ?? 0), ctx.now);
  const pick = <T>(l: T | undefined, r: T | undefined, stamp: (record: T) => number, kind: DeletionMarkerKind, key: string): Winner<T> | null =>
    mirror ? (r === undefined ? null : { record: r, fromRemote: true }) : pickWinner(l, r, stamp, markerFor(kind, key));

  // Workspaces
  const storedById = new Map(local.workspaces.map(w => [w.id, w]));
  const localById = new Map(storedById);
  const localWallpapers = new Map(Object.entries(local.wallpapers));
  const remoteById = newestByKey(payload.workspaces, w => w.id, workspaceStamp);
  const remoteOrigin = new Map<string, string>();
  const renamed = new Map<string, string>();
  const rekeys: Array<{ from: string; to: string }> = [];
  const resolve = (record: WorkspaceRecord): WorkspaceRecord =>
    ctx.tree ? rematchRootFolder(record, ctx.tree, localById) : record;

  // Identity: an incoming workspace with an unknown id that matches exactly
  // one local workspace (same name, same folder here) is that workspace under
  // a second id, e.g. onboarding's "Favorites" created on both browsers.
  const paired = new Set<string>();
  for (const incoming of [...remoteById.values()]) {
    if (localById.has(incoming.id)) continue;
    const marker = markerFor('workspace', incoming.id);
    if (!mirror && marker && marker.deletedAt > workspaceStamp(incoming)) continue;
    const folderId = resolve(incoming).rootFolderId;
    const matches = [...localById.values()].filter(w =>
      !paired.has(w.id) && !remoteById.has(w.id) && w.name === incoming.name && w.rootFolderId === folderId);
    if (matches.length !== 1) continue;
    const [match] = matches;
    const keep = syncMerge
      ? (compareText(match.id, incoming.id) <= 0 ? match.id : incoming.id)
      : ctx.origin === 'file' ? match.id : incoming.id;
    paired.add(keep);
    if (keep === incoming.id) {
      localById.delete(match.id);
      localById.set(keep, { ...match, id: keep });
      const wallpaper = localWallpapers.get(match.id);
      if (wallpaper) localWallpapers.set(keep, wallpaper);
      rekeys.push({ from: match.id, to: keep });
      renamed.set(match.id, keep);
      if (syncMerge) addMarker({ kind: 'workspace', key: match.id, deletedAt: nextStamp(match.updatedAt, ctx.now) });
    } else {
      remoteById.delete(incoming.id);
      remoteById.set(keep, { ...incoming, id: keep });
      remoteOrigin.set(keep, incoming.id);
      renamed.set(incoming.id, keep);
      if (syncMerge) addMarker({ kind: 'workspace', key: incoming.id, deletedAt: nextStamp(incoming.updatedAt, ctx.now) });
    }
  }
  if (fileReplace) {
    for (const [id, record] of remoteById) {
      remoteById.set(id, { ...record, updatedAt: restamp(localById.get(id)?.updatedAt, 'workspace', id) });
    }
  }

  const winners = new Map<string, Winner<WorkspaceRecord>>();
  for (const id of new Set([...localById.keys(), ...remoteById.keys()])) {
    const winner = pick(localById.get(id), remoteById.get(id), workspaceStamp, 'workspace', id);
    if (winner) winners.set(id, winner);
  }

  // Only genuinely new ids take a slot; the rest wait in the shared copy.
  let slots = Math.max(0, MAX_WORKSPACES - [...winners.keys()].filter(id => localById.has(id)).length);
  const skipped = new Set<string>();
  for (const id of remoteById.keys()) {
    if (!winners.has(id) || localById.has(id)) continue;
    if (slots > 0) slots -= 1;
    else skipped.add(id);
  }

  const workspaceWrites: WorkspaceRecord[] = [];
  const wallpaperWrites: Array<{ id: string; dataUrl: string }> = [];
  const mergedWallpapers: WorkspaceWallpaperMap = {};
  const names = { added: [] as string[], updated: [] as string[], removed: [] as string[], outbound: [] as string[] };
  for (const [id, { record, fromRemote }] of winners) {
    const remoteWallpaper = payload.workspaceWallpapers[remoteOrigin.get(id) ?? id];
    const wallpaper = fromRemote ? remoteWallpaper ?? localWallpapers.get(id) : localWallpapers.get(id) ?? remoteWallpaper;
    const hasWallpaper = record.backgroundMode === 'wallpaper' && wallpaper !== undefined;
    if (hasWallpaper) mergedWallpapers[id] = wallpaper;
    if (!fromRemote && !sameValue(remoteById.get(id), record)) names.outbound.push(record.name);
    if (skipped.has(id)) continue;
    const form = fromRemote ? resolve(record) : record;
    if (!sameValue(storedById.get(id), form)) {
      workspaceWrites.push(form);
      if (!localById.has(id)) names.added.push(form.name);
      else if (fromRemote) names.updated.push(form.name);
    }
    if (hasWallpaper && local.wallpapers[id] !== wallpaper) wallpaperWrites.push({ id, dataUrl: wallpaper });
  }
  const workspaceDeletes = rekeys.map(k => k.from);
  for (const stored of local.workspaces) {
    if (renamed.has(stored.id) || winners.has(stored.id)) continue;
    workspaceDeletes.push(stored.id);
    names.removed.push(stored.name);
  }

  // Settings, per key
  const keys = Object.keys(ctx.defaults) as SyncedSettingKey[];
  const localStamps = local.settings.settingsUpdatedAt ?? {};
  const remoteStamps = payload.settingsUpdatedAt ?? {};
  const values: Record<string, unknown> = {};
  const stamps: SettingsStamps = {};
  const renameIds = (order: unknown): unknown =>
    Array.isArray(order) ? order.map(id => renamed.get(id as string) ?? id) : order;
  for (const key of keys) {
    const localValue = key === 'workspaceOrder' ? renameIds(local.settings[key]) : local.settings[key];
    const hasRemote = payload.settings[key] !== undefined;
    const remoteValue = key === 'workspaceOrder' ? renameIds(payload.settings[key]) : payload.settings[key];
    const localStamp = readStamp(localStamps[key]);
    const remoteStamp = readStamp(remoteStamps[key]);
    let value: unknown;
    let stamp: number;
    if (mirror || fileReplace) {
      value = hasRemote ? remoteValue : ctx.defaults[key];
      stamp = fileReplace ? nextStamp(localStamp, ctx.now) : remoteStamp;
    } else if (hasRemote && remoteStamp >= localStamp) {
      value = remoteValue;
      stamp = remoteStamp;
    } else {
      value = localValue;
      stamp = localStamp;
    }
    values[key] = value;
    if (stamp > 0) stamps[key] = stamp;
  }
  const order = (values.workspaceOrder as string[] | undefined) ?? [];
  const orderFor = (live: string[]): string[] => {
    const liveSet = new Set(live);
    const kept = [...new Set(order)].filter(id => liveSet.has(id));
    const keptSet = new Set(kept);
    const missing = live.filter(id => !keptSet.has(id)).sort((a, b) =>
      workspaceStamp(winners.get(a)?.record ?? {}) - workspaceStamp(winners.get(b)?.record ?? {}) || compareText(a, b));
    return [...kept, ...missing];
  };
  const settings = {
    ...values,
    workspaceOrder: orderFor([...winners.keys()].filter(id => !skipped.has(id))),
    settingsUpdatedAt: stamps,
  } as PlannedSettings;
  const localSettings = Object.fromEntries(keys.map(key => [key, local.settings[key]]));
  const settingsChanged = !sameValue({ ...localSettings, settingsUpdatedAt: localStamps }, settings);

  // Icon overrides, keyed by override key
  const storedOverrides = new Map(local.iconOverrides.map(r => [r.overrideKey, r]));
  const localOverrides = fileReplace ? new Map<string, IconOverrideRecord>() : storedOverrides;
  const remoteOverrides = newestByKey(payload.iconOverrides.map(toOverrideRecord), r => r.overrideKey, r => readStamp(r.updatedAt));
  if (fileReplace) {
    for (const [key, record] of remoteOverrides) {
      remoteOverrides.set(key, { ...record, updatedAt: restamp(storedOverrides.get(key)?.updatedAt, 'iconOverride', key) });
    }
  }
  const overrideWinners = [...new Set([...localOverrides.keys(), ...remoteOverrides.keys()])]
    .map(key => pick(localOverrides.get(key), remoteOverrides.get(key), r => readStamp(r.updatedAt), 'iconOverride', key))
    .filter((w): w is Winner<IconOverrideRecord> => w !== null)
    .map(w => w.record);
  const overrideKeys = new Set(overrideWinners.map(r => r.overrideKey));

  // Folder icons, keyed by syncId; the local copy lives under its folder id.
  const storedFolderIcons = new Map(local.folderIcons.map(r => [r.folderId, r]));
  const storedBySyncId = newestByKey(local.folderIcons.map(withSyncId), r => r.syncId ?? '', r => readStamp(r.updatedAt));
  const localFolderIcons = fileReplace ? new Map<string, FolderIconOverrideRecord>() : storedBySyncId;
  // Payloads from before folder icons existed (v3 and earlier) have no list.
  const remoteFolderIcons = newestByKey((payload.folderIcons ?? []).map(toFolderIconRecord), r => r.syncId ?? '', r => readStamp(r.updatedAt));
  if (fileReplace) {
    for (const [key, record] of remoteFolderIcons) {
      remoteFolderIcons.set(key, { ...record, updatedAt: restamp(storedBySyncId.get(key)?.updatedAt, 'folderIcon', key) });
    }
  }
  const folderWinners = [...new Set([...localFolderIcons.keys(), ...remoteFolderIcons.keys()])]
    .map(key => pick(localFolderIcons.get(key), remoteFolderIcons.get(key), r => readStamp(r.updatedAt), 'folderIcon', key))
    .filter((w): w is Winner<FolderIconOverrideRecord> => w !== null)
    .map(w => w.record);
  // Two icons for one folder: the newer keeps it (an exact tie goes to the
  // smaller syncId); a sync merge retires the other with a marker every
  // browser stamps the same way.
  const byFolder = new Map<string, FolderIconOverrideRecord>();
  const retired = new Set<FolderIconOverrideRecord>();
  for (const record of [...folderWinners].sort(compareFolderIcons)) {
    const holder = byFolder.get(record.folderId);
    if (!holder) {
      byFolder.set(record.folderId, record);
      continue;
    }
    if (syncMerge) {
      retired.add(record);
      addMarker({
        kind: 'folderIcon',
        key: record.syncId ?? '',
        deletedAt: Math.max(readStamp(holder.updatedAt), readStamp(record.updatedAt) + 1),
      });
    }
  }

  // Usage: the latest use wins; entries without a bookmark id only travel.
  const usageKey = (r: BookmarkUsageTransferRecord): string => (r.bookmarkId ? r.bookmarkId : `url:${r.url ?? ''}`);
  const storedUsage = new Map(local.usage.map(r => [r.bookmarkId, r.usedAt]));
  const mergedUsage = new Map<string, BookmarkUsageTransferRecord>();
  const addUsage = (r: BookmarkUsageTransferRecord): void => {
    const key = usageKey(r);
    if ((mergedUsage.get(key)?.usedAt ?? 0) < r.usedAt) mergedUsage.set(key, r);
  };
  if (!mirror) local.usage.forEach(r => addUsage({ bookmarkId: r.bookmarkId, usedAt: r.usedAt }));
  if (!fileReplace) payload.bookmarkUsage.forEach(addUsage);
  const usageRecords = [...mergedUsage.values()].filter((r): r is BookmarkUsageRecord => typeof r.bookmarkId === 'string');
  const usageIds = new Set(usageRecords.map(r => r.bookmarkId));

  const deletions = mirror
    ? pruneDeletionMarkers(payload.deletions ?? [], ctx.now)
    : pruneDeletionMarkers([...markers.values()], ctx.now);
  const localFolderWinners = [...byFolder.values()];
  const { settingsUpdatedAt: _stamps, ...syncedValues } = settings;
  const liveFolderIds = new Set(localFolderWinners.map(r => r.folderId));

  return {
    settings,
    settingsChanged,
    workspaceWrites,
    workspaceDeletes,
    rekeys,
    wallpaperWrites,
    newWorkspaceNames: names.added,
    updatedWorkspaceNames: names.updated,
    removedWorkspaceNames: names.removed,
    outboundWorkspaceNames: names.outbound,
    workspaceSkippedCount: skipped.size,
    overrideWrites: overrideWinners.filter(r => !sameValue(storedOverrides.get(r.overrideKey), r)),
    overrideDeletes: [...storedOverrides.keys()].filter(key => !overrideKeys.has(key)),
    folderIconWrites: localFolderWinners.filter(r => !sameValue(storedFolderIcons.get(r.folderId), r)),
    folderIconDeletes: [...storedFolderIcons.keys()].filter(id => !liveFolderIds.has(id)),
    usageWrites: usageRecords.filter(r => storedUsage.get(r.bookmarkId) !== r.usedAt),
    usageDeletes: [...storedUsage.keys()].filter(id => !usageIds.has(id)),
    deletions,
    merged: {
      schema: WORKSPACE_SCHEMA,
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      exportedAt: ctx.now,
      settings: { ...syncedValues, workspaceOrder: orderFor([...winners.keys()]) },
      settingsUpdatedAt: stamps,
      workspaces: [...winners.values()].map(w => w.record),
      workspaceWallpapers: mergedWallpapers,
      iconOverrides: overrideWinners.map(toOverrideTransfer),
      folderIcons: folderWinners.filter(r => !retired.has(r)).map(toFolderIconTransfer),
      bookmarkUsage: [...mergedUsage.values()],
      deletions,
    },
  };
}

// Replace is preselected only while every local workspace and setting is
// untouched onboarding output, i.e. stamped no later than onboarding ended.
export function recommendLinkMode(local: LocalSyncSnapshot, onboardedAt: number | null): WorkspaceImportMode {
  const cutoff = onboardedAt ?? 0;
  if (cutoff <= 0) return 'merge';
  const untouched = local.workspaces.every(w => workspaceStamp(w) > 0 && workspaceStamp(w) <= cutoff);
  const settingsUntouched = Object.values(local.settings.settingsUpdatedAt ?? {}).every(s => readStamp(s) <= cutoff);
  return untouched && settingsUntouched ? 'replace' : 'merge';
}

function withSyncId(record: FolderIconOverrideRecord): FolderIconOverrideRecord {
  return record.syncId ? record : { ...record, syncId: legacyFolderIconSyncId(record.folderId) };
}

function compareFolderIcons(a: FolderIconOverrideRecord, b: FolderIconOverrideRecord): number {
  return readStamp(b.updatedAt) - readStamp(a.updatedAt) || compareText(a.syncId ?? '', b.syncId ?? '');
}

function newestByKey<T>(items: T[], keyOf: (item: T) => string, stamp: (item: T) => number): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    const key = keyOf(item);
    const existing = map.get(key);
    if (!existing || stamp(item) > stamp(existing)) map.set(key, item);
  }
  return map;
}

function toOverrideRecord(record: IconOverrideTransferRecord): IconOverrideRecord {
  const scope = normalizeOverrideScope(record.scope);
  const overrideKey = getOverrideKeyForScope(record.bookmarkUrl, scope) ?? `exact:${record.bookmarkUrl}`;
  return {
    overrideKey,
    scope: overrideKey.startsWith('exact:') ? 'exact' : scope,
    bookmarkUrl: record.bookmarkUrl,
    dataUrl: record.dataUrl,
    fileName: record.fileName,
    mimeType: record.mimeType,
    updatedAt: record.updatedAt,
  };
}

export function toOverrideTransfer(record: IconOverrideRecord): IconOverrideTransferRecord {
  return {
    bookmarkUrl: record.bookmarkUrl,
    dataUrl: record.dataUrl,
    fileName: record.fileName,
    mimeType: record.mimeType,
    updatedAt: record.updatedAt,
    scope: normalizeOverrideScope(record.scope),
  };
}

function toFolderIconRecord(record: FolderIconTransferRecord): FolderIconOverrideRecord {
  return {
    folderId: record.folderId,
    dataUrl: record.dataUrl,
    ...(record.fileName !== undefined ? { fileName: record.fileName } : {}),
    mimeType: record.mimeType,
    updatedAt: record.updatedAt,
    syncId: record.syncId,
    ...(record.locator ? { locator: record.locator } : {}),
  };
}

export function toFolderIconTransfer(record: FolderIconOverrideRecord): FolderIconTransferRecord {
  const withId = withSyncId(record);
  return {
    folderId: withId.folderId,
    dataUrl: withId.dataUrl,
    ...(withId.fileName !== undefined ? { fileName: withId.fileName } : {}),
    mimeType: withId.mimeType,
    updatedAt: withId.updatedAt,
    syncId: withId.syncId ?? legacyFolderIconSyncId(withId.folderId),
    ...(withId.locator ? { locator: withId.locator } : {}),
  };
}

// Folder resolution: rootFolderId is a browser-local bookmark id, so a record
// from another browser or profile usually points at a folder that doesn't
// exist here. Best-effort, in order: keep a pointer that resolves; else keep
// the resolving pointer of the local record with the same id; else adopt the
// folder whose title uniquely equals the workspace name. Otherwise the record
// keeps its foreign pointer, and the page falls back to its default folder.
export function rematchRootFolder(
  record: WorkspaceRecord,
  tree: BookmarkNode[],
  localById: Map<string, WorkspaceRecord>,
): WorkspaceRecord {
  if (findFolder(tree, record.rootFolderId)) return record;
  const local = localById.get(record.id);
  if (local && findFolder(tree, local.rootFolderId)) {
    return { ...record, rootFolderId: local.rootFolderId };
  }
  const titleMatches = collectFoldersByTitle(tree, record.name);
  return titleMatches.length === 1 ? { ...record, rootFolderId: titleMatches[0].id } : record;
}

function collectFoldersByTitle(tree: BookmarkNode[], title: string): BookmarkNode[] {
  const matches: BookmarkNode[] = [];
  const walk = (nodes: BookmarkNode[]): void => {
    for (const node of nodes) {
      if (!isFolder(node)) continue;
      if (node.title === title) matches.push(node);
      walk(node.children ?? []);
    }
  };
  walk(tree);
  return matches;
}
