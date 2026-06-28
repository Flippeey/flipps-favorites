import type { GetIconRequest, IconCacheRecord, IconSearchCandidate, ResolvedIcon, SetIconOverrideRequest, IconOverrideRecord } from '@/shared/messages';
import { extensionApi } from '@/shared/browser';
import { deleteAllIconCacheRecords, deleteIconCacheRecord, deleteIconOverrideRecordsForUrl, readIconCacheRecord, readIconCacheRecords, readIconOverrideRecord, writeIconCacheRecord, writeIconOverrideRecord } from '@/shared/storage';
import { evictExpiredCachedIcons } from '@/shared/icon-idb';
import { getOverrideKeyForScope, normalizeOverrideScope, type IconOverrideScope } from '@/shared/icon-scope';
import { iconPipelineVersion, generatedTtlMs, maxDuckDuckGoResults, autoSourceTimeoutMs, sweepBatchSize, sweepBatchSpacingMs, maxConcurrentResolutions, getIconCacheKey } from './icon-constants';
import { ResolutionSemaphore, sleep } from './concurrency';
import { createGeneratedRecord, toResolvedIcon } from './icon-image';
import { dedupeIconCandidates, getDomainCandidates, buildSearchQueryFromBookmark } from './icon-classify';
import { isDataUrl, normalizeDataUrl } from './icon-parse';
import { extractBrandInfo } from '@/shared/url-brand';
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
    scope: normalizeOverrideScope(request.scope),
  });
}

export async function setIconOverrideFromUrl(
  bookmarkUrl: string,
  imageUrl: string,
  fileName?: string,
  fallbackImageUrl?: string,
  scope?: IconOverrideScope,
): Promise<ResolvedIcon> {
  try {
    return await downloadAndPersistOverride(bookmarkUrl, imageUrl, fileName, scope);
  } catch (primaryError) {
    if (!fallbackImageUrl || fallbackImageUrl === imageUrl) {
      throw primaryError;
    }
    try {
      return await downloadAndPersistOverride(bookmarkUrl, fallbackImageUrl, fileName, scope);
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

  // For personal-infra hosts the origin probes are unreachable, so brand image-search
  // results (remoteCandidates) are the only good source — rank them first.
  const { isPersonalInfra } = bookmarkUrl ? extractBrandInfo(bookmarkUrl) : { isPersonalInfra: false };
  const ordered = isPersonalInfra
    ? [...remoteCandidates, ...authoritative, ...fallbackCandidates]
    : [...authoritative, ...remoteCandidates, ...fallbackCandidates];
  const merged = dedupeIconCandidates(ordered);
  if (merged.length) {
    return merged.slice(0, maxDuckDuckGoResults);
  }

  return fallbackCandidates;
}

export async function removeIconOverride(bookmarkUrl: string, bookmarkTitle?: string): Promise<ResolvedIcon> {
  const cacheKey = getIconCacheKey(bookmarkUrl);
  // Clear every scope that currently applies (exact, host, domain) — "Remove"
  // means "stop overriding this bookmark", whichever record was doing it.
  await deleteIconOverrideRecordsForUrl(bookmarkUrl);
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
    if (isStale) {
      // Generated letter-tiles now carry a short TTL (generatedTtlMs) and ARE
      // eligible for background refresh, so a tile cached during a re-resolution
      // storm self-heals on a later calm load instead of sticking until restart.
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

  // Prefer the origin-scraped icon over Google S2. Both run concurrently, but we
  // wait for origin first: it returns the size-sorted apple-touch-icon / manifest
  // icon (the same brand-correct, high-res candidate the edit dialog surfaces as
  // its top option). A plain Promise.race here let S2's single fast request win
  // almost every time and poisoned the cache with the smaller generic favicon —
  // the visible quality gap between auto-resolve and the edit dialog.
  // Personal-infra hosts (jellyfin.local.flippflix.com) are unreachable to Google S2,
  // which then returns its generic globe placeholder — a "successful" wrong icon that
  // poisons the cache. Skip S2 for these and let the brand image search resolve them.
  const { isPersonalInfra } = extractBrandInfo(request.bookmarkUrl);
  const originPromise = fetchOriginScrape(request.bookmarkUrl, cacheKey)
    .catch(() => ({ record: null, gated: false }));
  const s2Promise = (hasFaviconPermission && !isPersonalInfra)
    ? fetchS2Favicon(request.bookmarkUrl, cacheKey).catch(() => null)
    : Promise.resolve<IconCacheRecord | null>(null);

  const origin = await Promise.race([
    originPromise,
    sleep(autoSourceTimeoutMs).then(() => null),
  ]);
  if (origin?.record) return origin.record;

  // Origin yielded nothing within budget — fall back to S2 (already in flight,
  // capped by its own internal timeout).
  const s2 = await s2Promise;
  if (s2) return s2;

  // Login-gated hosts (origin redirected to another registrable domain) behave
  // like personal infra from here: same-host endpoints serve a login provider's
  // branding and Icon Horse returns a letter placeholder that would poison the
  // cache. The brand image search is the only source left that knows the brand.
  const gated = origin?.gated ?? false;

  // Personal-infra: jump straight to the brand image search before Icon Horse, which
  // also only yields a placeholder for an unreachable private host.
  if (isPersonalInfra || gated) {
    const ddg = await fetchDuckDuckGoFirstHit(request, cacheKey).catch(() => null);
    if (ddg) return ddg;
  }

  if (!gated) {
    // Fallback: Icon Horse. Accepts placeholder output as last resort before DDG.
    const iconHorse = await fetchIconHorse(request.bookmarkUrl, cacheKey).catch(() => null);
    if (iconHorse) return iconHorse;

    const ddgFirst = await fetchDuckDuckGoFirstHit(request, cacheKey).catch(() => null);
    if (ddgFirst) return ddgFirst;
  }

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
        } else {
          // Still nothing better than the cached tile. If it's a generated
          // fallback, re-stamp its TTL so an icon-less host doesn't re-trigger a
          // background refresh on every subsequent load.
          const existing = await readIconCacheRecord(cacheKey);
          if (existing?.sourceKind === 'generated') {
            const now = Date.now();
            await writeIconCacheRecord({ ...existing, updatedAt: now, expiresAt: now + generatedTtlMs });
          }
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
        // Re-derive the cache key: records written before the host-keyed cache
        // carry URL-keyed cacheKeys that the resolver would never read back.
        const fresh = await resolveAutomaticIcon(
          { type: 'icons/get', bookmarkUrl: record.bookmarkUrl },
          getIconCacheKey(record.bookmarkUrl),
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

async function persistIconOverride(args: { bookmarkUrl: string; dataUrl: string; fileName: string; mimeType: string; scope: IconOverrideScope }): Promise<ResolvedIcon> {
  const now = Date.now();
  const overrideKey = getOverrideKeyForScope(args.bookmarkUrl, args.scope)
    ?? `exact:${args.bookmarkUrl}`;
  const record: IconOverrideRecord = {
    overrideKey,
    scope: overrideKey.startsWith('exact:') ? 'exact' : args.scope,
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
