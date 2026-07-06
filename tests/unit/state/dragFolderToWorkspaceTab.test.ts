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
 * Strategy: we test the production routing function directly (imported from
 * useDragWiring, not a local mirror) so these tests and the implementation
 * can never silently diverge. The Playwright spec covers the integrated path
 * end-to-end.
 */
import { describe, expect, it, vi } from 'vitest';
import { MAX_WORKSPACES } from '@/shared/constants';
import type { BookmarkNode, WorkspaceRecord } from '@/shared/messages';

// useDragWiring imports lib/messaging.ts, which throws at module-eval time
// outside a real extension context (no browser/chrome runtime in Vitest).
// Stub it so importing routeFolderTabDrop doesn't pull in that side effect —
// none of these tests exercise moveBookmark.
vi.mock('@/newtab/lib/messaging', () => ({ moveBookmark: vi.fn() }));

import { routeFolderTabDrop } from '@/newtab/interaction/useDragWiring';

// ---------------------------------------------------------------------------
// Tree fixtures — production isFolder() checks Array.isArray(node.children),
// so a folder node needs a `children` array (empty is fine) and a bookmark
// node must omit `children` entirely.
// ---------------------------------------------------------------------------

const folder = (id: string): BookmarkNode => ({ id, title: id, children: [] });
const bookmark = (id: string): BookmarkNode => ({ id, title: id, url: 'https://example.com' });

const makeWorkspaces = (count: number): Pick<WorkspaceRecord, 'rootFolderId'>[] =>
  Array.from({ length: count }, (_, i) => ({ rootFolderId: `folder-${i}` }));

describe('routeFolderTabDrop — workspace creation routing', () => {
  it('routes to "create" when a single new folder is dropped at below-cap count', () => {
    const tree = [folder('f1')];
    const result = routeFolderTabDrop(['f1'], tree, makeWorkspaces(1), 'workspace-new');
    expect(result).toBe('create');
  });

  it('routes to "move" when the dragged item is a bookmark (has url)', () => {
    const tree = [bookmark('bm1')];
    const result = routeFolderTabDrop(['bm1'], tree, makeWorkspaces(1), 'workspace-new');
    expect(result).toBe('move');
  });

  it('routes to "move" when multiple items are dragged (even if first is a folder)', () => {
    const tree = [folder('f1'), bookmark('bm1')];
    const result = routeFolderTabDrop(['f1', 'bm1'], tree, makeWorkspaces(1), 'workspace-new');
    expect(result).toBe('move');
  });

  it('routes to "move" when multiple folders are dragged', () => {
    const tree = [folder('f1'), folder('f2')];
    const result = routeFolderTabDrop(['f1', 'f2'], tree, makeWorkspaces(1), 'workspace-new');
    expect(result).toBe('move');
  });

  it('routes to "skip" at MAX_WORKSPACES cap', () => {
    const tree = [folder('f1')];
    const result = routeFolderTabDrop(['f1'], tree, makeWorkspaces(MAX_WORKSPACES), 'workspace-new');
    expect(result).toBe('skip');
  });

  it('routes to "skip" at exactly one below MAX_WORKSPACES, then "create" one below that', () => {
    const tree = [folder('f1')];
    // At MAX_WORKSPACES - 1: should still create (cap not yet reached)
    const atAlmostCap = routeFolderTabDrop(['f1'], tree, makeWorkspaces(MAX_WORKSPACES - 1), 'workspace-new');
    expect(atAlmostCap).toBe('create');
    // At MAX_WORKSPACES: should skip
    const atCap = routeFolderTabDrop(['f1'], tree, makeWorkspaces(MAX_WORKSPACES), 'workspace-new');
    expect(atCap).toBe('skip');
  });

  it('routes to "skip" when the folder is already a workspace root', () => {
    const tree = [folder('taken')];
    const workspaces = [{ rootFolderId: 'taken' }];
    const result = routeFolderTabDrop(['taken'], tree, workspaces, 'workspace-new');
    expect(result).toBe('skip');
  });

  it('routes to "move" when the node is not found in the tree', () => {
    const tree: BookmarkNode[] = [];
    const result = routeFolderTabDrop(['unknown'], tree, makeWorkspaces(1), 'workspace-new');
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
    const tree = [folder('f1')];
    const result = routeFolderTabDrop(['f1'], tree, makeWorkspaces(1), 'workspace');
    expect(result).toBe('move');
  });

  it('routes a single folder dropped in the bar GAP to "create"', () => {
    // WHY: gap drops (no pill ancestor) are the intended trigger for workspace creation.
    const tree = [folder('f1')];
    const result = routeFolderTabDrop(['f1'], tree, makeWorkspaces(1), 'workspace-new');
    expect(result).toBe('create');
  });

  it('routes a bookmark dropped ON an existing pill to "move" (pill always moves)', () => {
    const tree = [bookmark('bm1')];
    const result = routeFolderTabDrop(['bm1'], tree, makeWorkspaces(1), 'workspace');
    expect(result).toBe('move');
  });

  it('routes a bookmark dropped in the bar GAP to "move" (non-folder gap drop = move)', () => {
    const tree = [bookmark('bm1')];
    const result = routeFolderTabDrop(['bm1'], tree, makeWorkspaces(1), 'workspace-new');
    expect(result).toBe('move');
  });

  it('routes multiple folders dropped ON a pill to "move"', () => {
    const tree = [folder('f1'), folder('f2')];
    const result = routeFolderTabDrop(['f1', 'f2'], tree, makeWorkspaces(1), 'workspace');
    expect(result).toBe('move');
  });

  it('routes multiple folders dropped in bar gap to "move" (multi-item gap = move)', () => {
    const tree = [folder('f1'), folder('f2')];
    const result = routeFolderTabDrop(['f1', 'f2'], tree, makeWorkspaces(1), 'workspace-new');
    expect(result).toBe('move');
  });
});
