import { extensionApi } from './browser';
import type { AppSettings, BookmarkUsageRecord, IconCacheRecord, IconOverrideRecord } from './messages';
import { createCachedRecordStore, createCachedValueStore } from './storage-buckets';

const storageKey = 'app-settings';
const iconCacheKey = 'icon-cache-records';
const iconOverrideKey = 'icon-override-records';
const bookmarkUsageKey = 'bookmark-usage-records';

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

export const defaultSettings: AppSettings = {
  themeMode: 'system',
  accentColor: '#3f72dc',
  customBackgroundImage: '',
  backgroundOpacity: 70,
  backgroundFitMode: 'cover',
  backgroundPositionMode: 'center',
  settingsSection: 'general',
  rootFolderId: '',
  rememberLastFolder: true,
  openLinksInNewTab: false,
  showDock: false,
  autoHideDock: false,
  dockFolderId: '',
  bookmarkSortMode: 'manual',
  bookmarkSortDirection: 'asc',
  favoritesColumns: 10,
  favoritesRows: 0,
  favoritesColumnGap: 24,
  favoritesRowGap: 20,
  bookmarkTileWidth: 130,
  bookmarkIconSize: 75,
  showBookmarkIconBackground: false,
  layoutPreset: 'balanced',
};

export async function readSettings(): Promise<AppSettings> {
  return settingsStore.read();
}

export async function writeSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const nextSettings = normalizeSettings({
    ...(await readSettings()),
    ...patch,
  });

  return settingsStore.write(nextSettings);
}

function normalizeSettings(settings: Partial<AppSettings>): AppSettings {
  return {
    themeMode: settings.themeMode === 'light' || settings.themeMode === 'dark' || settings.themeMode === 'system'
      ? settings.themeMode
      : defaultSettings.themeMode,
    accentColor: /^#[0-9a-fA-F]{6}$/.test(settings.accentColor ?? '')
      ? String(settings.accentColor).toUpperCase()
      : defaultSettings.accentColor.toUpperCase(),
    customBackgroundImage: typeof settings.customBackgroundImage === 'string'
      ? settings.customBackgroundImage
      : defaultSettings.customBackgroundImage,
    backgroundOpacity: normalizeNumber(settings.backgroundOpacity, defaultSettings.backgroundOpacity, 0, 100),
    backgroundFitMode: settings.backgroundFitMode === 'cover' || settings.backgroundFitMode === 'contain' || settings.backgroundFitMode === 'fill'
      ? settings.backgroundFitMode
      : defaultSettings.backgroundFitMode,
    backgroundPositionMode: settings.backgroundPositionMode === 'center' || settings.backgroundPositionMode === 'top' || settings.backgroundPositionMode === 'bottom'
      ? settings.backgroundPositionMode
      : defaultSettings.backgroundPositionMode,
    settingsSection: settings.settingsSection === 'general' || settings.settingsSection === 'appearance' || settings.settingsSection === 'help'
      ? settings.settingsSection
      : defaultSettings.settingsSection,
    rootFolderId: typeof settings.rootFolderId === 'string' ? settings.rootFolderId : defaultSettings.rootFolderId,
    rememberLastFolder: typeof settings.rememberLastFolder === 'boolean' ? settings.rememberLastFolder : defaultSettings.rememberLastFolder,
    openLinksInNewTab: typeof settings.openLinksInNewTab === 'boolean' ? settings.openLinksInNewTab : defaultSettings.openLinksInNewTab,
    showDock: typeof settings.showDock === 'boolean' ? settings.showDock : defaultSettings.showDock,
    autoHideDock: typeof settings.autoHideDock === 'boolean' ? settings.autoHideDock : defaultSettings.autoHideDock,
    dockFolderId: typeof settings.dockFolderId === 'string' ? settings.dockFolderId : defaultSettings.dockFolderId,
    bookmarkSortMode: settings.bookmarkSortMode === 'manual' || settings.bookmarkSortMode === 'name' || settings.bookmarkSortMode === 'lastUsed' || settings.bookmarkSortMode === 'created'
      ? settings.bookmarkSortMode
      : defaultSettings.bookmarkSortMode,
    bookmarkSortDirection: settings.bookmarkSortDirection === 'asc' || settings.bookmarkSortDirection === 'desc'
      ? settings.bookmarkSortDirection
      : defaultSettings.bookmarkSortDirection,
    favoritesColumns: normalizeNumber(settings.favoritesColumns, defaultSettings.favoritesColumns, 3, 12),
    favoritesRows: normalizeNumber(settings.favoritesRows, defaultSettings.favoritesRows, 0, 8),
    favoritesColumnGap: normalizeNumber(settings.favoritesColumnGap, defaultSettings.favoritesColumnGap, 0, 48),
    favoritesRowGap: normalizeNumber(settings.favoritesRowGap, defaultSettings.favoritesRowGap, 0, 48),
    bookmarkTileWidth: normalizeNumber(settings.bookmarkTileWidth, defaultSettings.bookmarkTileWidth, 88, 180),
    bookmarkIconSize: normalizeNumber(settings.bookmarkIconSize, defaultSettings.bookmarkIconSize, 40, 112),
    showBookmarkIconBackground: typeof settings.showBookmarkIconBackground === 'boolean'
      ? settings.showBookmarkIconBackground
      : defaultSettings.showBookmarkIconBackground,
    layoutPreset: settings.layoutPreset === 'balanced' || settings.layoutPreset === 'compact' || settings.layoutPreset === 'spacious' || settings.layoutPreset === 'presentation' || settings.layoutPreset === 'custom'
      ? settings.layoutPreset
      : defaultSettings.layoutPreset,
  };
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(parsed)));
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

export async function readBookmarkUsageRecord(bookmarkId: string): Promise<BookmarkUsageRecord | null> {
  return bookmarkUsageStore.readOne(bookmarkId);
}

export async function writeBookmarkUsageRecord(record: BookmarkUsageRecord): Promise<void> {
  await bookmarkUsageStore.writeOne(record.bookmarkId, record);
}

export async function deleteBookmarkUsageRecord(bookmarkId: string): Promise<void> {
  await bookmarkUsageStore.deleteOne(bookmarkId);
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
