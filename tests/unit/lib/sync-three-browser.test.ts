import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookmarkNode, FolderIconOverrideRecord, IconOverrideRecord, WorkspaceRecord } from '@/shared/models';
import { buildFolderLocator } from '@/shared/folder-locator';
import {
  accountSyncCopy,
  createArea,
  createBrowser,
  currentBrowser,
  idbModule,
  resetWrites,
  seededRandom,
  setCurrentBrowser,
  totalWrites,
  type FakeBrowser,
} from './sync-browser-fake';

// Property test for convergence. Two Chrome profiles share storage.sync
// through account sync, a Firefox profile syncs only through the server, and
// the server keeps a single blob where the last PUT wins. Random edits,
// deletes, syncs and account-sync copies run under skewed clocks; after two
// quiet rounds of Sync now every browser must hold the same synced state and
// a further sync must write nothing.
//
// Account sync is modelled two ways. 'shared': both profiles use one
// storage.sync area, and the newest version of every item must survive.
// 'delayed': each profile has its own area and Chrome copies keys between them
// later, per key, latest change wins. Chrome can then overwrite a concurrent
// edit (a whole settings record, or a record edited on both) before our merge
// ever sees it, so that mode checks convergence but not the newest-wins oracle.

vi.mock('@/shared/icon-idb', () => idbModule);

// Every profile holds the same bookmarks. Folder icons carry a locator, as the
// background writes them, so each browser places a synced icon on its folder.
const TREE: BookmarkNode[] = [{ id: '0', title: '', children: [
  { id: '1', title: 'Bookmarks bar', folderType: 'bookmarks-bar', children: [
    { id: '100', title: 'Alpha', children: [{ id: '1000', title: 'A', url: 'https://alpha.example/' }] },
    { id: '101', title: 'Beta', children: [{ id: '1010', title: 'B', url: 'https://beta.example/' }] },
  ] },
] }];

let server: unknown = null;
// The background module instance of whichever profile is running, which the
// page's apply message reaches.
let currentBackground: Background | null = null;
vi.mock('@/newtab/lib/messaging', () => ({
  getBookmarkTree: async () => structuredClone(TREE),
  invalidateIcon: async () => undefined,
  applyWorkspaceImport: (...[payload, mode, origin]: Parameters<Background['applyWorkspaceImport']>) => {
    if (!currentBackground) throw new Error('No profile is running.');
    return currentBackground.applyWorkspaceImport(payload, mode, origin, {
      loadTree: async () => structuredClone(TREE),
      invalidateIcons: async () => undefined,
    });
  },
  syncPull: async () => (server === null ? null : structuredClone(server)),
  syncPush: async (bundle: unknown) => { server = structuredClone(bundle); },
}));

type Storage = typeof import('@/shared/storage');
type SyncNow = typeof import('@/newtab/lib/sync-now');
type Background = typeof import('@/background/workspace-import');

interface Profile {
  readonly browser: FakeBrowser;
  storage: Storage;
  syncNow: SyncNow;
  background: Background;
  activeWorkspaceId: string;
}

const START = 1_800_000_000_000;
let clock = START;

async function boot(browser: FakeBrowser): Promise<Profile> {
  setCurrentBrowser(browser);
  vi.resetModules();
  const storage = await import('@/shared/storage');
  const syncNow = await import('@/newtab/lib/sync-now');
  const background = await import('@/background/workspace-import');
  return { browser, storage, syncNow, background, activeWorkspaceId: '' };
}

async function on<T>(profile: Profile, run: (p: Profile) => Promise<T>): Promise<T> {
  setCurrentBrowser(profile.browser);
  currentBackground = profile.background;
  return run(profile);
}

function workspace(id: string): WorkspaceRecord {
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
  };
}

// Newest-wins oracle: every version any browser ever wrote, and every delete.
class Oracle {
  readonly records = new Map<string, { stamp: number; values: unknown[] }>();
  readonly deletes = new Map<string, number>();

  wrote(key: string, stamp: number, value: unknown): void {
    const entry = this.records.get(key);
    if (!entry || stamp > entry.stamp) this.records.set(key, { stamp, values: [value] });
    else if (stamp === entry.stamp) entry.values.push(value);
  }

  deleted(key: string, stamp: number): void {
    this.deletes.set(key, Math.max(this.deletes.get(key) ?? 0, stamp));
  }

  // A record beats a marker at an equal stamp.
  expected(key: string): { live: true; values: unknown[] } | { live: false } {
    const entry = this.records.get(key);
    if (!entry || (this.deletes.get(key) ?? 0) > entry.stamp) return { live: false };
    return { live: true, values: entry.values };
  }
}

const THEMES = ['light', 'dark', 'system'] as const;
const ICON_URLS = ['https://a.example/', 'https://b.example/', 'https://c.example/'];
const FOLDER_IDS = ['100', '101'];

async function syncedState(profile: Profile): Promise<unknown> {
  return on(profile, async p => {
    const settings = p.storage.withoutPerBrowserSettings(await p.storage.readSettings());
    const workspaces = (await p.storage.readWorkspaces()).sort((a, b) => a.id.localeCompare(b.id));
    const overrides = [...p.browser.overrides.values()].sort((a, b) => a.overrideKey.localeCompare(b.overrideKey));
    const folderIcons = [...p.browser.folderIcons.values()].sort((a, b) => a.folderId.localeCompare(b.folderId));
    return { settings, workspaces, overrides, folderIcons };
  });
}

interface FinalState {
  settings: Record<string, unknown>;
  workspaces: WorkspaceRecord[];
  overrides: IconOverrideRecord[];
  folderIcons: FolderIconOverrideRecord[];
}

function assertNewestSurvived(
  seed: number,
  final: FinalState,
  workspaces: Oracle,
  icons: Oracle,
  settings: Map<string, { stamp: number; value: unknown }>,
  folderIcons: Oracle,
  folderOf: Map<string, string>,
): void {
  for (const [id] of workspaces.records) {
    const expected = workspaces.expected(id);
    const actual = final.workspaces.find(w => w.id === id);
    if (expected.live) expect(expected.values, `seed ${seed}: workspace ${id}`).toContainEqual(actual);
    else expect(actual, `seed ${seed}: deleted workspace ${id} came back`).toBeUndefined();
  }
  for (const [key] of icons.records) {
    const expected = icons.expected(key);
    const actual = final.overrides.find(r => r.overrideKey === key);
    if (expected.live) expect(expected.values, `seed ${seed}: override ${key}`).toContainEqual(actual);
    else expect(actual, `seed ${seed}: deleted override ${key} came back`).toBeUndefined();
  }
  for (const [key, { value }] of settings) {
    expect(final.settings[key], `seed ${seed}: setting ${key}`).toEqual(value);
  }
  // Folder icons are keyed by sync id; a folder shows its newest one. When
  // that one was never deleted, it must be the icon every browser shows.
  for (const folderId of new Set(folderOf.values())) {
    const [newest] = [...folderIcons.records]
      .filter(([syncId]) => folderOf.get(syncId) === folderId)
      .sort(([a, x], [b, y]) => y.stamp - x.stamp || a.localeCompare(b));
    const expected = folderIcons.expected(newest[0]);
    if (!expected.live) continue;
    const actual = final.folderIcons.find(r => r.folderId === folderId);
    expect(actual?.syncId, `seed ${seed}: folder icon ${folderId}`).toBe(newest[0]);
    expect(expected.values, `seed ${seed}: folder icon ${folderId}`).toContainEqual(actual?.dataUrl);
  }
}

type AccountSync = 'shared' | 'delayed';

async function runScenario(seed: number, accountSync: AccountSync): Promise<void> {
  const random = seededRandom(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  clock = START;
  server = null;

  const chromeSync = accountSync === 'shared' ? createArea('sync') : undefined;
  const chromeA = await boot(createBrowser('chrome-a', 0, chromeSync));
  const chromeB = await boot(createBrowser('chrome-b', -20 * 60_000, chromeSync));
  const firefox = await boot(createBrowser('firefox', 60 * 60_000));
  const profiles = [chromeA, chromeB, firefox];

  const workspaces = new Oracle();
  const icons = new Oracle();
  const settings = new Map<string, { stamp: number; value: unknown }>();
  const folderIcons = new Oracle();
  const folderOf = new Map<string, string>();
  let created = 0;

  const createOn = async (p: Profile): Promise<void> => {
    const id = `ws-${seed}-${created++}`;
    const stored = await p.storage.createWorkspaceFromUser(workspace(id));
    workspaces.wrote(id, stored.updatedAt ?? 0, stored);
  };

  for (const p of profiles) await on(p, createOn);

  for (let step = 0; step < 150; step += 1) {
    clock += 1 + Math.floor(random() * 5_000);
    const p = pick(profiles);
    const roll = random();
    await on(p, async current => {
      const locals = await current.storage.readWorkspaces();
      if (roll < 0.2 && locals.length) {
        const target = pick(locals);
        const stored = await current.storage.patchWorkspaceFromUser(target.id, { accentColor: `#${Math.floor(random() * 0xffffff).toString(16).padStart(6, '0')}` });
        workspaces.wrote(target.id, stored.updatedAt ?? 0, stored);
      } else if (roll < 0.26 && created < 14) {
        await createOn(current);
      } else if (roll < 0.32 && locals.length) {
        const target = pick(locals);
        await current.storage.deleteWorkspaceFromUser(target.id);
        const marker = (await current.storage.readDeletionMarkers()).find(m => m.kind === 'workspace' && m.key === target.id);
        workspaces.deleted(target.id, marker?.deletedAt ?? 0);
      } else if (roll < 0.42) {
        const key = random() < 0.5 ? 'themeMode' : 'showClock';
        const value = key === 'themeMode' ? pick(THEMES) : random() < 0.5;
        const next = await current.storage.patchSettingsFromUser({ [key]: value });
        const stamp = next.settingsUpdatedAt?.[key] ?? 0;
        const known = settings.get(key);
        if (!known || stamp > known.stamp) settings.set(key, { stamp, value: next[key] });
      } else if (roll < 0.46 && locals.length) {
        const order = [...locals.map(w => w.id)].sort(() => random() - 0.5);
        await current.storage.patchSettingsFromUser({ workspaceOrder: order });
      } else if (roll < 0.5 && locals.length) {
        current.activeWorkspaceId = pick(locals).id;
        await current.storage.patchSettingsFromUser({ activeWorkspaceId: current.activeWorkspaceId });
      } else if (roll < 0.56) {
        const url = pick(ICON_URLS);
        const record: IconOverrideRecord = {
          overrideKey: `exact:${url}`, scope: 'exact', bookmarkUrl: url,
          dataUrl: `data:image/png;base64,${step}`, fileName: 'i.png', mimeType: 'image/png', updatedAt: 0,
        };
        const stored = await current.storage.writeIconOverrideFromUser(record);
        icons.wrote(stored.overrideKey, stored.updatedAt, stored);
      } else if (roll < 0.59) {
        const url = pick(ICON_URLS);
        if (!currentBrowser().overrides.has(`exact:${url}`)) return;
        await current.storage.deleteIconOverridesForUrlFromUser(url);
        const marker = (await current.storage.readDeletionMarkers()).find(m => m.kind === 'iconOverride' && m.key === `exact:${url}`);
        icons.deleted(`exact:${url}`, marker?.deletedAt ?? 0);
      } else if (roll < 0.63) {
        const folderId = pick(FOLDER_IDS);
        const dataUrl = `data:image/png;base64,f${step}`;
        const locator = buildFolderLocator(TREE, folderId) ?? undefined;
        const stored: FolderIconOverrideRecord = await current.storage.writeFolderIconFromUser({ folderId, dataUrl, mimeType: 'image/png', updatedAt: 0, locator });
        folderIcons.wrote(stored.syncId ?? '', stored.updatedAt, dataUrl);
        folderOf.set(stored.syncId ?? '', folderId);
      } else if (roll < 0.65) {
        const folderId = pick(FOLDER_IDS);
        const existing = currentBrowser().folderIcons.get(folderId);
        if (!existing) return;
        await current.storage.deleteFolderIconFromUser(folderId);
        const marker = (await current.storage.readDeletionMarkers()).find(m => m.kind === 'folderIcon' && m.key === existing.syncId);
        folderIcons.deleted(existing.syncId ?? '', marker?.deletedAt ?? 0);
      } else if (roll < 0.88) {
        await current.syncNow.runSyncNow();
      } else if (accountSync === 'delayed') {
        accountSyncCopy(chromeA.browser, chromeB.browser, () => random() < 0.5);
      }
    });
  }

  for (let round = 0; round < 2; round += 1) {
    clock += 1_000;
    for (const p of profiles) await on(p, current => current.syncNow.runSyncNow());
  }

  const states: unknown[] = [];
  for (const p of profiles) states.push(await syncedState(p));
  expect(states[1], `seed ${seed}: chrome-b differs from chrome-a`).toEqual(states[0]);
  expect(states[2], `seed ${seed}: firefox differs from chrome-a`).toEqual(states[0]);

  if (accountSync === 'shared') assertNewestSurvived(seed, states[0] as FinalState, workspaces, icons, settings, folderIcons, folderOf);
  const final = states[0] as FinalState;
  const live = new Set(final.workspaces.map(w => w.id));
  expect(new Set(final.settings.workspaceOrder as string[])).toEqual(live);

  // Per-browser choices never leave the browser and never get reset by sync.
  const shared = server as { settings: Record<string, unknown> };
  expect(shared.settings).not.toHaveProperty('activeWorkspaceId');
  expect(shared.settings).not.toHaveProperty('dockFolderId');
  for (const p of profiles) {
    if (!p.activeWorkspaceId) continue;
    const active = await on(p, async current => (await current.storage.readSettings()).activeWorkspaceId);
    expect(active, `seed ${seed}: ${p.browser.name} active workspace`).toBe(p.activeWorkspaceId);
  }

  // A sync with nothing new writes nothing, anywhere.
  const before = structuredClone(server);
  for (const p of profiles) resetWrites(p.browser);
  clock += 1_000;
  for (const p of profiles) await on(p, current => current.syncNow.runSyncNow());
  for (const p of profiles) expect(totalWrites(p.browser), `seed ${seed}: ${p.browser.name} wrote on a quiet sync`).toBe(0);
  expect(server).toEqual({ ...(before as object), exportedAt: (server as { exportedAt: number }).exportedAt });
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => {
    let offset = 0;
    try {
      offset = currentBrowser().offset;
    } catch {
      // Module setup outside a browser context reads the plain clock.
    }
    return clock + offset;
  });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  setCurrentBrowser(null);
  currentBackground = null;
});

describe('three browsers syncing through one server', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    it(`converge without losing the newest version of anything (seed ${seed})`, async () => {
      await runScenario(seed, 'shared');
    });
    it(`converge when Chrome account sync delivers keys late and out of order (seed ${seed})`, async () => {
      await runScenario(seed, 'delayed');
    });
  }

  it('two syncs in a row with no change in between write nothing the second time', async () => {
    clock = START;
    server = null;
    const solo = await boot(createBrowser('solo'));
    await on(solo, async p => {
      const created = await p.storage.createWorkspaceFromUser({ ...workspace('w'), backgroundMode: 'wallpaper' });
      await p.storage.writeWorkspaceWallpaper(created.id, 'data:image/png;base64,W');
      await p.storage.patchSettingsFromUser({ themeMode: 'dark', workspaceOrder: ['w'] });
      await p.storage.writeBookmarkUsageRecord({ bookmarkId: 'b1', usedAt: START });
      await p.storage.writeIconOverrideFromUser({
        overrideKey: 'exact:https://a.example/', scope: 'exact', bookmarkUrl: 'https://a.example/',
        dataUrl: 'data:image/png;base64,A', fileName: 'a.png', mimeType: 'image/png', updatedAt: 0,
      });
      await p.syncNow.runSyncNow();
      clock += 1_000;
      await p.syncNow.runSyncNow();
      resetWrites(p.browser);
      clock += 1_000;
      await p.syncNow.runSyncNow();
      expect(totalWrites(p.browser)).toBe(0);
    });
  });
});
