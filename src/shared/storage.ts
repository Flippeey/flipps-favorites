import { extensionApi } from './browser';
import {
  clearCachedIcons,
  clearIconOverrides,
  deleteCachedIcon,
  deleteFolderIconRecord,
  deleteIconOverride,
  readAllCachedIcons,
  deletePendingFolderIconRecord,
  readAllFolderIconRecords,
  readAllIconOverrides,
  readAllPendingFolderIconRecords,
  writePendingFolderIconRecord,
  readCachedIcon,
  readFolderIconRecord,
  readIconOverride,
  writeFolderIconRecord,
  writeIconOverride,
  writeCachedIcon,
} from './icon-idb';
import { MAX_PENDING_USAGE } from './constants';
import type { AppSettings, BookmarkSortMode, BookmarkUsageRecord, DeletionMarker, FolderBinding, FolderIconOverrideRecord, IconCacheRecord, IconOverrideRecord, PerBrowserSettingKey, SettingsStamps, SortDirection, SyncedSettingKey, ViewMode, WorkspaceRecord } from './messages';
import { PER_BROWSER_SETTING_KEYS } from './messages';
import type { ArchetypeId } from './organization-templates';
import { getOverrideLookupKeys } from './icon-scope';
import { createCachedRecordStore, createCachedValueStore, createPerKeyRecordStore } from './storage-buckets';
import { changedSincePlan, legacyFolderIconSyncId, markerId, mergePlannedMarkers, nextStamp, normalizeDeletionMarker, pruneDeletionMarkers, readStamp, sameValue } from './sync-stamps';

const storageKey = 'app-settings';
const iconCacheKey = 'icon-cache-records';
const iconOverrideKey = 'icon-override-records';
const bookmarkUsageKey = 'bookmark-usage-records';
const onboardingStateKey = 'onboarding-state';
const wallpaperKey = 'app-wallpaper';

// The deserialized value still carries any activeWorkspaceId / dockFolderId
// an older version left in app-settings: readSettings falls back to them
// until this browser has its own per-browser record. Writes strip them.
const settingsStore = createCachedValueStore<AppSettings>({
  storageKey,
  area: 'sync-preferred',
  migrateFromLocal: true,
  deserialize(storedValue) {
    return normalizeSettings((storedValue as Partial<AppSettings> | undefined) ?? {});
  },
  serialize: withoutPerBrowserSettings,
});

type PerBrowserSettings = Pick<AppSettings, PerBrowserSettingKey>;
const perBrowserSettingsKey = 'browser-local-settings';

const perBrowserSettingsStore = createCachedValueStore<PerBrowserSettings | null>({
  storageKey: perBrowserSettingsKey,
  area: 'local',
  deserialize(storedValue) {
    if (!storedValue || typeof storedValue !== 'object') return null;
    return pickPerBrowserSettings(storedValue as Partial<AppSettings>);
  },
});

const iconCacheStore = createCachedRecordStore<IconCacheRecord>({
  storageKey: iconCacheKey,
  area: 'local',
});

const iconOverrideStore = createCachedRecordStore<IconOverrideRecord>({
  storageKey: iconOverrideKey,
  area: 'local',
  resolveConflict(current, incoming) {
    return incoming.updatedAt >= current.updatedAt ? incoming : current;
  },
});

const bookmarkUsageStore = createCachedRecordStore<BookmarkUsageRecord>({
  storageKey: bookmarkUsageKey,
  area: 'sync-preferred',
  migrateFromLocal: true,
  resolveConflict(current, incoming) {
    return incoming.usedAt >= current.usedAt ? incoming : current;
  },
});

export type OnboardingStatus = 'pending' | 'completed' | 'skipped';

export interface OnboardingState {
  version: 2;
  status: OnboardingStatus;
  updatedAt: number;
  completedAt: number | null;
  skippedAt: number | null;
  /** Which archetype the classifier preselected (null = no recommendation / not run). */
  recommendedArchetype: ArchetypeId | null;
  /** Which archetype the user ultimately picked; 'skipped' = user dismissed the step. */
  chosenArchetype: ArchetypeId | 'skipped' | null;
}

const defaultOnboardingState: OnboardingState = {
  version: 2,
  status: 'completed',
  updatedAt: 0,
  completedAt: 0,
  skippedAt: null,
  recommendedArchetype: null,
  chosenArchetype: null,
};

const onboardingStateStore = createCachedValueStore<OnboardingState>({
  storageKey: onboardingStateKey,
  area: 'local',
  deserialize(storedValue) {
    return normalizeOnboardingState(storedValue ?? {});
  },
});

const wallpaperStore = createCachedValueStore<string>({
  storageKey: wallpaperKey,
  area: 'local',
  deserialize(storedValue) {
    return typeof storedValue === 'string' ? storedValue : '';
  },
});

// Legacy aggregate key — only read during migration; never written after refactor.
const workspacesKey = 'workspaces';

// Per-key prefix: each workspace lives under `workspace:<id>` in sync storage.
// This lets Chrome sync's 8 KB-per-item limit apply per record (~630 B each)
// rather than to the whole set, lifting the cap from the interim 10 to 20.
const workspaceKeyPrefix = 'workspace';

// Persisted one-shot markers (storage.local). The memoized promises alone reset
// on every MV3 service-worker restart; the markers keep the one-time copies
// idempotent across restarts.
const workspaceViewSortMigrationMarkerKey = 'workspace-view-sort-migrated';
const workspacePerKeyMigrationMarkerKey = 'workspaces-per-key-migrated';

// Per-key store: each WorkspaceRecord lives under `workspace:<id>` in sync.
const workspacesStore = createPerKeyRecordStore<WorkspaceRecord>({
  keyPrefix: workspaceKeyPrefix,
  area: 'sync-preferred',
  // Permanent normalize-on-read defense: an older sync peer can write a
  // WorkspaceRecord lacking the per-workspace view/sort fields at any time.
  deserializeRecord: normalizeWorkspaceRecord,
});

let workspaceViewSortMigrationPromise: Promise<void> | null = null;
let workspacePerKeyMigrationPromise: Promise<boolean> | null = null;

function workspaceWallpaperKey(workspaceId: string): string {
  return `app-wallpaper-${workspaceId}`;
}

export const defaultSettings: AppSettings = {
  activeWorkspaceId: '',
  workspaceOrder: [],
  themeMode: 'system',
  rememberLastFolder: true,
  openLinksInNewTab: false,
  showDock: false,
  autoHideDock: true,
  dockFolderId: '',
  showClock: false,
  clockHourFormat: '24',
  showSearchBar: true,
  folderOpenMode: 'overlay',
  folderCountBadgeMode: 'always',
};

export const defaultWorkspaceSettings: Omit<WorkspaceRecord, 'id' | 'name' | 'rootFolderId'> = {
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
};

// Storage values are untrusted input. A WorkspaceRecord that lacks the new
// per-workspace view/sort fields (sync peer on an older version) is filled with
// defaults; one that is missing required identity fields is rejected (null).
export function normalizeWorkspaceRecord(value: unknown): WorkspaceRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const raw = value as Partial<WorkspaceRecord> & Record<string, unknown>;
  if (typeof raw.id !== 'string' || typeof raw.rootFolderId !== 'string') {
    return null;
  }

  return {
    ...(raw as WorkspaceRecord),
    ...(raw.updatedAt !== undefined ? { updatedAt: readStamp(raw.updatedAt) } : {}),
    folderMode: isViewMode(raw.folderMode) ? raw.folderMode : defaultWorkspaceSettings.folderMode,
    bookmarkSortMode: isBookmarkSortMode(raw.bookmarkSortMode) ? raw.bookmarkSortMode : defaultWorkspaceSettings.bookmarkSortMode,
    bookmarkSortDirection: isSortDirection(raw.bookmarkSortDirection) ? raw.bookmarkSortDirection : defaultWorkspaceSettings.bookmarkSortDirection,
  };
}

function isViewMode(value: unknown): value is ViewMode {
  return value === 'grid' || value === 'list';
}

function isBookmarkSortMode(value: unknown): value is BookmarkSortMode {
  return value === 'manual' || value === 'name' || value === 'lastUsed' || value === 'created';
}

function isSortDirection(value: unknown): value is SortDirection {
  return value === 'asc' || value === 'desc';
}

export const syncedSettingKeys = Object.keys(defaultSettings)
  .filter(key => !(PER_BROWSER_SETTING_KEYS as readonly string[]).includes(key)) as SyncedSettingKey[];

export async function readSettings(): Promise<AppSettings> {
  const [stored, perBrowser] = await Promise.all([settingsStore.read(), perBrowserSettingsStore.read()]);
  return perBrowser ? { ...stored, ...perBrowser } : stored;
}

let writeQueue: Promise<unknown> = Promise.resolve();

function enqueueSettingsWrite<T>(run: () => Promise<T>): Promise<T> {
  const scheduled = writeQueue.then(run);
  writeQueue = scheduled.catch(() => undefined);
  return scheduled;
}

// Raw writer: stores stamps exactly as given (import and sync pass the
// incoming ones). Only patchSettingsFromUser stamps.
export async function writeSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  return enqueueSettingsWrite(() => doWriteSettings(patch));
}

// A user edit: every synced key whose value changes gets a fresh stamp.
export async function patchSettingsFromUser(patch: Partial<AppSettings>): Promise<AppSettings> {
  return enqueueSettingsWrite(async () => {
    const current = await readSettings();
    const next = normalizeSettings({ ...current, ...patch });
    const stamps: SettingsStamps = { ...current.settingsUpdatedAt };
    const now = Date.now();
    for (const key of syncedSettingKeys) {
      if (key in patch && !sameValue(current[key], next[key])) stamps[key] = nextStamp(stamps[key], now);
    }
    return doWriteSettings({ ...patch, settingsUpdatedAt: stamps });
  });
}

async function doWriteSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await readSettings();
  const merged = normalizeSettings({ ...current, ...patch });
  const perBrowser = pickPerBrowserSettings(merged);
  if (!sameValue(await perBrowserSettingsStore.read(), perBrowser)) {
    await perBrowserSettingsStore.write(perBrowser);
  }
  if (!sameValue(withoutPerBrowserSettings(current), withoutPerBrowserSettings(merged))) {
    await settingsStore.write(merged);
  }
  return merged;
}

function pickPerBrowserSettings(settings: Partial<AppSettings>): PerBrowserSettings {
  return {
    activeWorkspaceId: typeof settings.activeWorkspaceId === 'string' ? settings.activeWorkspaceId : defaultSettings.activeWorkspaceId,
    dockFolderId: typeof settings.dockFolderId === 'string' ? settings.dockFolderId : defaultSettings.dockFolderId,
  };
}

export function withoutPerBrowserSettings(settings: AppSettings): Omit<AppSettings, PerBrowserSettingKey> {
  const { activeWorkspaceId: _active, dockFolderId: _dock, ...synced } = settings;
  return synced;
}

function normalizeSettingsStamps(value: unknown): SettingsStamps {
  if (!value || typeof value !== 'object') return {};
  const raw = value as Record<string, unknown>;
  const stamps: SettingsStamps = {};
  for (const key of syncedSettingKeys) {
    const stamp = readStamp(raw[key]);
    if (stamp > 0) stamps[key] = stamp;
  }
  return stamps;
}

export function normalizeSettings(settings: Partial<AppSettings>): AppSettings {
  return {
    activeWorkspaceId: typeof settings.activeWorkspaceId === 'string' ? settings.activeWorkspaceId : defaultSettings.activeWorkspaceId,
    workspaceOrder: Array.isArray(settings.workspaceOrder) && settings.workspaceOrder.every(id => typeof id === 'string')
      ? settings.workspaceOrder : defaultSettings.workspaceOrder,
    themeMode: settings.themeMode === 'light' || settings.themeMode === 'dark' || settings.themeMode === 'system'
      ? settings.themeMode : defaultSettings.themeMode,
    rememberLastFolder: typeof settings.rememberLastFolder === 'boolean' ? settings.rememberLastFolder : defaultSettings.rememberLastFolder,
    openLinksInNewTab: typeof settings.openLinksInNewTab === 'boolean' ? settings.openLinksInNewTab : defaultSettings.openLinksInNewTab,
    showDock: typeof settings.showDock === 'boolean' ? settings.showDock : defaultSettings.showDock,
    autoHideDock: typeof settings.autoHideDock === 'boolean' ? settings.autoHideDock : defaultSettings.autoHideDock,
    dockFolderId: typeof settings.dockFolderId === 'string' ? settings.dockFolderId : defaultSettings.dockFolderId,
    showClock: typeof settings.showClock === 'boolean' ? settings.showClock : defaultSettings.showClock,
    clockHourFormat: settings.clockHourFormat === '12' || settings.clockHourFormat === '24'
      ? settings.clockHourFormat : defaultSettings.clockHourFormat,
    showSearchBar: typeof settings.showSearchBar === 'boolean' ? settings.showSearchBar : defaultSettings.showSearchBar,
    folderOpenMode: settings.folderOpenMode === 'overlay' || settings.folderOpenMode === 'page'
      ? settings.folderOpenMode : defaultSettings.folderOpenMode,
    folderCountBadgeMode: settings.folderCountBadgeMode === 'always' || settings.folderCountBadgeMode === 'hover'
      ? settings.folderCountBadgeMode : defaultSettings.folderCountBadgeMode,
    settingsUpdatedAt: normalizeSettingsStamps(settings.settingsUpdatedAt),
  };
}


export async function readIconCacheRecords(): Promise<Record<string, IconCacheRecord>> {
  return readAllCachedIcons();
}

export async function readIconCacheRecord(cacheKey: string): Promise<IconCacheRecord | null> {
  return readCachedIcon(cacheKey);
}

export async function writeIconCacheRecord(record: IconCacheRecord): Promise<void> {
  await writeCachedIcon(record);
}

export async function deleteIconCacheRecord(cacheKeyValue: string): Promise<void> {
  await deleteCachedIcon(cacheKeyValue);
}

export async function deleteAllIconCacheRecords(): Promise<void> {
  await clearCachedIcons();
}

export async function readIconOverrideRecords(): Promise<Record<string, IconOverrideRecord>> {
  return readAllIconOverrides();
}

// Resolve the override that applies to a bookmark URL, most specific scope first
// (exact URL, then host, then registrable domain).
export async function readIconOverrideRecord(bookmarkUrl: string): Promise<IconOverrideRecord | null> {
  for (const key of getOverrideLookupKeys(bookmarkUrl)) {
    const record = await readIconOverride(key);
    if (record) return record;
  }
  return null;
}

export async function writeIconOverrideRecord(record: IconOverrideRecord): Promise<void> {
  const existing = await readIconOverride(record.overrideKey);
  if (existing && sameValue(existing, record)) return;
  await writeIconOverride(record);
}

export async function deleteIconOverrideRecord(overrideKey: string): Promise<void> {
  await deleteIconOverride(overrideKey);
}

// Remove every override that currently applies to this URL, across all scopes.
export async function deleteIconOverrideRecordsForUrl(bookmarkUrl: string): Promise<void> {
  await Promise.all(getOverrideLookupKeys(bookmarkUrl).map(key => deleteIconOverride(key)));
}

export async function readFolderIconOverride(folderId: string): Promise<FolderIconOverrideRecord | null> {
  return readFolderIconRecord(folderId);
}

export async function writeFolderIconOverride(record: FolderIconOverrideRecord): Promise<void> {
  const existing = await readFolderIconRecord(record.folderId);
  if (existing && sameValue(existing, record)) return;
  await writeFolderIconRecord(record);
}

export async function deleteFolderIconOverride(folderId: string): Promise<void> {
  await deleteFolderIconRecord(folderId);
}

export async function readAllFolderIconOverrides(): Promise<Record<string, FolderIconOverrideRecord>> {
  return readAllFolderIconRecords();
}

export async function readBookmarkUsageRecords(): Promise<Record<string, BookmarkUsageRecord>> {
  return bookmarkUsageStore.readAll();
}

export async function writeBookmarkUsageRecord(record: BookmarkUsageRecord): Promise<void> {
  await bookmarkUsageStore.writeOne(record.bookmarkId, record);
}

export async function deleteBookmarkUsageRecord(bookmarkId: string): Promise<void> {
  await bookmarkUsageStore.deleteOne(bookmarkId);
}

export async function readWorkspaces(): Promise<WorkspaceRecord[]> {
  const all = await workspacesStore.readAll();
  return Object.values(all);
}

export async function writeWorkspace(record: WorkspaceRecord): Promise<void> {
  await workspacesStore.writeOne(record.id, record);
}

export async function deleteWorkspace(id: string): Promise<void> {
  await workspacesStore.deleteOne(id);
}

// A user edit. An empty patch is an explicit touch (a wallpaper lives outside
// the record but changing it is still an edit of the workspace); a non-empty
// patch that changes nothing is a no-op and keeps the old stamp.
//
// The MV3 service worker can handle two patchWorkspace messages for the SAME
// workspace concurrently. updateOne runs the read-merge-write inside the
// store's serialized section, so the second patch reads the first one's
// result and concurrent edits always stamp strictly upward.
export async function patchWorkspaceFromUser(id: string, patch: Partial<WorkspaceRecord>): Promise<WorkspaceRecord> {
  const { updatedAt: _ignored, ...userPatch } = patch;
  return workspacesStore.updateOne(id, current => {
    if (!current) {
      throw new Error(`Workspace ${id} not found`);
    }
    const merged: WorkspaceRecord = { ...current, ...userPatch, id };
    if (sameValue(current, merged) && Object.keys(userPatch).length > 0) return current;
    return { ...merged, updatedAt: nextStamp(current.updatedAt) };
  });
}

// Writes a record a sync or import planned from `basis` (the stored record the
// plan read, or undefined when there was none). Skipped when the stored record
// changed since, e.g. a user edit or delete that landed while the plan ran:
// that change is newer than anything the plan saw. The check and the write
// share one serialized section with user edits. Resolves whether it landed.
export async function writePlannedWorkspace(record: WorkspaceRecord, basis: WorkspaceRecord | undefined): Promise<boolean> {
  const { next } = await workspacesStore.updateOrDeleteOne(record.id, current =>
    changedSincePlan(current, basis) ? current : record);
  return next === record;
}

// Removes a workspace a sync or import planned to delete from `basis`, unless
// it changed since (see writePlannedWorkspace). Resolves whether it is gone.
export async function deletePlannedWorkspace(id: string, basis: WorkspaceRecord | undefined): Promise<boolean> {
  const { next } = await workspacesStore.updateOrDeleteOne(id, current =>
    changedSincePlan(current, basis) ? current : null);
  return next === null;
}

export async function createWorkspaceFromUser(record: WorkspaceRecord): Promise<WorkspaceRecord> {
  const stamped: WorkspaceRecord = { ...record, updatedAt: nextStamp(record.updatedAt) };
  await workspacesStore.writeOne(stamped.id, stamped);
  return stamped;
}

// Read and delete are one serialized step, so the marker is stamped from the
// record actually deleted, never from one a concurrent edit already replaced.
export async function deleteWorkspaceFromUser(id: string): Promise<void> {
  const { previous } = await workspacesStore.updateOrDeleteOne(id, () => null);
  await addDeletionMarkers([{ kind: 'workspace', key: id, deletedAt: nextStamp(previous?.updatedAt) }]);
}

export async function writeIconOverrideFromUser(record: IconOverrideRecord): Promise<IconOverrideRecord> {
  const [existing, marker] = await Promise.all([
    readIconOverride(record.overrideKey),
    readDeletionMarker('iconOverride', record.overrideKey),
  ]);
  const previous = Math.max(readStamp(existing?.updatedAt), readStamp(marker?.deletedAt));
  const stamped: IconOverrideRecord = { ...record, updatedAt: nextStamp(previous) };
  await writeIconOverrideRecord(stamped);
  return stamped;
}

// Removes every override that applies to this URL (any scope), with a marker
// for each record actually removed.
export async function deleteIconOverridesForUrlFromUser(bookmarkUrl: string): Promise<void> {
  const markers: DeletionMarker[] = [];
  for (const key of getOverrideLookupKeys(bookmarkUrl)) {
    const existing = await readIconOverride(key);
    if (!existing) continue;
    await deleteIconOverride(key);
    markers.push({ kind: 'iconOverride', key, deletedAt: nextStamp(existing.updatedAt) });
  }
  await addDeletionMarkers(markers);
}

export async function writeFolderIconFromUser(record: FolderIconOverrideRecord): Promise<FolderIconOverrideRecord> {
  const existing = await readFolderIconRecord(record.folderId);
  const syncId = existing?.syncId ?? (existing ? legacyFolderIconSyncId(record.folderId) : crypto.randomUUID());
  const marker = await readDeletionMarker('folderIcon', syncId);
  const previous = Math.max(readStamp(existing?.updatedAt), readStamp(marker?.deletedAt));
  const stamped: FolderIconOverrideRecord = { ...record, syncId, updatedAt: nextStamp(previous) };
  await writeFolderIconOverride(stamped);
  return stamped;
}

export async function deleteFolderIconFromUser(folderId: string): Promise<void> {
  const existing = await readFolderIconRecord(folderId);
  if (!existing) return;
  await deleteFolderIconRecord(folderId);
  await addDeletionMarkers([{
    kind: 'folderIcon',
    key: existing.syncId ?? legacyFolderIconSyncId(folderId),
    deletedAt: nextStamp(existing.updatedAt),
  }]);
}

export async function readPendingFolderIcons(): Promise<FolderIconOverrideRecord[]> {
  return readAllPendingFolderIconRecords();
}

export async function writePendingFolderIcon(record: FolderIconOverrideRecord): Promise<void> {
  await writePendingFolderIconRecord(record);
}

export async function deletePendingFolderIcon(syncId: string): Promise<void> {
  await deletePendingFolderIconRecord(syncId);
}

// Which local folder each synced workspace shows, plus data waiting for its
// bookmarks to appear here. All storage.local: folder and bookmark ids are
// browser-local, and two computers on one Chrome account bind different ids.
const folderBindingsKey = 'bookmark-bindings';
const notUsedWorkspacesKey = 'workspaces-not-used-here';
const pendingUsageKey = 'pending-usage';
const bindingsBackfillMarkerKey = 'bookmark-bindings-backfilled';

async function readLocal(key: string): Promise<unknown> {
  const area = extensionApi.storage?.local;
  if (!area?.get) return undefined;
  return (await area.get(key) as Record<string, unknown>)[key];
}

async function writeLocal(key: string, value: unknown): Promise<void> {
  const area = extensionApi.storage?.local;
  if (!area?.set) throw new Error('Local storage is unavailable.');
  await area.set({ [key]: value });
}

let localStateQueue: Promise<unknown> = Promise.resolve();

// Read-modify-write on fresh storage values, one at a time in this context.
function updateLocal<T>(key: string, read: (raw: unknown) => T, mutate: (current: T) => T): Promise<T> {
  const run = localStateQueue.then(async () => {
    const current = read(await readLocal(key));
    const next = mutate(current);
    if (!sameValue(current, next)) await writeLocal(key, next);
    return next;
  });
  localStateQueue = run.catch(() => undefined);
  return run;
}

function toBindings(raw: unknown): Record<string, FolderBinding> {
  if (!raw || typeof raw !== 'object') return {};
  const valid = Object.entries(raw as Record<string, Partial<FolderBinding> | undefined>).flatMap(([id, b]) =>
    typeof b?.localId === 'string' && typeof b.locatorHash === 'string' && (b.state === 'bound' || b.state === 'lost')
      ? [[id, { localId: b.localId, locatorHash: b.locatorHash, state: b.state }] as const]
      : []);
  return Object.fromEntries(valid);
}

const toIdList = (raw: unknown): string[] => (Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : []);

function toPendingUsage(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, usedAt]) => readStamp(usedAt) > 0)) as Record<string, number>;
}

export async function readFolderBindings(): Promise<Record<string, FolderBinding>> {
  return toBindings(await readLocal(folderBindingsKey));
}

export function updateFolderBindings(
  mutate: (current: Record<string, FolderBinding>) => Record<string, FolderBinding>,
): Promise<Record<string, FolderBinding>> {
  return updateLocal(folderBindingsKey, toBindings, mutate);
}

export async function readNotUsedWorkspaceIds(): Promise<string[]> {
  return toIdList(await readLocal(notUsedWorkspacesKey));
}

export async function setWorkspaceNotUsed(id: string, notUsed: boolean): Promise<void> {
  await updateLocal(notUsedWorkspacesKey, toIdList, ids => (notUsed ? [...new Set([...ids, id])] : ids.filter(x => x !== id)));
}

export async function readPendingUsage(): Promise<Record<string, number>> {
  return toPendingUsage(await readLocal(pendingUsageKey));
}

// Keeps the newest MAX_PENDING_USAGE entries.
export async function writePendingUsage(pending: Record<string, number>): Promise<void> {
  const kept = Object.fromEntries(Object.entries(pending).sort(([, a], [, b]) => b - a).slice(0, MAX_PENDING_USAGE));
  await updateLocal(pendingUsageKey, toPendingUsage, () => kept);
}

export async function readBindingsBackfilled(): Promise<boolean> {
  return (await readLocal(bindingsBackfillMarkerKey)) === true;
}

export async function markBindingsBackfilled(): Promise<void> {
  await writeLocal(bindingsBackfillMarkerKey, true);
}

// Deletion markers live beside the records they delete, so any path that
// carries a record also carries its deletion: workspace markers are
// sync-preferred per-key records (`workspace-deleted:<id>`, which the
// `workspace:` store never reads); icon and folder-icon markers share one
// storage.local key.
const workspaceMarkerStore = createPerKeyRecordStore<DeletionMarker>({
  keyPrefix: 'workspace-deleted',
  area: 'sync-preferred',
  deserializeRecord: normalizeDeletionMarker,
});

const iconMarkerStore = createCachedValueStore<DeletionMarker[]>({
  storageKey: 'sync-deletion-markers',
  area: 'local',
  deserialize(storedValue) {
    if (!Array.isArray(storedValue)) return [];
    return storedValue.map(normalizeDeletionMarker).filter((m): m is DeletionMarker => m !== null);
  },
});

let markerQueue: Promise<unknown> = Promise.resolve();

function enqueueMarkerWrite(run: () => Promise<void>): Promise<void> {
  const scheduled = markerQueue.then(run);
  markerQueue = scheduled.catch(() => undefined);
  return scheduled;
}

export async function readDeletionMarkers(): Promise<DeletionMarker[]> {
  const [workspaceMarkers, iconMarkers] = await Promise.all([workspaceMarkerStore.readAll(), iconMarkerStore.read()]);
  return [...Object.values(workspaceMarkers), ...iconMarkers];
}

async function readDeletionMarker(kind: DeletionMarker['kind'], key: string): Promise<DeletionMarker | undefined> {
  const id = markerId(kind, key);
  return (await readDeletionMarkers()).find(m => markerId(m.kind, m.key) === id);
}

// Replaces the stored marker set (pruned to retention and caps), writing only
// what changed: one set (plus one remove for pruned workspace markers) per
// storage area.
export async function writeDeletionMarkers(markers: DeletionMarker[], now: number = Date.now()): Promise<void> {
  await enqueueMarkerWrite(() => doWriteDeletionMarkers(markers, now));
}

// Lands the marker set a sync or import planned from `basis` against the
// markers stored when the write runs (read inside the marker queue), so a
// deletion recorded while the plan ran is kept rather than overwritten.
export async function writePlannedDeletionMarkers(basis: DeletionMarker[], planned: DeletionMarker[], now: number = Date.now()): Promise<void> {
  await enqueueMarkerWrite(async () => doWriteDeletionMarkers(mergePlannedMarkers(await readDeletionMarkers(), basis, planned), now));
}

export async function addDeletionMarkers(added: DeletionMarker[]): Promise<void> {
  if (!added.length) return;
  await enqueueMarkerWrite(async () => doWriteDeletionMarkers([...(await readDeletionMarkers()), ...added], Date.now()));
}

async function doWriteDeletionMarkers(markers: DeletionMarker[], now: number): Promise<void> {
  const next = pruneDeletionMarkers(markers, now);
  const [storedWorkspace, storedIcons] = await Promise.all([workspaceMarkerStore.readAll(), iconMarkerStore.read()]);
  const nextWorkspace = Object.fromEntries(next.filter(m => m.kind === 'workspace').map(m => [m.key, m]));
  const changed = Object.fromEntries(
    Object.entries(nextWorkspace).filter(([key, marker]) => !sameValue(storedWorkspace[key], marker)),
  );
  await workspaceMarkerStore.writeMany(changed);
  await workspaceMarkerStore.deleteMany(Object.keys(storedWorkspace).filter(key => !(key in nextWorkspace)));
  const nextIcons = next.filter(m => m.kind !== 'workspace');
  if (!sameValue(storedIcons, nextIcons)) await iconMarkerStore.write(nextIcons);
}

// Wallpapers are data URLs too large to cache in memory — bypass CachedValueStore intentionally.
export async function readWorkspaceWallpaper(workspaceId: string): Promise<string> {
  const key = workspaceWallpaperKey(workspaceId);
  const area = extensionApi.storage?.local;
  if (!area?.get) return '';
  const result = await area.get(key) as Record<string, unknown>;
  return typeof result[key] === 'string' ? result[key] as string : '';
}

export async function writeWorkspaceWallpaper(workspaceId: string, dataUrl: string): Promise<void> {
  const key = workspaceWallpaperKey(workspaceId);
  const area = extensionApi.storage?.local;
  if (!area?.set) return;
  if (area.get && (await area.get(key) as Record<string, unknown>)[key] === dataUrl) return;
  await area.set({ [key]: dataUrl });
}

export async function removeWorkspaceWallpaper(workspaceId: string): Promise<void> {
  const key = workspaceWallpaperKey(workspaceId);
  const area = extensionApi.storage?.local;
  if (!area?.remove) return;
  await area.remove(key);
}

// Last successful settings-sync completion on THIS browser. Local-only —
// deliberately not in the sync bundle, since "when did I last sync here" is a
// per-device fact.
const lastSyncedAtKey = 'sync-last-synced-at';

export async function readLastSyncedAt(): Promise<number | null> {
  const area = extensionApi.storage?.local;
  if (!area?.get) return null;
  const result = await area.get(lastSyncedAtKey) as Record<string, unknown>;
  return typeof result[lastSyncedAtKey] === 'number' ? result[lastSyncedAtKey] as number : null;
}

export async function writeLastSyncedAt(timestamp: number): Promise<void> {
  const area = extensionApi.storage?.local;
  if (!area?.set) return;
  await area.set({ [lastSyncedAtKey]: timestamp });
}

export async function readOnboardingState(): Promise<OnboardingState> {
  return onboardingStateStore.read();
}

export async function markOnboardingPending(): Promise<OnboardingState> {
  const now = Date.now();
  return onboardingStateStore.write({
    version: 2,
    status: 'pending',
    updatedAt: now,
    completedAt: null,
    skippedAt: null,
    recommendedArchetype: null,
    chosenArchetype: null,
  });
}

export async function markOnboardingCompleted(
  archetypeInfo?: { recommendedArchetype: ArchetypeId | null; chosenArchetype: ArchetypeId | 'skipped' | null },
): Promise<OnboardingState> {
  const now = Date.now();
  return onboardingStateStore.write({
    version: 2,
    status: 'completed',
    updatedAt: now,
    completedAt: now,
    skippedAt: null,
    recommendedArchetype: archetypeInfo?.recommendedArchetype ?? null,
    chosenArchetype: archetypeInfo?.chosenArchetype ?? null,
  });
}

interface MinimalStorageArea {
  // Methods are optional so the runtime presence guards below stay meaningful
  // (an older browser may expose a storage area object without these methods).
  get?: (keys: string | string[] | null) => Promise<Record<string, unknown>>;
  set?: (items: Record<string, unknown>) => Promise<void>;
  remove?: (keys: string | string[]) => Promise<void>;
}

// A storage area whose get/set are confirmed present (post-guard).
interface ResolvedStorageArea {
  get: (keys: string | string[] | null) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove?: (keys: string | string[]) => Promise<void>;
}

function asResolvedArea(area: MinimalStorageArea | undefined): ResolvedStorageArea | null {
  if (!area?.get || !area?.set) return null;
  const resolved: ResolvedStorageArea = {
    get: area.get.bind(area),
    set: area.set.bind(area),
  };
  if (area.remove) resolved.remove = area.remove.bind(area);
  return resolved;
}

// Resolve the area the sync-preferred workspaces/settings stores actually use:
// sync when reachable, otherwise local. Mirrors createCachedValueStore's
// resolveStorageArea so the migration reads/writes the same raw bytes the
// stores do.
async function resolveSyncPreferredArea(): Promise<ResolvedStorageArea | null> {
  // Test-only escape hatch: mirrors storage-buckets.ts's resolveStorageArea /
  // resolveArea so the one-shot migrations agree with the stores on which
  // area is authoritative under test. Dead-code-eliminated otherwise.
  if (__FF_TEST_STORAGE_LOCAL__) {
    return asResolvedArea(extensionApi.storage?.local as MinimalStorageArea | undefined);
  }

  const syncArea = asResolvedArea(extensionApi.storage?.sync as MinimalStorageArea | undefined);
  if (syncArea) {
    try {
      await syncArea.get(null);
      return syncArea;
    } catch {
      /* fall through to local */
    }
  }
  return asResolvedArea(extensionApi.storage?.local as MinimalStorageArea | undefined);
}

const legacyViewSortKeys = ['folderMode', 'bookmarkSortMode', 'bookmarkSortDirection'] as const;

// One-time copy of the legacy GLOBAL view/sort values onto every WorkspaceRecord
// that lacks them, then clear the legacy keys from raw app-settings. Reads the
// RAW stored app-settings (NOT settingsStore.read) because normalizeSettings
// strips fields and writeSettings replaces the whole stored object — the first
// post-upgrade settings write would otherwise erase the legacy values. Gated by
// a memoized promise (per SW lifetime) plus a persisted local marker
// (idempotent across MV3 restarts). Invoked at the top of handleMessage.
export async function ensureWorkspaceViewSortMigration(): Promise<void> {
  if (!workspaceViewSortMigrationPromise) {
    workspaceViewSortMigrationPromise = runWorkspaceViewSortMigration().catch(error => {
      // Reset so a transient failure can retry on the next message; never crash
      // the handler.
      workspaceViewSortMigrationPromise = null;
      console.warn('Failed to migrate workspace view/sort settings.', error);
    });
  }

  await workspaceViewSortMigrationPromise;
}

async function runWorkspaceViewSortMigration(): Promise<void> {
  const localArea = asResolvedArea(extensionApi.storage?.local as MinimalStorageArea | undefined);
  if (!localArea) {
    return;
  }

  // Cross-restart short-circuit: if the marker is set, the one-time copy already
  // ran in a prior lifetime — never re-copy stale globals.
  const markerStored = await localArea.get(workspaceViewSortMigrationMarkerKey);
  if (markerStored[workspaceViewSortMigrationMarkerKey] === true) {
    return;
  }

  const area = await resolveSyncPreferredArea();
  if (!area) {
    return;
  }

  const stored = await area.get([storageKey, workspacesKey]);
  const rawSettings = asRecord(stored[storageKey]);
  const legacy = extractLegacyViewSort(rawSettings);

  if (legacy) {
    // Per-key migration runs first, so the legacy aggregate key may already be
    // gone. Build the set of raw values to iterate: prefer the legacy aggregate
    // key if still present (same-lifetime first-ever upgrade), otherwise read
    // all per-key records directly from the storage area so we can inspect
    // the RAW stored value (needed to distinguish "field absent → apply global"
    // from "field explicitly set → keep as-is").
    const legacyAggregate = asRecord(stored[workspacesKey]) as Record<string, unknown>;
    const hasLegacyAggregate = Object.keys(legacyAggregate).length > 0;

    let rawValues: unknown[];
    if (hasLegacyAggregate) {
      rawValues = Object.values(legacyAggregate);
    } else {
      // Read raw per-key values directly so we preserve the "field absent"
      // signal that normalizeWorkspaceRecord would otherwise erase.
      const allRaw = await area.get(null);
      const prefix = `${workspaceKeyPrefix}:`;
      rawValues = Object.entries(allRaw)
        .filter(([k]) => k.startsWith(prefix))
        .map(([, v]) => v);
    }

    for (const value of rawValues) {
      const record = normalizeWorkspaceRecord(value);
      if (!record) continue;
      const source = asRecord(value);
      const patched: WorkspaceRecord = {
        ...record,
        folderMode: isViewMode(source.folderMode) ? record.folderMode : legacy.folderMode,
        bookmarkSortMode: isBookmarkSortMode(source.bookmarkSortMode) ? record.bookmarkSortMode : legacy.bookmarkSortMode,
        bookmarkSortDirection: isSortDirection(source.bookmarkSortDirection) ? record.bookmarkSortDirection : legacy.bookmarkSortDirection,
      };
      await writeWorkspace(patched);
    }

    // Strip the legacy keys from raw app-settings so a restart cannot re-copy
    // stale globals even before the marker check.
    const nextSettings = { ...rawSettings };
    for (const key of legacyViewSortKeys) delete nextSettings[key];
    await area.set({ [storageKey]: nextSettings });
    settingsStore.clearCache();
  }

  await localArea.set({ [workspaceViewSortMigrationMarkerKey]: true });
}

interface LegacyViewSort {
  folderMode: ViewMode;
  bookmarkSortMode: BookmarkSortMode;
  bookmarkSortDirection: SortDirection;
}

// Returns the legacy global view/sort values only when at least one is present
// in raw app-settings (an upgrade); missing fields fall back to defaults. Null
// means a fresh install with no legacy keys — no copy needed.
function extractLegacyViewSort(rawSettings: Record<string, unknown>): LegacyViewSort | null {
  const hasLegacy = legacyViewSortKeys.some(key => key in rawSettings);
  if (!hasLegacy) {
    return null;
  }

  return {
    folderMode: isViewMode(rawSettings.folderMode) ? rawSettings.folderMode : defaultWorkspaceSettings.folderMode,
    bookmarkSortMode: isBookmarkSortMode(rawSettings.bookmarkSortMode) ? rawSettings.bookmarkSortMode : defaultWorkspaceSettings.bookmarkSortMode,
    bookmarkSortDirection: isSortDirection(rawSettings.bookmarkSortDirection) ? rawSettings.bookmarkSortDirection : defaultWorkspaceSettings.bookmarkSortDirection,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-workspace-key storage migration
//
// Splits the legacy single `workspaces` aggregate sync key into one
// `workspace:<id>` key per record, then deletes the legacy key and sets a
// one-shot local marker so the migration never re-runs.
//
// Design mirrors ensureWorkspaceViewSortMigration:
//   - Memoized promise  → no-op within a single SW lifetime
//   - Persisted marker  → no-op across MV3 SW restarts
//   - normalizeWorkspaceRecord applied to every record during the split
//   - Legacy key deleted atomically with writing the marker
//
// ensureStorageMigrations runs this BEFORE the view/sort migration so
// writeWorkspace (called by view/sort) already uses per-key layout.
// ─────────────────────────────────────────────────────────────────────────────

// Resolves false when the split failed; it is retried on the next call.
export async function ensureWorkspacePerKeyMigration(): Promise<boolean> {
  if (!workspacePerKeyMigrationPromise) {
    workspacePerKeyMigrationPromise = runWorkspacePerKeyMigration().then(() => true, (error: unknown) => {
      workspacePerKeyMigrationPromise = null;
      console.warn('Failed to migrate workspaces to per-key storage.', error);
      return false;
    });
  }
  return workspacePerKeyMigrationPromise;
}

async function runWorkspacePerKeyMigration(): Promise<void> {
  const localArea = asResolvedArea(extensionApi.storage?.local as MinimalStorageArea | undefined);
  if (!localArea) {
    return;
  }

  // Cross-restart short-circuit.
  const markerStored = await localArea.get(workspacePerKeyMigrationMarkerKey);
  if (markerStored[workspacePerKeyMigrationMarkerKey] === true) {
    return;
  }

  const area = await resolveSyncPreferredArea();
  if (!area) {
    return;
  }

  // Read the legacy aggregate key. If absent (fresh install or already migrated
  // without marker), just set the marker and return — nothing to split.
  const stored = await area.get(workspacesKey);
  const rawMap = stored[workspacesKey];

  if (rawMap && typeof rawMap === 'object') {
    const records = rawMap as Record<string, unknown>;
    const writes: Record<string, WorkspaceRecord> = {};

    for (const value of Object.values(records)) {
      const record = normalizeWorkspaceRecord(value);
      if (!record) continue;
      writes[`${workspaceKeyPrefix}:${record.id}`] = record;
    }

    if (Object.keys(writes).length > 0) {
      await area.set(writes);
    }

    // Delete the legacy aggregate key.
    if (area.remove) {
      await area.remove(workspacesKey);
    }
  }

  await localArea.set({ [workspacePerKeyMigrationMarkerKey]: true });
}

// One-time move of activeWorkspaceId / dockFolderId out of app-settings (which
// Chrome account sync shares between computers) into this browser's own
// record. Idempotent: the local record's presence is the done-marker.
let perBrowserSettingsMovePromise: Promise<void> | null = null;

export async function ensurePerBrowserSettingsMove(): Promise<void> {
  if (!perBrowserSettingsMovePromise) {
    perBrowserSettingsMovePromise = runPerBrowserSettingsMove().catch(error => {
      perBrowserSettingsMovePromise = null;
      console.warn('Failed to move per-browser settings to local storage.', error);
    });
  }
  await perBrowserSettingsMovePromise;
}

async function runPerBrowserSettingsMove(): Promise<void> {
  const localArea = asResolvedArea(extensionApi.storage?.local as MinimalStorageArea | undefined);
  const area = await resolveSyncPreferredArea();
  if (!localArea || !area) return;
  if ((await localArea.get(perBrowserSettingsKey))[perBrowserSettingsKey] !== undefined) return;
  const rawSettings = asRecord((await area.get(storageKey))[storageKey]);
  await localArea.set({ [perBrowserSettingsKey]: pickPerBrowserSettings(rawSettings) });
  perBrowserSettingsStore.clearCache();
  if (PER_BROWSER_SETTING_KEYS.some(key => key in rawSettings)) {
    const stripped = { ...rawSettings };
    for (const key of PER_BROWSER_SETTING_KEYS) delete stripped[key];
    await area.set({ [storageKey]: stripped });
    settingsStore.clearCache();
  }
}

// Single entry point for service-worker to call: runs the per-key split
// before the view/sort copy, since view/sort's writeWorkspace calls assume
// records already live under per-id keys, then moves the per-browser settings
// out of app-settings. Each migration keeps its own memoization and
// persisted-marker idempotency; this only fixes their relative order in one
// place instead of leaving it to caller discipline.
//
// A failed split stops the chain until a later call retries it: view/sort
// would otherwise copy the globals onto per-key records, strip them from
// app-settings and set its marker, and the retried split would then overwrite
// those records from the legacy aggregate, losing the copied values for good.
export async function ensureStorageMigrations(): Promise<void> {
  if (!(await ensureWorkspacePerKeyMigration())) return;
  await ensureWorkspaceViewSortMigration();
  await ensurePerBrowserSettingsMove();
}

const ARCHETYPE_IDS: ReadonlySet<string> = new Set(['hoarder', 'power-user', 'casual', 'researcher']);

function isArchetypeId(value: unknown): value is ArchetypeId {
  return typeof value === 'string' && ARCHETYPE_IDS.has(value);
}

function isChosenArchetype(value: unknown): value is ArchetypeId | 'skipped' {
  return isArchetypeId(value) || value === 'skipped';
}

function normalizeOnboardingState(value: unknown): OnboardingState {
  // Accept both Partial<OnboardingState> (v2) and plain objects (v1, or empty).
  const raw = (value !== null && typeof value === 'object' ? value : {}) as Record<string, unknown>;

  const status = raw['status'] === 'pending' || raw['status'] === 'completed' || raw['status'] === 'skipped'
    ? (raw['status'] as OnboardingStatus)
    : defaultOnboardingState.status;
  const updatedAt = normalizeNonNegativeTimestamp(raw['updatedAt'], defaultOnboardingState.updatedAt);
  const completedAt = status === 'completed'
    ? normalizeNullableTimestamp(raw['completedAt'], updatedAt)
    : null;
  const skippedAt = status === 'skipped'
    ? normalizeNullableTimestamp(raw['skippedAt'], updatedAt)
    : null;

  // v1 records lack these fields → default to null.
  const recommendedArchetype = isArchetypeId(raw['recommendedArchetype'])
    ? raw['recommendedArchetype']
    : null;
  const chosenArchetype = isChosenArchetype(raw['chosenArchetype'])
    ? raw['chosenArchetype']
    : null;

  return {
    version: 2,
    status,
    updatedAt,
    completedAt,
    skippedAt,
    recommendedArchetype,
    chosenArchetype,
  };
}

function normalizeNonNegativeTimestamp(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.round(value));
}

function normalizeNullableTimestamp(value: unknown, fallback: number): number | null {
  if (value === null || value === undefined) {
    return fallback;
  }

  return normalizeNonNegativeTimestamp(value, fallback);
}
