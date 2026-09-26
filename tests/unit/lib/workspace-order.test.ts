import { describe, expect, it } from 'vitest';
import type { WorkspaceRecord, WorkspaceView } from '@/shared/messages';
import { orderWorkspaces, resolveActiveWorkspace, shownWorkspaces, workspaceLimitMessage } from '@/newtab/lib/workspace-order';

// The active workspace is chosen per browser and never synced, so a sync can
// delete it here; the page must then fall back to a workspace that is shown.

const ws = (id: string): WorkspaceRecord => ({ id, name: id, rootFolderId: id } as WorkspaceRecord);

describe('workspace order', () => {
  it('follows the stored order, skips ids that are gone and appends unlisted workspaces', () => {
    expect(orderWorkspaces([ws('a'), ws('b'), ws('c')], ['c', 'gone', 'a']).map(w => w.id)).toEqual(['c', 'a', 'b']);
  });

  it('keeps the active workspace while it exists', () => {
    expect(resolveActiveWorkspace([ws('a'), ws('b')], ['a', 'b'], 'b')?.id).toBe('b');
  });

  it('falls back to the first workspace in tab order when the active one was deleted by a sync', () => {
    expect(resolveActiveWorkspace([ws('a'), ws('b')], ['b', 'a'], 'deleted')?.id).toBe('b');
    expect(resolveActiveWorkspace([], ['b'], 'deleted')).toBeNull();
  });
});

describe('workspaces without a folder in this browser', () => {
  const views: WorkspaceView[] = [
    ws('shown'),
    { ...ws('lost'), rootFolderId: '', folderState: 'lost' },
    { ...ws('waiting'), rootFolderId: '', folderState: 'waiting' },
    { ...ws('unused'), rootFolderId: '', folderState: 'unused' },
  ];

  it('hides waiting and unused ones but keeps a lost one, which shows the removed-folder state', () => {
    expect(shownWorkspaces(views).map(w => w.id)).toEqual(['shown', 'lost']);
  });

  it('names the hidden ones in the limit message, since they still count', () => {
    expect(workspaceLimitMessage(views)).toBe('Workspace limit reached (20, including 2 waiting for bookmarks)');
    expect(workspaceLimitMessage([ws('a')])).toBe('Workspace limit reached (20)');
  });
});
