// The images a user puts on their workspaces travel with sync between two
// linked Chrome profiles, on the local stand-in for the sync server
// (tests/fixtures/sync-stub.ts): a wallpaper, a bookmark's custom icon and a
// folder's custom icon set on one browser show on the other after Sync now,
// and removing them on one browser removes them on the other.
import { expect, test } from '../fixtures/sync-world.js';
import { MOCK_FAVICON_PNG, MOCK_GLOBE_PLACEHOLDER_PNG } from '../fixtures/test-data.js';
import {
  addChildFolder,
  addFolder,
  addWorkspace,
  clearFolderIcon,
  clearIconOverride,
  clearWallpaper,
  completeOnboarding,
  editSettings,
  folderIconShown,
  hasFolderIcon,
  iconOverrideKeys,
  linkBrowsers,
  pressSyncNow,
  setFolderIcon,
  setIconOverride,
  setWallpaper,
  storedWallpaper,
  waitForBookmarkIcon,
  waitForFolderTile,
  waitForFolderIconShown,
  waitForWallpaperShown,
  wallpaperShown,
  workspaceView,
  type FolderSeed,
} from '../fixtures/sync-scenario.js';
import type { SyncPage } from '../fixtures/sync-ui.js';

const GARDEN_ID = 'ws-garden-notes';
const GARDEN_FOLDER: FolderSeed = {
  root: 'other',
  path: ['Garden Notes'],
  bookmarks: [{ title: 'Compost Guide', url: 'https://example.com/garden/compost' }],
};
const SEEDS_TITLE = 'Seed Catalogs';
const SEEDS_BOOKMARKS = [{ title: 'Heirloom Seeds', url: 'https://example.com/garden/heirloom' }];
const COMPOST = GARDEN_FOLDER.bookmarks[0]!;
const WALLPAPER = `data:image/png;base64,${MOCK_GLOBE_PLACEHOLDER_PNG.toString('base64')}`;

test.describe.configure({ timeout: 120_000 });

async function syncOk(page: SyncPage): Promise<void> {
  expect(await pressSyncNow(page)).toBe('Synced.');
}

/** A profile holding the Garden Notes folder with its Seed Catalogs subfolder; returns both folder ids. */
async function seedGarden(page: SyncPage): Promise<{ garden: string; seeds: string }> {
  await completeOnboarding(page);
  const garden = await addFolder(page, GARDEN_FOLDER);
  const seeds = await addChildFolder(page, garden, SEEDS_TITLE, SEEDS_BOOKMARKS);
  return { garden, seeds };
}

interface GardenPair {
  a: SyncPage;
  b: SyncPage;
  onA: { garden: string; seeds: string };
  onB: { garden: string; seeds: string };
  overrideIcon: string;
}

/**
 * Two linked profiles holding the same Garden Notes bookmarks; A owns the
 * Garden workspace and gives it a wallpaper, a custom icon for one bookmark
 * and one for its subfolder, then both sync.
 */
async function gardenWithImagesSynced(openSyncBrowser: () => Promise<{ sync: SyncPage }>): Promise<GardenPair> {
  const a = (await openSyncBrowser()).sync;
  const b = (await openSyncBrowser()).sync;
  const onA = await seedGarden(a);
  await addWorkspace(a, { id: GARDEN_ID, name: 'Garden Notes', folderId: onA.garden });
  await editSettings(a, { activeWorkspaceId: GARDEN_ID });
  await a.reload();
  const onB = await seedGarden(b);
  await b.reload();
  await linkBrowsers(a, b);
  await editSettings(b, { activeWorkspaceId: GARDEN_ID });

  await setWallpaper(a, GARDEN_ID, WALLPAPER);
  const overrideIcon = await setIconOverride(a, COMPOST.url, MOCK_FAVICON_PNG);
  await setFolderIcon(a, onA.seeds);
  await syncOk(a);
  await syncOk(b);
  return { a, b, onA, onB, overrideIcon };
}

test('a wallpaper, a bookmark icon and a folder icon set on one browser show on the other after both sync', async ({ openSyncBrowser }) => {
  const { b, onB, overrideIcon } = await gardenWithImagesSynced(openSyncBrowser);

  await b.reload();
  await waitForWallpaperShown(b);
  expect(await storedWallpaper(b, GARDEN_ID)).toBe(WALLPAPER);
  await waitForBookmarkIcon(b, COMPOST.title, overrideIcon);
  await waitForFolderIconShown(b, SEEDS_TITLE);
  expect(await hasFolderIcon(b, onB.seeds)).toBe(true);
});

test('removing a bookmark icon and a folder icon on one browser removes them on the other, and they stay removed', async ({ openSyncBrowser }) => {
  const { a, b, onA, onB } = await gardenWithImagesSynced(openSyncBrowser);
  expect(await iconOverrideKeys(b)).not.toEqual([]);
  expect(await hasFolderIcon(b, onB.seeds)).toBe(true);

  await clearIconOverride(a, COMPOST.url);
  await clearFolderIcon(a, onA.seeds);
  await syncOk(a);
  await syncOk(b);

  expect(await iconOverrideKeys(b)).toEqual([]);
  expect(await hasFolderIcon(b, onB.seeds)).toBe(false);
  await b.reload();
  // The folder tile renders, without its custom icon.
  await waitForFolderTile(b, SEEDS_TITLE);
  expect(await folderIconShown(b, SEEDS_TITLE)).toBe(false);

  // Another round must not bring them back to A from B's older copy.
  await syncOk(a);
  expect(await iconOverrideKeys(a)).toEqual([]);
  expect(await hasFolderIcon(a, onA.seeds)).toBe(false);
});

test('removing a wallpaper on one browser removes it on the other, and it stays removed', async ({ openSyncBrowser }) => {
  const { a, b } = await gardenWithImagesSynced(openSyncBrowser);
  expect(await storedWallpaper(b, GARDEN_ID)).toBe(WALLPAPER);

  await clearWallpaper(a, GARDEN_ID);
  await syncOk(a);
  await syncOk(b);

  expect((await workspaceView(b, GARDEN_ID))?.name).toBe('Garden Notes');
  expect(await storedWallpaper(b, GARDEN_ID)).toBe('');
  await b.reload();
  await waitForFolderTile(b, SEEDS_TITLE);
  expect(await wallpaperShown(b)).toBe(false);

  await syncOk(a);
  expect(await storedWallpaper(a, GARDEN_ID)).toBe('');
});
