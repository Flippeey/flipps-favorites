// Newest-wins sync between two linked Chrome profiles, on the local stand-in
// for the sync server (tests/fixtures/sync-stub.ts): edits travel and are
// never undone by an older shared copy, deletions stick, per-browser choices
// stay put, and a synced workspace only ever shows a folder this browser's
// own bookmarks confirm. Nothing here talks to the real sync host.
import { expect, test, type SyncBrowser } from '../fixtures/sync-world.js';
import { decryptPushes, expectedAuthToken } from '../fixtures/sync-traffic.js';
import type { SyncStub } from '../fixtures/sync-stub.js';
import {
  confirmLink,
  linkPreviewSummary,
  openSyncSettings,
  readSettings,
  revealPairingCode,
  submitPairingCode,
  readWorkspaces,
  waitFor,
  type SyncPage,
} from '../fixtures/sync-ui.js';
import {
  addFolder,
  addWorkspace,
  canvasTileLabels,
  chooseLinkMode,
  completeOnboarding,
  deleteWorkspace,
  editSettings,
  editWorkspace,
  folderNotice,
  linkBrowsers,
  pressSyncNow,
  removeFolder,
  selectedLinkMode,
  setFolderIcon,
  showWorkspace,
  shownTabIds,
  workspaceView,
  type FolderSeed,
} from '../fixtures/sync-scenario.js';
import type { WorkspaceExportPayload } from '@/newtab/lib/sync-merge';

const ALPHA_ID = 'ws-alpha-reading';
const BETA_ID = 'ws-beta-recipes';
const ALPHA_FOLDER: FolderSeed = {
  root: 'other',
  path: ['Alpha Reading'],
  bookmarks: [
    { title: 'Alpha Essay', url: 'https://example.com/alpha/essay' },
    { title: 'Alpha Paper', url: 'https://example.com/alpha/paper' },
  ],
};
const BETA_FOLDER: FolderSeed = {
  root: 'other',
  path: ['Beta Recipes'],
  bookmarks: [
    { title: 'Beta Soup', url: 'https://example.com/beta/soup' },
    { title: 'Beta Bread', url: 'https://example.com/beta/bread' },
  ],
};
const titles = (folder: FolderSeed): string[] => folder.bookmarks.map((b) => b.title);

const SYNCED = 'Synced.';
const LINK_TRACE = ['GET 404', 'PUT 204', 'GET 200', 'PUT 204', 'GET 200', 'PUT 204'];
const SYNC_ROUND = ['GET 200', 'PUT 204'];

// Each scenario launches two Chrome profiles and runs several sync rounds.
test.describe.configure({ timeout: 120_000 });

/** Every call the stub saw, as "METHOD status", after checking each carried the pair's token. */
async function traceFor(stub: SyncStub, code: string): Promise<string[]> {
  const token = await expectedAuthToken(code);
  const calls = stub.syncCalls();
  expect(calls.map((call) => call.token)).toEqual(calls.map(() => token));
  return calls.map((call) => `${call.method} ${call.status}`);
}

async function syncOk(page: SyncPage): Promise<void> {
  expect(await pressSyncNow(page)).toBe(SYNCED);
}

async function lastPush(stub: SyncStub, code: string): Promise<WorkspaceExportPayload> {
  const pushes = await decryptPushes(stub.syncCalls(), code);
  return pushes[pushes.length - 1] as WorkspaceExportPayload;
}

const pause = (ms: number): Promise<void> => new Promise((resolvePause) => setTimeout(resolvePause, ms));

interface LinkedPair {
  a: SyncBrowser;
  b: SyncBrowser;
  code: string;
  folders: { a: { alpha: string; beta: string }; b: { alpha: string; beta: string } };
}

/**
 * Two profiles that both hold the Alpha and Beta bookmark folders; A owns
 * the Alpha workspace, B the Beta one. B links to A with Merge, then A syncs
 * once more, so both end up with both workspaces, each bound to its own
 * folder.
 */
async function linkedPair(openSyncBrowser: () => Promise<SyncBrowser>): Promise<LinkedPair> {
  const a = await openSyncBrowser();
  const b = await openSyncBrowser();
  const seed = async (side: SyncBrowser, own: { id: string; name: string; folder: 'alpha' | 'beta'; accent: string }) => {
    await completeOnboarding(side.sync);
    const folders = { alpha: await addFolder(side.sync, ALPHA_FOLDER), beta: await addFolder(side.sync, BETA_FOLDER) };
    await addWorkspace(side.sync, { id: own.id, name: own.name, folderId: folders[own.folder], workspace: { accentColor: own.accent } });
    await editSettings(side.sync, { activeWorkspaceId: own.id });
    await side.sync.reload();
    return folders;
  };
  const folders = {
    a: await seed(a, { id: ALPHA_ID, name: 'Alpha Reading', folder: 'alpha', accent: '#1A2B3C' }),
    b: await seed(b, { id: BETA_ID, name: 'Beta Recipes', folder: 'beta', accent: '#4D5E6F' }),
  };
  const code = await linkBrowsers(a.sync, b.sync);
  for (const side of [a, b]) {
    expect((await workspaceView(side.sync, ALPHA_ID))?.folderState).toBeUndefined();
    expect((await workspaceView(side.sync, BETA_ID))?.folderState).toBeUndefined();
  }
  return { a, b, code, folders };
}

test('an edit made on one browser reaches the other on its next Sync now', async ({ syncStub, openSyncBrowser }) => {
  const { a, b, code } = await linkedPair(openSyncBrowser);

  await editWorkspace(a.sync, BETA_ID, { name: 'Beta Recipes Weeknight', accentColor: '#ABCDEF' });
  await syncOk(a.sync);
  await syncOk(b.sync);

  expect(await workspaceView(b.sync, BETA_ID)).toMatchObject({ name: 'Beta Recipes Weeknight', accentColor: '#ABCDEF' });
  expect(await traceFor(syncStub, code)).toEqual([...LINK_TRACE, ...SYNC_ROUND, ...SYNC_ROUND]);
});

test('an edit followed by Sync now on the same browser is kept, not reverted by the older shared copy', async ({ syncStub, openSyncBrowser }) => {
  const { a, b, code } = await linkedPair(openSyncBrowser);

  // Alpha already synced from A, so the shared copy holds an older Alpha.
  await editWorkspace(b.sync, ALPHA_ID, { accentColor: '#C0FFEE' });
  await syncOk(b.sync);

  expect((await workspaceView(b.sync, ALPHA_ID))?.accentColor).toBe('#C0FFEE');
  const pushed = await lastPush(syncStub, code);
  expect(pushed.workspaces.find((ws) => ws.id === ALPHA_ID)?.accentColor).toBe('#C0FFEE');

  await syncOk(a.sync);
  expect((await workspaceView(a.sync, ALPHA_ID))?.accentColor).toBe('#C0FFEE');
  expect(await traceFor(syncStub, code)).toEqual([...LINK_TRACE, ...SYNC_ROUND, ...SYNC_ROUND]);
});

test('a deleted workspace is removed on the other browser and stays deleted after both sync again', async ({ syncStub, openSyncBrowser }) => {
  const { a, b, code } = await linkedPair(openSyncBrowser);

  await deleteWorkspace(a.sync, BETA_ID);
  await syncOk(a.sync);
  await syncOk(b.sync);
  expect(await workspaceView(b.sync, BETA_ID)).toBeUndefined();

  await syncOk(a.sync);
  await syncOk(b.sync);
  for (const side of [a, b]) {
    expect((await workspaceView(side.sync, BETA_ID))).toBeUndefined();
    expect(await workspaceView(side.sync, ALPHA_ID)).toBeDefined();
  }
  await b.sync.reload();
  expect(await shownTabIds(b.sync)).toEqual([ALPHA_ID]);

  const pushed = await lastPush(syncStub, code);
  expect(pushed.workspaces.map((ws) => ws.id)).toEqual([ALPHA_ID]);
  expect(pushed.deletions?.map((marker) => [marker.kind, marker.key])).toEqual([['workspace', BETA_ID]]);
  expect(await traceFor(syncStub, code)).toEqual([...LINK_TRACE, ...SYNC_ROUND, ...SYNC_ROUND, ...SYNC_ROUND, ...SYNC_ROUND]);
});

test('concurrent edits: the newer edit of a workspace wins, and edits to different settings both survive', async ({ syncStub, openSyncBrowser }) => {
  const { a, b, code } = await linkedPair(openSyncBrowser);

  // A edits first; B edits the same workspace later, before either syncs.
  await editWorkspace(a.sync, ALPHA_ID, { accentColor: '#AA2244' });
  await editWorkspace(a.sync, BETA_ID, { accentColor: '#2244AA' });
  await editSettings(a.sync, { showClock: true });
  await pause(25);
  await editWorkspace(b.sync, ALPHA_ID, { accentColor: '#22AA44' });
  await editSettings(b.sync, { clockHourFormat: '12' });

  await syncOk(a.sync);
  await syncOk(b.sync);
  await syncOk(a.sync);

  for (const side of [a, b]) {
    expect((await workspaceView(side.sync, ALPHA_ID))?.accentColor).toBe('#22AA44');
    expect((await workspaceView(side.sync, BETA_ID))?.accentColor).toBe('#2244AA');
    expect(await readSettings(side.sync)).toMatchObject({ showClock: true, clockHourFormat: '12' });
  }
  expect(await traceFor(syncStub, code)).toEqual([...LINK_TRACE, ...SYNC_ROUND, ...SYNC_ROUND, ...SYNC_ROUND]);
});

test('the active workspace and the dock folder stay with each browser', async ({ syncStub, openSyncBrowser }) => {
  const { a, b, code, folders } = await linkedPair(openSyncBrowser);

  await editSettings(a.sync, { activeWorkspaceId: BETA_ID, dockFolderId: folders.a.alpha });
  await editSettings(b.sync, { activeWorkspaceId: ALPHA_ID, dockFolderId: folders.b.beta });
  await syncOk(a.sync);
  await syncOk(b.sync);
  await syncOk(a.sync);

  expect(await readSettings(a.sync)).toMatchObject({ activeWorkspaceId: BETA_ID, dockFolderId: folders.a.alpha });
  expect(await readSettings(b.sync)).toMatchObject({ activeWorkspaceId: ALPHA_ID, dockFolderId: folders.b.beta });
  await a.sync.reload();
  expect(await canvasTileLabels(a.sync)).toEqual(titles(BETA_FOLDER));
  await b.sync.reload();
  expect(await canvasTileLabels(b.sync)).toEqual(titles(ALPHA_FOLDER));

  const pushes = (await decryptPushes(syncStub.syncCalls(), code)) as WorkspaceExportPayload[];
  expect(pushes).toHaveLength(6);
  for (const push of pushes) {
    expect(Object.keys(push.settings)).not.toContain('activeWorkspaceId');
    expect(Object.keys(push.settings)).not.toContain('dockFolderId');
  }
  expect(await traceFor(syncStub, code)).toEqual([...LINK_TRACE, ...SYNC_ROUND, ...SYNC_ROUND, ...SYNC_ROUND]);
});

test('a workspace created separately on both browsers converges on one id, and a delete on either side sticks', async ({ syncStub, openSyncBrowser }) => {
  const a = await openSyncBrowser();
  const b = await openSyncBrowser();
  const reading: FolderSeed = { root: 'other', path: ['Shared Reading'], bookmarks: [{ title: 'Long Read', url: 'https://example.com/shared/read' }] };
  const recipes: FolderSeed = { root: 'other', path: ['Shared Recipes'], bookmarks: [{ title: 'Stew', url: 'https://example.com/shared/stew' }] };
  // The smaller id sits on A for one pair and on B for the other, so each
  // browser re-keys once.
  const ids = { a: { reading: 'pair-reading-1', recipes: 'pair-recipes-2' }, b: { reading: 'pair-reading-2', recipes: 'pair-recipes-1' } };
  for (const [side, own] of [[a, ids.a], [b, ids.b]] as const) {
    await completeOnboarding(side.sync);
    await addWorkspace(side.sync, { id: own.reading, name: 'Shared Reading', folderId: await addFolder(side.sync, reading) });
    await addWorkspace(side.sync, { id: own.recipes, name: 'Shared Recipes', folderId: await addFolder(side.sync, recipes) });
    await side.sync.reload();
  }

  const code = await linkBrowsers(a.sync, b.sync);
  for (const side of [a, b]) {
    expect((await readWorkspaces(side.sync)).map((ws) => ws.id).sort()).toEqual(['pair-reading-1', 'pair-recipes-1']);
    await side.sync.reload();
    expect((await shownTabIds(side.sync)).sort()).toEqual(['pair-reading-1', 'pair-recipes-1']);
  }

  await deleteWorkspace(a.sync, 'pair-reading-1');
  await deleteWorkspace(b.sync, 'pair-recipes-1');
  for (let round = 0; round < 2; round += 1) {
    await syncOk(a.sync);
    await syncOk(b.sync);
  }
  for (const side of [a, b]) {
    await side.sync.reload();
    expect(await shownTabIds(side.sync)).toEqual([]);
  }
  expect((await lastPush(syncStub, code)).workspaces).toEqual([]);
  expect(await traceFor(syncStub, code)).toEqual([...LINK_TRACE, ...SYNC_ROUND, ...SYNC_ROUND, ...SYNC_ROUND, ...SYNC_ROUND]);
});

test('a workspace whose bookmarks arrive after linking waits hidden, appears once its folder exists, and shows the removed state when that folder is deleted', async ({ syncStub, openSyncBrowser }) => {
  const a = await openSyncBrowser();
  const b = await openSyncBrowser();
  const travelFolder: FolderSeed = {
    root: 'other',
    path: ['Travel Plans'],
    bookmarks: [
      { title: 'Rail Pass', url: 'https://example.com/travel/rail' },
      { title: 'Hostel List', url: 'https://example.com/travel/hostels' },
    ],
  };
  await completeOnboarding(a.sync);
  await addWorkspace(a.sync, { id: 'ws-travel', name: 'Travel Plans', folderId: await addFolder(a.sync, travelFolder) });
  await editSettings(a.sync, { activeWorkspaceId: 'ws-travel' });
  await completeOnboarding(b.sync);
  await addWorkspace(b.sync, { id: BETA_ID, name: 'Beta Recipes', folderId: await addFolder(b.sync, BETA_FOLDER) });
  await editSettings(b.sync, { activeWorkspaceId: BETA_ID });
  await b.sync.reload();

  await openSyncSettings(a.sync);
  expect(await pressSyncNow(a.sync)).toBe(SYNCED);
  const code = await revealPairingCode(a.sync);
  await openSyncSettings(b.sync);
  await submitPairingCode(b.sync, code);
  await chooseLinkMode(b.sync, 'Merge');
  expect(await confirmLink(b.sync)).toBe('Linked and synced with the other browser.');

  // B has no Travel Plans folder yet: the workspace waits, hidden, and says so.
  await waitFor(b.sync, { selector: '.ff-toast__msg', text: '1 synced workspace needs a folder' });
  await waitFor(b.sync, { selector: '[data-testid="waiting-workspaces"]', text: '1 synced workspace needs a folder in this browser' });
  expect(await workspaceView(b.sync, 'ws-travel')).toMatchObject({ rootFolderId: '', folderState: 'waiting' });
  await b.sync.reload();
  expect(await shownTabIds(b.sync)).toEqual([BETA_ID]);

  // The bookmarks show up in B (e.g. imported): the next page load finds the folder.
  const travelOnB = await addFolder(b.sync, travelFolder);
  await b.sync.reload();
  expect((await shownTabIds(b.sync)).sort()).toEqual([BETA_ID, 'ws-travel']);
  expect(await workspaceView(b.sync, 'ws-travel')).toMatchObject({ rootFolderId: travelOnB });
  expect(await showWorkspace(b.sync, 'ws-travel')).toEqual(titles(travelFolder));
  await openSyncSettings(b.sync);
  expect(await b.sync.evaluate(() => document.querySelector('[data-testid="waiting-workspaces"]') !== null, undefined)).toBe(false);

  // Deleting that folder in B keeps the tab but shows no bookmarks at all.
  await removeFolder(b.sync, travelOnB);
  await b.sync.reload();
  expect(await folderNotice(b.sync)).toContain('This workspace’s folder was removed');
  expect(await canvasTileLabels(b.sync)).toEqual([]);
  expect((await shownTabIds(b.sync)).sort()).toEqual([BETA_ID, 'ws-travel']);
  expect((await workspaceView(b.sync, 'ws-travel'))?.folderState).toBe('lost');

  // A folder deleted in one browser deletes nothing elsewhere.
  await syncOk(b.sync);
  await syncOk(a.sync);
  await a.sync.reload();
  expect(await canvasTileLabels(a.sync)).toEqual(titles(travelFolder));
  expect(await traceFor(syncStub, code)).toEqual(['GET 404', 'PUT 204', 'GET 200', 'PUT 204', ...SYNC_ROUND, ...SYNC_ROUND]);
});

test('a synced folder id that names a different folder in this browser is never shown', async ({ syncStub, openSyncBrowser }) => {
  const a = await openSyncBrowser();
  const b = await openSyncBrowser();
  const work: FolderSeed = {
    root: 'other',
    path: ['Work Canary'],
    bookmarks: [
      { title: 'Work Tracker', url: 'https://example.com/work/tracker' },
      { title: 'Work Wiki', url: 'https://example.com/work/wiki' },
    ],
  };
  await completeOnboarding(a.sync);
  const workOnA = await addFolder(a.sync, work);
  await addWorkspace(a.sync, { id: 'ws-work', name: 'Work Canary', folderId: workOnA });
  await completeOnboarding(b.sync);
  const recipesOnB = await addFolder(b.sync, BETA_FOLDER);
  await addWorkspace(b.sync, { id: BETA_ID, name: 'Beta Recipes', folderId: recipesOnB });
  // Fresh profiles number folders alike, so A's Work id is B's Recipes id.
  expect(recipesOnB).toBe(workOnA);
  await a.sync.reload();
  await b.sync.reload();

  const code = await linkBrowsers(a.sync, b.sync);

  expect(await workspaceView(b.sync, 'ws-work')).toMatchObject({ rootFolderId: '', folderState: 'waiting' });
  expect(await workspaceView(a.sync, BETA_ID)).toMatchObject({ rootFolderId: '', folderState: 'waiting' });
  await b.sync.reload();
  expect(await shownTabIds(b.sync)).toEqual([BETA_ID]);
  expect(await canvasTileLabels(b.sync)).toEqual(titles(BETA_FOLDER));
  await a.sync.reload();
  expect(await shownTabIds(a.sync)).toEqual(['ws-work']);
  expect(await canvasTileLabels(a.sync)).toEqual(titles(work));
  expect(await traceFor(syncStub, code)).toEqual(LINK_TRACE);
});

test('linking from a freshly onboarded browser previews what it will add and preselects Replace', async ({ syncStub, openSyncBrowser }) => {
  const a = await openSyncBrowser();
  const b = await openSyncBrowser();
  await completeOnboarding(a.sync);
  await addWorkspace(a.sync, { id: ALPHA_ID, name: 'Alpha Reading', folderId: await addFolder(a.sync, ALPHA_FOLDER) });
  await a.sync.reload();
  await openSyncSettings(a.sync);
  expect(await pressSyncNow(a.sync)).toBe(SYNCED);
  const code = await revealPairingCode(a.sync);

  // B runs onboarding for real and keeps what it created untouched.
  const picks = await addFolder(b.sync, { root: 'bar', path: ['Onboard Picks'], bookmarks: [{ title: 'Pick One', url: 'https://example.com/picks/one' }] });
  await b.sync.reload();
  const onboard = b.page.locator('.ff-onboard');
  await expect(onboard).toBeVisible();
  for (let step = 0; step < 4; step += 1) await onboard.getByRole('button', { name: /Next/i }).click();
  await onboard.getByRole('button', { name: /Get started/i }).click();
  await expect(onboard).toHaveCount(0);
  const onboarded = (await readWorkspaces(b.sync)).map((ws) => ws.name);
  expect(onboarded).toHaveLength(1);
  await setFolderIcon(b.sync, picks);

  await openSyncSettings(b.sync);
  await submitPairingCode(b.sync, code);
  // Replace is preselected, and the preview says what it would drop here.
  expect(await selectedLinkMode(b.sync)).toBe('Replace');
  const replacePreview = await linkPreviewSummary(b.sync);
  expect(replacePreview).toContain('This browser will get: “Alpha Reading”');
  expect(replacePreview).toContain(`Removed from this browser and your other signed-in Chrome devices: “${onboarded[0]!}”`);
  // Replace drops this browser's folder icon too, and says so before it happens.
  expect(replacePreview).toContain('0 folder icon(s) arrive; 1 local folder icon(s) are removed first.');
  // Merge instead would push the onboarding workspace to the other browser, and says so.
  await chooseLinkMode(b.sync, 'Merge');
  const mergePreview = await waitFor(b.sync, { selector: '[data-testid="link-preview-summary"]', text: 'This browser will add' });
  expect(mergePreview).toContain(`This browser will add: “${onboarded[0]!}”`);
  expect(mergePreview).toContain('This browser will get: “Alpha Reading”');
  expect(mergePreview).not.toContain('folder icon');

  await waitFor(b.sync, { selector: '.ff-dialog__actions .ff-btn--ghost', text: 'Cancel', click: true });
  expect(await traceFor(syncStub, code)).toEqual(['GET 404', 'PUT 204', 'GET 200']);
  // Cancelling the preview leaves the fresh browser as it was.
  expect(await workspaceView(b.sync, ALPHA_ID)).toBeUndefined();
});
