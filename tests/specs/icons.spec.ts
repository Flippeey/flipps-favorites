/**
 * Icon loading tests — priority 1.
 *
 * Covers the icon resolution pipeline (override → cache → Google S2 favicon →
 * DuckDuckGo image search → generated fallback) and the Firefox MV3 CORS fix
 * that was a real production regression.
 */
import { test, expect } from '../fixtures/extension-context.js';
import { MOCK_FAVICON_PNG } from '../fixtures/test-data.js';
import {
  createTestFolder,
  createTestBookmark,
  removeBookmarkTree,
  setRootFolderId,
  reloadNewtab,
  skipOnboarding,
} from '../fixtures/bookmark-helpers.js';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(import.meta.url), '..', '..', '..');

// ---------------------------------------------------------------------------
// Firefox architecture regression — no newtabPage/bgPage fixtures needed.
// This test reads from the build artifact so it passes even when Playwright
// cannot load the extension's pages in Firefox.
// ---------------------------------------------------------------------------

test('Firefox uses background.html, not a service worker (MV3 CORS regression check)', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'firefox', 'Firefox-only test');
  // If this assertion fails it means the build no longer uses background.html
  // for Firefox, which was the root cause of the CORS errors in the icon pipeline.
  const manifest = JSON.parse(
    await readFile(join(rootDir, 'dist', 'firefox', 'manifest.json'), 'utf-8')
  );
  expect(manifest.background?.page).toBe('background.html');
  expect(manifest.background?.service_worker).toBeUndefined();
});

// ---------------------------------------------------------------------------
// Icon pipeline tests — require newtabPage; skipped on Firefox automatically.
// ---------------------------------------------------------------------------

test.describe('icon pipeline', () => {
  let testFolderId: string;

  test.beforeEach(async ({ newtabPage }) => {
    await skipOnboarding(newtabPage);

    // Create a test folder with one bookmark so the icon pipeline fires.
    // Do NOT reload here — each test sets up its own routes before reloading
    // so the service worker's icon cache is empty when routes are active.
    testFolderId = await createTestFolder(newtabPage);
    await createTestBookmark(newtabPage, testFolderId, 'Example Site', 'https://example.com');
    await setRootFolderId(newtabPage, testFolderId);
  });

  test.afterEach(async ({ newtabPage }) => {
    await removeBookmarkTree(newtabPage, testFolderId);
  });

  test('no CORS errors appear in the background page console', async ({ bgPage, newtabPage }) => {
    const corsErrors: string[] = [];
    bgPage.on('console', msg => {
      if (msg.type() === 'error' && msg.text().toLowerCase().includes('cors')) {
        corsErrors.push(msg.text());
      }
    });

    // Reload to trigger icon pipeline, then wait for it to complete.
    await reloadNewtab(newtabPage);
    await newtabPage.waitForTimeout(3_000);

    expect(corsErrors, `CORS errors detected: ${corsErrors.join('; ')}`).toHaveLength(0);
  });

  test('icon resolves from Google S2 favicon (mocked) and shows as non-fallback', async ({
    context,
    newtabPage,
  }) => {
    // Intercept Google S2 favicon requests at context level so Chrome service worker requests
    // are also captured (bgPage.route() only covers regular page requests, not SW fetch).
    await context.route('https://www.google.com/s2/favicons**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: MOCK_FAVICON_PNG,
      });
    });

    // Reload so the icon pipeline fires with our mock in place.
    await reloadNewtab(newtabPage);

    // Wait for at least one icon to reach the "resolved" state (not fallback).
    await expect(
      newtabPage.locator('[data-bookmark-icon][data-icon-state="resolved"]').first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('icon falls back to generated SVG when favicon request fails', async ({
    context,
    newtabPage,
  }) => {
    // Abort all external icon fetches at context level to force the fallback path.
    await context.route('https://www.google.com/s2/favicons**', route => route.abort('failed'));
    await context.route('https://duckduckgo.com/**', route => route.abort('failed'));

    await reloadNewtab(newtabPage);

    // Allow time for the pipeline to complete through fallback.
    await newtabPage.waitForTimeout(3_000);

    // At least one icon should exist in "fallback" state (generated SVG).
    const fallbackIcons = newtabPage.locator('[data-bookmark-icon][data-icon-state="fallback"]');
    await expect(fallbackIcons.first()).toBeVisible({ timeout: 8_000 });
  });

  test('icon appears in the DOM for each bookmark tile', async ({ newtabPage }) => {
    await reloadNewtab(newtabPage);

    // Wait for the bookmark grid to populate (loading is async after .shell appears).
    const tiles = newtabPage.locator('.bookmark-tile.link-tile');
    await expect(tiles.first()).toBeAttached({ timeout: 10_000 });
    const count = await tiles.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      await expect(tiles.nth(i).locator('[data-bookmark-icon]')).toBeAttached();
    }
  });
});
