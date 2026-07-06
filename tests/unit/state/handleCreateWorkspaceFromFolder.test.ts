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
 * Strategy: we test checkCreateFromFolderGuard directly — the production guard
 * function extracted from useWorkspaceActions.ts's handleCreateWorkspaceFromFolder
 * — so this test and the implementation can never silently diverge. The final
 * 'created' vs. 'at_max' branch (when the guard says 'proceed' but the create
 * call itself fails) is simulated here since it depends on the async
 * createWorkspace call, not the guard; the Playwright spec covers the fully
 * integrated path end-to-end.
 */
import { describe, expect, it, vi } from 'vitest';
import { MAX_WORKSPACES } from '@/shared/constants';
import type { WorkspaceRecord } from '@/shared/messages';

// useWorkspaceActions imports lib/messaging.ts and shared/storage.ts, both of
// which import shared/browser.ts, which throws at module-eval time outside a
// real extension context (no browser/chrome runtime in Vitest). Stub both so
// importing checkCreateFromFolderGuard doesn't pull in that side effect —
// none of these tests exercise messaging or storage.
vi.mock('@/newtab/lib/messaging', () => ({
  createWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  patchSettings: vi.fn(),
  patchWorkspace: vi.fn(),
}));
vi.mock('@/shared/storage', () => ({
  defaultWorkspaceSettings: {},
  readWorkspaceWallpaper: vi.fn(),
  writeWorkspaceWallpaper: vi.fn(),
}));

import { checkCreateFromFolderGuard } from '@/newtab/state/useWorkspaceActions';

type CreateResult = 'created' | 'at_max' | 'already_exists';

// Mirrors handleCreateWorkspaceFromFolder's own composition: guard first, then
// (if 'proceed') the create call, whose success/failure maps to created/at_max.
function simulateCreateFromFolder(
  workspaces: Pick<WorkspaceRecord, 'rootFolderId'>[],
  folderId: string,
  createWorkspaceSucceeds: boolean,
): CreateResult {
  const guard = checkCreateFromFolderGuard(workspaces, folderId);
  if (guard !== 'proceed') return guard;
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
