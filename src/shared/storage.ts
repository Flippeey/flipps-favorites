import { extensionApi } from './browser';
import {
  clearCachedIcons,
  clearIconOverrides,
  deleteCachedIcon,
  deleteIconOverride,
  readAllCachedIcons,
  readAllIconOverrides,
  readCachedIcon,
  readIconOverride,
  writeIconOverride,
  writeCachedIcon,
} from './icon-idb';
import type { AppSettings, BookmarkSortMode, BookmarkUsageRecord, IconCacheRecord, IconOverrideRecord, SortDirection, ViewMode, WorkspaceRecord } from './messages';
import type { ArchetypeId } from './organization-templates';
import { getOverrideLookupKeys } from './icon-scope';
import { createCachedRecordStore, createCachedValueStore } from './storage-buckets';

const storageKey = 'app-settings';
const iconCacheKey = 'icon-cache-records';
const iconOverrideKey = 'icon-override-records';
const bookmarkUsageKey = 'bookmark-usage-records';
const onboardingStateKey = 'onboarding-state';
const wallpaperKey = 'app-wallpaper';

const settingsStore = createCachedValueStore<AppSettings>({
  storageKey,
  area: 'sync-preferred',
  migrateFromLocal: true,
  deserialize(storedValue) {
    return normalizeSettings((storedValue as Partial<AppSettings> | undefined) ?? {});
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

let iconOverrideMigrationPromise: Promise<void> | null = null;

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

const workspacesKey = 'workspaces';
// Persisted one-shot marker (storage.local) for the view/sort migration. The
// memoized promise alone resets on every MV3 service-worker restart, so the
// marker is what keeps the one-time copy idempotent across restarts.
const workspaceViewSortMigrationMarkerKey = 'workspace-view-sort-migrated';

const workspacesStore = createCachedRecordStore<WorkspaceRecord>({
  storageKey: workspacesKey,
  area: 'sync-preferred',
  // Permanent normalize-on-read defense: an older sync peer can write a
  // WorkspaceRecord lacking the per-workspace view/sort fields at any time.
  deserializeRecord: normalizeWorkspaceRecord,
});

let workspaceViewSortMigrationPromise: Promise<void> | null = null;

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

export async function readSettings(): Promise<AppSettings> {
  return settingsStore.read();
}

let writeQueue: Promise<unknown> = Promise.resolve();

export async function writeSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const run = writeQueue.then(() => doWriteSettings(patch));
  writeQueue = run.catch(() => undefined);
  return run;
}

async function doWriteSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await settingsStore.read();
  const merged = normalizeSettings({ ...current, ...patch });
  await settingsStore.write(merged);
  return merged;
}

function normalizeSettings(settings: Partial<AppSettings>): AppSettings {
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
  await writeIconOverride(record);
}

export async function deleteIconOverrideRecord(overrideKey: string): Promise<void> {
  await deleteIconOverride(overrideKey);
}

// Remove every override that currently applies to this URL, across all scopes.
export async function deleteIconOverrideRecordsForUrl(bookmarkUrl: string): Promise<void> {
  await Promise.all(getOverrideLookupKeys(bookmarkUrl).map(key => deleteIconOverride(key)));
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
  await area.set({ [key]: dataUrl });
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
}

function asResolvedArea(area: MinimalStorageArea | undefined): ResolvedStorageArea | null {
  return area?.get && area?.set ? { get: area.get.bind(area), set: area.set.bind(area) } : null;
}

// Resolve the area the sync-preferred workspaces/settings stores actually use:
// sync when reachable, otherwise local. Mirrors createCachedValueStore's
// resolveStorageArea so the migration reads/writes the same raw bytes the
// stores do.
async function resolveSyncPreferredArea(): Promise<ResolvedStorageArea | null> {
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
    const records = asRecord(stored[workspacesKey]) as Record<string, unknown>;
    for (const value of Object.values(records)) {
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

async function ensureIconOverrideRecordsMigratedToLocal(): Promise<void> {
  if (!iconOverrideMigrationPromise) {
    iconOverrideMigrationPromise = (async () => {
      const syncArea = extensionApi.storage?.sync;
      const localArea = extensionApi.storage?.local;
      if (!syncArea?.get || !syncArea?.remove || !localArea?.get || !localArea?.set) {
        return;
      }

      try {
        const [localStored, syncStored] = await Promise.all([
          localArea.get(iconOverrideKey),
          syncArea.get(iconOverrideKey),
        ]) as [Record<string, unknown>, Record<string, unknown>];

        const localRecords = asIconOverrideRecordMap(localStored[iconOverrideKey]);
        const syncRecords = asIconOverrideRecordMap(syncStored[iconOverrideKey]);
        if (!Object.keys(syncRecords).length) {
          return;
        }

        if (!Object.keys(localRecords).length) {
          await localArea.set({
            [iconOverrideKey]: syncRecords,
          });
        }

        await syncArea.remove(iconOverrideKey);
      } catch (error) {
        console.warn('Failed to migrate icon overrides from sync storage to local storage.', error);
      }
    })();
  }

  await iconOverrideMigrationPromise;
}

function asIconOverrideRecordMap(value: unknown): Record<string, IconOverrideRecord> {
  if (!value || typeof value !== 'object') {
    return {};
  }

  return { ...(value as Record<string, IconOverrideRecord>) };
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
