// Guards: browser.bookmarks parity through the message pipeline on Firefox —
// creating and deleting a bookmark via the UI must reach the real
// browser.bookmarks store the same way it does on Chrome.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer';
import { launchFirefoxWithExtension, reloadAndWaitForApp, type FirefoxSession } from '../launch';
import { resetStorage, seedMinimal } from '../seed';
import { BOOKMARK_TILE, CONTEXT_MENU, CONTEXT_MENU_ITEM } from '../selectors';
import { clickByText, waitForCount } from '../wait';

describe('bookmarks', () => {
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
    await seedMinimal(page, { rootBookmarks: 1 });
    await reloadAndWaitForApp(page);
  });

  it('quick-add via the top-nav Add menu creates a tile', async () => {
    await waitForCount(page, BOOKMARK_TILE, 1);

    await page.click('[aria-label="Add"]');
    await page.waitForSelector(CONTEXT_MENU, { timeout: 5_000 });
    await clickByText(page, `${CONTEXT_MENU} ${CONTEXT_MENU_ITEM}`, 'Add bookmark');

    const dialog = await page.waitForSelector('.ff-dialog', { timeout: 5_000 });
    expect(dialog).not.toBeNull();
    await page.type('.ff-dialog input[type="url"]', 'https://example.com/firefox-e2e');
    await clickByText(page, '.ff-dialog button', 'Add bookmark');

    await page.waitForSelector('.ff-dialog', { hidden: true, timeout: 5_000 });
    await waitForCount(page, BOOKMARK_TILE, 2);
  });

  it('deleting a bookmark via the context menu removes its tile', async () => {
    await waitForCount(page, BOOKMARK_TILE, 1);

    const tile = await page.$(BOOKMARK_TILE);
    expect(tile).not.toBeNull();
    await tile!.click({ button: 'right' });
    await page.waitForSelector(CONTEXT_MENU, { timeout: 5_000 });
    await clickByText(page, `${CONTEXT_MENU} ${CONTEXT_MENU_ITEM}`, 'Delete');

    await waitForCount(page, BOOKMARK_TILE, 0);
  });
});
