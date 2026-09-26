import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeletionMarker, WorkspaceRecord } from '@/shared/models';
import { createBrowser, idbModule, resetWrites, setCurrentBrowser, totalWrites, type FakeBrowser } from '../lib/sync-browser-fake';

// Stamps decide every sync conflict, so they must be written by user edits
// only: a writer that restamps on import or migration would make stale data
// look new, and a writer that stamps no-op edits would make every sync churn.

vi.mock('@/shared/icon-idb', () => idbModule);

const NOW = 1_800_000_000_000;
let clock = NOW;
let browser: FakeBrowser;

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

beforeEach(() => {
  clock = NOW;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  browser = createBrowser('solo');
  setCurrentBrowser(browser);
});

afterEach(() => {
  vi.restoreAllMocks();
  setCurrentBrowser(null);
});

describe('settings stamps', () => {
  it('a user patch stamps only the keys whose value changed', async () => {
    const storage = await loadStorage();
    await storage.writeSettings({ themeMode: 'dark', settingsUpdatedAt: { themeMode: 100 } });

    const next = await storage.patchSettingsFromUser({ themeMode: 'dark', showClock: true });

    expect(next.settingsUpdatedAt).toEqual({ themeMode: 100, showClock: NOW });
  });

  it('a stamp always moves past the previous one, even when that came from a clock running ahead', async () => {
    const storage = await loadStorage();
    await storage.writeSettings({ settingsUpdatedAt: { showClock: NOW + 5_000 } });

    const next = await storage.patchSettingsFromUser({ showClock: true });

    expect(next.settingsUpdatedAt?.showClock).toBe(NOW + 5_001);
  });

  it('the raw writer used by import and sync stores stamps exactly as given', async () => {
    const storage = await loadStorage();
    const written = await storage.writeSettings({ themeMode: 'light', settingsUpdatedAt: { themeMode: 7 } });
    expect(written.settingsUpdatedAt).toEqual({ themeMode: 7 });
    expect((await storage.readSettings()).settingsUpdatedAt).toEqual({ themeMode: 7 });
  });

  it('per-browser keys are never stamped and never reach the synced settings record', async () => {
    const storage = await loadStorage();
    const next = await storage.patchSettingsFromUser({ activeWorkspaceId: 'w1', dockFolderId: '42' });

    expect(next.settingsUpdatedAt).toEqual({});
    expect(browser.sync.data.get('app-settings') ?? {}).not.toHaveProperty('activeWorkspaceId');
    expect(browser.sync.data.get('app-settings') ?? {}).not.toHaveProperty('dockFolderId');
    expect(browser.local.data.get('browser-local-settings')).toEqual({ activeWorkspaceId: 'w1', dockFolderId: '42' });
  });

  it('normalizeSettings keeps valid stamps and reads invalid ones as absent (0)', async () => {
    const storage = await loadStorage();
    const normalized = storage.normalizeSettings({
      settingsUpdatedAt: { themeMode: 5, showClock: 1.5, showDock: -1, autoHideDock: 2 ** 53 } as never,
    });
    expect(normalized.settingsUpdatedAt).toEqual({ themeMode: 5 });
  });

  it('an equal-value write touches no storage', async () => {
    const storage = await loadStorage();
    await storage.patchSettingsFromUser({ showClock: true, activeWorkspaceId: 'w1' });
    resetWrites(browser);

    await storage.patchSettingsFromUser({ showClock: true, activeWorkspaceId: 'w1' });
    await storage.writeSettings({ showClock: true });

    expect(totalWrites(browser)).toBe(0);
  });
});

describe('workspace stamps', () => {
  it('create stamps; a changing patch restamps; an unchanged patch writes nothing and keeps the stamp', async () => {
    const storage = await loadStorage();
    const created = await storage.createWorkspaceFromUser(record('a'));
    expect(created.updatedAt).toBe(NOW);

    clock += 10;
    const edited = await storage.patchWorkspaceFromUser('a', { accentColor: '#000000' });
    expect(edited.updatedAt).toBe(NOW + 10);

    clock += 10;
    resetWrites(browser);
    const same = await storage.patchWorkspaceFromUser('a', { accentColor: '#000000' });
    expect(same.updatedAt).toBe(NOW + 10);
    expect(totalWrites(browser)).toBe(0);
  });

  it('an empty patch is a touch (the wallpaper path) and restamps', async () => {
    const storage = await loadStorage();
    await storage.createWorkspaceFromUser(record('a'));
    clock += 10;
    expect((await storage.patchWorkspaceFromUser('a', {})).updatedAt).toBe(NOW + 10);
  });

  it('a stamp in the user patch is ignored; the raw writer keeps the stamp it is given', async () => {
    const storage = await loadStorage();
    await storage.writeWorkspace(record('a', { updatedAt: 3 }));
    expect((await storage.readWorkspaces())[0].updatedAt).toBe(3);

    const edited = await storage.patchWorkspaceFromUser('a', { accentColor: '#111111', updatedAt: 1 });
    expect(edited.updatedAt).toBe(NOW);
  });

  it('a user delete leaves a per-key marker in the synced area; a raw delete leaves none', async () => {
    const storage = await loadStorage();
    await storage.writeWorkspace(record('a', { updatedAt: NOW + 50 }));
    await storage.writeWorkspace(record('b', { updatedAt: 1 }));

    await storage.deleteWorkspaceFromUser('a');
    await storage.deleteWorkspace('b');

    expect(browser.sync.data.get('workspace-deleted:a')).toEqual({ kind: 'workspace', key: 'a', deletedAt: NOW + 51 });
    expect(browser.sync.data.has('workspace-deleted:b')).toBe(false);
    expect(await storage.readWorkspaces()).toEqual([]);
  });

  it('keeps at most 50 workspace markers, dropping the oldest', async () => {
    const storage = await loadStorage();
    const markers: DeletionMarker[] = Array.from({ length: 55 }, (_, i) => ({ kind: 'workspace', key: `w${i}`, deletedAt: NOW - 1000 + i }));
    await storage.writeDeletionMarkers(markers, NOW);

    const kept = await storage.readDeletionMarkers();
    expect(kept).toHaveLength(50);
    expect(kept.map(m => m.key)).not.toContain('w4');
    expect(kept.map(m => m.key)).toContain('w5');
  });

  it('writing the same marker set again touches no storage', async () => {
    const storage = await loadStorage();
    const markers: DeletionMarker[] = [
      { kind: 'workspace', key: 'a', deletedAt: NOW - 5 },
      { kind: 'iconOverride', key: 'exact:https://x.example/', deletedAt: NOW - 5 },
    ];
    await storage.writeDeletionMarkers(markers, NOW);
    resetWrites(browser);

    await storage.writeDeletionMarkers(markers, NOW);

    expect(totalWrites(browser)).toBe(0);
  });
});

describe('icon stamps and markers', () => {
  const url = 'https://x.example/';
  const override = {
    overrideKey: `exact:${url}`,
    scope: 'exact' as const,
    bookmarkUrl: url,
    dataUrl: 'data:image/png;base64,AAA',
    fileName: 'x.png',
    mimeType: 'image/png',
    updatedAt: 0,
  };

  it('set stamps, delete leaves a local marker, and a later set stamps past that marker', async () => {
    const storage = await loadStorage();
    const set = await storage.writeIconOverrideFromUser(override);
    expect(set.updatedAt).toBe(NOW);

    await storage.deleteIconOverridesForUrlFromUser(url);
    expect(browser.local.data.get('sync-deletion-markers')).toEqual([{ kind: 'iconOverride', key: `exact:${url}`, deletedAt: NOW + 1 }]);
    expect(browser.overrides.size).toBe(0);

    const again = await storage.writeIconOverrideFromUser(override);
    expect(again.updatedAt).toBe(NOW + 2);
  });

  it('a raw delete (cache sweep, cleanup) leaves no marker', async () => {
    const storage = await loadStorage();
    await storage.writeIconOverrideFromUser(override);
    await storage.deleteIconOverrideRecord(override.overrideKey);
    expect(await storage.readDeletionMarkers()).toEqual([]);
  });

  it('a new folder icon gets a random sync id, kept when the icon is replaced', async () => {
    const storage = await loadStorage();
    const first = await storage.writeFolderIconFromUser({ folderId: '7', dataUrl: 'data:image/png;base64,A', mimeType: 'image/png', updatedAt: 0 });
    const second = await storage.writeFolderIconFromUser({ folderId: '7', dataUrl: 'data:image/png;base64,B', mimeType: 'image/png', updatedAt: 0 });

    expect(first.syncId).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.syncId).toBe(first.syncId);
    expect(second.updatedAt).toBe(NOW + 1);
  });

  it('a folder icon stored before sync ids existed keeps a deterministic id, and its delete marker uses it', async () => {
    const storage = await loadStorage();
    browser.folderIcons.set('9', { folderId: '9', dataUrl: 'data:image/png;base64,A', mimeType: 'image/png', updatedAt: 4 });

    await storage.deleteFolderIconFromUser('9');

    expect(await storage.readDeletionMarkers()).toEqual([{ kind: 'folderIcon', key: 'legacy:9', deletedAt: NOW }]);
  });
});

describe('per-browser settings move', () => {
  const legacySettings = { themeMode: 'dark', activeWorkspaceId: 'w-old', dockFolderId: '12', settingsUpdatedAt: {} };

  it('reads the old shared values until the move, then keeps them in this browser only', async () => {
    browser.sync.data.set('app-settings', legacySettings);
    const storage = await loadStorage();
    expect((await storage.readSettings()).activeWorkspaceId).toBe('w-old');

    await storage.ensurePerBrowserSettingsMove();

    expect(browser.local.data.get('browser-local-settings')).toEqual({ activeWorkspaceId: 'w-old', dockFolderId: '12' });
    expect(browser.sync.data.get('app-settings')).toEqual({ themeMode: 'dark', settingsUpdatedAt: {} });
    expect(await storage.readSettings()).toMatchObject({ themeMode: 'dark', activeWorkspaceId: 'w-old', dockFolderId: '12' });
  });

  it('is idempotent: running again, even after a restart, changes nothing', async () => {
    browser.sync.data.set('app-settings', legacySettings);
    await (await loadStorage()).ensurePerBrowserSettingsMove();
    const afterFirst = structuredClone([...browser.local.data, ...browser.sync.data]);
    resetWrites(browser);

    const restarted = await loadStorage();
    await restarted.ensurePerBrowserSettingsMove();
    await restarted.ensurePerBrowserSettingsMove();

    expect(totalWrites(browser)).toBe(0);
    expect([...browser.local.data, ...browser.sync.data]).toEqual(afterFirst);
  });

  it('a peer that still writes the old keys into the shared record cannot change this browser’s choice', async () => {
    const storage = await loadStorage();
    await storage.ensurePerBrowserSettingsMove();
    await storage.patchSettingsFromUser({ activeWorkspaceId: 'mine' });

    browser.sync.external('app-settings', { ...legacySettings, activeWorkspaceId: 'theirs' });

    expect((await storage.readSettings()).activeWorkspaceId).toBe('mine');
  });
});
