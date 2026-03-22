/**
 * Bookmark CRUD tests — priority 4.
 *
 * Covers creating, editing, and deleting bookmarks via the context menu,
 * plus undo (Ctrl+Z) restoring a deleted bookmark.
 */
import { test, expect } from '../fixtures/extension-context.js';
import {
  createTestFolder,
  createTestBookmark,
  removeBookmarkTree,
  setRootFolderId,
  skipOnboarding,
  reloadNewtab,
} from '../fixtures/bookmark-helpers.js';

let testFolderId: string;

test.beforeEach(async ({ newtabPage }) => {
  await skipOnboarding(newtabPage);
  testFolderId = await createTestFolder(newtabPage, 'BM Test Folder');
  await setRootFolderId(newtabPage, testFolderId);
  await reloadNewtab(newtabPage);
});

test.afterEach(async ({ newtabPage }) => {
  await removeBookmarkTree(newtabPage, testFolderId);
});

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

test('right-clicking empty grid area shows context menu with Add bookmark option', async ({
  newtabPage,
}) => {
  const grid = newtabPage.locator('.bookmark-grid');
  await grid.click({ button: 'right' });

  const menu = newtabPage.locator('.bookmark-context-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-context-action="add-bookmark"]')).toBeVisible();
});

test('creating a bookmark via context menu adds a tile to the grid', async ({ newtabPage }) => {
  // Open surface context menu.
  await newtabPage.locator('.bookmark-grid').click({ button: 'right' });
  await newtabPage.locator('[data-context-action="add-bookmark"]').click();

  // The bookmark dialog should appear.
  const dialog = newtabPage.locator('.bookmark-dialog');
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  // Fill in title and URL using the correct input names.
  await dialog.locator('input[name="bookmarkDialogTitle"]').fill('My New Bookmark');
  await dialog.locator('input[name="bookmarkDialogUrl"]').fill('https://playwright.dev');

  // Save.
  await dialog.locator('button.bookmark-dialog-save-button').click();

  // The new tile should appear in the grid.
  await expect(
    newtabPage.locator('.bookmark-grid [data-link-url^="https://playwright.dev"]')
  ).toBeVisible({ timeout: 8_000 });
});

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

test('editing a bookmark title updates its tile label', async ({ newtabPage }) => {
  // Seed a bookmark directly.
  await createTestBookmark(newtabPage, testFolderId, 'Original Title', 'https://example.com');
  await reloadNewtab(newtabPage);

  // Right-click the tile. Browsers normalise URLs so use prefix match.
  const tile = newtabPage.locator('[data-link-url^="https://example.com"]').first();
  await tile.click({ button: 'right' });
  await newtabPage.locator('[data-context-action="edit"]').click();

  // The dialog should open with the current title.
  const dialog = newtabPage.locator('.bookmark-dialog');
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  const titleInput = dialog.locator('input[name="bookmarkDialogTitle"]');
  await titleInput.clear();
  await titleInput.fill('Updated Title');

  await dialog.locator('button.bookmark-dialog-save-button').click();

  // The tile label should now show the new title.
  await expect(newtabPage.locator('.bookmark-tile', { hasText: 'Updated Title' })).toBeVisible({
    timeout: 5_000,
  });
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

test('deleting a bookmark via context menu removes its tile from the grid', async ({
  newtabPage,
}) => {
  await createTestBookmark(newtabPage, testFolderId, 'To Delete', 'https://to-delete.example.com');
  await reloadNewtab(newtabPage);

  const tile = newtabPage.locator('[data-link-url^="https://to-delete.example.com"]').first();
  await expect(tile).toBeVisible();
  await tile.click({ button: 'right' });

  await newtabPage.locator('[data-context-action="delete"]').click();

  await expect(tile).not.toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

test('Ctrl+Z restores a deleted bookmark', async ({ newtabPage }) => {
  await createTestBookmark(
    newtabPage,
    testFolderId,
    'Undo Me',
    'https://undo-test.example.com'
  );
  await reloadNewtab(newtabPage);

  const tile = newtabPage.locator('[data-link-url^="https://undo-test.example.com"]').first();
  await expect(tile).toBeVisible();

  // Delete via context menu.
  await tile.click({ button: 'right' });
  await newtabPage.locator('[data-context-action="delete"]').click();
  await expect(tile).not.toBeVisible({ timeout: 5_000 });

  // Undo.
  await newtabPage.keyboard.press('Control+z');
  await expect(tile).toBeVisible({ timeout: 5_000 });
});
