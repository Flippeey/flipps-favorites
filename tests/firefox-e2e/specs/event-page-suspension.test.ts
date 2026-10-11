// Guards: the Firefox background is a non-persistent event page (manifest
// background.page). Firefox suspends it after an idle timeout (pref
// `extensions.background.idle.timeout`, default 30s). A new tab opened after
// the page has gone idle must still reach it, and a request that outlives the
// idle timeout (icon resolution against slow hosts) must still finish.
//
// The idle timeout is shrunk to 2s so suspension happens in test time, and
// every non-extension host is blackholed via PAC to a non-routable address
// (240.0.0.1 is class E, a SYN is never answered), so each icon source hangs
// until its own timeout and resolution runs well past the idle window.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer';
import { launchFirefoxWithExtension, reloadAndWaitForApp, type FirefoxSession } from '../launch';
import { createBookmark, getSettings, resetStorage, seedMinimal, type SeededWorld } from '../seed';
import { BOOKMARK_TILE } from '../selectors';
import { waitForCount } from '../wait';

const BLACKHOLE_PAC = `data:text/javascript,function FindProxyForURL(url, host) {
  return "PROXY 240.0.0.1:9";
}`;

const SUSPEND_SETTLE_MS = 5_000;
// Every icon source times out on its own (origin scrape, S2, Icon Horse, DDG);
// this comfortably covers the whole chain.
const ICON_RESOLUTION_SETTLE_MS = 20_000;
// A cached icon answers well inside the idle timeout; a fresh resolution here
// takes several seconds.
const CACHED_ICON_MAX_MS = 1_500;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('Firefox event-page suspension', () => {
  let session: FirefoxSession;
  let page: Page;
  let world: SeededWorld;

  beforeAll(async () => {
    session = await launchFirefoxWithExtension({
      extraPrefsFirefox: {
        'extensions.background.idle.timeout': 2_000,
        'network.proxy.type': 2,
        'network.proxy.autoconfig_url': BLACKHOLE_PAC,
      },
    });
    page = await session.newtabPage();
    await resetStorage(page);
    world = await seedMinimal(page, { rootBookmarks: 3 });
    await reloadAndWaitForApp(page);
    await waitForCount(page, BOOKMARK_TILE, 3, 10_000);
  });

  afterAll(async () => {
    await session.close();
  });

  it('a message sent after the page went idle still gets an answer', async () => {
    await sleep(SUSPEND_SETTLE_MS);
    const settings = await getSettings(page);
    expect(settings).toBeTruthy();
  });

  it('a new tab opened after the page went idle still renders its bookmarks', async () => {
    await sleep(SUSPEND_SETTLE_MS);
    const fresh = await session.newtabPage();
    await waitForCount(fresh, BOOKMARK_TILE, 3, 10_000);
    await fresh.close();
  });

  // The new tab's own icon request takes far longer than the idle timeout
  // with every source hanging. Only if the background stays alive does the
  // resolution finish and cache its letter-tile result; otherwise the page is
  // torn down mid-request and nothing is stored, so the follow-up request
  // below starts over, outlives the idle timeout again and is cut off.
  it('an icon resolution that outlives the idle timeout completes and is cached', async () => {
    await createBookmark(page, world.rootFolderId, 'Never answers', 'https://never-answers.example/');
    await reloadAndWaitForApp(page);
    await sleep(ICON_RESOLUTION_SETTLE_MS);

    const outcome = await page.evaluate(async () => {
      type ExtApi = { runtime: { sendMessage: (m: unknown) => Promise<unknown> } };
      const api = (globalThis as unknown as { browser?: ExtApi; chrome: ExtApi }).browser
        ?? (globalThis as unknown as { chrome: ExtApi }).chrome;
      const startedAt = performance.now();
      try {
        await api.runtime.sendMessage({
          type: 'icons/get',
          bookmarkUrl: 'https://never-answers.example/',
          bookmarkTitle: 'Never answers',
        });
        return { result: 'resolved', ms: performance.now() - startedAt };
      } catch (error) {
        return { result: `rejected: ${error instanceof Error ? error.message : String(error)}`, ms: performance.now() - startedAt };
      }
    });
    expect(outcome.result).toBe('resolved');
    expect(outcome.ms).toBeLessThan(CACHED_ICON_MAX_MS);
  }, 60_000);
});
