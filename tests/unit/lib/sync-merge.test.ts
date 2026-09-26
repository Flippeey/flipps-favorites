import { describe, expect, it } from 'vitest';
import type {
  BookmarkNode,
  DeletionMarker,
  FolderIconOverrideRecord,
  IconOverrideRecord,
  SyncedSettings,
  WorkspaceRecord,
} from '@/shared/models';
import {
  pickWinner,
  planIncomingWorkspaces,
  recommendLinkMode,
  WORKSPACE_SCHEMA,
  WORKSPACE_SCHEMA_VERSION,
  type LocalSyncSnapshot,
  type PlanContext,
  type SyncPlan,
  type WorkspaceExportPayload,
} from '@/newtab/lib/sync-merge';
import { nextStamp, readStamp } from '@/shared/sync-stamps';
import { DELETION_MARKER_RETENTION_MS, MAX_WORKSPACES } from '@/shared/constants';

// Pure planner tests: every sync path (Sync now, link Merge/Replace, file
// Merge/Replace, the link preview) runs through planIncomingWorkspaces, so
// these pin who wins, what gets deleted and what the shared copy carries.

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

const DEFAULTS: SyncedSettings = {
  workspaceOrder: [],
  themeMode: 'system',
  rememberLastFolder: true,
  openLinksInNewTab: false,
  showDock: false,
  autoHideDock: true,
  showClock: false,
  clockHourFormat: '24',
  showSearchBar: true,
  folderOpenMode: 'overlay',
  folderCountBadgeMode: 'always',
};

function ws(id: string, updatedAt?: number, extra: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
  return {
    id,
    name: `Workspace ${id}`,
    rootFolderId: `folder-${id}`,
    ...(updatedAt !== undefined ? { updatedAt } : {}),
    accentColor: '#3F72DC',
    backgroundMode: 'gradient',
    ...extra,
  } as WorkspaceRecord;
}

function local(state: Omit<Partial<LocalSyncSnapshot>, 'settings'> & { settings?: Partial<LocalSyncSnapshot['settings']> } = {}): LocalSyncSnapshot {
  return {
    workspaces: [],
    wallpapers: {},
    iconOverrides: [],
    folderIcons: [],
    usage: [],
    deletions: [],
    ...state,
    settings: { ...DEFAULTS, activeWorkspaceId: '', dockFolderId: '', settingsUpdatedAt: {}, ...state.settings },
  };
}

function payload(state: Partial<WorkspaceExportPayload> = {}): WorkspaceExportPayload {
  return {
    schema: WORKSPACE_SCHEMA,
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    exportedAt: NOW,
    settings: {},
    settingsUpdatedAt: {},
    workspaces: [],
    workspaceWallpapers: {},
    iconOverrides: [],
    folderIcons: [],
    bookmarkUsage: [],
    deletions: [],
    ...state,
  };
}

function plan(incoming: WorkspaceExportPayload, snapshot: LocalSyncSnapshot, ctx: Partial<PlanContext> = {}): SyncPlan {
  return planIncomingWorkspaces(incoming, snapshot, { mode: 'merge', origin: 'sync', tree: null, now: NOW, defaults: DEFAULTS, ...ctx });
}

// What executing a plan leaves in local storage (the executor in
// workspace-transfer.ts does exactly these writes and deletes).
function applyPlan(snapshot: LocalSyncSnapshot, result: SyncPlan): LocalSyncSnapshot {
  const written = new Set(result.workspaceWrites.map(w => w.id));
  const gone = new Set(result.workspaceDeletes);
  const overrideKeys = new Set([...result.overrideDeletes, ...result.overrideWrites.map(r => r.overrideKey)]);
  const folderIds = new Set([...result.folderIconDeletes, ...result.folderIconWrites.map(r => r.folderId)]);
  return {
    settings: { ...snapshot.settings, ...result.settings },
    workspaces: [...snapshot.workspaces.filter(w => !written.has(w.id) && !gone.has(w.id)), ...result.workspaceWrites],
    wallpapers: {
      ...Object.fromEntries(Object.entries(snapshot.wallpapers).filter(([id]) => !gone.has(id))),
      ...Object.fromEntries(result.wallpaperWrites.map(w => [w.id, w.dataUrl])),
    },
    iconOverrides: [...snapshot.iconOverrides.filter(r => !overrideKeys.has(r.overrideKey)), ...result.overrideWrites],
    folderIcons: [...snapshot.folderIcons.filter(r => !folderIds.has(r.folderId)), ...result.folderIconWrites],
    usage: [
      ...snapshot.usage.filter(r => !result.usageDeletes.includes(r.bookmarkId) && !result.usageWrites.some(u => u.bookmarkId === r.bookmarkId)),
      ...result.usageWrites,
    ],
    deletions: result.deletions,
  };
}

// One Sync now: pull the server copy, merge, push the merged set.
function syncOnce(snapshot: LocalSyncSnapshot, server: WorkspaceExportPayload | null, now = NOW, tree: BookmarkNode[] | null = null): { state: LocalSyncSnapshot; server: WorkspaceExportPayload; result: SyncPlan } {
  const result = plan(server ?? payload(), snapshot, { now, tree });
  return { state: applyPlan(snapshot, result), server: result.merged, result };
}

function override(key: string, updatedAt: number, dataUrl = 'data:image/png;base64,AAA'): IconOverrideRecord {
  return { overrideKey: `exact:${key}`, scope: 'exact', bookmarkUrl: key, dataUrl, fileName: 'a.png', mimeType: 'image/png', updatedAt };
}

function marker(kind: DeletionMarker['kind'], key: string, deletedAt: number): DeletionMarker {
  return { kind, key, deletedAt };
}

function edit(snapshot: LocalSyncSnapshot, id: string, patch: Partial<WorkspaceRecord>, now: number): LocalSyncSnapshot {
  return {
    ...snapshot,
    workspaces: snapshot.workspaces.map(w => (w.id === id ? { ...w, ...patch, updatedAt: nextStamp(w.updatedAt, now) } : w)),
  };
}

describe('stamps', () => {
  it('reads anything that is not a finite integer in [0, 2^52] as 0, the same on every browser', () => {
    for (const bad of [Number.NaN, -1, 1.5, 2 ** 53, '5', null, undefined, Infinity]) {
      expect(readStamp(bad)).toBe(0);
    }
    expect(readStamp(2 ** 52)).toBe(2 ** 52);
  });

  it('a user edit beats the version it replaced even when that one came from a clock running ahead', () => {
    expect(nextStamp(NOW + HOUR, NOW)).toBe(NOW + HOUR + 1);
    expect(nextStamp(NOW - HOUR, NOW)).toBe(NOW);
  });

  it('an invalid incoming stamp loses to any real local edit', () => {
    const result = plan(payload({ workspaces: [ws('a', Number.NaN, { accentColor: '#000000' })] }), local({ workspaces: [ws('a', 5)] }));
    expect(result.workspaceWrites).toEqual([]);
    expect(result.merged.workspaces[0].updatedAt).toBe(5);
  });
});

describe('pickWinner', () => {
  const stamp = (r: { s: number }): number => r.s;

  it('newer local wins, newer remote wins', () => {
    expect(pickWinner({ s: 2 }, { s: 1 }, stamp, undefined)).toEqual({ record: { s: 2 }, fromRemote: false });
    expect(pickWinner({ s: 1 }, { s: 2 }, stamp, undefined)).toEqual({ record: { s: 2 }, fromRemote: true });
  });

  it('equal record stamps, including both unstamped, take the server copy so browsers converge', () => {
    expect(pickWinner({ s: 3, v: 'l' }, { s: 3, v: 'r' }, stamp, undefined)?.fromRemote).toBe(true);
    expect(pickWinner({ s: 0, v: 'l' }, { s: 0, v: 'r' }, stamp, undefined)?.fromRemote).toBe(true);
  });

  it('a marker newer than the record deletes it; an older one loses to the edit', () => {
    expect(pickWinner({ s: 1 }, undefined, stamp, marker('workspace', 'x', 2))).toBeNull();
    expect(pickWinner({ s: 3 }, undefined, stamp, marker('workspace', 'x', 2))).not.toBeNull();
  });

  it('a record beats a marker with the same stamp, since a lost item cannot come back', () => {
    expect(pickWinner(undefined, { s: 2 }, stamp, marker('workspace', 'x', 2))).not.toBeNull();
  });
});

describe('scenarios', () => {
  it('link Merge: newest wins per workspace and per setting in both directions', () => {
    const result = plan(
      payload({
        workspaces: [ws('a', 10, { accentColor: '#remote' }), ws('b', 30, { accentColor: '#remote' })],
        settings: { themeMode: 'dark', showClock: true },
        settingsUpdatedAt: { themeMode: 5, showClock: 50 },
      }),
      local({
        workspaces: [ws('a', 20, { accentColor: '#local' }), ws('b', 25, { accentColor: '#local' })],
        settings: { themeMode: 'light', showClock: false, settingsUpdatedAt: { themeMode: 40, showClock: 1 } },
      }),
    );
    expect(result.merged.workspaces.find(w => w.id === 'a')?.accentColor).toBe('#local');
    expect(result.merged.workspaces.find(w => w.id === 'b')?.accentColor).toBe('#remote');
    expect(result.settings.themeMode).toBe('light');
    expect(result.settings.showClock).toBe(true);
    expect(result.updatedWorkspaceNames).toEqual(['Workspace b']);
    expect(result.outboundWorkspaceNames).toEqual(['Workspace a']);
  });

  it('a new workspace on the other browser arrives as a new tab', () => {
    const result = plan(payload({ workspaces: [ws('n', 7)] }), local());
    expect(result.workspaceWrites.map(w => w.id)).toEqual(['n']);
    expect(result.newWorkspaceNames).toEqual(['Workspace n']);
  });

  it('an edit followed by Sync now on the same browser is kept and uploaded, not reverted by the older server copy', () => {
    const server = payload({ workspaces: [ws('a', 10, { accentColor: '#old' })] });
    const edited = local({ workspaces: [ws('a', 11, { accentColor: '#new' })] });
    const result = plan(server, edited);
    expect(result.workspaceWrites).toEqual([]);
    expect(result.merged.workspaces[0].accentColor).toBe('#new');
  });

  it('edits to different items and different settings on both browsers both survive', () => {
    const server = payload({
      workspaces: [ws('a', 10), ws('b', 20, { accentColor: '#b-remote' })],
      settings: { themeMode: 'system', showClock: true },
      settingsUpdatedAt: { showClock: 30 },
    });
    const here = local({
      workspaces: [ws('a', 25, { accentColor: '#a-local' }), ws('b', 5)],
      settings: { themeMode: 'dark', settingsUpdatedAt: { themeMode: 30 } },
    });
    const result = plan(server, here);
    expect(result.merged.workspaces.map(w => w.accentColor).sort()).toEqual(['#a-local', '#b-remote']);
    expect(result.settings).toMatchObject({ themeMode: 'dark', showClock: true });
  });

  it('a delete spreads: the marker removes the record elsewhere and stays in the shared copy', () => {
    const deletedAt = NOW - 1000;
    const deleter = local({ deletions: [marker('workspace', 'a', deletedAt)] });
    const pushed = plan(payload({ workspaces: [ws('a', 10)] }), deleter).merged;
    expect(pushed.workspaces).toEqual([]);
    expect(pushed.deletions).toContainEqual(marker('workspace', 'a', deletedAt));

    const other = plan(pushed, local({ workspaces: [ws('a', 10)] }));
    expect(other.workspaceDeletes).toEqual(['a']);
    expect(other.removedWorkspaceNames).toEqual(['Workspace a']);
  });

  it('an edit made after the delete wins over the marker', () => {
    const result = plan(payload({ deletions: [marker('workspace', 'a', 50)] }), local({ workspaces: [ws('a', 60)] }));
    expect(result.workspaceDeletes).toEqual([]);
    expect(result.merged.workspaces.map(w => w.id)).toEqual(['a']);
  });

  it('per-browser settings never reach the shared copy or the planned local settings', () => {
    const result = plan(payload(), local({ settings: { activeWorkspaceId: 'mine', dockFolderId: '42' } }));
    expect(result.merged.settings).not.toHaveProperty('activeWorkspaceId');
    expect(result.merged.settings).not.toHaveProperty('dockFolderId');
    expect(result.settings).not.toHaveProperty('activeWorkspaceId');
    expect(result.settings).not.toHaveProperty('dockFolderId');
  });

  it('cap: 12 shared + 10 new drops no update, adds 8, skips 2 and keeps those 2 in the pushed set', () => {
    const shared = Array.from({ length: 12 }, (_, i) => ws(`s${String(i).padStart(2, '0')}`, 10));
    const incomingShared = shared.map(w => ({ ...w, updatedAt: 20, accentColor: '#updated' }));
    const fresh = Array.from({ length: 10 }, (_, i) => ws(`n${i}`, 20));
    const result = plan(payload({ workspaces: [...incomingShared, ...fresh] }), local({ workspaces: shared }));

    expect(MAX_WORKSPACES).toBe(20);
    expect(result.updatedWorkspaceNames).toHaveLength(12);
    expect(result.newWorkspaceNames).toHaveLength(8);
    expect(result.workspaceSkippedCount).toBe(2);
    expect(result.workspaceWrites.map(w => w.id)).not.toContain('n8');
    expect(result.merged.workspaces.map(w => w.id)).toEqual(expect.arrayContaining(['n8', 'n9']));
    expect(result.merged.workspaces).toHaveLength(22);
    expect(result.deletions).toEqual([]);
  });

  it('records copied in by Chrome account sync (never merged here) take part in a normal merge that changes nothing', () => {
    const records = [ws('a', 10), ws('b', 20)];
    const result = plan(payload({ workspaces: records }), local({ workspaces: records, settings: { workspaceOrder: ['a', 'b'] } }));
    expect(result.workspaceWrites).toEqual([]);
    expect(result.workspaceDeletes).toEqual([]);
    expect(result.settingsChanged).toBe(false);
  });

  it('a freshly onboarded browser lists what it will add and pairs its "Favorites" with the other browser’s', () => {
    const tree: BookmarkNode[] = [{ id: '0', title: '', children: [{ id: '1', title: 'Bookmarks bar', children: [] }] }];
    const result = plan(
      payload({ workspaces: [ws('zz-remote', 10, { name: 'Favorites', rootFolderId: '1' })] }),
      local({ workspaces: [ws('aa-local', 5, { name: 'Favorites', rootFolderId: '1' }), ws('extra', 5)] }),
      { tree },
    );
    expect(result.newWorkspaceNames).toEqual([]);
    expect(result.outboundWorkspaceNames).toContain('Workspace extra');
    expect(result.merged.workspaces.map(w => w.id).sort()).toEqual(['aa-local', 'extra']);
  });
});

describe('deletion markers', () => {
  it('expired markers are pruned locally and left out of the payload', () => {
    const old = marker('workspace', 'gone', NOW - DELETION_MARKER_RETENTION_MS - 1);
    const fresh = marker('iconOverride', 'exact:x', NOW - 1000);
    const result = plan(payload({ deletions: [old] }), local({ deletions: [fresh] }));
    expect(result.deletions).toEqual([fresh]);
    expect(result.merged.deletions).toEqual([fresh]);
  });

  it('accepted risk: an item deleted elsewhere longer ago than retention comes back, with no review step', () => {
    // The marker is gone from the shared copy; this browser still holds the
    // record, whatever its lastSyncedAt says. A normal merge keeps it.
    const result = plan(payload(), local({ workspaces: [ws('stale', 1)] }));
    expect(result.workspaceDeletes).toEqual([]);
    expect(result.merged.workspaces.map(w => w.id)).toEqual(['stale']);
  });

  it('icon override markers delete the override and survive in the shared copy', () => {
    const result = plan(
      payload({ deletions: [marker('iconOverride', 'exact:https://x.com', NOW - 9)] }),
      local({ iconOverrides: [override('https://x.com', NOW - 50)] }),
    );
    expect(result.overrideDeletes).toEqual(['exact:https://x.com']);
    expect(result.merged.iconOverrides).toEqual([]);
    expect(result.deletions).toContainEqual(marker('iconOverride', 'exact:https://x.com', NOW - 9));
  });
});

describe('clock skew', () => {
  it('with one clock an hour ahead, the later edit on the other browser still wins every round, and no clamp is stored', () => {
    let fast = local({ workspaces: [ws('a', 1)] }); // clock +1h
    let slow = local({ workspaces: [ws('a', 1)] });
    let server: WorkspaceExportPayload | null = null;
    let realTime = NOW;

    for (let round = 0; round < 4; round += 1) {
      realTime += 60_000;
      fast = edit(fast, 'a', { accentColor: `#fast${round}` }, realTime + HOUR);
      const fastStamp = fast.workspaces[0].updatedAt;
      ({ state: fast, server } = syncOnce(fast, server, realTime + HOUR));
      ({ state: slow, server } = syncOnce(slow, server, realTime));
      expect(slow.workspaces[0].updatedAt).toBe(fastStamp); // stored verbatim

      realTime += 60_000;
      slow = edit(slow, 'a', { accentColor: `#slow${round}` }, realTime);
      ({ state: slow, server } = syncOnce(slow, server, realTime));
      ({ state: fast, server } = syncOnce(fast, server, realTime + HOUR));
      expect(fast.workspaces[0].accentColor).toBe(`#slow${round}`);
      expect(slow.workspaces[0].accentColor).toBe(`#slow${round}`);
    }
  });
});

describe('identity convergence', () => {
  const tree: BookmarkNode[] = [{ id: '0', title: '', children: [{ id: 'bar', title: 'Bar', children: [] }] }];
  const favorites = (id: string, updatedAt: number): WorkspaceRecord => ws(id, updatedAt, { name: 'Favorites', rootFolderId: 'bar' });

  function converge(): { a: LocalSyncSnapshot; b: LocalSyncSnapshot; server: WorkspaceExportPayload } {
    let a = local({ workspaces: [favorites('id-b', 10)], settings: { workspaceOrder: ['id-b'] } });
    let b = local({ workspaces: [favorites('id-a', 20)] });
    let server: WorkspaceExportPayload | null = null;
    ({ state: a, server } = syncOnce(a, server, NOW, tree));
    ({ state: b, server } = syncOnce(b, server, NOW, tree));
    ({ state: a, server } = syncOnce(a, server, NOW, tree));
    ({ state: b, server } = syncOnce(b, server, NOW, tree));
    return { a, b, server };
  }

  it('both browsers end on the lexicographically smaller id, with the newer content', () => {
    const { a, b, server } = converge();
    expect(a.workspaces.map(w => w.id)).toEqual(['id-a']);
    expect(b.workspaces.map(w => w.id)).toEqual(['id-a']);
    expect(server.workspaces.map(w => w.id)).toEqual(['id-a']);
    expect(server.deletions).toContainEqual(expect.objectContaining({ kind: 'workspace', key: 'id-b' }));
    // The larger id's holder re-keys its tab order too.
    expect(a.settings.workspaceOrder).toEqual(['id-a']);
  });

  it('the re-keying browser reports the re-key so the executor can move the active workspace', () => {
    const result = plan(payload({ workspaces: [favorites('id-a', 20)] }), local({ workspaces: [favorites('id-b', 10)] }), { tree });
    expect(result.rekeys).toEqual([{ from: 'id-b', to: 'id-a' }]);
    expect(result.workspaceDeletes).toEqual(['id-b']);
    expect(result.removedWorkspaceNames).toEqual([]);
  });

  it('a later delete of the converged workspace sticks on both browsers, from either side', () => {
    for (const deleterIsA of [true, false]) {
      let { a, b, server } = converge();
      const deleteHere = (s: LocalSyncSnapshot): LocalSyncSnapshot => ({
        ...s,
        workspaces: [],
        deletions: [...s.deletions, marker('workspace', 'id-a', NOW + 100)],
      });
      if (deleterIsA) a = deleteHere(a); else b = deleteHere(b);
      for (let i = 0; i < 2; i += 1) {
        ({ state: a, server } = syncOnce(a, server, NOW + 200, tree));
        ({ state: b, server } = syncOnce(b, server, NOW + 200, tree));
      }
      expect(a.workspaces).toEqual([]);
      expect(b.workspaces).toEqual([]);
      expect(server.workspaces).toEqual([]);
    }
  });

  it('several local matches are ambiguous and pair nothing', () => {
    const result = plan(
      payload({ workspaces: [favorites('id-z', 20)] }),
      local({ workspaces: [favorites('id-a', 1), favorites('id-b', 1)] }),
      { tree },
    );
    expect(result.rekeys).toEqual([]);
    expect(result.newWorkspaceNames).toEqual(['Favorites']);
  });
});

describe('settings', () => {
  it('merges per key: A’s theme and B’s clock both survive', () => {
    const result = plan(
      payload({ settings: { themeMode: 'system', showClock: true }, settingsUpdatedAt: { showClock: 20 } }),
      local({ settings: { themeMode: 'dark', settingsUpdatedAt: { themeMode: 20 } } }),
    );
    expect(result.settings.themeMode).toBe('dark');
    expect(result.settings.showClock).toBe(true);
    expect(result.settings.settingsUpdatedAt).toEqual({ themeMode: 20, showClock: 20 });
  });

  it('workspaceOrder drops ids that are not live and appends missing live ids by (updatedAt, id)', () => {
    const result = plan(
      payload({ workspaces: [ws('x', 1), ws('y', 5), ws('z', 3), ws('w', 3)], settings: { workspaceOrder: ['x', 'gone'] }, settingsUpdatedAt: { workspaceOrder: 9 } }),
      local(),
    );
    expect(result.settings.workspaceOrder).toEqual(['x', 'w', 'z', 'y']);
    expect(result.merged.settings.workspaceOrder).toEqual(['x', 'w', 'z', 'y']);
  });
});

describe('link Replace', () => {
  it('mirrors the incoming copy: incoming wins whatever its stamp, locals absent from it go, no markers are written', () => {
    const result = plan(
      payload({ workspaces: [ws('a', 1, { accentColor: '#theirs' })], settings: { showClock: true }, settingsUpdatedAt: { showClock: 1 } }),
      local({
        workspaces: [ws('a', 99, { accentColor: '#mine' }), ws('mine-only', 99)],
        iconOverrides: [override('https://x.com', 99)],
        deletions: [marker('workspace', 'older', NOW - 5)],
        settings: { themeMode: 'dark', settingsUpdatedAt: { themeMode: 99 }, activeWorkspaceId: 'mine-only', dockFolderId: '7' },
      }),
      { mode: 'replace' },
    );
    expect(result.workspaceWrites).toEqual([ws('a', 1, { accentColor: '#theirs' })]);
    expect(result.workspaceDeletes).toEqual(['mine-only']);
    expect(result.removedWorkspaceNames).toEqual(['Workspace mine-only']);
    expect(result.overrideDeletes).toEqual(['exact:https://x.com']);
    expect(result.deletions).toEqual([]);
    expect(result.settings).toMatchObject({ themeMode: 'system', showClock: true });
    expect(result.settings.settingsUpdatedAt).toEqual({ showClock: 1 });
    expect(result.settings).not.toHaveProperty('activeWorkspaceId');
  });
});

describe('file import', () => {
  it('Merge keeps a newer local edit over an older backup', () => {
    const result = plan(
      payload({ workspaces: [ws('a', 5, { accentColor: '#backup' })] }),
      local({ workspaces: [ws('a', 50, { accentColor: '#now' })] }),
      { origin: 'file' },
    );
    expect(result.workspaceWrites).toEqual([]);
  });

  it('Replace stamps the file’s values now, never deletes workspaces, wipes other overrides and keeps usage', () => {
    const result = plan(
      payload({
        workspaces: [ws('a', 5, { accentColor: '#backup' })],
        settings: { themeMode: 'light' },
        iconOverrides: [{ bookmarkUrl: 'https://f.com', dataUrl: 'data:image/png;base64,F', fileName: 'f.png', mimeType: 'image/png', updatedAt: 1 }],
      }),
      local({
        workspaces: [ws('a', NOW + 10, { accentColor: '#now' }), ws('keep', 5)],
        iconOverrides: [override('https://x.com', 5)],
        usage: [{ bookmarkId: 'b1', usedAt: 100 }],
        settings: { themeMode: 'dark', settingsUpdatedAt: { themeMode: NOW + 10 } },
      }),
      { origin: 'file', mode: 'replace' },
    );
    const written = result.workspaceWrites.find(w => w.id === 'a');
    expect(written?.accentColor).toBe('#backup');
    expect(written?.updatedAt).toBe(NOW + 11);
    expect(result.workspaceDeletes).toEqual([]);
    expect(result.settings.themeMode).toBe('light');
    expect(result.settings.settingsUpdatedAt.themeMode).toBe(NOW + 11);
    expect(result.settings.settingsUpdatedAt.showClock).toBe(NOW);
    expect(result.overrideDeletes).toEqual(['exact:https://x.com']);
    expect(result.overrideWrites.map(r => r.updatedAt)).toEqual([NOW]);
    expect(result.usageDeletes).toEqual([]);
    expect(result.deletions).toEqual([]);
  });

  it('adopts the local id for an identity match instead of converging', () => {
    const tree: BookmarkNode[] = [{ id: '0', title: '', children: [{ id: 'bar', title: 'Bar', children: [] }] }];
    const result = plan(
      payload({ workspaces: [ws('aaa', 5, { name: 'Favorites', rootFolderId: 'bar', accentColor: '#file' })] }),
      local({ workspaces: [ws('zzz', 1, { name: 'Favorites', rootFolderId: 'bar' })] }),
      { origin: 'file', tree },
    );
    expect(result.rekeys).toEqual([]);
    expect(result.workspaceWrites.map(w => [w.id, w.accentColor])).toEqual([['zzz', '#file']]);
    expect(result.deletions).toEqual([]);
  });
});

describe('folder icons', () => {
  const icon = (syncId: string | undefined, folderId: string, updatedAt: number): FolderIconOverrideRecord => ({
    folderId, dataUrl: 'data:image/png;base64,A', mimeType: 'image/png', updatedAt, ...(syncId ? { syncId } : {}),
  });

  it('gives an icon stored before syncIds existed a deterministic legacy id', () => {
    const result = plan(payload(), local({ folderIcons: [icon(undefined, '12', 3)] }));
    expect(result.folderIconWrites).toEqual([icon('legacy:12', '12', 3)]);
    expect(result.merged.folderIcons.map(r => r.syncId)).toEqual(['legacy:12']);
  });

  it('two icons for one folder: the newer keeps it and the older is retired with a marker every browser stamps alike', () => {
    const result = plan(
      payload({ folderIcons: [{ ...icon('remote', '5', NOW - 20), syncId: 'remote' }] }),
      local({ folderIcons: [icon('local', '5', NOW - 30)] }),
    );
    expect(result.folderIconWrites.map(r => r.syncId)).toEqual(['remote']);
    expect(result.deletions).toContainEqual(marker('folderIcon', 'local', NOW - 20));
    expect(result.merged.folderIcons.map(r => r.syncId)).toEqual(['remote']);
  });

  it('an exact tie goes to the smaller syncId', () => {
    const result = plan(
      payload({ folderIcons: [{ ...icon('b-id', '5', NOW - 10), syncId: 'b-id' }] }),
      local({ folderIcons: [icon('a-id', '5', NOW - 10)] }),
    );
    expect(result.merged.folderIcons.map(r => r.syncId)).toEqual(['a-id']);
    expect(result.deletions).toContainEqual(marker('folderIcon', 'b-id', NOW - 9));
  });
});

describe('usage', () => {
  it('keeps the latest use per bookmark and carries entries without a bookmark id', () => {
    const result = plan(
      payload({ bookmarkUsage: [{ bookmarkId: 'b1', usedAt: 50 }, { url: 'https://only-url.example', usedAt: 7 }] }),
      local({ usage: [{ bookmarkId: 'b1', usedAt: 40 }, { bookmarkId: 'b2', usedAt: 9 }] }),
    );
    expect(result.usageWrites).toEqual([{ bookmarkId: 'b1', usedAt: 50 }]);
    expect(result.merged.bookmarkUsage).toEqual(expect.arrayContaining([{ url: 'https://only-url.example', usedAt: 7 }, { bookmarkId: 'b2', usedAt: 9 }]));
  });
});

describe('quiet syncs', () => {
  it('a sync right after a sync plans no local change at all', () => {
    const start = local({
      workspaces: [ws('a', 10), ws('b', 0, { backgroundMode: 'wallpaper' })],
      wallpapers: { b: 'data:image/png;base64,W' },
      iconOverrides: [override('https://x.com', 3)],
      folderIcons: [{ folderId: '4', dataUrl: 'data:image/png;base64,F', mimeType: 'image/png', updatedAt: 2, syncId: 's' }],
      usage: [{ bookmarkId: 'b1', usedAt: 5 }],
      deletions: [marker('workspace', 'old', NOW - 10)],
      settings: { workspaceOrder: ['a', 'b'], settingsUpdatedAt: { themeMode: 4 } },
    });
    const first = syncOnce(start, payload({ workspaces: [ws('c', 8)] }));
    const second = syncOnce(first.state, first.server);
    const empty = {
      settingsChanged: false, workspaceWrites: [], workspaceDeletes: [], wallpaperWrites: [], overrideWrites: [],
      overrideDeletes: [], folderIconWrites: [], folderIconDeletes: [], usageWrites: [], usageDeletes: [],
    };
    expect(second.result).toMatchObject(empty);
    expect(second.result.deletions).toEqual(first.state.deletions);
    expect(second.server).toEqual(first.server);
  });
});

describe('recommendLinkMode', () => {
  const onboardedAt = NOW;

  it('preselects Replace only while every workspace and setting is untouched onboarding output', () => {
    const untouched = local({ workspaces: [ws('a', NOW - 5), ws('b', NOW)], settings: { settingsUpdatedAt: { workspaceOrder: NOW } } });
    expect(recommendLinkMode(untouched, onboardedAt)).toBe('replace');
  });

  it('preselects Merge once anything was edited after onboarding, is unstamped, or onboarding never finished', () => {
    expect(recommendLinkMode(local({ workspaces: [ws('a', NOW + 1)] }), onboardedAt)).toBe('merge');
    expect(recommendLinkMode(local({ workspaces: [ws('a', 0)] }), onboardedAt)).toBe('merge');
    expect(recommendLinkMode(local({ workspaces: [ws('a', NOW)], settings: { settingsUpdatedAt: { showClock: NOW + 1 } } }), onboardedAt)).toBe('merge');
    expect(recommendLinkMode(local({ workspaces: [ws('a', 5)] }), null)).toBe('merge');
  });
});
