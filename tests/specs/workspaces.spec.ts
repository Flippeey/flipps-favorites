/**
 * Workspaces: tab visibility, creation, switching, and accent-color application.
 */
import { test, expect } from '../fixtures/extension-context.js';
import {
  clearExtensionStorage,
  createTestFolder,
  reloadNewtab,
  removeBookmarkTree,
} from '../fixtures/bookmark-helpers.js';

/** Minimal workspace record matching the WorkspaceRecord shape. */
function makeWorkspace(id: string, name: string, rootFolderId: string, accentColor: string) {
  return {
    id,
    name,
    rootFolderId,
    accentColor,
    backgroundMode: 'gradient',
    solidBackgroundColor: '',
    gradientStyle: 'top',
    gradientColorSource: 'accent',
    gradientCustomColor: accentColor,
    gradientIntensity: 100,
    backgroundOpacity: 70,
    backgroundFitMode: 'cover',
    backgroundPositionMode: 'center',
    layoutPreset: 'balanced',
    favoritesColumns: 10,
    favoritesRows: 0,
    favoritesColumnGap: 24,
    favoritesRowGap: 20,
    bookmarkTileWidth: 130,
    bookmarkIconSize: 75,
    tileShape: 'squircle',
    showBookmarkIconBackground: false,
    showAccentBackground: true,
    showTileLabels: true,
  };
}

/** Send a runtime message through the extension's service worker. */
async function sendMessage(page: import('@playwright/test').Page, msg: unknown): Promise<unknown> {
  return page.evaluate(async (m) => {
    const api = (globalThis as any).chrome;
    return api.runtime.sendMessage(m);
  }, msg);
}

/** Clear all extension storage (sync + local) so each test starts clean. */
async function clearAllStorage(page: import('@playwright/test').Page): Promise<void> {
  await clearExtensionStorage(page);
  // clearExtensionStorage only removes 'app-settings' from sync, not the 'workspaces' key.
  // Clear it explicitly so workspace records from prior test runs don't persist.
  await page.evaluate(async () => {
    const api = (globalThis as any).chrome;
    try {
      await api.storage.sync.remove('workspaces');
    } catch {
      // Firefox / unavailable sync: ignore
    }
  });
}

// ─── Shared state ────────────────────────────────────────────────────────────

let rootId: string;

test.beforeEach(async ({ newtabPage }) => {
  await clearAllStorage(newtabPage);

  // Create a bookmark folder to serve as the default workspace's root.
  rootId = await createTestFolder(newtabPage, 'Default Root');

  // Seed a single workspace via the message pipeline so the service worker's
  // store is the source of truth.  Do this BEFORE reloading so that
  // migrateToWorkspaces() sees existing records on the next load and skips.
  await sendMessage(newtabPage, {
    type: 'workspaces/create',
    workspace: makeWorkspace('test-ws-1', 'Default Root', rootId, '#3F72DC'),
  });
  await sendMessage(newtabPage, {
    type: 'settings/patch',
    patch: { activeWorkspaceId: 'test-ws-1' },
  });

  await reloadNewtab(newtabPage);
});

test.afterEach(async ({ newtabPage }) => {
  await removeBookmarkTree(newtabPage, rootId);
});

// ─── Tests ───────────────────────────────────────────────────────────────────

test('one workspace tab visible on fresh install', async ({ newtabPage }) => {
  const tabs = newtabPage.locator('.ff-ws-tab');
  await expect(tabs).toHaveCount(1);
});

test('creating a workspace adds a second tab', async ({ newtabPage }) => {
  const folderId2 = await createTestFolder(newtabPage, 'Work');

  await sendMessage(newtabPage, {
    type: 'workspaces/create',
    workspace: makeWorkspace('test-ws-2', 'Work', folderId2, '#23867B'),
  });

  await reloadNewtab(newtabPage);

  const tabs = newtabPage.locator('.ff-ws-tab');
  await expect(tabs).toHaveCount(2);

  await removeBookmarkTree(newtabPage, folderId2);
});

test('clicking a workspace tab makes it active', async ({ newtabPage }) => {
  const folderId2 = await createTestFolder(newtabPage, 'Work');

  await sendMessage(newtabPage, {
    type: 'workspaces/create',
    workspace: makeWorkspace('test-ws-2', 'Work', folderId2, '#23867B'),
  });

  await reloadNewtab(newtabPage);

  const tabs = newtabPage.locator('.ff-ws-tab');
  await expect(tabs).toHaveCount(2);

  // First tab starts active (activeWorkspaceId = 'test-ws-1')
  await expect(tabs.first()).toHaveClass(/is-active/);
  await expect(tabs.nth(1)).not.toHaveClass(/is-active/);

  // Switch to the second workspace
  await tabs.nth(1).click();

  await expect(tabs.nth(1)).toHaveClass(/is-active/);
  await expect(tabs.first()).not.toHaveClass(/is-active/);

  await removeBookmarkTree(newtabPage, folderId2);
});

test('switching workspace applies the workspace accent color', async ({ newtabPage }) => {
  const folderId2 = await createTestFolder(newtabPage, 'Work');
  // Use a visually distinct accent so the comparison cannot produce a false pass.
  const distinctAccent = '#C75252';

  await sendMessage(newtabPage, {
    type: 'workspaces/create',
    workspace: makeWorkspace('test-ws-2', 'Work', folderId2, distinctAccent),
  });

  await reloadNewtab(newtabPage);

  // Capture the accent before switching.
  const accentBefore = await newtabPage.evaluate(() =>
    document.documentElement.style.getPropertyValue('--accent').trim()
  );

  // Switch to the second workspace.
  await newtabPage.locator('.ff-ws-tab').nth(1).click();

  // The accent CSS variable must change to reflect the new workspace color.
  await expect.poll(async () =>
    newtabPage.evaluate(() =>
      document.documentElement.style.getPropertyValue('--accent').trim()
    )
  ).not.toBe(accentBefore);

  await removeBookmarkTree(newtabPage, folderId2);
});
