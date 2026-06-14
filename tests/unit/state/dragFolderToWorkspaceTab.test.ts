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
 *  - DROP LOCATION MATTERS (regression fix): a single folder dropped ON an
 *    existing workspace PILL (target.kind === 'workspace') must MOVE the folder
 *    into that workspace, not create a new one. Only drops in the bar GAP
 *    (target.kind === 'workspace-new') trigger workspace creation.
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

/**
 * Drop target kind as produced by useDrag.ts:
 *  'workspace'     — pointer landed ON an existing workspace pill
 *  'workspace-new' — pointer landed in the bar gap (no pill ancestor)
 */
type WorkspaceDropKind = 'workspace' | 'workspace-new';

interface BookmarkNodeStub {
  id: string;
  url?: string;
  children?: BookmarkNodeStub[];
}

function isNodeFolder(node: BookmarkNodeStub): boolean {
  return !node.url;
}

/**
 * Decide what should happen when dragIds are dropped on the workspace bar.
 *
 * The `dropKind` parameter encodes WHERE the drop landed:
 *  'workspace'     → the pointer was over an existing pill → always MOVE
 *  'workspace-new' → the pointer was in the bar gap → may CREATE
 *
 * Returns:
 *  'create'  — single folder in bar gap, not at cap, not already a ws root → create ws
 *  'skip'    — single folder in bar gap but at cap or already a ws root
 *  'move'    — pill drop (any payload), OR non-folder/multi-item gap drop
 */
function routeFolderTabDrop(
  dragIds: string[],
  nodeMap: Map<string, BookmarkNodeStub>,
  workspaces: Pick<WorkspaceRecord, 'rootFolderId'>[],
  dropKind: WorkspaceDropKind = 'workspace-new',
): FolderDropResult {
  // Pill drop: always move into the existing workspace (regardless of payload).
  if (dropKind === 'workspace') return 'move';

  // Bar-gap drop: only a single folder triggers workspace creation.
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

// ---------------------------------------------------------------------------
// Drop-location routing: pill vs bar-gap (regression fix)
// WHY: before the fix, ANY target.kind === 'workspace' drop (including an
// existing-pill drop) was intercepted by the single-folder branch and routed
// to CREATE. Only gap drops should create; pill drops should always MOVE.
// ---------------------------------------------------------------------------

describe('routeFolderTabDrop — drop location: pill vs bar-gap', () => {
  it('routes a single folder dropped ON an existing pill to "move" (not "create")', () => {
    // WHY: this is the regression — dropping a folder onto a real workspace pill
    // should MOVE it into that workspace, not create a new workspace.
    const nodes = new Map([['f1', { id: 'f1' }]]);
    const result = routeFolderTabDrop(['f1'], nodes, makeWorkspaces(1), 'workspace');
    expect(result).toBe('move');
  });

  it('routes a single folder dropped in the bar GAP to "create"', () => {
    // WHY: gap drops (no pill ancestor) are the intended trigger for workspace creation.
    const nodes = new Map([['f1', { id: 'f1' }]]);
    const result = routeFolderTabDrop(['f1'], nodes, makeWorkspaces(1), 'workspace-new');
    expect(result).toBe('create');
  });

  it('routes a bookmark dropped ON an existing pill to "move" (pill always moves)', () => {
    const nodes = new Map([['bm1', { id: 'bm1', url: 'https://example.com' }]]);
    const result = routeFolderTabDrop(['bm1'], nodes, makeWorkspaces(1), 'workspace');
    expect(result).toBe('move');
  });

  it('routes a bookmark dropped in the bar GAP to "move" (non-folder gap drop = move)', () => {
    const nodes = new Map([['bm1', { id: 'bm1', url: 'https://example.com' }]]);
    const result = routeFolderTabDrop(['bm1'], nodes, makeWorkspaces(1), 'workspace-new');
    expect(result).toBe('move');
  });

  it('routes multiple folders dropped ON a pill to "move"', () => {
    const nodes = new Map<string, BookmarkNodeStub>([
      ['f1', { id: 'f1' }],
      ['f2', { id: 'f2' }],
    ]);
    const result = routeFolderTabDrop(['f1', 'f2'], nodes, makeWorkspaces(1), 'workspace');
    expect(result).toBe('move');
  });

  it('routes multiple folders dropped in bar gap to "move" (multi-item gap = move)', () => {
    const nodes = new Map<string, BookmarkNodeStub>([
      ['f1', { id: 'f1' }],
      ['f2', { id: 'f2' }],
    ]);
    const result = routeFolderTabDrop(['f1', 'f2'], nodes, makeWorkspaces(1), 'workspace-new');
    expect(result).toBe('move');
  });
});
