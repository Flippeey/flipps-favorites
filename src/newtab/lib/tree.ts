import type { BookmarkNode } from '../../shared/messages';

export function findNode(nodes: BookmarkNode[], id: string): BookmarkNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const r = findNode(n.children, id);
      if (r) return r;
    }
  }
  return null;
}

export function findFolder(nodes: BookmarkNode[], id: string): BookmarkNode | null {
  const found = findNode(nodes, id);
  if (found && Array.isArray(found.children)) return found;
  return null;
}

export function isFolder(node: BookmarkNode): boolean {
  return Array.isArray(node.children);
}

export function topLevelFolders(tree: BookmarkNode[]): BookmarkNode[] {
  // tree from browser comes as root with virtual roots; flatten to first user folders
  const out: BookmarkNode[] = [];
  for (const n of tree) {
    if (!n.children) continue;
    for (const c of n.children) {
      if (Array.isArray(c.children)) out.push(c);
    }
  }
  return out;
}

export function rootFolderChildren(tree: BookmarkNode[], rootId: string): BookmarkNode[] {
  if (rootId) {
    const folder = findFolder(tree, rootId);
    if (folder) return folder.children ?? [];
  }
  // Default: pick the bookmarks-bar-like first folder
  const top = topLevelFolders(tree);
  return top.length > 0 ? (top[0].children ?? []) : [];
}

export function resolveRootFolder(tree: BookmarkNode[], rootId: string): BookmarkNode | null {
  if (rootId) {
    const folder = findFolder(tree, rootId);
    if (folder) return folder;
  }
  const top = topLevelFolders(tree);
  return top[0] ?? null;
}

export function sortChildren(
  children: BookmarkNode[],
  mode: 'manual' | 'name' | 'lastUsed' | 'created',
  direction: 'asc' | 'desc',
): BookmarkNode[] {
  if (mode === 'manual') return children;
  const arr = children.slice();
  arr.sort((a, b) => {
    let cmp = 0;
    if (mode === 'name') {
      cmp = a.title.localeCompare(b.title);
    } else if (mode === 'created') {
      cmp = (a.dateAdded ?? 0) - (b.dateAdded ?? 0);
    }
    return direction === 'desc' ? -cmp : cmp;
  });
  return arr;
}
