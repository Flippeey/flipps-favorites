// Pure logic for the folder-icon orphan sweep. Kept separate from icon-service.ts
// (which does the actual IDB reads/writes) so this diff logic is unit-testable
// without a browser/IDB environment.
import type { BookmarkNode } from '@/shared/messages';

/** Every folder id in the tree (nodes with a `children` array), including nested folders. */
export function collectAllFolderIds(nodes: BookmarkNode[]): Set<string> {
  const ids = new Set<string>();
  const visit = (node: BookmarkNode): void => {
    if (Array.isArray(node.children)) {
      ids.add(node.id);
      for (const child of node.children) visit(child);
    }
  };
  for (const node of nodes) visit(node);
  return ids;
}

/** Stored folder-icon record ids that no longer correspond to a live folder. */
export function computeOrphanFolderIconIds(storedFolderIds: string[], liveFolderIds: ReadonlySet<string>): string[] {
  return storedFolderIds.filter(id => !liveFolderIds.has(id));
}
