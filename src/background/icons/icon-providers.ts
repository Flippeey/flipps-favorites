import type { GetIconRequest, IconCacheRecord, IconOverrideRecord, IconSearchCandidate, ResolvedIcon } from '@/shared/messages';
import { IconFetchError } from '@/shared/messages';
import { writeIconOverrideRecord, deleteIconCacheRecord } from '@/shared/storage';
import {
  faviconProviderUrl,
  faviconRequestSize,
  iconHorseBaseUrl,
  duckDuckGoSearchUrl,
  ddgPrimaryFilter,
  ddgFallbackFilter,
  maxDuckDuckGoResults,
  minimumAcceptedIconSize,
  minimumAutoIconSize,
  minimumOverrideIconSize,
  originFetchTimeoutMs,
  iconHorseTimeoutMs,
  s2TimeoutMs,
  ddgFirstHitTimeoutMs,
  getIconCacheKey,
  getOverrideKey,
} from './icon-constants';
import {
  extractHostname,
  buildSearchQueryFromBookmark,
  tokenizeQuery,
  scoreDuckDuckGoResult,
  isStockPhotoHost,
  isCollageTitle,
  stripHtml,
  clampFaviconSize,
} from './icon-classify';
import {
  parseOriginIconCandidates,
  parseLargestSize,
  extractDuckDuckGoToken,
  getFileNameFromUrl,
  describeError,
} from './icon-parse';
import {
  fetchAndValidateImage,
  fetchWithTimeout,
  getImageDimensions,
  blobToDataUrl,
} from './icon-image';
import { withCorsBypass } from './cors-bypass';
import { sleep } from './concurrency';
import { extractBrandInfo } from '@/shared/url-brand';

interface DuckDuckGoSearchResponse {
  results?: Array<{ image: string; thumbnail: string; title: string; url: string; width: number; height: number }>;
}

export async function fetchS2Favicon(bookmarkUrl: string, cacheKey: string): Promise<IconCacheRecord | null> {
  const providerRequestUrl = `${faviconProviderUrl}?domain_url=${encodeURIComponent(bookmarkUrl)}&sz=${String(clampFaviconSize(faviconRequestSize))}`;
  return fetchAndValidateImage({
    imageUrl: providerRequestUrl,
    bookmarkUrl,
    cacheKey,
    sourceKind: 'favicon',
    timeoutMs: s2TimeoutMs,
    minimumEdge: minimumAcceptedIconSize,
    requireOpaqueCenter: true,
  });
}

export async function gatherOriginIconProbes(hostname: string): Promise<Array<{ url: string; sizeHint: number; weight: number }>> {
  return withCorsBypass(`||${hostname}/`, async () => {
    const origin = `https://${hostname}`;
    let html = '';
    try {
      const response = await fetchWithTimeout(`${origin}/`, originFetchTimeoutMs, {
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
      });
      if (response.ok) {
        html = await response.text();
      }
    } catch {
      html = '';
    }

    const probes: Array<{ url: string; sizeHint: number; weight: number }> = [];
    if (html) {
      probes.push(...parseOriginIconCandidates(html, origin));
      const manifestMatch = html.match(/<link[^>]+rel=["']?manifest["']?[^>]*href=["']([^"']+)["']/i);
      if (manifestMatch?.[1]) {
        try {
          const manifestUrl = new URL(manifestMatch[1], `${origin}/`).toString();
          const manifestResponse = await fetchWithTimeout(manifestUrl, 2500).catch(() => null);
          if (manifestResponse?.ok) {
            const manifest = await manifestResponse.json().catch(() => null) as { icons?: Array<{ src: string; sizes?: string; type?: string }> } | null;
            if (manifest?.icons) {
              for (const icon of manifest.icons) {
                if (!icon.src) continue;
                try {
                  const url = new URL(icon.src, manifestUrl).toString();
                  const sizeHint = parseLargestSize(icon.sizes ?? '');
                  probes.push({ url, sizeHint, weight: 120 });
                } catch {
                  continue;
                }
              }
            }
          }
        } catch {
          // manifest fetch failed
        }
      }
    }

    probes.push(
      { url: `${origin}/apple-touch-icon.png`, sizeHint: 180, weight: 80 },
      { url: `${origin}/apple-touch-icon-precomposed.png`, sizeHint: 180, weight: 75 },
      { url: `${origin}/apple-touch-icon-180x180.png`, sizeHint: 180, weight: 70 },
    );

    const unique = new Map<string, { url: string; sizeHint: number; weight: number }>();
    for (const probe of probes) {
      if (!unique.has(probe.url)) {
        unique.set(probe.url, probe);
      }
    }

    return Array.from(unique.values()).sort(
      (left, right) => (right.sizeHint - left.sizeHint) || (right.weight - left.weight),
    );
  }).catch(() => [] as Array<{ url: string; sizeHint: number; weight: number }>);
}

export async function fetchOriginScrape(bookmarkUrl: string, cacheKey: string): Promise<IconCacheRecord | null> {
  const hostname = extractHostname(bookmarkUrl);
  if (!hostname) return null;

  const ordered = await gatherOriginIconProbes(hostname);
  if (!ordered.length) return null;

  return withCorsBypass(`||${hostname}/`, async () => {
    for (const probe of ordered.slice(0, 8)) {
      const record = await fetchAndValidateImage({
        imageUrl: probe.url,
        bookmarkUrl,
        cacheKey,
        sourceKind: 'origin',
        timeoutMs: originFetchTimeoutMs,
        minimumEdge: minimumAutoIconSize,
        requireOpaqueCenter: true,
      }).catch(() => null);
      if (record) return record;
    }
    return null;
  }).catch(() => null);
}

export async function gatherAuthoritativeCandidates(bookmarkUrl: string): Promise<IconSearchCandidate[]> {
  const hostname = extractHostname(bookmarkUrl);
  if (!hostname) return [];

  const origin = `https://${hostname}`;
  const probes = await gatherOriginIconProbes(hostname);

  const candidates: IconSearchCandidate[] = probes
    .filter(probe => probe.sizeHint === 0 || probe.sizeHint >= 64)
    .map(probe => ({
      imageUrl: probe.url,
      previewUrl: probe.url,
      label: `${hostname} – site icon`,
      sourceKind: 'favicon' as const,
      sourcePageUrl: origin,
    }));

  candidates.push({
    imageUrl: `${iconHorseBaseUrl}${hostname}`,
    previewUrl: `${iconHorseBaseUrl}${hostname}`,
    label: `${hostname} – Icon Horse`,
    sourceKind: 'favicon',
    sourcePageUrl: origin,
  });

  candidates.push({
    imageUrl: `${faviconProviderUrl}?domain_url=${encodeURIComponent(bookmarkUrl)}&sz=256`,
    previewUrl: `${faviconProviderUrl}?domain_url=${encodeURIComponent(bookmarkUrl)}&sz=128`,
    label: `${hostname} – Google favicon`,
    sourceKind: 'favicon',
    sourcePageUrl: origin,
  });

  return candidates;
}

export async function fetchIconHorse(bookmarkUrl: string, cacheKey: string): Promise<IconCacheRecord | null> {
  const hostname = extractHostname(bookmarkUrl);
  if (!hostname) return null;

  return withCorsBypass('||icon.horse/', async () => {
    return fetchAndValidateImage({
      imageUrl: `${iconHorseBaseUrl}${hostname}`,
      bookmarkUrl,
      cacheKey,
      sourceKind: 'iconhorse',
      timeoutMs: iconHorseTimeoutMs,
      minimumEdge: minimumAutoIconSize,
      requireOpaqueCenter: true,
    });
  }).catch(() => null);
}

export async function searchDuckDuckGoImages(query: string, bookmarkUrl?: string): Promise<IconSearchCandidate[]> {
  const queryText = /logo|icon/i.test(query) ? query : `${query} logo`;
  const searchPageUrl = `${duckDuckGoSearchUrl}?q=${encodeURIComponent(queryText)}&ia=images&iax=images`;

  return withCorsBypass('||duckduckgo.com/', async () => {
    const html = await fetch(searchPageUrl, {
      cache: 'no-store',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'X-Requested-With': 'XMLHttpRequest',
      },
    }).then(response => response.text());

    const vqd = extractDuckDuckGoToken(html);
    if (!vqd) {
      return [];
    }

    let data = await fetchDuckDuckGoJson(queryText, vqd, searchPageUrl, ddgPrimaryFilter);
    if ((data.results?.length ?? 0) < 5) {
      const fallbackData = await fetchDuckDuckGoJson(queryText, vqd, searchPageUrl, ddgFallbackFilter)
        .catch(() => ({ results: [] }));
      if ((fallbackData.results?.length ?? 0) > (data.results?.length ?? 0)) {
        data = fallbackData;
      }
    }

    const results = data.results ?? [];
    const rawBookmarkHostname = extractHostname(bookmarkUrl);
    const { isPersonalInfra } = bookmarkUrl ? extractBrandInfo(bookmarkUrl) : { isPersonalInfra: false };
    // For personal-infra hosts the bookmark hostname is a private domain
    // (e.g. flippflix.com behind *.local.flippflix.com). Matching against it
    // boosts the wrong brand — strip it so only query-term matching applies.
    const bookmarkHostname = isPersonalInfra ? null : rawBookmarkHostname;
    const queryTerms = tokenizeQuery(queryText);
    return results
      .filter(result => typeof result.image === 'string' && typeof result.thumbnail === 'string')
      .filter(result => result.width >= 96 && result.height >= 96)
      .filter(result => result.width <= 4096 && result.height <= 4096)
      .filter(result => Math.max(result.width, result.height) / Math.max(1, Math.min(result.width, result.height)) <= 3.5)
      .filter(result => !isStockPhotoHost(extractHostname(result.url)) && !isStockPhotoHost(extractHostname(result.image)))
      .filter(result => !isCollageTitle(stripHtml(result.title)))
      .sort((left, right) => scoreDuckDuckGoResult(right, bookmarkHostname, queryTerms) - scoreDuckDuckGoResult(left, bookmarkHostname, queryTerms))
      .slice(0, maxDuckDuckGoResults)
      .map(result => ({
        imageUrl: result.image,
        previewUrl: result.thumbnail || result.image,
        label: stripHtml(result.title) || query,
        sourceKind: 'search' as const,
        sourcePageUrl: result.url,
      }));
  });
}

export async function fetchDuckDuckGoFirstHit(request: GetIconRequest, cacheKey: string): Promise<IconCacheRecord | null> {
  const query = buildSearchQueryFromBookmark(request.bookmarkUrl);
  if (!query) return null;

  const candidates = await Promise.race([
    searchDuckDuckGoImages(query, request.bookmarkUrl).catch(() => [] as IconSearchCandidate[]),
    sleep(ddgFirstHitTimeoutMs).then(() => [] as IconSearchCandidate[]),
  ]);
  if (!candidates.length) return null;

  for (const candidate of candidates.slice(0, 3)) {
    const record = await fetchAndValidateImage({
      imageUrl: candidate.imageUrl,
      bookmarkUrl: request.bookmarkUrl,
      cacheKey,
      sourceKind: 'search',
      timeoutMs: 4000,
      minimumEdge: minimumAcceptedIconSize,
      requireOpaqueCenter: false,
    }).catch(() => null);
    if (record) return record;

    if (candidate.previewUrl && candidate.previewUrl !== candidate.imageUrl) {
      const previewRecord = await fetchAndValidateImage({
        imageUrl: candidate.previewUrl,
        bookmarkUrl: request.bookmarkUrl,
        cacheKey,
        sourceKind: 'search',
        timeoutMs: 4000,
        minimumEdge: minimumAcceptedIconSize,
        requireOpaqueCenter: false,
      }).catch(() => null);
      if (previewRecord) return previewRecord;
    }
  }
  return null;
}

export async function fetchDuckDuckGoJson(
  queryText: string,
  vqd: string,
  searchPageUrl: string,
  filterParams: string,
): Promise<DuckDuckGoSearchResponse> {
  const requestUrl = `${duckDuckGoSearchUrl}i.js?q=${encodeURIComponent(queryText)}&o=json&vqd=${encodeURIComponent(vqd)}${filterParams}&p=1&l=us-en`;
  const response = await fetch(requestUrl, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
    referrer: searchPageUrl,
    referrerPolicy: 'origin-when-cross-origin',
  });
  if (!response.ok) {
    throw new Error(`DuckDuckGo search failed with ${String(response.status)}`);
  }
  return response.json() as Promise<DuckDuckGoSearchResponse>;
}

export async function downloadAndPersistOverride(
  bookmarkUrl: string,
  imageUrl: string,
  fileName?: string,
): Promise<ResolvedIcon> {
  let response: Response;
  try {
    response = await fetch(imageUrl, { cache: 'force-cache' });
  } catch (error) {
    throw new IconFetchError('network', `Could not reach the icon URL: ${describeError(error)}`);
  }

  if (!response.ok) {
    throw new IconFetchError('http-status', `Icon image request failed with ${String(response.status)}.`, response.status);
  }

  const blob = await response.blob().catch((error: unknown) => {
    throw new IconFetchError('decode-fail', `Could not read icon body: ${describeError(error)}`);
  });

  const mimeType = blob.type || 'image/png';
  if (!mimeType.startsWith('image/')) {
    throw new IconFetchError('not-image', 'Remote icon response is not an image.');
  }

  let dimensions: { width: number; height: number };
  try {
    dimensions = await getImageDimensions(blob);
  } catch (error) {
    throw new IconFetchError('decode-fail', `Could not decode icon image: ${describeError(error)}`);
  }

  if (
    dimensions.width < minimumOverrideIconSize ||
    dimensions.height < minimumOverrideIconSize
  ) {
    throw new IconFetchError(
      'too-small',
      `Icon is ${String(dimensions.width)}x${String(dimensions.height)}; minimum is ${String(minimumOverrideIconSize)}x${String(minimumOverrideIconSize)}.`,
    );
  }

  const dataUrl = await blobToDataUrl(blob, mimeType);
  const now = Date.now();
  const cacheKey = getIconCacheKey(bookmarkUrl);
  const overrideKey = getOverrideKey(bookmarkUrl);
  const record: IconOverrideRecord = {
    overrideKey,
    bookmarkUrl,
    dataUrl,
    fileName: fileName || getFileNameFromUrl(imageUrl),
    mimeType,
    updatedAt: now,
  };

  await writeIconOverrideRecord(record);
  await deleteIconCacheRecord(cacheKey);

  return {
    cacheKey,
    sourceKind: 'override',
    dataUrl,
    lastUpdated: now,
    isFallback: false,
  };
}
