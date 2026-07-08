/**
 * Undo toast for folder delete and batch (multi-select) delete.
 *
 * WHY this matters: single-bookmark delete already has an Undo toast. Folder
 * delete and batch delete previously had none — the confirm dialog claimed
 * "This action cannot be undone", so a misclick on a folder full of bookmarks
 * or a multi-selection was permanent. Each test encodes the user-visible
 * promise: "I deleted the wrong thing, one click puts it all back exactly
 * where it was" — not just that the DOM re-populates somehow.
 */
import { test, expect } from '../fixtures/world.js';
import { resetStorage, seedMinimal } from '../fixtures/seeding.js';
import { reloadNewtab, patchSettings, patchWorkspace, openContextMenu, clickMenuItem } from '../fixtures/bookmark-helpers.js';
import { tilesInScope } from '../fixtures/selectors.js';
import type { Page } from '@playwright/test';

const MINIMAL_WS_ID = 'ws-minimal';

const undoToast = (page: Page, messagePattern: RegExp) =>
  page.locator('.ff-toast', { has: page.locator('.ff-toast__msg', { hasText: messagePattern }) });

test.describe('undo delete', () => {
  test.beforeEach(async ({ newtabPage }) => {
    await resetStorage(newtabPage);
  });

  // -------------------------------------------------------------------------
  test('deleting a folder shows Undo, and Undo restores the folder with its bookmarks', async ({ newtabPage }) => {
    const seeded = await seedMinimal(newtabPage, { rootBookmarks: 2, folders: 1, bookmarksPerFolder: 2 });
    await reloadNewtab(newtabPage);
    await patchWorkspace(newtabPage, { bookmarkSortMode: 'manual', folderMode: 'grid' }, MINIMAL_WS_ID);
    await patchSettings(newtabPage, { folderOpenMode: 'overlay' });
    await reloadNewtab(newtabPage);

    const folderId = seeded.bookmarkIdByTitle('Folder 1');
    const folderTile = newtabPage.locator(`[data-item-id="${folderId}"][data-item-kind="folder"]`);
    await expect(folderTile).toBeVisible();

    const menu = await openContextMenu(newtabPage, folderTile);
    await clickMenuItem(menu, 'Delete folder');

    const dialog = newtabPage.locator('.ff-dialog');
    await dialog.waitFor({ state: 'visible', timeout: 5_000 });
    await dialog.getByRole('button', { name: /Delete folder/ }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 5_000 });

    // The folder is gone…
    await expect(folderTile).toHaveCount(0, { timeout: 8_000 });

    // …and an Undo toast appeared.
    const toast = undoToast(newtabPage, /^Deleted/);
    await expect(toast).toBeVisible({ timeout: 5_000 });

    // Click Undo → the folder is back, in the root scope.
    await toast.locator('.ff-toast__action', { hasText: 'Undo' }).click();
    const restoredFolder = newtabPage.locator('.ff-canvas [data-item-kind="folder"]', { hasText: 'Folder 1' }).first();
    await expect(restoredFolder).toBeVisible({ timeout: 8_000 });

    // …with both of its bookmarks intact, in original order.
    await restoredFolder.click();
    const overlay = newtabPage.locator('.ff-folder-overlay');
    await overlay.waitFor({ state: 'visible', timeout: 5_000 });
    const restoredChildren = overlay.locator('[data-item-id][data-item-kind="bookmark"]');
    await expect(restoredChildren).toHaveCount(2, { timeout: 8_000 });
    await expect(restoredChildren.nth(0)).toContainText('Folder 1 BM 1');
    await expect(restoredChildren.nth(1)).toContainText('Folder 1 BM 2');
  });

  // -------------------------------------------------------------------------
  test('batch delete shows "Deleted N — Undo", and Undo restores every item to its original slot', async ({ newtabPage }) => {
    const seeded = await seedMinimal(newtabPage, { rootBookmarks: 6 });
    await reloadNewtab(newtabPage);
    await patchWorkspace(newtabPage, { bookmarkSortMode: 'manual', folderMode: 'grid' }, MINIMAL_WS_ID);
    await reloadNewtab(newtabPage);

    const tiles = tilesInScope(newtabPage, seeded.rootFolderId);
    const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';

    // Select tiles 0 and 2 (non-contiguous) so restoring to original index
    // — not just "somewhere" — is actually being exercised. Assert by title,
    // not id: undo recreates bookmarks with new browser-assigned ids (a known,
    // documented tradeoff of toast-window undo — no trash/recycle-bin store of
    // the original nodes), so title/position is the durable identity here.
    await expect(tiles).toHaveCount(6);
    const titleAt = (i: number) => tiles.nth(i).locator('.ff-tile__label').innerText();
    const title0 = await titleAt(0);
    const title2 = await titleAt(2);

    await tiles.nth(0).click({ modifiers: [modKey] });
    await tiles.nth(2).click({ modifiers: [modKey] });

    await newtabPage.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await newtabPage.keyboard.press('Delete');

    const dialog = newtabPage.locator('.ff-dialog');
    await dialog.waitFor({ state: 'visible', timeout: 5_000 });
    await dialog.getByRole('button', { name: /Delete 2 bookmarks/ }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 5_000 });

    await expect(tiles).toHaveCount(4, { timeout: 8_000 });

    const toast = undoToast(newtabPage, /^Deleted 2 items/);
    await expect(toast).toBeVisible({ timeout: 5_000 });

    await toast.locator('.ff-toast__action', { hasText: 'Undo' }).click();

    // Both items are back, at their original slots (0 and 2), so the
    // surrounding order is intact.
    await expect(tiles).toHaveCount(6, { timeout: 8_000 });
    await expect(tiles.nth(0).locator('.ff-tile__label')).toHaveText(title0, { timeout: 8_000 });
    await expect(tiles.nth(2).locator('.ff-tile__label')).toHaveText(title2, { timeout: 8_000 });
  });

  // -------------------------------------------------------------------------
  test('batch delete with out-of-order selection still restores the original order on Undo', async ({ newtabPage }) => {
    // Snapshots are captured in click (selection) order, not spatial order.
    // Clicking the higher index first, then the lower one, previously replayed
    // restores in that same (spatially descending) order — which inserts the
    // higher-index item first and shifts the lower-index slot out from under
    // the still-pending restore, misplacing it. Clicking index 2 before index
    // 0 exercises that path; this test asserts the FULL original order comes
    // back, not just the two restored slots.
    const seeded = await seedMinimal(newtabPage, { rootBookmarks: 6 });
    await reloadNewtab(newtabPage);
    await patchWorkspace(newtabPage, { bookmarkSortMode: 'manual', folderMode: 'grid' }, MINIMAL_WS_ID);
    await reloadNewtab(newtabPage);

    const tiles = tilesInScope(newtabPage, seeded.rootFolderId);
    const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';

    await expect(tiles).toHaveCount(6);
    const titleAt = (i: number) => tiles.nth(i).locator('.ff-tile__label').innerText();
    const originalTitles = await Promise.all([0, 1, 2, 3, 4, 5].map(titleAt));

    // Click index 2 first, then index 0 — out of spatial order.
    await tiles.nth(2).click({ modifiers: [modKey] });
    await tiles.nth(0).click({ modifiers: [modKey] });

    await newtabPage.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await newtabPage.keyboard.press('Delete');

    const dialog = newtabPage.locator('.ff-dialog');
    await dialog.waitFor({ state: 'visible', timeout: 5_000 });
    await dialog.getByRole('button', { name: /Delete 2 bookmarks/ }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 5_000 });

    await expect(tiles).toHaveCount(4, { timeout: 8_000 });

    const toast = undoToast(newtabPage, /^Deleted 2 items/);
    await expect(toast).toBeVisible({ timeout: 5_000 });

    await toast.locator('.ff-toast__action', { hasText: 'Undo' }).click();

    // Every slot matches the pre-delete order, not just the two restored ones.
    await expect(tiles).toHaveCount(6, { timeout: 8_000 });
    for (let i = 0; i < originalTitles.length; i++) {
      await expect(tiles.nth(i).locator('.ff-tile__label')).toHaveText(originalTitles[i], { timeout: 8_000 });
    }
  });
});
