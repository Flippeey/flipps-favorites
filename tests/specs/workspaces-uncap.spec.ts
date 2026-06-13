/**
 * Workspaces uncap (#19): cap raised to 20, desktop jump-menu, edge fade,
 * Alt+Arrow prev/next cycling.
 *
 * Why these tests matter:
 * - Users need to create more than 9 workspaces without hitting a silent block.
 * - The jump-menu must list all workspaces so high-index ones are reachable
 *   without scrolling the strip.
 * - Alt+Arrow shortcuts are the only keyboard path to workspaces 10–20.
 */
import { test, expect } from '../fixtures/world.js';
import { createTestFolder, removeBookmarkTree } from '../fixtures/bookmark-helpers.js';
import { createWorkspace } from '../fixtures/seeding.js';
import { workspaceTab } from '../fixtures/selectors.js';
import { DEFAULT_WORKSPACE_SETTINGS } from '../fixtures/test-data.js';
import { MAX_WORKSPACES } from '../../src/shared/constants.js';
import type { WorkspaceRecord } from '../../src/shared/models.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/** Seed N workspaces (above the seeded promo 5) and return their folder ids for cleanup. */
async function seedExtraWorkspaces(page: Parameters<typeof createWorkspace>[0], count: number): Promise<{ folderIds: string[]; workspaceIds: string[] }> {
  const folderIds: string[] = [];
  const workspaceIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const idx = i + 6; // promo world already has 5
    const folderId = await createTestFolder(page, `Extra WS Folder ${idx}`);
    folderIds.push(folderId);
    const wsId = `extra-ws-${idx}`;
    workspaceIds.push(wsId);
    await createWorkspace(page, makeWorkspaceRecord(wsId, `Extra ${idx}`, folderId, '#888888'));
  }
  return { folderIds, workspaceIds };
}

// ---------------------------------------------------------------------------
// Cap is now 20 (was 9)
// ---------------------------------------------------------------------------

test('MAX_WORKSPACES constant equals 20', () => {
  // Guard against inadvertent regression to the old cap of 9.
  expect(MAX_WORKSPACES).toBe(20);
});

test('can create workspaces past the old cap of 9 up to 12', async ({ freshPage }) => {
  // Dismiss onboarding if it appears.
  const skipBtn = freshPage.getByRole('button', { name: 'Skip' });
  if (await skipBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await skipBtn.click();
    await freshPage.locator('.ff-onboard').waitFor({ state: 'detached', timeout: 5_000 });
  }

  const TARGET = 12; // comfortably past the old cap of 9
  const folderIds: string[] = [];
  for (let i = 0; i < TARGET; i++) {
    const folderId = await createTestFolder(freshPage, `Cap Test Folder ${i + 1}`);
    folderIds.push(folderId);
    await createWorkspace(
      freshPage,
      makeWorkspaceRecord(`cap-test-ws-${i}`, `Cap WS ${i + 1}`, folderId),
    );
  }

  await freshPage.evaluate(async (ids) => {
    const api = (globalThis as unknown as { browser?: { runtime: { sendMessage(m: unknown): Promise<unknown> } }; chrome: { runtime: { sendMessage(m: unknown): Promise<unknown> } } }).browser
      ?? (globalThis as unknown as { chrome: { runtime: { sendMessage(m: unknown): Promise<unknown> } } }).chrome;
    await api.runtime.sendMessage({
      type: 'settings/patch',
      patch: { activeWorkspaceId: ids[0], workspaceOrder: ids },
    });
  }, Array.from({ length: TARGET }, (_, i) => `cap-test-ws-${i}`));

  await freshPage.reload();
  await freshPage.waitForSelector('.ff-app', { timeout: 15_000 });

  // All 12 tabs must appear in the strip.
  await expect(freshPage.locator('.ff-ws-tab')).toHaveCount(TARGET, { timeout: 8_000 });

  // The 10th tab (index 9) must exist — it's beyond the old cap.
  await expect(workspaceTab(freshPage, 'cap-test-ws-9')).toBeAttached({ timeout: 5_000 });

  // The Add workspace item must still be enabled (we're at 12, cap is 20).
  await freshPage.getByRole('button', { name: 'Add', exact: true }).click();
  const addWorkspaceItem = freshPage.locator('.ff-ctx__item').filter({ hasText: 'Add workspace' });
  await expect(addWorkspaceItem).toBeVisible();
  await expect(addWorkspaceItem).toBeEnabled();
  // Dismiss the menu.
  await freshPage.keyboard.press('Escape');

  // Cleanup.
  for (const id of folderIds) {
    await removeBookmarkTree(freshPage, id);
  }
});

test('Add workspace is disabled at the new cap of 20', async ({ freshPage }) => {
  // Dismiss onboarding if it appears.
  const skipBtn = freshPage.getByRole('button', { name: 'Skip' });
  if (await skipBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await skipBtn.click();
    await freshPage.locator('.ff-onboard').waitFor({ state: 'detached', timeout: 5_000 });
  }

  const folderIds: string[] = [];
  for (let i = 0; i < MAX_WORKSPACES; i++) {
    const folderId = await createTestFolder(freshPage, `Max Cap Folder ${i + 1}`);
    folderIds.push(folderId);
    await createWorkspace(
      freshPage,
      makeWorkspaceRecord(`max-cap-ws-${i}`, `Max WS ${i + 1}`, folderId),
    );
  }

  await freshPage.evaluate(async (ids) => {
    const api = (globalThis as unknown as { browser?: { runtime: { sendMessage(m: unknown): Promise<unknown> } }; chrome: { runtime: { sendMessage(m: unknown): Promise<unknown> } } }).browser
      ?? (globalThis as unknown as { chrome: { runtime: { sendMessage(m: unknown): Promise<unknown> } } }).chrome;
    await api.runtime.sendMessage({
      type: 'settings/patch',
      patch: { activeWorkspaceId: ids[0], workspaceOrder: ids },
    });
  }, Array.from({ length: MAX_WORKSPACES }, (_, i) => `max-cap-ws-${i}`));

  await freshPage.reload();
  await freshPage.waitForSelector('.ff-app', { timeout: 15_000 });

  await expect(freshPage.locator('.ff-ws-tab')).toHaveCount(MAX_WORKSPACES, { timeout: 8_000 });

  await freshPage.getByRole('button', { name: 'Add', exact: true }).click();
  const addWorkspaceItem = freshPage.locator('.ff-ctx__item').filter({ hasText: 'Add workspace' });
  await expect(addWorkspaceItem).toBeVisible();
  await expect(addWorkspaceItem).toBeDisabled();
  await freshPage.keyboard.press('Escape');

  for (const id of folderIds) {
    await removeBookmarkTree(freshPage, id);
  }
});

// ---------------------------------------------------------------------------
// Desktop jump-menu
// ---------------------------------------------------------------------------

test('jump-menu trigger is visible on desktop alongside the strip', async ({ newtabPage }) => {
  // The .ff-ws-dropdown should be visible at desktop widths (>480px).
  // world has 5 promo workspaces — the trigger badge shows 5.
  await expect(newtabPage.locator('.ff-ws-dropdown')).toBeVisible();
  const trigger = newtabPage.locator('.ff-ws-dropdown .ff-pill');
  await expect(trigger).toBeVisible();
});

test('jump-menu lists all workspaces including extra ones', async ({ newtabPage, world }) => {
  // Seed extra workspaces (3 more, total 8).
  const { folderIds } = await seedExtraWorkspaces(newtabPage, 3);

  await newtabPage.reload();
  await newtabPage.waitForSelector('.ff-app', { timeout: 15_000 });

  // Open the jump-menu.
  await newtabPage.locator('.ff-ws-dropdown .ff-pill').click();
  const panel = newtabPage.locator('.ff-ws-dropdown__panel');
  await expect(panel).toBeVisible({ timeout: 3_000 });

  // All 8 workspaces (5 promo + 3 extra) must appear in the listbox.
  const options = panel.locator('[role="option"]');
  await expect(options).toHaveCount(world.workspaces.length + 3, { timeout: 5_000 });

  // The active workspace (Work) must be marked data-active=true.
  const activeOption = panel.locator('[data-active="true"]');
  await expect(activeOption).toHaveCount(1);

  // Close the panel.
  await newtabPage.keyboard.press('Escape');

  for (const id of folderIds) {
    await removeBookmarkTree(newtabPage, id);
  }
});

test('jump-menu can switch to a workspace', async ({ newtabPage, world }) => {
  // Open the jump-menu and click the Personal workspace option.
  await newtabPage.locator('.ff-ws-dropdown .ff-pill').click();
  const panel = newtabPage.locator('.ff-ws-dropdown__panel');
  await expect(panel).toBeVisible({ timeout: 3_000 });

  // Click "Personal" option.
  await panel.locator('[role="option"]').filter({ hasText: 'Personal' }).click();

  // The Personal tab must now be active.
  await expect(workspaceTab(newtabPage, world.workspaceIds.Personal)).toHaveClass(/is-active/, {
    timeout: 2_000,
  });
  // The panel must close.
  await expect(panel).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Edge fade (scroll arrows + fade toggling)
// ---------------------------------------------------------------------------

test('scroll arrows appear when tab strip overflows', async ({ newtabPage }) => {
  // Seed enough workspaces to overflow a standard viewport.
  const { folderIds } = await seedExtraWorkspaces(newtabPage, 10); // 15 total

  await newtabPage.reload();
  await newtabPage.waitForSelector('.ff-app', { timeout: 15_000 });

  // With 15 tabs the strip must overflow at normal viewport width.
  // The right scroll arrow must be visible.
  await expect(newtabPage.locator('.ff-ws-scroll--right')).toBeVisible({ timeout: 5_000 });

  for (const id of folderIds) {
    await removeBookmarkTree(newtabPage, id);
  }
});

// ---------------------------------------------------------------------------
// Alt+Arrow keyboard shortcuts
// ---------------------------------------------------------------------------

test('Alt+ArrowRight cycles to next workspace', async ({ newtabPage, world }) => {
  // Work (index 0) is active. Alt+Right must move to Personal (index 1).
  await expect(workspaceTab(newtabPage, world.workspaceIds.Work)).toHaveClass(/is-active/);

  await newtabPage.keyboard.press('Alt+ArrowRight');

  await expect(workspaceTab(newtabPage, world.workspaceIds.Personal)).toHaveClass(/is-active/, {
    timeout: 2_000,
  });
  await expect(workspaceTab(newtabPage, world.workspaceIds.Work)).not.toHaveClass(/is-active/);
});

test('Alt+ArrowLeft cycles to previous workspace', async ({ newtabPage, world }) => {
  // Switch to Personal (index 1) first, then Alt+Left must return to Work (index 0).
  const personalTab = workspaceTab(newtabPage, world.workspaceIds.Personal);
  await personalTab.click();
  await expect(personalTab).toHaveClass(/is-active/, { timeout: 2_000 });

  await newtabPage.keyboard.press('Alt+ArrowLeft');

  await expect(workspaceTab(newtabPage, world.workspaceIds.Work)).toHaveClass(/is-active/, {
    timeout: 2_000,
  });
});

test('Alt+ArrowRight wraps from last workspace to first', async ({ newtabPage, world }) => {
  // Switch to Gaming (last, index 4) then Alt+Right must wrap to Work (index 0).
  const gamingTab = workspaceTab(newtabPage, world.workspaceIds.Gaming);
  await gamingTab.click();
  await expect(gamingTab).toHaveClass(/is-active/, { timeout: 2_000 });

  await newtabPage.keyboard.press('Alt+ArrowRight');

  await expect(workspaceTab(newtabPage, world.workspaceIds.Work)).toHaveClass(/is-active/, {
    timeout: 2_000,
  });
});

test('Alt+ArrowLeft wraps from first workspace to last', async ({ newtabPage, world }) => {
  // Work is active (index 0). Alt+Left must wrap to Gaming (index 4).
  await expect(workspaceTab(newtabPage, world.workspaceIds.Work)).toHaveClass(/is-active/);

  await newtabPage.keyboard.press('Alt+ArrowLeft');

  await expect(workspaceTab(newtabPage, world.workspaceIds.Gaming)).toHaveClass(/is-active/, {
    timeout: 2_000,
  });
});
