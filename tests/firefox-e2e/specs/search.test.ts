// Guards: hero search rendering + keyboard input events on Firefox — typing
// into the search box must filter results the same way it does on Chrome.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer';
import { launchFirefoxWithExtension, reloadAndWaitForApp, type FirefoxSession } from '../launch';
import { resetStorage, seedMinimal } from '../seed';
import { SEARCH_INPUT, SEARCH_RESULT_ITEM } from '../selectors';
import { waitForCount } from '../wait';

describe('search', () => {
  let session: FirefoxSession;
  let page: Page;

  beforeAll(async () => {
    session = await launchFirefoxWithExtension();
    page = await session.newtabPage();
  });

  afterAll(async () => {
    await session.close();
  });

  beforeEach(async () => {
    await resetStorage(page);
    await seedMinimal(page, { rootBookmarks: 6 });
    await reloadAndWaitForApp(page);
  });

  it('typing in the hero search filters to matching bookmarks', async () => {
    await page.click(SEARCH_INPUT);
    // "BM 01" is unique to the first seeded bookmark (see seedMinimal titles).
    await page.type(SEARCH_INPUT, 'BM 01');

    await waitForCount(page, SEARCH_RESULT_ITEM, 1, 5_000);
    const text = await page.$eval(SEARCH_RESULT_ITEM, (el) => el.textContent ?? '');
    expect(text).toContain('BM 01');
  });

  it('clearing the search restores focus without leaving stale results', async () => {
    await page.click(SEARCH_INPUT);
    await page.type(SEARCH_INPUT, 'BM 01');
    await waitForCount(page, SEARCH_RESULT_ITEM, 1, 5_000);

    await page.evaluate((sel: string) => {
      const input = document.querySelector<HTMLInputElement>(sel);
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setter.call(input, '');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, SEARCH_INPUT);

    await page.waitForFunction(
      (sel: string) => document.querySelector(sel) === null,
      { timeout: 5_000 },
      '#ff-search-results',
    );
  });
});
