import type { BookmarkNode } from '@/shared/messages';
import { findParentFolder } from './tree';

/**
 * Deletion-time capture of a node's full subtree — title/url/children, in
 * order — with browser ids dropped. Delete removes structure, not just
 * position, so (unlike a move) undo has to recreate every descendant from
 * scratch rather than reattach an existing node. `children` is left
 * `undefined` for a bookmark (never an empty array) so a restored leaf can't
 * be mistaken for an empty folder.
 */
export interface SubtreeSnapshot {
  title: string;
  url?: string;
  children?: SubtreeSnapshot[];
}

/** Recursively capture a node (bookmark or folder) as a {@link SubtreeSnapshot}. */
export function captureSubtree(node: BookmarkNode): SubtreeSnapshot {
  return {
    title: node.title,
    url: node.url,
    children: node.children?.map(captureSubtree),
  };
}

/**
 * Pre-delete position + contents of a single top-level deleted item. `index`
 * is the item's slot in its parent's raw (storage-order) children — undo
 * recreates it at {parentId, index} so it lands back where it was.
 */
export interface DeleteSnapshot {
  parentId: string;
  index: number;
  subtree: SubtreeSnapshot;
}

/**
 * Capture each id's origin (parent + index) and full subtree from the tree
 * BEFORE deleting it. Ids whose parent can't be resolved are skipped — there's
 * nothing to restore them to. Order follows `ids` so undo replays in the same
 * sequence as the delete.
 */
export function captureDeleteSnapshots(tree: BookmarkNode[], ids: string[]): DeleteSnapshot[] {
  const snapshots: DeleteSnapshot[] = [];
  for (const id of ids) {
    const parent = findParentFolder(tree, id);
    if (!parent) continue;
    const index = parent.children?.findIndex(c => c.id === id) ?? -1;
    if (index < 0) continue;
    const node = parent.children![index];
    snapshots.push({ parentId: parent.id, index, subtree: captureSubtree(node) });
  }
  return snapshots;
}

type CreateBookmark = (parentId: string, title: string, url?: string, index?: number) => Promise<BookmarkNode>;

/**
 * Reverse a delete by recreating a captured subtree depth-first: the node
 * itself first (at the captured parent + index), then each child in original
 * order into the newly created node's id. The creator is injected (the
 * `createBookmark` messaging wrapper) so this module stays free of the
 * WebExtension shim and remains unit-testable.
 */
export async function restoreSubtree(
  snapshot: SubtreeSnapshot,
  parentId: string,
  index: number,
  create: CreateBookmark,
): Promise<BookmarkNode> {
  const node = await create(parentId, snapshot.title, snapshot.url, index);
  if (snapshot.children) {
    for (let i = 0; i < snapshot.children.length; i++) {
      await restoreSubtree(snapshot.children[i], node.id, i, create);
    }
  }
  return node;
}

/**
 * Reverse a batch delete by restoring each captured snapshot to its own
 * origin. Snapshots are captured in selection order (click order), which can
 * be spatially out of order — replaying them as-captured would insert a
 * higher index first and shift it out from under a still-pending lower-index
 * sibling. Replay ascending by `index` instead (stable, so ties and
 * different-parent snapshots keep their capture order) so each insertion's
 * index is still valid for the ones that follow. Throws on the first failed
 * restore so callers can surface an error toast.
 */
export async function restoreDeleteSnapshots(
  snapshots: DeleteSnapshot[],
  create: CreateBookmark,
): Promise<void> {
  const ordered = [...snapshots].sort((a, b) => a.index - b.index);
  for (const snap of ordered) {
    await restoreSubtree(snap.subtree, snap.parentId, snap.index, create);
  }
}
