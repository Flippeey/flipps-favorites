import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookmarkNode, FolderBinding, FolderIconOverrideRecord, WorkspaceRecord } from '@/shared/models';
import { buildFolderLocator, locatorHash } from '@/newtab/lib/folder-locator';
import { createBrowser, idbModule, setCurrentBrowser, type FakeBrowser } from '../lib/sync-browser-fake';

vi.mock('@/shared/icon-idb', () => idbModule);

type Bindings = typeof import('@/background/folder-bindings');
type Storage = typeof import('@/shared/storage');

const tree = (...children: BookmarkNode[]): BookmarkNode[] =>
  [{ id: '0', title: '', children: [{ id: '1', title: 'Bookmarks bar', folderType: 'bookmarks-bar', children }] }];
const dir = (id: string, title: string, urls: string[] = []): BookmarkNode =>
  ({ id, title, children: urls.map((url, i) => ({ id: `${id}-${i}`, title: url, url })) });
const WORK_URLS = ['https://a.example', 'https://b.example', 'https://c.example', 'https://d.example', 'https://e.example'];

function workspace(id: string, extra: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
  return {
    id, name: `Workspace ${id}`, rootFolderId: '', themeMode: 'system', accentColor: '#3F72DC', backgroundMode: 'gradient',
    solidBackgroundColor: '', gradientStyle: 'top', gradientColorSource: 'accent', gradientCustomColor: '#3F72DC',
    gradientIntensity: 100, backgroundOpacity: 70, backgroundFitMode: 'cover', backgroundPositionMode: 'center',
    layoutPreset: 'balanced', favoritesColumnGap: 24, favoritesRowGap: 20, bookmarkTileWidth: 130, bookmarkIconSize: 75,
    tileShape: 'squircle', showTileLabels: true, folderMode: 'grid', bookmarkSortMode: 'manual', bookmarkSortDirection: 'asc',
    ...extra,
  };
}

let browser: FakeBrowser;
let bindings: Bindings;
let storage: Storage;

beforeEach(async () => {
  browser = createBrowser('solo');
  setCurrentBrowser(browser);
  vi.resetModules();
  bindings = await import('@/background/folder-bindings');
  storage = await import('@/shared/storage');
});

afterEach(() => setCurrentBrowser(null));

const bound = (localId: string, record?: WorkspaceRecord): FolderBinding =>
  ({ localId, locatorHash: locatorHash(record?.rootFolder), state: 'bound' });

describe('overlayWorkspace', () => {
  it('shows only a bound folder; a synced id is never shown as-is, even when it exists here', () => {
    const record = workspace('w', { rootFolderId: '57' });
    expect(bindings.overlayWorkspace(record, {}, [])).toMatchObject({ rootFolderId: '', folderState: 'waiting' });
    expect(bindings.overlayWorkspace(record, { w: bound('90') }, [])).toMatchObject({ rootFolderId: '90' });
    expect(bindings.overlayWorkspace(record, { w: { ...bound('90'), state: 'lost' } }, [])).toMatchObject({ rootFolderId: '', folderState: 'lost' });
    expect(bindings.overlayWorkspace(record, { w: bound('90') }, ['w'])).toMatchObject({ rootFolderId: '', folderState: 'unused' });
  });
});

describe('backfillBindings', () => {
  it('binds records whose stored folder exists here, and leaves existing bindings and missing folders alone', () => {
    const records = [workspace('a', { rootFolderId: 'f1' }), workspace('b', { rootFolderId: 'gone' }), workspace('c', { rootFolderId: 'f1' })];
    const existing = { c: bound('f2') };
    const once = bindings.backfillBindings(records, existing, tree(dir('f1', 'One'), dir('f2', 'Two')));
    expect(once).toEqual({ a: bound('f1'), c: bound('f2') });
    expect(bindings.backfillBindings(records, once, tree(dir('f1', 'One'), dir('f2', 'Two')))).toEqual(once);
  });
});

describe('nextBindings', () => {
  const workTree = tree(dir('w1', 'Work', WORK_URLS));
  const record = workspace('w', { rootFolderId: 'other-browser', rootFolder: buildFolderLocator(workTree, 'w1') ?? undefined });

  it('binds a waiting workspace once its bookmarks arrive', () => {
    expect(bindings.nextBindings([record], {}, tree())).toEqual({});
    expect(bindings.nextBindings([record], {}, tree(dir('late', 'Work', WORK_URLS)))).toEqual({ w: bound('late', record) });
  });

  it('turns a bound folder lost when it is deleted, and binds again when it is found', () => {
    const lost = bindings.nextBindings([record], { w: bound('w1', record) }, tree());
    expect(lost).toEqual({ w: { ...bound('w1', record), state: 'lost' } });
    expect(bindings.nextBindings([record], lost, workTree)).toEqual({ w: bound('w1', record) });
  });

  it('drops a binding made for an older locator instead of showing the old folder', () => {
    const changed = { ...record, rootFolder: { rootKind: 'toolbar' as const, path: ['Elsewhere'], fingerprint: [] } };
    expect(bindings.nextBindings([changed], { w: bound('w1', record) }, workTree)).toEqual({});
  });
});

describe('resolveFolderBindings', () => {
  it('backfills once, into local storage only, and a second pass writes nothing', async () => {
    await storage.createWorkspaceFromUser(workspace('legacy', { rootFolderId: 'f1', name: 'No such title' }));
    browser.local.writes = 0;
    browser.sync.writes = 0;
    const here = tree(dir('f1', 'Anything'));

    await bindings.resolveFolderBindings(here);
    expect(await storage.readFolderBindings()).toEqual({ legacy: bound('f1') });
    expect(browser.sync.writes).toBe(0);
    expect([...browser.sync.data.keys()].some(key => key.includes('binding'))).toBe(false);

    browser.local.writes = 0;
    await bindings.resolveFolderBindings(here);
    expect(browser.local.writes).toBe(0);
    expect(browser.sync.writes).toBe(0);
  });

  it('never backfills again once done, so a removed binding is not recreated from the synced id', async () => {
    await storage.createWorkspaceFromUser(workspace('legacy', { rootFolderId: 'f1', name: 'No such title' }));
    await bindings.resolveFolderBindings(tree(dir('f1', 'Anything')));
    await storage.updateFolderBindings(() => ({}));
    await bindings.resolveFolderBindings(tree(dir('f1', 'Anything')));
    expect(await storage.readFolderBindings()).toEqual({});
  });

  it('places pending usage on the one bookmark with that URL and keeps the rest pending', async () => {
    await storage.writePendingUsage({ 'https://one.example': 50, 'https://dup.example': 40, 'https://absent.example': 30 });
    const here = tree({ id: 'u1', title: 'One', url: 'https://one.example/' }, dir('d', 'Dups', ['https://dup.example', 'https://dup.example/']));
    await bindings.resolveFolderBindings(here);
    expect((await storage.readBookmarkUsageRecords())['u1']?.usedAt).toBe(50);
    expect(await storage.readPendingUsage()).toEqual({ 'https://dup.example': 40, 'https://absent.example': 30 });
  });

  it('two icons for one folder: the newer keeps it and the older is retired with a marker', async () => {
    const now = Date.now();
    const here = tree(dir('f', 'Work', WORK_URLS));
    const locator = buildFolderLocator(here, 'f') ?? undefined;
    const icon = (syncId: string, updatedAt: number): FolderIconOverrideRecord =>
      ({ folderId: 'elsewhere', syncId, locator, dataUrl: `data:image/png;base64,${syncId}`, mimeType: 'image/png', updatedAt });
    await storage.writeFolderIconOverride({ ...icon('held', now - 100), folderId: 'f' });
    await storage.writePendingFolderIcon(icon('older', now - 140));
    await storage.writePendingFolderIcon(icon('newer', now));

    await bindings.resolveFolderBindings(here);

    expect((await storage.readFolderIconOverride('f'))?.syncId).toBe('newer');
    expect(await storage.readPendingFolderIcons()).toEqual([]);
    const markers = (await storage.readDeletionMarkers()).filter(m => m.kind === 'folderIcon');
    expect(markers).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'older', deletedAt: now - 100 }),
      expect.objectContaining({ key: 'held', deletedAt: now }),
    ]));
  });
});
