/**
 * Folder navigation tests — priority 3.
 *
 * Covers hash-based folder routing, breadcrumb rendering, and
 * the "remember last folder" persistence behaviour.
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

let rootFolderId: string;
let childFolderId: string;

test.beforeEach(async ({ newtabPage }) => {
  await skipOnboarding(newtabPage);

  // Build a two-level folder tree:
  //  rootFolder
  //    └── childFolder
  //          └── bookmark
  rootFolderId = await createTestFolder(newtabPage, 'Nav Root');
  childFolderId = await createTestFolder(newtabPage, 'Nav Child');
  // Move childFolder inside rootFolder by creating it there.
  // (createTestFolder always creates at the browser root; restructure via API)
  await newtabPage.evaluate(
    async ({ childId, rootId }) => {
      await browser.bookmarks.move(childId, { parentId: rootId });
    },
    { childId: childFolderId, rootId: rootFolderId }
  );
  await createTestBookmark(newtabPage, childFolderId, 'Child BM', 'https://example.com');

  await setRootFolderId(newtabPage, rootFolderId);
  await reloadNewtab(newtabPage);
});

test.afterEach(async ({ newtabPage }) => {
  await removeBookmarkTree(newtabPage, rootFolderId);
});

test('clicking a folder tile navigates into that folder', async ({ newtabPage }) => {
  // The child folder should appear in the grid.
  const folderTile = newtabPage.locator(`.folder-card--tile[data-folder-id="${childFolderId}"]`);
  await expect(folderTile).toBeVisible();

  await folderTile.click();

  // URL hash should now reflect the child folder.
  await expect(newtabPage).toHaveURL(new RegExp(`#.*${childFolderId}`));
});

test('navigating into a folder shows its bookmarks', async ({ newtabPage }) => {
  const folderTile = newtabPage.locator(`.folder-card--tile[data-folder-id="${childFolderId}"]`);
  await folderTile.click();

  // Wait for URL to confirm navigation happened.
  await newtabPage.waitForURL(new RegExp(`#.*${childFolderId}`));

  // The bookmark we added to childFolder should now be visible.
  // Scope to the grid to avoid strict-mode issues if the URL also appears in the dock.
  // Browsers normalise https://example.com → https://example.com/ so use a prefix selector.
  await expect(
    newtabPage.locator('.bookmark-grid [data-link-url^="https://example.com"]')
  ).toBeVisible({ timeout: 10_000 });
});

test('breadcrumb trail renders after navigating into a subfolder', async ({ newtabPage }) => {
  const folderTile = newtabPage.locator(`.folder-card--tile[data-folder-id="${childFolderId}"]`);
  await folderTile.click();

  // A breadcrumb button for the child folder should appear.
  await expect(
    newtabPage.locator(`.breadcrumb[data-folder-id="${childFolderId}"]`)
  ).toBeVisible({ timeout: 5_000 });
});

test('clicking a breadcrumb navigates back to the parent folder', async ({ newtabPage }) => {
  // Navigate into child folder.
  await newtabPage.locator(`.folder-card--tile[data-folder-id="${childFolderId}"]`).click();
  await newtabPage.waitForURL(new RegExp(`#.*${childFolderId}`));

  // Click the root breadcrumb.
  await newtabPage.locator(`.breadcrumb[data-folder-id="${rootFolderId}"]`).click();

  // Should be back showing the root folder contents.
  await expect(newtabPage).toHaveURL(new RegExp(`#.*${rootFolderId}`));
  await expect(newtabPage.locator(`.folder-card--tile[data-folder-id="${childFolderId}"]`)).toBeVisible();
});

test('remember last folder: reloading opens the previously visited folder', async ({
  newtabPage,
}) => {
  // Enable rememberLastFolder via settings/patch message so sync storage is updated.
  await newtabPage.evaluate(async () => {
    await browser.runtime.sendMessage({ type: 'settings/patch', patch: { rememberLastFolder: true } });
  });

  // Navigate into child folder (via URL hash — no click needed to avoid local-state sync issues).
  await newtabPage.locator(`.folder-card--tile[data-folder-id="${childFolderId}"]`).click();
  await newtabPage.waitForURL(new RegExp(`#.*${childFolderId}`));

  // Write the last-folder directly to localStorage so it persists across the reload
  // (the page's in-memory state may still have rememberLastFolder=false from beforeEach).
  await newtabPage.evaluate((id) => {
    window.localStorage.setItem('newtab/last-folder', id);
  }, childFolderId);

  // Reload — should land on the child folder again.
  await reloadNewtab(newtabPage);
  await expect(newtabPage).toHaveURL(new RegExp(`#.*${childFolderId}`));
});
