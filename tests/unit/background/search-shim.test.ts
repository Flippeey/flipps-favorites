import { afterEach, describe, expect, it, vi } from 'vitest';

// browser.ts throws unless a WebExtension runtime is present; search-shim.ts
// does not import it, but keep this mock in place defensively in case future
// edits pull it in transitively.
vi.mock('@/shared/browser', () => ({
  extensionApi: {
    runtime: {},
  },
}));

import { performWebSearch } from '@/background/search-shim';

// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
// ---------------------------------------------------------------------------
// chrome.search.query and browser.search.search have DIFFERENT method names
// and DIFFERENT param shapes (text+disposition vs. query). A typo in either
// shape builds and typechecks fine (both message objects are plain literals)
// but silently no-ops or throws at runtime in the real browser. This test
// pins the exact per-target call shape via dependency injection so a
// regression fails here instead of only in manual QA.
// ---------------------------------------------------------------------------

describe('performWebSearch() on Chrome', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('calls chrome.search.query with {text, disposition: NEW_TAB}', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome/125.0' });
    const queryMock = vi.fn().mockResolvedValue(undefined);

    await performWebSearch('cats', { chromeSearch: { query: queryMock } });

    expect(queryMock).toHaveBeenCalledOnce();
    expect(queryMock).toHaveBeenCalledWith({ text: 'cats', disposition: 'NEW_TAB' });
  });

  it('does not call a Firefox-shaped search API on Chrome', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome/125.0' });
    const queryMock = vi.fn().mockResolvedValue(undefined);
    const searchMock = vi.fn().mockResolvedValue(undefined);

    await performWebSearch('cats', { chromeSearch: { query: queryMock }, firefoxSearch: { search: searchMock } });

    expect(searchMock).not.toHaveBeenCalled();
  });

  it('surfaces failures: logs and rethrows when chrome.search.query rejects', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome/125.0' });
    const error = new Error('quota exceeded');
    const queryMock = vi.fn().mockRejectedValue(error);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(performWebSearch('cats', { chromeSearch: { query: queryMock } })).rejects.toThrow('quota exceeded');
    expect(errorSpy).toHaveBeenCalled();
  });

  it('throws when chrome.search API is unavailable', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome/125.0' });
    vi.stubGlobal('chrome', undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(performWebSearch('cats')).rejects.toThrow();
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('performWebSearch() on Firefox', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('calls browser.search.search with {query}', async () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
    });
    const searchMock = vi.fn().mockResolvedValue(undefined);

    await performWebSearch('dogs', { firefoxSearch: { search: searchMock } });

    expect(searchMock).toHaveBeenCalledOnce();
    expect(searchMock).toHaveBeenCalledWith({ query: 'dogs' });
  });

  it('does not call a Chrome-shaped search API on Firefox', async () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
    });
    const queryMock = vi.fn().mockResolvedValue(undefined);
    const searchMock = vi.fn().mockResolvedValue(undefined);

    await performWebSearch('dogs', { chromeSearch: { query: queryMock }, firefoxSearch: { search: searchMock } });

    expect(queryMock).not.toHaveBeenCalled();
  });

  it('surfaces failures: logs and rethrows when browser.search.search rejects', async () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
    });
    const error = new Error('engine not found');
    const searchMock = vi.fn().mockRejectedValue(error);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(performWebSearch('dogs', { firefoxSearch: { search: searchMock } })).rejects.toThrow('engine not found');
    expect(errorSpy).toHaveBeenCalled();
  });

  it('throws when browser.search API is unavailable', async () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
    });
    vi.stubGlobal('browser', undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(performWebSearch('dogs')).rejects.toThrow();
    expect(errorSpy).toHaveBeenCalled();
  });
});
