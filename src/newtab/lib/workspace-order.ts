/**
 * The workspace tab strip's ordering rule: `order` (settings.workspaceOrder)
 * lists ids front-to-back; any workspace not present in `order` (new, or the
 * order hasn't caught up yet) is appended after, in whatever order the
 * storage layer returned it. A stale id in `order` that no longer names a
 * live workspace is simply dropped — callers never need to prune `order`
 * themselves for this to stay correct.
 */
export function orderWorkspaces<T extends { id: string }>(workspaces: T[], order: string[] | undefined): T[] {
  if (!order || order.length === 0) return workspaces;
  const byId = new Map(workspaces.map(w => [w.id, w]));
  const sorted = order.map(id => byId.get(id)).filter((w): w is T => w != null);
  const inOrder = new Set(order);
  const rest = workspaces.filter(w => !inOrder.has(w.id));
  return [...sorted, ...rest];
}

/** The id of the first workspace in tab order, or undefined when there are none. */
export function firstOrderedWorkspaceId<T extends { id: string }>(workspaces: T[], order: string[] | undefined): string | undefined {
  return orderWorkspaces(workspaces, order)[0]?.id;
}
