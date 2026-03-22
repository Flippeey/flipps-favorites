/**
 * Search tests — priority 6.
 *
 * Covers the live search filter, empty-state display, and keyboard shortcut.
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
  testFolderId = await createTestFolder(newtabPage, 'Search Test Folder');
  await createTestBookmark(newtabPage, testFolderId, 'GitHub', 'https://github.com');
  await createTestBookmark(newtabPage, testFolderId, 'GitLab', 'https://gitlab.com');
  await createTestBookmark(newtabPage, testFolderId, 'OpenAI', 'https://openai.com');
  await setRootFolderId(newtabPage, testFolderId);
  await reloadNewtab(newtabPage);
});

test.afterEach(async ({ newtabPage }) => {
  await removeBookmarkTree(newtabPage, testFolderId);
});

test('typing in search box filters bookmark tiles', async ({ newtabPage }) => {
  const searchInput = newtabPage.locator('input[name="currentFolderSearch"]');
  await searchInput.fill('Git');

  // Should show GitHub and GitLab but not OpenAI.
  await expect(newtabPage.locator('.bookmark-grid [data-link-url^="https://github.com"]')).toBeVisible();
  await expect(newtabPage.locator('.bookmark-grid [data-link-url^="https://gitlab.com"]')).toBeVisible();
  await expect(newtabPage.locator('.bookmark-grid [data-link-url^="https://openai.com"]')).not.toBeVisible();
});

test('clearing search restores all bookmark tiles', async ({ newtabPage }) => {
  const searchInput = newtabPage.locator('input[name="currentFolderSearch"]');
  await searchInput.fill('Git');

  // Wait for filter to apply.
  await expect(newtabPage.locator('.bookmark-grid [data-link-url^="https://openai.com"]')).not.toBeVisible();

  // Clear the search.
  await searchInput.clear();

  // All tiles should be visible again.
  await expect(newtabPage.locator('.bookmark-grid [data-link-url^="https://github.com"]')).toBeVisible();
  await expect(newtabPage.locator('.bookmark-grid [data-link-url^="https://gitlab.com"]')).toBeVisible();
  await expect(newtabPage.locator('.bookmark-grid [data-link-url^="https://openai.com"]')).toBeVisible();
});

test('Ctrl+K focuses the search input', async ({ newtabPage }) => {
  const searchInput = newtabPage.locator('input[name="currentFolderSearch"]');
  await expect(searchInput).not.toBeFocused();

  await newtabPage.keyboard.press('Control+k');
  await expect(searchInput).toBeFocused();
});

test('search with no matches shows no tiles', async ({ newtabPage }) => {
  const searchInput = newtabPage.locator('input[name="currentFolderSearch"]');
  await searchInput.fill('xyzzy-no-match-12345');

  // No bookmark tiles should be visible.
  await expect(newtabPage.locator('.bookmark-tile.link-tile')).toHaveCount(0);
});
