/**
 * App boot and shell rendering.
 */
import { test, expect } from '../fixtures/extension-context.js';
import {
  clearExtensionStorage,
  createTestFolder,
  createTestBookmark,
  patchSettings,
  reloadNewtab,
  removeBookmarkTree,
  setRootFolderId,
} from '../fixtures/bookmark-helpers.js';

let folderId: string;

test.beforeEach(async ({ newtabPage }) => {
  await clearExtensionStorage(newtabPage);
  folderId = await createTestFolder(newtabPage, 'Boot Test');
  await createTestBookmark(newtabPage, folderId, 'Example', 'https://example.com');
  await setRootFolderId(newtabPage, folderId);
  await reloadNewtab(newtabPage);
});

test.afterEach(async ({ newtabPage }) => {
  await removeBookmarkTree(newtabPage, folderId);
});

test('shell mounts without console errors', async ({ newtabPage }) => {
  const errors: string[] = [];
  newtabPage.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await reloadNewtab(newtabPage);
  await expect(newtabPage.locator('.ff-app')).toBeVisible();
  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('data-tile-shape reflects settings', async ({ newtabPage }) => {
  await expect(newtabPage.locator('.ff-app')).toHaveAttribute('data-tile-shape', 'squircle');
  await patchSettings(newtabPage, { tileShape: 'circle' });
  await reloadNewtab(newtabPage);
  await expect(newtabPage.locator('.ff-app')).toHaveAttribute('data-tile-shape', 'circle');
});

test('clock + search bar render when enabled and hide when disabled', async ({ newtabPage }) => {
  // Default showClock=false, showSearchBar=true.
  await expect(newtabPage.locator('.ff-search')).toBeVisible();
  await expect(newtabPage.locator('.ff-hero__clock')).toHaveCount(0);

  await patchSettings(newtabPage, { showClock: true, showSearchBar: false });
  await reloadNewtab(newtabPage);

  await expect(newtabPage.locator('.ff-hero__clock')).toBeVisible();
  await expect(newtabPage.locator('.ff-search')).toHaveCount(0);
});
