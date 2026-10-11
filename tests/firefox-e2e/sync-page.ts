import type { Page } from 'puppeteer';
import type { SyncPage } from '../fixtures/sync-ui';
import { reloadAndWaitForApp } from './launch';

/** Wrap a Puppeteer page (Chrome or Firefox) for the shared sync UI driver. */
export function syncPageFromPuppeteer(page: Page): SyncPage {
  return {
    evaluate: <A, R>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R> =>
      page.evaluate(fn as (arg: unknown) => Promise<unknown>, arg as unknown) as Promise<R>,
    reload: () => reloadAndWaitForApp(page),
  };
}
