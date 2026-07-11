/**
 * Icon-loading performance timing budget — verifies that bookmarks whose
 * icons are already cached in IDB render real <img> favicons within a strict
 * 500 ms budget of the app becoming interactive (.ff-app visible).
 *
 * Complements icon-prefetch.spec.ts (task #32) which validates the end-to-end
 * prefetch pipeline with a generous 10 s budget. This spec isolates the
 * render-swap latency by pre-warming the icon cache so no network resolution
 * is involved — the measurement is purely "cached icon in IDB → visible <img>
 * with data:image/ src".
 *
 * Deterministic by design: all icon data lives in IDB before the page loads,
 * network routes for icon providers are blocked to guarantee cache-only reads,
 * and the budget has a 500 ms ceiling that accommodates IDB reads + React
 * mount + eager prefetch scheduling without depending on external servers.
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

/** The timing budget: maximum ms from .ff-app visible to all real <img> icons rendered. */
const ICON_RENDER_BUDGET_MS = 500;

/** Pipeline version must match the service worker's constant so the cache is a hit. */
const PIPELINE_VERSION = 'bookmark-icons-v9';

/** IDB database and store names from src/shared/icon-idb.ts. */
const IDB_NAME = 'ff-icons';
const IDB_VERSION = 4;
const IDB_STORE = 'cache';

interface TestBookmark {
  title: string;
  url: string;
  hostname: string;
}

const TEST_BOOKMARKS: TestBookmark[] = [
  { title: 'GitHub',    url: 'https://github.com/explore',   hostname: 'github.com' },
  { title: 'MDN',       url: 'https://developer.mozilla.org', hostname: 'developer.mozilla.org' },
  { title: 'Wikipedia', url: 'https://en.wikipedia.org',      hostname: 'en.wikipedia.org' },
  { title: 'Reddit',    url: 'https://reddit.com',            hostname: 'reddit.com' },
];

test.describe('icon loading performance', () => {
  let rootId: string;

  test.beforeEach(async ({ context, newtabPage }) => {
    await clearExtensionStorage(newtabPage);
    rootId = await createTestFolder(newtabPage, 'Perf Root');

    for (const bm of TEST_BOOKMARKS) {
      await createTestBookmark(newtabPage, rootId, bm.title, bm.url);
    }

    await setupDefaultWorkspace(newtabPage, rootId);

    // Pre-warm the IDB icon cache with valid records for every test host.
    // The data URL is a real PNG encoded as base64 so the service worker's
    // cache-hit path returns it directly without network resolution.
    const pngBase64 = MOCK_FAVICON_PNG.toString('base64');
    const dataUrl = `data:image/png;base64,${pngBase64}`;
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

    await newtabPage.evaluate(
      async (args) => {
        const { records, dbName, dbVersion, storeName } = args;
        await new Promise<void>((resolve, reject) => {
          const req = indexedDB.open(dbName, dbVersion);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(storeName)) {
              db.createObjectStore(storeName, { keyPath: 'cacheKey' });
            }
            if (!db.objectStoreNames.contains('overrides')) {
              db.createObjectStore('overrides', { keyPath: 'overrideKey' });
            }
          };
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            for (const record of records) {
              store.put(record);
            }
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => { db.close(); reject(tx.error); };
          };
          req.onerror = () => reject(req.error);
        });
      },
      {
        records: TEST_BOOKMARKS.map((bm) => ({
          cacheKey: `icon:host:${bm.hostname}`,
          bookmarkUrl: bm.url,
          sourceKind: 's2',
          dataUrl,
          mimeType: 'image/png',
          updatedAt: now,
          expiresAt: now + thirtyDaysMs,
          pipelineVersion: PIPELINE_VERSION,
        })),
        dbName: IDB_NAME,
        dbVersion: IDB_VERSION,
        storeName: IDB_STORE,
      },
    );

    // Block all icon provider network requests so the test is purely
    // cache-driven. If any of these fire, the cache was missed and the
    // budget would be unreliable.
    await context.route('https://www.google.com/s2/favicons**', (route) => route.abort('failed'));
    for (const bm of TEST_BOOKMARKS) {
      await context.route(`https://${bm.hostname}/**`, (route) => route.abort('failed'));
    }
    await context.route('https://icon.horse/**', (route) => route.abort('failed'));
    await context.route('https://duckduckgo.com/**', (route) => route.abort('failed'));
  });

  test.afterEach(async ({ newtabPage }) => {
    await removeBookmarkTree(newtabPage, rootId);
  });

  test(`cached icons render within ${ICON_RENDER_BUDGET_MS}ms of app interactive`, async ({ newtabPage }) => {
    // Cold-load: reload so no in-memory favicon-cache.ts Map survives.
    // Icons must come from IDB via the service worker cache-hit path.
    await reloadNewtab(newtabPage);

    const tiles = newtabPage.locator('.ff-tile[data-item-kind="bookmark"]');
    await expect(tiles.first()).toBeVisible();

    // Capture the moment tiles are visible (app is "interactive").
    const t0 = Date.now();

    // Wait for every bookmark tile to show a real <img> with a data:image/ src,
    // meaning the icon cache was read and the Favicon component swapped from
    // the letter-tile placeholder to the cached PNG.
    const imgs = tiles.locator('.ff-favicon img');
    const count = await tiles.count();
    expect(count).toBe(TEST_BOOKMARKS.length);

    for (let i = 0; i < count; i++) {
      await expect(imgs.nth(i)).toBeVisible({ timeout: ICON_RENDER_BUDGET_MS });
      const src = await imgs.nth(i).getAttribute('src');
      expect(src).toMatch(/^data:image\//);
    }

    const elapsed = Date.now() - t0;

    // The budget assertion: all icons must have rendered within the ceiling.
    // This is the regression guard — if eager prefetch (task #32) regresses
    // or the Favicon component adds unnecessary async hops, this fails.
    expect(
      elapsed,
      `Expected all cached icons to render within ${ICON_RENDER_BUDGET_MS}ms, ` +
      `but took ${elapsed}ms. This indicates a regression in the icon ` +
      `render-swap path (IDB read → messaging → Favicon <img> swap).`,
    ).toBeLessThanOrEqual(ICON_RENDER_BUDGET_MS);
  });
});
