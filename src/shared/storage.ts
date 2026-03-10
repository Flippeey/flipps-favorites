import { extensionApi } from './browser';
import type { AppSettings } from './messages';

const storageKey = 'app-settings';

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
