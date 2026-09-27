// Steps for multi-browser sync scenarios, on top of the sync UI driver
// (sync-ui.ts). Harness-agnostic like the driver: everything runs through
// SyncPage.evaluate, so the Playwright Chrome specs and the Puppeteer
// Chrome/Firefox specs share them.
//
// User edits go through the same background handlers the UI calls, so they
// are stamped exactly as a click would stamp them. Bookmark folders are
// created through each browser's own bookmarks API, so every browser has its
// own folder ids, as in real life.
import type { AppSettings, WorkspaceRecord, WorkspaceView } from '@/shared/models';
import { DEFAULT_WORKSPACE_SETTINGS, MOCK_FAVICON_PNG } from './test-data.js';
import {
  confirmLink,
  openSyncSettings,
  readWorkspaces,
  revealPairingCode,
  submitPairingCode,
  syncNow,
  waitFor,
  type SyncPage,
} from './sync-ui.js';

export interface BookmarkSeed {
  title: string;
  url: string;
}

export interface FolderSeed {
  /** Top-level root the path starts under: Chrome's bar is Firefox's toolbar, Chrome's Other is Firefox's unfiled. */
  root: 'bar' | 'other';
  /** Folder titles below the root, outermost first; the last one holds `bookmarks`. */
  path: string[];
  bookmarks: BookmarkSeed[];
}

async function send<R>(page: SyncPage, message: unknown): Promise<R> {
  const response = await page.evaluate(async (msg) => {
    type Api = { runtime: { sendMessage(m: unknown): Promise<unknown> } };
    const api = (globalThis as unknown as { browser?: Api; chrome: Api }).browser
      ?? (globalThis as unknown as { chrome: Api }).chrome;
    return api.runtime.sendMessage(msg);
  }, message);
  if (response && typeof response === 'object' && ('__error' in response || '__syncError' in response)) {
    throw new Error(`Background rejected ${JSON.stringify(message)}: ${JSON.stringify(response)}`);
  }
  return response as R;
}

/** Mark onboarding done (as of now) so the page boots straight into the app. */
export async function completeOnboarding(page: SyncPage): Promise<void> {
  await page.evaluate(async () => {
    type Api = { storage: { local: { set(items: Record<string, unknown>): Promise<void> } } };
    const api = (globalThis as unknown as { browser?: Api; chrome: Api }).browser
      ?? (globalThis as unknown as { chrome: Api }).chrome;
    const now = Date.now();
    await api.storage.local.set({
      'onboarding-state': {
        version: 2,
        status: 'completed',
        updatedAt: now,
        completedAt: now,
        skippedAt: now,
        recommendedArchetype: null,
        chosenArchetype: 'skipped',
      },
    });
  }, undefined);
}

/** Create the folder path (and its bookmarks) in this browser; returns the innermost folder's id. */
export async function addFolder(page: SyncPage, seed: FolderSeed): Promise<string> {
  return page.evaluate(async (data) => {
    type Node = { id: string; title: string; folderType?: string; children?: Node[] };
    type Api = {
      bookmarks: {
        getTree(): Promise<Node[]>;
        create(b: { parentId: string; title: string; url?: string }): Promise<{ id: string }>;
      };
    };
    const api = (globalThis as unknown as { browser?: Api; chrome: Api }).browser
      ?? (globalThis as unknown as { chrome: Api }).chrome;
    const roots = (await api.bookmarks.getTree())[0]?.children ?? [];
    const isBar = (n: Node): boolean => n.id === '1' || n.id === 'toolbar_____' || n.folderType === 'bookmarks-bar';
    const isOther = (n: Node): boolean => n.id === '2' || n.id === 'unfiled_____' || n.folderType === 'other';
    const root = roots.find(data.root === 'bar' ? isBar : isOther);
    if (!root) throw new Error(`No ${data.root} bookmark root in this browser`);
    let parentId = root.id;
    for (const title of data.path) {
      parentId = (await api.bookmarks.create({ parentId, title })).id;
    }
    for (const bookmark of data.bookmarks) {
      await api.bookmarks.create({ parentId, title: bookmark.title, url: bookmark.url });
    }
    return parentId;
  }, seed);
}

/** Give a folder a custom icon the way the folder edit dialog's upload does. */
export async function setFolderIcon(page: SyncPage, folderId: string): Promise<void> {
  await send(page, {
    type: 'icons/set-folder-icon',
    folderId,
    dataUrl: `data:image/png;base64,${MOCK_FAVICON_PNG.toString('base64')}`,
    mimeType: 'image/png',
    fileName: 'folder-icon.png',
  });
}

/** Create a folder (and its bookmarks) inside an existing one; returns its id. */
export async function addChildFolder(page: SyncPage, parentId: string, title: string, bookmarks: BookmarkSeed[]): Promise<string> {
  return page.evaluate(async (data) => {
    type Api = { bookmarks: { create(b: { parentId: string; title: string; url?: string }): Promise<{ id: string }> } };
    const api = (globalThis as unknown as { browser?: Api; chrome: Api }).browser
      ?? (globalThis as unknown as { chrome: Api }).chrome;
    const folder = await api.bookmarks.create({ parentId: data.parentId, title: data.title });
    for (const bookmark of data.bookmarks) {
      await api.bookmarks.create({ parentId: folder.id, title: bookmark.title, url: bookmark.url });
    }
    return folder.id;
  }, { parentId, title, bookmarks });
}

/** Remove a folder's custom icon the way the folder edit dialog does. */
export async function clearFolderIcon(page: SyncPage, folderId: string): Promise<void> {
  await send(page, { type: 'icons/remove-folder-icon', folderId, recordDeletion: true });
}

/** Give a bookmark a custom icon the way the edit dialog does (host scope, its default); returns the image the tile shows. */
export async function setIconOverride(page: SyncPage, bookmarkUrl: string, png: Buffer): Promise<string> {
  const res = await send<{ icon: { dataUrl: string } }>(page, {
    type: 'icons/set-override',
    bookmarkUrl,
    dataUrl: `data:image/png;base64,${png.toString('base64')}`,
    fileName: 'override.png',
    mimeType: 'image/png',
    scope: 'host',
  });
  return res.icon.dataUrl;
}

/** The edit dialog's Remove custom icon. */
export async function clearIconOverride(page: SyncPage, bookmarkUrl: string): Promise<void> {
  await send(page, { type: 'icons/remove-override', bookmarkUrl });
}

/** Keys of the icon overrides this browser stores. */
export async function iconOverrideKeys(page: SyncPage): Promise<string[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const req = indexedDB.open('ff-icons');
      req.onsuccess = () => resolveOpen(req.result);
      req.onerror = () => rejectOpen(req.error);
    });
    try {
      if (!db.objectStoreNames.contains('overrides')) return [];
      return await new Promise<string[]>((resolveKeys, rejectKeys) => {
        const req = db.transaction('overrides', 'readonly').objectStore('overrides').getAllKeys();
        req.onsuccess = () => resolveKeys(req.result.map(String).sort());
        req.onerror = () => rejectKeys(req.error);
      });
    } finally {
      db.close();
    }
  }, undefined);
}

/** Whether this browser stores a custom icon for the folder. */
export async function hasFolderIcon(page: SyncPage, folderId: string): Promise<boolean> {
  const res = await send<{ icon: unknown }>(page, { type: 'icons/get-folder-icon', folderId });
  return res.icon !== null && res.icon !== undefined;
}

/**
 * Pick a wallpaper for a workspace the way Appearance does: switch its
 * background to Wallpaper, store the image, and stamp the workspace so the
 * change syncs.
 */
export async function setWallpaper(page: SyncPage, workspaceId: string, dataUrl: string): Promise<void> {
  await writeLocalStorageKey(page, `app-wallpaper-${workspaceId}`, dataUrl);
  await editWorkspace(page, workspaceId, { backgroundMode: 'wallpaper' });
}

/** The wallpaper card's trash button: the image goes, the Wallpaper background mode stays. */
export async function clearWallpaper(page: SyncPage, workspaceId: string): Promise<void> {
  await writeLocalStorageKey(page, `app-wallpaper-${workspaceId}`, '');
  await editWorkspace(page, workspaceId, {});
}

export async function storedWallpaper(page: SyncPage, workspaceId: string): Promise<string> {
  const value = await readLocalStorageKey(page, `app-wallpaper-${workspaceId}`);
  return typeof value === 'string' ? value : '';
}

/** Wait until the page paints the active workspace's wallpaper; throws if it never does. */
export async function waitForWallpaperShown(page: SyncPage): Promise<void> {
  await page.evaluate(async () => {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const layer = document.querySelector<HTMLElement>('.ff-bg-wallpaper[data-active="true"]');
      if (layer && getComputedStyle(layer).backgroundImage.startsWith('url(')) return;
      if (Date.now() > deadline) throw new Error('The wallpaper never rendered');
      await new Promise((resolveTick) => setTimeout(resolveTick, 50));
    }
  }, undefined);
}

export async function wallpaperShown(page: SyncPage): Promise<boolean> {
  return page.evaluate(() => {
    const layer = document.querySelector<HTMLElement>('.ff-bg-wallpaper[data-active="true"]');
    return layer !== null && getComputedStyle(layer).backgroundImage.startsWith('url(');
  }, undefined);
}

/** Wait until the folder tile titled `title` shows a custom icon, and return its image source. */
export async function waitForFolderIconShown(page: SyncPage, title: string): Promise<string> {
  return page.evaluate(async (folderTitle) => {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const tile = Array.from(document.querySelectorAll('.ff-tile[data-item-kind="folder"]'))
        .find((el) => el.querySelector('.ff-tile__label')?.textContent === folderTitle);
      const src = tile?.querySelector<HTMLImageElement>('.ff-folder-tile__custom-image')?.getAttribute('src');
      if (src) return src;
      if (Date.now() > deadline) throw new Error(`Folder tile "${folderTitle}" never showed a custom icon`);
      await new Promise((resolveTick) => setTimeout(resolveTick, 50));
    }
  }, title);
}

/** Wait until the folder tile titled `title` is on the page; throws if it never appears. */
export async function waitForFolderTile(page: SyncPage, title: string): Promise<void> {
  await waitFor(page, { selector: '.ff-tile[data-item-kind="folder"] .ff-tile__label', text: title });
}

export async function folderIconShown(page: SyncPage, title: string): Promise<boolean> {
  return page.evaluate((folderTitle) => {
    const tile = Array.from(document.querySelectorAll('.ff-tile[data-item-kind="folder"]'))
      .find((el) => el.querySelector('.ff-tile__label')?.textContent === folderTitle);
    return tile?.querySelector('.ff-folder-tile__custom-image') != null;
  }, title);
}

/** Wait until the bookmark tile titled `title` shows exactly the image `src`; throws if it never does. */
export async function waitForBookmarkIcon(page: SyncPage, title: string, src: string): Promise<void> {
  await page.evaluate(async (data) => {
    const deadline = Date.now() + 15_000;
    let seen: string | null | undefined;
    for (;;) {
      const tile = Array.from(document.querySelectorAll('.ff-tile[data-item-kind="bookmark"]'))
        .find((el) => el.querySelector('.ff-tile__label')?.textContent === data.title);
      seen = tile?.querySelector('.ff-tile__icon img')?.getAttribute('src');
      if (seen === data.src) return;
      if (Date.now() > deadline) throw new Error(`Bookmark tile "${data.title}" shows ${String(seen).slice(0, 60)}, not the expected icon`);
      await new Promise((resolveTick) => setTimeout(resolveTick, 50));
    }
  }, { title, src });
}

export async function removeFolder(page: SyncPage, folderId: string): Promise<void> {
  await page.evaluate(async (id) => {
    type Api = { bookmarks: { removeTree(id: string): Promise<void> } };
    const api = (globalThis as unknown as { browser?: Api; chrome: Api }).browser
      ?? (globalThis as unknown as { chrome: Api }).chrome;
    await api.bookmarks.removeTree(id);
  }, folderId);
}

export interface WorkspaceSeed {
  id: string;
  name: string;
  folderId: string;
  workspace?: Partial<Omit<WorkspaceRecord, 'id' | 'name' | 'rootFolderId'>>;
}

/** Create a workspace the way the New workspace dialog does. */
export async function addWorkspace(page: SyncPage, seed: WorkspaceSeed): Promise<WorkspaceRecord> {
  const res = await send<{ workspace: WorkspaceRecord }>(page, {
    type: 'workspaces/create',
    workspace: { ...DEFAULT_WORKSPACE_SETTINGS, ...seed.workspace, id: seed.id, name: seed.name, rootFolderId: seed.folderId },
  });
  return res.workspace;
}

/** A user edit of one workspace (rename, accent, …). */
export async function editWorkspace(page: SyncPage, id: string, patch: Partial<WorkspaceRecord>): Promise<void> {
  await send(page, { type: 'workspaces/patch', id, patch });
}

export async function deleteWorkspace(page: SyncPage, id: string): Promise<void> {
  await send(page, { type: 'workspaces/delete', id });
}

export async function editSettings(page: SyncPage, patch: Partial<AppSettings>): Promise<void> {
  await send(page, { type: 'settings/patch', patch });
}

export async function workspaceView(page: SyncPage, id: string): Promise<WorkspaceView | undefined> {
  return (await readWorkspaces(page)).find((ws) => ws.id === id);
}

/** Ids of the workspace tabs this page shows, in tab order. */
export async function shownTabIds(page: SyncPage): Promise<string[]> {
  return page.evaluate(
    () => [...new Set(Array.from(document.querySelectorAll<HTMLElement>('[data-workspace-id]'), (el) => el.dataset.workspaceId ?? ''))],
    undefined,
  );
}

/** Labels of the tiles on the canvas (the active workspace's folder). */
export async function canvasTileLabels(page: SyncPage): Promise<string[]> {
  return page.evaluate(
    () => Array.from(document.querySelectorAll('.ff-canvas .ff-tile__label'), (el) => el.textContent ?? ''),
    undefined,
  );
}

/** Make `id` the active workspace here, reload, and return its canvas tile labels. */
export async function showWorkspace(page: SyncPage, id: string): Promise<string[]> {
  await editSettings(page, { activeWorkspaceId: id });
  await page.reload();
  return canvasTileLabels(page);
}

/** Text of the canvas notice shown instead of bookmarks, or null when bookmarks are shown. */
export async function folderNotice(page: SyncPage): Promise<string | null> {
  return page.evaluate(() => document.querySelector('[data-testid="folder-notice"]')?.textContent ?? null, undefined);
}

/** Press Sync now (opening Settings > Backup first if needed) and return the toast text. */
export async function pressSyncNow(page: SyncPage): Promise<string> {
  const open = await page.evaluate(() => document.querySelector('[data-testid="sync-now-button"]') !== null, undefined);
  if (!open) await openSyncSettings(page);
  return syncNow(page);
}

// The Merge/Replace switch inside the open link preview (Settings > Backup
// has a file-import one of its own).
async function linkModeSwitch(page: SyncPage, click: 'Merge' | 'Replace' | null): Promise<string> {
  return page.evaluate(async (label) => {
    const deadline = Date.now() + 20_000;
    for (;;) {
      let scope = document.querySelector('[data-testid="link-preview-summary"]')?.parentElement ?? null;
      while (scope && !scope.querySelector('.ff-segmented')) scope = scope.parentElement;
      const options = Array.from(scope?.querySelectorAll<HTMLElement>('.ff-segmented__option') ?? []);
      const target = label === null ? undefined : options.find((el) => el.textContent?.trim() === label);
      if (target && target.dataset.active !== 'true') target.click();
      const active = options.find((el) => el.dataset.active === 'true')?.textContent?.trim();
      if (active && (label === null || active === label)) return active;
      if (Date.now() > deadline) throw new Error('Timed out waiting for the link preview mode switch');
      await new Promise((resolveTick) => setTimeout(resolveTick, 50));
    }
  }, click);
}

/** Pick Merge or Replace in the open link preview. */
export async function chooseLinkMode(page: SyncPage, label: 'Merge' | 'Replace'): Promise<void> {
  await linkModeSwitch(page, label);
}

/** The mode the open link preview has selected. */
export async function selectedLinkMode(page: SyncPage): Promise<string> {
  return linkModeSwitch(page, null);
}

/**
 * Link `joiner` to `host` with Merge, then let `host` pick up the joiner's
 * data. Server calls, in order: host GET 404 + PUT, joiner GET 200 + PUT,
 * host GET 200 + PUT. Leaves both pages on Settings > Backup.
 */
export async function linkBrowsers(host: SyncPage, joiner: SyncPage): Promise<string> {
  await openSyncSettings(host);
  const hostSynced = await syncNow(host);
  if (hostSynced !== 'Synced.') throw new Error(`First Sync now failed: ${hostSynced}`);
  const code = await revealPairingCode(host);
  await openSyncSettings(joiner);
  await submitPairingCode(joiner, code);
  await chooseLinkMode(joiner, 'Merge');
  const linked = await confirmLink(joiner);
  if (linked !== 'Linked and synced with the other browser.') throw new Error(`Link failed: ${linked}`);
  const hostCaughtUp = await syncNow(host);
  if (hostCaughtUp !== 'Synced.') throw new Error(`Sync now after linking failed: ${hostCaughtUp}`);
  return code;
}

// What production keeps in chrome.storage.sync, i.e. what Chrome account sync
// copies between Chrome profiles on one Google account: the sync-preferred
// stores of storage.ts and sync-crypto.ts. Everything else (folder bindings,
// per-browser settings, icon markers, one-shot migration markers) is
// storage.local and never leaves the profile.
const ACCOUNT_SYNCED_KEYS = ['app-settings', 'bookmark-usage-records', 'sync-secret'];
const ACCOUNT_SYNCED_PREFIXES = ['workspace:', 'workspace-deleted:'];

/**
 * Copy the account-synced keys from one Chrome profile to another the way
 * Chrome account sync would: straight into storage, without the extension's
 * merge ever seeing them. The Chrome test build keeps sync-preferred stores
 * in storage.local, so that is where both sides read and write. Returns the
 * copied keys.
 */
export async function copyAccountSyncedStorage(from: SyncPage, to: SyncPage): Promise<string[]> {
  const items = await from.evaluate(async (rules) => {
    type Api = { storage: { local: { get(keys: null): Promise<Record<string, unknown>> } } };
    const api = (globalThis as unknown as { chrome: Api }).chrome;
    const all = await api.storage.local.get(null);
    return Object.fromEntries(
      Object.entries(all).filter(([key]) => rules.keys.includes(key) || rules.prefixes.some((p) => key.startsWith(p))),
    );
  }, { keys: ACCOUNT_SYNCED_KEYS, prefixes: ACCOUNT_SYNCED_PREFIXES });
  await to.evaluate(async (copied) => {
    type Api = { storage: { local: { set(items: Record<string, unknown>): Promise<void> } } };
    await (globalThis as unknown as { chrome: Api }).chrome.storage.local.set(copied);
  }, items);
  return Object.keys(items).sort();
}

export async function writeLocalStorageKey(page: SyncPage, key: string, value: unknown): Promise<void> {
  await page.evaluate(async (entry) => {
    type Api = { storage: { local: { set(items: Record<string, unknown>): Promise<void> } } };
    const api = (globalThis as unknown as { browser?: Api; chrome: Api }).browser
      ?? (globalThis as unknown as { chrome: Api }).chrome;
    await api.storage.local.set({ [entry.key]: entry.value });
  }, { key, value });
}

export async function readLocalStorageKey(page: SyncPage, key: string): Promise<unknown> {
  return page.evaluate(async (k) => {
    type Api = { storage: { local: { get(key: string): Promise<Record<string, unknown>> } } };
    const api = (globalThis as unknown as { browser?: Api; chrome: Api }).browser
      ?? (globalThis as unknown as { chrome: Api }).chrome;
    return (await api.storage.local.get(k))[k];
  }, key);
}
