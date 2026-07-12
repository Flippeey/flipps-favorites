import type { AppSettings } from '@/shared/messages';
import { syncPull, syncPush } from '@/newtab/lib/messaging';
import { writeLastSyncedAt } from '@/shared/storage';
import {
  applyWorkspaceImport,
  buildWorkspaceExport,
  normalizeWorkspaceExportPayload,
  type ParsedWorkspaceImport,
  type WorkspaceImportMode,
} from '@/newtab/lib/workspace-transfer';

export type SyncNowResult =
  | { merged: false }
  | { merged: true; settings: AppSettings };

// Orchestrates "Sync now" (BackupSection) and the post-adopt convergence step
// of "Link another browser": pull remote -> if present, validate its shape and
// merge it into local storage (record-level: the pulled record wins on id/key
// collision, records only present locally survive — merge never deletes)
// -> (re)build the local export -> push it.
// Pull-before-push, and rebuilding the export AFTER the merge, is what lets
// two devices converge instead of one clobbering the other.
//
// A pull that finds nothing (server has no data yet for this pairing) is NOT
// an error — it's just the first sync, so we skip straight to push.
//
// `mode` is how the pulled payload is applied locally: the Sync now button
// always merges; the link-another-browser flow lets the user pick Replace to
// adopt the other browser's settings/icon overrides (workspaces are still
// merged by id — replace never deletes them, see applyWorkspaceImport).
export async function runSyncNow(mode: WorkspaceImportMode = 'merge'): Promise<SyncNowResult> {
  const remote = await syncPull();

  if (remote === null) {
    const bundle = await buildWorkspaceExport();
    await syncPush(bundle);
    await recordSyncCompleted();
    return { merged: false };
  }

  const payload = normalizeWorkspaceExportPayload(remote);
  const summary = await applyWorkspaceImport(payload, mode);

  const bundle = await buildWorkspaceExport();
  await syncPush(bundle);
  await recordSyncCompleted();

  return { merged: true, settings: summary.settings };
}

// Finishes "Link another browser" AFTER the user confirmed the preview
// dialog. The remote payload was already pulled once (previewPull) and is
// passed in from memory — this function must NOT pull again: one GET + one
// PUT per link, both for R2 request economy and so the user applies exactly
// the data they previewed. `payload` is null when the preview found an empty
// namespace (the other browser never pushed): nothing to apply, the local
// state just becomes the shared copy.
export async function completeLinkFromPreview(
  payload: ParsedWorkspaceImport | null,
  mode: WorkspaceImportMode,
): Promise<SyncNowResult> {
  if (payload === null) {
    const bundle = await buildWorkspaceExport();
    await syncPush(bundle);
    await recordSyncCompleted();
    return { merged: false };
  }

  const summary = await applyWorkspaceImport(payload, mode);
  const bundle = await buildWorkspaceExport();
  await syncPush(bundle);
  await recordSyncCompleted();

  return { merged: true, settings: summary.settings };
}

// The "Last synced …" caption is cosmetic — a failed timestamp write must not
// turn an otherwise-successful sync into an error.
async function recordSyncCompleted(): Promise<void> {
  try {
    await writeLastSyncedAt(Date.now());
  } catch (error) {
    console.warn('Sync succeeded but its timestamp could not be persisted.', error);
  }
}
