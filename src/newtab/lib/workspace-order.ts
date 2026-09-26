import type { WorkspaceRecord, WorkspaceView } from '@/shared/messages';
import { MAX_WORKSPACES } from '@/shared/constants';

// Workspaces in tab order: the stored order first (ids that no longer exist
// are skipped), then any workspace the order doesn't list yet.
export function orderWorkspaces(workspaces: WorkspaceRecord[], order: string[] | undefined): WorkspaceRecord[] {
  if (!order || order.length === 0) return workspaces;
  const byId = new Map(workspaces.map(w => [w.id, w]));
  const listed = new Set(order);
  const sorted = [...new Set(order)].map(id => byId.get(id)).filter((w): w is WorkspaceRecord => w !== undefined);
  return [...sorted, ...workspaces.filter(w => !listed.has(w.id))];
}

// The active workspace is per-browser; when it is gone (deleted here or by a
// sync) the first workspace in tab order takes over.
export function resolveActiveWorkspace(
  workspaces: WorkspaceRecord[],
  order: string[] | undefined,
  activeId: string,
): WorkspaceRecord | null {
  return workspaces.find(w => w.id === activeId) ?? orderWorkspaces(workspaces, order)[0] ?? null;
}

// Waiting and unused workspaces have no folder in this browser: they stay out
// of tabs, search, shortcuts, Move to and the boot choice.
export function shownWorkspaces<T extends WorkspaceView>(workspaces: T[]): T[] {
  return workspaces.filter(w => w.folderState !== 'waiting' && w.folderState !== 'unused');
}

// Hidden workspaces still count toward the limit, so the message says so.
export function workspaceLimitMessage(workspaces: WorkspaceView[]): string {
  const hidden = workspaces.length - shownWorkspaces(workspaces).length;
  return hidden > 0
    ? `Workspace limit reached (${String(MAX_WORKSPACES)}, including ${String(hidden)} waiting for bookmarks)`
    : `Workspace limit reached (${String(MAX_WORKSPACES)})`;
}
