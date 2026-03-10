import { extensionApi } from './browser';
import type { AppSettings, IconCacheRecord, IconOverrideRecord } from './messages';

const storageKey = 'app-settings';
const iconCacheKey = 'icon-cache-records';
const iconOverrideKey = 'icon-override-records';

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
  dockFolderId: '',
  favoritesColumns: 10,
  favoritesRows: 0,
  favoritesColumnGap: 24,
  favoritesRowGap: 20,
  bookmarkTileWidth: 130,
  bookmarkIconSize: 75,
  showBookmarkIconBackground: false,
};

export async function readSettings(): Promise<AppSettings> {
  const stored = await extensionApi.storage.local.get(storageKey) as Record<string, Partial<AppSettings> | undefined>;
  return normalizeSettings(stored[storageKey] ?? {});
}

export async function writeSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const nextSettings = normalizeSettings({
    ...(await readSettings()),
    ...patch,
  });

  await extensionApi.storage.local.set({
    [storageKey]: nextSettings,
  });

  return nextSettings;
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
    settingsSection: settings.settingsSection === 'general' || settings.settingsSection === 'appearance'
      ? settings.settingsSection
      : defaultSettings.settingsSection,
    rootFolderId: typeof settings.rootFolderId === 'string' ? settings.rootFolderId : defaultSettings.rootFolderId,
    rememberLastFolder: typeof settings.rememberLastFolder === 'boolean' ? settings.rememberLastFolder : defaultSettings.rememberLastFolder,
    openLinksInNewTab: typeof settings.openLinksInNewTab === 'boolean' ? settings.openLinksInNewTab : defaultSettings.openLinksInNewTab,
    showDock: typeof settings.showDock === 'boolean' ? settings.showDock : defaultSettings.showDock,
    dockFolderId: typeof settings.dockFolderId === 'string' ? settings.dockFolderId : defaultSettings.dockFolderId,
    favoritesColumns: normalizeNumber(settings.favoritesColumns, defaultSettings.favoritesColumns, 3, 12),
    favoritesRows: normalizeNumber(settings.favoritesRows, defaultSettings.favoritesRows, 0, 8),
    favoritesColumnGap: normalizeNumber(settings.favoritesColumnGap, defaultSettings.favoritesColumnGap, 0, 48),
    favoritesRowGap: normalizeNumber(settings.favoritesRowGap, defaultSettings.favoritesRowGap, 0, 48),
    bookmarkTileWidth: normalizeNumber(settings.bookmarkTileWidth, defaultSettings.bookmarkTileWidth, 88, 180),
    bookmarkIconSize: normalizeNumber(settings.bookmarkIconSize, defaultSettings.bookmarkIconSize, 40, 112),
    showBookmarkIconBackground: typeof settings.showBookmarkIconBackground === 'boolean'
      ? settings.showBookmarkIconBackground
      : defaultSettings.showBookmarkIconBackground,
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
  const stored = await extensionApi.storage.local.get(iconCacheKey) as Record<string, Record<string, IconCacheRecord> | undefined>;
  return stored[iconCacheKey] ?? {};
}

export async function readIconCacheRecord(cacheKey: string): Promise<IconCacheRecord | null> {
  const records = await readIconCacheRecords();
  return records[cacheKey] ?? null;
}

export async function writeIconCacheRecord(record: IconCacheRecord): Promise<void> {
  const records = await readIconCacheRecords();
  await extensionApi.storage.local.set({
    [iconCacheKey]: {
      ...records,
      [record.cacheKey]: record,
    },
  });
}

export async function deleteIconCacheRecord(cacheKeyValue: string): Promise<void> {
  const records = await readIconCacheRecords();
  if (!(cacheKeyValue in records)) {
    return;
  }

  const nextRecords = { ...records };
  delete nextRecords[cacheKeyValue];
  await extensionApi.storage.local.set({
    [iconCacheKey]: nextRecords,
  });
}

export async function deleteAllIconCacheRecords(): Promise<void> {
  await extensionApi.storage.local.set({
    [iconCacheKey]: {},
  });
}

export async function readIconOverrideRecords(): Promise<Record<string, IconOverrideRecord>> {
  const stored = await extensionApi.storage.local.get(iconOverrideKey) as Record<string, Record<string, IconOverrideRecord> | undefined>;
  return stored[iconOverrideKey] ?? {};
}

export async function readIconOverrideRecord(bookmarkUrl: string): Promise<IconOverrideRecord | null> {
  const records = await readIconOverrideRecords();
  return records[bookmarkUrl] ?? null;
}

export async function writeIconOverrideRecord(record: IconOverrideRecord): Promise<void> {
  const records = await readIconOverrideRecords();
  await extensionApi.storage.local.set({
    [iconOverrideKey]: {
      ...records,
      [record.bookmarkUrl]: record,
    },
  });
}

export async function deleteIconOverrideRecord(bookmarkUrl: string): Promise<void> {
  const records = await readIconOverrideRecords();
  if (!(bookmarkUrl in records)) {
    return;
  }

  const nextRecords = { ...records };
  delete nextRecords[bookmarkUrl];
  await extensionApi.storage.local.set({
    [iconOverrideKey]: nextRecords,
  });
}
