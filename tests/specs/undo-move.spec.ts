/**
 * Undo toast for relocations (parent changes) of bookmarks / folders.
 *
 * WHY this matters: a stray drag silently relocates items with no one-click
 * recovery. Delete already has an Undo toast; moves now mirror it. Each test
 * encodes the user-visible promise — "I moved something by accident, one click
 * puts it back exactly where it was" — not just the DOM shape.
 *
 * Drag mechanics mirror dragdrop.spec.ts / useDrag.ts:
 *  1. pointerdown on source tile
 *  2. pointermove past DRAG_THRESHOLD (6px) to engage
 *  3. pointermove to hover target (center of folder = "drop inside")
 *  4. pointerup → onCommit
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

const DRAG_THRESHOLD = 6; // must match useDrag.ts

async function pointerDrag(page: Page, src: BoundingBox, dst: BoundingBox, steps = 12): Promise<void> {
  const srcX = src.x + src.width / 2;
  const srcY = src.y + src.height / 2;
  const dstX = dst.x + dst.width / 2;
  const dstY = dst.y + dst.height / 2;

  await page.mouse.move(srcX, srcY);
  await page.mouse.down();
  const overShoot = DRAG_THRESHOLD + 2;
  await page.mouse.move(srcX + overShoot, srcY + 1);
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      srcX + overShoot + ((dstX - (srcX + overShoot)) * i) / steps,
      srcY + 1 + ((dstY - (srcY + 1)) * i) / steps,
    );
  }
  await page.mouse.up();
}

const undoToast = (page: Page) =>
  page.locator('.ff-toast', { has: page.locator('.ff-toast__msg', { hasText: /^Moved/ }) });

test.describe('undo move', () => {
  test.beforeEach(async ({ newtabPage }) => {
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

  // WHY: the headline promise. Drag a bookmark into a folder, then Undo must put
  // it back in the root scope it came from — otherwise the safety net is a lie.
  test('drag into folder shows Undo, and Undo restores the bookmark to root', async ({ newtabPage }) => {
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

    await pointerDrag(newtabPage, srcBox, dst);

    // The item left root…
    await expect(
      newtabPage.locator(`.ff-canvas [data-item-id="${srcId}"][data-item-kind="bookmark"]`),
    ).toHaveCount(0, { timeout: 8_000 });

    // …and an Undo toast appeared.
    const toast = undoToast(newtabPage);
    await expect(toast).toBeVisible({ timeout: 5_000 });

    // Click Undo → bookmark is back in the root canvas scope.
    await toast.locator('.ff-toast__action', { hasText: 'Undo' }).click();
    await expect(
      newtabPage.locator(`.ff-canvas [data-item-id="${srcId}"][data-item-kind="bookmark"]`),
    ).toBeVisible({ timeout: 8_000 });
  });

  // WHY: positioning between siblings (reorder) is explicitly NOT a relocation —
  // it must NOT push a "Moved" Undo toast, or the toast becomes noise on every
  // drag and the feature loses meaning.
  test('reordering within the same scope shows no Undo toast', async ({ newtabPage }) => {
    const tiles = newtabPage.locator('.ff-canvas [data-item-id][data-item-kind="bookmark"]');
    const firstId = await tiles.nth(0).getAttribute('data-item-id');
    const secondId = await tiles.nth(1).getAttribute('data-item-id');
    if (!firstId || !secondId) throw new Error('expected bookmark tiles');

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

    // Wait for the reorder to commit (dragged tile now sits second)…
    await newtabPage.waitForFunction(
      (expectedSecondId: string) => {
        const els = document.querySelectorAll<HTMLElement>(
          '.ff-canvas [data-item-id][data-item-kind="bookmark"]',
        );
        return els[0]?.dataset.itemId === expectedSecondId;
      },
      secondId,
      { timeout: 8_000 },
    );

    // …and confirm no "Moved" Undo toast was raised.
    await expect(undoToast(newtabPage)).toHaveCount(0);
  });

  // WHY: "Move N to new folder" creates a folder AND moves items. A true reversal
  // restores the items to origin AND deletes the now-empty folder — otherwise
  // Undo leaves orphan clutter behind.
  test('move to new folder shows Undo, and Undo restores items and removes the new folder', async ({ newtabPage }) => {
    const rootBookmarks = newtabPage.locator('.ff-canvas [data-item-id][data-item-kind="bookmark"]');
    const firstTile = rootBookmarks.nth(0);
    const secondTile = rootBookmarks.nth(1);
    const firstId = await firstTile.getAttribute('data-item-id');
    const secondId = await secondTile.getAttribute('data-item-id');
    if (!firstId || !secondId) throw new Error('source bookmarks not found');

    const foldersBefore = await newtabPage
      .locator('.ff-canvas [data-item-id][data-item-kind="folder"]')
      .count();

    // Ctrl/Meta-click selects tiles (a plain click would navigate to the URL).
    // "Move N to new folder…" only renders for a multi-selection (size > 1).
    await firstTile.click({ modifiers: ['ControlOrMeta'] });
    await secondTile.click({ modifiers: ['ControlOrMeta'] });
    await expect(firstTile).toHaveAttribute('data-selected', 'true', { timeout: 5_000 });
    await expect(secondTile).toHaveAttribute('data-selected', 'true', { timeout: 5_000 });
    await secondTile.click({ button: 'right' });
    const menu = newtabPage.locator('.ff-ctx[role="menu"]');
    await menu.waitFor({ state: 'visible', timeout: 5_000 });
    await menu.locator('[role="menuitem"]', { hasText: /Move .* to new folder/i }).click();

    // Name the new folder, then create it.
    const dialog = newtabPage.locator('.ff-dialog[role="dialog"]').first();
    await dialog.waitFor({ state: 'visible', timeout: 5_000 });
    await dialog.locator('input.ff-input').fill('Undo Target');
    await dialog.locator('button', { hasText: /Create folder/i }).click();

    // Both bookmarks left root and a new folder appeared.
    await expect(
      newtabPage.locator(`.ff-canvas [data-item-id="${firstId}"][data-item-kind="bookmark"]`),
    ).toHaveCount(0, { timeout: 8_000 });
    await expect(
      newtabPage.locator(`.ff-canvas [data-item-id="${secondId}"][data-item-kind="bookmark"]`),
    ).toHaveCount(0, { timeout: 8_000 });
    await expect(
      newtabPage.locator('.ff-canvas [data-item-id][data-item-kind="folder"]'),
    ).toHaveCount(foldersBefore + 1, { timeout: 8_000 });

    // Undo → both bookmarks back in root AND the new folder is gone (count restored).
    const toast = undoToast(newtabPage);
    await expect(toast).toBeVisible({ timeout: 5_000 });
    await toast.locator('.ff-toast__action', { hasText: 'Undo' }).click();

    await expect(
      newtabPage.locator(`.ff-canvas [data-item-id="${firstId}"][data-item-kind="bookmark"]`),
    ).toBeVisible({ timeout: 8_000 });
    await expect(
      newtabPage.locator(`.ff-canvas [data-item-id="${secondId}"][data-item-kind="bookmark"]`),
    ).toBeVisible({ timeout: 8_000 });
    await expect(
      newtabPage.locator('.ff-canvas [data-item-id][data-item-kind="folder"]'),
    ).toHaveCount(foldersBefore, { timeout: 8_000 });
  });
});
