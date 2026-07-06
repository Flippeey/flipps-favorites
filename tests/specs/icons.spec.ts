/**
 * Icon pipeline + Firefox MV3 manifest assertion.
 */
import { test, expect } from '../fixtures/extension-context.js';
import { MOCK_FAVICON_PNG, MOCK_GLOBE_PLACEHOLDER_PNG } from '../fixtures/test-data.js';
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
    // The pipeline self-calibrates a "globe placeholder" signature once per
    // service-worker lifetime by probing S2 with a `.invalid` sentinel domain
    // (see src/background/icons/s2-globe-gate.ts), then rejects any real S2
    // result whose bytes match that signature. A route mock that fulfills
    // every s2/favicons request identically — sentinel included — makes the
    // mocked favicon match its own sentinel and get rejected as a "globe",
    // falling through to origin scrape / Icon Horse / DuckDuckGo. Give the
    // sentinel request a distinct body so its signature never collides with
    // the real mocked favicon.
    await context.route('https://www.google.com/s2/favicons**', async (route) => {
      const url = new URL(route.request().url());
      const isSentinelProbe = url.searchParams.get('domain_url')?.includes('.invalid');
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: isSentinelProbe ? MOCK_GLOBE_PLACEHOLDER_PNG : MOCK_FAVICON_PNG,
      });
    });
    // Block the fallback sources so the assertion proves S2 specifically flowed
    // through, rather than incidentally passing via a live network fallback
    // (origin scrape / Icon Horse / DuckDuckGo) that isn't this test's concern.
    await context.route('https://example.com/**', (route) => route.abort('failed'));
    await context.route('https://icon.horse/**', (route) => route.abort('failed'));
    await context.route('https://duckduckgo.com/**', (route) => route.abort('failed'));
    await reloadNewtab(newtabPage);
    const img = newtabPage.locator('.ff-tile[data-item-kind="bookmark"] .ff-favicon img').first();
    await expect(img).toBeVisible({ timeout: 10_000 });
    const src = await img.getAttribute('src');
    expect(src).toMatch(/^data:image\/png/);
  });

  test('all external icon fetches failing → generated letter-tile fallback renders', async ({ context, newtabPage }) => {
    // Block origin scrape, S2, Icon Horse, and DDG — every source the pipeline can use.
    // With all sources exhausted, resolveAutomaticIcon falls back to
    // createGeneratedRecord() (src/background/icons/icon-service.ts), which always
    // resolves (never rejects) with an inline SVG initials tile
    // (buildFallbackSvgDataUrl, src/shared/icon-fallback.ts). That's a specific,
    // falsifiable outcome: an <img> whose src is a data:image/svg+xml URL.
    await context.route('https://example.com/**', (route) => route.abort('failed'));
    await context.route('https://www.google.com/s2/favicons**', (route) => route.abort('failed'));
    await context.route('https://icon.horse/**', (route) => route.abort('failed'));
    await context.route('https://duckduckgo.com/**', (route) => route.abort('failed'));
    await reloadNewtab(newtabPage);

    const img = newtabPage.locator('.ff-tile[data-item-kind="bookmark"] .ff-favicon img').first();
    await expect(img).toBeVisible({ timeout: 10_000 });
    const src = await img.getAttribute('src');
    expect(src).toMatch(/^data:image\/svg\+xml/);
  });

  // Why it matters: power users pick an icon and want to be done. A single click
  // applies but keeps the dialog open for further tweaks; a double-click applies
  // AND closes. If the candidate cell were disabled mid-apply the second click
  // would be swallowed and the double-click contract would silently break.
  test('double-clicking an icon search result applies it and closes the dialog', async ({ context, newtabPage }) => {
    // Mock DuckDuckGo image search so exactly one candidate renders deterministically.
    await context.route('https://duckduckgo.com/**', async (route) => {
      const url = route.request().url();
      if (url.includes('i.js')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            results: [{
              image: 'https://mock.test/full.png',
              thumbnail: 'https://mock.test/thumb.png',
              title: 'Example logo',
              url: 'https://mock.test/',
              width: 128,
              height: 128,
            }],
          }),
        });
      } else {
        // Search page only needs to carry a vqd token for extractDuckDuckGoToken().
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<script>vqd="3-mocktoken";</script>' });
      }
    });
    // Thumbnail (shown in the grid) + full image (downloaded when applied).
    await context.route('https://mock.test/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: MOCK_FAVICON_PNG }));

    await reloadNewtab(newtabPage);
    const tile = newtabPage.locator('.ff-tile[data-item-kind="bookmark"]', { hasText: 'Example Site' }).first();
    await expect(tile).toBeVisible();

    const menu = await openContextMenu(newtabPage, tile);
    await clickMenuItem(menu, /^Edit/);

    const dialog = newtabPage.locator('.ff-modal-scrim');
    await expect(dialog).toBeVisible();

    // The dialog auto-searches on open. Cells stay display:none until their preview
    // loads (≥64px); origin candidates point at unmockable example.com images, so the
    // mocked DDG result is the one that validates and becomes visible.
    const cell = newtabPage.locator('.ff-icongrid__cell:visible').first();
    await expect(cell).toBeVisible({ timeout: 10_000 });

    // Single click applies but leaves the dialog open.
    await cell.click();
    await newtabPage.waitForTimeout(300);
    await expect(dialog).toBeVisible();

    // Double click applies and closes.
    await cell.dblclick();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  });

  // Why it matters: users need to know where each search result came from so they
  // can judge quality (a Google favicon is authoritative; a web-search hit is a
  // best-effort match). The source must be visible on hover without extra clicks.
  test('icon search result cell title includes source label and action hint', async ({ context, newtabPage }) => {
    // Block origin scrape, S2, and Icon Horse so only DDG web-search results appear.
    // This ensures the first visible cell is a web-search candidate (sourceKind: 'search'),
    // making the "Web search · <host>" assertion deterministic.
    await context.route('https://example.com/**', (route) => route.abort('failed'));
    await context.route('https://www.google.com/s2/favicons**', (route) => route.abort('failed'));
    await context.route('https://icon.horse/**', (route) => route.abort('failed'));

    await context.route('https://duckduckgo.com/**', async (route) => {
      const url = route.request().url();
      if (url.includes('i.js')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            results: [{
              image: 'https://mock.test/full.png',
              thumbnail: 'https://mock.test/thumb.png',
              title: 'Example logo',
              url: 'https://wikipedia.org/wiki/Example',
              width: 128,
              height: 128,
            }],
          }),
        });
      } else {
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<script>vqd="3-mocktoken";</script>' });
      }
    });
    await context.route('https://mock.test/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: MOCK_FAVICON_PNG }));

    await reloadNewtab(newtabPage);
    const tile = newtabPage.locator('.ff-tile[data-item-kind="bookmark"]', { hasText: 'Example Site' }).first();
    await expect(tile).toBeVisible();

    const menu = await openContextMenu(newtabPage, tile);
    await clickMenuItem(menu, /^Edit/);

    const dialog = newtabPage.locator('.ff-modal-scrim');
    await expect(dialog).toBeVisible();

    // Wait for the DDG web-search result cell to load (≥64px image validated).
    const cell = newtabPage.locator('.ff-icongrid__cell:visible').first();
    await expect(cell).toBeVisible({ timeout: 15_000 });

    // The cell is a web-search result from wikipedia.org.
    // Its hover title must include the source ("Web search · wikipedia.org")
    // and the action hint so users know both origin and how to apply.
    const cellTitle = await cell.getAttribute('title');
    expect(cellTitle).toContain('Web search · wikipedia.org');
    expect(cellTitle).toContain('double-click to apply and close');

    await expect(dialog).toBeVisible();
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
