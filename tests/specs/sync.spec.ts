// Settings sync between two Chrome profiles against a local stand-in for the
// sync server (tests/fixtures/sync-stub.ts). Covers the round trip through a
// pairing code, what the server is allowed to see, and how each failure mode
// reaches the user. Nothing here talks to the real sync host.
import { expect, test } from '../fixtures/sync-world.js';
import { expectedAuthToken, findTrafficLeaks } from '../fixtures/sync-traffic.js';
import {
  confirmLink,
  isLinkPreviewOpen,
  lastSyncedCaption,
  linkError,
  linkPreviewSummary,
  openSyncSettings,
  readWorkspaces,
  revealPairingCode,
  seedSyncProfile,
  submitPairingCode,
  syncNow,
  withNewToast,
  type SyncProfileSeed,
} from '../fixtures/sync-ui.js';

const ALPHA: SyncProfileSeed = {
  workspaceName: 'Alpha Reading Canary',
  bookmarks: [{ title: 'Alpha Doc', url: 'https://example.com/alpha-canary' }],
  workspace: { accentColor: '#1A2B3C' },
};
const BETA: SyncProfileSeed = {
  workspaceName: 'Beta Recipes Canary',
  bookmarks: [{ title: 'Beta Doc', url: 'https://example.com/beta-canary' }],
  workspace: { accentColor: '#4D5E6F' },
};
const PLAINTEXT_MARKERS = [ALPHA.workspaceName, BETA.workspaceName, '#1A2B3C', '#4D5E6F'];

const SYNCED = 'Synced.';
const NEVER_SYNCED = 'Never synced on this browser.';

// Each scenario launches two Chrome profiles; the default 30s is too tight.
test.describe.configure({ timeout: 90_000 });

test('a pairing code carries workspaces from one Chrome profile to another and back', async ({ syncStub, openSyncBrowser }) => {
  const a = await openSyncBrowser();
  const b = await openSyncBrowser();
  await seedSyncProfile(a.sync, ALPHA);
  await seedSyncProfile(b.sync, BETA);

  await openSyncSettings(a.sync);
  expect(await syncNow(a.sync)).toBe(SYNCED);
  const code = await revealPairingCode(a.sync);
  const token = await expectedAuthToken(code);
  const trace = () => syncStub.syncCalls().map((call) => [call.method, call.status, call.token]);
  expect(trace()).toEqual([['GET', 404, token], ['PUT', 204, token]]);

  await openSyncSettings(b.sync);
  await submitPairingCode(b.sync, code);
  const preview = await linkPreviewSummary(b.sync);
  expect(preview).toContain(`This browser will get: “${ALPHA.workspaceName}”`);
  expect(preview).toContain(`This browser will add: “${BETA.workspaceName}”`);
  expect(await confirmLink(b.sync)).toBe('Linked and synced with the other browser.');
  expect(trace().slice(2)).toEqual([['GET', 200, token], ['PUT', 204, token]]);
  const onB = await readWorkspaces(b.sync);
  expect(onB.map((ws) => ws.name).sort()).toEqual([ALPHA.workspaceName, BETA.workspaceName]);
  expect(onB.find((ws) => ws.name === ALPHA.workspaceName)?.accentColor).toBe('#1A2B3C');
  expect(await revealPairingCode(b.sync)).toBe(code);

  // Back the other way: B's own workspace reaches A on A's next sync.
  expect(await syncNow(a.sync)).toBe(SYNCED);
  expect(trace().slice(4)).toEqual([['GET', 200, token], ['PUT', 204, token]]);
  const onA = await readWorkspaces(a.sync);
  expect(onA.map((ws) => ws.name).sort()).toEqual([ALPHA.workspaceName, BETA.workspaceName]);
  expect(onA.find((ws) => ws.name === BETA.workspaceName)?.accentColor).toBe('#4D5E6F');

  expect(await findTrafficLeaks(syncStub.calls(), { pairingCode: code, plaintextMarkers: PLAINTEXT_MARKERS })).toEqual([]);
});

test('a mistyped or truncated pairing code is rejected before any request is sent', async ({ syncStub, openSyncBrowser }) => {
  const a = await openSyncBrowser();
  const b = await openSyncBrowser();
  await seedSyncProfile(a.sync, ALPHA);
  await seedSyncProfile(b.sync, BETA);
  await openSyncSettings(a.sync);
  const code = await revealPairingCode(a.sync);
  await openSyncSettings(b.sync);
  const ownCodeOfB = await revealPairingCode(b.sync);

  // The second-to-last character sits wholly inside the 2-byte checksum, so
  // changing it always breaks the checksum (a typo in the secret part could,
  // once in 65536, still match).
  const at = code.length - 2;
  const typo = `${code.slice(0, at)}${code[at] === 'A' ? 'B' : 'A'}${code.slice(at + 1)}`;
  for (const badCode of [typo, code.slice(0, -5)]) {
    await submitPairingCode(b.sync, badCode);
    expect(await linkError(b.sync)).toContain('That pairing code doesn’t look right.');
    expect(await isLinkPreviewOpen(b.sync)).toBe(false);
  }

  expect(syncStub.calls()).toEqual([]);
  await b.sync.reload();
  await openSyncSettings(b.sync);
  expect(await revealPairingCode(b.sync)).toBe(ownCodeOfB);
});

test('a tampered blob on the server is rejected and never adopted', async ({ syncStub, openSyncBrowser }) => {
  const a = await openSyncBrowser();
  const b = await openSyncBrowser();
  await seedSyncProfile(a.sync, ALPHA);
  await seedSyncProfile(b.sync, BETA);
  await openSyncSettings(a.sync);
  expect(await syncNow(a.sync)).toBe(SYNCED);
  const code = await revealPairingCode(a.sync);
  const token = await expectedAuthToken(code);

  const stored = syncStub.blob(token);
  expect(stored).toBeDefined();
  // Byte 20 is inside the ciphertext (after the 1-byte version and 12-byte IV).
  const tampered = Buffer.from(stored!);
  tampered[20] = tampered[20]! ^ 0x01;
  syncStub.setBlob(token, tampered);

  await openSyncSettings(b.sync);
  const ownCodeOfB = await revealPairingCode(b.sync);
  const toast = await withNewToast(b.sync, () => submitPairingCode(b.sync, code));
  expect(toast).toBe('Something went wrong while syncing. Try again later.');
  expect(await isLinkPreviewOpen(b.sync)).toBe(false);

  expect(syncStub.syncCalls('GET').map((call) => [call.status, call.token])).toEqual([[404, token], [200, token]]);
  expect(syncStub.syncCalls('PUT')).toHaveLength(1);
  expect(syncStub.blob(token)?.equals(tampered)).toBe(true);
  expect((await readWorkspaces(b.sync)).map((ws) => ws.name)).toEqual([BETA.workspaceName]);
  await b.sync.reload();
  await openSyncSettings(b.sync);
  expect(await revealPairingCode(b.sync)).toBe(ownCodeOfB);
});

test('a push over the server size cap surfaces as payload too large', async ({ syncStub, openSyncBrowser }) => {
  const a = await openSyncBrowser();
  // A wallpaper just over the server's 5 MB cap makes the encrypted bundle too large.
  await seedSyncProfile(a.sync, {
    ...ALPHA,
    workspace: { ...ALPHA.workspace, backgroundMode: 'wallpaper' },
    wallpaperDataUrl: `data:image/png;base64,${'A'.repeat(5 * 1024 * 1024 + 64 * 1024)}`,
  });

  await openSyncSettings(a.sync);
  expect(await syncNow(a.sync)).toBe('Your synced data is too large for the server to accept.');
  expect(syncStub.syncCalls().map((call) => [call.method, call.status])).toEqual([['GET', 404], ['PUT', 413]]);
  expect(syncStub.syncCalls('PUT')[0]!.body.byteLength).toBeGreaterThan(5 * 1024 * 1024);
  expect(await lastSyncedCaption(a.sync)).toBe(NEVER_SYNCED);
});

test('a dropped connection surfaces as a network error', async ({ syncStub, openSyncBrowser }) => {
  const a = await openSyncBrowser();
  await seedSyncProfile(a.sync, ALPHA);
  syncStub.injectFault({ method: 'GET', drop: true });

  await openSyncSettings(a.sync);
  expect(await syncNow(a.sync)).toBe('Can’t reach the sync server. Check your connection and try again.');
  expect(syncStub.syncCalls().map((call) => [call.method, call.status])).toEqual([['GET', 0]]);
  expect(await lastSyncedCaption(a.sync)).toBe(NEVER_SYNCED);
});

test('a rate-limited pull surfaces as rate limited and pushes nothing', async ({ syncStub, openSyncBrowser }) => {
  const a = await openSyncBrowser();
  await seedSyncProfile(a.sync, ALPHA);
  syncStub.injectFault({ method: 'GET', status: 429 });

  await openSyncSettings(a.sync);
  expect(await syncNow(a.sync)).toBe('Too many sync attempts — try again in a bit.');
  expect(syncStub.syncCalls().map((call) => [call.method, call.status])).toEqual([['GET', 429]]);
  expect(await lastSyncedCaption(a.sync)).toBe(NEVER_SYNCED);
});
