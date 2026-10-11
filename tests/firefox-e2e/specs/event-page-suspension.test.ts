// Guards: the Firefox background is a non-persistent event page (manifest
// background.page). Firefox suspends it after an idle timeout (pref
// `extensions.background.idle.timeout`, default 30s). A new tab opened after
// the page has gone idle must still reach it, and a request that outlives the
// idle timeout (icon resolution against slow hosts) must still get its answer.
//
// The idle timeout is shrunk to 2s so suspension happens in test time, and
// every non-extension host is blackholed via PAC to a non-routable address
// (240.0.0.1 is class E, a SYN is never answered), so each icon source hangs
// until its own timeout and resolution runs well past the idle window.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer';
import { launchFirefoxWithExtension, reloadAndWaitForApp, type FirefoxSession } from '../launch';
import { getSettings, resetStorage, seedMinimal } from '../seed';
import { BOOKMARK_TILE } from '../selectors';
import { waitForCount } from '../wait';

const BLACKHOLE_PAC = `data:text/javascript,function FindProxyForURL(url, host) {
  return "PROXY 240.0.0.1:9";
}`;

const SUSPEND_SETTLE_MS = 5_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('Firefox event-page suspension', () => {
  let session: FirefoxSession;
  let page: Page;

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
    await seedMinimal(page, { rootBookmarks: 3 });
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

  it('an icon request that outlives the idle timeout still resolves', async () => {
    await sleep(SUSPEND_SETTLE_MS);
    const outcome = await page.evaluate(async () => {
      type ExtApi = { runtime: { sendMessage: (m: unknown) => Promise<unknown> } };
      const api = (globalThis as unknown as { browser?: ExtApi; chrome: ExtApi }).browser
        ?? (globalThis as unknown as { chrome: ExtApi }).chrome;
      try {
        await api.runtime.sendMessage({
          type: 'icons/get',
          bookmarkUrl: 'https://never-answers.example/',
          bookmarkTitle: 'Never answers',
        });
        return 'resolved';
      } catch (error) {
        return `rejected: ${error instanceof Error ? error.message : String(error)}`;
      }
    });
    expect(outcome).toBe('resolved');
  }, 60_000);
});
