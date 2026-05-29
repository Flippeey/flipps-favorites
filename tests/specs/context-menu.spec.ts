/**
 * Context menus: the right-click menu adapts to its target (bookmark, folder,
 * or empty canvas). Why it matters — the menu is the primary discovery path for
 * edit/delete/add actions; each target kind must expose the right verbs.
 *
 * Menu items carry their keyboard hint in the accessible name (e.g. "Open ↵"),
 * so we assert on the visible `.ff-ctx__label` text instead of the role name.
 */
import { test, expect } from '../fixtures/world.js';
import { openContextMenu } from '../fixtures/bookmark-helpers.js';
import { tileById } from '../fixtures/selectors.js';

test.describe('context menu', () => {
  test('bookmark menu exposes open / edit / delete actions', async ({ newtabPage, world }) => {
    const tile = tileById(newtabPage, world.bookmarkIdByTitle('GitHub'));
    const menu = await openContextMenu(newtabPage, tile);

    await expect(menu.locator('.ff-ctx__label', { hasText: 'Open' }).first()).toBeVisible();
    await expect(menu.locator('.ff-ctx__label', { hasText: 'Copy URL' })).toBeVisible();
    await expect(menu.locator('.ff-ctx__label', { hasText: 'Edit' })).toBeVisible();
    await expect(menu.locator('.ff-ctx__label', { hasText: 'Delete' })).toBeVisible();
  });

  test('folder menu exposes open / rename / delete-folder actions', async ({ newtabPage, world }) => {
    const folder = tileById(newtabPage, world.bookmarkIdByTitle('Project Apollo'));
    const menu = await openContextMenu(newtabPage, folder);

    await expect(menu.locator('.ff-ctx__label', { hasText: 'Open folder' })).toBeVisible();
    await expect(menu.locator('.ff-ctx__label', { hasText: 'Rename' })).toBeVisible();
    await expect(menu.locator('.ff-ctx__label', { hasText: 'Delete folder' })).toBeVisible();
  });

  test('empty-canvas menu exposes add + settings actions', async ({ newtabPage }) => {
    // Dispatch on the app root so the event target is the canvas itself
    // (not a tile, not the nav) → the canvas branch of the menu builder.
    await newtabPage.locator('.ff-app').dispatchEvent('contextmenu');
    const menu = newtabPage.locator('.ff-ctx');
    await menu.waitFor({ state: 'visible', timeout: 5_000 });

    await expect(menu.locator('.ff-ctx__label', { hasText: 'Add bookmark' })).toBeVisible();
    await expect(menu.locator('.ff-ctx__label', { hasText: 'Add folder' })).toBeVisible();
    await expect(menu.locator('.ff-ctx__label', { hasText: 'Settings' })).toBeVisible();
  });
});
