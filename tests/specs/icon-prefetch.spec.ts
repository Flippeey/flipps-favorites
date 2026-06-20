/**
 * Icon prefetch bootstrap timing — verifies that eager prefetch
 * in main.tsx causes real <img> favicons to appear promptly after
 * a cold page load, rather than lingering as letter-tile placeholders.
 */
import { test, expect } from '../fixtures/extension-context.js';
import { MOCK_FAVICON_PNG } from '../fixtures/test-data.js';
import {
  clearExtensionStorage,
  createTestBookmark,
  createTestFolder,
  reloadNewtab,
  removeBookmarkTree,
  setupDefaultWorkspace,
} from '../fixtures/bookmark-helpers.js';

test.describe('icon prefetch bootstrap', () => {
  let rootId: string;

  test.beforeEach(async ({ context, newtabPage }) => {
    await clearExtensionStorage(newtabPage);
    rootId = await createTestFolder(newtabPage, 'Prefetch Root');

    // Create several bookmarks so the test exercises batch prefetch.
    await createTestBookmark(newtabPage, rootId, 'Site A', 'https://site-a.test');
    await createTestBookmark(newtabPage, rootId, 'Site B', 'https://site-b.test');
    await createTestBookmark(newtabPage, rootId, 'Site C', 'https://site-c.test');

    await setupDefaultWorkspace(newtabPage, rootId);

    // Mock all icon provider endpoints to return a valid PNG immediately.
    // This isolates the test from network latency — the only variable is
    // when the prefetch fires relative to React mount.
    await context.route('https://www.google.com/s2/favicons**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: MOCK_FAVICON_PNG,
      });
    });
    // Block origin scrape, Icon Horse, and DDG so only S2 resolves.
    await context.route('https://site-a.test/**', (route) => route.abort('failed'));
    await context.route('https://site-b.test/**', (route) => route.abort('failed'));
    await context.route('https://site-c.test/**', (route) => route.abort('failed'));
    await context.route('https://icon.horse/**', (route) => route.abort('failed'));
    await context.route('https://duckduckgo.com/**', (route) => route.abort('failed'));
  });

  test.afterEach(async ({ newtabPage }) => {
    await removeBookmarkTree(newtabPage, rootId);
  });

  test('cold load resolves real favicon <img> within timing budget', async ({ newtabPage }) => {
    // Reload to simulate a cold start (no in-memory icon cache).
    await reloadNewtab(newtabPage);

    const tiles = newtabPage.locator('.ff-tile[data-item-kind="bookmark"]');
    await expect(tiles.first()).toBeVisible();

    // All bookmark tiles should resolve to real <img> elements (data:image/png
    // src from the mocked S2 response) within a generous budget.  The eager
    // prefetch fires before React mount, so the icons should be in-cache or
    // in-flight by the time <Favicon> components render.
    const imgs = tiles.locator('.ff-favicon img');
    const count = await tiles.count();

    for (let i = 0; i < count; i++) {
      await expect(imgs.nth(i)).toBeVisible({ timeout: 10_000 });
      const src = await imgs.nth(i).getAttribute('src');
      expect(src).toMatch(/^data:image\//);
    }
  });
});
