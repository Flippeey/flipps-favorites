import type { AppSettings } from '../../shared/messages';

const lastFolderStorageKey = 'newtab/last-folder';

export function getLastFolder(): string | null {
  try {
    return window.localStorage.getItem(lastFolderStorageKey);
  } catch {
    return null;
  }
}

export function persistLastFolder(settings: AppSettings, folderId: string): void {
  try {
    if (settings.rememberLastFolder) {
      window.localStorage.setItem(lastFolderStorageKey, folderId);
    }
  } catch {
    // Ignore storage failures.
  }
}

export function removeLastFolder(): void {
  try {
    window.localStorage.removeItem(lastFolderStorageKey);
  } catch {
    // Ignore storage failures.
  }
}
