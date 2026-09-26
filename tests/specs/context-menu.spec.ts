/**
 * Context menus: the right-click menu adapts to its target (bookmark, folder,
 * or empty canvas). Why it matters — the menu is the primary discovery path for
 * edit/delete/add actions; each target kind must expose the right verbs.
 *
 * Menu items carry their keyboard hint in the accessible name (e.g. "Open ↵"),
 * so we assert on the visible `.ff-ctx__label` text instead of the role name.
 */
import { test, expect } from '../fixtures/world.js';
import { createTestBookmark, openContextMenu, removeBookmarkTree, reloadNewtab, patchWorkspace } from '../fixtures/bookmark-helpers.js';
import { resetStorage, seedMinimal } from '../fixtures/seeding.js';
import { tileById, tilesInScope } from '../fixtures/selectors.js';

test.describe('context menu', () => {
  test('bookmark menu exposes open / edit / delete actions', async ({ newtabPage, world }) => {
    const tile = tileById(newtabPage, world.bookmarkIdByTitle('GitHub'));
    const menu = await openContextMenu(newtabPage, tile);

    await expect(menu.locator('.ff-ctx__label', { hasText: 'Open' }).first()).toBeVisible();
    await expect(menu.locator('.ff-ctx__label', { hasText: 'Copy URL' })).toBeVisible();
    await expect(menu.locator('.ff-ctx__label', { hasText: 'Edit' })).toBeVisible();
    await expect(menu.locator('.ff-ctx__label', { hasText: 'Delete' })).toBeVisible();
  });

  test('folder menu exposes open / edit / delete-folder actions', async ({ newtabPage, world }) => {
    const folder = tileById(newtabPage, world.bookmarkIdByTitle('Project Apollo'));
    const menu = await openContextMenu(newtabPage, folder);

    await expect(menu.locator('.ff-ctx__label', { hasText: 'Open folder' })).toBeVisible();
    // 'Edit…', not 'Rename': the dialog edits name *and* icon, and this matches
    // the bookmark menu's own 'Edit…' item.
    await expect(menu.locator('.ff-ctx__label', { hasText: 'Edit…' })).toBeVisible();
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

  test('multi-select "Open" label narrows the count when folders are mixed into the selection', async ({ newtabPage }) => {
    // Regression: "Open" labels used to report only the openable-bookmark count
    // (folders silently filtered out, since they have no URL) while "Delete"
    // reported the full selection count -> "Open 2 in new tabs" next to
    // "Delete 3 items" read as a mismatch/bug even though both were individually
    // correct. The fix makes the narrowing explicit: "Open 2 bookmarks in new tabs".
    await resetStorage(newtabPage);
    const seeded = await seedMinimal(newtabPage, { rootBookmarks: 2, folders: 1 });
    await reloadNewtab(newtabPage);
    await patchWorkspace(newtabPage, { folderMode: 'grid', bookmarkSortMode: 'manual' }, 'ws-minimal');
    await reloadNewtab(newtabPage);

    const tiles = tilesInScope(newtabPage, seeded.rootFolderId);
    const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';

    // BM 01, BM 02, then Folder 1 (seed order) -> select all three: 2 bookmarks + 1 folder.
    await tiles.nth(0).click({ modifiers: [modKey] });
    await tiles.nth(1).click({ modifiers: [modKey] });
    await tiles.nth(2).click({ modifiers: [modKey] });

    const menu = await openContextMenu(newtabPage, tiles.nth(1));
    await expect(menu.locator('.ff-ctx__label', { hasText: 'Open 2 bookmarks in new tabs' })).toBeVisible();
    await expect(menu.locator('.ff-ctx__label', { hasText: 'Open 2 bookmarks in new window' })).toBeVisible();
    await expect(menu.locator('.ff-ctx__label', { hasText: 'Delete 3 items' })).toBeVisible();
  });

  test('multi-select "Open" label is unchanged when the selection has no folders', async ({ newtabPage }) => {
    await resetStorage(newtabPage);
    const seeded = await seedMinimal(newtabPage, { rootBookmarks: 3 });
    await reloadNewtab(newtabPage);
    await patchWorkspace(newtabPage, { folderMode: 'grid', bookmarkSortMode: 'manual' }, 'ws-minimal');
    await reloadNewtab(newtabPage);

    const tiles = tilesInScope(newtabPage, seeded.rootFolderId);
    const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';

    await tiles.nth(0).click({ modifiers: [modKey] });
    await tiles.nth(1).click({ modifiers: [modKey] });

    const menu = await openContextMenu(newtabPage, tiles.nth(1));
    await expect(menu.locator('.ff-ctx__label', { hasText: 'Open 2 in new tabs' })).toBeVisible();
    await expect(menu.locator('.ff-ctx__label', { hasText: 'Open 2 in new window' })).toBeVisible();
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
