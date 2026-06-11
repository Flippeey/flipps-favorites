/**
 * Drag-drop behaviors: reorder within a folder, and move into a folder.
 *
 * WHY each test matters:
 *  - Reorder: manual sort is a core affordance; if drag commits don't persist
 *    the new position the user's organizational effort is silently lost.
 *  - Move into folder: dragging a bookmark onto a folder tile's center zone
 *    must move it into that folder — wrong routing leaves items in the wrong
 *    context with no feedback.
 *
 * Drag mechanics (mirroring useDrag.ts):
 *  1. pointerdown on source tile (button → no preventDefault from React)
 *  2. pointermove by > DRAG_THRESHOLD (6 px) to engage the drag
 *  3. pointermove to hover target — sets data-drop-position / data-drop-target
 *  4. pointerup → onCommit fires
 *
 * We use page.mouse (which synthesises PointerEvents via Playwright's
 * InputManager) and wait on data-* attributes as drag state signals rather
 * than using arbitrary sleeps.
 */
import { test, expect } from '../fixtures/world.js';
import { resetStorage, seedMinimal } from '../fixtures/seeding.js';
import { reloadNewtab, patchSettings } from '../fixtures/bookmark-helpers.js';
import type { Page } from '@playwright/test';

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DRAG_THRESHOLD = 6; // must match useDrag.ts

/**
 * Perform a pointer drag from `src` to `dst`, moving in `steps` increments.
 * The caller should wait on the desired post-drag state itself.
 */
async function pointerDrag(
  page: Page,
  src: BoundingBox,
  dst: BoundingBox,
  steps = 10,
): Promise<void> {
  const srcX = src.x + src.width / 2;
  const srcY = src.y + src.height / 2;
  const dstX = dst.x + dst.width / 2;
  const dstY = dst.y + dst.height / 2;

  await page.mouse.move(srcX, srcY);
  await page.mouse.down();

  // First few steps: travel past DRAG_THRESHOLD to engage the drag.
  const overShoot = DRAG_THRESHOLD + 2;
  await page.mouse.move(srcX + overShoot, srcY + 1);

  // Remaining steps: move toward destination.
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      srcX + overShoot + ((dstX - (srcX + overShoot)) * i) / steps,
      srcY + 1 + ((dstY - (srcY + 1)) * i) / steps,
    );
  }
  await page.mouse.up();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('drag-drop', () => {
  test.beforeEach(async ({ newtabPage }) => {
    // Seed a minimal world: 5 root bookmarks + 1 folder (with 2 bookmarks).
    // Manual sort is required for drag to be enabled (dragEnabled = sortMode === 'manual').
    await resetStorage(newtabPage);
    await seedMinimal(newtabPage, { rootBookmarks: 5, folders: 1, bookmarksPerFolder: 2 });
    await reloadNewtab(newtabPage);
    await patchSettings(newtabPage, {
      bookmarkSortMode: 'manual',
      folderMode: 'grid',
      folderOpenMode: 'overlay',
    });
    await reloadNewtab(newtabPage);
  });

  // -------------------------------------------------------------------------
  test('drag bookmark reorders it within its folder', async ({ newtabPage }) => {
    // The minimal seed places bookmarks as BM 01 … BM 05 then "Folder 1".
    // In manual sort the DOM order reflects insertion order.
    // We drag BM 01 (first tile) after BM 02 (second tile).
    const canvas = newtabPage.locator('.ff-canvas');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('canvas not found');

    // Get stable id of first tile before dragging.
    const allTiles = newtabPage.locator('.ff-canvas [data-item-id][data-item-kind="bookmark"]');
    const firstId = await allTiles.nth(0).getAttribute('data-item-id');
    const secondId = await allTiles.nth(1).getAttribute('data-item-id');
    if (!firstId || !secondId) throw new Error('expected bookmark tiles');

    const srcBox = await allTiles.nth(0).boundingBox();
    const dstBox = await allTiles.nth(1).boundingBox();
    if (!srcBox || !dstBox) throw new Error('tile bounding boxes not found');

    // Drag the first bookmark to the right of the second bookmark
    // (place-after zone: cursor past midpoint of target).
    const dst: BoundingBox = {
      x: dstBox.x + dstBox.width * 0.8,
      y: dstBox.y,
      width: 1,
      height: dstBox.height,
    };

    await pointerDrag(newtabPage, srcBox, dst);

    // After the drag commit + refreshTree, wait for the tree to update.
    // The first tile in the DOM should now be the item that was second before.
    await newtabPage.waitForFunction(
      (expectedSecondId: string) => {
        const tiles = document.querySelectorAll<HTMLElement>(
          '.ff-canvas [data-item-id][data-item-kind="bookmark"]',
        );
        return tiles[0]?.dataset.itemId === expectedSecondId;
      },
      secondId,
      { timeout: 8_000 },
    );

    // Verify the dragged item is now at index 1 (second position).
    const tilesAfter = newtabPage.locator('.ff-canvas [data-item-id][data-item-kind="bookmark"]');
    await expect(tilesAfter.nth(0)).toHaveAttribute('data-item-id', secondId);
    await expect(tilesAfter.nth(1)).toHaveAttribute('data-item-id', firstId);
  });

  // -------------------------------------------------------------------------
  test('drag bookmark into folder moves it out of root scope', async ({ newtabPage }) => {
    // Drag BM 01 onto the "Folder 1" tile's center zone to move it inside.
    const rootBookmarks = newtabPage.locator('.ff-canvas [data-item-id][data-item-kind="bookmark"]');
    const folderTile = newtabPage.locator('.ff-canvas [data-item-id][data-item-kind="folder"]').first();

    const folderId = await folderTile.getAttribute('data-item-id');
    if (!folderId) throw new Error('folder tile not found');

    const srcId = await rootBookmarks.nth(0).getAttribute('data-item-id');
    if (!srcId) throw new Error('source bookmark not found');

    const srcBox = await rootBookmarks.nth(0).boundingBox();
    const folderBox = await folderTile.boundingBox();
    if (!srcBox || !folderBox) throw new Error('tile bounding boxes not found');

    // Target the center of the folder tile — that is the "drop inside" zone
    // (useDrag: directHit && hoverKind === 'folder' && not in side zone).
    const dst: BoundingBox = {
      x: folderBox.x + folderBox.width / 2 - 1,
      y: folderBox.y,
      width: 1,
      height: folderBox.height,
    };

    // Before drag: count root bookmarks.
    const countBefore = await rootBookmarks.count();

    await pointerDrag(newtabPage, srcBox, dst, 12);

    // After the move, the bookmark should no longer be in the root scope.
    // Wait for the tile count to drop (bookmark moved out of root).
    await newtabPage.waitForFunction(
      ({ count, bmId }: { count: number; bmId: string }) => {
        const remaining = document.querySelectorAll<HTMLElement>(
          '.ff-canvas [data-item-id][data-item-kind="bookmark"]',
        );
        // Either tile count dropped, or the specific tile is gone from root.
        return (
          remaining.length < count ||
          !Array.from(remaining).some((el) => el.dataset.itemId === bmId)
        );
      },
      { count: countBefore, bmId: srcId },
      { timeout: 8_000 },
    );

    // The dragged bookmark must not exist in root canvas scope.
    await expect(
      newtabPage.locator(`.ff-canvas [data-item-id="${srcId}"][data-item-kind="bookmark"]`),
    ).toHaveCount(0);

    // Open the folder to confirm the bookmark is now inside.
    await folderTile.click();
    const overlay = newtabPage.locator('.ff-folder-overlay');
    await overlay.waitFor({ state: 'visible', timeout: 5_000 });

    await expect(overlay.locator(`[data-item-id="${srcId}"]`)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Auto-sort (non-manual): relocation must still work; only reordering is gated.
// Regression guard for the bug where ALL drag was disabled off manual sort,
// silently breaking drag-into-folder / drag-to-workspace moves.
// ---------------------------------------------------------------------------

test.describe('drag-drop under auto-sort', () => {
  test.beforeEach(async ({ newtabPage }) => {
    await resetStorage(newtabPage);
    await seedMinimal(newtabPage, { rootBookmarks: 5, folders: 1, bookmarksPerFolder: 2 });
    await reloadNewtab(newtabPage);
    await patchSettings(newtabPage, {
      bookmarkSortMode: 'name',
      bookmarkSortDirection: 'asc',
      folderMode: 'grid',
      folderOpenMode: 'overlay',
    });
    await reloadNewtab(newtabPage);
  });

  // WHY: moving a bookmark into a folder is relocation, not reordering — it must
  // work in every sort mode. This is the capability the bug silently removed.
  test('drag bookmark into folder still relocates under name sort', async ({ newtabPage }) => {
    const rootBookmarks = newtabPage.locator('.ff-canvas [data-item-id][data-item-kind="bookmark"]');
    const folderTile = newtabPage.locator('.ff-canvas [data-item-id][data-item-kind="folder"]').first();
    const srcId = await rootBookmarks.nth(0).getAttribute('data-item-id');
    if (!srcId) throw new Error('source bookmark not found');

    const srcBox = await rootBookmarks.nth(0).boundingBox();
    const folderBox = await folderTile.boundingBox();
    if (!srcBox || !folderBox) throw new Error('tile bounding boxes not found');

    const dst: BoundingBox = {
      x: folderBox.x + folderBox.width / 2 - 1,
      y: folderBox.y,
      width: 1,
      height: folderBox.height,
    };

    await pointerDrag(newtabPage, srcBox, dst, 12);

    // Bookmark left the root scope…
    await expect(
      newtabPage.locator(`.ff-canvas [data-item-id="${srcId}"][data-item-kind="bookmark"]`),
    ).toHaveCount(0, { timeout: 8_000 });

    // …and now lives inside the folder.
    await folderTile.click();
    const overlay = newtabPage.locator('.ff-folder-overlay');
    await overlay.waitFor({ state: 'visible', timeout: 5_000 });
    await expect(overlay.locator(`[data-item-id="${srcId}"]`)).toBeVisible();
  });

  // WHY: positioning between siblings is meaningless under auto-sort, so it's
  // suppressed — and the user is told why instead of the drag silently no-op'ing.
  test('reordering is suppressed under name sort and explains why', async ({ newtabPage }) => {
    const tiles = newtabPage.locator('.ff-canvas [data-item-id][data-item-kind="bookmark"]');
    const srcBox = await tiles.nth(0).boundingBox();
    const dstBox = await tiles.nth(1).boundingBox();
    if (!srcBox || !dstBox) throw new Error('tile bounding boxes not found');

    const dst: BoundingBox = {
      x: dstBox.x + dstBox.width * 0.8,
      y: dstBox.y,
      width: 1,
      height: dstBox.height,
    };

    await pointerDrag(newtabPage, srcBox, dst);

    await expect(
      newtabPage.locator('.ff-toast__msg', { hasText: /Manual sort/i }),
    ).toBeVisible({ timeout: 5_000 });
  });

  // WHY: dragging a bookmark OUT of a folder back to the workspace root is a
  // relocation (its parent changes), not an in-place reorder — so it must commit
  // under auto-sort just like it does under manual. Regression guard for the bug
  // where cross-parent drops were wrongly gated as "reorder" and silently dropped.
  test('drag from a folder section to root relocates under name sort', async ({ newtabPage }) => {
    // List mode renders each folder as an inline section (scope = folder id) above
    // the root grid (scope = root), so a folder→root drag is reachable on one canvas.
    await patchSettings(newtabPage, { folderMode: 'list' });
    await reloadNewtab(newtabPage);

    const section = newtabPage.locator('.ff-sections section[data-scope-folder-id]').first();
    await section.waitFor({ state: 'visible', timeout: 5_000 });

    const srcTile = section.locator('[data-item-id][data-item-kind="bookmark"]').first();
    const srcId = await srcTile.getAttribute('data-item-id');
    if (!srcId) throw new Error('folder bookmark not found');

    const rootTile = newtabPage.locator('.ff-sections > .ff-grid [data-item-id][data-item-kind="bookmark"]').first();
    const srcBox = await srcTile.boundingBox();
    const rootBox = await rootTile.boundingBox();
    if (!srcBox || !rootBox) throw new Error('tile bounding boxes not found');

    await pointerDrag(newtabPage, srcBox, rootBox, 12);

    // The bookmark now lives in the root grid scope…
    await expect(
      newtabPage.locator(`.ff-sections > .ff-grid [data-item-id="${srcId}"]`),
    ).toBeVisible({ timeout: 8_000 });

    // …and no longer inside the folder section.
    await expect(
      newtabPage.locator(`.ff-sections section[data-scope-folder-id] [data-item-id="${srcId}"]`),
    ).toHaveCount(0);
  });
});
