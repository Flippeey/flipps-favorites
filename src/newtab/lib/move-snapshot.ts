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

/** Result of a tracked multi-id relocate: who moved, who didn't, and their origins. */
export interface MoveOutcome {
  /** Ids that relocated successfully, in request order. */
  movedIds: string[];
  /** Ids whose move call threw, in request order. */
  failedIds: string[];
  /** Origin snapshots for movedIds only — safe to hand straight to restoreMoveSnapshots. */
  snapshots: MoveSnapshot[];
}

/**
 * Relocate each id to `targetParentId`, moving sequentially and tracking each
 * id's outcome individually. A mid-batch failure (e.g. a stale id the browser
 * rejects) must not corrupt the Undo/toast story for the ids that DID move —
 * so movedIds/snapshots only ever cover ids whose move call actually resolved.
 */
export async function moveIdsTracked(
  tree: BookmarkNode[],
  ids: string[],
  targetParentId: string,
  move: (id: string, parentId: string) => Promise<unknown>,
): Promise<MoveOutcome> {
  const snapshotById = new Map(captureMoveSnapshots(tree, ids).map(s => [s.id, s]));
  const movedIds: string[] = [];
  const failedIds: string[] = [];
  for (const id of ids) {
    try {
      await move(id, targetParentId);
      movedIds.push(id);
    } catch {
      failedIds.push(id);
    }
  }
  const snapshots = movedIds
    .map(id => snapshotById.get(id))
    .filter((s): s is MoveSnapshot => s != null);
  return { movedIds, failedIds, snapshots };
}
