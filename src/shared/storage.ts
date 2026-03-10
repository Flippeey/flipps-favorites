import { extensionApi } from './browser';
import type { AppSettings, IconCacheRecord, IconOverrideRecord } from './messages';

const storageKey = 'app-settings';
const iconCacheKey = 'icon-cache-records';
const iconOverrideKey = 'icon-override-records';

export const defaultSettings: AppSettings = {
  themeMode: 'system',
  accentColor: '#3f72dc',
  settingsSection: 'appearance',
  rootFolderId: '',
  rememberLastFolder: true,
  openLinksInNewTab: false,
  showDock: true,
  dockFolderId: '',
};

export async function readSettings(): Promise<AppSettings> {
  const stored = await extensionApi.storage.local.get(storageKey) as Record<string, Partial<AppSettings> | undefined>;
  return {
    ...defaultSettings,
    ...(stored[storageKey] ?? {}),
  };
}

export async function writeSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const nextSettings = {
    ...(await readSettings()),
    ...patch,
  };

  await extensionApi.storage.local.set({
    [storageKey]: nextSettings,
  });

  return nextSettings;
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
