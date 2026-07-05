import type { AppSettings } from '@/shared/messages';
import { syncPull, syncPush } from '@/newtab/lib/messaging';
import {
  applyWorkspaceImport,
  buildWorkspaceExport,
  normalizeWorkspaceExportPayload,
} from '@/newtab/lib/workspace-transfer';

export type SyncNowResult =
  | { merged: false }
  | { merged: true; settings: AppSettings };

// Orchestrates "Sync now" (BackupSection) and the post-adopt convergence step
// of "Link another browser": pull remote -> if present, validate its shape and
// merge it into local storage (record-level newest-updatedAt-wins, never
// clobbers a newer local edit) -> (re)build the local export -> push it.
// Pull-before-push, and rebuilding the export AFTER the merge, is what lets
// two devices converge instead of one clobbering the other.
//
// A pull that finds nothing (server has no data yet for this pairing) is NOT
// an error — it's just the first sync, so we skip straight to push.
export async function runSyncNow(): Promise<SyncNowResult> {
  const remote = await syncPull();

  if (remote === null) {
    const bundle = await buildWorkspaceExport();
    await syncPush(bundle);
    return { merged: false };
  }

  const payload = normalizeWorkspaceExportPayload(remote);
  const summary = await applyWorkspaceImport(payload, 'merge');

  const bundle = await buildWorkspaceExport();
  await syncPush(bundle);

  return { merged: true, settings: summary.settings };
}
