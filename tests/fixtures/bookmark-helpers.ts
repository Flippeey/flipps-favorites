import type { Page } from '@playwright/test';
import { STORAGE_KEYS } from './test-data.js';

/**
 * Mark onboarding as completed so the wizard doesn't block tests.
 * The default onboarding state when storage is absent is already 'completed',
 * but calling this explicitly makes tests resilient to profile reuse.
 */
export async function skipOnboarding(page: Page): Promise<void> {
  await page.evaluate((key) => {
    return browser.storage.local.set({
      [key]: {
        version: 1,
        status: 'completed',
        updatedAt: Date.now(),
        completedAt: Date.now(),
        skippedAt: null,
      },
    });
  }, STORAGE_KEYS.onboardingState);
}

/**
 * Clear extension-managed storage so each test starts from a clean slate.
 * Does NOT touch the browser bookmark tree (use removeTestFolder for that).
 */
export async function clearExtensionStorage(page: Page): Promise<void> {
  await page.evaluate(async (keys) => {
    await browser.storage.local.remove(Object.values(keys));
    // app-settings lives in sync-preferred: try sync first, then local.
    try {
      await browser.storage.sync.remove(keys.appSettings);
    } catch {
      await browser.storage.local.remove(keys.appSettings);
    }
  }, STORAGE_KEYS);
}

/**
 * Create a test bookmark folder at the root and return its id.
 * Returns the folder id so tests can navigate to it or clean up.
 */
export async function createTestFolder(page: Page, title = '__test__'): Promise<string> {
  return page.evaluate(async (folderTitle) => {
    const folder = await browser.bookmarks.create({ title: folderTitle });
    return folder.id;
  }, title);
}

/**
 * Create a bookmark inside an existing folder. Returns the bookmark id.
 */
export async function createTestBookmark(
  page: Page,
  folderId: string,
  title: string,
  url: string
): Promise<string> {
  return page.evaluate(
    async ({ folderId, title, url }) => {
      const bm = await browser.bookmarks.create({ parentId: folderId, title, url });
      return bm.id;
    },
    { folderId, title, url }
  );
}

/**
 * Remove a bookmark or folder (and all its children) by id.
 * Silently ignores errors (e.g. if it was already deleted).
 */
export async function removeBookmarkTree(page: Page, id: string): Promise<void> {
  await page.evaluate(async (bookmarkId) => {
    await browser.bookmarks.removeTree(bookmarkId).catch(() => undefined);
  }, id);
}

/**
 * Set the extension's root folder to a given folder id.
 * Uses the settings/patch message so the background's CachedValueStore is updated.
 * Also disables rememberLastFolder so the last-visited folder (persisted to
 * localStorage from prior loads) does not override rootFolderId on reload.
 * The newtab page must be reloaded after calling this.
 */
export async function setRootFolderId(page: Page, folderId: string): Promise<void> {
  await page.evaluate(async (rootFolderId) => {
    await browser.runtime.sendMessage({
      type: 'settings/patch',
      patch: { rootFolderId, rememberLastFolder: false },
    });
  }, folderId);
}

/**
 * Reload the newtab page and wait for the app shell to be ready.
 * Navigates to the base URL (without hash) so resolveInitialFolderId uses
 * rootFolderId from settings instead of the previously-set URL hash.
 */
export async function reloadNewtab(page: Page): Promise<void> {
  const baseUrl = page.url().split('#')[0];
  await page.goto(baseUrl);
  await page.waitForSelector('.shell', { timeout: 15_000 });
}
