import type { WorkspaceView } from '@/shared/messages';
import { MAX_WORKSPACES } from '@/shared/constants';

/**
 * The workspace tab strip's ordering rule: `order` (settings.workspaceOrder)
 * lists ids front-to-back; any workspace not present in `order` (new, or the
 * order hasn't caught up yet) is appended after, in whatever order the
 * storage layer returned it. A stale id in `order` that no longer names a
 * live workspace is simply dropped, and a repeated id counts once — callers
 * never need to prune `order` themselves for this to stay correct.
 */
export function orderWorkspaces<T extends { id: string }>(workspaces: T[], order: string[] | undefined): T[] {
  if (!order || order.length === 0) return workspaces;
  const byId = new Map(workspaces.map(w => [w.id, w]));
  const inOrder = new Set(order);
  const sorted = [...inOrder].map(id => byId.get(id)).filter((w): w is T => w != null);
  const rest = workspaces.filter(w => !inOrder.has(w.id));
  return [...sorted, ...rest];
}

/** The id of the first workspace in tab order, or undefined when there are none. */
export function firstOrderedWorkspaceId<T extends { id: string }>(workspaces: T[], order: string[] | undefined): string | undefined {
  return orderWorkspaces(workspaces, order)[0]?.id;
}

// The active workspace is per-browser; when it is gone (deleted here or by a
// sync) the first workspace in tab order takes over.
export function resolveActiveWorkspace<T extends { id: string }>(
  workspaces: T[],
  order: string[] | undefined,
  activeId: string,
): T | null {
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
