import type { BookmarkNode } from '@/shared/messages';

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

export function findParentFolder(nodes: BookmarkNode[], childId: string): BookmarkNode | null {
  for (const n of nodes) {
    if (!n.children) continue;
    if (n.children.some(c => c.id === childId)) return n;
    const r = findParentFolder(n.children, childId);
    if (r) return r;
  }
  return null;
}

export interface DescendantCount {
  bookmarks: number;
  folders: number;
}

export function countDescendants(folder: BookmarkNode): DescendantCount {
  let bookmarks = 0;
  let folders = 0;
  const visit = (node: BookmarkNode): void => {
    for (const child of node.children ?? []) {
      if (Array.isArray(child.children)) {
        folders += 1;
        visit(child);
      } else {
        bookmarks += 1;
      }
    }
  };
  visit(folder);
  return { bookmarks, folders };
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

export interface FolderRow {
  id: string;
  title: string;
  depth: number;
  hasChildren: boolean;
}

// Flattens the folder tree into an ordered list of visible rows for the folder
// picker. A folder's children are only emitted when its id is in `expandedIds`,
// and recursion stops at `maxDepth` so deeply-nested trees stay bounded.
export function flattenFolderTree(
  tree: BookmarkNode[],
  expandedIds: ReadonlySet<string>,
  maxDepth = 8,
): FolderRow[] {
  const rows: FolderRow[] = [];
  const childFolders = (node: BookmarkNode): BookmarkNode[] =>
    (node.children ?? []).filter(c => Array.isArray(c.children));
  const walk = (folder: BookmarkNode, depth: number): void => {
    const subFolders = childFolders(folder);
    rows.push({ id: folder.id, title: folder.title, depth, hasChildren: subFolders.length > 0 });
    if (depth >= maxDepth || !expandedIds.has(folder.id)) return;
    for (const sub of subFolders) walk(sub, depth + 1);
  };
  for (const top of topLevelFolders(tree)) walk(top, 0);
  return rows;
}

// Folder ids of every ancestor of `id`, nearest first. Used to auto-expand the
// path to an already-selected folder so a deep selection is visible on mount.
export function ancestorFolderIds(tree: BookmarkNode[], id: string): string[] {
  const ids: string[] = [];
  let parent = findParentFolder(tree, id);
  while (parent) {
    ids.push(parent.id);
    parent = findParentFolder(tree, parent.id);
  }
  return ids;
}

// The set of folder ids that must start expanded so `folderId` is visible
// without the user drilling down manually. Used to seed a single-select
// folder picker's initial expansion state from its default target folder.
export function initialExpansionForSelection(tree: BookmarkNode[], folderId: string): Set<string> {
  return new Set(ancestorFolderIds(tree, folderId));
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
  usage: Record<string, number> = {},
): BookmarkNode[] {
  if (mode === 'manual') return children;
  const arr = children.slice();
  arr.sort((a, b) => {
    let cmp = 0;
    if (mode === 'name') {
      cmp = a.title.localeCompare(b.title);
    } else if (mode === 'created') {
      cmp = (a.dateAdded ?? 0) - (b.dateAdded ?? 0);
    } else if (mode === 'lastUsed') {
      cmp = (usage[a.id] ?? 0) - (usage[b.id] ?? 0);
    }
    return direction === 'desc' ? -cmp : cmp;
  });
  return arr;
}
