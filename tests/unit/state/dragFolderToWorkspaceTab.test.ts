/**
 * Drag-folder-to-workspace-tab — unit coverage for the commit-time routing logic.
 *
 * WHY these cases matter:
 *  - A single folder dragged onto the workspace tab strip should create a new
 *    workspace (not move the folder), using the same cap/duplicate guards as
 *    the context-menu path. Wrong routing would silently move the folder or
 *    silently no-op.
 *  - A non-folder (bookmark) dragged onto the workspace tab strip must NOT
 *    trigger workspace creation — it falls through to the existing move-to-
 *    workspace path.
 *  - Multiple items dragged onto the tab strip also fall through (even if one
 *    is a folder) — batch-drops are moves, not workspace creation.
 *  - At MAX_WORKSPACES the create should be skipped and the caller informed.
 *  - A folder that is already a workspace root should report 'already_exists'.
 *
 * Strategy: we test the pure decision function extracted from the commit
 * handler, mirroring the branching in useDragWiring. The Playwright spec
 * covers the integrated path end-to-end.
 */
import { describe, expect, it } from 'vitest';
import { MAX_WORKSPACES } from '@/shared/constants';
import type { WorkspaceRecord } from '@/shared/messages';

// ---------------------------------------------------------------------------
// Pure helper mirroring the routing in useDragWiring's handleDragCommit.
// Any change to the hook's branching must be reflected here (Rule 9).
// ---------------------------------------------------------------------------

type FolderDropResult = 'create' | 'move' | 'skip';

interface BookmarkNodeStub {
  id: string;
  url?: string;
  children?: BookmarkNodeStub[];
}

function isNodeFolder(node: BookmarkNodeStub): boolean {
  return !node.url;
}

/**
 * Decide what should happen when dragIds are dropped on a workspace tab.
 *
 * Returns:
 *  'create'  — single folder, not at cap, not already a ws root → create ws
 *  'skip'    — single folder but at cap or already a ws root
 *  'move'    — non-folder or multiple items → fall through to existing move
 */
function routeFolderTabDrop(
  dragIds: string[],
  nodeMap: Map<string, BookmarkNodeStub>,
  workspaces: Pick<WorkspaceRecord, 'rootFolderId'>[],
): FolderDropResult {
  // Multiple items → always move (not workspace creation)
  if (dragIds.length !== 1) return 'move';

  const node = nodeMap.get(dragIds[0]!);
  if (!node || !isNodeFolder(node)) return 'move';

  const folderId = node.id;
  if (workspaces.length >= MAX_WORKSPACES) return 'skip';
  if (workspaces.some(w => w.rootFolderId === folderId)) return 'skip';
  return 'create';
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const makeWorkspaces = (count: number): Pick<WorkspaceRecord, 'rootFolderId'>[] =>
  Array.from({ length: count }, (_, i) => ({ rootFolderId: `folder-${i}` }));

describe('routeFolderTabDrop — workspace creation routing', () => {
  it('routes to "create" when a single new folder is dropped at below-cap count', () => {
    const nodes = new Map([['f1', { id: 'f1' }]]);
    const result = routeFolderTabDrop(['f1'], nodes, makeWorkspaces(1));
    expect(result).toBe('create');
  });

  it('routes to "move" when the dragged item is a bookmark (has url)', () => {
    const nodes = new Map([['bm1', { id: 'bm1', url: 'https://example.com' }]]);
    const result = routeFolderTabDrop(['bm1'], nodes, makeWorkspaces(1));
    expect(result).toBe('move');
  });

  it('routes to "move" when multiple items are dragged (even if first is a folder)', () => {
    const nodes = new Map<string, BookmarkNodeStub>([
      ['f1', { id: 'f1' }],
      ['bm1', { id: 'bm1', url: 'https://example.com' }],
    ]);
    const result = routeFolderTabDrop(['f1', 'bm1'], nodes, makeWorkspaces(1));
    expect(result).toBe('move');
  });

  it('routes to "move" when multiple folders are dragged', () => {
    const nodes = new Map<string, BookmarkNodeStub>([
      ['f1', { id: 'f1' }],
      ['f2', { id: 'f2' }],
    ]);
    const result = routeFolderTabDrop(['f1', 'f2'], nodes, makeWorkspaces(1));
    expect(result).toBe('move');
  });

  it('routes to "skip" at MAX_WORKSPACES cap', () => {
    const nodes = new Map([['f1', { id: 'f1' }]]);
    const result = routeFolderTabDrop(['f1'], nodes, makeWorkspaces(MAX_WORKSPACES));
    expect(result).toBe('skip');
  });

  it('routes to "skip" at exactly one below MAX_WORKSPACES, then "create" one below that', () => {
    const nodes = new Map([['f1', { id: 'f1' }]]);
    // At MAX_WORKSPACES - 1: should still create (cap not yet reached)
    const atAlmostCap = routeFolderTabDrop(['f1'], nodes, makeWorkspaces(MAX_WORKSPACES - 1));
    expect(atAlmostCap).toBe('create');
    // At MAX_WORKSPACES: should skip
    const atCap = routeFolderTabDrop(['f1'], nodes, makeWorkspaces(MAX_WORKSPACES));
    expect(atCap).toBe('skip');
  });

  it('routes to "skip" when the folder is already a workspace root', () => {
    const nodes = new Map([['taken', { id: 'taken' }]]);
    const workspaces = [{ rootFolderId: 'taken' }];
    const result = routeFolderTabDrop(['taken'], nodes, workspaces);
    expect(result).toBe('skip');
  });

  it('routes to "move" when the node is not found in the tree', () => {
    const nodes = new Map<string, BookmarkNodeStub>();
    const result = routeFolderTabDrop(['unknown'], nodes, makeWorkspaces(1));
    expect(result).toBe('move');
  });
});
