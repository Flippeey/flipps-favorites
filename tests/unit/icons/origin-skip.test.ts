import { afterEach, describe, expect, it, vi } from 'vitest';

// browser.ts throws on import unless a WebExtension runtime is present. Stub the
// shim with a minimal runtime; declarativeNetRequest is left undefined so
// withCorsBypass's optional-chained guard simply no-ops (there is no DNR in node).
vi.mock('@/shared/browser', () => ({
  extensionApi: { runtime: {}, declarativeNetRequest: undefined },
}));

import { fetchOriginScrape } from '@/background/icons/icon-providers';

// WHY: hosts whose https URLs 301 to http:// (the extension holds only https://*/*
// host permission) reject every same-host origin probe identically and flood the
// console. The scrape must bail after a couple of rejections — and remember the host
// — rather than firing all 8 doomed probes. A clean miss (404) is NOT a rejection and
// must keep probing, so a host lacking apple-touch-icon but serving favicon.ico still
// resolves. These two behaviors are the whole fix; this test pins both.
describe('fetchOriginScrape — origin-probe rejection handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('bails after repeated fetch rejections (https→http downgrade) and skips the host thereafter', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    const first = await fetchOriginScrape('https://downgrade-host.test/page', 'icon:host:downgrade-host.test');
    expect(first.record).toBeNull();
    // 1 doc fetch + at most 2 probe attempts before bailing — NOT all 5 hardcoded probes.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(3);

    // Host is remembered: a second resolution skips the origin scrape entirely.
    fetchMock.mockClear();
    const second = await fetchOriginScrape('https://downgrade-host.test/other', 'icon:host:downgrade-host.test');
    expect(second.record).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps probing every path on clean misses (404) — no early bail', async () => {
    // Every fetch resolves with a non-ok response: a clean miss, not a rejection.
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, url: '' } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchOriginScrape('https://allmiss-host.test/page', 'icon:host:allmiss-host.test');
    expect(result.record).toBeNull();
    // 1 doc fetch + all 5 hardcoded probe paths attempted (no early break).
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(6);
  });
});
