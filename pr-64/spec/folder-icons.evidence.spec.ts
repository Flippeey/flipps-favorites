/**
 * Evidence for PR #64 — opt-in custom icons for folders (issue #44), and the
 * three review defects found on the first cut:
 *
 *   1. The folder edit dialog had a bespoke narrow single-column layout instead
 *      of matching the bookmark edit dialog.
 *   2. The folder context menu still said "Rename" after the action became a
 *      full edit (name + icon).
 *   3. A custom-icon folder was indistinguishable from a bookmark tile, and its
 *      count badge was clipped off by overflow:hidden.
 *
 * Each capture below is the visual proof for one of those, plus the underlying
 * feature still working end-to-end. Screenshots land in tests/evidence/output/
 * and are posted to the PR by .github/workflows/pr-evidence.yml.
 */
import { test } from '../../fixtures/world.js';
import { openContextMenu, clickMenuItem } from '../../fixtures/bookmark-helpers.js';
import { tileById } from '../../fixtures/selectors.js';
import { MOCK_FAVICON_PNG } from '../../fixtures/test-data.js';
import { capture, settle } from '../evidence.js';

test.describe('folder custom icons (PR #64 review fixes)', () => {
  test('folder context menu reads "Edit…", not "Rename"', async ({ newtabPage, world }, testInfo) => {
    // Defect 2. The menu item and the dialog it opens must agree: the dialog
    // edits name *and* icon, and the bookmark menu already says "Edit…".
    const folder = tileById(newtabPage, world.bookmarkIdByTitle('Project Apollo'));
    const menu = await openContextMenu(newtabPage, folder);
    await settle(menu);
    await capture(newtabPage, testInfo, 'context-menu-edit-label');
  });

  test('folder edit dialog matches the bookmark edit dialog layout', async ({ newtabPage, world }, testInfo) => {
    // Defect 1. Captured back to back, same viewport, so the two dialogs can be
    // compared directly in the PR: both are the 880px two-column body
    // (280px aside + icon search grid), not a cramped 480px stack.
    const bookmark = tileById(newtabPage, world.bookmarkIdByTitle('GitHub'));
    const bookmarkMenu = await openContextMenu(newtabPage, bookmark);
    await clickMenuItem(bookmarkMenu, 'Edit…');
    const bookmarkDialog = newtabPage.locator('.ff-dialog[role="dialog"]');
    await bookmarkDialog.waitFor({ state: 'visible' });
    await settle(bookmarkDialog);
    await capture(newtabPage, testInfo, 'layout-1-bookmark-dialog-reference');
    await newtabPage.keyboard.press('Escape');
    await bookmarkDialog.waitFor({ state: 'hidden' });

    const folder = tileById(newtabPage, world.bookmarkIdByTitle('Project Apollo'));
    const folderMenu = await openContextMenu(newtabPage, folder);
    await clickMenuItem(folderMenu, 'Edit…');
    const folderDialog = newtabPage.locator('.ff-dialog[role="dialog"]');
    await folderDialog.waitFor({ state: 'visible' });
    await settle(folderDialog);
    await capture(newtabPage, testInfo, 'layout-2-folder-dialog-now-matches');
  });

  test('custom-icon folder keeps its folder frame and an unclipped count badge', async ({ newtabPage, world }, testInfo) => {
    // Defect 3 + the feature itself. The folder sits in a grid of real bookmark
    // tiles, so the shot shows the distinction in the context it failed in.
    const folder = tileById(newtabPage, world.bookmarkIdByTitle('Project Apollo'));
    await capture(newtabPage, testInfo, 'icon-1-default-collage-unchanged');

    const menu = await openContextMenu(newtabPage, folder);
    await clickMenuItem(menu, 'Edit…');
    const dialog = newtabPage.locator('.ff-dialog[role="dialog"]');
    await dialog.waitFor({ state: 'visible' });
    await settle(dialog);
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'folder-icon.png',
      mimeType: 'image/png',
      buffer: MOCK_FAVICON_PNG,
    });
    await dialog.locator('.ff-iconpreview img').waitFor({ state: 'visible', timeout: 10_000 });
    await capture(newtabPage, testInfo, 'icon-2-uploaded-in-dialog');

    await newtabPage.getByRole('button', { name: 'Save folder' }).click();
    await dialog.waitFor({ state: 'hidden' });
    await folder.locator('.ff-folder-tile__custom-image').waitFor({ state: 'visible', timeout: 10_000 });
    // At rest — no hover. The badge must be readable here, which is exactly what
    // overflow:hidden + the hover-only opacity rule used to prevent.
    await capture(newtabPage, testInfo, 'icon-3-grid-at-rest-vs-bookmarks');

    await folder.hover();
    await capture(newtabPage, testInfo, 'icon-4-grid-hovered');
  });

  test('clicking Search keeps the dialog open and the unsaved name intact', async ({ newtabPage, world }, testInfo) => {
    // Defect 4, found while re-reviewing — present in the PR's first cut, not a
    // regression from the other fixes. The dialog root is a <form> and the icon
    // search panel rendered a nested <form>, so clicking Search did a native GET
    // to newtab.html?: the page reloaded and the dialog (plus whatever name you
    // had typed) vanished. This capture is the after — the before was an empty
    // grid, because the whole page had navigated away.
    const folder = tileById(newtabPage, world.bookmarkIdByTitle('Project Apollo'));
    const menu = await openContextMenu(newtabPage, folder);
    await clickMenuItem(menu, 'Edit…');
    const dialog = newtabPage.locator('.ff-dialog[role="dialog"]');
    await dialog.waitFor({ state: 'visible' });
    await settle(dialog);

    await dialog.locator('input[type="text"]').first().fill('Typed but not saved yet');
    await dialog.getByRole('button', { name: 'Search', exact: true }).click({ noWaitAfter: true });
    await newtabPage.waitForTimeout(1200);
    // Dialog still standing, name still in the field.
    await capture(newtabPage, testInfo, 'search-click-dialog-survives');
  });

  test('custom-icon folder frame holds up across all three tile shapes', async ({ newtabPage, world }, testInfo) => {
    // The frame's radius and the badge's overhang both derive from --tile-size
    // and the data-tile-shape overrides, so all three shapes are worth showing.
    const folder = tileById(newtabPage, world.bookmarkIdByTitle('Project Apollo'));
    const menu = await openContextMenu(newtabPage, folder);
    await clickMenuItem(menu, 'Edit…');
    const dialog = newtabPage.locator('.ff-dialog[role="dialog"]');
    await dialog.waitFor({ state: 'visible' });
    await settle(dialog);
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'folder-icon.png',
      mimeType: 'image/png',
      buffer: MOCK_FAVICON_PNG,
    });
    await dialog.locator('.ff-iconpreview img').waitFor({ state: 'visible', timeout: 10_000 });
    await newtabPage.getByRole('button', { name: 'Save folder' }).click();
    await dialog.waitFor({ state: 'hidden' });
    await folder.locator('.ff-folder-tile__custom-image').waitFor({ state: 'visible', timeout: 10_000 });

    // 'squircle' (not 'square') is the real default — see TileShape in
    // src/shared/models.ts. 'square' matches no CSS rule and silently renders as
    // squircle, which would make this capture a mislabeled duplicate.
    for (const shape of ['squircle', 'rounded', 'circle'] as const) {
      await newtabPage.evaluate((s) => {
        document.querySelector('.ff-app')?.setAttribute('data-tile-shape', s);
      }, shape);
      await capture(newtabPage, testInfo, `shape-${shape}`);
    }
  });
});
