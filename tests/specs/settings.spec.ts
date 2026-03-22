/**
 * Settings persistence tests — priority 5.
 *
 * Verifies that settings changes survive a page reload and that layout
 * preset changes are reflected in the DOM.
 */
import { test, expect } from '../fixtures/extension-context.js';
import {
  clearExtensionStorage,
  skipOnboarding,
  reloadNewtab,
  createTestFolder,
  createTestBookmark,
  removeBookmarkTree,
  setRootFolderId,
} from '../fixtures/bookmark-helpers.js';

let testFolderId: string;

test.beforeEach(async ({ newtabPage }) => {
  await clearExtensionStorage(newtabPage);
  await skipOnboarding(newtabPage);

  testFolderId = await createTestFolder(newtabPage, 'Settings Test Folder');
  await createTestBookmark(newtabPage, testFolderId, 'Alpha', 'https://alpha.example.com');
  await createTestBookmark(newtabPage, testFolderId, 'Zeta', 'https://zeta.example.com');
  await setRootFolderId(newtabPage, testFolderId);
  await reloadNewtab(newtabPage);
});

test.afterEach(async ({ newtabPage }) => {
  await removeBookmarkTree(newtabPage, testFolderId);
});

test('theme mode setting persists after reload', async ({ newtabPage }) => {
  await newtabPage.locator('.drawer-toggle').click();
  await newtabPage.locator('[data-section="appearance"]').click();
  await newtabPage.locator('[data-theme-mode-option="dark"]').click();
  await expect(newtabPage.locator('.shell')).toHaveAttribute('data-theme-mode', 'dark');

  await reloadNewtab(newtabPage);
  await expect(newtabPage.locator('.shell')).toHaveAttribute('data-theme-mode', 'dark');
});

test('sort mode "name" shows bookmarks in alphabetical order', async ({ newtabPage }) => {
  // Change sort mode to "name" via settings/patch message so sync storage is updated.
  await newtabPage.evaluate(async () => {
    await browser.runtime.sendMessage({
      type: 'settings/patch',
      patch: { bookmarkSortMode: 'name', bookmarkSortDirection: 'asc' },
    });
  });
  await reloadNewtab(newtabPage);

  const tiles = newtabPage.locator('.bookmark-tile.link-tile');
  const count = await tiles.count();
  expect(count).toBe(2);

  // First tile should be "Alpha" (comes before "Zeta" alphabetically).
  const firstTitle = await tiles.first().getAttribute('data-bookmark-title');
  expect(firstTitle?.toLowerCase()).toBe('alpha');
});

test('dock visibility toggle persists after reload', async ({ newtabPage }) => {
  // Disable dock via settings/patch message so sync storage is updated.
  await newtabPage.evaluate(async () => {
    await browser.runtime.sendMessage({ type: 'settings/patch', patch: { showDock: false } });
  });
  await reloadNewtab(newtabPage);

  await expect(newtabPage.locator('.shell')).toHaveAttribute('data-dock-visible', 'false');

  // Re-enable.
  await newtabPage.evaluate(async () => {
    await browser.runtime.sendMessage({ type: 'settings/patch', patch: { showDock: true } });
  });
  await reloadNewtab(newtabPage);
  await expect(newtabPage.locator('.shell')).toHaveAttribute('data-dock-visible', 'true');
});

test('bookmarkIconBackground setting is reflected in the shell attribute', async ({
  newtabPage,
}) => {
  await newtabPage.evaluate(async () => {
    await browser.runtime.sendMessage({
      type: 'settings/patch',
      patch: { showBookmarkIconBackground: true },
    });
  });
  await reloadNewtab(newtabPage);

  await expect(newtabPage.locator('.shell')).toHaveAttribute(
    'data-bookmark-icon-surface',
    'true'
  );
});
