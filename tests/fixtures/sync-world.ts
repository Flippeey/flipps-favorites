// Playwright fixtures for sync specs: one local sync stub per test, plus a
// factory that launches as many isolated Chrome profiles as a scenario needs,
// all routed to that stub. Every launched profile is torn down with the test.
import { test as base, type Page } from '@playwright/test';
import { closeLaunched, launchChrome, type LaunchedContext } from './launch.js';
import { startSyncStub, type SyncStub } from './sync-stub.js';
import type { SyncPage } from './sync-ui.js';

export interface SyncBrowser {
  page: Page;
  sync: SyncPage;
  /** The extension's service worker, for setup before any page has asked for workspaces. */
  background: SyncPage;
  /** Load the newtab page into `page` (already done unless launched with `newtab: false`). */
  openNewtab: () => Promise<void>;
}

export interface OpenSyncBrowserOptions {
  /** false: leave the fresh profile without any page, once install handling has finished. */
  newtab?: boolean;
}

export interface SyncFixtures {
  syncStub: SyncStub;
  /** Launch a fresh Chrome profile with the extension, on its newtab page. */
  openSyncBrowser: (options?: OpenSyncBrowserOptions) => Promise<SyncBrowser>;
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
    await use(async ({ newtab = true } = {}) => {
      const profile = await launchChrome({ extraArgs: syncStub.chromeArgs });
      launched.push(profile);
      const worker = profile.context.serviceWorkers()[0]
        ?? await profile.context.waitForEvent('serviceworker', { timeout: 15_000 });
      const origin = `chrome-extension://${new URL(worker.url()).hostname}`;
      const background: SyncPage = {
        evaluate: <A, R>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R> =>
          worker.evaluate(fn as (arg: unknown) => R | Promise<R>, arg as unknown),
        reload: () => Promise.reject(new Error('The service worker has no page to reload')),
      };
      const page = await profile.context.newPage();
      const openNewtab = async (): Promise<void> => {
        await page.goto(`${origin}/newtab.html`);
        await page.waitForSelector('.ff-app', { timeout: 15_000 });
      };
      if (newtab) {
        await openNewtab();
      } else {
        // Install handling runs after the worker starts; setup written before
        // it finishes would be overwritten by it.
        await background.evaluate(async () => {
          type Api = { storage: { local: { get(key: string): Promise<Record<string, unknown>> } } };
          const api = (globalThis as unknown as { chrome: Api }).chrome;
          while (!(await api.storage.local.get('onboarding-state'))['onboarding-state']) {
            await new Promise((resolveTick) => setTimeout(resolveTick, 50));
          }
        }, undefined);
      }
      return { page, sync: syncPageFromPlaywright(page), background, openNewtab };
    });
    await Promise.all(launched.map((profile) => closeLaunched(profile)));
  },
});

export { expect } from '@playwright/test';
