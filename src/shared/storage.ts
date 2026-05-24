import { extensionApi } from './browser';
import type { AppSettings, BookmarkUsageRecord, IconCacheRecord, IconOverrideRecord, WorkspaceRecord } from './messages';
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
  version: 1;
  status: OnboardingStatus;
  updatedAt: number;
  completedAt: number | null;
  skippedAt: number | null;
}

const defaultOnboardingState: OnboardingState = {
  version: 1,
  status: 'completed',
  updatedAt: 0,
  completedAt: 0,
  skippedAt: null,
};

const onboardingStateStore = createCachedValueStore<OnboardingState>({
  storageKey: onboardingStateKey,
  area: 'local',
  deserialize(storedValue) {
    return normalizeOnboardingState((storedValue as Partial<OnboardingState> | undefined) ?? {});
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

const workspacesStore = createCachedRecordStore<WorkspaceRecord>({
  storageKey: workspacesKey,
  area: 'sync-preferred',
});

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
  bookmarkSortMode: 'manual',
  bookmarkSortDirection: 'asc',
  showClock: false,
  clockHourFormat: '24',
  showSearchBar: true,
  folderMode: 'tiles',
  folderOpenMode: 'overlay',
};

export const defaultWorkspaceSettings: Omit<WorkspaceRecord, 'id' | 'name' | 'rootFolderId'> = {
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
};

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
    themeMode: settings.themeMode === 'light' || settings.themeMode === 'dark' || settings.themeMode === 'system'
      ? settings.themeMode : defaultSettings.themeMode,
    rememberLastFolder: typeof settings.rememberLastFolder === 'boolean' ? settings.rememberLastFolder : defaultSettings.rememberLastFolder,
    openLinksInNewTab: typeof settings.openLinksInNewTab === 'boolean' ? settings.openLinksInNewTab : defaultSettings.openLinksInNewTab,
    showDock: typeof settings.showDock === 'boolean' ? settings.showDock : defaultSettings.showDock,
    autoHideDock: typeof settings.autoHideDock === 'boolean' ? settings.autoHideDock : defaultSettings.autoHideDock,
    dockFolderId: typeof settings.dockFolderId === 'string' ? settings.dockFolderId : defaultSettings.dockFolderId,
    bookmarkSortMode: settings.bookmarkSortMode === 'manual' || settings.bookmarkSortMode === 'name' || settings.bookmarkSortMode === 'lastUsed' || settings.bookmarkSortMode === 'created'
      ? settings.bookmarkSortMode : defaultSettings.bookmarkSortMode,
    bookmarkSortDirection: settings.bookmarkSortDirection === 'asc' || settings.bookmarkSortDirection === 'desc'
      ? settings.bookmarkSortDirection : defaultSettings.bookmarkSortDirection,
    showClock: typeof settings.showClock === 'boolean' ? settings.showClock : defaultSettings.showClock,
    clockHourFormat: settings.clockHourFormat === '12' || settings.clockHourFormat === '24'
      ? settings.clockHourFormat : defaultSettings.clockHourFormat,
    showSearchBar: typeof settings.showSearchBar === 'boolean' ? settings.showSearchBar : defaultSettings.showSearchBar,
    folderMode: settings.folderMode === 'tiles' || settings.folderMode === 'sections'
      ? settings.folderMode : defaultSettings.folderMode,
    folderOpenMode: settings.folderOpenMode === 'overlay' || settings.folderOpenMode === 'page'
      ? settings.folderOpenMode : defaultSettings.folderOpenMode,
  };
}


export async function readIconCacheRecords(): Promise<Record<string, IconCacheRecord>> {
  return iconCacheStore.readAll();
}

export async function readIconCacheRecord(cacheKey: string): Promise<IconCacheRecord | null> {
  return iconCacheStore.readOne(cacheKey);
}

export async function writeIconCacheRecord(record: IconCacheRecord): Promise<void> {
  await iconCacheStore.writeOne(record.cacheKey, record);
}

export async function deleteIconCacheRecord(cacheKeyValue: string): Promise<void> {
  await iconCacheStore.deleteOne(cacheKeyValue);
}

export async function deleteAllIconCacheRecords(): Promise<void> {
  await iconCacheStore.clearAll();
}

export async function readIconOverrideRecords(): Promise<Record<string, IconOverrideRecord>> {
  await ensureIconOverrideRecordsMigratedToLocal();
  return iconOverrideStore.readAll();
}

export async function readIconOverrideRecord(bookmarkUrl: string): Promise<IconOverrideRecord | null> {
  await ensureIconOverrideRecordsMigratedToLocal();
  return iconOverrideStore.readOne(bookmarkUrl);
}

export async function writeIconOverrideRecord(record: IconOverrideRecord): Promise<void> {
  await ensureIconOverrideRecordsMigratedToLocal();
  await iconOverrideStore.writeOne(record.bookmarkUrl, record);
}

export async function deleteIconOverrideRecord(bookmarkUrl: string): Promise<void> {
  await ensureIconOverrideRecordsMigratedToLocal();
  await iconOverrideStore.deleteOne(bookmarkUrl);
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
    version: 1,
    status: 'pending',
    updatedAt: now,
    completedAt: null,
    skippedAt: null,
  });
}

export async function markOnboardingCompleted(): Promise<OnboardingState> {
  const now = Date.now();
  return onboardingStateStore.write({
    version: 1,
    status: 'completed',
    updatedAt: now,
    completedAt: now,
    skippedAt: null,
  });
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

function normalizeOnboardingState(value: Partial<OnboardingState>): OnboardingState {
  const status = value.status === 'pending' || value.status === 'completed' || value.status === 'skipped'
    ? value.status
    : defaultOnboardingState.status;
  const updatedAt = normalizeNonNegativeTimestamp(value.updatedAt, defaultOnboardingState.updatedAt);
  const completedAt = status === 'completed'
    ? normalizeNullableTimestamp(value.completedAt, updatedAt)
    : null;
  const skippedAt = status === 'skipped'
    ? normalizeNullableTimestamp(value.skippedAt, updatedAt)
    : null;

  return {
    version: 1,
    status,
    updatedAt,
    completedAt,
    skippedAt,
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

export async function migrateToWorkspaces(): Promise<{ workspaceId: string } | null> {
  // Already migrated if workspacesStore has records
  const existing = await workspacesStore.readAll();
  if (Object.keys(existing).length > 0) return null;

  // Read raw settings from storage to get old per-workspace fields before they're stripped
  const syncArea = extensionApi.storage?.sync;
  const localArea = extensionApi.storage?.local;
  if (!syncArea?.get || !localArea?.get) return null;

  const [syncRaw, localRaw] = await Promise.all([
    syncArea.get('app-settings'),
    localArea.get(['app-settings', 'app-wallpaper']),
  ]) as [Record<string, unknown>, Record<string, unknown>];

  const raw = (syncRaw['app-settings'] ?? localRaw['app-settings'] ?? {}) as Record<string, unknown>;
  const wallpaper = typeof localRaw['app-wallpaper'] === 'string' ? localRaw['app-wallpaper'] as string : '';

  const id = crypto.randomUUID();

  const record: WorkspaceRecord = {
    id,
    name: 'My workspace',
    rootFolderId: typeof raw['rootFolderId'] === 'string' ? raw['rootFolderId'] as string : '',
    accentColor: /^#[0-9a-fA-F]{6}$/.test(String(raw['accentColor'] ?? ''))
      ? String(raw['accentColor']).toUpperCase()
      : defaultWorkspaceSettings.accentColor,
    backgroundMode: (['solid', 'gradient', 'wallpaper'] as const).includes(raw['backgroundMode'] as WorkspaceRecord['backgroundMode'])
      ? raw['backgroundMode'] as WorkspaceRecord['backgroundMode']
      : defaultWorkspaceSettings.backgroundMode,
    solidBackgroundColor: typeof raw['solidBackgroundColor'] === 'string' ? raw['solidBackgroundColor'] as string : defaultWorkspaceSettings.solidBackgroundColor,
    gradientStyle: (['top', 'top-bottom', 'bottom', 'aurora', 'mesh', 'vignette'] as const).includes(raw['gradientStyle'] as WorkspaceRecord['gradientStyle'])
      ? raw['gradientStyle'] as WorkspaceRecord['gradientStyle']
      : defaultWorkspaceSettings.gradientStyle,
    gradientColorSource: raw['gradientColorSource'] === 'accent' || raw['gradientColorSource'] === 'custom'
      ? raw['gradientColorSource'] as WorkspaceRecord['gradientColorSource']
      : defaultWorkspaceSettings.gradientColorSource,
    gradientCustomColor: /^#[0-9a-fA-F]{6}$/.test(String(raw['gradientCustomColor'] ?? ''))
      ? String(raw['gradientCustomColor']).toUpperCase()
      : defaultWorkspaceSettings.gradientCustomColor,
    gradientIntensity: typeof raw['gradientIntensity'] === 'number' && Number.isFinite(raw['gradientIntensity'] as number) ? raw['gradientIntensity'] as number : defaultWorkspaceSettings.gradientIntensity,
    backgroundOpacity: typeof raw['backgroundOpacity'] === 'number' && Number.isFinite(raw['backgroundOpacity'] as number) ? raw['backgroundOpacity'] as number : defaultWorkspaceSettings.backgroundOpacity,
    backgroundFitMode: (['cover', 'contain', 'fill'] as const).includes(raw['backgroundFitMode'] as WorkspaceRecord['backgroundFitMode'])
      ? raw['backgroundFitMode'] as WorkspaceRecord['backgroundFitMode']
      : defaultWorkspaceSettings.backgroundFitMode,
    backgroundPositionMode: (['center', 'top', 'bottom'] as const).includes(raw['backgroundPositionMode'] as WorkspaceRecord['backgroundPositionMode'])
      ? raw['backgroundPositionMode'] as WorkspaceRecord['backgroundPositionMode']
      : defaultWorkspaceSettings.backgroundPositionMode,
    layoutPreset: (['balanced', 'compact', 'spacious', 'presentation', 'custom'] as const).includes(raw['layoutPreset'] as WorkspaceRecord['layoutPreset'])
      ? raw['layoutPreset'] as WorkspaceRecord['layoutPreset']
      : defaultWorkspaceSettings.layoutPreset,
    favoritesColumnGap: typeof raw['favoritesColumnGap'] === 'number' && Number.isFinite(raw['favoritesColumnGap'] as number) ? raw['favoritesColumnGap'] as number : defaultWorkspaceSettings.favoritesColumnGap,
    favoritesRowGap: typeof raw['favoritesRowGap'] === 'number' && Number.isFinite(raw['favoritesRowGap'] as number) ? raw['favoritesRowGap'] as number : defaultWorkspaceSettings.favoritesRowGap,
    bookmarkTileWidth: typeof raw['bookmarkTileWidth'] === 'number' && Number.isFinite(raw['bookmarkTileWidth'] as number) ? raw['bookmarkTileWidth'] as number : defaultWorkspaceSettings.bookmarkTileWidth,
    bookmarkIconSize: typeof raw['bookmarkIconSize'] === 'number' && Number.isFinite(raw['bookmarkIconSize'] as number) ? raw['bookmarkIconSize'] as number : defaultWorkspaceSettings.bookmarkIconSize,
    tileShape: (['squircle', 'rounded', 'circle'] as const).includes(raw['tileShape'] as WorkspaceRecord['tileShape'])
      ? raw['tileShape'] as WorkspaceRecord['tileShape']
      : defaultWorkspaceSettings.tileShape,
    showTileLabels: typeof raw['showTileLabels'] === 'boolean' ? raw['showTileLabels'] as boolean : defaultWorkspaceSettings.showTileLabels,
  };

  try {
    if (wallpaper) {
      await writeWorkspaceWallpaper(id, wallpaper);
    }
    await writeSettings({ activeWorkspaceId: id });
    await writeWorkspace(record); // write last — this is the idempotency sentinel
  } catch (error) {
    console.warn('Failed to migrate settings to workspaces.', error);
    return null;
  }

  return { workspaceId: id };
}
