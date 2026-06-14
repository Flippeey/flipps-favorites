/**
 * Icon upload / override — spec after fit control removal (issue #29).
 *
 * WHY: The contain/cover fit control was removed because it had no visible
 * effect — icons are baked into a fixed 160px canvas at upload time, and most
 * favicons are square so cover === contain → zero visible difference. This spec
 * confirms:
 * 1. The Fit segmented control is gone from the Edit dialog.
 * 2. Uploading an icon still works and the preview appears.
 * 3. The override persists across a page reload (IDB durability).
 */
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test, expect } from '../fixtures/extension-context.js';
import { MOCK_FAVICON_PNG } from '../fixtures/test-data.js';
import {
  clearExtensionStorage,
  clickMenuItem,
  createTestBookmark,
  createTestFolder,
  openContextMenu,
  reloadNewtab,
  removeBookmarkTree,
  setupDefaultWorkspace,
} from '../fixtures/bookmark-helpers.js';

test.describe('icon upload after fit control removal', () => {
  let rootId: string;
  let tmpIconPath: string;

  test.beforeEach(async ({ newtabPage }) => {
    await clearExtensionStorage(newtabPage);
    rootId = await createTestFolder(newtabPage, 'Upload Test Root');
    await createTestBookmark(newtabPage, rootId, 'Upload Test Site', 'https://upload-test.example');
    await setupDefaultWorkspace(newtabPage, rootId);

    tmpIconPath = join(tmpdir(), `ff-upload-test-${Date.now()}.png`);
    await writeFile(tmpIconPath, MOCK_FAVICON_PNG);
  });

  test.afterEach(async ({ newtabPage }) => {
    await removeBookmarkTree(newtabPage, rootId);
    await unlink(tmpIconPath).catch(() => undefined);
  });

  test('Fit segmented control is absent from the Edit dialog', async ({ newtabPage }) => {
    await reloadNewtab(newtabPage);

    const tile = newtabPage.locator('.ff-tile[data-item-kind="bookmark"]', { hasText: 'Upload Test Site' }).first();
    await expect(tile).toBeVisible();

    const menu = await openContextMenu(newtabPage, tile);
    await clickMenuItem(menu, /^Edit/);

    const dialog = newtabPage.locator('.ff-modal-scrim');
    await expect(dialog).toBeVisible();

    // The Fit label and Contain/Cover buttons must not exist.
    await expect(dialog.locator('.ff-field__label', { hasText: 'Fit' })).toHaveCount(0);
    await expect(dialog.locator('.ff-segmented__option', { hasText: 'Contain' })).toHaveCount(0);
    await expect(dialog.locator('.ff-segmented__option', { hasText: 'Cover' })).toHaveCount(0);
  });

  test('uploading an icon shows the preview without the fit control', async ({ newtabPage }) => {
    await reloadNewtab(newtabPage);

    const tile = newtabPage.locator('.ff-tile[data-item-kind="bookmark"]', { hasText: 'Upload Test Site' }).first();
    await expect(tile).toBeVisible();

    const menu = await openContextMenu(newtabPage, tile);
    await clickMenuItem(menu, /^Edit/);

    const dialog = newtabPage.locator('.ff-modal-scrim');
    await expect(dialog).toBeVisible();

    const fileInput = dialog.locator('input[type="file"]');
    await fileInput.setInputFiles(tmpIconPath);

    // Preview must appear after upload.
    const previewImg = dialog.locator('.ff-iconpreview img');
    await expect(previewImg).toBeVisible({ timeout: 10_000 });

    // Fit control is still absent (sanity: not injected by upload path).
    await expect(dialog.locator('.ff-segmented__option', { hasText: 'Contain' })).toHaveCount(0);
    await expect(dialog.locator('.ff-segmented__option', { hasText: 'Cover' })).toHaveCount(0);
  });

  test('uploaded icon override persists across a page reload', async ({ newtabPage }) => {
    await reloadNewtab(newtabPage);

    const tile = newtabPage.locator('.ff-tile[data-item-kind="bookmark"]', { hasText: 'Upload Test Site' }).first();
    await expect(tile).toBeVisible();

    const menu = await openContextMenu(newtabPage, tile);
    await clickMenuItem(menu, /^Edit/);

    const dialog = newtabPage.locator('.ff-modal-scrim');
    await expect(dialog).toBeVisible();

    const fileInput = dialog.locator('input[type="file"]');
    await fileInput.setInputFiles(tmpIconPath);
    await expect(dialog.locator('.ff-iconpreview img')).toBeVisible({ timeout: 10_000 });

    // Close the dialog.
    await newtabPage.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 5_000 });

    // Reload and reopen.
    await reloadNewtab(newtabPage);

    const tile2 = newtabPage.locator('.ff-tile[data-item-kind="bookmark"]', { hasText: 'Upload Test Site' }).first();
    await expect(tile2).toBeVisible();

    const menu2 = await openContextMenu(newtabPage, tile2);
    await clickMenuItem(menu2, /^Edit/);

    const dialog2 = newtabPage.locator('.ff-modal-scrim');
    await expect(dialog2).toBeVisible();

    // The override persists — preview img is visible after reload.
    await expect(dialog2.locator('.ff-iconpreview img')).toBeVisible({ timeout: 8_000 });

    // Confirm the stored IDB record has no `fit` field (new records don't write it).
    const storedRecords = await newtabPage.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('ff-icons');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const records: Array<Record<string, unknown>> = await new Promise((resolve, reject) => {
        const req = db.transaction('overrides', 'readonly').objectStore('overrides').getAll();
        req.onsuccess = () => resolve(req.result as Array<Record<string, unknown>>);
        req.onerror = () => reject(req.error);
      });
      return records;
    });

    expect(storedRecords.length).toBeGreaterThan(0);
    // New records written after the removal must not carry a `fit` field.
    for (const record of storedRecords) {
      expect('fit' in record).toBe(false);
    }
  });
});
