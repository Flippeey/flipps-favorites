import { test as base, type BrowserContext, type Page } from '@playwright/test';
import { chromium, firefox } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const chromeExtPath = join(rootDir, 'dist', 'chrome');

export interface ExtensionFixtures {
  /** The browser context with the extension loaded. */
  context: BrowserContext;
  /** The extension's origin URL (e.g. chrome-extension://id or moz-extension://uuid). */
  extensionOrigin: string;
  /**
   * The extension background page (Chrome MV3 helper page).
   * Useful for intercepting background network requests and seeding storage.
   * Firefox: tests that use this fixture are automatically skipped.
   */
  bgPage: Page;
  /**
   * The main newtab page, fully booted and ready for assertions.
   * Firefox: tests that use this fixture are automatically skipped.
   */
  newtabPage: Page;
}

export const test = base.extend<ExtensionFixtures>({
  context: async ({ }, use, testInfo) => {
    const isFirefox = testInfo.project.name === 'firefox';
    let context: BrowserContext;
    let profileDir: string | undefined;

    if (isFirefox) {
      profileDir = await mkdtemp(join(tmpdir(), 'ff-ext-'));
      context = await firefox.launchPersistentContext(profileDir, { headless: false });
    } else {
      profileDir = await mkdtemp(join(tmpdir(), 'cr-ext-'));
      context = await chromium.launchPersistentContext(profileDir, {
        headless: false,
        args: [
          `--disable-extensions-except=${chromeExtPath}`,
          `--load-extension=${chromeExtPath}`,
          '--no-first-run',
          '--disable-default-apps',
        ],
      });
    }

    await use(context);

    await context.close();
    if (profileDir) {
      await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
    }
  },

  extensionOrigin: async ({ context }, use, testInfo) => {
    if (testInfo.project.name === 'firefox') {
      // Firefox extension pages are not accessible via Playwright — tests using
      // newtabPage will skip. Return empty string as a safe placeholder.
      await use('');
      return;
    }

    // Chrome MV3: discover the extension ID from the service worker URL.
    const workers = context.serviceWorkers();
    const sw =
      workers.length > 0
        ? workers[0]
        : await context.waitForEvent('serviceworker', { timeout: 15_000 });
    const extId = new URL(sw.url()).hostname;
    await use(`chrome-extension://${extId}`);
  },

  bgPage: async ({ context, extensionOrigin }, use, testInfo) => {
    if (testInfo.project.name === 'firefox') {
      // Firefox extension background pages are not accessible via Playwright's
      // page API (juggler protocol does not surface the extension principal).
      // Any test that uses bgPage is automatically skipped for Firefox.
      testInfo.skip(true, 'Firefox extension background page not accessible via Playwright');
      // Defensive: testInfo.skip() throws, but provide fallback in case it doesn't.
      const placeholder = await context.newPage();
      await use(placeholder);
      return;
    }

    // Chrome MV3 has no persistent background page. Open a newtab page in the
    // extension origin so we can call browser APIs and intercept network requests.
    const bgPage = await context.newPage();
    await bgPage.goto(`${extensionOrigin}/newtab.html`);
    await bgPage.waitForFunction(() => document.readyState === 'complete');
    await use(bgPage);
  },

  newtabPage: async ({ context, extensionOrigin }, use, testInfo) => {
    if (testInfo.project.name === 'firefox') {
      // moz-extension:// URLs run in a separate process that Playwright's juggler
      // protocol does not monitor — extension pages are inaccessible via page.goto().
      testInfo.skip(true, 'Firefox extension pages are not accessible via Playwright');
      await use(null as unknown as Page);
      return;
    }

    // Chrome: navigate directly to the extension newtab page.
    const page = await context.newPage();
    await page.goto(`${extensionOrigin}/newtab.html`);
    // Wait for the app shell — bootstrap() is async.
    await page.waitForSelector('.shell', { timeout: 15_000 });
    await use(page);
    await page.close();
  },
});

export { expect } from '@playwright/test';
