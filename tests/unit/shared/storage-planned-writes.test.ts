import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeletionMarker, WorkspaceRecord } from '@/shared/models';
import { changedSincePlan, mergePlannedMarkers } from '@/shared/sync-stamps';
import { createBrowser, idbModule, setCurrentBrowser } from '../lib/sync-browser-fake';

// A sync or import plans from a snapshot and writes later. Anything a user
// changes in between is newer than the plan and must survive its writes.

vi.mock('@/shared/icon-idb', () => idbModule);

const NOW = 1_800_000_000_000;

async function loadStorage(): Promise<typeof import('@/shared/storage')> {
  vi.resetModules();
  return import('@/shared/storage');
}

function record(id: string, extra: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
  return {
    id,
    name: `Workspace ${id}`,
    rootFolderId: `folder-${id}`,
    themeMode: 'system',
    accentColor: '#3F72DC',
    backgroundMode: 'gradient',
    solidBackgroundColor: '',
    gradientStyle: 'top',
    gradientColorSource: 'accent',
    gradientCustomColor: '#3F72DC',
    gradientIntensity: 100,
    backgroundOpacity: 70,
    backgroundFitMode: 'cover',
    backgroundPositionMode: 'center',
    layoutPreset: 'balanced',
    favoritesColumnGap: 24,
    favoritesRowGap: 20,
    bookmarkTileWidth: 130,
    bookmarkIconSize: 75,
    tileShape: 'squircle',
    showTileLabels: true,
    folderMode: 'grid',
    bookmarkSortMode: 'manual',
    bookmarkSortDirection: 'asc',
    ...extra,
  };
}

const marker = (kind: DeletionMarker['kind'], key: string, deletedAt: number): DeletionMarker => ({ kind, key, deletedAt });

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => NOW);
  setCurrentBrowser(createBrowser('solo'));
});

afterEach(() => {
  vi.restoreAllMocks();
  setCurrentBrowser(null);
});

describe('changedSincePlan', () => {
  it('treats a newer stored stamp, an appearance and a disappearance as changes', () => {
    expect(changedSincePlan({ updatedAt: 11 }, { updatedAt: 10 })).toBe(true);
    expect(changedSincePlan({ updatedAt: 5 }, undefined)).toBe(true);
    expect(changedSincePlan(null, { updatedAt: 10 })).toBe(true);
  });

  it('lets the plan write when storage still holds what it read', () => {
    expect(changedSincePlan({ updatedAt: 10 }, { updatedAt: 10 })).toBe(false);
    expect(changedSincePlan(null, undefined)).toBe(false);
  });
});

describe('mergePlannedMarkers', () => {
  it('keeps a marker stored after the plan read its basis', () => {
    const basis = [marker('workspace', 'a', 1)];
    const late = marker('iconOverride', 'exact:https://late.example/', 2);
    const next = mergePlannedMarkers([...basis, late], basis, [marker('workspace', 'a', 1), marker('folderIcon', 'x', 3)]);
    expect(next).toContainEqual(late);
    expect(next).toContainEqual(marker('folderIcon', 'x', 3));
  });

  it('drops a basis marker the plan left out (a mirror clears the old deletion log)', () => {
    const basis = [marker('workspace', 'a', 1)];
    expect(mergePlannedMarkers(basis, basis, [])).toEqual([]);
  });

  it('keeps a stored marker for the same item that a later delete restamped', () => {
    const basis = [marker('workspace', 'a', 1)];
    const restamped = marker('workspace', 'a', 5);
    expect(mergePlannedMarkers([restamped], basis, [])).toEqual([restamped]);
  });
});

describe('planned workspace writes', () => {
  it('a user edit made after the plan read the record survives the planned write', async () => {
    const storage = await loadStorage();
    const basis = record('a', { updatedAt: NOW - 1_000 });
    await storage.writeWorkspace(basis);
    const edited = await storage.patchWorkspaceFromUser('a', { name: 'Edited here' });

    const landed = await storage.writePlannedWorkspace(record('a', { name: 'From the other browser', updatedAt: NOW - 500 }), basis);

    expect(landed).toBe(false);
    expect((await storage.readWorkspaces()).find(w => w.id === 'a')).toEqual(edited);
  });

  it('a user delete made after the plan read the record is not undone by the planned write', async () => {
    const storage = await loadStorage();
    const basis = record('a', { updatedAt: NOW - 1_000 });
    await storage.writeWorkspace(basis);
    await storage.deleteWorkspaceFromUser('a');

    expect(await storage.writePlannedWorkspace(record('a', { name: 'Remote', updatedAt: NOW - 500 }), basis)).toBe(false);
    expect(await storage.readWorkspaces()).toEqual([]);
  });

  it('lands when nothing changed since the plan read the record', async () => {
    const storage = await loadStorage();
    const basis = record('a', { updatedAt: NOW - 1_000 });
    await storage.writeWorkspace(basis);
    const incoming = record('a', { name: 'Remote', updatedAt: NOW - 500 });

    expect(await storage.writePlannedWorkspace(incoming, basis)).toBe(true);
    expect(await storage.readWorkspaces()).toEqual([incoming]);
  });

  it('a planned delete keeps a workspace the user edited after the plan read it', async () => {
    const storage = await loadStorage();
    const basis = record('a', { updatedAt: NOW - 1_000 });
    await storage.writeWorkspace(basis);
    const edited = await storage.patchWorkspaceFromUser('a', { name: 'Still wanted' });

    expect(await storage.deletePlannedWorkspace('a', basis)).toBe(false);
    expect(await storage.readWorkspaces()).toEqual([edited]);
  });
});

describe('planned deletion markers', () => {
  it('a deletion recorded while the plan ran is kept, not replaced by the planned set', async () => {
    const storage = await loadStorage();
    const old = marker('workspace', 'old', NOW - 1_000);
    await storage.writeDeletionMarkers([old], NOW);
    const basis = await storage.readDeletionMarkers();
    const late = marker('iconOverride', 'exact:https://late.example/', NOW);
    await storage.addDeletionMarkers([late]);

    const incoming = marker('workspace', 'remote', NOW - 200);
    await storage.writePlannedDeletionMarkers(basis, [old, incoming], NOW);

    const stored = await storage.readDeletionMarkers();
    expect(stored).toHaveLength(3);
    expect(stored).toEqual(expect.arrayContaining([old, incoming, late]));
  });
});

describe('deleteWorkspaceFromUser', () => {
  it('stamps the marker past an edit that landed just before the delete, so the edit cannot outlive it', async () => {
    const storage = await loadStorage();
    // Stored by a device whose clock runs ahead, so stamps come from +1 steps.
    await storage.writeWorkspace(record('a', { updatedAt: NOW + 10_000 }));

    const [edited] = await Promise.all([
      storage.patchWorkspaceFromUser('a', { name: 'Renamed' }),
      storage.deleteWorkspaceFromUser('a'),
    ]);

    const stored = (await storage.readDeletionMarkers()).find(m => m.key === 'a');
    expect(stored?.deletedAt).toBeGreaterThan(edited.updatedAt ?? 0);
  });
});
