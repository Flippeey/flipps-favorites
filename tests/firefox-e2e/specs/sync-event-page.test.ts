// Guards: sync messaging vs. Firefox event-page suspension (#7 follow-up).
//
// The Firefox background is a NON-PERSISTENT event page (manifest background.page,
// see scripts/write-manifest.mjs). Firefox suspends it after an idle timeout
// (pref `extensions.background.idle.timeout`, default 30s). The idle manager
// keeps the page alive while a runtime.onMessage listener's *returned Promise*
// is pending — but NOT reliably for the Chrome-style `sendResponse` +
// `return true` pattern. With the callback style, a slow sync request (10s XHR
// timeout) can outlive the page: Firefox tears it down mid-request and the
// sender's sendMessage rejects with "Promised response from onMessage listener
// went out of scope" — which surfaced as a raw error toast on Sync now.
//
// This spec reproduces that deterministically and pins the fix:
// - idle timeout shrunk to 2s so suspension happens in test time, not 30s;
// - api.flippflix.com blackholed via PAC to a non-routable IP (240.0.0.1 is
//   class E — SYN never answered), so the sync XHR hangs until its own 10s
//   timeout. Hermetic: no real sync traffic leaves the machine.
// Bug present  -> page suspends ~2s into the hang -> "went out of scope" toast.
// Fix in place -> page stays alive -> XHR times out at 10s -> the *typed*
//                 friendly network-error toast from SYNC_ERROR_COPY.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer';
import { launchFirefoxWithExtension, reloadAndWaitForApp, type FirefoxSession } from '../launch';
import { resetStorage, seedMinimal } from '../seed';
import { clickByText } from '../wait';

const BLACKHOLE_PAC = `data:text/javascript,function FindProxyForURL(url, host) {
  if (host === "api.flippflix.com") return "PROXY 240.0.0.1:9";
  return "DIRECT";
}`;

// Boot burst (settings/tree/workspaces messages) resets the idle timer; wait
// comfortably past the 2s timeout so the event page has actually suspended
// before Sync now is pressed — mirroring a user who browsed the drawer for a
// while (>30s in production) before clicking.
const SUSPEND_SETTLE_MS = 5_000;

describe('sync vs. Firefox event-page suspension', () => {
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
  });

  afterAll(async () => {
    await session.close();
  });

  it(
    'Sync now on a suspended event page yields a typed sync error, not "went out of scope"',
    async () => {
      await resetStorage(page);
      await seedMinimal(page, { rootBookmarks: 0 });
      await reloadAndWaitForApp(page);

      await new Promise((r) => setTimeout(r, SUSPEND_SETTLE_MS));

      await page.click('[aria-label="Settings"]');
      await page.waitForSelector('.ff-drawer', { timeout: 5_000 });
      await clickByText(page, '.ff-drawer__navitem', 'Backup');
      await page.waitForSelector('[data-testid="sync-now-button"]', { timeout: 5_000 });
      await page.click('[data-testid="sync-now-button"]');

      // Bug: toast at ~2-4s (teardown). Fixed: toast at ~10s (XHR timeout).
      await page.waitForSelector('.ff-toast__msg', { timeout: 20_000 });
      const toast = await page.$eval('.ff-toast__msg', (el) => el.textContent ?? '');

      expect(toast).not.toMatch(/out of scope/i);
      // The friendly SyncFetchError('network') copy from BackupSection.
      expect(toast).toContain('reach the sync server');
    },
    60_000,
  );
});
