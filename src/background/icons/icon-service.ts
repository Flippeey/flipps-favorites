import type { GetIconRequest, IconCacheRecord, IconOverrideRecord, IconSearchCandidate, ResolvedIcon, SetIconOverrideRequest } from '../../shared/messages';
import { deleteAllIconCacheRecords, deleteIconCacheRecord, deleteIconOverrideRecord, readIconCacheRecord, readIconOverrideRecord, writeIconCacheRecord, writeIconOverrideRecord } from '../../shared/storage';

const iconPipelineVersion = 'bookmark-icons-v5';
const faviconProviderUrl = 'https://www.google.com/s2/favicons';
const faviconRequestSize = 256;
const duckDuckGoSearchUrl = 'https://duckduckgo.com/';
const minimumAcceptedIconSize = 48;
const maxDuckDuckGoResults = 30;
const inFlightIcons = new Map<string, Promise<ResolvedIcon>>();

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

export async function setIconOverrideFromUrl(bookmarkUrl: string, imageUrl: string, fileName?: string): Promise<ResolvedIcon> {
  const response = await fetch(imageUrl, { cache: 'force-cache' });
  if (!response.ok) {
    throw new Error(`Icon image request failed with ${String(response.status)}`);
  }

  const blob = await response.blob();
  const mimeType = blob.type || 'image/png';
  if (!mimeType.startsWith('image/')) {
    throw new Error('Remote icon response is not an image.');
  }

  const dataUrl = await blobToDataUrl(blob, mimeType);
  return persistIconOverride({
    bookmarkUrl,
    dataUrl,
    fileName: fileName || getFileNameFromUrl(imageUrl),
    mimeType,
  });
}

export async function searchIcons(query: string, bookmarkUrl?: string): Promise<IconSearchCandidate[]> {
  const normalizedQuery = query.trim();
  const fallbackQuery = normalizedQuery || buildSearchQueryFromBookmark(bookmarkUrl);
  const fallbackCandidates = bookmarkUrl ? getDomainCandidates(bookmarkUrl) : [];
  if (!fallbackQuery) {
    return fallbackCandidates;
  }

  const remoteCandidates = await searchDuckDuckGoImages(fallbackQuery, bookmarkUrl).catch(() => []);
  if (remoteCandidates.length) {
    return dedupeIconCandidates(remoteCandidates).slice(0, maxDuckDuckGoResults);
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
    return toResolvedIcon(cached);
  }

  const faviconRecord = await createFaviconRecord(request.bookmarkUrl, cacheKey).catch(() => null);
  if (faviconRecord) {
    await writeIconCacheRecord(faviconRecord);
    return toResolvedIcon(faviconRecord);
  }

  const searchRecord = await createSearchRecord(request.bookmarkUrl, request.bookmarkTitle, cacheKey).catch(() => null);
  if (searchRecord) {
    await writeIconCacheRecord(searchRecord);
    return toResolvedIcon(searchRecord);
  }

  const generatedRecord = createGeneratedRecord(request.bookmarkUrl, request.bookmarkTitle, cacheKey);
  await writeIconCacheRecord(generatedRecord);
  return toResolvedIcon(generatedRecord);
}

async function createFaviconRecord(bookmarkUrl: string, cacheKey: string): Promise<IconCacheRecord> {
  const providerRequestUrl = `${faviconProviderUrl}?domain_url=${encodeURIComponent(bookmarkUrl)}&sz=${String(clampFaviconSize(faviconRequestSize))}`;
  const response = await fetch(providerRequestUrl, { cache: 'force-cache' });
  if (!response.ok) {
    throw new Error(`Favicon request failed with ${String(response.status)}`);
  }

  const blob = await response.blob();
  const mimeType = blob.type || 'image/png';
  if (!mimeType.startsWith('image/')) {
    throw new Error('Favicon response is not an image.');
  }

  const dimensions = await getImageDimensions(blob);
  assertImageIsUseful(dimensions);

  const dataUrl = await blobToDataUrl(blob, mimeType);
  if (!isDataUrl(dataUrl)) {
    throw new Error('Favicon conversion failed.');
  }

  return {
    cacheKey,
    bookmarkUrl,
    sourceKind: 'favicon',
    dataUrl,
    mimeType,
    updatedAt: Date.now(),
    pipelineVersion: iconPipelineVersion,
  };
}

async function createSearchRecord(bookmarkUrl: string, bookmarkTitle: string | undefined, cacheKey: string): Promise<IconCacheRecord> {
  const query = buildSearchQuery(bookmarkUrl, bookmarkTitle);
  const candidates = await searchDuckDuckGoImages(query, bookmarkUrl);
  const firstCandidate = candidates[0];
  if (!firstCandidate) {
    throw new Error('No DuckDuckGo icon candidates found.');
  }

  const response = await fetch(firstCandidate.imageUrl, { cache: 'force-cache' });
  if (!response.ok) {
    throw new Error(`DuckDuckGo icon fetch failed with ${String(response.status)}`);
  }

  const blob = await response.blob();
  const mimeType = blob.type || 'image/png';
  if (!mimeType.startsWith('image/')) {
    throw new Error('DuckDuckGo icon response is not an image.');
  }

  assertImageIsUseful(await getImageDimensions(blob));

  return {
    cacheKey,
    bookmarkUrl,
    sourceKind: 'search',
    dataUrl: await blobToDataUrl(blob, mimeType),
    mimeType,
    updatedAt: Date.now(),
    pipelineVersion: iconPipelineVersion,
  };
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

function buildSearchQuery(bookmarkUrl: string, bookmarkTitle: string | undefined): string {
  const trimmedTitle = bookmarkTitle?.trim();
  if (trimmedTitle) {
    return /logo/i.test(trimmedTitle) ? trimmedTitle : `${trimmedTitle} logo`;
  }

  return buildSearchQueryFromBookmark(bookmarkUrl) || 'website logo';
}

function buildSearchQueryFromBookmark(bookmarkUrl?: string): string {
  const hostname = extractHostname(bookmarkUrl);
  if (!hostname) {
    return '';
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
  const queryText = /logo/i.test(query) ? query : `${query} logo`;
  const searchPageUrl = `${duckDuckGoSearchUrl}?q=${encodeURIComponent(queryText)}&ia=images&iax=images`;
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

  const data = await fetch(`${duckDuckGoSearchUrl}i.js?q=${encodeURIComponent(queryText)}&o=json&vqd=${encodeURIComponent(vqd)}&f=,,,&p=1&l=us-en`, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
    referrer: searchPageUrl,
    referrerPolicy: 'origin-when-cross-origin',
  }).then(async response => {
    if (!response.ok) {
      throw new Error(`DuckDuckGo search failed with ${String(response.status)}`);
    }
    return response.json() as Promise<{ results?: Array<{ image: string; thumbnail: string; title: string; url: string; width: number; height: number }> }>;
  });

  const results = data.results ?? [];
  const bookmarkHostname = extractHostname(bookmarkUrl);
  const queryTerms = tokenizeQuery(queryText);
  return results
    .filter(result => typeof result.image === 'string' && typeof result.thumbnail === 'string')
    .filter(result => result.width >= 200 && result.height >= 200)
    .filter(result => result.width <= 1600 && result.height <= 1600)
    .filter(result => Math.max(result.width, result.height) / Math.min(result.width, result.height) <= 2)
    .sort((left, right) => scoreDuckDuckGoResult(right, bookmarkHostname, queryTerms) - scoreDuckDuckGoResult(left, bookmarkHostname, queryTerms))
    .slice(0, maxDuckDuckGoResults)
    .map(result => ({
      imageUrl: result.image,
      previewUrl: result.thumbnail || result.image,
      label: stripHtml(result.title) || query,
      sourceKind: 'search' as const,
      sourcePageUrl: result.url,
    }));
}

function extractDuckDuckGoToken(html: string): string | null {
  const match = html.match(/vqd=['"]([^'"]+)['"]/) ?? html.match(/"vqd"\s*:\s*"([^"]+)"/) ?? html.match(/vqd=([A-Za-z0-9%._-]+)/);
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
      score += 6000;
    } else if (sourceRoot && bookmarkRoot && sourceRoot === bookmarkRoot) {
      score += 4500;
    }

    if (imageHostname === bookmarkHostname) {
      score += 4000;
    } else if (imageRoot && bookmarkRoot && imageRoot === bookmarkRoot) {
      score += 2500;
    }
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

  if (/\.svg(?:$|\?)/i.test(result.image)) {
    score += 500;
  }

  if (aspectRatio <= 1.2) {
    score += 250;
  } else if (aspectRatio <= 1.5) {
    score += 100;
  }

  if (imageArea >= 256 * 256 && imageArea <= 1200 * 1200) {
    score += 180;
  } else {
    score += Math.min(120, Math.round(imageArea / 20000));
  }

  if (isLikelyAggregatorHost(sourceHostname) || isLikelyAggregatorHost(imageHostname)) {
    score -= 600;
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

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, '').trim();
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

function assertImageIsUseful(dimensions: { width: number; height: number }): void {
  if (dimensions.width < minimumAcceptedIconSize || dimensions.height < minimumAcceptedIconSize) {
    throw new Error('Icon image is too small to use.');
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