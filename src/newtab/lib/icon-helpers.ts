import { getBrandName } from '@/shared/url-brand';

export function isValidBookmarkUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function getSearchName(url: string): string {
  return getBrandName(url);
}

export function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
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

import { IconFetchError } from '@/shared/messages';

export function iconPersistenceErrorMessage(error: unknown, source: 'upload' | 'search'): string {
  if (error instanceof IconFetchError) {
    switch (error.kind) {
      case 'network':
        return 'Could not reach the icon URL. The image host may block extensions.';
      case 'http-status':
        return error.httpStatus !== undefined
          ? `Icon URL returned HTTP ${String(error.httpStatus)}.`
          : 'Icon URL returned an error response.';
      case 'not-image':
        return 'The URL did not return an image — likely a login page or hotlink block.';
      case 'decode-fail':
        return 'The image could not be decoded.';
      case 'too-small':
        return 'Image is too small. Pick a larger icon (at least 64×64).';
      case 'unknown':
      default:
        break;
    }
  }
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  if (message.includes('quota')) {
    return 'Storage is full. Remove some icons or clear cache.';
  }
  if (source === 'search' && (message.includes('fetch') || message.includes('network'))) {
    return 'Could not download that icon.';
  }
  return 'Could not save the icon.';
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
