import { test as base, type BrowserContext, type Browser, type Page } from '@playwright/test';
import { chromium, firefox } from '@playwright/test';
import { withExtension } from 'playwright-webextext';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const firefoxExtPath = join(rootDir, 'dist', 'firefox');
const chromeExtPath = join(rootDir, 'dist', 'chrome');

export interface ExtensionFixtures {
  /** The browser context with the extension loaded. */
  context: BrowserContext;
  /** The extension's origin URL (e.g. chrome-extension://id or moz-extension://uuid). */
  extensionOrigin: string;
  /**
   * The extension background page (Firefox) or a helper newtab page (Chrome MV3).
   * Useful for intercepting background network requests and seeding storage.
   */
  bgPage: Page;
  /** The main newtab page, fully booted and ready for assertions. */
  newtabPage: Page;
}

export const test = base.extend<ExtensionFixtures>({
  context: async ({ }, use, testInfo) => {
    const isFirefox = testInfo.project.name === 'firefox';
    let context: BrowserContext;
    let browser: Browser | undefined;
    let profileDir: string | undefined;

    if (isFirefox) {
      // playwright-webextext installs the extension via Firefox's Remote Debugging
      // Protocol (RDP) after launch — this bypasses signature enforcement and works
      // with Playwright's Firefox binary unlike profile-staging approaches.
      const ffWithExt = withExtension(firefox, firefoxExtPath);
      browser = await ffWithExt.launch({
        headless: false, // Firefox requires headed mode for extensions
        firefoxUserPrefs: {
          'xpinstall.signatures.required': false,
          'extensions.autoDisableScopes': 0,
          'extensions.enabledScopes': 15,
          'extensions.manifestV3.enabled': true,
        },
      });
      // Use the default browser context — extension pages appear here.
      context = browser.contexts()[0];
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
    if (browser) await browser.close().catch(() => undefined);
    // Clean up the temp profile after each test.
    if (profileDir) {
      await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
    }
  },

  extensionOrigin: async ({ context }, use, testInfo) => {
    const isFirefox = testInfo.project.name === 'firefox';
    let origin: string;

    if (isFirefox) {
      // Firefox runs the background.html as a regular page. It should be alive
      // shortly after the context is created. Set up the listener before checking
      // existing pages to avoid a race.
      const bgPagePromise = context.waitForEvent('page', {
        predicate: p => p.url().startsWith('moz-extension://'),
        timeout: 20_000,
      });

      // Check if the background page is already open (it may have started before
      // our listener registered).
      const existing = context.pages().find(p => p.url().startsWith('moz-extension://'));
      if (existing) {
        origin = new URL(existing.url()).origin;
      } else {
        const bgPage = await bgPagePromise;
        origin = new URL(bgPage.url()).origin;
      }
    } else {
      // Chrome MV3: discover the extension ID from the service worker URL.
      const workers = context.serviceWorkers();
      const sw =
        workers.length > 0
          ? workers[0]
          : await context.waitForEvent('serviceworker', { timeout: 15_000 });
      const extId = new URL(sw.url()).hostname;
      origin = `chrome-extension://${extId}`;
    }

    await use(origin);
  },

  bgPage: async ({ context, extensionOrigin }, use, testInfo) => {
    const isFirefox = testInfo.project.name === 'firefox';
    let bgPage: Page;

    if (isFirefox) {
      // The background.html page is already running in the extension origin.
      bgPage = context.pages().find(p => p.url().startsWith(extensionOrigin))!;
      if (!bgPage) {
        throw new Error(`Could not find Firefox background page at ${extensionOrigin}`);
      }
    } else {
      // Chrome MV3 has no persistent background page. Open a newtab page in the
      // extension origin so we can call browser APIs and route network requests.
      bgPage = await context.newPage();
      await bgPage.goto(`${extensionOrigin}/newtab.html`);
      await bgPage.waitForFunction(() => document.readyState === 'complete');
    }

    await use(bgPage);
  },

  newtabPage: async ({ context, extensionOrigin }, use) => {
    const page = await context.newPage();
    await page.goto(`${extensionOrigin}/newtab.html`);
    // Wait for the app shell — bootstrap() is async.
    await page.waitForSelector('.shell', { timeout: 15_000 });
    await use(page);
    await page.close();
  },
});

export { expect } from '@playwright/test';
