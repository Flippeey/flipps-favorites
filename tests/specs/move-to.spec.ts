/**
 * "Move to…" context-menu action: relocate a bookmark to an existing folder
 * without creating a new one (distinct from "Move N to new folder…", which
 * always creates a destination). Covers both within-workspace moves (into a
 * subfolder) and cross-workspace moves — the folder picker's `tree` is the
 * whole browser tree, so every workspace's root is reachable from one dialog.
 *
 * WHY it matters: relocating bookmarks by hand today means dragging across
 * potentially-scrolled, potentially-off-screen targets, or creating a brand
 * new folder just to consolidate into one that already exists. "Move to…"
 * is the keyboard/menu-reachable escape hatch for both. Undo must still work
 * so a wrong destination pick isn't a one-way trip.
 */
import { test, expect } from '../fixtures/world.js';
import { openContextMenu, tileById } from '../fixtures/bookmark-helpers.js';

test.describe('move to…', () => {
  test('bookmark menu exposes a "Move to…" action', async ({ newtabPage, world }) => {
    const tile = tileById(newtabPage, world.bookmarkIdByTitle('GitHub'));
    const menu = await openContextMenu(newtabPage, tile);
    await expect(menu.getByRole('menuitem', { name: /Move to/i })).toBeVisible();
  });

  test('folder menu exposes a "Move to…" action', async ({ newtabPage, world }) => {
    const folder = tileById(newtabPage, world.bookmarkIdByTitle('Project Apollo'));
    const menu = await openContextMenu(newtabPage, folder);
    await expect(menu.getByRole('menuitem', { name: /Move to/i })).toBeVisible();
  });

  // WHY: the headline within-workspace flow — pick an existing subfolder
  // (not "new folder") as the destination, confirm the item actually lands
  // there, then confirm Undo reverses it exactly.
  test('moves a bookmark into an existing subfolder, and Undo restores it', async ({ newtabPage, world }) => {
    const bmId = world.bookmarkIdByTitle('GitHub');
    const tile = tileById(newtabPage, bmId);
    const menu = await openContextMenu(newtabPage, tile);
    await menu.getByRole('menuitem', { name: /Move to/i }).click();

    const dialog = newtabPage.locator('.ff-dialog[role="dialog"]');
    await dialog.waitFor({ state: 'visible', timeout: 5_000 });

    // "Documentation" is nested two levels down: Other bookmarks > Work >
    // Documentation (workspace roots live under the browser's "Other
    // bookmarks" folder). Expand both ancestor rows to reveal it.
    await dialog.locator('button[aria-label="Expand Other bookmarks"]').click();
    await dialog.locator('button[aria-label="Expand Work"]').click();
    await dialog.locator('.ff-card', { hasText: 'Documentation' }).click();
    await dialog.getByRole('button', { name: /Move here/i }).click();

    // The bookmark left the root canvas…
    await expect(
      newtabPage.locator(`.ff-canvas [data-item-id="${bmId}"]`),
    ).toHaveCount(0, { timeout: 8_000 });

    // …and an Undo toast appeared naming the move.
    const toast = newtabPage.locator('.ff-toast', { has: newtabPage.locator('.ff-toast__msg', { hasText: /^Moved/ }) });
    await expect(toast).toBeVisible({ timeout: 5_000 });

    // It's now inside Documentation.
    const docFolder = tileById(newtabPage, world.bookmarkIdByTitle('Documentation'));
    await docFolder.click();
    const overlay = newtabPage.locator('.ff-folder-overlay');
    await expect(overlay).toBeVisible({ timeout: 5_000 });
    await expect(overlay.locator(`[data-item-id="${bmId}"]`)).toBeVisible({ timeout: 5_000 });
    await newtabPage.keyboard.press('Escape');

    // Undo restores it to the root canvas it came from.
    await toast.locator('.ff-toast__action', { hasText: 'Undo' }).click();
    await expect(
      newtabPage.locator(`.ff-canvas [data-item-id="${bmId}"]`),
    ).toBeVisible({ timeout: 8_000 });
  });

  // WHY: the picker must span every workspace, not just the active one — the
  // whole point of "Move to…" over drag-and-drop is reaching a destination
  // that isn't currently visible on screen, including another workspace.
  test('moves a bookmark into another workspace via the workspace jump row', async ({ newtabPage, world }) => {
    const bmId = world.bookmarkIdByTitle('Slack');
    const tile = tileById(newtabPage, bmId);
    const menu = await openContextMenu(newtabPage, tile);
    await menu.getByRole('menuitem', { name: /Move to/i }).click();

    const dialog = newtabPage.locator('.ff-dialog[role="dialog"]');
    await dialog.waitFor({ state: 'visible', timeout: 5_000 });

    await dialog.getByRole('button', { name: 'Personal', exact: true }).click();
    await dialog.getByRole('button', { name: /Move here/i }).click();

    // Left Work's root canvas…
    await expect(
      newtabPage.locator(`.ff-canvas [data-item-id="${bmId}"]`),
    ).toHaveCount(0, { timeout: 8_000 });

    // …and now lives at the root of the Personal workspace.
    await newtabPage.locator(`[data-workspace-id="${world.workspaceIds.Personal}"]`).click();
    await expect(newtabPage.locator(`.ff-canvas [data-item-id="${bmId}"]`)).toBeVisible({ timeout: 8_000 });
  });
});
