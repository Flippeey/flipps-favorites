import type { GetIconRequest, IconCacheRecord, IconOverrideRecord, IconSearchCandidate, IconSourceKind, ResolvedIcon, SetIconOverrideRequest } from '../../shared/messages';
import { IconFetchError } from '../../shared/messages';
import { extensionApi } from '../../shared/browser';
import { deleteAllIconCacheRecords, deleteIconCacheRecord, deleteIconOverrideRecord, readIconCacheRecord, readIconCacheRecords, readIconOverrideRecord, writeIconCacheRecord, writeIconOverrideRecord } from '../../shared/storage';
import { extractBrandInfo } from '../../shared/url-brand';

const iconPipelineVersion = 'bookmark-icons-v7';
const faviconProviderUrl = 'https://www.google.com/s2/favicons';
const faviconRequestSize = 256;
const duckDuckGoSearchUrl = 'https://duckduckgo.com/';
const iconHorseBaseUrl = 'https://icon.horse/icon/';
const minimumAcceptedIconSize = 64;
const minimumAutoIconSize = 96;
const minimumOverrideIconSize = 64;
const maxDuckDuckGoResults = 30;
const ddgPrimaryFilter = '&f=,clipart,Square,Transparent';
const ddgFallbackFilter = '&f=,,Medium,Square';
const cacheTtlMs = 30 * 24 * 60 * 60 * 1000; // 30 days
const autoSourceTimeoutMs = 3000;
const originFetchTimeoutMs = 2000;
const iconHorseTimeoutMs = 2500;
const s2TimeoutMs = 2000;
const ddgFirstHitTimeoutMs = 4000;
const sweepBatchSize = 4;
const sweepBatchSpacingMs = 250;
const maxConcurrentResolutions = 6;
let corsBypassRuleCounter = 0;
const inFlightIcons = new Map<string, Promise<ResolvedIcon>>();
const inFlightRefreshes = new Set<string>();

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

async function downloadAndPersistOverride(
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
  return persistIconOverride({
    bookmarkUrl,
    dataUrl,
    fileName: fileName || getFileNameFromUrl(imageUrl),
    mimeType,
  });
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
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

async function fetchS2Favicon(bookmarkUrl: string, cacheKey: string): Promise<IconCacheRecord | null> {
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


function createGeneratedRecord(bookmarkUrl: string, bookmarkTitle: string | undefined, cacheKey: string): IconCacheRecord {
  const label = getIconLabel(bookmarkTitle, bookmarkUrl);
  const initials = label.slice(0, 2).toUpperCase();
  const background = getColorFromLabel(label);
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" role="img" aria-hidden="true">',
    '<defs>',
    `<linearGradient id="bookmark-gradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${background.start}" /><stop offset="100%" stop-color="${background.end}" /></linearGradient>`,
    '</defs>',
    '<rect width="96" height="96" rx="24" fill="url(#bookmark-gradient)" />',
    `<text x="48" y="54" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="32" font-weight="700" fill="#FFFFFF">${escapeSvgText(initials || '•')}</text>`,
    '</svg>',
  ].join('');
  const dataUrl = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;

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

function toResolvedIcon(record: IconCacheRecord): ResolvedIcon {
  return {
    cacheKey: record.cacheKey,
    sourceKind: record.sourceKind,
    dataUrl: record.dataUrl,
    lastUpdated: record.updatedAt,
    isFallback: record.sourceKind === 'generated',
  };
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

function getIconCacheKey(bookmarkUrl: string): string {
  return `icon:${bookmarkUrl}`;
}

function getOverrideKey(bookmarkUrl: string): string {
  return `override:${bookmarkUrl}`;
}

function getIconLabel(bookmarkTitle: string | undefined, bookmarkUrl: string): string {
  const trimmedTitle = bookmarkTitle?.trim();
  if (trimmedTitle) {
    return trimmedTitle;
  }

  try {
    const hostname = new URL(bookmarkUrl).hostname.replace(/^www\./, '');
    return hostname || 'Link';
  } catch {
    return 'Link';
  }
}

function extractHostname(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).hostname.replace(/^www\./, '') || null;
  } catch {
    try {
      return new URL(`https://${value}`).hostname.replace(/^www\./, '') || null;
    } catch {
      return null;
    }
  }
}


function buildSearchQueryFromBookmark(bookmarkUrl?: string): string {
  if (!bookmarkUrl) return '';
  const { brand, isPersonalInfra } = extractBrandInfo(bookmarkUrl);
  if (brand) {
    return `${brand} logo`.trim();
  }
  // Fallback for unusual hostnames where brand extraction yielded nothing.
  const hostname = extractHostname(bookmarkUrl);
  if (!hostname) return '';
  if (isPersonalInfra) {
    const first = hostname.split('.')[0];
    return first ? `${first} logo`.trim() : '';
  }
  const parts = hostname.split('.');
  const core = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0];
  return `${core} logo`.trim();
}

function getColorFromLabel(label: string): { start: string; end: string } {
  const seed = Array.from(label).reduce((total, character) => total + character.charCodeAt(0), 0);
  const hue = seed % 360;
  return {
    start: `hsl(${String(hue)} 70% 58%)`,
    end: `hsl(${String((hue + 36) % 360)} 68% 40%)`,
  };
}

function escapeSvgText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function isDataUrl(value: string): boolean {
  return value.startsWith('data:image/');
}

function normalizeDataUrl(value: string, mimeType: string): string {
  if (value.startsWith(`data:${mimeType}`) || value.startsWith('data:image/')) {
    return value;
  }
  throw new Error('Icon override must be provided as a data URL.');
}

function getFileNameFromUrl(imageUrl: string): string {
  try {
    const pathname = new URL(imageUrl).pathname;
    const name = pathname.split('/').pop();
    return name || 'icon';
  } catch {
    return 'icon';
  }
}

async function searchDuckDuckGoImages(query: string, bookmarkUrl?: string): Promise<IconSearchCandidate[]> {
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

async function fetchDuckDuckGoFirstHit(request: GetIconRequest, cacheKey: string): Promise<IconCacheRecord | null> {
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

async function gatherOriginIconProbes(hostname: string): Promise<Array<{ url: string; sizeHint: number; weight: number }>> {
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

async function fetchOriginScrape(bookmarkUrl: string, cacheKey: string): Promise<IconCacheRecord | null> {
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

async function gatherAuthoritativeCandidates(bookmarkUrl: string): Promise<IconSearchCandidate[]> {
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

async function fetchIconHorse(bookmarkUrl: string, cacheKey: string): Promise<IconCacheRecord | null> {
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

function parseOriginIconCandidates(html: string, origin: string): Array<{ url: string; sizeHint: number; weight: number }> {
  const candidates: Array<{ url: string; sizeHint: number; weight: number }> = [];
  const linkRegex = /<link\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null) {
    const tag = match[0];
    const rel = extractAttr(tag, 'rel')?.toLowerCase() ?? '';
    if (!/(icon|apple-touch-icon|shortcut icon|mask-icon|fluid-icon)/.test(rel)) continue;
    const href = extractAttr(tag, 'href');
    if (!href) continue;
    let absolute: string;
    try {
      absolute = new URL(href, `${origin}/`).toString();
    } catch {
      continue;
    }
    const sizesAttr = extractAttr(tag, 'sizes') ?? '';
    const sizeHint = parseLargestSize(sizesAttr);
    let weight = 50;
    if (rel.includes('apple-touch-icon')) weight = 100;
    else if (rel.includes('mask-icon')) weight = 30;
    else if (rel.includes('shortcut icon')) weight = 60;
    candidates.push({ url: absolute, sizeHint, weight });
  }
  return candidates;
}

function extractAttr(tag: string, attr: string): string | null {
  const re = new RegExp(`${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = tag.match(re);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

function parseLargestSize(sizes: string): number {
  if (!sizes) return 0;
  let best = 0;
  for (const part of sizes.toLowerCase().split(/\s+/)) {
    if (part === 'any') {
      best = Math.max(best, 512);
      continue;
    }
    const m = part.match(/^(\d+)x(\d+)$/);
    if (m) {
      const edge = Math.min(Number(m[1]), Number(m[2]));
      if (Number.isFinite(edge)) {
        best = Math.max(best, edge);
      }
    }
  }
  return best;
}

interface FetchAndValidateArgs {
  imageUrl: string;
  bookmarkUrl: string;
  cacheKey: string;
  sourceKind: Exclude<IconSourceKind, 'override'>;
  timeoutMs: number;
  minimumEdge: number;
  requireOpaqueCenter: boolean;
}

async function fetchAndValidateImage(args: FetchAndValidateArgs): Promise<IconCacheRecord | null> {
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

function hasOpaqueCenter(bitmap: ImageBitmap): boolean {
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

async function fetchWithTimeout(url: string, timeoutMs: number, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function withCorsBypass<T>(urlFilter: string, fn: () => Promise<T>): Promise<T> {
  const ruleId = ++corsBypassRuleCounter;
  let ruleAdded = false;
  if (extensionApi.declarativeNetRequest?.updateSessionRules) {
    try {
      await extensionApi.declarativeNetRequest.updateSessionRules({
        addRules: [{
          id: ruleId,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            responseHeaders: [
              { header: 'access-control-allow-origin', operation: 'set', value: '*' },
            ],
          },
          condition: {
            urlFilter,
            resourceTypes: ['xmlhttprequest', 'other'],
          },
        }],
      });
      ruleAdded = true;
    } catch {
      // declarativeNetRequest unavailable — proceed without CORS header injection
    }
  }

  try {
    return await fn();
  } finally {
    if (ruleAdded) {
      await extensionApi.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [ruleId],
      }).catch(() => undefined);
    }
  }
}

async function firstSuccessful<T>(promises: Array<Promise<T | null>>): Promise<T | null> {
  if (!promises.length) return null;
  return new Promise(resolve => {
    let pending = promises.length;
    let settled = false;
    for (const promise of promises) {
      promise.then(value => {
        if (!settled && value !== null && value !== undefined) {
          settled = true;
          resolve(value);
        }
      }).catch(() => undefined).finally(() => {
        pending -= 1;
        if (pending === 0 && !settled) {
          settled = true;
          resolve(null);
        }
      });
    }
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class ResolutionSemaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active >= this.limit) {
      await new Promise<void>(resolve => this.queue.push(resolve));
    }
    this.active += 1;
    return () => this.release();
  }

  private release(): void {
    this.active -= 1;
    const next = this.queue.shift();
    if (next) next();
  }
}

const resolutionSemaphore = new ResolutionSemaphore(maxConcurrentResolutions);

interface DuckDuckGoSearchResponse {
  results?: Array<{ image: string; thumbnail: string; title: string; url: string; width: number; height: number }>;
}

async function fetchDuckDuckGoJson(
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

function extractDuckDuckGoToken(html: string): string | null {
  const match =
    html.match(/vqd=['"]([^'"]+)['"]/) ??
    html.match(/"vqd"\s*:\s*"([^"]+)"/) ??
    html.match(/data-vqd=["']([^"']+)["']/) ??
    html.match(/vqd\s*=\s*['"]([^'"]+)['"]/) ??
    html.match(/vqd=([A-Za-z0-9%._-]+)/);
  return match?.[1] ?? null;
}

function scoreDuckDuckGoResult(
  result: { image: string; thumbnail: string; title: string; url: string; width: number; height: number },
  bookmarkHostname: string | null,
  queryTerms: string[],
): number {
  let score = 0;
  const sourceHostname = extractHostname(result.url);
  const imageHostname = extractHostname(result.image);
  const normalizedTitle = stripHtml(result.title).toLowerCase();
  const imageArea = result.width * result.height;
  const aspectRatio = Math.max(result.width, result.height) / Math.max(1, Math.min(result.width, result.height));

  if (bookmarkHostname) {
    const bookmarkRoot = getDomainRoot(bookmarkHostname);
    const sourceRoot = getDomainRoot(sourceHostname);
    const imageRoot = getDomainRoot(imageHostname);

    if (sourceHostname === bookmarkHostname) {
      score += 400;
    } else if (sourceRoot && bookmarkRoot && sourceRoot === bookmarkRoot) {
      score += 200;
    }

    if (imageHostname === bookmarkHostname) {
      score += 300;
    } else if (imageRoot && bookmarkRoot && imageRoot === bookmarkRoot) {
      score += 150;
    }
  }

  if (isLogoAggregatorHost(sourceHostname) || isLogoAggregatorHost(imageHostname)) {
    score += 600;
  }

  for (const term of queryTerms) {
    if (normalizedTitle.includes(term)) {
      score += 220;
    }
    if (sourceHostname?.includes(term)) {
      score += 350;
    }
    if (imageHostname?.includes(term)) {
      score += 260;
    }
  }

  if (/logo|icon|brand|symbol/i.test(normalizedTitle)) {
    score += 140;
  }

  if (/icon|logo|favicon|apple-touch-icon/i.test(result.image)) {
    score += 300;
  }

  if (/screenshot|banner|header|cover|hero/i.test(result.image)) {
    score -= 600;
  }

  if (/screenshot|banner|cover|hero/i.test(normalizedTitle)) {
    score -= 400;
  }

  if (/\/(icons?|logos?|favicons?|brand|assets?\/(icon|logo|brand))\//i.test(result.image)) {
    score += 400;
  }

  if (/\.svg(?:$|\?)/i.test(result.image)) {
    score += 500;
  }

  if (aspectRatio <= 1.05) {
    score += 300;
  } else if (aspectRatio <= 1.15) {
    score += 150;
  }

  if (imageArea >= 256 * 256 && imageArea <= 1200 * 1200) {
    score += 180;
  } else {
    score += Math.min(120, Math.round(imageArea / 20000));
  }

  if (isLikelyAggregatorHost(sourceHostname) || isLikelyAggregatorHost(imageHostname)) {
    score -= 1500;
  }

  return score;
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(part => part.trim())
    .filter(part => part.length >= 3)
    .filter(part => part !== 'logo' && part !== 'icon');
}

function getDomainRoot(hostname: string | null): string | null {
  if (!hostname) {
    return null;
  }

  const parts = hostname.split('.').filter(Boolean);
  if (parts.length < 2) {
    return hostname;
  }

  return parts.slice(-2).join('.');
}

function isLikelyAggregatorHost(hostname: string | null): boolean {
  if (!hostname) {
    return false;
  }

  return [
    'pinterest.',
    'pinimg.',
    'wikimedia.',
    'wikipedia.',
    'fandom.',
    'bing.',
    'msn.',
    'redd.it',
  ].some(fragment => hostname.includes(fragment));
}

function isLogoAggregatorHost(hostname: string | null): boolean {
  if (!hostname) {
    return false;
  }

  return [
    'seeklogo.',
    'vectorseek.',
    'brandslogos.',
    'pngwing.',
    'worldvectorlogo.',
    'logos-world.',
    'logos-download.',
    'logodownload.',
    'logo.wine',
    'logosvector.',
    'logotyp.us',
    'cdn.worldvectorlogo.',
    'brandlogos.',
    'freebiesupply.',
    'logoeps.',
  ].some(fragment => hostname.includes(fragment));
}

function isStockPhotoHost(hostname: string | null): boolean {
  if (!hostname) {
    return false;
  }

  return [
    'alamy.',
    'shutterstock.',
    'gettyimages.',
    'istockphoto.',
    'dreamstime.',
    'depositphotos.',
    '123rf.',
    'vectorstock.',
    'freepik.',
    'adobestock.',
    'stock.adobe.',
    'canstockphoto.',
    'bigstockphoto.',
  ].some(fragment => hostname.includes(fragment));
}

function isCollageTitle(title: string): boolean {
  const lowered = title.toLowerCase();
  return /\b(set|collection|various|bundle|pack|collage|montage|assorted|logos\s+pack|icons\s+set|logo\s+set)\b/.test(lowered);
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, '').trim();
}

function getDomainCandidates(bookmarkUrl: string): IconSearchCandidate[] {
  const hostname = extractHostname(bookmarkUrl);
  if (!hostname) {
    return [];
  }

  return [{
    imageUrl: `${faviconProviderUrl}?domain_url=${encodeURIComponent(bookmarkUrl)}&sz=256`,
    previewUrl: `${faviconProviderUrl}?domain_url=${encodeURIComponent(bookmarkUrl)}&sz=128`,
    label: hostname,
    sourceKind: 'favicon',
    sourcePageUrl: `https://${hostname}`,
  }];
}

function dedupeIconCandidates(candidates: IconSearchCandidate[]): IconSearchCandidate[] {
  const unique = new Map<string, IconSearchCandidate>();
  for (const candidate of candidates) {
    if (!unique.has(candidate.imageUrl)) {
      unique.set(candidate.imageUrl, candidate);
    }
  }
  return Array.from(unique.values());
}

function clampFaviconSize(value: number): number {
  const rounded = Math.round(value);
  return Math.max(128, Math.min(256, rounded));
}

async function getImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

async function blobToDataUrl(blob: Blob, mimeType: string): Promise<string> {
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