/**
 * Folder navigation and CRUD — overlay mode (default) and page mode.
 *
 * Why these tests matter:
 *  - Folders are the primary organisation primitive; users depend on reliable
 *    navigation (open, back, breadcrumb jump, keyboard) and CRUD (create,
 *    rename, delete with descendant-count guard) to stay productive.
 *  - Overlay and page mode are distinct UX paths that share the same underlying
 *    bookmark data but render completely differently.
 */
import { test, expect } from '../fixtures/world.js';
import { openContextMenu, clickMenuItem, createSubFolder } from '../fixtures/bookmark-helpers.js';
import { tileById, overlayCrumb } from '../fixtures/selectors.js';
import { patchSettings } from '../fixtures/seeding.js';

// ---------------------------------------------------------------------------
// Overlay mode tests (default folderOpenMode = 'overlay')
// ---------------------------------------------------------------------------

test.describe('overlay mode', () => {
  test('clicking a folder tile opens the overlay and shows the folder title in the breadcrumb', async ({ newtabPage, world }) => {
    // The overlay is how most users access a folder; it must open and identify
    // the correct folder so the user knows where they are.
    const folderId = world.bookmarkIdByTitle('Project Apollo');
    await tileById(newtabPage, folderId).click();

    const overlay = newtabPage.locator('.ff-folder-overlay');
    await overlay.waitFor({ state: 'visible', timeout: 5_000 });

    // The current-level crumb carries data-here="true".
    await expect(
      newtabPage.locator('.ff-folder-overlay__crumb[data-here="true"]'),
    ).toHaveText('Project Apollo');
  });

  test('back button returns to parent folder after navigating into a subfolder', async ({ newtabPage, world }) => {
    // Back navigation is the escape hatch from deep folders; it must go up
    // exactly one level, not close the overlay entirely.
    const parentId = world.bookmarkIdByTitle('Project Apollo');

    // Create a subfolder so we have two levels to navigate.
    const subId = await createSubFolder(newtabPage, parentId, 'Sub-back-test');

    await newtabPage.reload();
    await newtabPage.waitForSelector('.ff-app', { timeout: 15_000 });

    await tileById(newtabPage, parentId).click();
    await newtabPage.locator('.ff-folder-overlay').waitFor({ state: 'visible' });

    // Navigate into the subfolder.
    await tileById(newtabPage, subId).click();
    await expect(
      newtabPage.locator('.ff-folder-overlay__crumb[data-here="true"]'),
    ).toHaveText('Sub-back-test');

    // Click the back button — should return to Project Apollo.
    await newtabPage.getByRole('button', { name: 'Back to parent folder' }).click();
    await expect(
      newtabPage.locator('.ff-folder-overlay__crumb[data-here="true"]'),
    ).toHaveText('Project Apollo');
  });

  test('Backspace key navigates up one level inside the overlay', async ({ newtabPage, world }) => {
    // Keyboard-first users rely on Backspace for back-navigation; it must not
    // fire when an input is focused (tested implicitly — no input is focused here).
    const parentId = world.bookmarkIdByTitle('Project Apollo');
    const subId = await createSubFolder(newtabPage, parentId, 'Sub-backspace-test');

    await newtabPage.reload();
    await newtabPage.waitForSelector('.ff-app', { timeout: 15_000 });

    await tileById(newtabPage, parentId).click();
    await newtabPage.locator('.ff-folder-overlay').waitFor({ state: 'visible' });

    await tileById(newtabPage, subId).click();
    await expect(
      newtabPage.locator('.ff-folder-overlay__crumb[data-here="true"]'),
    ).toHaveText('Sub-backspace-test');

    // Ensure no input is focused before pressing Backspace.
    await newtabPage.locator('.ff-folder-overlay').click();
    await newtabPage.keyboard.press('Backspace');

    await expect(
      newtabPage.locator('.ff-folder-overlay__crumb[data-here="true"]'),
    ).toHaveText('Project Apollo');
  });

  test('breadcrumb click jumps to the ancestor level', async ({ newtabPage, world }) => {
    // Breadcrumb clicks let users jump multiple levels at once; the clicked
    // crumb must become the active level without closing the overlay.
    const parentId = world.bookmarkIdByTitle('Project Apollo');
    const subId = await createSubFolder(newtabPage, parentId, 'Sub-crumb-test');

    await newtabPage.reload();
    await newtabPage.waitForSelector('.ff-app', { timeout: 15_000 });

    await tileById(newtabPage, parentId).click();
    await newtabPage.locator('.ff-folder-overlay').waitFor({ state: 'visible' });

    // Navigate to the child folder.
    await tileById(newtabPage, subId).click();
    await expect(
      newtabPage.locator('.ff-folder-overlay__crumb[data-here="true"]'),
    ).toHaveText('Sub-crumb-test');

    // Click the breadcrumb for the parent (data-overlay-crumb-id is set on
    // non-current crumbs, i.e. all except the last in the stack).
    await overlayCrumb(newtabPage, parentId).click();

    await expect(
      newtabPage.locator('.ff-folder-overlay__crumb[data-here="true"]'),
    ).toHaveText('Project Apollo');
  });
});

// ---------------------------------------------------------------------------
// Page mode tests
// ---------------------------------------------------------------------------

test.describe('page mode', () => {
  test('clicking a folder tile pushes it onto the path and shows it in the nav breadcrumb', async ({ newtabPage, world }) => {
    // Page mode replaces the root grid with a FolderPageView; the nav bar must
    // reflect the new location so users are never lost.
    await patchSettings(newtabPage, { folderOpenMode: 'page' });
    await newtabPage.reload();
    await newtabPage.waitForSelector('.ff-app', { timeout: 15_000 });

    const folderId = world.bookmarkIdByTitle('Project Apollo');
    await tileById(newtabPage, folderId).click();

    // The page-mode folder view is rendered as .ff-page-view.
    await expect(newtabPage.locator('.ff-page-view')).toBeVisible();

    // The nav breadcrumb ends with the current folder title.
    await expect(newtabPage.locator('.ff-crumb__here')).toHaveText('Project Apollo');
  });

  test('clicking the workspace button in the breadcrumb returns to root', async ({ newtabPage, world }) => {
    // Home navigation is how users escape a deep path; the workspace crumb must
    // clear the path and hide the folder view entirely.
    await patchSettings(newtabPage, { folderOpenMode: 'page' });
    await newtabPage.reload();
    await newtabPage.waitForSelector('.ff-app', { timeout: 15_000 });

    const folderId = world.bookmarkIdByTitle('Project Apollo');
    await tileById(newtabPage, folderId).click();
    await expect(newtabPage.locator('.ff-page-view')).toBeVisible();

    // The first .ff-crumb__btn is the workspace name button — clicking it
    // calls handleSwitchWorkspace which resets folderPath to [].
    await newtabPage.locator('.ff-crumb__btn').first().click();

    await expect(newtabPage.locator('.ff-page-view')).toHaveCount(0);
    // No trailing "here" crumb when at root.
    await expect(newtabPage.locator('.ff-crumb__here')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Folder CRUD
// ---------------------------------------------------------------------------

test.describe('folder CRUD', () => {
  test('create folder via the add-folder button opens FolderNameDialog and creates the folder', async ({ newtabPage, world }) => {
    // The FolderNameDialog is the primary create-folder path; after confirm the
    // new folder must appear as a tile in the current view.

    // Open Project Apollo in overlay mode so we have a target parent folder.
    const parentId = world.bookmarkIdByTitle('Project Apollo');
    await tileById(newtabPage, parentId).click();
    await newtabPage.locator('.ff-folder-overlay').waitFor({ state: 'visible' });

    // Click the "Add folder inside" button (aria-label in FolderOverlay header).
    await newtabPage.getByRole('button', { name: 'Add folder inside' }).click();

    // The FolderNameDialog should open with eyebrow "New folder".
    const dialog = newtabPage.locator('.ff-modal-scrim');
    await dialog.waitFor({ state: 'visible', timeout: 5_000 });
    await expect(dialog.getByText('New folder')).toBeVisible();

    // Type a name and confirm.
    await newtabPage.locator('.ff-input[placeholder="Folder name"]').fill('My New Folder');
    await newtabPage.getByRole('button', { name: 'Create folder' }).click();

    // Dialog closes and the new folder tile appears inside Project Apollo.
    await dialog.waitFor({ state: 'detached', timeout: 5_000 });
    await expect(
      newtabPage.locator('.ff-folder-overlay').getByText('My New Folder'),
    ).toBeVisible();
  });

  test('rename folder via context menu opens FolderNameDialog and renames the tile', async ({ newtabPage, world }) => {
    // Rename is a common corrective action; the context-menu path must
    // pre-populate the current name and persist the new one.
    const folderId = world.bookmarkIdByTitle('Documentation');
    const tile = tileById(newtabPage, folderId);

    const menu = await openContextMenu(newtabPage, tile);
    await clickMenuItem(menu, 'Edit…');

    // FolderNameDialog opens in rename mode.
    const dialog = newtabPage.locator('.ff-modal-scrim');
    await dialog.waitFor({ state: 'visible', timeout: 5_000 });

    const input = newtabPage.locator('.ff-input[placeholder="Folder name"]');
    // Pre-populated with the existing name.
    await expect(input).toHaveValue('Documentation');

    await input.fill('Docs Renamed');
    await newtabPage.getByRole('button', { name: 'Save folder' }).click();

    await dialog.waitFor({ state: 'detached', timeout: 5_000 });

    // The tile label must reflect the new name.
    await expect(tile.locator('.ff-tile__label')).toHaveText('Docs Renamed');
  });

  test('delete folder shows descendant count and confirms deletion', async ({ newtabPage, world }) => {
    // The delete confirmation must show how many items will be lost so the user
    // can make an informed decision; after confirm the tile must disappear.
    const folderId = world.bookmarkIdByTitle('Project Apollo');
    const tile = tileById(newtabPage, folderId);

    const menu = await openContextMenu(newtabPage, tile);
    await clickMenuItem(menu, 'Delete folder');

    // ConfirmDeleteDialog appears with the folder name as the title.
    const dialog = newtabPage.locator('.ff-modal-scrim');
    await dialog.waitFor({ state: 'visible', timeout: 5_000 });

    // Project Apollo has 4 bookmarks — confirm the descriptor message.
    await expect(dialog.locator('.ff-confirm__message')).toHaveText(
      'This will delete 4 bookmarks.',
    );

    await newtabPage.getByRole('button', { name: 'Delete folder' }).click();

    await dialog.waitFor({ state: 'detached', timeout: 5_000 });

    // The folder tile is gone from the root grid.
    await expect(tile).toHaveCount(0);
  });
});
