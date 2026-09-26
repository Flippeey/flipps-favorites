import { test } from '../../fixtures/world.js';
import { openContextMenu, createSubFolder, reloadNewtab } from '../../fixtures/bookmark-helpers.js';
import { tileById } from '../../fixtures/selectors.js';
import { capture } from '../evidence.js';

test.describe('move-to guards + mixed-selection label', () => {
  test('mixed-selection context menu label', async ({ newtabPage, world }, testInfo) => {
    const folderTile = tileById(newtabPage, world.bookmarkIdByTitle('Project Apollo'));
    const bookmarkTile = tileById(newtabPage, world.bookmarkIdByTitle('GitHub'));
    const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';

    await folderTile.click({ modifiers: [modKey] });
    await bookmarkTile.click({ modifiers: [modKey] });

    const menu = await openContextMenu(newtabPage, bookmarkTile);
    await capture(newtabPage, testInfo, 'mixed-selection-menu');
  });

  test('Move to… picker greys out the selected folder', async ({ newtabPage, world }, testInfo) => {
    const folderId = world.bookmarkIdByTitle('Project Apollo');
    await createSubFolder(newtabPage, folderId, 'Nested Sub');
    await reloadNewtab(newtabPage);

    const folderTile = tileById(newtabPage, folderId);
    const bookmarkTile = tileById(newtabPage, world.bookmarkIdByTitle('GitHub'));
    const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';

    await folderTile.click({ modifiers: [modKey] });
    await bookmarkTile.click({ modifiers: [modKey] });

    const menu = await openContextMenu(newtabPage, bookmarkTile);
    await menu.getByRole('menuitem', { name: /Move to/i }).click();

    const dialog = newtabPage.locator('.ff-dialog[role="dialog"]');
    await dialog.waitFor({ state: 'visible' });
    await dialog.locator('button[aria-label="Expand Other bookmarks"]').click();
    await dialog.locator('button[aria-label="Expand Work"]').click();
    await capture(newtabPage, testInfo, 'move-to-picker-disabled-folder');
  });
});
