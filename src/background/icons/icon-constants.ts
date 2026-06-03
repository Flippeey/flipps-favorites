export const iconPipelineVersion = 'bookmark-icons-v8';
export const faviconProviderUrl = 'https://www.google.com/s2/favicons';
export const faviconRequestSize = 256;
export const duckDuckGoSearchUrl = 'https://duckduckgo.com/';
export const iconHorseBaseUrl = 'https://icon.horse/icon/';
export const minimumAcceptedIconSize = 64;
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
export const sweepBatchSize = 4;
export const sweepBatchSpacingMs = 250;
export const maxConcurrentResolutions = 6;

export function getIconCacheKey(bookmarkUrl: string): string {
  return `icon:${bookmarkUrl}`;
}

export function getOverrideKey(bookmarkUrl: string): string {
  return `override:${bookmarkUrl}`;
}
