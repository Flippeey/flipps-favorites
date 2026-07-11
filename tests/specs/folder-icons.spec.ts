/**
 * Folder custom icons (opt-in) — issue #44.
 *
 * Why this matters: the feature is explicitly opt-in and must be a zero-diff
 * change for existing users (default collage/glyph rendering unless a custom
 * icon is set). These specs prove the full lifecycle — set via the folder
 * edit dialog, render in both grid and list views, then remove and confirm
 * default rendering returns — would fail if the custom-icon rendering broke.
 */
import { test, expect } from '../fixtures/extension-context.js';
import { MOCK_FAVICON_PNG } from '../fixtures/test-data.js';
import {
  clearExtensionStorage,
  clickMenuItem,
  createTestBookmark,
  createTestFolder,
  createSubFolder,
  openContextMenu,
  patchWorkspace,
  reloadNewtab,
  removeBookmarkTree,
  setupDefaultWorkspace,
} from '../fixtures/bookmark-helpers.js';

test.describe('folder custom icons', () => {
  let rootId: string;
  let folderId: string;

  test.beforeEach(async ({ newtabPage }) => {
    await clearExtensionStorage(newtabPage);
    rootId = await createTestFolder(newtabPage, 'Icon Root');
    folderId = await createSubFolder(newtabPage, rootId, 'Recipes');
    await createTestBookmark(newtabPage, folderId, 'Example Site', 'https://example.com');
    await setupDefaultWorkspace(newtabPage, rootId);
  });

  test.afterEach(async ({ newtabPage }) => {
    await removeBookmarkTree(newtabPage, rootId);
  });

  test('default rendering: grid shows the favicon collage, no custom-icon image', async ({ newtabPage }) => {
    await reloadNewtab(newtabPage);
    const tile = newtabPage.locator('.ff-tile[data-item-kind="folder"]', { hasText: 'Recipes' });
    await expect(tile).toBeVisible();
    // Default collage markup — zero-diff for existing users who never opt in.
    await expect(tile.locator('.ff-folder-tile__mini').first()).toBeVisible();
    await expect(tile.locator('.ff-folder-tile__custom-image')).toHaveCount(0);
  });

  test('set → grid renders the custom image with count badge preserved → remove reverts to default', async ({ newtabPage }) => {
    await reloadNewtab(newtabPage);
    const tile = newtabPage.locator('.ff-tile[data-item-kind="folder"]', { hasText: 'Recipes' });
    await expect(tile).toBeVisible();

    // Open the folder edit dialog (context menu → Rename opens FolderNameDialog,
    // which now also carries the icon section) and upload a custom icon.
    const menu = await openContextMenu(newtabPage, tile);
    await clickMenuItem(menu, 'Rename');

    const dialog = newtabPage.locator('.ff-modal-scrim');
    await expect(dialog).toBeVisible();

    const fileInput = dialog.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'folder-icon.png',
      mimeType: 'image/png',
      buffer: MOCK_FAVICON_PNG,
    });

    // Upload persists immediately (not gated behind the Rename submit) — the
    // preview updates in place.
    await expect(dialog.locator('.ff-iconpreview img')).toBeVisible({ timeout: 10_000 });

    await newtabPage.getByRole('button', { name: 'Rename' }).click();
    await expect(dialog).toBeHidden({ timeout: 5_000 });

    // Grid: custom image fills the tile, count badge preserved.
    const customImage = tile.locator('.ff-folder-tile__custom-image');
    await expect(customImage).toBeVisible({ timeout: 10_000 });
    await expect(tile.locator('.ff-folder-tile__count')).toHaveText('1');
    await expect(tile.locator('.ff-folder-tile__mini')).toHaveCount(0);

    // List view: the same custom icon replaces the folder glyph in the section header.
    await patchWorkspace(newtabPage, { folderMode: 'list' });
    await reloadNewtab(newtabPage);
    const section = newtabPage.locator('section[data-scope-folder-id]', { has: newtabPage.locator('.ff-section__title', { hasText: 'Recipes' }) });
    await expect(section.locator('.ff-section__icon-image')).toBeVisible({ timeout: 10_000 });

    // Switch back to grid and remove the icon — default rendering must return.
    await patchWorkspace(newtabPage, { folderMode: 'grid' });
    await reloadNewtab(newtabPage);
    const tileAfterListSwitch = newtabPage.locator('.ff-tile[data-item-kind="folder"]', { hasText: 'Recipes' });
    const menu2 = await openContextMenu(newtabPage, tileAfterListSwitch);
    await clickMenuItem(menu2, 'Rename');

    const dialog2 = newtabPage.locator('.ff-modal-scrim');
    await expect(dialog2).toBeVisible();
    await dialog2.locator('.ff-iconpreview').hover();
    await dialog2.getByRole('button', { name: 'Remove icon override' }).click();
    await expect(dialog2.locator('.ff-iconpreview img')).toHaveCount(0, { timeout: 10_000 });
    await newtabPage.locator('.ff-modal-scrim .ff-iconbtn').click();
    await expect(dialog2).toBeHidden({ timeout: 5_000 });

    await reloadNewtab(newtabPage);
    const tileAfterRemove = newtabPage.locator('.ff-tile[data-item-kind="folder"]', { hasText: 'Recipes' });
    await expect(tileAfterRemove.locator('.ff-folder-tile__custom-image')).toHaveCount(0);
    await expect(tileAfterRemove.locator('.ff-folder-tile__mini').first()).toBeVisible();
  });

  test('deleting a folder removes its custom-icon record (no leak on re-create with the same id space)', async ({ newtabPage }) => {
    await reloadNewtab(newtabPage);
    const tile = newtabPage.locator('.ff-tile[data-item-kind="folder"]', { hasText: 'Recipes' });
    const menu = await openContextMenu(newtabPage, tile);
    await clickMenuItem(menu, 'Rename');
    const dialog = newtabPage.locator('.ff-modal-scrim');
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'folder-icon.png',
      mimeType: 'image/png',
      buffer: MOCK_FAVICON_PNG,
    });
    await expect(dialog.locator('.ff-iconpreview img')).toBeVisible({ timeout: 10_000 });
    await newtabPage.getByRole('button', { name: 'Rename' }).click();
    await expect(dialog).toBeHidden({ timeout: 5_000 });

    // Delete the folder via context menu.
    const menu2 = await openContextMenu(newtabPage, tile);
    await clickMenuItem(menu2, 'Delete folder');
    const confirmDialog = newtabPage.locator('.ff-modal-scrim');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: 'Delete folder' }).click();
    await expect(newtabPage.locator('.ff-tile[data-item-kind="folder"]', { hasText: 'Recipes' })).toHaveCount(0);

    // Querying the icon record directly confirms the cleanup call fired (not
    // just that the tile is gone, which would also be true without cleanup).
    const record = await newtabPage.evaluate(async (id) => {
      const api = (globalThis as unknown as { browser?: { runtime: { sendMessage: (m: unknown) => Promise<unknown> } }; chrome: { runtime: { sendMessage: (m: unknown) => Promise<unknown> } } }).browser
        ?? (globalThis as unknown as { chrome: { runtime: { sendMessage: (m: unknown) => Promise<unknown> } } }).chrome;
      return api.runtime.sendMessage({ type: 'icons/get-folder-icon', folderId: id });
    }, folderId);
    expect((record as { icon: unknown }).icon).toBeNull();
  });
});
