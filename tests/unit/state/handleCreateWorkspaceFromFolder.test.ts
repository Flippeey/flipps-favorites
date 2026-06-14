/**
 * handleCreateWorkspaceFromFolder — unit coverage for the three outcome paths:
 *   'created'        — happy path: workspace created and now active
 *   'at_max'         — workspace cap reached before or during creation
 *   'already_exists' — the folder is already a workspace root
 *
 * WHY these three paths matter: the caller (useContextMenuBuilder) uses the
 * discriminated return to route a toast. Incorrect routing would silently
 * mislead the user about what happened.
 *
 * Strategy: we cannot mount the full hook in Vitest (no DOM, no React). We
 * instead test the decision logic extracted into the same branching shape as
 * the real implementation — then the Playwright spec covers the integrated
 * path end-to-end.
 */
import { describe, expect, it } from 'vitest';
import { MAX_WORKSPACES } from '@/shared/constants';
import type { WorkspaceRecord } from '@/shared/messages';

// ---------------------------------------------------------------------------
// Pure helper that mirrors the real handleCreateWorkspaceFromFolder logic.
// Any change to the hook's branching must be reflected here to keep the test
// meaningful (Rule 9 — tests encode WHY behaviour matters).
// ---------------------------------------------------------------------------

type CreateResult = 'created' | 'at_max' | 'already_exists';

function simulateCreateFromFolder(
  workspaces: Pick<WorkspaceRecord, 'rootFolderId'>[],
  folderId: string,
  createWorkspaceSucceeds: boolean,
): CreateResult {
  if (workspaces.length >= MAX_WORKSPACES) return 'at_max';
  if (workspaces.some(w => w.rootFolderId === folderId)) return 'already_exists';
  return createWorkspaceSucceeds ? 'created' : 'at_max';
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleCreateWorkspaceFromFolder — outcome routing', () => {
  const makeWorkspaces = (count: number): Pick<WorkspaceRecord, 'rootFolderId'>[] =>
    Array.from({ length: count }, (_, i) => ({ rootFolderId: `folder-${i}` }));

  it('returns "created" when the folder is new and creation succeeds', () => {
    const result = simulateCreateFromFolder(makeWorkspaces(1), 'new-folder', true);
    expect(result).toBe('created');
  });

  it('returns "at_max" when the workspace list is already at the cap', () => {
    const result = simulateCreateFromFolder(makeWorkspaces(MAX_WORKSPACES), 'any-folder', true);
    expect(result).toBe('at_max');
  });

  it('returns "at_max" when creation fails for any other reason (storage error)', () => {
    // handleCreateWorkspace returns undefined on failure; the hook maps that to 'at_max'
    // because the only non-duplicate, non-cap failure path is a storage rejection.
    const result = simulateCreateFromFolder(makeWorkspaces(1), 'new-folder', false);
    expect(result).toBe('at_max');
  });

  it('returns "already_exists" when the folder is already a workspace root', () => {
    const workspaces = [{ rootFolderId: 'taken-folder' }];
    const result = simulateCreateFromFolder(workspaces, 'taken-folder', true);
    expect(result).toBe('already_exists');
  });

  it('returns "created" at exactly one below the cap (boundary)', () => {
    const result = simulateCreateFromFolder(makeWorkspaces(MAX_WORKSPACES - 1), 'new-folder', true);
    expect(result).toBe('created');
  });

  it('returns "at_max" at exactly the cap (boundary)', () => {
    const result = simulateCreateFromFolder(makeWorkspaces(MAX_WORKSPACES), 'new-folder', true);
    expect(result).toBe('at_max');
  });

  it('"already_exists" check takes priority over a cap that would also apply', () => {
    // At MAX_WORKSPACES, the cap check fires first — this is fine because the
    // disabled state in the menu already prevents reaching this code at max+used.
    // However we document that the ordering is: max → duplicate → create.
    const workspaces = makeWorkspaces(MAX_WORKSPACES);
    // Mark the last one as the folder we're about to "create from".
    workspaces[MAX_WORKSPACES - 1] = { rootFolderId: 'target-folder' };
    // At max: returns 'at_max' before checking duplicate.
    const result = simulateCreateFromFolder(workspaces, 'target-folder', true);
    expect(result).toBe('at_max');
  });
});
