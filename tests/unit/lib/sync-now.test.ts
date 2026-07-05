import { describe, expect, it, vi } from 'vitest';
import { SyncFetchError } from '@/shared/messages';

// sync-now.ts orchestrates the "Sync now" button (BackupSection) and the
// "Link another browser" adopt flow: pull remote -> (if present) validate +
// merge -> export local -> push. Pull-before-push lets two devices converge
// via applyWorkspaceImport's record-level newest-updatedAt-wins merge, so a
// sync never clobbers a newer local edit. All collaborators are mocked here:
// this test proves the ORCHESTRATION order and error propagation, not the
// crypto/network/merge internals (those are covered by sync-client.test.ts
// and workspace-transfer.test.ts respectively).

const mockSyncPull = vi.fn();
const mockSyncPush = vi.fn();
const mockApplyWorkspaceImport = vi.fn();
const mockBuildWorkspaceExport = vi.fn();

vi.mock('@/newtab/lib/messaging', () => ({
  syncPull: (...args: unknown[]) => mockSyncPull(...args),
  syncPush: (...args: unknown[]) => mockSyncPush(...args),
}));

vi.mock('@/newtab/lib/workspace-transfer', () => ({
  applyWorkspaceImport: (...args: unknown[]) => mockApplyWorkspaceImport(...args),
  buildWorkspaceExport: (...args: unknown[]) => mockBuildWorkspaceExport(...args),
  normalizeWorkspaceExportPayload: vi.fn((payload: unknown) => payload),
}));

async function importSyncNow(): Promise<typeof import('@/newtab/lib/sync-now')> {
  vi.resetModules();
  return import('@/newtab/lib/sync-now');
}

const FAKE_SETTINGS = { theme: 'system' } as unknown as import('@/shared/messages').AppSettings;
const FAKE_EXPORT = { schema: 'flipps-workspace-transfer', schemaVersion: 3, workspaces: [] } as unknown;

describe('runSyncNow', () => {
  it('first-ever sync: pull returns null (404) -> skips merge and just pushes the local export', async () => {
    mockSyncPull.mockReset().mockResolvedValue(null);
    mockSyncPush.mockReset().mockResolvedValue(undefined);
    mockApplyWorkspaceImport.mockReset();
    mockBuildWorkspaceExport.mockReset().mockResolvedValue(FAKE_EXPORT);

    const mod = await importSyncNow();
    const result = await mod.runSyncNow();

    expect(mockApplyWorkspaceImport).not.toHaveBeenCalled();
    expect(mockBuildWorkspaceExport).toHaveBeenCalledTimes(1);
    expect(mockSyncPush).toHaveBeenCalledWith(FAKE_EXPORT);
    expect(result).toEqual({ merged: false });
  });

  it('pull returns a payload -> merges it in before building + pushing the export', async () => {
    mockSyncPull.mockReset().mockResolvedValue(FAKE_EXPORT);
    mockSyncPush.mockReset().mockResolvedValue(undefined);
    mockApplyWorkspaceImport.mockReset().mockResolvedValue({
      mode: 'merge', workspaceCount: 1, iconOverrideCount: 0, bookmarkUsageCount: 0, settings: FAKE_SETTINGS,
    });
    mockBuildWorkspaceExport.mockReset().mockResolvedValue(FAKE_EXPORT);

    const mod = await importSyncNow();
    const result = await mod.runSyncNow();

    expect(mockApplyWorkspaceImport).toHaveBeenCalledWith(FAKE_EXPORT, 'merge');
    // Export must be rebuilt AFTER the merge so the pushed bundle reflects the
    // merged state, not the pre-merge local state.
    expect(mockBuildWorkspaceExport).toHaveBeenCalledTimes(1);
    expect(mockSyncPush).toHaveBeenCalledWith(FAKE_EXPORT);
    expect(result).toEqual({ merged: true, settings: FAKE_SETTINGS });
  });

  it('propagates a SyncFetchError from pull without pushing', async () => {
    mockSyncPull.mockReset().mockRejectedValue(new SyncFetchError('network', 'offline'));
    mockSyncPush.mockReset();
    mockBuildWorkspaceExport.mockReset();

    const mod = await importSyncNow();

    await expect(mod.runSyncNow()).rejects.toMatchObject({ kind: 'network' });
    expect(mockSyncPush).not.toHaveBeenCalled();
  });

  it('propagates a SyncFetchError from push after a successful merge', async () => {
    mockSyncPull.mockReset().mockResolvedValue(null);
    mockBuildWorkspaceExport.mockReset().mockResolvedValue(FAKE_EXPORT);
    mockSyncPush.mockReset().mockRejectedValue(new SyncFetchError('rate-limited', 'slow down'));

    const mod = await importSyncNow();

    await expect(mod.runSyncNow()).rejects.toMatchObject({ kind: 'rate-limited' });
  });
});
