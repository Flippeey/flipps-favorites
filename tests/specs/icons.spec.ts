/**
 * Icon pipeline + Firefox MV3 manifest assertion.
 */
import { test, expect } from '../fixtures/extension-context.js';
import { MOCK_FAVICON_PNG } from '../fixtures/test-data.js';
import {
  clearExtensionStorage,
  createTestBookmark,
  createTestFolder,
  reloadNewtab,
  removeBookmarkTree,
  setupDefaultWorkspace,
} from '../fixtures/bookmark-helpers.js';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(import.meta.url), '..', '..', '..');

// ---------------------------------------------------------------------------
// Firefox-only: manifest must use background.page, not service_worker.
// Reads the build artifact so it passes without a browser fixture.
// ---------------------------------------------------------------------------

test('Firefox manifest uses background.page (MV3 CORS regression check)', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'firefox', 'Firefox-only test');
  const manifest = JSON.parse(
    await readFile(join(rootDir, 'dist', 'firefox', 'manifest.json'), 'utf-8'),
  );
  expect(manifest.background?.page).toBe('background.html');
  expect(manifest.background?.service_worker).toBeUndefined();
});

// ---------------------------------------------------------------------------
// Chrome icon pipeline.
// ---------------------------------------------------------------------------

test.describe('icon pipeline', () => {
  let rootId: string;

  test.beforeEach(async ({ newtabPage }) => {
    await clearExtensionStorage(newtabPage);
    rootId = await createTestFolder(newtabPage, 'Icon Root');
    await createTestBookmark(newtabPage, rootId, 'Example Site', 'https://example.com');
    await setupDefaultWorkspace(newtabPage, rootId);
  });

  test.afterEach(async ({ newtabPage }) => {
    await removeBookmarkTree(newtabPage, rootId);
  });

  test('every bookmark tile renders a favicon container', async ({ newtabPage }) => {
    await reloadNewtab(newtabPage);
    const tiles = newtabPage.locator('.ff-tile[data-item-kind="bookmark"]');
    await expect(tiles.first()).toBeVisible();
    const count = await tiles.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(tiles.nth(i).locator('.ff-favicon')).toBeAttached();
    }
  });

  test('mocked Google S2 favicon flows through to a tile <img>', async ({ context, newtabPage }) => {
    await context.route('https://www.google.com/s2/favicons**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: MOCK_FAVICON_PNG,
      });
    });
    await reloadNewtab(newtabPage);
    const img = newtabPage.locator('.ff-tile[data-item-kind="bookmark"] .ff-favicon img').first();
    await expect(img).toBeVisible({ timeout: 10_000 });
    const src = await img.getAttribute('src');
    expect(src).toMatch(/^data:image\/png/);
  });

  test('all external icon fetches failing â†’ fallback letter renders', async ({ context, newtabPage }) => {
    await context.route('https://www.google.com/s2/favicons**', (route) => route.abort('failed'));
    await context.route('https://duckduckgo.com/**', (route) => route.abort('failed'));
    await reloadNewtab(newtabPage);

    const tile = newtabPage.locator('.ff-tile[data-item-kind="bookmark"]').first();
    await expect(tile).toBeVisible();
    // Either an <img> with a generated fallback dataUrl, or the inline fallback letter span.
    // We can't distinguish "generated SVG" from "S2 success" via DOM alone â€” but absence of
    // CORS errors and presence of *something* (img OR letter span) is the signal.
    await newtabPage.waitForTimeout(2_000);
    const hasImg = (await tile.locator('.ff-favicon img').count()) > 0;
    const hasLetter = (await tile.locator('.ff-favicon span').count()) > 0;
    expect(hasImg || hasLetter).toBe(true);
  });

  test('no CORS errors logged during icon load', async ({ newtabPage }) => {
    const corsErrors: string[] = [];
    newtabPage.on('console', (msg) => {
      if (msg.type() === 'error' && msg.text().toLowerCase().includes('cors')) {
        corsErrors.push(msg.text());
      }
    });
    await reloadNewtab(newtabPage);
    await newtabPage.waitForTimeout(3_000);
    expect(corsErrors, `CORS errors detected: ${corsErrors.join('; ')}`).toHaveLength(0);
  });
});
