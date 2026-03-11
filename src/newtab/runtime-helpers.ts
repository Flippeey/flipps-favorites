import { extensionApi } from '../shared/browser';
import type { AppSettings } from '../shared/messages';

const lastFolderStorageKey = 'newtab/last-folder';

export function openFolderView(folderId: string, openInNewTab: boolean): void {
  const folderUrl = extensionApi.runtime.getURL(`newtab.html#folder=${encodeURIComponent(folderId)}`);
  if (openInNewTab) {
    window.open(folderUrl, '_blank', 'noopener');
    return;
  }

  window.open(folderUrl, '_blank', 'noopener,noreferrer,width=1280,height=900');
}

export function getFolderIdFromHash(): string | null {
  const match = /^#folder=(.+)$/.exec(window.location.hash);
  if (!match) {
    return null;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function syncFolderHash(folderId: string, mode: 'replace' | 'push' = 'replace'): void {
  const nextHash = `#folder=${encodeURIComponent(folderId)}`;
  if (window.location.hash !== nextHash) {
    if (mode === 'push') {
      history.pushState(null, '', nextHash);
      return;
    }

    history.replaceState(null, '', nextHash);
  }
}

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

export function openBookmark(url: string, openInNewTab: boolean): void {
  if (openInNewTab) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  window.location.assign(url);
}

export function isValidBookmarkUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function getSearchName(url: string): string {
  try {
    const parts = new URL(url).hostname.replace(/^www\./, '').split('.');
    return parts.length >= 2 ? parts[parts.length - 2] : (parts[0] ?? '');
  } catch {
    return '';
  }
}

export async function normalizeUploadedImage(file: File): Promise<string> {
  const sourceDataUrl = await readFileAsDataUrl(file);
  const image = await loadImageElement(sourceDataUrl);
  const canvas = document.createElement('canvas');
  const size = 96;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas is unavailable for icon normalization.');
  }

  context.clearRect(0, 0, size, size);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const drawX = (size - drawWidth) / 2;
  const drawY = (size - drawHeight) / 2;

  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png', 0.92));
  if (!blob) {
    throw new Error('Failed to export the uploaded icon.');
  }

  return readFileAsDataUrl(blob);
}

export async function normalizeBackgroundImage(file: File): Promise<string> {
  const sourceDataUrl = await readFileAsDataUrl(file);
  const image = await loadImageElement(sourceDataUrl);
  const maxDimension = 2200;
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas is unavailable for background normalization.');
  }

  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) {
    throw new Error('Failed to export the uploaded background image.');
  }

  return readFileAsDataUrl(blob);
}

function readFileAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('Failed to read icon data.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read icon data.'));
    reader.readAsDataURL(blob);
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to decode the uploaded image.'));
    image.src = src;
  });
}