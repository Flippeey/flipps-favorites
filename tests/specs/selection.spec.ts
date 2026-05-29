/**
 * Selection behaviors: shift-click range, ctrl/cmd toggle, marquee drag,
 * scope isolation across folder boundaries, Escape to clear, and batch delete
 * confirmation showing the correct count.
 *
 * WHY each test matters:
 *  - Range / toggle: users expect standard OS selection gestures to work for
 *    bulk actions (open all, delete all, drag all).
 *  - Marquee: rubber-band select is the primary discovery path for bulk select;
 *    broken pointer capture means users can never discover batch actions.
 *  - Scope isolation: selecting inside a folder overlay must not bleed into root
 *    scope tiles, preventing accidental bulk operations on the wrong context.
 *  - Escape: the only non-destructive exit from a selection; if it doesn't clear,
 *    stale selection ghosts through subsequent interactions.
 *  - Batch delete count: the confirm dialog must show how many items will be
 *    destroyed — wrong count is a data-loss footgun.
 */
import { test, expect } from '../fixtures/world.js';
import { resetStorage, seedMinimal } from '../fixtures/seeding.js';
import { tileById, tilesInScope } from '../fixtures/selectors.js';
import { reloadNewtab, patchSettings } from '../fixtures/bookmark-helpers.js';
import type { Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait until a tile's data-selected attribute reaches the expected string. */
async function waitSelected(page: Page, id: string, expected: boolean): Promise<void> {
  await page.waitForFunction(
    ({ itemId, val }: { itemId: string; val: string }) => {
      const el = document.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(itemId)}"]`);
      return el?.dataset.selected === val;
    },
    { itemId: id, val: String(expected) },
    { timeout: 5_000 },
  );
}

// ---------------------------------------------------------------------------
// Tests using the seedMinimal world for predictable ordering.
// The promo "Work" world is not used here because navItems order (used for
// shift-range) must exactly match the seeding order, which seedMinimal guarantees.
// ---------------------------------------------------------------------------

test.describe('selection', () => {
  // Use function-scoped reseed for every test so interactions don't bleed.
  let rootFolderId: string;

  test.beforeEach(async ({ newtabPage }) => {
    await resetStorage(newtabPage);
    const seeded = await seedMinimal(newtabPage, { rootBookmarks: 6 });
    rootFolderId = seeded.rootFolderId;
    await reloadNewtab(newtabPage);
    // Grid mode: all bookmarks share a single scope, predictable navItems order.
    await patchSettings(newtabPage, { folderMode: 'grid', bookmarkSortMode: 'manual' });
    await reloadNewtab(newtabPage);
  });

  // -------------------------------------------------------------------------
  test('shift-click selects a range of tiles', async ({ newtabPage }) => {
    // BM 01 is the first tile, BM 03 is the third — shift-clicking should mark
    // all three tiles in the range as selected (range anchored at BM 01).
    //
    // WHY we use Ctrl+click for the anchor: a plain click on a bookmark tile
    // calls handlePickBookmark which navigates the page away. Ctrl+click adds
    // the tile to the selection (setting lastClickedRef) without navigating,
    // so the subsequent Shift+click has a valid anchor.
    const tiles = tilesInScope(newtabPage, rootFolderId);
    const first = tiles.nth(0);
    const third = tiles.nth(2);

    const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';

    // Ctrl+click first tile: selects it and establishes the anchor.
    await first.click({ modifiers: [modKey] });
    await expect(first).toHaveAttribute('data-selected', 'true');

    // Shift-click third tile — expect a range [0..2].
    await third.click({ modifiers: ['Shift'] });

    await expect(tiles.nth(0)).toHaveAttribute('data-selected', 'true');
    await expect(tiles.nth(1)).toHaveAttribute('data-selected', 'true');
    await expect(tiles.nth(2)).toHaveAttribute('data-selected', 'true');
    // Tile outside the range must remain unselected.
    await expect(tiles.nth(3)).toHaveAttribute('data-selected', 'false');
  });

  // -------------------------------------------------------------------------
  test('Ctrl/Cmd-click toggles individual tile selection', async ({ newtabPage }) => {
    const tiles = tilesInScope(newtabPage, rootFolderId);
    const first = tiles.nth(0);
    const second = tiles.nth(1);

    const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';

    // First Ctrl+click: selects the tile.
    await first.click({ modifiers: [modKey] });
    await expect(first).toHaveAttribute('data-selected', 'true');

    // Second tile Ctrl+click: adds to selection.
    await second.click({ modifiers: [modKey] });
    await expect(second).toHaveAttribute('data-selected', 'true');
    // First must still be selected.
    await expect(first).toHaveAttribute('data-selected', 'true');

    // Ctrl+click first again: deselects it.
    await first.click({ modifiers: [modKey] });
    await expect(first).toHaveAttribute('data-selected', 'false');
    // Second must stay selected.
    await expect(second).toHaveAttribute('data-selected', 'true');
  });

  // -------------------------------------------------------------------------
  test('marquee drag selects tiles swept by the rubber-band rectangle', async ({ newtabPage }) => {
    // The canvas (.ff-canvas) is the marquee surface; we start the pointer drag
    // on an empty gap (away from any tile) so useMarquee.onDown does not bail
    // out early on a .ff-tile hit-test. We sweep across the first two columns.
    const canvas = newtabPage.locator('.ff-canvas');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('canvas not found');

    // Find the first tile's bounding box so we can compute a sweep that
    // covers it but starts above the first row.
    const tiles = tilesInScope(newtabPage, rootFolderId);
    const tile1Box = await tiles.nth(0).boundingBox();
    const tile2Box = await tiles.nth(1).boundingBox();
    if (!tile1Box || !tile2Box) throw new Error('tile bounding boxes not found');

    // Start pointer above the first row (within canvas but above all tiles).
    // Move in several steps to cross the DRAG_THRESHOLD and sweep across tiles.
    const startX = tile1Box.x - 4;
    const startY = tile1Box.y - 12;
    const endX = tile2Box.x + tile2Box.width + 4;
    const endY = tile1Box.y + tile1Box.height + 4;

    await newtabPage.mouse.move(startX, startY);
    await newtabPage.mouse.down();
    // Move in steps to trigger the onMove handler and cross threshold.
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      await newtabPage.mouse.move(
        startX + ((endX - startX) * i) / steps,
        startY + ((endY - startY) * i) / steps,
      );
    }
    await newtabPage.mouse.up();

    // At least the first tile should be selected after the marquee sweep.
    await waitSelected(newtabPage, await tiles.nth(0).getAttribute('data-item-id') ?? '', true);
    await expect(tiles.nth(0)).toHaveAttribute('data-selected', 'true');
  });

  // -------------------------------------------------------------------------
  test('selection is scoped per folder — root tiles not selected when selecting inside folder overlay', async ({ newtabPage }) => {
    // Use the promo Work world which has a "Project Apollo" folder.
    // Re-seed with the world already loaded, reload to use it.
    await resetStorage(newtabPage);
    const { seedPromoWorld } = await import('../fixtures/seeding.js');
    const freshWorld = await seedPromoWorld(newtabPage);
    await reloadNewtab(newtabPage);
    await patchSettings(newtabPage, { bookmarkSortMode: 'manual', folderMode: 'grid', folderOpenMode: 'overlay' });
    await reloadNewtab(newtabPage);

    const apolloId = freshWorld.bookmarkIdByTitle('Project Apollo');
    const apolloTile = tileById(newtabPage, apolloId);

    // Select a root tile (GitHub) with Ctrl+click.
    const githubId = freshWorld.bookmarkIdByTitle('GitHub');
    const githubTile = tileById(newtabPage, githubId);
    await githubTile.click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
    await expect(githubTile).toHaveAttribute('data-selected', 'true');

    // Open the Project Apollo folder overlay.
    await apolloTile.click();
    const overlay = newtabPage.locator('.ff-folder-overlay');
    await overlay.waitFor({ state: 'visible', timeout: 5_000 });

    // Select the first tile inside the overlay.
    const overlayTiles = overlay.locator('[data-item-id]');
    const firstOverlayTile = overlayTiles.first();
    await firstOverlayTile.click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
    await expect(firstOverlayTile).toHaveAttribute('data-selected', 'true');

    // The scope of the overlay tile must be the folder id, not the root.
    const overlayScope = await firstOverlayTile.evaluate(
      (el: HTMLElement) => el.closest('[data-scope-folder-id]')?.getAttribute('data-scope-folder-id') ?? '',
    );
    expect(overlayScope).toBe(apolloId);

    // The root GitHub tile must NOT be selected (scopes are different).
    await expect(githubTile).toHaveAttribute('data-selected', 'false');
  });

  // -------------------------------------------------------------------------
  test('Escape clears the selection', async ({ newtabPage }) => {
    const tiles = tilesInScope(newtabPage, rootFolderId);
    const first = tiles.nth(0);
    const second = tiles.nth(1);

    const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';
    await first.click({ modifiers: [modKey] });
    await second.click({ modifiers: [modKey] });
    await expect(first).toHaveAttribute('data-selected', 'true');
    await expect(second).toHaveAttribute('data-selected', 'true');

    await newtabPage.keyboard.press('Escape');

    await expect(first).toHaveAttribute('data-selected', 'false');
    await expect(second).toHaveAttribute('data-selected', 'false');
  });

  // -------------------------------------------------------------------------
  test('batch delete shows correct count and removes selected bookmarks', async ({ newtabPage }) => {
    const tiles = tilesInScope(newtabPage, rootFolderId);
    const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';

    // Select three tiles.
    await tiles.nth(0).click({ modifiers: [modKey] });
    await tiles.nth(1).click({ modifiers: [modKey] });
    await tiles.nth(2).click({ modifiers: [modKey] });

    // Blur any focused tile button so the keydown listener on window receives
    // the Delete key without the active element being a button
    // (useDeleteShortcut only guards against INPUT/TEXTAREA/contenteditable).
    await newtabPage.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    // Trigger delete via Delete key (useDeleteShortcut).
    await newtabPage.keyboard.press('Delete');

    // The confirm dialog (ff-dialog) must show the count "3".
    // ModalDialog renders a .ff-dialog div, not .ff-modal-dialog.
    const dialog = newtabPage.locator('.ff-dialog');
    await dialog.waitFor({ state: 'visible', timeout: 5_000 });
    // Title is "Delete 3 bookmarks?" per ConfirmBatchDeleteDialog.
    await expect(dialog).toContainText('Delete 3 bookmarks');

    // Confirm deletion.
    await dialog.getByRole('button', { name: /Delete 3 bookmarks/ }).click();

    // Dialog must close.
    await dialog.waitFor({ state: 'hidden', timeout: 5_000 });

    // The three tiles should no longer be in the DOM.
    await expect(tiles).toHaveCount(3); // 6 - 3 = 3 remaining
  });
});
