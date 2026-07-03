/**
 * Context menus: the right-click menu adapts to its target (bookmark, folder,
 * or empty canvas). Why it matters — the menu is the primary discovery path for
 * edit/delete/add actions; each target kind must expose the right verbs.
 *
 * Menu items carry their keyboard hint in the accessible name (e.g. "Open ↵"),
 * so we assert on the visible `.ff-ctx__label` text instead of the role name.
 */
import { test, expect } from '../fixtures/world.js';
import { createTestBookmark, openContextMenu, removeBookmarkTree } from '../fixtures/bookmark-helpers.js';
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

  test('"Open in new tab" on a bookmark opens a real new tab at its URL', async ({ newtabPage, world }) => {
    // Same root cause + fix as the middle-click regression (see
    // bookmarks.spec.ts "middle-click on a bookmark tile opens it in a new
    // tab" and dock.spec.ts "clicking a dock item opens its URL"): the
    // context-menu open-in-new-tab action used to call `window.open(...)`
    // directly from useContextMenuBuilder.ts, which Firefox's popup blocker
    // silently drops. It now routes through the extension message pipeline
    // (openTab -> service worker extensionApi.tabs.create). Assert the real,
    // observable outcome — a new tab actually opens at the bookmark's URL —
    // rather than stubbing window.open, since that call no longer happens by
    // design. example.com (bare, no subdomain) is the IANA reserved test
    // domain that resolves for real in this sandbox.
    const bmUrl = 'https://example.com/context-menu-open';
    const bmId = await createTestBookmark(newtabPage, world.rootFolderId, 'Context Menu Target', bmUrl);
    try {
      await newtabPage.reload({ waitUntil: 'domcontentloaded' });
      await newtabPage.waitForSelector('.ff-app', { timeout: 15_000 });

      const tile = tileById(newtabPage, bmId);
      await tile.waitFor();
      const menu = await openContextMenu(newtabPage, tile);

      const [newPage] = await Promise.all([
        newtabPage.context().waitForEvent('page', { timeout: 10_000 }),
        menu.locator('.ff-ctx__label', { hasText: 'Open in new tab' }).click(),
      ]);
      await newPage.waitForLoadState('domcontentloaded');
      expect(newPage.url()).toBe(bmUrl);
      await newPage.close();
    } finally {
      await removeBookmarkTree(newtabPage, bmId);
    }
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
