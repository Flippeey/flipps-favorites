export const iconPipelineVersion = 'bookmark-icons-v11';
export const faviconProviderUrl = 'https://www.google.com/s2/favicons';
export const faviconRequestSize = 256;
export const duckDuckGoSearchUrl = 'https://duckduckgo.com/';
export const iconHorseBaseUrl = 'https://icon.horse/icon/';
export const minimumAcceptedIconSize = 64;
export const maxSvgIconBytes = 256 * 1024;
export const minimumAutoIconSize = 96;
export const minimumOverrideIconSize = 64;
export const maxDuckDuckGoResults = 30;
export const ddgPrimaryFilter = '&f=,clipart,Square,Transparent';
export const ddgFallbackFilter = '&f=,,Medium,Square';
export const cacheTtlMs = 30 * 24 * 60 * 60 * 1000; // 30 days
export const autoSourceTimeoutMs = 3000;
export const originFetchTimeoutMs = 2000;
export const iconHorseTimeoutMs = 2500;
export const s2TimeoutMs = 2000;
export const ddgFirstHitTimeoutMs = 4000;
// Total time budget for the candidate fetch loop in fetchDuckDuckGoFirstHit.
// Caps worst-case latency (8 candidates x 2 fetches x 4s each = 64s) to prevent
// semaphore starvation. Returns best result found so far / null when exceeded.
export const ddgCandidateBudgetMs = 15_000;
export const sweepBatchSize = 4;
export const sweepBatchSpacingMs = 250;
export const maxConcurrentResolutions = 6;

// Automatic resolution is host-derived (origin scrape by hostname, S2 by domain,
// DDG query built from the URL's brand), so cache per host: N bookmarks on
// dev.azure.com share one resolution + one stored record instead of N.
export function getIconCacheKey(bookmarkUrl: string): string {
  try {
    const hostname = new URL(bookmarkUrl).hostname.toLowerCase().replace(/^www\./, '');
    if (hostname) return `icon:host:${hostname}`;
  } catch {
    // not a parseable URL — fall through to the exact-URL key
  }
  return `icon:${bookmarkUrl}`;
}
