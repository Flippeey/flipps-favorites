import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/newtab/lib/messaging', () => ({
  getIcon: vi.fn(),
}));

import { getIcon } from '@/newtab/lib/messaging';
import type { ResolvedIcon } from '@/shared/models';
import {
  iconCache,
  inflight,
  subscribers,
  invalidateFaviconCache,
  invalidateFaviconCacheForScope,
  subscribeFaviconCache,
  isFaviconCached,
  fetchIcon,
} from '@/newtab/lib/favicon-cache';

const mockGetIcon = vi.mocked(getIcon);

// getIcon resolves a full ResolvedIcon; favicon-cache only reads dataUrl, but
// the mock honors the real contract so ResolvedIcon shape drift surfaces here.
function resolvedIcon(dataUrl: string): ResolvedIcon {
  return { cacheKey: 'icon:host:test', sourceKind: 'origin', dataUrl, lastUpdated: 0, isFallback: false };
}

// Directly seeds the module-level caches so scope-invalidation tests don't
// depend on fetchIcon's async plumbing — the caches are just Maps keyed by URL.
function seedCache(url: string, dataUrl = 'data:fake'): void {
  iconCache.set(url, dataUrl);
}

function clearAllCaches(): void {
  iconCache.clear();
  inflight.clear();
  subscribers.clear();
}

describe('invalidateFaviconCache', () => {
  beforeEach(() => clearAllCaches());

  it('drops the cache entry and notifies subscribers for that exact URL', () => {
    const url = 'https://example.com/page';
    seedCache(url);
    const listener = vi.fn();
    subscribeFaviconCache(url, listener);

    invalidateFaviconCache(url);

    expect(isFaviconCached(url)).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not affect unrelated URLs', () => {
    seedCache('https://a.test/');
    seedCache('https://b.test/');

    invalidateFaviconCache('https://a.test/');

    expect(isFaviconCached('https://a.test/')).toBe(false);
    expect(isFaviconCached('https://b.test/')).toBe(true);
  });
});

describe('invalidateFaviconCacheForScope', () => {
  beforeEach(() => clearAllCaches());

  // Exact scope must only touch the one edited bookmark's cache entry — a
  // per-URL edit (e.g. user picked a custom icon for this one page) must not
  // bleed into other pages on the same host.
  it('exact scope invalidates only the given URL, leaving sibling-host URLs cached', () => {
    const editedUrl = 'https://dev.azure.com/org/project-a';
    const siblingUrl = 'https://dev.azure.com/org/project-b';
    seedCache(editedUrl);
    seedCache(siblingUrl);

    invalidateFaviconCacheForScope(editedUrl, 'exact');

    expect(isFaviconCached(editedUrl)).toBe(false);
    expect(isFaviconCached(siblingUrl)).toBe(true);
  });

  // Host scope is the common case: user overrides the icon for a whole site,
  // so every bookmark under that exact hostname must refresh. Would fail if
  // scope precedence collapsed host into exact (sibling stays stale) or into
  // domain (unrelated subdomains incorrectly invalidate too).
  it('host scope invalidates every URL on the same hostname, not other subdomains', () => {
    const editedUrl = 'https://dev.azure.com/org/project-a';
    const sameHostUrl = 'https://dev.azure.com/org/project-b';
    const otherSubdomainUrl = 'https://status.azure.com/health';
    seedCache(editedUrl);
    seedCache(sameHostUrl);
    seedCache(otherSubdomainUrl);

    invalidateFaviconCacheForScope(editedUrl, 'host');

    expect(isFaviconCached(editedUrl)).toBe(false);
    expect(isFaviconCached(sameHostUrl)).toBe(false);
    // Different subdomain, same registrable domain — must survive a host-scoped edit.
    expect(isFaviconCached(otherSubdomainUrl)).toBe(true);
  });

  // Domain scope is the broadest: overriding the icon for a whole brand must
  // reach every subdomain sharing the registrable root (dev.azure.com and
  // status.azure.com are both *.azure.com), while leaving unrelated domains alone.
  it('domain scope invalidates every URL sharing the registrable root across subdomains', () => {
    const editedUrl = 'https://dev.azure.com/org/project-a';
    const otherSubdomainUrl = 'https://status.azure.com/health';
    const unrelatedDomainUrl = 'https://example.com/';
    seedCache(editedUrl);
    seedCache(otherSubdomainUrl);
    seedCache(unrelatedDomainUrl);

    invalidateFaviconCacheForScope(editedUrl, 'domain');

    expect(isFaviconCached(editedUrl)).toBe(false);
    expect(isFaviconCached(otherSubdomainUrl)).toBe(false);
    expect(isFaviconCached(unrelatedDomainUrl)).toBe(true);
  });

  it('host/domain scope also clears matching in-flight promises and subscriber listeners', () => {
    const editedUrl = 'https://dev.azure.com/org/project-a';
    const sameHostUrl = 'https://dev.azure.com/org/project-b';
    seedCache(editedUrl);
    seedCache(sameHostUrl);
    inflight.set(sameHostUrl, Promise.resolve('data:stale'));
    const listener = vi.fn();
    subscribeFaviconCache(sameHostUrl, listener);

    invalidateFaviconCacheForScope(editedUrl, 'host');

    expect(inflight.has(sameHostUrl)).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  // Falls back to exact-only invalidation when the URL can't be parsed for a
  // hostname (e.g. malformed data), rather than silently invalidating nothing
  // or throwing.
  it('falls back to exact invalidation when the URL has no parseable hostname', () => {
    const malformedUrl = 'not a url';
    seedCache(malformedUrl);

    invalidateFaviconCacheForScope(malformedUrl, 'host');

    expect(isFaviconCached(malformedUrl)).toBe(false);
  });
});

describe('subscribeFaviconCache', () => {
  beforeEach(() => clearAllCaches());

  it('unsubscribe stops future notifications for that listener', () => {
    const url = 'https://example.com/';
    seedCache(url);
    const listener = vi.fn();
    const unsubscribe = subscribeFaviconCache(url, listener);

    unsubscribe();
    invalidateFaviconCache(url);

    expect(listener).not.toHaveBeenCalled();
  });

  it('supports multiple listeners on the same URL independently', () => {
    const url = 'https://example.com/';
    seedCache(url);
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    subscribeFaviconCache(url, listenerA);
    const unsubscribeB = subscribeFaviconCache(url, listenerB);

    unsubscribeB();
    invalidateFaviconCache(url);

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).not.toHaveBeenCalled();
  });
});

describe('fetchIcon', () => {
  beforeEach(() => {
    clearAllCaches();
    mockGetIcon.mockReset();
  });

  it('returns the cached dataUrl without calling getIcon again', async () => {
    const url = 'https://cached.test/';
    seedCache(url, 'data:cached-value');

    const result = await fetchIcon(url);

    expect(result).toBe('data:cached-value');
    expect(mockGetIcon).not.toHaveBeenCalled();
  });

  it('dedupes concurrent calls for the same URL into a single getIcon request', async () => {
    const url = 'https://concurrent.test/';
    let resolveIcon: (v: ResolvedIcon) => void;
    mockGetIcon.mockReturnValue(new Promise<ResolvedIcon>(resolve => { resolveIcon = resolve; }));

    const first = fetchIcon(url);
    const second = fetchIcon(url);
    resolveIcon!(resolvedIcon('data:resolved'));

    const [a, b] = await Promise.all([first, second]);

    expect(a).toBe('data:resolved');
    expect(b).toBe('data:resolved');
    expect(mockGetIcon).toHaveBeenCalledTimes(1);
  });

  it('caches the resolved value for subsequent calls', async () => {
    const url = 'https://resolve-once.test/';
    mockGetIcon.mockResolvedValue(resolvedIcon('data:once'));

    await fetchIcon(url);
    await fetchIcon(url);

    expect(mockGetIcon).toHaveBeenCalledTimes(1);
    expect(isFaviconCached(url)).toBe(true);
  });
});
