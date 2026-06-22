// Bumped v11->v12 to invalidate all cached IH records so the new placeholder gate
// applies globally. A surgical sweep of only 'iconhorse' sourceKind records would
// avoid re-resolving origin/S2/DDG records, but the global bump is the established
// pattern and simplest to reason about. Surgical IH-only invalidation is a possible
// future optimization if the full sweep causes noticeable re-resolution latency.
export const iconPipelineVersion = 'bookmark-icons-v12';
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
// Icon Horse placeholder detection constants.
// Compound gate: few colors + dominant + achromatic LIGHT-grey = placeholder.
//
// Calibrated from real Icon Horse responses (16x16 downscaled, 6-bit quantized):
//   Placeholders:  dela.nl     (5 colors, 89.8% dominant, grey 226,226,226, brightness 226)
//                  phidec.twinq.nl (4 colors, 93.8% dominant, grey 226,226,226, brightness 226)
//   Real low-color: YouTube    (4 colors, 93.0%, RED 255,0,51) -- NOT grey (saturated)
//                   Twitter    (5 colors, 89.1%, BLACK 0,0,0)  -- too dark (brightness 0)
//                   Spotify    (4 colors, 57.6%, GREEN 30,215,96) -- saturated
//                   Microsoft  (4 colors, 25.0%, multicolor)   -- no single dominant
//   Real grey logos (MUST be kept):
//                   Apple silver  (dominant ~153,153,158, brightness ~155) -- below floor
//                   Grey "W" logo (dominant ~170,170,170, brightness 170) -- below floor
//                   Dark grey     (dominant ~85,85,85, brightness 85)     -- below floor
//
// Brightness band [200, 240] hugs IH's light-grey (~226) while letting dark/mid greys escape.
// The achromatic + light-grey brightness check is the key discriminator.
export const placeholderMaxDistinctColors = 6;
export const placeholderMinDominantRatio = 0.85;
export const placeholderMaxSaturation = 20;
export const placeholderMinBrightness = 200;
export const placeholderMaxBrightness = 240;

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
