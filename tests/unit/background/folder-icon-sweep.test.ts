/**
 * Folder custom icons are stored in IDB keyed by folder id, independent of the
 * bookmark tree. If a folder is deleted through a path that doesn't call
 * removeFolderIcon (a future code path, another sync peer, browser-native
 * deletion), its icon record would leak forever. The startup sweep diffs
 * stored folder-icon ids against the live tree and removes orphans.
 *
 * This tests the pure diff logic only (no IDB/browser environment needed) —
 * see .claude/testing.md: unit tests cover pure logic, IDB itself isn't
 * testable in Node.
 */
import { describe, expect, it } from 'vitest';
import type { BookmarkNode } from '@/shared/models';
import { collectAllFolderIds, computeOrphanFolderIconIds } from '@/background/icons/folder-icon-sweep';

function folder(id: string, children: BookmarkNode[] = []): BookmarkNode {
  return { id, title: `Folder ${id}`, children };
}

function bookmark(id: string): BookmarkNode {
  return { id, title: `Bookmark ${id}`, url: 'https://example.com' };
}

describe('collectAllFolderIds', () => {
  it('collects only folder ids (nodes with a children array), not bookmarks', () => {
    const tree = [folder('root', [folder('a'), bookmark('b')])];
    const ids = collectAllFolderIds(tree);
    expect(ids).toEqual(new Set(['root', 'a']));
  });

  it('recurses into nested folders arbitrarily deep', () => {
    const tree = [folder('root', [folder('a', [folder('a1', [folder('a1a')])])])];
    const ids = collectAllFolderIds(tree);
    expect(ids).toEqual(new Set(['root', 'a', 'a1', 'a1a']));
  });

  it('empty tree yields empty set', () => {
    expect(collectAllFolderIds([])).toEqual(new Set());
  });

  it('a folder with no children still counts as a folder (empty array, not bookmark)', () => {
    const tree = [folder('empty-folder')];
    expect(collectAllFolderIds(tree)).toEqual(new Set(['empty-folder']));
  });
});

describe('computeOrphanFolderIconIds', () => {
  it('returns stored ids that are not in the live set — the leak this sweep fixes', () => {
    const orphans = computeOrphanFolderIconIds(['a', 'b', 'c'], new Set(['a', 'c']));
    expect(orphans).toEqual(['b']);
  });

  it('returns empty when every stored id still has a live folder', () => {
    const orphans = computeOrphanFolderIconIds(['a', 'b'], new Set(['a', 'b', 'c']));
    expect(orphans).toEqual([]);
  });

  it('returns empty for an empty stored list (no-op sweep)', () => {
    expect(computeOrphanFolderIconIds([], new Set(['a']))).toEqual([]);
  });

  it('every stored id orphaned when the live set is empty (all folders deleted)', () => {
    expect(computeOrphanFolderIconIds(['a', 'b'], new Set())).toEqual(['a', 'b']);
  });
});
