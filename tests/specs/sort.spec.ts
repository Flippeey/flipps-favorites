/**
 * TopNav sort menu â€” opening, applying, persistence.
 */
import { test, expect } from '../fixtures/extension-context.js';
import {
  clearExtensionStorage,
  createTestBookmark,
  createTestFolder,
  patchSettings,
  reloadNewtab,
  removeBookmarkTree,
  setupDefaultWorkspace,
} from '../fixtures/bookmark-helpers.js';

let rootId: string;

test.beforeEach(async ({ newtabPage }) => {
  await clearExtensionStorage(newtabPage);
  rootId = await createTestFolder(newtabPage, 'Sort Root');
  await createTestBookmark(newtabPage, rootId, 'Zeta',  'https://zeta.example.com');
  await createTestBookmark(newtabPage, rootId, 'Alpha', 'https://alpha.example.com');
  await createTestBookmark(newtabPage, rootId, 'Mango', 'https://mango.example.com');
  await setupDefaultWorkspace(newtabPage, rootId);
  await patchSettings(newtabPage, { folderMode: 'grid' });
  await reloadNewtab(newtabPage);
});

test.afterEach(async ({ newtabPage }) => {
  await removeBookmarkTree(newtabPage, rootId);
});

test('sort pill opens panel listing options', async ({ newtabPage }) => {
  await newtabPage.locator('.ff-sort .ff-pill').click();
  const panel = newtabPage.locator('.ff-sort__panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.ff-sort__option')).toHaveCount(6);
});

test('Name (A to Z) reorders tiles alphabetically', async ({ newtabPage }) => {
  await newtabPage.locator('.ff-sort .ff-pill').click();
  await newtabPage.locator('.ff-sort__option', { hasText: 'Name (A' }).click();

  // After sort, first tile should be Alpha.
  const firstTile = newtabPage.locator('.ff-tile[data-item-kind="bookmark"]').first();
  await expect(firstTile).toHaveAttribute('title', 'Alpha');
});

test('selected sort mode persists after reload', async ({ newtabPage }) => {
  await newtabPage.locator('.ff-sort .ff-pill').click();
  await newtabPage.locator('.ff-sort__option', { hasText: 'Name (A' }).click();
  await reloadNewtab(newtabPage);

  await newtabPage.locator('.ff-sort .ff-pill').click();
  await expect(
    newtabPage.locator('.ff-sort__option[data-active="true"]'),
  ).toContainText('Name (A');
});
