import { describe, expect, it } from 'vitest';
import type { WorkspaceRecord, WorkspaceView } from '@/shared/messages';
import {
  firstOrderedWorkspaceId,
  orderWorkspaces,
  resolveActiveWorkspace,
  shownWorkspaces,
  workspaceLimitMessage,
} from '@/newtab/lib/workspace-order';

interface Row { id: string; label: string }

const rows: Row[] = [
  { id: 'a', label: 'A' },
  { id: 'b', label: 'B' },
  { id: 'c', label: 'C' },
];

const ws = (id: string): WorkspaceRecord => ({ id, name: id, rootFolderId: id } as WorkspaceRecord);

describe('orderWorkspaces', () => {
  // WHY: this is the tab strip's core contract — order dictates left-to-right
  // position. Getting the sort wrong reorders every workspace tab on screen.
  it('sorts by the given order', () => {
    expect(orderWorkspaces(rows, ['c', 'a', 'b']).map(r => r.id)).toEqual(['c', 'a', 'b']);
  });

  // WHY: a brand-new workspace has no entry in workspaceOrder yet (it hasn't
  // been dragged anywhere) — it must still show up, appended after the
  // ordered ones, rather than vanishing from the tab strip.
  it('appends workspaces missing from the order, in storage order', () => {
    expect(orderWorkspaces(rows, ['b']).map(r => r.id)).toEqual(['b', 'a', 'c']);
  });

  // WHY: a deleted workspace can still be named in a stale workspaceOrder
  // (nothing prunes it) — the id must be silently dropped rather than
  // producing a ghost row.
  it('drops ids in the order that no longer name a live workspace', () => {
    expect(orderWorkspaces(rows, ['z', 'b', 'a']).map(r => r.id)).toEqual(['b', 'a', 'c']);
  });

  // WHY: a merged order from another browser can name an id twice; the tab
  // must still appear once.
  it('shows a workspace once when the order repeats its id', () => {
    expect(orderWorkspaces(rows, ['b', 'a', 'b']).map(r => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('falls back to storage order when order is empty or undefined', () => {
    expect(orderWorkspaces(rows, undefined).map(r => r.id)).toEqual(['a', 'b', 'c']);
    expect(orderWorkspaces(rows, []).map(r => r.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('firstOrderedWorkspaceId', () => {
  it('returns the id of the leftmost tab', () => {
    expect(firstOrderedWorkspaceId(rows, ['c', 'a', 'b'])).toBe('c');
  });

  // WHY: deleting the active workspace must reactivate the first TAB
  // (order[0]), not whichever workspace happens to be first in
  // storage/response order.
  it('is the first ordered survivor after the active workspace is removed', () => {
    const remaining = rows.filter(r => r.id !== 'c');
    expect(firstOrderedWorkspaceId(remaining, ['c', 'a', 'b'])).toBe('a');
  });

  it('returns undefined for an empty workspace list', () => {
    expect(firstOrderedWorkspaceId([], ['a'])).toBeUndefined();
  });
});

// The active workspace is chosen per browser and never synced, so a sync can
// delete it here; the page must then fall back to a workspace that is shown.
describe('resolveActiveWorkspace', () => {
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
