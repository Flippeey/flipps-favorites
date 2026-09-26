import type { WorkspaceRecord } from '@/shared/messages';

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
