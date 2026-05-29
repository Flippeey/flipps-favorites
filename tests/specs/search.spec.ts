/**
 * Hero search â€” dropdown filter, keyboard shortcuts, empty state.
 */
import { test, expect } from '../fixtures/extension-context.js';
import {
  clearExtensionStorage,
  createSubFolder,
  createTestBookmark,
  createTestFolder,
  reloadNewtab,
  removeBookmarkTree,
  setupDefaultWorkspace,
} from '../fixtures/bookmark-helpers.js';

let rootId: string;

test.beforeEach(async ({ newtabPage }) => {
  await clearExtensionStorage(newtabPage);
  rootId = await createTestFolder(newtabPage, 'Search Root');
  await createTestBookmark(newtabPage, rootId, 'GitHub', 'https://github.com');
  await createTestBookmark(newtabPage, rootId, 'GitLab', 'https://gitlab.com');
  await createTestBookmark(newtabPage, rootId, 'OpenAI', 'https://openai.com');
  await createSubFolder(newtabPage, rootId, 'Reading');
  await setupDefaultWorkspace(newtabPage, rootId);
  await reloadNewtab(newtabPage);
});

test.afterEach(async ({ newtabPage }) => {
  await removeBookmarkTree(newtabPage, rootId);
});

test('typing in hero search shows matching results in the dropdown', async ({ newtabPage }) => {
  const input = newtabPage.locator('.ff-search input');
  await input.fill('git');
  await expect(newtabPage.locator('#ff-search-results')).toBeVisible();
  const items = newtabPage.locator('#ff-search-results .ff-results__item');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText(/GitHub|GitLab/);
});

test('Ctrl+K focuses the hero search input', async ({ newtabPage }) => {
  const input = newtabPage.locator('.ff-search input');
  // Hero's auto-focus uses setTimeout up to 200ms; wait it out, then blur.
  await newtabPage.waitForTimeout(300);
  await input.evaluate((el) => (el as HTMLInputElement).blur());
  await expect(input).not.toBeFocused();
  await newtabPage.keyboard.press('Control+k');
  await expect(input).toBeFocused();
});

test('"/" key focuses the hero search input', async ({ newtabPage }) => {
  const input = newtabPage.locator('.ff-search input');
  await newtabPage.waitForTimeout(300);
  await input.evaluate((el) => (el as HTMLInputElement).blur());
  await expect(input).not.toBeFocused();
  await newtabPage.keyboard.press('/');
  await expect(input).toBeFocused();
});

test('Enter on a folder result navigates into the folder', async ({ newtabPage }) => {
  const input = newtabPage.locator('.ff-search input');
  await input.click();
  await input.fill('Reading');
  await expect(newtabPage.locator('#ff-search-results .ff-results__item')).toHaveCount(1);
  await input.press('Enter');
  // Default folderOpenMode=overlay â†’ overlay opens; or page mode â†’ page view.
  // Either way, the search dropdown should close (value cleared).
  await expect(newtabPage.locator('#ff-search-results')).toHaveCount(0);
});

test('empty match shows "No matches." copy', async ({ newtabPage }) => {
  const input = newtabPage.locator('.ff-search input');
  await input.fill('xyzzy-no-such-match-12345');
  await expect(newtabPage.locator('#ff-search-results')).toContainText(/No matches/i);
});
