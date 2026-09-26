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

test.describe('clicking a dock item', () => {
  // Asserts on a real navigation in a tab the extension opens via
  // extensionApi.tabs.create (see comment below) — a browser-level tab open,
  // not a page-driven popup. context.route()/page.route() can't reliably
  // cover it: Playwright's request interception attaches to that new tab's
  // target asynchronously, so under a fast DNS failure the real network can
  // resolve (or fail to chrome-error://chromewebdata) before the route is
  // even wired up. `stubHosts` redirects example.com to a local HTTPS stub at
  // the Chromium-process level instead (--host-resolver-rules), which closes
  // that race — see network-stub.ts.
  test.use({ stubHosts: ['example.com'] });

  test('opens its URL', async ({ newtabPage }) => {
    // Dock clicks go through handlePickBookmark, which (with openLinksInNewTab
    // true, set in beforeEach) now opens via the extension message pipeline
    // (openTab -> service worker extensionApi.tabs.create) instead of
    // window.open — see plan Phase 2 / App.tsx openInNewTab. Assert the real
    // outcome: a new tab actually opens at the dock item's URL. example.com/bm0
    // is redirected to the stub above, so this doesn't depend on live DNS/network.
    const url = 'https://example.com/bm0';

    const [newPage] = await Promise.all([
      newtabPage.context().waitForEvent('page', { timeout: 10_000 }),
      newtabPage.locator('.ff-dock__item').first().click(),
    ]);
    await newPage.waitForLoadState('domcontentloaded');
    expect(newPage.url()).toBe(url);
    await newPage.close();
  });
});
