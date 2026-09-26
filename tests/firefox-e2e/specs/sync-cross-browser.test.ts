// Settings sync from Chrome to Firefox and back, both browsers driven from
// this one process against one local stand-in for the sync server
// (tests/fixtures/sync-stub.ts). Chrome reaches it through
// --host-resolver-rules; Firefox through a PAC-selected local proxy plus
// acceptInsecureCerts. Nothing here talks to the real sync host.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startSyncStub, type SyncStub } from '../../fixtures/sync-stub';
import { expectedAuthToken, findTrafficLeaks } from '../../fixtures/sync-traffic';
import {
  confirmLink,
  linkPreviewSummary,
  openSyncSettings,
  readWorkspaces,
  revealPairingCode,
  seedSyncProfile,
  submitPairingCode,
  syncNow,
  type SyncPage,
  type SyncProfileSeed,
} from '../../fixtures/sync-ui';
import { launchChromeWithExtension, launchFirefoxWithExtension, type ChromeSession, type FirefoxSession } from '../launch';
import { syncPageFromPuppeteer } from '../sync-page';

const FROM_CHROME: SyncProfileSeed = {
  workspaceName: 'Chrome Reading Canary',
  bookmarks: [{ title: 'Chrome Doc', url: 'https://example.com/chrome-canary' }],
  workspace: { accentColor: '#1A2B3C' },
};
const FROM_FIREFOX: SyncProfileSeed = {
  workspaceName: 'Firefox Recipes Canary',
  bookmarks: [{ title: 'Firefox Doc', url: 'https://example.com/firefox-canary' }],
  workspace: { accentColor: '#4D5E6F' },
};

describe('settings sync between Chrome and Firefox', () => {
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

  it('a Chrome pairing code links Firefox, and each browser receives the other one\'s workspace', async () => {
    await seedSyncProfile(chrome, FROM_CHROME);
    await seedSyncProfile(firefox, FROM_FIREFOX);

    await openSyncSettings(chrome);
    expect(await syncNow(chrome)).toBe('Synced.');
    const code = await revealPairingCode(chrome);
    const token = await expectedAuthToken(code);
    const trace = () => stub.syncCalls().map((call) => [call.method, call.status, call.token]);
    expect(trace()).toEqual([['GET', 404, token], ['PUT', 204, token]]);

    await openSyncSettings(firefox);
    await submitPairingCode(firefox, code);
    expect(await linkPreviewSummary(firefox)).toContain(`New workspaces: “${FROM_CHROME.workspaceName}”`);
    expect(await confirmLink(firefox)).toBe('Linked and synced with the other browser.');
    expect(trace().slice(2)).toEqual([['GET', 200, token], ['PUT', 204, token]]);
    const onFirefox = await readWorkspaces(firefox);
    expect(onFirefox.map((ws) => ws.name).sort()).toEqual([FROM_CHROME.workspaceName, FROM_FIREFOX.workspaceName]);
    expect(onFirefox.find((ws) => ws.name === FROM_CHROME.workspaceName)?.accentColor).toBe('#1A2B3C');

    expect(await syncNow(chrome)).toBe('Synced.');
    expect(trace().slice(4)).toEqual([['GET', 200, token], ['PUT', 204, token]]);
    const onChrome = await readWorkspaces(chrome);
    expect(onChrome.map((ws) => ws.name).sort()).toEqual([FROM_CHROME.workspaceName, FROM_FIREFOX.workspaceName]);
    expect(onChrome.find((ws) => ws.name === FROM_FIREFOX.workspaceName)?.accentColor).toBe('#4D5E6F');

    expect(
      await findTrafficLeaks(stub.calls(), {
        pairingCode: code,
        plaintextMarkers: [FROM_CHROME.workspaceName, FROM_FIREFOX.workspaceName, '#1A2B3C', '#4D5E6F'],
      }),
    ).toEqual([]);
  }, 90_000);
});
