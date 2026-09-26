import { test, expect } from '../../fixtures/world.js';
import { resetStorage, seedMinimal } from '../../fixtures/seeding.js';
import { reloadNewtab, patchWorkspace } from '../../fixtures/bookmark-helpers.js';
import { capture } from '../evidence.js';

const MINIMAL_WS_ID = 'ws-minimal';

test.describe('move selection to folder', () => {
  test('multi-select bookmarks, open the folder picker, and move them with Undo', async ({ newtabPage }, testInfo) => {
    await resetStorage(newtabPage);
    await seedMinimal(newtabPage, { rootBookmarks: 5, folders: 1, bookmarksPerFolder: 2 });
    await reloadNewtab(newtabPage);
    await patchWorkspace(newtabPage, { bookmarkSortMode: 'manual', folderMode: 'grid' }, MINIMAL_WS_ID);
    await reloadNewtab(newtabPage);

    const rootBookmarks = newtabPage.locator('.ff-canvas [data-item-id][data-item-kind="bookmark"]');
    const firstTile = rootBookmarks.nth(0);
    const secondTile = rootBookmarks.nth(1);

    await firstTile.click({ modifiers: ['ControlOrMeta'] });
    await secondTile.click({ modifiers: ['ControlOrMeta'] });
    await expect(firstTile).toHaveAttribute('data-selected', 'true', { timeout: 5_000 });
    await expect(secondTile).toHaveAttribute('data-selected', 'true', { timeout: 5_000 });
    await capture(newtabPage, testInfo, 'two-bookmarks-selected');

    await secondTile.click({ button: 'right' });
    const menu = newtabPage.locator('.ff-ctx[role="menu"]');
    await menu.waitFor({ state: 'visible', timeout: 5_000 });
    await capture(newtabPage, testInfo, 'context-menu-move-action');
    await menu.locator('[role="menuitem"]', { hasText: /Move .* items to folder/i }).click();

    const picker = newtabPage.locator('div.ff-dialog[role="dialog"]').first();
    await picker.waitFor({ state: 'visible', timeout: 5_000 });
    await capture(newtabPage, testInfo, 'folder-picker-dialog');

    const folderButtons = picker.locator('button[data-folder-id]');
    await folderButtons.nth(1).click();
    await picker.getByRole('button', { name: /Move here/ }).click();
    await picker.waitFor({ state: 'hidden', timeout: 5_000 });

    const toast = newtabPage.locator('.ff-toast', { has: newtabPage.locator('.ff-toast__msg', { hasText: /^Moved/ }) });
    await expect(toast).toBeVisible({ timeout: 5_000 });
    await capture(newtabPage, testInfo, 'moved-with-undo-toast');
  });
});
