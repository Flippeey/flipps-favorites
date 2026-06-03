import type { IconSearchCandidate } from '@/shared/messages';
import { extractBrandInfo } from '@/shared/url-brand';
import { faviconProviderUrl } from './icon-constants';

export function getIconLabel(bookmarkTitle: string | undefined, bookmarkUrl: string): string {
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

export function extractHostname(value: string | undefined): string | null {
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

export function buildSearchQueryFromBookmark(bookmarkUrl?: string): string {
  if (!bookmarkUrl) return '';
  const { brand, subdomain, isPersonalInfra } = extractBrandInfo(bookmarkUrl);
  if (brand) {
    // Combine root brand + meaningful subdomain so multi-tenant hosts resolve their
    // own product ('google drive', 'google play') instead of the parent brand.
    return `${subdomain ? `${brand} ${subdomain}` : brand} logo`.trim();
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

export function getDomainCandidates(bookmarkUrl: string): IconSearchCandidate[] {
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

export function dedupeIconCandidates(candidates: IconSearchCandidate[]): IconSearchCandidate[] {
  const unique = new Map<string, IconSearchCandidate>();
  for (const candidate of candidates) {
    if (!unique.has(candidate.imageUrl)) {
      unique.set(candidate.imageUrl, candidate);
    }
  }
  return Array.from(unique.values());
}

export function clampFaviconSize(value: number): number {
  const rounded = Math.round(value);
  return Math.max(128, Math.min(256, rounded));
}

export function scoreDuckDuckGoResult(
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

export function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(part => part.trim())
    .filter(part => part.length >= 3)
    .filter(part => part !== 'logo' && part !== 'icon');
}

export function getDomainRoot(hostname: string | null): string | null {
  if (!hostname) {
    return null;
  }

  const parts = hostname.split('.').filter(Boolean);
  if (parts.length < 2) {
    return hostname;
  }

  return parts.slice(-2).join('.');
}

export function isLikelyAggregatorHost(hostname: string | null): boolean {
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

export function isLogoAggregatorHost(hostname: string | null): boolean {
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

export function isStockPhotoHost(hostname: string | null): boolean {
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

export function isCollageTitle(title: string): boolean {
  const lowered = title.toLowerCase();
  return /\b(set|collection|various|bundle|pack|collage|montage|assorted|logos\s+pack|icons\s+set|logo\s+set)\b/.test(lowered);
}

export function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, '').trim();
}
