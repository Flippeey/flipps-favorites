import type { IconCacheRecord, IconSourceKind, ResolvedIcon } from '@/shared/messages';
import { buildFallbackSvgDataUrl } from '@/shared/icon-fallback';
import { cacheTtlMs, generatedTtlMs, iconPipelineVersion, maxSvgIconBytes, placeholderMaxDistinctColors, placeholderMinDominantRatio, placeholderMaxSaturation, placeholderMinBrightness, placeholderMaxBrightness } from './icon-constants';
import { isDataUrl } from './icon-parse';
import { getIconLabel } from './icon-classify';
import { isIcoBytes, extractLargestIcoPng } from './ico-parse';
import { firefoxSafeFetch, isFirefox } from './platform';

interface FetchAndValidateArgs {
  imageUrl: string;
  bookmarkUrl: string;
  cacheKey: string;
  sourceKind: Exclude<IconSourceKind, 'override'>;
  timeoutMs: number;
  minimumEdge: number;
  requireOpaqueCenter: boolean;
  // When true, reject images that look like Icon Horse letter-placeholders:
  // few distinct colors + dominant achromatic grey. Only set on the IH path.
  rejectMonotonePlaceholder?: boolean;
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
    if (args.rejectMonotonePlaceholder && looksLikeLetterPlaceholder(bitmap)) return null;
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

/**
 * Count distinct quantized color buckets in raw RGBA pixel data.
 * Exported for unit-testing without OffscreenCanvas (which is unavailable in
 * Vitest/Node).
 *
 * Quantization: each RGB channel >> 2 (6-bit), giving 64^3 = 262144 possible
 * buckets. Only opaque pixels (alpha >= 128) are counted — transparent regions
 * (rounded corners, shadows) don't contribute.
 */
export function countDistinctColorsFromPixels(data: Uint8ClampedArray): number {
  const seen = new Set<number>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i] >> 2;
    const g = data[i + 1] >> 2;
    const b = data[i + 2] >> 2;
    seen.add((r << 12) | (g << 6) | b);
  }
  return seen.size;
}

/**
 * Detect Icon Horse letter-placeholders from raw RGBA pixel data.
 * Exported for unit-testing without OffscreenCanvas.
 *
 * Compound condition (ALL must be true):
 *   1. Few distinct colors (<= placeholderMaxDistinctColors)
 *   2. Dominant color covers >= placeholderMinDominantRatio of opaque pixels
 *   3. Dominant color is achromatic (channel spread <= placeholderMaxSaturation)
 *   4. Dominant color is light-grey (brightness in [placeholderMinBrightness, placeholderMaxBrightness])
 *      — narrow band hugging IH's actual placeholder at ~226; dark/mid grey logos escape.
 *
 * Calibrated from real Icon Horse responses:
 *   Placeholders: dela.nl (5 colors, 89.8%, grey 226,226,226, brightness 226),
 *                 phidec.twinq.nl (4 colors, 93.8%, grey 226,226,226, brightness 226)
 *   Kept: YouTube (RED, saturated), Twitter (BLACK, brightness 0), Apple silver
 *         (brightness ~155, below floor), grey "W" (brightness 170, below floor)
 *
 * LIMITATION: This gate keys on Icon Horse's CURRENT light-grey placeholder palette.
 * If icon.horse changes its fallback style (different background color, glyph, or
 * layout), the gate silently misses and the bug returns. A more robust future
 * alternative: fingerprint IH's fallback bytes via a bogus-host probe at startup
 * (fetch icon.horse/icon/<uuid>.invalid, hash the response, compare at gate time).
 */
export function isMonotoneLetterPlaceholder(data: Uint8ClampedArray): boolean {
  // 1. Few distinct colors — delegate to the unit-tested helper so the
  //    existing countDistinctColorsFromPixels tests genuinely cover this
  //    live gate's color-counting logic. The 16x16 image is tiny, so the
  //    second pass below is negligible.
  if (countDistinctColorsFromPixels(data) > placeholderMaxDistinctColors) return false;

  const counts = new Map<number, number>();
  const rgbSums = new Map<number, [number, number, number, number]>(); // [sumR, sumG, sumB, count]
  let totalOpaque = 0;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    totalOpaque++;
    const r = data[i] >> 2;
    const g = data[i + 1] >> 2;
    const b = data[i + 2] >> 2;
    const key = (r << 12) | (g << 6) | b;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const existing = rgbSums.get(key);
    if (existing) {
      existing[0] += data[i];
      existing[1] += data[i + 1];
      existing[2] += data[i + 2];
      existing[3]++;
    } else {
      rgbSums.set(key, [data[i], data[i + 1], data[i + 2], 1]);
    }
  }

  if (totalOpaque === 0) return false;

  // 2. Find dominant bucket
  let dominantKey = 0;
  let dominantCount = 0;
  for (const [key, count] of counts) {
    if (count > dominantCount) {
      dominantKey = key;
      dominantCount = count;
    }
  }
  if (dominantCount / totalOpaque < placeholderMinDominantRatio) return false;

  // 3. Dominant color is achromatic light-grey
  const sums = rgbSums.get(dominantKey);
  if (!sums || sums[3] === 0) return false;
  const avgR = sums[0] / sums[3];
  const avgG = sums[1] / sums[3];
  const avgB = sums[2] / sums[3];

  const maxChannel = Math.max(avgR, avgG, avgB);
  const minChannel = Math.min(avgR, avgG, avgB);
  const spread = maxChannel - minChannel;
  if (spread > placeholderMaxSaturation) return false;

  // Brightness check: narrow light-grey band [200, 240] hugs IH's placeholder at ~226.
  // Dark grey (85), mid-grey (170), silver (155), black (0), and white (255) all escape.
  const brightness = (avgR + avgG + avgB) / 3;
  if (brightness < placeholderMinBrightness || brightness > placeholderMaxBrightness) return false;

  return true;
}

/**
 * Downscale a bitmap to 16x16 and check if it looks like a letter placeholder.
 * Reuses the same OffscreenCanvas pattern as `hasOpaqueCenter`.
 */
function looksLikeLetterPlaceholder(bitmap: ImageBitmap): boolean {
  if (typeof OffscreenCanvas === 'undefined') return false;
  try {
    const sampleSize = 16;
    const canvas = new OffscreenCanvas(sampleSize, sampleSize);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return false;
    context.drawImage(bitmap, 0, 0, sampleSize, sampleSize);
    const imageData = context.getImageData(0, 0, sampleSize, sampleSize);
    return isMonotoneLetterPlaceholder(imageData.data);
  } catch {
    return false;
  }
}

export async function fetchWithTimeout(url: string, timeoutMs: number, init?: RequestInit): Promise<Response> {
  // On Firefox the background page uses XHR (host_permissions CORS bypass).
  // XHR handles its own timeout via xhr.timeout, so AbortController is not needed.
  if (isFirefox()) {
    return firefoxSafeFetch(url, init, timeoutMs);
  }
  // Chrome path: fetch() + AbortController timeout (declarativeNetRequest
  // session rules inject Access-Control-Allow-Origin for cross-origin requests).
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
  const now = Date.now();
  return {
    cacheKey,
    bookmarkUrl,
    sourceKind: 'generated',
    dataUrl,
    mimeType: 'image/svg+xml',
    updatedAt: now,
    // Short TTL so a generated fallback re-resolves on a later calm load rather
    // than persisting until the next browser restart (sweepGeneratedRecords).
    expiresAt: now + generatedTtlMs,
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
