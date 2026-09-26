import { test as base, type BrowserContext, type Page } from '@playwright/test';
import { closeLaunched, launchChrome, launchFirefox, originFrom } from './launch.js';
import { startStubHost } from './network-stub.js';

export interface ExtensionFixtures {
  context: BrowserContext;
  extensionOrigin: string;
  newtabPage: Page;
  /**
   * Hostnames to redirect to a local HTTPS stub server via Chromium
   * `--host-resolver-rules` (empty = no stub, the default). Set via
   * `test.use({ stubHosts: [...] })` for specs that assert a real
   * extension-opened-tab navigation without depending on live DNS/network.
   */
  stubHosts: string[];
}

export const test = base.extend<ExtensionFixtures>({
  stubHosts: [[], { option: true }],

  context: async ({ stubHosts }, use, testInfo) => {
    const isFirefox = testInfo.project.name === 'firefox';
    if (isFirefox) {
      const launched = await launchFirefox();
      await use(launched.context);
      await closeLaunched(launched);
      return;
    }

    const stub = stubHosts.length > 0 ? await startStubHost(stubHosts) : null;
    const launched = await launchChrome({
      extraArgs: stub
        ? [`--host-resolver-rules=${stub.hostResolverRules}`, '--ignore-certificate-errors']
        : [],
    });

    await use(launched.context);

    await closeLaunched(launched);
    await stub?.close();
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
