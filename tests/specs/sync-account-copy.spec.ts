// Two Chrome profiles on one Google account: Chrome account sync copies the
// extension's chrome.storage.sync keys (workspaces, settings, the sync
// secret) from one profile to the other without the extension's merge ever
// running. Each copied workspace carries the first profile's folder id,
// which in the second profile can name a different folder. The second
// profile must find each folder in its own bookmarks or keep the workspace
// hidden, and never show the folder that merely shares the id.
import { expect, test } from '../fixtures/sync-world.js';
import { expectedAuthToken } from '../fixtures/sync-traffic.js';
import { openSyncSettings, revealPairingCode } from '../fixtures/sync-ui.js';
import {
  addFolder,
  addWorkspace,
  completeOnboarding,
  copyAccountSyncedStorage,
  pressSyncNow,
  readLocalStorageKey,
  showWorkspace,
  shownTabIds,
  workspaceView,
  type FolderSeed,
} from '../fixtures/sync-scenario.js';

const WORK: FolderSeed = {
  root: 'other',
  path: ['Work Canary'],
  bookmarks: [
    { title: 'Work Tracker', url: 'https://example.com/work/tracker' },
    { title: 'Work Wiki', url: 'https://example.com/work/wiki' },
    { title: 'Work Calendar', url: 'https://example.com/work/calendar' },
  ],
};
const TRAVEL: FolderSeed = {
  root: 'other',
  path: ['Travel Canary'],
  bookmarks: [{ title: 'Rail Pass', url: 'https://example.com/travel/rail' }],
};
const RECIPES: FolderSeed = {
  root: 'other',
  path: ['Recipes Canary'],
  // As many bookmarks as Work, so the next folder here gets Travel's id.
  bookmarks: [
    { title: 'Stew', url: 'https://example.com/recipes/stew' },
    { title: 'Bread', url: 'https://example.com/recipes/bread' },
    { title: 'Salad', url: 'https://example.com/recipes/salad' },
  ],
};
const titles = (folder: FolderSeed): string[] => folder.bookmarks.map((b) => b.title);

test.describe.configure({ timeout: 120_000 });

test('workspaces copied by Chrome account sync bind to their own folder here or wait hidden, never to the folder that shares their id', async ({ syncStub, openSyncBrowser }) => {
  const first = await openSyncBrowser();
  // The second profile is freshly installed and has not opened a page yet:
  // account sync can deliver the first profile's storage before this
  // browser ever asks for its workspaces.
  const second = await openSyncBrowser({ newtab: false });

  await completeOnboarding(first.sync);
  const workOnFirst = await addFolder(first.sync, WORK);
  const travelOnFirst = await addFolder(first.sync, TRAVEL);
  await addWorkspace(first.sync, { id: 'ws-work', name: 'Work Canary', folderId: workOnFirst });
  await addWorkspace(first.sync, { id: 'ws-travel', name: 'Travel Canary', folderId: travelOnFirst });
  await first.sync.reload();
  await openSyncSettings(first.sync);
  expect(await pressSyncNow(first.sync)).toBe('Synced.');
  const code = await revealPairingCode(first.sync);

  // The second profile has its own bookmarks: Recipes first, then the same
  // Work folder as the first profile. Fresh profiles number folders alike,
  // so the first profile's Work id is Recipes here and its Travel id is Work.
  await completeOnboarding(second.background);
  const recipesOnSecond = await addFolder(second.background, RECIPES);
  const workOnSecond = await addFolder(second.background, WORK);
  expect([recipesOnSecond, workOnSecond]).toEqual([workOnFirst, travelOnFirst]);

  const copied = await copyAccountSyncedStorage(first.sync, second.background);
  expect(copied).toEqual(['app-settings', 'sync-secret', 'workspace:ws-travel', 'workspace:ws-work']);
  // A profile on an older version stores workspaces without a folder
  // locator. One such record arrives too, still naming the first profile's
  // Work folder id, which is Recipes here; only its id could place it.
  await second.background.evaluate(async (ids) => {
    type Api = { storage: { local: {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    } } };
    const local = (globalThis as unknown as { chrome: Api }).chrome.storage.local;
    const source = (await local.get(`workspace:${ids.from}`))[`workspace:${ids.from}`] as Record<string, unknown>;
    const { rootFolder: _locator, ...legacy } = source;
    await local.set({ [`workspace:${ids.to}`]: { ...legacy, id: ids.to, name: 'Legacy Canary' } });
  }, { from: 'ws-work', to: 'ws-legacy' });
  expect(await readLocalStorageKey(second.background, 'workspace:ws-legacy')).toMatchObject({ rootFolderId: recipesOnSecond });
  await second.openNewtab();

  expect(await workspaceView(second.sync, 'ws-work')).toMatchObject({ rootFolderId: workOnSecond });
  expect((await workspaceView(second.sync, 'ws-work'))?.folderState).toBeUndefined();
  expect(await workspaceView(second.sync, 'ws-travel')).toMatchObject({ rootFolderId: '', folderState: 'waiting' });
  expect(await workspaceView(second.sync, 'ws-legacy')).toMatchObject({ rootFolderId: '', folderState: 'waiting' });
  expect(await shownTabIds(second.sync)).toEqual(['ws-work']);
  expect(await showWorkspace(second.sync, 'ws-work')).toEqual(titles(WORK));
  // Travel is hidden, so asking for it falls back to a shown workspace.
  expect(await showWorkspace(second.sync, 'ws-travel')).toEqual(titles(WORK));

  // The copied secret already links this profile: its first Sync now is an
  // ordinary merge under the same pairing, and changes none of the above.
  await openSyncSettings(second.sync);
  expect(await revealPairingCode(second.sync)).toBe(code);
  expect(await pressSyncNow(second.sync)).toBe('Synced.');
  expect(await workspaceView(second.sync, 'ws-work')).toMatchObject({ rootFolderId: workOnSecond });
  expect(await workspaceView(second.sync, 'ws-travel')).toMatchObject({ rootFolderId: '', folderState: 'waiting' });

  const token = await expectedAuthToken(code);
  expect(syncStub.syncCalls().map((call) => [call.method, call.status, call.token])).toEqual([
    ['GET', 404, token],
    ['PUT', 204, token],
    ['GET', 200, token],
    ['PUT', 204, token],
  ]);
});
