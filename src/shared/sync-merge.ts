import type {
  AppSettings,
  BookmarkNode,
  BookmarkUsageRecord,
  DeletionMarker,
  DeletionMarkerKind,
  FolderBinding,
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
import {
  compareFolderIcons,
  compareText,
  legacyFolderIconSyncId,
  markerId,
  nextStamp,
  pruneDeletionMarkers,
  readStamp,
  retiredFolderIconMarker,
  sameValue,
} from '@/shared/sync-stamps';
import { bookmarkUrl, folderExists, locatorHash, normalizeUrlForMatch, resolveFolder, uniqueBookmarkForUrl } from '@/shared/folder-locator';

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

// Import-only counters for entries dropped while parsing an untrusted backup
// file. Kept separate from WorkspaceExportPayload's on-disk shape (which
// buildWorkspaceExport also produces) so export output never carries them.
export interface WorkspaceImportSkipCounts {
  /** Icon overrides / wallpaper entries dropped for exceeding MAX_IMPORT_DATA_URL_BYTES. */
  oversizedDataUrlCount: number;
}

export type ParsedWorkspaceImport = WorkspaceExportPayload & { skipped: WorkspaceImportSkipCounts };

export interface WorkspaceImportSummary {
  mode: WorkspaceImportMode;
  workspaceCount: number;
  // New workspaces not stored because this browser already holds
  // MAX_WORKSPACES; updates to existing ones never count. Always reported,
  // and a sync keeps them in the shared copy for browsers with room.
  workspaceSkippedCount: number;
  // Workspaces that were attempted but whose write() threw (e.g. quota
  // exceeded mid-loop). workspaceCount only reflects what actually persisted.
  workspaceFailedCount: number;
  iconOverrideCount: number;
  // Icon overrides dropped for exceeding MAX_IMPORT_DATA_URL_BYTES.
  iconOverrideSkippedCount: number;
  folderIconCount: number;
  bookmarkUsageCount: number;
  settings: AppSettings;
  // The merged shared copy a sync pushes.
  merged: WorkspaceExportPayload;
}

export interface LocalSyncSnapshot {
  settings: AppSettings;
  workspaces: WorkspaceRecord[];
  wallpapers: WorkspaceWallpaperMap;
  iconOverrides: IconOverrideRecord[];
  folderIcons: FolderIconOverrideRecord[];
  usage: BookmarkUsageRecord[];
  deletions: DeletionMarker[];
  // Browser-local: see storage.ts.
  bindings: Record<string, FolderBinding>;
  pendingFolderIcons: FolderIconOverrideRecord[];
  pendingUsage: Record<string, number>;
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
  // Keyed by syncId; icons whose folder isn't found here.
  pendingFolderIconWrites: FolderIconOverrideRecord[];
  pendingFolderIconDeletes: string[];
  usageWrites: BookmarkUsageRecord[];
  usageDeletes: string[];
  // The whole next pending-usage map (URL -> usedAt).
  pendingUsage: Record<string, number>;
  bindingWrites: Record<string, FolderBinding>;
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
  const { tree } = ctx;
  // The folder a record shows in this browser; with no tree, none.
  const folderHere = (record: WorkspaceRecord, binding?: FolderBinding): string | null =>
    tree ? resolveFolder(record.rootFolder, tree, { binding, hintId: record.rootFolderId, title: record.name }) : null;

  // Identity: an incoming workspace with an unknown id that matches exactly
  // one local workspace (same name, same folder here) is that workspace under
  // a second id, e.g. onboarding's "Favorites" created on both browsers.
  const paired = new Set<string>();
  const pairedFolders = new Map<string, string>();
  for (const incoming of [...remoteById.values()]) {
    if (localById.has(incoming.id)) continue;
    const marker = markerFor('workspace', incoming.id);
    if (!mirror && marker && marker.deletedAt > workspaceStamp(incoming)) continue;
    const folderId = folderHere(incoming);
    if (!folderId) continue;
    const matches = [...localById.values()].filter(w => !paired.has(w.id) && !remoteById.has(w.id)
      && w.name === incoming.name && folderHere(w, local.bindings[w.id]) === folderId);
    if (matches.length !== 1) continue;
    const [match] = matches;
    const keep = syncMerge
      ? (compareText(match.id, incoming.id) <= 0 ? match.id : incoming.id)
      : ctx.origin === 'file' ? match.id : incoming.id;
    paired.add(keep);
    pairedFolders.set(keep, folderId);
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
    if (!sameValue(storedById.get(id), record)) {
      workspaceWrites.push(record);
      if (!localById.has(id)) names.added.push(record.name);
      else if (fromRemote) names.updated.push(record.name);
    }
    if (hasWallpaper && local.wallpapers[id] !== wallpaper) wallpaperWrites.push({ id, dataUrl: wallpaper });
  }
  const bindingWrites: Record<string, FolderBinding> = {};
  for (const [id, localId] of pairedFolders) {
    const winner = winners.get(id);
    if (!winner || skipped.has(id)) continue;
    const binding: FolderBinding = { localId, locatorHash: locatorHash(winner.record.rootFolder), state: 'bound' };
    if (!sameValue(local.bindings[id], binding)) bindingWrites[id] = binding;
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

  // Folder icons, keyed by syncId. The copy shown here lives under this
  // browser's folder id; one whose folder isn't found here waits as pending.
  const iconStamp = (r: FolderIconOverrideRecord): number => readStamp(r.updatedAt);
  const storedFolderIcons = new Map(local.folderIcons.map(r => [r.folderId, r]));
  const storedPending = new Map(local.pendingFolderIcons.map(r => [r.syncId ?? '', r]));
  const boundBySyncId = new Map(local.folderIcons.map(withSyncId).map(r => [r.syncId ?? '', r]));
  const storedBySyncId = newestByKey([...boundBySyncId.values(), ...local.pendingFolderIcons], r => r.syncId ?? '', iconStamp);
  const localFolderIcons = fileReplace ? new Map<string, FolderIconOverrideRecord>() : storedBySyncId;
  // Payloads from before folder icons existed (v3 and earlier) have no list.
  const remoteFolderIcons = newestByKey((payload.folderIcons ?? []).map(toFolderIconRecord), r => r.syncId ?? '', iconStamp);
  if (fileReplace) {
    for (const [key, record] of remoteFolderIcons) {
      remoteFolderIcons.set(key, { ...record, updatedAt: restamp(storedBySyncId.get(key)?.updatedAt, 'folderIcon', key) });
    }
  }
  const folderWinners = [...new Set([...localFolderIcons.keys(), ...remoteFolderIcons.keys()])]
    .map(key => pick(localFolderIcons.get(key), remoteFolderIcons.get(key), iconStamp, 'folderIcon', key))
    .filter((w): w is Winner<FolderIconOverrideRecord> => w !== null)
    .map(w => w.record);
  const placeFolderIcon = (record: FolderIconOverrideRecord): string | null => {
    const bound = boundBySyncId.get(record.syncId ?? '');
    if (bound && sameValue(bound.locator, record.locator) && (!tree || folderExists(tree, bound.folderId))) return bound.folderId;
    return tree ? resolveFolder(record.locator, tree, { hintId: record.folderId }) : null;
  };
  const placements = new Map(folderWinners.map(r => [r, placeFolderIcon(r)] as const));
  const byFolder = new Map<string, FolderIconOverrideRecord>();
  const retired = new Set<FolderIconOverrideRecord>();
  for (const record of folderWinners.filter(r => placements.get(r)).sort(compareFolderIcons)) {
    const folderId = placements.get(record) ?? '';
    const holder = byFolder.get(folderId);
    if (!holder) {
      byFolder.set(folderId, record);
    } else if (syncMerge) {
      retired.add(record);
      addMarker(retiredFolderIconMarker(holder, record));
    }
  }
  const boundIcons = [...byFolder].map(([folderId, record]) => ({ ...record, folderId }));
  const pendingIcons = folderWinners.filter(r => !placements.get(r));
  const pendingIconIds = new Set(pendingIcons.map(r => r.syncId ?? ''));

  // Usage: this browser's entries stay keyed by bookmark id; synced ones
  // travel by URL and bind only to the one bookmark here with that URL.
  const storedUsage = new Map(local.usage.map(r => [r.bookmarkId, r.usedAt]));
  const usageById = new Map(mirror ? [] : storedUsage);
  const pendingUsage = new Map<string, number>();
  const note = (map: Map<string, number>, key: string, usedAt: number): void => {
    if ((map.get(key) ?? 0) < usedAt) map.set(key, usedAt);
  };
  const incomingUsage: Array<readonly [string, number]> = [
    ...(mirror ? [] : Object.entries(local.pendingUsage)),
    ...(fileReplace ? [] : payload.bookmarkUsage.flatMap(r => (r.url ? [[r.url, r.usedAt] as const] : []))),
  ];
  for (const [url, usedAt] of incomingUsage) {
    const bookmarkId = tree ? uniqueBookmarkForUrl(tree, url) : null;
    if (bookmarkId) note(usageById, bookmarkId, usedAt);
    else note(pendingUsage, normalizeUrlForMatch(url), usedAt);
  }
  const usageByUrl = new Map(pendingUsage);
  for (const [bookmarkId, usedAt] of usageById) {
    const url = tree ? bookmarkUrl(tree, bookmarkId) : null;
    if (url) note(usageByUrl, url, usedAt);
  }

  const deletions = mirror
    ? pruneDeletionMarkers(payload.deletions ?? [], ctx.now)
    : pruneDeletionMarkers([...markers.values()], ctx.now);
  const { settingsUpdatedAt: _stamps, ...syncedValues } = settings;

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
    folderIconWrites: boundIcons.filter(r => !sameValue(storedFolderIcons.get(r.folderId), r)),
    folderIconDeletes: [...storedFolderIcons.keys()].filter(id => !byFolder.has(id)),
    pendingFolderIconWrites: pendingIcons.filter(r => !sameValue(storedPending.get(r.syncId ?? ''), r)),
    pendingFolderIconDeletes: [...storedPending.keys()].filter(id => !pendingIconIds.has(id)),
    usageWrites: [...usageById].filter(([id, usedAt]) => storedUsage.get(id) !== usedAt).map(([bookmarkId, usedAt]) => ({ bookmarkId, usedAt })),
    usageDeletes: [...storedUsage.keys()].filter(id => !usageById.has(id)),
    pendingUsage: Object.fromEntries(pendingUsage),
    bindingWrites,
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
      bookmarkUsage: [...usageByUrl].map(([url, usedAt]) => ({ url, usedAt })),
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
