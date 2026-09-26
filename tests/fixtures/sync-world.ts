// Playwright fixtures for sync specs: one local sync stub per test, plus a
// factory that launches as many isolated Chrome profiles as a scenario needs,
// all routed to that stub. Every launched profile is torn down with the test.
import { test as base, type Page } from '@playwright/test';
import { closeLaunched, launchChrome, originFrom, type LaunchedContext } from './launch.js';
import { startSyncStub, type SyncStub } from './sync-stub.js';
import type { SyncPage } from './sync-ui.js';

export interface SyncBrowser {
  page: Page;
  sync: SyncPage;
}

export interface SyncFixtures {
  syncStub: SyncStub;
  /** Launch a fresh Chrome profile with the extension, on its newtab page. */
  openSyncBrowser: () => Promise<SyncBrowser>;
}

export function syncPageFromPlaywright(page: Page): SyncPage {
  return {
    evaluate: <A, R>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R> =>
      page.evaluate(fn as (arg: unknown) => R | Promise<R>, arg as unknown),
    reload: async () => {
      await page.reload();
      await page.waitForSelector('.ff-app', { timeout: 15_000 });
    },
  };
}

export const test = base.extend<SyncFixtures>({
  syncStub: async ({}, use) => {
    const stub = await startSyncStub();
    await use(stub);
    await stub.close();
  },

  openSyncBrowser: async ({ syncStub }, use) => {
    const launched: LaunchedContext[] = [];
    await use(async () => {
      const profile = await launchChrome({ extraArgs: syncStub.chromeArgs });
      launched.push(profile);
      const origin = await originFrom(profile.context);
      const page = await profile.context.newPage();
      await page.goto(`${origin}/newtab.html`);
      await page.waitForSelector('.ff-app', { timeout: 15_000 });
      return { page, sync: syncPageFromPlaywright(page) };
    });
    await Promise.all(launched.map((profile) => closeLaunched(profile)));
  },
});

export { expect } from '@playwright/test';
