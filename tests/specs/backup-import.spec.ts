// Backup > Import: a file exported on one browser, imported through the
// Import button on another, brings back what the user set up — the
// workspace, its wallpaper, a folder's custom icon and a bookmark's custom
// icon — in both Merge and Replace mode. The file is exported through the
// Export button, so the round trip is the one a user makes when moving
// between computers. No sync request is made.
import type { Page } from '@playwright/test';
import { expect, test, type SyncBrowser } from '../fixtures/sync-world.js';
import { MOCK_FAVICON_PNG, MOCK_GLOBE_PLACEHOLDER_PNG } from '../fixtures/test-data.js';
import { openSyncSettings, readWorkspaces, type SyncPage } from '../fixtures/sync-ui.js';
import {
  addChildFolder,
  addFolder,
  addWorkspace,
  completeOnboarding,
  editSettings,
  hasFolderIcon,
  iconOverrideKeys,
  setFolderIcon,
  setIconOverride,
  setWallpaper,
  shownTabIds,
  storedWallpaper,
  waitForBookmarkIcon,
  waitForFolderIconShown,
  waitForWallpaperShown,
  wallpaperShown,
  type FolderSeed,
} from '../fixtures/sync-scenario.js';

const SOURCE_ID = 'ws-garden-notes';
const GARDEN_FOLDER: FolderSeed = {
  root: 'other',
  path: ['Garden Notes'],
  bookmarks: [{ title: 'Compost Guide', url: 'https://example.com/garden/compost' }],
};
const SEEDS_TITLE = 'Seed Catalogs';
const SEEDS_BOOKMARKS = [{ title: 'Heirloom Seeds', url: 'https://example.com/garden/heirloom' }];
const COMPOST = GARDEN_FOLDER.bookmarks[0]!;
const WALLPAPER = `data:image/png;base64,${MOCK_GLOBE_PLACEHOLDER_PNG.toString('base64')}`;
const SOURCE_ACCENT = '#2E7D32';

test.describe.configure({ timeout: 90_000 });

async function seedGarden(page: SyncPage): Promise<{ garden: string; seeds: string }> {
  await completeOnboarding(page);
  const garden = await addFolder(page, GARDEN_FOLDER);
  const seeds = await addChildFolder(page, garden, SEEDS_TITLE, SEEDS_BOOKMARKS);
  return { garden, seeds };
}

/**
 * On a fresh profile, set up the Garden workspace with a wallpaper, a custom
 * icon for its Compost bookmark and one for its Seed Catalogs folder, then
 * export it with the Export button. Returns the file and the bookmark icon.
 */
async function exportGardenBackup(source: SyncBrowser): Promise<{ file: string; overrideIcon: string }> {
  const folders = await seedGarden(source.sync);
  await addWorkspace(source.sync, { id: SOURCE_ID, name: 'Garden Notes', folderId: folders.garden, workspace: { accentColor: SOURCE_ACCENT } });
  await setWallpaper(source.sync, SOURCE_ID, WALLPAPER);
  const overrideIcon = await setIconOverride(source.sync, COMPOST.url, MOCK_FAVICON_PNG);
  await setFolderIcon(source.sync, folders.seeds);
  await source.sync.reload();

  await openSyncSettings(source.sync);
  const download = source.page.waitForEvent('download');
  await source.page.getByRole('button', { name: /Export/ }).click();
  const file = await (await download).path();
  await expect(source.page.getByText('Exported 1 workspace and 1 icon override.')).toBeVisible();
  return { file, overrideIcon };
}

async function importBackup(page: Page, sync: SyncPage, file: string, mode: 'Merge' | 'Replace'): Promise<string> {
  await openSyncSettings(sync);
  const modeCard = page.locator('.ff-card', { hasText: 'Import mode' });
  await modeCard.getByRole('button', { name: mode, exact: true }).click();
  await expect(modeCard.getByRole('button', { name: mode, exact: true })).toHaveAttribute('data-active', 'true');
  await page.locator('input[type="file"][accept="application/json,.json"]').setInputFiles(file);
  const status = page.getByText(/^Imported /);
  await expect(status).toBeVisible();
  return (await status.textContent()) ?? '';
}

test('Merge import of an exported backup brings back the workspace with its wallpaper, folder icon and bookmark icon', async ({ openSyncBrowser }) => {
  const { file, overrideIcon } = await exportGardenBackup(await openSyncBrowser());
  const target = await openSyncBrowser();
  const onTarget = await seedGarden(target.sync);
  await target.sync.reload();
  expect(await readWorkspaces(target.sync)).toEqual([]);

  expect(await importBackup(target.page, target.sync, file, 'Merge')).toBe('Imported 1 workspace and 1 icon override (merge mode).');

  expect((await readWorkspaces(target.sync)).map((ws) => [ws.id, ws.name, ws.accentColor])).toEqual([[SOURCE_ID, 'Garden Notes', SOURCE_ACCENT]]);
  await target.sync.reload();
  expect(await shownTabIds(target.sync)).toEqual([SOURCE_ID]);
  await waitForWallpaperShown(target.sync);
  expect(await storedWallpaper(target.sync, SOURCE_ID)).toBe(WALLPAPER);
  await waitForFolderIconShown(target.sync, SEEDS_TITLE);
  expect(await hasFolderIcon(target.sync, onTarget.seeds)).toBe(true);
  await waitForBookmarkIcon(target.sync, COMPOST.title, overrideIcon);
});

test('Replace import onto a same-named workspace of this browser keeps its id and puts the file\'s wallpaper under it', async ({ openSyncBrowser }) => {
  const { file, overrideIcon } = await exportGardenBackup(await openSyncBrowser());
  const target = await openSyncBrowser();
  const onTarget = await seedGarden(target.sync);
  // The same workspace, created here on this browser's own copy of the folder.
  const localId = 'ws-garden-here';
  await addWorkspace(target.sync, { id: localId, name: 'Garden Notes', folderId: onTarget.garden, workspace: { accentColor: '#AA5500' } });
  await editSettings(target.sync, { activeWorkspaceId: localId });
  // A custom icon only this browser has: Replace wipes it.
  await setIconOverride(target.sync, 'https://example.org/elsewhere', MOCK_GLOBE_PLACEHOLDER_PNG);
  await target.sync.reload();
  expect(await wallpaperShown(target.sync)).toBe(false);

  expect(await importBackup(target.page, target.sync, file, 'Replace')).toBe('Imported 1 workspace and 1 icon override (replace mode).');

  // Paired with the local workspace, not added beside it.
  const workspaces = await readWorkspaces(target.sync);
  expect(workspaces.map((ws) => [ws.id, ws.accentColor, ws.backgroundMode])).toEqual([[localId, SOURCE_ACCENT, 'wallpaper']]);
  expect(await storedWallpaper(target.sync, localId)).toBe(WALLPAPER);
  expect(await storedWallpaper(target.sync, SOURCE_ID)).toBe('');
  expect(await iconOverrideKeys(target.sync)).toEqual(['host:example.com']);

  await target.sync.reload();
  expect(await shownTabIds(target.sync)).toEqual([localId]);
  await waitForWallpaperShown(target.sync);
  await waitForFolderIconShown(target.sync, SEEDS_TITLE);
  await waitForBookmarkIcon(target.sync, COMPOST.title, overrideIcon);
});

