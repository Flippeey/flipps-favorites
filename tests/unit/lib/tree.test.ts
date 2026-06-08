import { describe, expect, it } from 'vitest';
import type { BookmarkNode } from '@/shared/messages';
import { ancestorFolderIds, flattenFolderTree } from '@/newtab/lib/tree';

// Browser-shaped tree: an outer root whose children are the user folders.
// `a` nests three folder levels deep (a → a1 → a1a); `a2` is a bookmark, not a folder.
const tree: BookmarkNode[] = [
  {
    id: 'vroot', title: 'root', children: [
      {
        id: 'a', title: 'A', children: [
          {
            id: 'a1', title: 'A1', children: [
              { id: 'a1a', title: 'A1A', children: [] },
            ],
          },
          { id: 'a2', title: 'A2', url: 'https://example.com' },
        ],
      },
      { id: 'b', title: 'B', children: [] },
    ],
  },
];

describe('flattenFolderTree', () => {
  it('shows only top-level folders when nothing is expanded', () => {
    const rows = flattenFolderTree(tree, new Set());
    expect(rows.map(r => r.id)).toEqual(['a', 'b']);
    // `a` has a child folder; `b` does not — drives whether a chevron renders.
    expect(rows.find(r => r.id === 'a')?.hasChildren).toBe(true);
    expect(rows.find(r => r.id === 'b')?.hasChildren).toBe(false);
  });

  it('reveals children of expanded folders in depth order', () => {
    const rows = flattenFolderTree(tree, new Set(['a', 'a1']));
    expect(rows.map(r => [r.id, r.depth])).toEqual([
      ['a', 0],
      ['a1', 1],
      ['a1a', 2],
      ['b', 0],
    ]);
  });

  it('excludes bookmarks, only folders become rows', () => {
    const rows = flattenFolderTree(tree, new Set(['a']));
    expect(rows.map(r => r.id)).not.toContain('a2');
  });

  it('stops descending at maxDepth even when deeper folders are expanded', () => {
    const rows = flattenFolderTree(tree, new Set(['a', 'a1']), 1);
    // a1 (depth 1) is shown but its children are never walked past the cap.
    expect(rows.map(r => r.id)).toEqual(['a', 'a1', 'b']);
  });
});

describe('ancestorFolderIds', () => {
  it('returns ancestors nearest-first for a deep folder', () => {
    expect(ancestorFolderIds(tree, 'a1a')).toEqual(['a1', 'a', 'vroot']);
  });

  it('returns empty for a top-level folder with no folder ancestor below root', () => {
    expect(ancestorFolderIds(tree, 'a')).toEqual(['vroot']);
  });
});
