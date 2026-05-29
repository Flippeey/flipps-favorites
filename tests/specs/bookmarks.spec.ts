/**
 * Bookmark CRUD via dialogs + context menu.
 */
import { test, expect } from '../fixtures/extension-context.js';
import {
  clearExtensionStorage,
  clickMenuItem,
  createSubFolder,
  createTestBookmark,
  createTestFolder,
  openContextMenu,
  patchSettings,
  reloadNewtab,
  removeBookmarkTree,
  setupDefaultWorkspace,
  tileById,
} from '../fixtures/bookmark-helpers.js';

let rootId: string;

test.beforeEach(async ({ newtabPage }) => {
  await clearExtensionStorage(newtabPage);
  rootId = await createTestFolder(newtabPage, 'BM Root');
  await setupDefaultWorkspace(newtabPage, rootId);
  // Use grid mode so root bookmarks render at the top level.
  await patchSettings(newtabPage, { folderMode: 'grid' });
  await reloadNewtab(newtabPage);
});

test.afterEach(async ({ newtabPage }) => {
  await removeBookmarkTree(newtabPage, rootId);
});

test('QuickAdd via TopNav Add menu saves a new bookmark', async ({ newtabPage }) => {
  await newtabPage.getByRole('button', { name: 'Add', exact: true }).click();
  await newtabPage.locator('.ff-ctx').getByRole('menuitem', { name: /Add bookmark/i }).click();
  const dialog = newtabPage.locator('.ff-dialog');
  await expect(dialog).toBeVisible();

  const urlInput = dialog.locator('input[type="url"]');
  await urlInput.fill('https://playwright.dev/docs');
  await dialog.getByRole('button', { name: /Add bookmark/i }).click();

  await expect(dialog).toBeHidden();
  // Tile appears: title inferred from URL ("Docs" or hostname).
  await expect(newtabPage.locator('.ff-tile[data-item-kind="bookmark"]')).toHaveCount(1);
});

test('QuickAdd rejects an empty URL with an error message', async ({ newtabPage }) => {
  await newtabPage.getByRole('button', { name: 'Add', exact: true }).click();
  await newtabPage.locator('.ff-ctx').getByRole('menuitem', { name: /Add bookmark/i }).click();
  const dialog = newtabPage.locator('.ff-dialog');
  const urlInput = dialog.locator('input[type="url"]');
  await urlInput.fill('');
  await dialog.getByRole('button', { name: /Add bookmark/i }).click();

  await expect(dialog.locator('.ff-status[data-kind="error"]')).toContainText(/URL|enter/i);
});

test('right-click empty canvas surfaces Add bookmark + Add folder', async ({ newtabPage }) => {
  const menu = await openContextMenu(newtabPage, newtabPage.locator('.ff-canvas'));
  await expect(menu.getByRole('menuitem', { name: /Add bookmark/i })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Add folder/i })).toBeVisible();
});

test('context menu Add bookmark adds a tile via QuickAdd', async ({ newtabPage }) => {
  const menu = await openContextMenu(newtabPage, newtabPage.locator('.ff-canvas'));
  await clickMenuItem(menu, /Add bookmark/i);

  const dialog = newtabPage.locator('.ff-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('input[type="url"]').fill('https://example.com');
  await dialog.getByRole('button', { name: /Add bookmark/i }).click();

  await expect(newtabPage.locator('.ff-tile[data-item-kind="bookmark"]')).toHaveCount(1);
});

test('editing a bookmark updates the tile label', async ({ newtabPage }) => {
  const bmId = await createTestBookmark(newtabPage, rootId, 'Old Title', 'https://example.com');
  await reloadNewtab(newtabPage);

  const tile = tileById(newtabPage, bmId);
  await tile.waitFor();
  const menu = await openContextMenu(newtabPage, tile);
  await clickMenuItem(menu, /Edit/i);

  const dialog = newtabPage.locator('.ff-dialog');
  await expect(dialog).toBeVisible();
  const nameInput = dialog.locator('input.ff-input').first();
  await nameInput.fill('New Title');
  await dialog.getByRole('button', { name: /Save bookmark/i }).click();

  await expect(tile).toHaveAttribute('title', 'New Title', { timeout: 5_000 });
});

test('deleting a bookmark removes its tile', async ({ newtabPage }) => {
  const bmId = await createTestBookmark(newtabPage, rootId, 'Doomed', 'https://doomed.example.com');
  await reloadNewtab(newtabPage);
  const tile = tileById(newtabPage, bmId);
  await tile.waitFor();
  const menu = await openContextMenu(newtabPage, tile);
  await clickMenuItem(menu, 'Delete');

  await expect(tile).toHaveCount(0, { timeout: 5_000 });
});

test('renaming a folder updates its tile title', async ({ newtabPage }) => {
  const subId = await createSubFolder(newtabPage, rootId, 'Old Folder');
  await reloadNewtab(newtabPage);
  const tile = tileById(newtabPage, subId);
  await tile.waitFor();
  const menu = await openContextMenu(newtabPage, tile);
  await clickMenuItem(menu, /Rename/i);

  const dialog = newtabPage.locator('.ff-dialog');
  await dialog.locator('input.ff-input').first().fill('Renamed Folder');
  await dialog.getByRole('button', { name: /Rename/i }).click();

  await expect(tile).toHaveAttribute('title', 'Renamed Folder', { timeout: 5_000 });
});
