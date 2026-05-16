/**
 * Dock rendering + interaction.
 */
import { test, expect } from '../fixtures/extension-context.js';
import {
  clearExtensionStorage,
  createTestBookmark,
  createTestFolder,
  patchSettings,
  reloadNewtab,
  removeBookmarkTree,
  setRootFolderId,
} from '../fixtures/bookmark-helpers.js';

let rootId: string;

test.beforeEach(async ({ newtabPage }) => {
  await clearExtensionStorage(newtabPage);
  rootId = await createTestFolder(newtabPage, 'Dock Root');
  for (let i = 0; i < 3; i++) {
    await createTestBookmark(newtabPage, rootId, `BM ${i}`, `https://bm${i}.example.com`);
  }
  await setRootFolderId(newtabPage, rootId);
  await patchSettings(newtabPage, {
    showDock: true,
    autoHideDock: false,
    dockFolderId: '',
    openLinksInNewTab: true,
  });
  await reloadNewtab(newtabPage);
});

test.afterEach(async ({ newtabPage }) => {
  await removeBookmarkTree(newtabPage, rootId);
});

test('dock renders one item per root bookmark', async ({ newtabPage }) => {
  await expect(newtabPage.locator('.ff-dock-wrap')).toBeVisible();
  await expect(newtabPage.locator('.ff-dock__item')).toHaveCount(3);
});

test('clicking a dock item opens its URL', async ({ newtabPage }) => {
  // Stub window.open so the popup isn't actually triggered.
  await newtabPage.evaluate(() => {
    (window as any).__opened = [];
    window.open = ((url: string) => {
      (window as any).__opened.push(url);
      return null;
    }) as typeof window.open;
  });

  await newtabPage.locator('.ff-dock__item').first().click();
  const opened = await newtabPage.evaluate(() => (window as any).__opened as string[]);
  expect(opened.length).toBeGreaterThan(0);
  expect(opened[0]).toContain('https://');
});
