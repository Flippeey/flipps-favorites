// A Firefox that imported Chrome's bookmarks finds the synced workspaces'
// folders in its own tree. Firefox's Chrome importer puts the bookmark bar's
// folders straight into the toolbar and Other bookmarks' folders straight
// into Other Bookmarks (unfiled), with no wrapper folder, and gives every
// node a Firefox id, so no Chrome folder id means anything here. Both
// browsers are driven from this process against the local sync stub
// (tests/fixtures/sync-stub.ts); nothing talks to the real sync host.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startSyncStub, type SyncStub } from '../../fixtures/sync-stub';
import { expectedAuthToken } from '../../fixtures/sync-traffic';
import type { SyncPage } from '../../fixtures/sync-ui';
import {
  addFolder,
  addWorkspace,
  completeOnboarding,
  linkBrowsers,
  showWorkspace,
  shownTabIds,
  workspaceView,
  type FolderSeed,
} from '../../fixtures/sync-scenario';
import { launchChromeWithExtension, launchFirefoxWithExtension, type ChromeSession, type FirefoxSession } from '../launch';
import { syncPageFromPuppeteer } from '../sync-page';

const DAILY: FolderSeed = {
  root: 'bar',
  path: ['Daily Canary'],
  bookmarks: [
    { title: 'Daily News', url: 'https://example.com/daily/news' },
    { title: 'Daily Weather', url: 'https://example.com/daily/weather' },
  ],
};
const RESEARCH: FolderSeed = {
  root: 'other',
  path: ['Research Canary'],
  bookmarks: [
    { title: 'Research Notes', url: 'https://example.com/research/notes' },
    { title: 'Research Papers', url: 'https://example.com/research/papers' },
  ],
};

describe('settings sync into a Firefox that imported Chrome bookmarks', () => {
  let stub: SyncStub;
  let chromeSession: ChromeSession;
  let firefoxSession: FirefoxSession;
  let chrome: SyncPage;
  let firefox: SyncPage;

  beforeAll(async () => {
    stub = await startSyncStub();
    [chromeSession, firefoxSession] = await Promise.all([
      launchChromeWithExtension({ extraArgs: stub.chromeArgs }),
      launchFirefoxWithExtension({ acceptInsecureCerts: true, extraPrefsFirefox: stub.firefoxPrefs }),
    ]);
    chrome = syncPageFromPuppeteer(await chromeSession.newtabPage());
    firefox = syncPageFromPuppeteer(await firefoxSession.newtabPage());
  });

  afterAll(async () => {
    await Promise.all([chromeSession?.close(), firefoxSession?.close()]);
    await stub?.close();
  });

  it('resolves each synced workspace to the imported folder in the toolbar or Other Bookmarks', async () => {
    await completeOnboarding(chrome);
    await addWorkspace(chrome, { id: 'ws-daily', name: 'Daily Canary', folderId: await addFolder(chrome, DAILY) });
    await addWorkspace(chrome, { id: 'ws-research', name: 'Research Canary', folderId: await addFolder(chrome, RESEARCH) });
    await chrome.reload();

    await completeOnboarding(firefox);
    const dailyOnFirefox = await addFolder(firefox, DAILY);
    const researchOnFirefox = await addFolder(firefox, RESEARCH);
    await firefox.reload();

    const code = await linkBrowsers(chrome, firefox);

    expect(await workspaceView(firefox, 'ws-daily')).toMatchObject({ rootFolderId: dailyOnFirefox });
    expect(await workspaceView(firefox, 'ws-research')).toMatchObject({ rootFolderId: researchOnFirefox });
    for (const id of ['ws-daily', 'ws-research']) {
      expect((await workspaceView(firefox, id))?.folderState).toBeUndefined();
    }
    await firefox.reload();
    expect((await shownTabIds(firefox)).sort()).toEqual(['ws-daily', 'ws-research']);
    expect(await showWorkspace(firefox, 'ws-daily')).toEqual(DAILY.bookmarks.map((b) => b.title));
    expect(await showWorkspace(firefox, 'ws-research')).toEqual(RESEARCH.bookmarks.map((b) => b.title));

    const token = await expectedAuthToken(code);
    expect(stub.syncCalls().map((call) => [call.method, call.status, call.token])).toEqual([
      ['GET', 404, token],
      ['PUT', 204, token],
      ['GET', 200, token],
      ['PUT', 204, token],
      ['GET', 200, token],
      ['PUT', 204, token],
    ]);
  }, 120_000);
});
