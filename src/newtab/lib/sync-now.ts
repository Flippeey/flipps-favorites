import type { AppSettings } from '@/shared/messages';
import { applyWorkspaceImport, syncPull, syncPush } from '@/newtab/lib/messaging';
import { writeLastSyncedAt } from '@/shared/storage';
import {
  normalizeWorkspaceExportPayload,
  WORKSPACE_SCHEMA,
  WORKSPACE_SCHEMA_VERSION,
  type ParsedWorkspaceImport,
  type WorkspaceImportMode,
} from '@/newtab/lib/workspace-transfer';

export type SyncNowResult =
  | { merged: false }
  | { merged: true; settings: AppSettings };

// Orchestrates "Sync now" (BackupSection): pull the shared copy, merge it
// into local storage (newest wins per item and per setting; deletion markers
// remove items deleted elsewhere), then push the planner's merged set — not a
// fresh read of local storage, so items this browser can't hold (workspaces
// over the cap) and markers stay in the shared copy. Pull-before-push is what
// lets devices converge: a copy lost to a later PUT is merged back from the
// browser that still holds it on its next sync.
//
// A pull that finds nothing (server has no data yet for this pairing, or the
// namespace expired) is not an error: local state becomes the shared copy.
// A payload from a newer extension version is rejected before anything is
// pushed or written.
export async function runSyncNow(): Promise<SyncNowResult> {
  const remote = await syncPull();
  const payload = remote === null ? emptyPayload() : normalizeWorkspaceExportPayload(remote);
  const summary = await applyWorkspaceImport(payload, 'merge', 'sync');
  await syncPush(summary.merged);
  await recordSyncCompleted();
  return remote === null ? { merged: false } : { merged: true, settings: summary.settings };
}

// Finishes "Link another browser" AFTER the user confirmed the preview
// dialog. The remote payload was already pulled once (previewPull) and is
// passed in from memory — this function must NOT pull again: one GET + one
// PUT per link, both for R2 request economy and so the user applies exactly
// the data they previewed. `payload` is null when the preview found an empty
// namespace (the other browser never pushed): local state becomes the shared
// copy. Replace mirrors the other browser's copy: local-only workspaces are
// removed, as the preview listed.
export async function completeLinkFromPreview(
  payload: ParsedWorkspaceImport | null,
  mode: WorkspaceImportMode,
): Promise<SyncNowResult> {
  const summary = await applyWorkspaceImport(payload ?? emptyPayload(), payload === null ? 'merge' : mode, 'sync');
  await syncPush(summary.merged);
  await recordSyncCompleted();
  return payload === null ? { merged: false } : { merged: true, settings: summary.settings };
}

function emptyPayload(): ParsedWorkspaceImport {
  return {
    schema: WORKSPACE_SCHEMA,
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    exportedAt: Date.now(),
    settings: {},
    settingsUpdatedAt: {},
    workspaces: [],
    workspaceWallpapers: {},
    iconOverrides: [],
    folderIcons: [],
    bookmarkUsage: [],
    deletions: [],
    skipped: { oversizedDataUrlCount: 0 },
  };
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
