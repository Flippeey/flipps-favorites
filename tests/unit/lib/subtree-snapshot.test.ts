import { describe, expect, it, vi } from 'vitest';
import type { BookmarkNode } from '@/shared/messages';
import {
  captureDeleteSnapshots,
  captureSubtree,
  restoreDeleteSnapshots,
  restoreSubtree,
} from '@/newtab/lib/subtree-snapshot';

// Browser-shaped tree: outer root -> user folders. `work` holds a nested folder
// (`sub`, itself containing one bookmark) and a bookmark. Mirrors the live tree
// shape right before a folder/batch delete runs.
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
          {
            id: 'sub', title: 'Sub', children: [
              { id: 'bm-d', title: 'D', url: 'https://d.test' },
            ],
          },
          { id: 'bm-c', title: 'C', url: 'https://c.test' },
        ],
      },
    ],
  },
];

describe('captureSubtree', () => {
  // WHY: folder delete must be reversible with the exact contents it had —
  // capturing only the folder's own title/url would silently drop everything
  // inside it on undo.
  it('recursively captures title/url/children, dropping browser ids', () => {
    const work = tree[0].children![1];
    expect(captureSubtree(work)).toEqual({
      title: 'Work',
      url: undefined,
      children: [
        {
          title: 'Sub',
          url: undefined,
          children: [{ title: 'D', url: 'https://d.test', children: undefined }],
        },
        { title: 'C', url: 'https://c.test', children: undefined },
      ],
    });
  });

  // WHY: a plain bookmark has no children — the snapshot must not invent an
  // empty children array (that would make it look like an empty folder on undo).
  it('captures a leaf bookmark with no children field', () => {
    const bm = tree[0].children![0].children![0];
    expect(captureSubtree(bm)).toEqual({ title: 'A', url: 'https://a.test', children: undefined });
  });
});

describe('captureDeleteSnapshots', () => {
  // WHY: undo must recreate each deleted item in its original parent + slot.
  // Order must follow the requested ids so a batch undo replays predictably.
  it('captures parent id, index, and subtree for each requested id', () => {
    const snaps = captureDeleteSnapshots(tree, ['bm-b', 'work']);
    expect(snaps).toHaveLength(2);
    expect(snaps[0]).toEqual({ parentId: 'dock', index: 1, subtree: { title: 'B', url: 'https://b.test', children: undefined } });
    expect(snaps[1].parentId).toBe('vroot');
    expect(snaps[1].index).toBe(1);
    expect(snaps[1].subtree.title).toBe('Work');
    expect(snaps[1].subtree.children).toHaveLength(2);
  });

  // WHY: an id with no resolvable parent has nothing to restore to — including
  // it would make undo throw and surface a false "couldn't restore" error.
  it('skips ids whose parent cannot be resolved', () => {
    expect(captureDeleteSnapshots(tree, ['missing', 'bm-a'])).toEqual([
      { parentId: 'dock', index: 0, subtree: { title: 'A', url: 'https://a.test', children: undefined } },
    ]);
  });
});

describe('restoreSubtree', () => {
  // WHY: undoing a folder delete must recreate the whole structure depth-first,
  // preserving sibling order — otherwise the "restored" folder is scrambled.
  it('recreates a folder and its descendants in order, wiring child parentIds', async () => {
    const created: Array<{ parentId: string; title: string; url?: string; index?: number }> = [];
    let nextId = 0;
    const create = vi.fn(async (parentId: string, title: string, url?: string, index?: number) => {
      created.push({ parentId, title, url, index });
      const id = `new-${nextId++}`;
      return { id, title, url, children: url ? undefined : [] } as BookmarkNode;
    });

    const subtree = captureSubtree(tree[0].children![1]); // Work
    const result = await restoreSubtree(subtree, 'vroot', 1, create);

    expect(result.title).toBe('Work');
    // Folder itself created first, at the captured parent + index.
    expect(created[0]).toEqual({ parentId: 'vroot', title: 'Work', url: undefined, index: 1 });
    // Children created into the new folder's id, in original order.
    expect(created[1]).toEqual({ parentId: 'new-0', title: 'Sub', url: undefined, index: 0 });
    expect(created[2]).toEqual({ parentId: 'new-1', title: 'D', url: 'https://d.test', index: 0 });
    expect(created[3]).toEqual({ parentId: 'new-0', title: 'C', url: 'https://c.test', index: 1 });
  });
});

describe('restoreDeleteSnapshots', () => {
  // WHY: batch undo must replay every captured item, mixed bookmarks and
  // folders alike, back to their own origin — not just the first one.
  it('restores every snapshot to its own parent + index', async () => {
    const create = vi.fn(async (parentId: string, title: string, url?: string) => ({
      id: 'x', title, url, children: url ? undefined : [],
    } as BookmarkNode));

    const snaps = captureDeleteSnapshots(tree, ['bm-b', 'bm-c']);
    await restoreDeleteSnapshots(snaps, create);

    expect(create).toHaveBeenCalledWith('dock', 'B', 'https://b.test', 1);
    expect(create).toHaveBeenCalledWith('work', 'C', 'https://c.test', 1);
  });

  // WHY: snapshots are captured in selection (click) order, not spatial order.
  // Replaying a higher index before a lower one in the same parent would
  // insert-shift the lower slot out from under the still-pending restore.
  // Replay must go ascending by index regardless of capture order.
  it('replays snapshots ascending by index within a shared parent, not capture order', async () => {
    const callOrder: Array<{ index: number }> = [];
    const create = vi.fn(async (parentId: string, title: string, url?: string, index?: number) => {
      callOrder.push({ index: index! });
      return { id: 'x', title, url, children: url ? undefined : [] } as BookmarkNode;
    });

    // Captured out of spatial order: index 1 (bm-b) captured before index 0 (bm-a).
    const snaps = captureDeleteSnapshots(tree, ['bm-b', 'bm-a']);
    expect(snaps.map(s => s.index)).toEqual([1, 0]);

    await restoreDeleteSnapshots(snaps, create);

    expect(callOrder.map(c => c.index)).toEqual([0, 1]);
  });
});
