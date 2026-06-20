import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/newtab/lib/favicon-cache', () => ({
  prefetchFavicon: vi.fn().mockResolvedValue(undefined),
  isFaviconCached: vi.fn().mockReturnValue(false),
}));

import { prefetchAllIcons, prefetchAllIconsEager } from '@/newtab/lib/icon-prefetch';
import { prefetchFavicon, isFaviconCached } from '@/newtab/lib/favicon-cache';
import type { BookmarkNode } from '@/shared/messages';

const mockPrefetchFavicon = vi.mocked(prefetchFavicon);
const mockIsFaviconCached = vi.mocked(isFaviconCached);

function makeTree(urls: string[]): BookmarkNode[] {
  return urls.map((url, i) => ({
    id: String(i + 1),
    title: `Site ${i + 1}`,
    url,
  }));
}

describe('icon-prefetch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockPrefetchFavicon.mockClear();
    mockIsFaviconCached.mockClear();
    mockIsFaviconCached.mockReturnValue(false);
    // scheduleIdle reads `window` — stub it for the Node test environment.
    // No requestIdleCallback, so scheduleIdle falls back to setTimeout.
    (globalThis as Record<string, unknown>).window = globalThis;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as Record<string, unknown>).window;
  });

  it('prefetchAllIconsEager calls prefetchFavicon immediately (no idle delay)', () => {
    const tree = makeTree(['https://a.test', 'https://b.test']);

    prefetchAllIconsEager(tree);

    // Eager path fires synchronously — prefetchFavicon should already be called.
    expect(mockPrefetchFavicon).toHaveBeenCalledTimes(2);
    expect(mockPrefetchFavicon).toHaveBeenCalledWith('https://a.test', 'Site 1');
    expect(mockPrefetchFavicon).toHaveBeenCalledWith('https://b.test', 'Site 2');
  });

  it('prefetchAllIcons defers via idle/timeout (does not call immediately)', () => {
    const tree = makeTree(['https://c.test']);

    prefetchAllIcons(tree);

    // Deferred path should NOT have called prefetchFavicon yet.
    expect(mockPrefetchFavicon).not.toHaveBeenCalled();

    // Advance past the setTimeout fallback (300ms).
    vi.advanceTimersByTime(400);

    expect(mockPrefetchFavicon).toHaveBeenCalledTimes(1);
    expect(mockPrefetchFavicon).toHaveBeenCalledWith('https://c.test', 'Site 1');
  });

  it('skips already-cached URLs', () => {
    mockIsFaviconCached.mockImplementation((url: string) => url === 'https://cached.test');
    const tree = makeTree(['https://cached.test', 'https://fresh.test']);

    prefetchAllIconsEager(tree);

    expect(mockPrefetchFavicon).toHaveBeenCalledTimes(1);
    expect(mockPrefetchFavicon).toHaveBeenCalledWith('https://fresh.test', 'Site 2');
  });

  it('deduplicates across eager and deferred calls', () => {
    const tree = makeTree(['https://dedup.test']);

    // Eager call marks the URL as prefetched.
    prefetchAllIconsEager(tree);
    expect(mockPrefetchFavicon).toHaveBeenCalledTimes(1);

    mockPrefetchFavicon.mockClear();

    // Deferred call on the same tree should skip already-prefetched URLs.
    prefetchAllIcons(tree);
    vi.advanceTimersByTime(400);

    expect(mockPrefetchFavicon).not.toHaveBeenCalled();
  });
});
