import type { GetIconRequest, IconCacheRecord, IconSearchCandidate, ResolvedIcon, SetIconOverrideRequest, IconOverrideRecord } from '@/shared/messages';
import { extensionApi } from '@/shared/browser';
import { deleteAllIconCacheRecords, deleteIconCacheRecord, deleteIconOverrideRecord, readIconCacheRecord, readIconCacheRecords, readIconOverrideRecord, writeIconCacheRecord, writeIconOverrideRecord } from '@/shared/storage';
import { evictExpiredCachedIcons } from '@/shared/icon-idb';
import { iconPipelineVersion, maxDuckDuckGoResults, autoSourceTimeoutMs, sweepBatchSize, sweepBatchSpacingMs, maxConcurrentResolutions, getIconCacheKey, getOverrideKey } from './icon-constants';
import { ResolutionSemaphore, sleep, firstSuccessful } from './concurrency';
import { createGeneratedRecord, toResolvedIcon } from './icon-image';
import { dedupeIconCandidates, getDomainCandidates, buildSearchQueryFromBookmark } from './icon-classify';
import { isDataUrl, normalizeDataUrl } from './icon-parse';
import {
  fetchS2Favicon, fetchOriginScrape, fetchIconHorse, fetchDuckDuckGoFirstHit,
  searchDuckDuckGoImages, gatherAuthoritativeCandidates, downloadAndPersistOverride,
} from './icon-providers';

const inFlightIcons = new Map<string, Promise<ResolvedIcon>>();
const inFlightRefreshes = new Set<string>();
const resolutionSemaphore = new ResolutionSemaphore(maxConcurrentResolutions);

export async function getIcon(request: GetIconRequest): Promise<ResolvedIcon> {
  const cacheKey = getIconCacheKey(request.bookmarkUrl);
  const pending = inFlightIcons.get(cacheKey);
  if (pending) {
    return pending;
  }

  const nextRequest = resolveIcon(request, cacheKey).finally(() => {
    inFlightIcons.delete(cacheKey);
  });

  inFlightIcons.set(cacheKey, nextRequest);
  return nextRequest;
}

export async function setIconOverride(request: SetIconOverrideRequest): Promise<ResolvedIcon> {
  const normalizedDataUrl = normalizeDataUrl(request.dataUrl, request.mimeType);
  return persistIconOverride({
    bookmarkUrl: request.bookmarkUrl,
    dataUrl: normalizedDataUrl,
    fileName: request.fileName,
    mimeType: request.mimeType,
  });
}

export async function setIconOverrideFromUrl(
  bookmarkUrl: string,
  imageUrl: string,
  fileName?: string,
  fallbackImageUrl?: string,
): Promise<ResolvedIcon> {
  try {
    return await downloadAndPersistOverride(bookmarkUrl, imageUrl, fileName);
  } catch (primaryError) {
    if (!fallbackImageUrl || fallbackImageUrl === imageUrl) {
      throw primaryError;
    }
    try {
      return await downloadAndPersistOverride(bookmarkUrl, fallbackImageUrl, fileName);
    } catch {
      throw primaryError;
    }
  }
}

export async function searchIcons(query: string, bookmarkUrl?: string): Promise<IconSearchCandidate[]> {
  const normalizedQuery = query.trim();
  const fallbackQuery = normalizedQuery || buildSearchQueryFromBookmark(bookmarkUrl);
  const fallbackCandidates = bookmarkUrl ? getDomainCandidates(bookmarkUrl) : [];
  if (!fallbackQuery) {
    return fallbackCandidates;
  }

  const searchBudgetMs = 5000;
  const startTime = Date.now();

  let authoritative: IconSearchCandidate[] = [];
  if (bookmarkUrl) {
    authoritative = await Promise.race([
      gatherAuthoritativeCandidates(bookmarkUrl).catch(() => [] as IconSearchCandidate[]),
      sleep(searchBudgetMs).then(() => [] as IconSearchCandidate[]),
    ]);
  }

  const remainingMs = Math.max(0, searchBudgetMs - (Date.now() - startTime));
  let remoteCandidates: IconSearchCandidate[] = [];
  if (remainingMs > 0) {
    remoteCandidates = await Promise.race([
      searchDuckDuckGoImages(fallbackQuery, bookmarkUrl).catch(() => [] as IconSearchCandidate[]),
      sleep(remainingMs).then(() => [] as IconSearchCandidate[]),
    ]);
  }

  const merged = dedupeIconCandidates([...authoritative, ...remoteCandidates, ...fallbackCandidates]);
  if (merged.length) {
    return merged.slice(0, maxDuckDuckGoResults);
  }

  return fallbackCandidates;
}

export async function removeIconOverride(bookmarkUrl: string, bookmarkTitle?: string): Promise<ResolvedIcon> {
  const cacheKey = getIconCacheKey(bookmarkUrl);
  await deleteIconOverrideRecord(bookmarkUrl);
  await deleteIconCacheRecord(cacheKey);
  return getIcon({ type: 'icons/get', bookmarkUrl, bookmarkTitle });
}

export async function invalidateIcon(bookmarkUrl?: string): Promise<void> {
  if (!bookmarkUrl) {
    inFlightIcons.clear();
    await deleteAllIconCacheRecords();
    return;
  }

  const cacheKey = getIconCacheKey(bookmarkUrl);
  inFlightIcons.delete(cacheKey);
  await deleteIconCacheRecord(cacheKey);
}

async function resolveIcon(request: GetIconRequest, cacheKey: string): Promise<ResolvedIcon> {
  const override = await readIconOverrideRecord(request.bookmarkUrl);
  if (override) {
    return {
      cacheKey,
      sourceKind: 'override',
      dataUrl: override.dataUrl,
      lastUpdated: override.updatedAt,
      isFallback: false,
    };
  }

  const cached = await readIconCacheRecord(cacheKey);
  if (cached && cached.pipelineVersion === iconPipelineVersion && isDataUrl(cached.dataUrl)) {
    const isStale = typeof cached.expiresAt === 'number' && Date.now() > cached.expiresAt;
    if (isStale && cached.sourceKind !== 'generated') {
      scheduleBackgroundRefresh(request, cacheKey);
    }
    return toResolvedIcon(cached);
  }

  const release = await resolutionSemaphore.acquire();
  try {
    const automatic = await resolveAutomaticIcon(request, cacheKey);
    if (automatic) {
      await writeIconCacheRecord(automatic);
      return toResolvedIcon(automatic);
    }
  } finally {
    release();
  }

  const generatedRecord = createGeneratedRecord(request.bookmarkUrl, request.bookmarkTitle, cacheKey);
  await writeIconCacheRecord(generatedRecord);
  return toResolvedIcon(generatedRecord);
}

async function resolveAutomaticIcon(request: GetIconRequest, cacheKey: string): Promise<IconCacheRecord | null> {
  // Primary race: origin scrape + Google S2 favicon. Both return real, brand-correct icons.
  // Icon Horse used to race here too, but it returns generic letter-placeholder PNGs
  // (e.g. grey "C" tile for calendar.google.com) that pass our quality checks and
  // poison the cache. S2 returns the real per-domain favicon (the "31" calendar tile)
  // for sites whose origin HTML is gated behind a login redirect.
  const hasFaviconPermission = await extensionApi.permissions
    .contains({ origins: ['https://www.google.com/*'] })
    .catch(() => false);

  const racers: Array<Promise<IconCacheRecord | null>> = [
    fetchOriginScrape(request.bookmarkUrl, cacheKey).catch(() => null),
  ];
  if (hasFaviconPermission) {
    racers.push(fetchS2Favicon(request.bookmarkUrl, cacheKey).catch(() => null));
  }

  const winner = await Promise.race([
    firstSuccessful(racers),
    sleep(autoSourceTimeoutMs).then(() => null),
  ]);
  if (winner) return winner;

  // Fallback: Icon Horse. Accepts placeholder output as last resort before DDG.
  const iconHorse = await fetchIconHorse(request.bookmarkUrl, cacheKey).catch(() => null);
  if (iconHorse) return iconHorse;

  const ddgFirst = await fetchDuckDuckGoFirstHit(request, cacheKey).catch(() => null);
  if (ddgFirst) return ddgFirst;

  return null;
}

function scheduleBackgroundRefresh(request: GetIconRequest, cacheKey: string): void {
  if (inFlightRefreshes.has(cacheKey)) return;
  inFlightRefreshes.add(cacheKey);
  void (async () => {
    try {
      const release = await resolutionSemaphore.acquire();
      try {
        const fresh = await resolveAutomaticIcon(request, cacheKey);
        if (fresh) {
          await writeIconCacheRecord(fresh);
        }
      } finally {
        release();
      }
    } finally {
      inFlightRefreshes.delete(cacheKey);
    }
  })();
}

export async function sweepGeneratedRecords(): Promise<void> {
  await evictExpiredCachedIcons().catch(() => { /* non-fatal */ });
  const records = await readIconCacheRecords().catch(() => ({}));
  const generated = Object.values(records).filter(record => record.sourceKind === 'generated');
  if (!generated.length) return;

  for (let index = 0; index < generated.length; index += sweepBatchSize) {
    const batch = generated.slice(index, index + sweepBatchSize);
    await Promise.all(batch.map(async record => {
      const release = await resolutionSemaphore.acquire();
      try {
        const fresh = await resolveAutomaticIcon(
          { type: 'icons/get', bookmarkUrl: record.bookmarkUrl },
          record.cacheKey,
        );
        if (fresh) {
          await writeIconCacheRecord(fresh);
        }
      } finally {
        release();
      }
    }));
    if (index + sweepBatchSize < generated.length) {
      await sleep(sweepBatchSpacingMs);
    }
  }
}

async function persistIconOverride(args: { bookmarkUrl: string; dataUrl: string; fileName: string; mimeType: string }): Promise<ResolvedIcon> {
  const now = Date.now();
  const record: IconOverrideRecord = {
    overrideKey: getOverrideKey(args.bookmarkUrl),
    bookmarkUrl: args.bookmarkUrl,
    dataUrl: args.dataUrl,
    fileName: args.fileName,
    mimeType: args.mimeType,
    updatedAt: now,
  };

  await writeIconOverrideRecord(record);
  await deleteIconCacheRecord(getIconCacheKey(args.bookmarkUrl));

  return {
    cacheKey: getIconCacheKey(args.bookmarkUrl),
    sourceKind: 'override',
    dataUrl: args.dataUrl,
    lastUpdated: now,
    isFallback: false,
  };
}
