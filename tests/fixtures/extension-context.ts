import { test as base, type BrowserContext, type Page } from '@playwright/test';
import { chromium, firefox } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const chromeExtPath = join(rootDir, 'dist', 'chrome');

export interface ExtensionFixtures {
  context: BrowserContext;
  extensionOrigin: string;
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
      // Chrome's new headless mode (--headless=new) supports MV3 extensions,
      // unlike legacy headless. Set HEADED=1 to force a visible window for
      // local debugging.
      const headed = process.env.HEADED === '1';
      // headless:false + the `--headless=new` arg drives Chrome's new headless
      // mode, which loads MV3 extensions. Passing headless:true instead makes
      // Playwright inject legacy `--headless`, under which the extension service
      // worker never registers (waitForEvent('serviceworker') times out).
      context = await chromium.launchPersistentContext(profileDir, {
        headless: false,
        args: [
          ...(headed ? [] : ['--headless=new']),
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
      await use('');
      return;
    }
    const workers = context.serviceWorkers();
    const sw =
      workers.length > 0
        ? workers[0]
        : await context.waitForEvent('serviceworker', { timeout: 15_000 });
    const extId = new URL(sw.url()).hostname;
    await use(`chrome-extension://${extId}`);
  },

  newtabPage: async ({ context, extensionOrigin }, use, testInfo) => {
    if (testInfo.project.name === 'firefox') {
      testInfo.skip(true, 'Firefox extension pages not accessible via Playwright');
      await use(null as unknown as Page);
      return;
    }
    const page = await context.newPage();
    await page.goto(`${extensionOrigin}/newtab.html`);
    await page.waitForSelector('.ff-app', { timeout: 15_000 });
    await use(page);
    await page.close();
  },
});

export { expect } from '@playwright/test';
