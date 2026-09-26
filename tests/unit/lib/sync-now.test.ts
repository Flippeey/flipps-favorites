import { describe, expect, it, vi } from 'vitest';
import { SyncFetchError } from '@/shared/messages';

// sync-now.ts orchestrates the "Sync now" button (BackupSection) and the
// "Link another browser" adopt flow: pull remote -> validate -> plan + apply
// the merge -> push the planner's merged set. All collaborators are mocked
// here: this test proves the ORCHESTRATION order and error propagation, not
// the crypto/network/merge internals (sync-client.test.ts, sync-merge.test.ts
// and workspace-transfer.test.ts cover those).

const mockSyncPull = vi.fn();
const mockSyncPush = vi.fn();
const mockApplyWorkspaceImport = vi.fn();
const mockNormalize = vi.fn((payload: unknown) => payload);
const mockWriteLastSyncedAt = vi.fn();

vi.mock('@/newtab/lib/messaging', () => ({
  syncPull: (...args: unknown[]) => mockSyncPull(...args),
  syncPush: (...args: unknown[]) => mockSyncPush(...args),
}));

vi.mock('@/shared/storage', () => ({
  writeLastSyncedAt: (...args: unknown[]) => mockWriteLastSyncedAt(...args),
}));

vi.mock('@/newtab/lib/workspace-transfer', () => ({
  WORKSPACE_SCHEMA: 'flipps-workspace-transfer',
  WORKSPACE_SCHEMA_VERSION: 5,
  applyWorkspaceImport: (...args: unknown[]) => mockApplyWorkspaceImport(...args),
  normalizeWorkspaceExportPayload: (payload: unknown) => mockNormalize(payload),
}));

async function importSyncNow(): Promise<typeof import('@/newtab/lib/sync-now')> {
  vi.resetModules();
  return import('@/newtab/lib/sync-now');
}

const FAKE_SETTINGS = { theme: 'system' } as unknown as import('@/shared/messages').AppSettings;
const FAKE_REMOTE = { schema: 'flipps-workspace-transfer', schemaVersion: 5, workspaces: [] } as unknown;
const FAKE_MERGED = { schema: 'flipps-workspace-transfer', schemaVersion: 5, workspaces: [{ id: 'merged' }] } as unknown;

function resetMocks(): void {
  mockSyncPull.mockReset();
  mockSyncPush.mockReset().mockResolvedValue(undefined);
  mockApplyWorkspaceImport.mockReset().mockResolvedValue({ mode: 'merge', settings: FAKE_SETTINGS, merged: FAKE_MERGED });
  mockNormalize.mockReset().mockImplementation((payload: unknown) => payload);
  mockWriteLastSyncedAt.mockReset().mockResolvedValue(undefined);
}

describe('runSyncNow', () => {
  it('first-ever sync: pull returns null (404) -> merges an empty copy and pushes the merged set', async () => {
    resetMocks();
    mockSyncPull.mockResolvedValue(null);

    const mod = await importSyncNow();
    const result = await mod.runSyncNow();

    // An empty copy runs through the same planner, so local markers are pruned
    // and the pushed set has the same shape as every other push.
    expect(mockApplyWorkspaceImport).toHaveBeenCalledWith(
      expect.objectContaining({ workspaces: [], deletions: [] }), 'merge', 'sync',
    );
    expect(mockSyncPush).toHaveBeenCalledWith(FAKE_MERGED);
    expect(result).toEqual({ merged: false });
    expect(mockWriteLastSyncedAt).toHaveBeenCalledTimes(1);
  });

  it('pull returns a payload -> merges it and pushes the merged set, not a fresh local read', async () => {
    resetMocks();
    mockSyncPull.mockResolvedValue(FAKE_REMOTE);

    const mod = await importSyncNow();
    const result = await mod.runSyncNow();

    expect(mockWriteLastSyncedAt).toHaveBeenCalledTimes(1);
    expect(mockApplyWorkspaceImport).toHaveBeenCalledWith(FAKE_REMOTE, 'merge', 'sync');
    // Pushing the planner's merged set keeps items this browser could not
    // hold (cap-skipped workspaces, markers) in the shared copy.
    expect(mockSyncPush).toHaveBeenCalledWith(FAKE_MERGED);
    expect(result).toEqual({ merged: true, settings: FAKE_SETTINGS });
  });

  it('a payload from a newer version is rejected before anything is applied or pushed', async () => {
    resetMocks();
    mockSyncPull.mockResolvedValue({ ...(FAKE_REMOTE as object), schemaVersion: 6 });
    mockNormalize.mockImplementation(() => { throw new Error('newer version'); });

    const mod = await importSyncNow();

    await expect(mod.runSyncNow()).rejects.toThrow('newer version');
    expect(mockApplyWorkspaceImport).not.toHaveBeenCalled();
    expect(mockSyncPush).not.toHaveBeenCalled();
    expect(mockWriteLastSyncedAt).not.toHaveBeenCalled();
  });

  it('propagates a SyncFetchError from pull without pushing', async () => {
    resetMocks();
    mockSyncPull.mockRejectedValue(new SyncFetchError('network', 'offline'));

    const mod = await importSyncNow();

    await expect(mod.runSyncNow()).rejects.toMatchObject({ kind: 'network' });
    expect(mockSyncPush).not.toHaveBeenCalled();
  });

  it('propagates a SyncFetchError from push after a successful merge', async () => {
    resetMocks();
    mockSyncPull.mockResolvedValue(null);
    mockSyncPush.mockRejectedValue(new SyncFetchError('rate-limited', 'slow down'));

    const mod = await importSyncNow();

    await expect(mod.runSyncNow()).rejects.toMatchObject({ kind: 'rate-limited' });
    // A failed push must NOT stamp "Last synced" — the caption would claim
    // success the user never got.
    expect(mockWriteLastSyncedAt).not.toHaveBeenCalled();
  });

  it("completeLinkFromPreview applies the in-memory payload in the chosen mode WITHOUT pulling again", async () => {
    resetMocks();

    const mod = await importSyncNow();
    const payload = FAKE_REMOTE as Parameters<typeof mod.completeLinkFromPreview>[0];
    const result = await mod.completeLinkFromPreview(payload, 'replace');

    // The payload was pulled ONCE for the dialog; confirming must reuse it,
    // and the link form's Merge/Replace choice must reach the import layer.
    expect(mockSyncPull).not.toHaveBeenCalled();
    expect(mockApplyWorkspaceImport).toHaveBeenCalledWith(FAKE_REMOTE, 'replace', 'sync');
    expect(mockSyncPush).toHaveBeenCalledWith(FAKE_MERGED);
    expect(mockWriteLastSyncedAt).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ merged: true, settings: FAKE_SETTINGS });
  });

  it('completeLinkFromPreview with an empty namespace (null payload) merges nothing in and pushes local state', async () => {
    resetMocks();

    const mod = await importSyncNow();
    const result = await mod.completeLinkFromPreview(null, 'replace');

    expect(mockSyncPull).not.toHaveBeenCalled();
    // Replace against an empty copy would wipe this browser; it merges instead.
    expect(mockApplyWorkspaceImport).toHaveBeenCalledWith(expect.objectContaining({ workspaces: [] }), 'merge', 'sync');
    expect(mockSyncPush).toHaveBeenCalledWith(FAKE_MERGED);
    expect(result).toEqual({ merged: false });
  });

  it('a failed timestamp write does not fail an otherwise-successful sync', async () => {
    resetMocks();
    mockSyncPull.mockResolvedValue(null);
    mockWriteLastSyncedAt.mockRejectedValue(new Error('storage quota'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const mod = await importSyncNow();
      await expect(mod.runSyncNow()).resolves.toEqual({ merged: false });
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
