import type { IconCacheRecord, IconSourceKind, ResolvedIcon } from '@/shared/messages';
import { buildFallbackSvgDataUrl } from '@/shared/icon-fallback';
import { cacheTtlMs, iconPipelineVersion, maxSvgIconBytes } from './icon-constants';
import { isDataUrl } from './icon-parse';
import { getIconLabel } from './icon-classify';
import { isIcoBytes, extractLargestIcoPng } from './ico-parse';

interface FetchAndValidateArgs {
  imageUrl: string;
  bookmarkUrl: string;
  cacheKey: string;
  sourceKind: Exclude<IconSourceKind, 'override'>;
  timeoutMs: number;
  minimumEdge: number;
  requireOpaqueCenter: boolean;
  // Accept SVG without bitmap validation. Only set for candidates declared by the
  // bookmark's own origin (<link rel="icon">); rendered via <img>, so scripts are inert.
  allowSvg?: boolean;
  // Invoked when the underlying fetch is REJECTED (network error / blocked / a
  // cross-scheme https→http redirect the extension has no host permission to follow)
  // — as opposed to a clean miss (404, wrong mime, too small). Lets the origin-scrape
  // loop tell "host unreachable over https" apart from "this path just isn't there".
  onFetchRejected?: () => void;
}

export async function fetchAndValidateImage(args: FetchAndValidateArgs): Promise<IconCacheRecord | null> {
  let response: Response;
  try {
    response = await fetchWithTimeout(args.imageUrl, args.timeoutMs, { cache: 'force-cache' });
  } catch {
    args.onFetchRejected?.();
    return null;
  }
  if (!response.ok) return null;

  let blob = await response.blob().catch(() => null);
  if (!blob) return null;

  let mimeType = blob.type || 'image/png';
  if (!mimeType.startsWith('image/')) return null;

  // createImageBitmap rejects SVG blobs in worker contexts, so SVG-only sites
  // (increasingly common) would always fall through to weaker sources. Trust
  // same-origin declared SVGs after a cheap sanity check instead.
  if (args.allowSvg && (mimeType.includes('svg') || /\.svg(?:$|\?)/i.test(args.imageUrl))) {
    if (blob.size === 0 || blob.size > maxSvgIconBytes) return null;
    const text = await blob.text().catch(() => '');
    if (!text.includes('<svg')) return null;
    return buildRecord(args, await blobToDataUrl(blob, 'image/svg+xml'), 'image/svg+xml');
  }

  // ICO containers also fail createImageBitmap in workers; most modern multi-size
  // favicons embed PNG payloads — swap in the largest one and validate it as PNG.
  const bytes = new Uint8Array(await blob.arrayBuffer().catch(() => new ArrayBuffer(0)));
  if (isIcoBytes(bytes)) {
    const extracted = extractLargestIcoPng(bytes);
    if (extracted) {
      blob = new Blob([extracted.png as BlobPart], { type: 'image/png' });
      mimeType = 'image/png';
    }
  }

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
  return buildRecord(args, dataUrl, mimeType);
}

function buildRecord(args: FetchAndValidateArgs, dataUrl: string, mimeType: string): IconCacheRecord {
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
