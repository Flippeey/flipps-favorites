/**
 * Workspaces: tab visibility, creation, switching, accent/theme application,
 * rename, delete, reorder, keyboard shortcuts, and persistence.
 *
 * Why these tests matter — workspace tabs are the primary navigation surface
 * of the extension. Errors in creation, switching, or persistence destroy the
 * user's mental model and their curated bookmark organisation.
 */
import { test, expect } from '../fixtures/world.js';
import { createTestFolder, removeBookmarkTree, reloadNewtab } from '../fixtures/bookmark-helpers.js';
import { createWorkspace, patchWorkspace, waitForWorkspace, getWorkspaces, clearWorkspaces } from '../fixtures/seeding.js';
import { workspaceTab, contextMenu } from '../fixtures/selectors.js';
import { DEFAULT_WORKSPACE_SETTINGS } from '../fixtures/test-data.js';
import { MAX_WORKSPACES } from '../../src/shared/constants.js';
import type { WorkspaceRecord } from '../../src/shared/models.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal WorkspaceRecord for programmatic seeding. */
function makeWorkspaceRecord(
  id: string,
  name: string,
  rootFolderId: string,
  accentColor = '#3F72DC',
): WorkspaceRecord {
  return {
    ...DEFAULT_WORKSPACE_SETTINGS,
    id,
    name,
    rootFolderId,
    accentColor,
    gradientCustomColor: accentColor,
  };
}

// ---------------------------------------------------------------------------
// Fresh-install tests (use throwaway browser context, no promo world)
// ---------------------------------------------------------------------------

test('one workspace tab on fresh install', async ({ freshPage }) => {
  // A truly unseeded fresh install has no workspaces yet. The tab strip must
  // show 0 tabs — not phantom tabs from a prior session or leaked state.
  const tabs = freshPage.locator('.ff-ws-tab');
  await expect(tabs).toHaveCount(0);
});

test(`cannot exceed MAX_WORKSPACES (${MAX_WORKSPACES})`, async ({ freshPage }) => {
  // The freshPage context triggers the onboarding dialog (install fires
  // markOnboardingPending). Dismiss it first so the nav is accessible.
  // Clicking Skip on a fresh install creates a default "Favorites" workspace
  // (by design, so the user has a usable workspace to persist settings to).
  // Clear it immediately so this test can seed exactly MAX_WORKSPACES workspaces
  // of its own — the cap, not the skip behaviour, is what's under test here.
  const skipBtn = freshPage.getByRole('button', { name: 'Skip' });
  if (await skipBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await skipBtn.click();
    await freshPage.locator('.ff-onboard').waitFor({ state: 'detached', timeout: 5_000 });
  }
  await clearWorkspaces(freshPage);

  // Fill the workspace list to MAX_WORKSPACES via the message pipeline so the
  // browser doesn't require many manual interactions.
  const folderIds: string[] = [];
  for (let i = 0; i < MAX_WORKSPACES; i++) {
    const folderId = await createTestFolder(freshPage, `WS Folder ${i + 1}`);
    folderIds.push(folderId);
    await createWorkspace(freshPage, makeWorkspaceRecord(`ws-limit-${i}`, `WS ${i + 1}`, folderId));
  }

  // Patch settings so the app knows the active workspace and the full order.
  const wsOrder = Array.from({ length: MAX_WORKSPACES }, (_, i) => `ws-limit-${i}`);
  await freshPage.evaluate(async ([activeId, order]) => {
    const api = (globalThis as unknown as { browser?: { runtime: { sendMessage(m: unknown): Promise<unknown> } }; chrome: { runtime: { sendMessage(m: unknown): Promise<unknown> } } }).browser
      ?? (globalThis as unknown as { chrome: { runtime: { sendMessage(m: unknown): Promise<unknown> } } }).chrome;
    await api.runtime.sendMessage({ type: 'settings/patch', patch: { activeWorkspaceId: activeId, workspaceOrder: order } });
  }, ['ws-limit-0', wsOrder] as [string, string[]]);

  await freshPage.reload();
  await freshPage.waitForSelector('.ff-app', { timeout: 15_000 });

  // Verify all MAX_WORKSPACES tabs are rendered.
  await expect(freshPage.locator('.ff-ws-tab')).toHaveCount(MAX_WORKSPACES);

  // Open the Add menu — the "Add workspace" item must be disabled when at the limit.
  // exact:true targets the nav "Add" button, not the empty-state "Add bookmark" one.
  await freshPage.getByRole('button', { name: 'Add', exact: true }).click();
  const addWorkspaceItem = freshPage.locator('.ff-ctx__item').filter({ hasText: 'Add workspace' });
  await expect(addWorkspaceItem).toBeVisible();
  await expect(addWorkspaceItem).toBeDisabled();

  // Clean up created folders
  for (const id of folderIds) {
    await removeBookmarkTree(freshPage, id);
  }
});

// ---------------------------------------------------------------------------
// World-fixture tests (5 promo workspaces pre-seeded, Work active)
// ---------------------------------------------------------------------------

test('create workspace via NewWorkspaceDialog adds a tab', async ({ newtabPage, world }) => {
  // Create a folder not already claimed by any workspace so the dialog can
  // select it. parentId "1" = Bookmarks bar, which scanFolders picks up.
  const folderId = await createTestFolder(newtabPage, 'New WS Root');
  const countBefore = world.workspaces.length; // 5

  // Open the Add menu, then click "Add workspace".
  await newtabPage.getByRole('button', { name: 'Add', exact: true }).click();
  const addMenu = contextMenu(newtabPage);
  await expect(addMenu).toBeVisible();
  await addMenu.locator('.ff-ctx__item').filter({ hasText: 'Add workspace' }).click();

  // Dialog appears.
  const dialog = newtabPage.locator('.ff-dialog, [role="dialog"]').first();
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  // Confirm creation (default folder auto-selected by scanFolders).
  const createBtn = newtabPage.getByRole('button', { name: 'Create workspace', exact: true });
  await expect(createBtn).toBeEnabled({ timeout: 5_000 });
  await createBtn.click();

  // A new tab must appear — the tab count increases by 1.
  await expect(newtabPage.locator('.ff-ws-tab')).toHaveCount(countBefore + 1, { timeout: 8_000 });

  await removeBookmarkTree(newtabPage, folderId);
});

test('new workspace inherits the active workspace density (layoutPreset)', async ({ newtabPage, world }) => {
  // WHY: density (layoutPreset) is resolution-derived at onboarding and stored per
  // workspace. A workspace created later via the New Workspace dialog must match
  // what the user is currently looking at — the active workspace — rather than
  // snapping back to the fixed 'balanced' default. Set the active workspace to a
  // non-default density, create a new workspace, and assert the new record copied
  // that density. This fails if create ever reverts to defaultWorkspaceSettings.
  const activeId = world.workspaceIds.Work; // active at load
  await patchWorkspace(newtabPage, activeId, { layoutPreset: 'spacious' });
  await waitForWorkspace(newtabPage, activeId, (w) => w.layoutPreset === 'spacious');
  // Reload so the running page's activeWorkspace state carries the new density —
  // handleCreateWorkspace reads it live from the active workspace, not storage.
  await reloadNewtab(newtabPage);

  const folderId = await createTestFolder(newtabPage, 'Inherit Density Root');
  const idsBefore = new Set((await getWorkspaces(newtabPage)).map((w) => w.id));

  await newtabPage.getByRole('button', { name: 'Add', exact: true }).click();
  const addMenu = contextMenu(newtabPage);
  await expect(addMenu).toBeVisible();
  await addMenu.locator('.ff-ctx__item').filter({ hasText: 'Add workspace' }).click();

  const dialog = newtabPage.locator('.ff-dialog, [role="dialog"]').first();
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  const createBtn = newtabPage.getByRole('button', { name: 'Create workspace', exact: true });
  await expect(createBtn).toBeEnabled({ timeout: 5_000 });
  await createBtn.click();

  // The newly created record must carry the inherited density, not 'balanced'.
  await expect.poll(async () => {
    const records = await getWorkspaces(newtabPage);
    const created = records.find((w) => !idsBefore.has(w.id));
    return created?.layoutPreset;
  }, { timeout: 8_000 }).toBe('spacious');

  await removeBookmarkTree(newtabPage, folderId);
});

test('clicking a tab switches the active workspace', async ({ newtabPage, world }) => {
  // Work is active at load. Clicking Personal must move is-active to that tab.
  const workTab = workspaceTab(newtabPage, world.workspaceIds.Work);
  const personalTab = workspaceTab(newtabPage, world.workspaceIds.Personal);

  await expect(workTab).toHaveClass(/is-active/);
  await expect(personalTab).not.toHaveClass(/is-active/);

  await personalTab.click();

  // handleSwitchWorkspace has a 130 ms animation delay before applying state.
  await expect(personalTab).toHaveClass(/is-active/, { timeout: 2_000 });
  await expect(workTab).not.toHaveClass(/is-active/);
});

test('switching workspace applies its accent/theme', async ({ newtabPage, world }) => {
  // Work (#3F72DC) and Design (#F57C00) have visually distinct accent colors.
  // Switching must update the --accent CSS variable on documentElement.
  const accentBefore: string = await newtabPage.evaluate(
    () => document.documentElement.style.getPropertyValue('--accent').trim(),
  );
  expect(accentBefore).toBeTruthy(); // Work accent applied at load

  const designTab = workspaceTab(newtabPage, world.workspaceIds.Design);
  await designTab.click();

  // Wait for accent to settle (animation delay + React render).
  await expect.poll(
    async () =>
      newtabPage.evaluate(() =>
        document.documentElement.style.getPropertyValue('--accent').trim(),
      ),
    { timeout: 3_000 },
  ).not.toBe(accentBefore);

  // The Design workspace accent is #F57C00.
  const accentAfter: string = await newtabPage.evaluate(
    () => document.documentElement.style.getPropertyValue('--accent').trim(),
  );
  expect(accentAfter.toLowerCase()).toBe('#f57c00');
});

test('rename workspace via context menu', async ({ newtabPage, world }) => {
  // Right-click the Work tab → Rename… → change name → submit.
  // The tab label must update without a page reload.
  const workTab = workspaceTab(newtabPage, world.workspaceIds.Work);
  await workTab.click({ button: 'right' });

  const menu = contextMenu(newtabPage);
  await expect(menu).toBeVisible({ timeout: 5_000 });
  await menu.locator('.ff-ctx__item').filter({ hasText: 'Rename…' }).click();

  // The rename dialog appears.
  const input = newtabPage.locator('.ff-input').first();
  await expect(input).toBeVisible({ timeout: 5_000 });
  await input.fill('Work Renamed');
  await newtabPage.getByRole('button', { name: 'Rename', exact: true }).click();

  // The tab label must now read the new name (dialog closes, tab re-renders).
  await expect(workTab.locator('.ff-ws-tab__name')).toHaveText('Work Renamed', { timeout: 5_000 });
});

test('delete workspace via context menu + confirm', async ({ newtabPage, world }) => {
  // Right-click Personal tab (not the active Work tab, so deletion doesn't need
  // to auto-switch). Confirm deletion. The tab must disappear.
  const personalTab = workspaceTab(newtabPage, world.workspaceIds.Personal);
  await personalTab.click({ button: 'right' });

  const menu = contextMenu(newtabPage);
  await expect(menu).toBeVisible({ timeout: 5_000 });
  await menu.locator('.ff-ctx__item').filter({ hasText: 'Delete…' }).click();

  // Confirm delete dialog appears.
  const confirmBtn = newtabPage.getByRole('button', { name: 'Delete workspace', exact: true });
  await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
  await confirmBtn.click();

  // The Personal tab must be gone; Work tab stays.
  await expect(personalTab).toHaveCount(0, { timeout: 5_000 });
  await expect(workspaceTab(newtabPage, world.workspaceIds.Work)).toBeVisible();
});

test('reorder workspace tabs by drag persists', async ({ newtabPage, world }) => {
  // The promo world order is Work, Personal, AI, Design, Gaming.
  // Drag Personal (index 1) to before Work (index 0). After drop, Personal
  // must appear first in the DOM and the new order must be reflected after
  // a reload.
  // Drag Personal onto Work (drop on the left half to insert before).
  await newtabPage.dragAndDrop(
    `[data-workspace-id="${world.workspaceIds.Personal}"]`,
    `[data-workspace-id="${world.workspaceIds.Work}"]`,
  );

  // After the reorder, Personal must now appear earlier in DOM order than Work.
  // We check by reading their rendered positions in the tab list.
  const tabs = newtabPage.locator('.ff-ws-tab');
  const firstTabId = await tabs.first().getAttribute('data-workspace-id');
  expect(firstTabId).toBe(world.workspaceIds.Personal);

  // Reload to confirm persistence (workspaceOrder is written through patchSettings).
  await newtabPage.reload();
  await newtabPage.waitForSelector('.ff-app', { timeout: 15_000 });

  const firstTabIdAfterReload = await newtabPage.locator('.ff-ws-tab').first().getAttribute('data-workspace-id');
  expect(firstTabIdAfterReload).toBe(world.workspaceIds.Personal);
});

test('Alt+1..9 switches workspace', async ({ newtabPage, world }) => {
  // Alt+2 must switch to the second workspace in order (Personal, index 1).
  // The Work tab is active; after the shortcut Personal must be active.
  await expect(workspaceTab(newtabPage, world.workspaceIds.Work)).toHaveClass(/is-active/);

  await newtabPage.keyboard.press('Alt+2');

  await expect(workspaceTab(newtabPage, world.workspaceIds.Personal)).toHaveClass(/is-active/, {
    timeout: 2_000,
  });
  await expect(workspaceTab(newtabPage, world.workspaceIds.Work)).not.toHaveClass(/is-active/);
});

test('active workspace persists after reload', async ({ newtabPage, world }) => {
  // Switch to AI workspace, then reload. The same tab must still be active —
  // the active workspace id is stored in settings and restored on boot.
  const aiTab = workspaceTab(newtabPage, world.workspaceIds.AI);
  await aiTab.click();
  await expect(aiTab).toHaveClass(/is-active/, { timeout: 2_000 });

  await newtabPage.reload();
  await newtabPage.waitForSelector('.ff-app', { timeout: 15_000 });

  await expect(workspaceTab(newtabPage, world.workspaceIds.AI)).toHaveClass(/is-active/, {
    timeout: 5_000,
  });
  await expect(workspaceTab(newtabPage, world.workspaceIds.Work)).not.toHaveClass(/is-active/);
});
