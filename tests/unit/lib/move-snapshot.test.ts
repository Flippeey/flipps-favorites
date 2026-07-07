import { describe, expect, it } from 'vitest';
import type { BookmarkNode } from '@/shared/messages';
import { captureMoveSnapshots, moveIdsTracked } from '@/newtab/lib/move-snapshot';

// Browser-shaped tree: outer root → user folders. `dock` holds two bookmarks;
// `work` holds one folder (`sub`) and one bookmark. Mirrors how the live tree
// looks when a relocate is about to run.
const tree: BookmarkNode[] = [
  {
    id: 'vroot', title: 'root', children: [
      {
        id: 'dock', title: 'Dock', children: [
          { id: 'bm-a', title: 'A', url: 'https://a.test' },
          { id: 'bm-b', title: 'B', url: 'https://b.test' },
        ],
      },
      {
        id: 'work', title: 'Work', children: [
          { id: 'sub', title: 'Sub', children: [] },
          { id: 'bm-c', title: 'C', url: 'https://c.test' },
        ],
      },
    ],
  },
];

describe('captureMoveSnapshots', () => {
  // WHY: Undo restores each item to its exact origin. The snapshot must record
  // the real parent and the item's index within that parent — getting either
  // wrong means Undo silently lands the item in the wrong place or position.
  it('captures parent id and index for each moved id', () => {
    expect(captureMoveSnapshots(tree, ['bm-b', 'bm-c'])).toEqual([
      { id: 'bm-b', parentId: 'dock', index: 1 },
      { id: 'bm-c', parentId: 'work', index: 1 },
    ]);
  });

  // WHY: folders are relocatable too (drag a folder into another folder). The
  // snapshot must treat a folder like any other child so its undo works.
  it('captures folders the same as bookmarks', () => {
    expect(captureMoveSnapshots(tree, ['sub'])).toEqual([
      { id: 'sub', parentId: 'work', index: 0 },
    ]);
  });

  // WHY: undo replays in the order it was given (the move order), so multi-item
  // moves land back in their original relative slots rather than reversed.
  it('preserves the order of the requested ids', () => {
    const snaps = captureMoveSnapshots(tree, ['bm-c', 'bm-a']);
    expect(snaps.map(s => s.id)).toEqual(['bm-c', 'bm-a']);
  });

  // WHY: an id with no resolvable parent (e.g. a root or a stale id) has nothing
  // to restore to — including it would make undo throw and surface a false error.
  it('skips ids whose parent cannot be resolved', () => {
    expect(captureMoveSnapshots(tree, ['missing', 'bm-a'])).toEqual([
      { id: 'bm-a', parentId: 'dock', index: 0 },
    ]);
  });
});

describe('moveIdsTracked', () => {
  // WHY: "Move to..." moves several ids in one user action. If the browser
  // rejects one move mid-batch (e.g. a stale id), the caller must still know
  // exactly which ids landed so it can select/undo only those — not the whole
  // requested batch, which would let the toast/undo lie about what happened.
  it('reports only the ids that actually moved as movedIds', async () => {
    const moved: string[] = [];
    const move = async (id: string): Promise<void> => {
      if (id === 'bm-b') throw new Error('simulated failure');
      moved.push(id);
    };
    const result = await moveIdsTracked(tree, ['bm-a', 'bm-b', 'bm-c'], 'work', move);
    expect(result.movedIds).toEqual(['bm-a', 'bm-c']);
    expect(result.failedIds).toEqual(['bm-b']);
    expect(moved).toEqual(['bm-a', 'bm-c']);
  });

  // WHY: Undo must only replay origins for ids that actually relocated —
  // replaying a snapshot for an id that never moved would be a no-op at best
  // and could throw at worst (the failed move already reports empty state).
  it('scopes the returned snapshots to only the successfully moved ids', async () => {
    const move = async (id: string): Promise<void> => {
      if (id === 'bm-c') throw new Error('simulated failure');
    };
    const result = await moveIdsTracked(tree, ['bm-b', 'bm-c'], 'work', move);
    expect(result.snapshots).toEqual([{ id: 'bm-b', parentId: 'dock', index: 1 }]);
  });

  // WHY: the common case — every move succeeds — must still work end to end,
  // preserving request order in both movedIds and snapshots.
  it('moves every id and returns all snapshots when nothing fails', async () => {
    const calls: Array<{ id: string; parentId: string }> = [];
    const move = async (id: string, parentId: string): Promise<void> => {
      calls.push({ id, parentId });
    };
    const result = await moveIdsTracked(tree, ['bm-a', 'bm-b'], 'work', move);
    expect(result.movedIds).toEqual(['bm-a', 'bm-b']);
    expect(result.failedIds).toEqual([]);
    expect(result.snapshots).toEqual([
      { id: 'bm-a', parentId: 'dock', index: 0 },
      { id: 'bm-b', parentId: 'dock', index: 1 },
    ]);
    expect(calls).toEqual([
      { id: 'bm-a', parentId: 'work' },
      { id: 'bm-b', parentId: 'work' },
    ]);
  });
});
