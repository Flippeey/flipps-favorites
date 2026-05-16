import type { Locator, Page } from '@playwright/test';
import { STORAGE_KEYS } from './test-data.js';

export async function clearExtensionStorage(page: Page): Promise<void> {
  await page.evaluate(async (keys) => {
    const api = (globalThis as any).browser || (globalThis as any).chrome;
    await api.storage.local.remove(Object.values(keys));
    try {
      await api.storage.sync.remove(keys.appSettings);
    } catch {
      await api.storage.local.remove(keys.appSettings);
    }
  }, STORAGE_KEYS);
}

export async function createTestFolder(page: Page, title = '__test__'): Promise<string> {
  return page.evaluate(async (folderTitle) => {
    const api = (globalThis as any).browser || (globalThis as any).chrome;
    // parentId "1" = Bookmarks bar on Chromium; Firefox accepts it too.
    const folder = await api.bookmarks.create({ parentId: '1', title: folderTitle });
    return folder.id as string;
  }, title);
}

export async function createTestBookmark(
  page: Page,
  parentId: string,
  title: string,
  url: string,
): Promise<string> {
  return page.evaluate(
    async (args) => {
      const api = (globalThis as any).browser || (globalThis as any).chrome;
      const bm = await api.bookmarks.create({ parentId: args.parentId, title: args.title, url: args.url });
      return bm.id as string;
    },
    { parentId, title, url },
  );
}

export async function createSubFolder(page: Page, parentId: string, title: string): Promise<string> {
  return page.evaluate(
    async (args) => {
      const api = (globalThis as any).browser || (globalThis as any).chrome;
      const folder = await api.bookmarks.create({ parentId: args.parentId, title: args.title });
      return folder.id as string;
    },
    { parentId, title },
  );
}

export async function removeBookmarkTree(page: Page, id: string): Promise<void> {
  await page.evaluate(async (bookmarkId) => {
    const api = (globalThis as any).browser || (globalThis as any).chrome;
    await api.bookmarks.removeTree(bookmarkId).catch(() => undefined);
  }, id);
}

/**
 * Update settings via the runtime message pipeline so the service worker's
 * CachedValueStore is the source of truth. Caller must reload the newtab page
 * to see the change.
 */
export async function patchSettings(
  page: Page,
  patch: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(async (p) => {
    const api = (globalThis as any).browser || (globalThis as any).chrome;
    await api.runtime.sendMessage({ type: 'settings/patch', patch: p });
  }, patch);
}

export async function setRootFolderId(page: Page, folderId: string): Promise<void> {
  await patchSettings(page, { rootFolderId: folderId, rememberLastFolder: false });
}

export async function reloadNewtab(page: Page): Promise<void> {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ff-app', { timeout: 15_000 });
}

/**
 * Right-click a target and wait for the React context menu to appear.
 */
export async function openContextMenu(page: Page, target: Locator): Promise<Locator> {
  await target.click({ button: 'right' });
  const menu = page.locator('.ff-ctx');
  await menu.waitFor({ state: 'visible', timeout: 5_000 });
  return menu;
}

/**
 * Click a context menu item by visible label text.
 */
export async function clickMenuItem(menu: Locator, label: string | RegExp): Promise<void> {
  await menu.getByRole('menuitem', { name: label }).click();
}

/**
 * Open the Settings drawer and switch to a named section (general, navigation,
 * appearance, layout, dock, clock, backup, help).
 */
export async function openSettingsSection(
  page: Page,
  section: 'general' | 'navigation' | 'appearance' | 'layout' | 'dock' | 'clock' | 'backup' | 'help',
): Promise<void> {
  if (await page.locator('.ff-drawer').count() === 0) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.waitForSelector('.ff-drawer', { timeout: 5_000 });
  }
  const label = section.charAt(0).toUpperCase() + section.slice(1);
  await page.locator('.ff-drawer__navitem').filter({ hasText: label }).click();
}

export function tileById(page: Page | Locator, id: string): Locator {
  return page.locator(`.ff-tile[data-item-id="${id}"]`);
}
