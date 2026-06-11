import type { BookmarkNode } from '@/shared/messages';
import { findParentFolder } from './tree';

/**
 * Pre-move position of a single item, captured from the live tree so a relocate
 * can be reversed one-for-one. `index` is the item's slot in its parent's raw
 * (storage-order) children — moving it back to {parentId, index} restores both
 * its container and its position. Folders carry their subtree automatically.
 */
export interface MoveSnapshot {
  id: string;
  parentId: string;
  index: number;
}

/**
 * Capture each id's origin (parent + index) from the tree BEFORE relocating it.
 * Ids whose parent can't be resolved are skipped — there's nothing to restore
 * them to. Order follows `ids` so undo replays in the same sequence as the move.
 */
export function captureMoveSnapshots(tree: BookmarkNode[], ids: string[]): MoveSnapshot[] {
  const snapshots: MoveSnapshot[] = [];
  for (const id of ids) {
    const parent = findParentFolder(tree, id);
    if (!parent) continue;
    const index = parent.children?.findIndex(c => c.id === id) ?? -1;
    if (index < 0) continue;
    snapshots.push({ id, parentId: parent.id, index });
  }
  return snapshots;
}

/**
 * Reverse a relocate by moving each item back to its captured origin. Replays in
 * capture order so multi-item moves land back in their original relative slots.
 * Throws on the first failed move so callers can surface an error toast. The
 * mover is injected (the `moveBookmark` messaging wrapper) so this module stays
 * free of the WebExtension shim and remains unit-testable.
 */
export async function restoreMoveSnapshots(
  snapshots: MoveSnapshot[],
  move: (id: string, parentId: string, index: number) => Promise<unknown>,
): Promise<void> {
  for (const snap of snapshots) {
    await move(snap.id, snap.parentId, snap.index);
  }
}
