/**
 * Bookmark sort modes — ordering that the user sees in the tile grid.
 *
 * WHY these tests matter: sort mode is a persistent global preference that
 * controls the visual order of every workspace's tiles. A regression here
 * silently reorders bookmarks without user intent, which is a high-impact UX
 * break. Each test encodes the user-visible ordering guarantee, not the
 * internal sort algorithm (which has its own unit path in tree.ts).
 *
 * Fixture strategy:
 *   - resetStorage + seedMinimal gives a clean, predictable world each test.
 *   - For manual vs name ordering we need creation order ≠ alphabetical order,
 *     so we seed a custom bookmark set in reverse-alpha creation order via the
 *     ExtApi (same typed pattern as seeding.ts — no `any`).
 *   - For lastUsed we seed usage timestamps directly through the message
 *     pipeline rather than clicking tiles (which would open tabs and
 *     introduce ordering non-determinism).
 */
import { test, expect } from '../fixtures/world.js';
import { resetStorage, seedMinimal, waitForWorkspace } from '../fixtures/seeding.js';
import { sortPill, sortOption, tilesInScope } from '../fixtures/selectors.js';

// ─── typed shim used at page.evaluate boundaries ─────────────────────────────

interface ExtBookmarkNode {
  id: string;
  title: string;
  url?: string;
  dateAdded?: number;
}
interface ExtApi {
  bookmarks: {
    create(b: { parentId: string; title: string; url?: string }): Promise<ExtBookmarkNode>;
  };
  runtime: { sendMessage(message: unknown): Promise<unknown> };
  storage: {
    local: {
      set(items: Record<string, unknown>): Promise<void>;
    };
    sync: { remove(keys: string | string[]): Promise<void> };
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Seed bookmarks whose creation order is the reverse of alphabetical order so
 * that manual order ≠ name-sorted order. Returns the root folder id and the
 * list of titles in creation order.
 *
 * Titles (creation order): Zebra, Mango, Alpha
 * Alphabetical order:       Alpha, Mango, Zebra
 * Reverse alphabetical:     Zebra, Mango, Alpha  (== creation order, which
 *                            is also what manual keeps)
 *
 * This means:
 *   manual   → Zebra, Mango, Alpha
 *   name asc → Alpha, Mango, Zebra
 *   name desc→ Zebra, Mango, Alpha  (same as manual in this case — seed 4
 *               titles instead so they differ)
 */
interface SeedResult {
  rootFolderId: string;
  /** Title → bookmark id map */
  ids: Record<string, string>;
}

async function seedCustomOrder(
  page: import('@playwright/test').Page,
): Promise<SeedResult> {
  // Titles seeded in this creation order — deliberately not alphabetical:
  //   Zebra (1st created), Kiwi (2nd), Apple (3rd), Mango (4th)
  // Alphabetical asc:  Apple, Kiwi, Mango, Zebra
  // Alphabetical desc: Zebra, Mango, Kiwi, Apple
  // Manual (creation): Zebra, Kiwi, Apple, Mango

  return page.evaluate(
    async (args) => {
      const api = (
        (globalThis as unknown as { browser?: ExtApi; chrome: ExtApi }).browser ??
        (globalThis as unknown as { chrome: ExtApi }).chrome
      );
      interface _BookmarkNode { id: string; title: string }
      interface _WorkspaceRecord {
        id: string; name: string; rootFolderId: string;
        themeMode: string; accentColor: string; backgroundMode: string;
        solidBackgroundColor: string; gradientStyle: string;
        gradientColorSource: string; gradientCustomColor: string;
        gradientIntensity: number; backgroundOpacity: number;
        backgroundFitMode: string; backgroundPositionMode: string;
        layoutPreset: string; favoritesColumnGap: number;
        favoritesRowGap: number; bookmarkTileWidth: number;
        bookmarkIconSize: number; tileShape: string; showTileLabels: boolean;
      }
      const root: _BookmarkNode = await api.bookmarks.create({ parentId: '2', title: 'Sort Test' });
      const ids: Record<string, string> = {};
      for (const title of args.titles) {
        const bm: _BookmarkNode = await api.bookmarks.create({
          parentId: root.id,
          title,
          url: `https://${title.toLowerCase()}.example.com`,
        });
        ids[title] = bm.id;
      }
      const record: _WorkspaceRecord = {
        ...args.defaults,
        id: 'ws-sort',
        name: 'Sort',
        rootFolderId: root.id,
      };
      await api.runtime.sendMessage({ type: 'workspaces/create', workspace: record });
      await api.runtime.sendMessage({
        type: 'settings/patch',
        patch: { activeWorkspaceId: 'ws-sort', workspaceOrder: ['ws-sort'], rememberLastFolder: false },
      });
      return { rootFolderId: root.id, ids };
    },
    {
      titles: ['Zebra', 'Kiwi', 'Apple', 'Mango'],
      defaults: {
        themeMode: 'system',
        accentColor: '#3F72DC',
        backgroundMode: 'gradient',
        solidBackgroundColor: '',
        gradientStyle: 'top',
        gradientColorSource: 'accent',
        gradientCustomColor: '#3F72DC',
        gradientIntensity: 100,
        backgroundOpacity: 70,
        backgroundFitMode: 'cover',
        backgroundPositionMode: 'center',
        layoutPreset: 'balanced',
        favoritesColumnGap: 24,
        favoritesRowGap: 20,
        bookmarkTileWidth: 130,
        bookmarkIconSize: 75,
        tileShape: 'squircle',
        showTileLabels: true,
      },
    },
  );
}

/** Read titles of all tiles within a scope folder, in DOM order. */
async function titlesInScope(
  page: import('@playwright/test').Page,
  scopeFolderId: string,
): Promise<string[]> {
  return tilesInScope(page, scopeFolderId).evaluateAll(
    (els) => els.map((el) => (el as HTMLElement).getAttribute('title') ?? el.textContent?.trim() ?? ''),
  );
}

/**
 * Apply a sort choice via the sort pill UI and wait for the panel to close.
 * This updates settings live (no reload needed).
 */
async function applySort(
  page: import('@playwright/test').Page,
  mode: import('../../src/shared/models').BookmarkSortMode,
  direction: import('../../src/shared/models').SortDirection,
): Promise<void> {
  await sortPill(page).click();
  await sortOption(page, mode, direction).click();
  // Panel closes after selection — wait for it to disappear.
  await expect(page.locator('.ff-sort__panel')).toHaveCount(0);
}

// ─── test suite ──────────────────────────────────────────────────────────────

test.describe('sort modes', () => {
  // ── manual (creation order) ────────────────────────────────────────────────

  test('default sort is manual — tiles appear in bookmark creation order', async ({ newtabPage }) => {
    await resetStorage(newtabPage);
    const seed = await seedCustomOrder(newtabPage);
    await newtabPage.reload();
    await newtabPage.waitForSelector('.ff-app');

    const titles = await titlesInScope(newtabPage, seed.rootFolderId);
    // Creation order: Zebra, Kiwi, Apple, Mango
    expect(titles).toEqual(['Zebra', 'Kiwi', 'Apple', 'Mango']);
  });

  // ── name A→Z ──────────────────────────────────────────────────────────────

  test('Name A→Z sorts tiles ascending alphabetically', async ({ newtabPage }) => {
    await resetStorage(newtabPage);
    const seed = await seedCustomOrder(newtabPage);
    await newtabPage.reload();
    await newtabPage.waitForSelector('.ff-app');

    await applySort(newtabPage, 'name', 'asc');

    const titles = await titlesInScope(newtabPage, seed.rootFolderId);
    expect(titles).toEqual(['Apple', 'Kiwi', 'Mango', 'Zebra']);
  });

  // ── name Z→A ──────────────────────────────────────────────────────────────

  test('Name Z→A sorts tiles descending alphabetically', async ({ newtabPage }) => {
    await resetStorage(newtabPage);
    const seed = await seedCustomOrder(newtabPage);
    await newtabPage.reload();
    await newtabPage.waitForSelector('.ff-app');

    await applySort(newtabPage, 'name', 'desc');

    const titles = await titlesInScope(newtabPage, seed.rootFolderId);
    expect(titles).toEqual(['Zebra', 'Mango', 'Kiwi', 'Apple']);
  });

  // ── last used ─────────────────────────────────────────────────────────────

  test('Last used sorts tiles by most-recently-used descending', async ({ newtabPage }) => {
    await resetStorage(newtabPage);
    // Use seedMinimal so we have predictable ids we can reference.
    const w = await seedMinimal(newtabPage, { rootBookmarks: 3 });
    await newtabPage.reload();
    await newtabPage.waitForSelector('.ff-app');

    // Seed usage: BM 01 used earliest, BM 03 used latest.
    // Expected order after lastUsed sort: BM 03, BM 02, BM 01.
    const id01 = w.bookmarkIdByTitle('BM 01');
    const id02 = w.bookmarkIdByTitle('BM 02');
    const id03 = w.bookmarkIdByTitle('BM 03');

    // Record usage in ascending time order so BM 03 ends with the highest
    // timestamp. Space the calls apart: the service worker stamps usedAt with
    // Date.now() at millisecond granularity, so back-to-back calls can tie and
    // make the lastUsed ordering non-deterministic.
    const recordUse = async (bookmarkId: string): Promise<void> => {
      await newtabPage.evaluate(async (id) => {
        const api =
          (globalThis as unknown as { browser?: ExtApi; chrome: ExtApi }).browser ??
          (globalThis as unknown as { chrome: ExtApi }).chrome;
        await api.runtime.sendMessage({ type: 'bookmarks/record-use', bookmarkId: id });
      }, bookmarkId);
    };
    await recordUse(id01);
    await newtabPage.waitForTimeout(20);
    await recordUse(id02);
    await newtabPage.waitForTimeout(20);
    await recordUse(id03);

    // Reload so App.tsx re-fetches usage from the service worker.
    await newtabPage.reload();
    await newtabPage.waitForSelector('.ff-app');

    await applySort(newtabPage, 'lastUsed', 'desc');

    const titles = await titlesInScope(newtabPage, w.rootFolderId);
    // Most recently used first: BM 03, BM 02, BM 01.
    expect(titles).toEqual(['BM 03', 'BM 02', 'BM 01']);
  });

  // ── date added newest ──────────────────────────────────────────────────────

  test('Date added newest-first puts the last-created bookmark first', async ({ newtabPage }) => {
    await resetStorage(newtabPage);

    // Seed bookmarks one at a time with a short pause between each so their
    // dateAdded timestamps are strictly ordered (Chrome assigns dateAdded at
    // millisecond granularity; concurrent creates can share a timestamp).
    const rootAndIds = await newtabPage.evaluate(async (args) => {
      const api = (
        (globalThis as unknown as { browser?: ExtApi; chrome: ExtApi }).browser ??
        (globalThis as unknown as { chrome: ExtApi }).chrome
      );
      interface _BookmarkNode { id: string; title: string }
      interface _WorkspaceRecord {
        id: string; name: string; rootFolderId: string;
        themeMode: string; accentColor: string; backgroundMode: string;
        solidBackgroundColor: string; gradientStyle: string;
        gradientColorSource: string; gradientCustomColor: string;
        gradientIntensity: number; backgroundOpacity: number;
        backgroundFitMode: string; backgroundPositionMode: string;
        layoutPreset: string; favoritesColumnGap: number;
        favoritesRowGap: number; bookmarkTileWidth: number;
        bookmarkIconSize: number; tileShape: string; showTileLabels: boolean;
      }
      const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
      const root: _BookmarkNode = await api.bookmarks.create({ parentId: '2', title: 'Sort Date' });
      const ids: Record<string, string> = {};
      for (const title of args.titles) {
        await sleep(10); // ensure strictly increasing dateAdded
        const bm: _BookmarkNode = await api.bookmarks.create({
          parentId: root.id,
          title,
          url: `https://${title.toLowerCase()}.example.com`,
        });
        ids[title] = bm.id;
      }
      const record: _WorkspaceRecord = { ...args.defaults, id: 'ws-sort-date', name: 'SortDate', rootFolderId: root.id };
      await api.runtime.sendMessage({ type: 'workspaces/create', workspace: record });
      await api.runtime.sendMessage({
        type: 'settings/patch',
        patch: { activeWorkspaceId: 'ws-sort-date', workspaceOrder: ['ws-sort-date'], rememberLastFolder: false },
      });
      return { rootFolderId: root.id, ids };
    }, {
      titles: ['Zebra', 'Kiwi', 'Apple', 'Mango'],
      defaults: {
        themeMode: 'system', accentColor: '#3F72DC', backgroundMode: 'gradient',
        solidBackgroundColor: '', gradientStyle: 'top', gradientColorSource: 'accent',
        gradientCustomColor: '#3F72DC', gradientIntensity: 100, backgroundOpacity: 70,
        backgroundFitMode: 'cover', backgroundPositionMode: 'center',
        layoutPreset: 'balanced', favoritesColumnGap: 24, favoritesRowGap: 20,
        bookmarkTileWidth: 130, bookmarkIconSize: 75, tileShape: 'squircle', showTileLabels: true,
      },
    });

    await newtabPage.reload();
    await newtabPage.waitForSelector('.ff-app');

    await applySort(newtabPage, 'created', 'desc');

    const titles = await titlesInScope(newtabPage, rootAndIds.rootFolderId);
    // Created order (with 10ms gaps): Zebra(1st), Kiwi(2nd), Apple(3rd), Mango(4th)
    // Newest first: Mango, Apple, Kiwi, Zebra
    expect(titles).toEqual(['Mango', 'Apple', 'Kiwi', 'Zebra']);
  });

  // ── date added oldest ──────────────────────────────────────────────────────

  test('Date added oldest-first puts the first-created bookmark first', async ({ newtabPage }) => {
    await resetStorage(newtabPage);

    // Same time-spaced seeding as the newest-first test to ensure distinct dateAdded.
    const rootAndIds = await newtabPage.evaluate(async (args) => {
      const api = (
        (globalThis as unknown as { browser?: ExtApi; chrome: ExtApi }).browser ??
        (globalThis as unknown as { chrome: ExtApi }).chrome
      );
      interface _BookmarkNode { id: string; title: string }
      interface _WorkspaceRecord {
        id: string; name: string; rootFolderId: string;
        themeMode: string; accentColor: string; backgroundMode: string;
        solidBackgroundColor: string; gradientStyle: string;
        gradientColorSource: string; gradientCustomColor: string;
        gradientIntensity: number; backgroundOpacity: number;
        backgroundFitMode: string; backgroundPositionMode: string;
        layoutPreset: string; favoritesColumnGap: number;
        favoritesRowGap: number; bookmarkTileWidth: number;
        bookmarkIconSize: number; tileShape: string; showTileLabels: boolean;
      }
      const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
      const root: _BookmarkNode = await api.bookmarks.create({ parentId: '2', title: 'Sort Date Old' });
      const ids: Record<string, string> = {};
      for (const title of args.titles) {
        await sleep(10);
        const bm: _BookmarkNode = await api.bookmarks.create({
          parentId: root.id,
          title,
          url: `https://${title.toLowerCase()}.example.com`,
        });
        ids[title] = bm.id;
      }
      const record: _WorkspaceRecord = { ...args.defaults, id: 'ws-sort-old', name: 'SortOld', rootFolderId: root.id };
      await api.runtime.sendMessage({ type: 'workspaces/create', workspace: record });
      await api.runtime.sendMessage({
        type: 'settings/patch',
        patch: { activeWorkspaceId: 'ws-sort-old', workspaceOrder: ['ws-sort-old'], rememberLastFolder: false },
      });
      return { rootFolderId: root.id, ids };
    }, {
      titles: ['Zebra', 'Kiwi', 'Apple', 'Mango'],
      defaults: {
        themeMode: 'system', accentColor: '#3F72DC', backgroundMode: 'gradient',
        solidBackgroundColor: '', gradientStyle: 'top', gradientColorSource: 'accent',
        gradientCustomColor: '#3F72DC', gradientIntensity: 100, backgroundOpacity: 70,
        backgroundFitMode: 'cover', backgroundPositionMode: 'center',
        layoutPreset: 'balanced', favoritesColumnGap: 24, favoritesRowGap: 20,
        bookmarkTileWidth: 130, bookmarkIconSize: 75, tileShape: 'squircle', showTileLabels: true,
      },
    });

    await newtabPage.reload();
    await newtabPage.waitForSelector('.ff-app');

    await applySort(newtabPage, 'created', 'asc');

    const titles = await titlesInScope(newtabPage, rootAndIds.rootFolderId);
    // Oldest first == creation order: Zebra, Kiwi, Apple, Mango
    expect(titles).toEqual(['Zebra', 'Kiwi', 'Apple', 'Mango']);
  });

  // ── persistence after reload ───────────────────────────────────────────────

  test('sort choice persists after page reload', async ({ newtabPage }) => {
    await resetStorage(newtabPage);
    const seed = await seedCustomOrder(newtabPage);
    await newtabPage.reload();
    await newtabPage.waitForSelector('.ff-app');

    // Set Name A→Z, then reload — App reads settings from service worker on boot.
    await applySort(newtabPage, 'name', 'asc');

    // Gate the reload on the committed write so we don't read a stale sort.
    // Sort is a per-workspace field now — poll the active workspace record
    // ('ws-sort', created by seedCustomOrder), not AppSettings.
    await waitForWorkspace(
      newtabPage,
      'ws-sort',
      (w) => w.bookmarkSortMode === 'name' && w.bookmarkSortDirection === 'asc',
    );
    await newtabPage.reload();
    await newtabPage.waitForSelector('.ff-app');

    // Sort pill label should reflect the persisted choice.
    await expect(sortPill(newtabPage)).toContainText('Name (A');

    // And tiles should still be in alphabetical order.
    const titles = await titlesInScope(newtabPage, seed.rootFolderId);
    expect(titles).toEqual(['Apple', 'Kiwi', 'Mango', 'Zebra']);
  });

  // ── persistence through folder navigation ─────────────────────────────────

  test('sort persists after opening and closing a folder overlay', async ({ newtabPage }) => {
    await resetStorage(newtabPage);
    // Seed with a folder so we can navigate into it.
    const w = await seedMinimal(newtabPage, { folders: 1, bookmarksPerFolder: 2, rootBookmarks: 3 });
    // Also seed a custom-order root for assertions, but seedMinimal gives BM 01-03
    // at root which are already alphabetical — that's fine: the test only checks
    // that the active sort survives the navigation round-trip.
    await newtabPage.reload();
    await newtabPage.waitForSelector('.ff-app');

    // Apply Name Z→A so we have a non-default sort.
    await applySort(newtabPage, 'name', 'desc');

    // Verify sort pill still shows Z→A after sort.
    await expect(sortPill(newtabPage)).toContainText('Name (Z');

    // Open the folder via the overlay (default folderOpenMode).
    const folderId = w.bookmarkIdByTitle('Folder 1');
    await newtabPage.locator(`[data-item-id="${folderId}"]`).click();
    await expect(newtabPage.locator('.ff-folder-overlay')).toBeVisible();

    // Close overlay.
    await newtabPage.getByRole('button', { name: 'Close overlay' }).click();
    await expect(newtabPage.locator('.ff-folder-overlay')).toHaveCount(0);

    // Sort pill must still show Z→A after navigating back.
    await expect(sortPill(newtabPage)).toContainText('Name (Z');

    // Root tile order must still be sorted Z→A.
    const titles = await titlesInScope(newtabPage, w.rootFolderId);
    // seedMinimal root titles: BM 01, BM 02, BM 03 — Z→A order is BM 03, BM 02, BM 01
    // but "Folder 1" also appears as a child of root; folders sort by name too.
    // We only assert that order is desc — first title alphabetically last.
    const sortedDesc = [...titles].sort((a, b) => b.localeCompare(a));
    expect(titles).toEqual(sortedDesc);
  });

  // ── sort applies to the tile grid while search dropdown is open ────────────

  test('active sort applies to tile grid while search is active', async ({ newtabPage }) => {
    await resetStorage(newtabPage);
    const seed = await seedCustomOrder(newtabPage);
    await newtabPage.reload();
    await newtabPage.waitForSelector('.ff-app');

    // Apply Name A→Z.
    await applySort(newtabPage, 'name', 'asc');

    // Open search and type something that matches a few bookmarks.
    const input = newtabPage.locator('.ff-search input');
    await input.fill('a');
    // Search dropdown appears.
    await expect(newtabPage.locator('#ff-search-results')).toBeVisible();

    // The main tile grid (scope container) must still reflect the Name A→Z order.
    const titles = await titlesInScope(newtabPage, seed.rootFolderId);
    expect(titles).toEqual(['Apple', 'Kiwi', 'Mango', 'Zebra']);

    // Dismiss search.
    await input.press('Escape');
  });
});
