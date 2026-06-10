import { getIcon } from './messaging';
import { getRegistrableDomain, getScopeHostname, type IconOverrideScope } from '@/shared/icon-scope';

export const iconCache = new Map<string, string>();
export const inflight = new Map<string, Promise<string>>();
export const subscribers = new Map<string, Set<() => void>>();

export function invalidateFaviconCache(url: string): void {
  iconCache.delete(url);
  inflight.delete(url);
  const listeners = subscribers.get(url);
  if (listeners) {
    listeners.forEach(fn => fn());
  }
}

// A host/domain-scoped override changes the icon of every tile on that site, so
// the per-URL page cache must drop all matching entries, not just the edited one.
export function invalidateFaviconCacheForScope(url: string, scope: IconOverrideScope): void {
  if (scope === 'exact') {
    invalidateFaviconCache(url);
    return;
  }
  const hostname = getScopeHostname(url);
  if (!hostname) {
    invalidateFaviconCache(url);
    return;
  }
  const root = getRegistrableDomain(hostname);
  const matches = (candidateUrl: string): boolean => {
    const candidateHost = getScopeHostname(candidateUrl);
    if (!candidateHost) return candidateUrl === url;
    if (scope === 'host') return candidateHost === hostname;
    return getRegistrableDomain(candidateHost) === root;
  };
  const knownUrls = new Set([url, ...iconCache.keys(), ...inflight.keys(), ...subscribers.keys()]);
  for (const knownUrl of knownUrls) {
    if (matches(knownUrl)) {
      invalidateFaviconCache(knownUrl);
    }
  }
}

export function subscribeFaviconCache(url: string, listener: () => void): () => void {
  let set = subscribers.get(url);
  if (!set) {
    set = new Set();
    subscribers.set(url, set);
  }
  set.add(listener);
  return () => {
    const current = subscribers.get(url);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) subscribers.delete(url);
  };
}

export function isFaviconCached(url: string): boolean {
  return iconCache.has(url);
}

export async function prefetchFavicon(url: string, title?: string): Promise<void> {
  try {
    await fetchIcon(url, title);
  } catch {
    // ignore — prefetch is best-effort
  }
}

export async function fetchIcon(url: string, title?: string): Promise<string> {
  const cached = iconCache.get(url);
  if (cached) return cached;
  const inflightPromise = inflight.get(url);
  if (inflightPromise) return inflightPromise;
  const promise = (async () => {
    try {
      const icon = await getIcon(url, title);
      iconCache.set(url, icon.dataUrl);
      return icon.dataUrl;
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, promise);
  return promise;
}
