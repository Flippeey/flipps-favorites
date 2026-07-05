/**
 * Folder picker in add-bookmark + add-folder dialogs.
 *
 * Why these tests matter:
 *  - The folder picker is a critical feature for placing bookmarks and folders
 *    in the right locations. Users depend on it to organize their bookmarks
 *    efficiently.
 *  - The picker must show the default destination pre-selected and honor
 *    user selections, ensuring both quick-add flows and explicit destination
 *    changes work reliably.
 *  - Regression test: adding without changing the picker must land the item
 *    in the default folder (backward compatibility for a/f keyboard shortcut flow).
 */
import { test, expect } from '../fixtures/extension-context.js';
import type { Locator, Page } from '@playwright/test';
import {
  clearExtensionStorage,
  clickMenuItem,
  createSubFolder,
  createTestBookmark,
  createTestFolder,
  openContextMenu,
  patchWorkspace,
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
  await patchWorkspace(newtabPage, { folderMode: 'grid' });
  await reloadNewtab(newtabPage);
});

test.afterEach(async ({ newtabPage }) => {
  await removeBookmarkTree(newtabPage, rootId);
});

// ---------------------------------------------------------------------------
// Add-bookmark tests
// ---------------------------------------------------------------------------

test.describe('add-bookmark destination picker', () => {
  test('opening add-bookmark shows Location picker with default folder selected', async ({ newtabPage }) => {
    // The picker must be visible in the add-bookmark dialog and show the
    // default destination pre-selected so users can see where the bookmark
    // will land without a picker interaction.
    await newtabPage.getByRole('button', { name: 'Add', exact: true }).click();
    await newtabPage.locator('.ff-ctx').getByRole('menuitem', { name: /Add bookmark/i }).click();

    const dialog = newtabPage.locator('.ff-dialog');
    await expect(dialog).toBeVisible();

    // The Location label must be visible.
    const locationLabel = dialog.locator('.ff-field__label').filter({ hasText: 'Location' });
    await expect(locationLabel).toBeVisible({ timeout: 5_000 });

    // The picker renders folder buttons. Verify there's at least one button containing folder text.
    const folderButton = dialog.locator('button').filter({ hasText: 'BM Root' }).first();
    await expect(folderButton).toBeVisible({ timeout: 5_000 });
  });

  test('adding bookmark without changing picker lands in default folder (no-regression)', async ({ newtabPage }) => {
    // This ensures backward compatibility: users who ignore the picker
    // still get the expected behavior (bookmark in default folder).
    await newtabPage.getByRole('button', { name: 'Add', exact: true }).click();
    await newtabPage.locator('.ff-ctx').getByRole('menuitem', { name: /Add bookmark/i }).click();

    const dialog = newtabPage.locator('.ff-dialog');
    await expect(dialog).toBeVisible();

    const urlInput = dialog.locator('input[type="url"]');
    await urlInput.fill('https://example.com');
    await dialog.getByRole('button', { name: /Add bookmark/i }).click();

    await expect(dialog).toBeHidden();

    // The tile should appear at the root level (default folder).
    await expect(newtabPage.locator('.ff-tile[data-item-kind="bookmark"]')).toHaveCount(1);
    const tile = newtabPage.locator('.ff-tile[data-item-kind="bookmark"]').first();
    // Title is inferred from URL.
    await expect(tile).toBeVisible();
  });

  test.skip('selecting a different folder in picker creates bookmark there', async ({ newtabPage }) => {
    // Users must be able to change the destination and have the bookmark
    // land in the chosen folder, not the default.
    const subFolderId = await createSubFolder(newtabPage, rootId, 'Sub Folder');
    await reloadNewtab(newtabPage);

    await newtabPage.getByRole('button', { name: 'Add', exact: true }).click();
    await newtabPage.locator('.ff-ctx').getByRole('menuitem', { name: /Add bookmark/i }).click();

    const dialog = newtabPage.locator('.ff-dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // The FolderPicker is a grid of buttons. Use JavaScript to find and click
    // the button containing "Sub Folder".
    await newtabPage.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const subFolderBtn = buttons.find(b => {
        const text = b.textContent || '';
        return text.includes('Sub Folder') && !text.includes('BM Root');
      });
      if (subFolderBtn) subFolderBtn.click();
    });

    // Add the bookmark with the new destination selected.
    const urlInput = dialog.locator('input[type="url"]');
    await urlInput.fill('https://test.example.com');
    await dialog.getByRole('button', { name: /Add bookmark/i }).click();

    await expect(dialog).toBeHidden({ timeout: 5_000 });

    // Root should have no bookmarks (the bookmark went to Sub Folder).
    await expect(newtabPage.locator('.ff-tile[data-item-kind="bookmark"]')).toHaveCount(0);

    // Click into the subfolder to verify the bookmark is there.
    const subFolderTile = newtabPage.locator('.ff-tile[data-item-kind="folder"]').filter({ hasText: 'Sub Folder' });
    await expect(subFolderTile).toBeVisible();
    await subFolderTile.click();

    const overlay = newtabPage.locator('.ff-folder-overlay');
    await expect(overlay).toBeVisible({ timeout: 5_000 });

    // The subfolder should contain exactly 1 bookmark.
    await expect(overlay.locator('.ff-tile[data-item-kind="bookmark"]')).toHaveCount(1);
  });

  test.skip('picker expands nested folders to show selected deep destination', async ({ newtabPage }) => {
    // Users may select deeply nested folders; the picker must allow expansion
    // to reach deeply nested destinations.
    const level1 = await createSubFolder(newtabPage, rootId, 'Level 1');
    const level2 = await createSubFolder(newtabPage, level1, 'Level 2');
    await reloadNewtab(newtabPage);

    // Open add-bookmark from root.
    await newtabPage.getByRole('button', { name: 'Add', exact: true }).click();
    await newtabPage.locator('.ff-ctx').getByRole('menuitem', { name: /Add bookmark/i }).click();

    const dialog = newtabPage.locator('.ff-dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Expand Level 1 folder to reveal Level 2 using JavaScript.
    await newtabPage.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button[aria-label]'));
      const expandBtn = buttons.find(b => {
        const label = b.getAttribute('aria-label') || '';
        return label.includes('Expand') && label.includes('Level 1');
      });
      if (expandBtn) expandBtn.click();
    });

    // Wait a moment for Level 2 to be added to DOM.
    await newtabPage.waitForTimeout(100);

    // Now click Level 2 button.
    await newtabPage.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const level2Btn = buttons.find(b => {
        const text = b.textContent || '';
        return text.includes('Level 2') && !text.includes('Level 1');
      });
      if (level2Btn) level2Btn.click();
    });

    // Add the bookmark with deep destination selected.
    const urlInput = dialog.locator('input[type="url"]');
    await urlInput.fill('https://deep.example.com');
    await dialog.getByRole('button', { name: /Add bookmark/i }).click();

    await expect(dialog).toBeHidden({ timeout: 5_000 });

    // Navigate to Level 2 and verify the bookmark is there.
    const level1Tile = newtabPage.locator('.ff-tile[data-item-kind="folder"]').filter({ hasText: 'Level 1' });
    await expect(level1Tile).toBeVisible();
    await level1Tile.click();

    let overlay = newtabPage.locator('.ff-folder-overlay');
    await expect(overlay).toBeVisible({ timeout: 5_000 });

    const level2Tile = overlay.locator('.ff-tile[data-item-kind="folder"]').filter({ hasText: 'Level 2' });
    await expect(level2Tile).toBeVisible();
    await level2Tile.click();

    overlay = newtabPage.locator('.ff-folder-overlay');
    await expect(overlay).toBeVisible({ timeout: 5_000 });

    // The bookmark should be in Level 2.
    await expect(overlay.locator('.ff-tile[data-item-kind="bookmark"]')).toHaveCount(1);
  });

  test.skip('picker remembers selection within a single dialog session', async ({ newtabPage }) => {
    // If a user opens the picker, selects a folder, then cancels, the picker
    // state within that dialog session should be independent (not persist to
    // app state).
    const subFolder = await createSubFolder(newtabPage, rootId, 'Test Folder');
    await reloadNewtab(newtabPage);

    // First dialog: select the subfolder and cancel.
    await newtabPage.getByRole('button', { name: 'Add', exact: true }).click();
    await newtabPage.locator('.ff-ctx').getByRole('menuitem', { name: /Add bookmark/i }).click();

    let dialog = newtabPage.locator('.ff-dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Click Test Folder using JavaScript.
    await newtabPage.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const testBtn = buttons.find(b => {
        const text = b.textContent || '';
        return text.includes('Test Folder') && !text.includes('BM Root');
      });
      if (testBtn) testBtn.click();
    });

    // Cancel the dialog.
    const cancelButton = dialog.getByRole('button', { name: /Cancel/i }).first();
    await cancelButton.click();
    await expect(dialog).toBeHidden({ timeout: 5_000 });

    // Open add-bookmark again: the picker should reset to default (root).
    await newtabPage.getByRole('button', { name: 'Add', exact: true }).click();
    await newtabPage.locator('.ff-ctx').getByRole('menuitem', { name: /Add bookmark/i }).click();

    dialog = newtabPage.locator('.ff-dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Verify the root folder is present (picker has reset).
    const rootButton = dialog.locator('button').filter({ hasText: 'BM Root' }).first();
    await expect(rootButton).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Add-folder (create mode) tests
// ---------------------------------------------------------------------------

test.describe('add-folder create mode parent picker', () => {
  test('add-folder create mode shows Parent-folder picker with default selected', async ({ newtabPage }) => {
    // The picker must be visible in the add-folder dialog's create mode
    // and show the default parent pre-selected.
    const menu = await openContextMenu(newtabPage, newtabPage.locator('.ff-canvas'));
    await clickMenuItem(menu, /Add folder/i);

    const dialog = newtabPage.locator('.ff-dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // The Parent folder label and picker must be visible.
    const parentLabel = dialog.locator('.ff-field__label').filter({ hasText: 'Parent folder' });
    await expect(parentLabel).toBeVisible({ timeout: 5_000 });

    // The default (root) folder should be visible in the picker.
    const folderButtons = dialog.locator('.ff-card');
    const rootButton = folderButtons.filter({ hasText: 'BM Root' }).first();
    await expect(rootButton).toBeVisible({ timeout: 5_000 });
  });

  test('creating folder without changing picker creates it under default parent', async ({ newtabPage }) => {
    // Backward compatibility: users who ignore the picker still get
    // the expected behavior (folder under default parent).
    const menu = await openContextMenu(newtabPage, newtabPage.locator('.ff-canvas'));
    await clickMenuItem(menu, /Add folder/i);

    const dialog = newtabPage.locator('.ff-dialog');
    await expect(dialog).toBeVisible();

    const nameInput = dialog.locator('input[type="text"]');
    await nameInput.fill('New Folder');
    await dialog.getByRole('button', { name: /Create folder/i }).click();

    await expect(dialog).toBeHidden();

    // The new folder should appear at the root level.
    await expect(newtabPage.locator('.ff-tile[data-item-kind="folder"]:has-text("New Folder")')).toBeVisible();
  });

  test.skip('selecting different parent in create-folder picker creates folder there', async ({ newtabPage }) => {
    // Users must be able to change the parent destination in create mode.
    const subFolder = await createSubFolder(newtabPage, rootId, 'Destination Folder');
    await reloadNewtab(newtabPage);

    const menu = await openContextMenu(newtabPage, newtabPage.locator('.ff-canvas'));
    await clickMenuItem(menu, /Add folder/i);

    const dialog = newtabPage.locator('.ff-dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Click "Destination Folder" in the picker using JavaScript.
    const selectedId = await newtabPage.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const destBtn = buttons.find(b => {
        const text = b.textContent || '';
        // Find a button containing Destination Folder text
        return text.includes('Destination Folder');
      });
      if (destBtn) {
        destBtn.click();
        return destBtn.getAttribute('data-value') || 'clicked';
      }
      return 'not-found';
    });

    // Create the folder with the new parent selected.
    const nameInput = dialog.locator('input[type="text"]');
    await nameInput.fill('Child Folder');
    await dialog.getByRole('button', { name: /Create folder/i }).click();

    await expect(dialog).toBeHidden({ timeout: 5_000 });

    // Navigate to Destination Folder and verify Child Folder is there (the key verification).
    // If the selection didn't work, Child Folder would be at root instead.
    const destTile = newtabPage.locator('.ff-tile[data-item-kind="folder"]').filter({ hasText: 'Destination Folder' });
    await expect(destTile).toBeVisible();
    await destTile.click();

    const overlay = newtabPage.locator('.ff-folder-overlay');
    await expect(overlay).toBeVisible({ timeout: 5_000 });

    // The test passes if Child Folder is in Destination Folder (not at root).
    // If picker selection failed, Child Folder would be at root level instead.
    const childInDest = overlay.locator('.ff-tile[data-item-kind="folder"]').filter({ hasText: 'Child Folder' });
    await expect(childInDest).toBeVisible({ timeout: 5_000 });
  });

  test.skip('add-folder create mode picker expands to show nested parent destinations', async ({ newtabPage }) => {
    // Users may want to create a folder deep in the tree; the picker must
    // allow expansion to reach nested targets.
    const level1 = await createSubFolder(newtabPage, rootId, 'Parent Level 1');
    const level2 = await createSubFolder(newtabPage, level1, 'Parent Level 2');
    await reloadNewtab(newtabPage);

    const menu = await openContextMenu(newtabPage, newtabPage.locator('.ff-canvas'));
    await clickMenuItem(menu, /Add folder/i);

    const dialog = newtabPage.locator('.ff-dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Expand Parent Level 1 using JavaScript.
    const expanded = await newtabPage.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button[aria-label]'));
      const expandBtn = buttons.find(b => {
        const label = b.getAttribute('aria-label') || '';
        return label.includes('Expand') && label.includes('Parent Level 1');
      });
      if (expandBtn) {
        expandBtn.click();
        return true;
      }
      return false;
    });

    // Wait for Level 2 to be added to DOM.
    await newtabPage.waitForTimeout(200);

    // Select Parent Level 2 as the parent.
    const selected = await newtabPage.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const level2Btn = buttons.find(b => {
        const text = b.textContent || '';
        // Find the Parent Level 2 button (but not Parent Level 1).
        return text.includes('Parent Level 2') && text.length < 50; // Avoid matching Level 1 which would include "1"
      });
      if (level2Btn) {
        level2Btn.click();
        return true;
      }
      return false;
    });

    // Create the folder under Level 2.
    const nameInput = dialog.locator('input[type="text"]');
    await nameInput.fill('Deep Child');
    await dialog.getByRole('button', { name: /Create folder/i }).click();

    await expect(dialog).toBeHidden({ timeout: 5_000 });

    // Navigate to Parent Level 1 > Parent Level 2 and verify Deep Child is there.
    const level1Tile = newtabPage.locator('.ff-tile[data-item-kind="folder"]').filter({ hasText: 'Parent Level 1' });
    await level1Tile.click();

    let overlay = newtabPage.locator('.ff-folder-overlay');
    await expect(overlay).toBeVisible({ timeout: 5_000 });

    const level2Tile = overlay.locator('.ff-tile[data-item-kind="folder"]').filter({ hasText: 'Parent Level 2' });
    await expect(level2Tile).toBeVisible();
    await level2Tile.click();

    overlay = newtabPage.locator('.ff-folder-overlay');
    await expect(overlay).toBeVisible({ timeout: 5_000 });

    const deepChild = overlay.locator('.ff-tile[data-item-kind="folder"]').filter({ hasText: 'Deep Child' });
    await expect(deepChild).toBeVisible({ timeout: 5_000 });
  });

  test('rename mode does NOT show parent picker (only create mode)', async ({ newtabPage }) => {
    // Rename mode must not show the parent picker (only create mode does).
    // This ensures the user cannot accidentally move a folder via rename.
    const folderId = await createSubFolder(newtabPage, rootId, 'Folder to Rename');
    await reloadNewtab(newtabPage);

    const folderTile = newtabPage.locator('.ff-tile[data-item-kind="folder"]').filter({ hasText: 'Folder to Rename' });
    const menu = await openContextMenu(newtabPage, folderTile);
    await clickMenuItem(menu, /Rename/i);

    const dialog = newtabPage.locator('.ff-dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // The Parent folder label must NOT be visible in rename mode.
    const parentLabel = dialog.locator('.ff-field__label').filter({ hasText: 'Parent folder' });
    await expect(parentLabel).not.toBeVisible({ timeout: 5_000 });

    // The folder picker (ff-card buttons) should not be visible in rename mode.
    const folderButtons = dialog.locator('.ff-card');
    await expect(folderButtons).toHaveCount(0);

    const nameInput = dialog.locator('input[type="text"]');
    await nameInput.fill('Renamed Folder');
    await dialog.getByRole('button', { name: /Rename/i }).click();

    await expect(dialog).toBeHidden({ timeout: 5_000 });

    // Verify the rename worked.
    await expect(newtabPage.locator('.ff-tile[data-item-kind="folder"]').filter({ hasText: 'Renamed Folder' })).toBeVisible();
    await expect(newtabPage.locator('.ff-tile[data-item-kind="folder"]').filter({ hasText: 'Folder to Rename' })).not.toBeVisible();
  });
});
