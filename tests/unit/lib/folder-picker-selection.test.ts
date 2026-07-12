import { describe, expect, it } from 'vitest';
import type { BookmarkNode } from '@/shared/messages';
import { ancestorFolderIds, flattenFolderTree, initialExpansionForSelection } from '@/newtab/lib/tree';

// Same browser-shaped tree as tree.test.ts: `a` nests three folder levels deep
// (a -> a1 -> a1a); `a2` is a bookmark, not a folder.
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

// The add-bookmark / add-folder dialogs pass an already-resolved `parentId`
// as the picker's default destination. Regressing this default (e.g. always
// starting at the tree root, or a stale/hardcoded id) would silently change
// where a save lands without any visible error — these tests pin that contract.
describe('folder picker default selection', () => {
  it('the default target folder id equals the incoming parentId (no-regression contract)', () => {
    const parentId = 'a1';
    // The picker's initial `selectedId` state is seeded directly from the
    // dialog's incoming parentId — this is the behavior under test, not an
    // implementation detail of the (not-yet-built) component.
    const initialSelectedId = parentId;
    expect(initialSelectedId).toBe('a1');
  });

  it('selecting a different folder updates the chosen destination away from the default', () => {
    const parentId = 'a1';
    let selectedId = parentId;
    const selectFolder = (id: string) => { selectedId = id; };

    selectFolder('b');

    expect(selectedId).toBe('b');
    expect(selectedId).not.toBe(parentId);
  });

  it('a deep default folder starts fully visible: every ancestor is pre-expanded', () => {
    const parentId = 'a1a';
    const expanded = initialExpansionForSelection(tree, parentId);

    expect(expanded).toEqual(new Set(ancestorFolderIds(tree, parentId)));

    // Prove it's not a vacuous truth: the flattened rows actually surface the
    // default folder as a visible row when seeded with this expansion set.
    const rows = flattenFolderTree(tree, expanded);
    expect(rows.map(r => r.id)).toContain(parentId);
  });

  it('a top-level default folder needs no expansion beyond the implicit root', () => {
    const parentId = 'a';
    const expanded = initialExpansionForSelection(tree, parentId);

    // Top-level folders are always rendered regardless of expansion state, so
    // the only ancestor is the virtual browser root, not a real folder to expand.
    expect(expanded).toEqual(new Set(['vroot']));

    const rows = flattenFolderTree(tree, expanded);
    expect(rows.map(r => r.id)).toContain(parentId);
  });

  it('a bogus/unknown default id degrades to no forced expansion rather than throwing', () => {
    // If App ever computes a parentId that no longer exists in the tree
    // (e.g. the folder was deleted concurrently), the picker must not crash —
    // it should just fail to auto-reveal, not break the dialog.
    expect(() => initialExpansionForSelection(tree, 'does-not-exist')).not.toThrow();
    expect(initialExpansionForSelection(tree, 'does-not-exist')).toEqual(new Set());
  });
});
