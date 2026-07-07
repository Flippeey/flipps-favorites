/**
 * "Open all (N) in new tabs" — folder context-menu action. Opens every direct
 * bookmark child of a folder (no subfolder recursion) as new tabs. Above the
 * confirm threshold it requires an explicit confirmation so a stray click on
 * a large folder can't tab-bomb the browser.
 */
import { test, expect } from '../fixtures/world.js';
import type { Page } from '@playwright/test';
import { createSubFolder, createTestBookmark, openContextMenu, reloadNewtab, tileById } from '../fixtures/bookmark-helpers.js';

const CONFIRM_THRESHOLD = 10;

async function waitForNewPages(page: Page, expectedTotal: number): Promise<void> {
  await expect.poll(() => page.context().pages().length, { timeout: 10_000 }).toBe(expectedTotal);
}

async function closeExtraPages(page: Page, keep: number): Promise<void> {
  const pages = page.context().pages();
  for (const p of pages.slice(keep)) await p.close();
}

test.describe('open all in tabs', () => {
  test('folder menu exposes an "Open all (N) in new tabs" action with the direct-child count', async ({ newtabPage, world }) => {
    const folder = tileById(newtabPage, world.bookmarkIdByTitle('Project Apollo'));
    const menu = await openContextMenu(newtabPage, folder);
    // Project Apollo seeds 4 direct bookmarks (see shared/seed-data.ts).
    await expect(menu.getByRole('menuitem', { name: 'Open all (4) in new tabs' })).toBeVisible();
  });

  // WHY: small folders are a common, low-risk action — no confirmation friction.
  test('opening a folder at/under the threshold opens tabs immediately, no confirm', async ({ newtabPage, world }) => {
    const pagesBefore = newtabPage.context().pages().length;
    const folder = tileById(newtabPage, world.bookmarkIdByTitle('Project Apollo'));
    const menu = await openContextMenu(newtabPage, folder);
    await menu.getByRole('menuitem', { name: 'Open all (4) in new tabs' }).click();

    await expect(newtabPage.locator('.ff-dialog[role="dialog"]')).toHaveCount(0);
    await waitForNewPages(newtabPage, pagesBefore + 4);
    await closeExtraPages(newtabPage, pagesBefore);
  });

  test.describe('above the confirm threshold', () => {
    let folderId: string;

    test.beforeEach(async ({ newtabPage, world }) => {
      folderId = await createSubFolder(newtabPage, world.rootFolderId, 'Big Folder');
      for (let i = 0; i < CONFIRM_THRESHOLD + 2; i++) {
        await createTestBookmark(newtabPage, folderId, `Tab ${i + 1}`, `https://example.com/open-all-${i + 1}`);
      }
      await reloadNewtab(newtabPage);
    });

    // WHY: the core safety guarantee — a folder well past the threshold must
    // never open tabs without an explicit confirm click.
    test('shows a confirm dialog naming the tab count, and cancel opens nothing', async ({ newtabPage }) => {
      const pagesBefore = newtabPage.context().pages().length;
      const folder = tileById(newtabPage, folderId);
      const menu = await openContextMenu(newtabPage, folder);
      await menu.getByRole('menuitem', { name: `Open all (${CONFIRM_THRESHOLD + 2}) in new tabs` }).click();

      const dialog = newtabPage.locator('.ff-dialog[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      await expect(dialog).toContainText(`${CONFIRM_THRESHOLD + 2}`);

      await dialog.getByRole('button', { name: /Cancel/i }).click();
      await expect(dialog).toBeHidden({ timeout: 5_000 });

      // No tabs opened.
      await newtabPage.waitForTimeout(300);
      expect(newtabPage.context().pages().length).toBe(pagesBefore);
    });

    // WHY: confirming must actually deliver — every direct bookmark opens.
    test('confirming opens every direct bookmark as a new tab', async ({ newtabPage }) => {
      const pagesBefore = newtabPage.context().pages().length;
      const folder = tileById(newtabPage, folderId);
      const menu = await openContextMenu(newtabPage, folder);
      await menu.getByRole('menuitem', { name: `Open all (${CONFIRM_THRESHOLD + 2}) in new tabs` }).click();

      const dialog = newtabPage.locator('.ff-dialog[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      await dialog.getByRole('button', { name: new RegExp(`Open ${CONFIRM_THRESHOLD + 2} tabs`) }).click();

      await waitForNewPages(newtabPage, pagesBefore + CONFIRM_THRESHOLD + 2);
      await closeExtraPages(newtabPage, pagesBefore);
    });
  });
});
