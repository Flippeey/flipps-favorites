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
  setupDefaultWorkspace,
} from '../fixtures/bookmark-helpers.js';

let rootId: string;

test.beforeEach(async ({ newtabPage }) => {
  await clearExtensionStorage(newtabPage);
  rootId = await createTestFolder(newtabPage, 'Dock Root');
  for (let i = 0; i < 3; i++) {
    // example.com (bare, no subdomain) is the IANA reserved test domain and
    // resolves for real in this sandbox; arbitrary subdomains of it do not —
    // vary by path instead so a real-navigation assertion can pass.
    await createTestBookmark(newtabPage, rootId, `BM ${i}`, `https://example.com/bm${i}`);
  }
  await setupDefaultWorkspace(newtabPage, rootId);
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
  // Dock clicks go through handlePickBookmark, which (with openLinksInNewTab
  // true, set in beforeEach) now opens via the extension message pipeline
  // (openTab -> service worker extensionApi.tabs.create) instead of
  // window.open — see plan Phase 2 / App.tsx openInNewTab. Assert the real
  // outcome: a new tab actually opens at the dock item's URL.
  const [newPage] = await Promise.all([
    newtabPage.context().waitForEvent('page', { timeout: 10_000 }),
    newtabPage.locator('.ff-dock__item').first().click(),
  ]);
  await newPage.waitForLoadState('domcontentloaded');
  expect(newPage.url()).toBe('https://example.com/bm0');
  await newPage.close();
});
