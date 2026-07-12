import { test as base, type BrowserContext, type Page } from '@playwright/test';
import { closeLaunched, launchChrome, launchFirefox, originFrom } from './launch.js';

export interface ExtensionFixtures {
  context: BrowserContext;
  extensionOrigin: string;
  newtabPage: Page;
}

export const test = base.extend<ExtensionFixtures>({
  context: async ({ }, use, testInfo) => {
    const isFirefox = testInfo.project.name === 'firefox';
    const launched = isFirefox ? await launchFirefox() : await launchChrome();

    await use(launched.context);

    await closeLaunched(launched);
  },

  extensionOrigin: async ({ context }, use, testInfo) => {
    if (testInfo.project.name === 'firefox') {
      await use('');
      return;
    }
    await use(await originFrom(context));
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
