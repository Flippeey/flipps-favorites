import { describe, expect, it } from 'vitest';
import type { BookmarkNode } from '@/shared/messages';
import { captureMoveSnapshots } from '@/newtab/lib/move-snapshot';

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
