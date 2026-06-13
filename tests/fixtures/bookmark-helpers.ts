import type { Locator, Page } from '@playwright/test';
import type { WorkspaceRecord } from '../../src/shared/models';
import { DEFAULT_WORKSPACE_SETTINGS, STORAGE_KEYS } from './test-data.js';

export async function clearExtensionStorage(page: Page): Promise<void> {
  await page.evaluate(async (keys) => {
    const api = (globalThis as any).browser || (globalThis as any).chrome;
    await api.storage.local.remove(Object.values(keys));
    // Settings + workspaces use sync-preferred storage; clear both so state
    // never leaks between tests.
    try {
      await api.storage.sync.remove([keys.appSettings, keys.workspaces]);
    } catch {
      await api.storage.local.remove([keys.appSettings, keys.workspaces]);
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

/**
 * Seed a working active workspace pointing at `rootFolderId` and make it
 * active. Every spec calls this in `beforeEach` instead of the removed
 * `setRootFolderId` — `AppSettings` no longer has `rootFolderId`; the app
 * derives its root folder from `activeWorkspace.rootFolderId`. Caller must
 * reload the newtab page to see the change.
 */
export async function setupDefaultWorkspace(
  page: Page,
  rootFolderId: string,
  id = 'ws-default',
): Promise<WorkspaceRecord> {
  const workspace: WorkspaceRecord = {
    ...DEFAULT_WORKSPACE_SETTINGS,
    id,
    name: 'Test',
    rootFolderId,
  };
  await page.evaluate(async (ws) => {
    const api = (globalThis as any).browser || (globalThis as any).chrome;
    await api.runtime.sendMessage({ type: 'workspaces/create', workspace: ws });
    await api.runtime.sendMessage({
      type: 'settings/patch',
      patch: { activeWorkspaceId: ws.id, workspaceOrder: [ws.id], rememberLastFolder: false },
    });
  }, workspace);
  return workspace;
}

/**
 * Patch a workspace's visual/layout fields via the runtime message pipeline.
 * Workspace-only settings (tileShape, layoutPreset, accentColor, gradients…)
 * live on WorkspaceRecord, not AppSettings — use this, not patchSettings, for
 * those. Defaults to the id seeded by setupDefaultWorkspace. Caller must reload.
 */
export async function patchWorkspace(
  page: Page,
  patch: Partial<WorkspaceRecord>,
  id = 'ws-default',
): Promise<void> {
  await page.evaluate(async (args) => {
    const api = (globalThis as any).browser || (globalThis as any).chrome;
    await api.runtime.sendMessage({ type: 'workspaces/patch', id: args.id, patch: args.patch });
  }, { id, patch });
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

type SettingsSection = 'navigation' | 'appearance' | 'layout' | 'dock' | 'clock' | 'backup' | 'help';
const APP_SECTIONS: ReadonlySet<SettingsSection> = new Set<SettingsSection>(['navigation', 'dock', 'clock', 'backup', 'help']);

/**
 * Open the relevant settings drawer and switch to a named section. App-scoped
 * sections (navigation, dock, clock, backup, help) open via the Settings gear;
 * workspace-scoped sections (appearance, layout) open via the Customize palette.
 */
export async function openSettingsSection(
  page: Page,
  section: SettingsSection,
): Promise<void> {
  const buttonName = APP_SECTIONS.has(section) ? 'Settings' : 'Customize workspace';
  if (await page.locator('.ff-drawer').count() === 0) {
    await page.getByRole('button', { name: buttonName, exact: true }).click();
    await page.waitForSelector('.ff-drawer', { timeout: 5_000 });
  }
  const label = section.charAt(0).toUpperCase() + section.slice(1);
  await page.locator('.ff-drawer__navitem').filter({ hasText: label }).click();
}

export function tileById(page: Page | Locator, id: string): Locator {
  return page.locator(`.ff-tile[data-item-id="${id}"]`);
}

// ---------------------------------------------------------------------------
// Archetype-tree seeders for onboarding-templates.spec.ts
// ---------------------------------------------------------------------------

/**
 * Seeds a flat hoarder tree: `count` bookmarks directly under the bookmarks
 * bar ('1'). No subfolders — the flat structure drives a high Hoarder score.
 *
 * Returns the bookmark ids created. The caller does NOT need to track a root
 * folder id because the tree lives directly under the system bar root ('1').
 *
 * WHY: folderedRatio ≈ 0 (all at root) + high volume (>35) → Hoarder wins.
 */
export async function seedFlatHoarderTree(
  page: Page,
  count = 120,
): Promise<string[]> {
  return page.evaluate(async (n) => {
    const api = (globalThis as any).browser || (globalThis as any).chrome;
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const bm = await api.bookmarks.create({
        parentId: '1',
        title: `Saved ${i + 1}`,
        url: `https://site${i + 1}.example.com/page`,
      });
      ids.push(bm.id as string);
    }
    return ids;
  }, count);
}

/**
 * Seeds a deeply nested organized tree directly under the bookmarks bar ('1'):
 * `folderCount` top-level folders under the bar, each containing a sub-folder,
 * each sub-folder containing `bookmarksPerFolder` bookmarks. Depth=2 + high
 * folderedRatio → Power-user wins when the bar is the selected root.
 *
 * Places folders directly under '1' (bar) so the onboarding step-1 fallback
 * selection (bar '1') already contains the deep organized content, driving
 * folderedRatio≈1.0 through the classifier at step 4.
 *
 * Researcher overlay fires DETERMINISTICALLY in e2e because chrome.bookmarks.create
 * stamps dateAdded=now → recentAdditionRatio≈1.0 for all freshly seeded bookmarks.
 * Callers MUST expect the Researcher hint — do NOT assert its absence.
 */
export async function seedDeepOrganizedTree(
  page: Page,
  folderCount = 8,
  bookmarksPerFolder = 8,
): Promise<void> {
  await page.evaluate(
    async (args) => {
      const api = (globalThis as any).browser || (globalThis as any).chrome;
      for (let f = 0; f < args.folderCount; f++) {
        const topFolder = await api.bookmarks.create({
          parentId: '1',
          title: `Topic ${f + 1}`,
        });
        const subFolder = await api.bookmarks.create({
          parentId: topFolder.id,
          title: `Sub ${f + 1}`,
        });
        for (let b = 0; b < args.bookmarksPerFolder; b++) {
          await api.bookmarks.create({
            parentId: subFolder.id,
            title: `Article ${f + 1}-${b + 1}`,
            url: `https://topic${f + 1}.example.com/article-${b + 1}`,
          });
        }
      }
    },
    { folderCount, bookmarksPerFolder },
  );
}
