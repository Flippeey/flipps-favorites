import type { IconCacheRecord, IconSourceKind, ResolvedIcon } from '@/shared/messages';
import { buildFallbackSvgDataUrl } from '@/shared/icon-fallback';
import { cacheTtlMs, iconPipelineVersion } from './icon-constants';
import { isDataUrl } from './icon-parse';
import { getIconLabel } from './icon-classify';

interface FetchAndValidateArgs {
  imageUrl: string;
  bookmarkUrl: string;
  cacheKey: string;
  sourceKind: Exclude<IconSourceKind, 'override'>;
  timeoutMs: number;
  minimumEdge: number;
  requireOpaqueCenter: boolean;
}

export async function fetchAndValidateImage(args: FetchAndValidateArgs): Promise<IconCacheRecord | null> {
  let response: Response;
  try {
    response = await fetchWithTimeout(args.imageUrl, args.timeoutMs, { cache: 'force-cache' });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  const blob = await response.blob().catch(() => null);
  if (!blob) return null;

  const mimeType = blob.type || 'image/png';
  if (!mimeType.startsWith('image/')) return null;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }

  try {
    const minEdge = Math.min(bitmap.width, bitmap.height);
    const aspectRatio = Math.max(bitmap.width, bitmap.height) / Math.max(1, minEdge);
    if (minEdge < args.minimumEdge) return null;
    if (aspectRatio > 1.4) return null;
    if (args.requireOpaqueCenter && !hasOpaqueCenter(bitmap)) return null;
  } finally {
    bitmap.close();
  }

  const dataUrl = await blobToDataUrl(blob, mimeType);
  if (!isDataUrl(dataUrl)) return null;

  const now = Date.now();
  return {
    cacheKey: args.cacheKey,
    bookmarkUrl: args.bookmarkUrl,
    sourceKind: args.sourceKind,
    dataUrl,
    mimeType,
    updatedAt: now,
    expiresAt: now + cacheTtlMs,
    pipelineVersion: iconPipelineVersion,
  };
}

export function hasOpaqueCenter(bitmap: ImageBitmap): boolean {
  if (typeof OffscreenCanvas === 'undefined') return true;
  try {
    const sampleSize = 8;
    const canvas = new OffscreenCanvas(sampleSize, sampleSize);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return true;
    const centerX = bitmap.width / 2 - sampleSize / 2;
    const centerY = bitmap.height / 2 - sampleSize / 2;
    context.drawImage(
      bitmap,
      centerX, centerY, sampleSize, sampleSize,
      0, 0, sampleSize, sampleSize,
    );
    const data = context.getImageData(0, 0, sampleSize, sampleSize).data;
    let totalAlpha = 0;
    for (let index = 3; index < data.length; index += 4) {
      totalAlpha += data[index];
    }
    const meanAlpha = totalAlpha / (data.length / 4);
    return meanAlpha >= 32;
  } catch {
    return true;
  }
}

export async function fetchWithTimeout(url: string, timeoutMs: number, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function getImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

export async function blobToDataUrl(blob: Blob, mimeType: string): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

export function createGeneratedRecord(bookmarkUrl: string, bookmarkTitle: string | undefined, cacheKey: string): IconCacheRecord {
  const label = getIconLabel(bookmarkTitle, bookmarkUrl);
  const dataUrl = buildFallbackSvgDataUrl(label);
  return {
    cacheKey,
    bookmarkUrl,
    sourceKind: 'generated',
    dataUrl,
    mimeType: 'image/svg+xml',
    updatedAt: Date.now(),
    pipelineVersion: iconPipelineVersion,
  };
}

export function toResolvedIcon(record: IconCacheRecord): ResolvedIcon {
  return {
    cacheKey: record.cacheKey,
    sourceKind: record.sourceKind,
    dataUrl: record.dataUrl,
    lastUpdated: record.updatedAt,
    isFallback: record.sourceKind === 'generated',
  };
}
