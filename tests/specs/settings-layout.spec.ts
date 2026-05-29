/**
 * Settings → Layout (Customize workspace drawer).
 *
 * Why each test matters: layout presets drive the tile-size / tile-width / gap
 * CSS variables that determine how many tiles fit on screen and how large they
 * render. Tile-shape and label visibility are per-workspace preferences that
 * must be reflected on the app shell immediately and survive a reload.
 */
import { test, expect } from '../fixtures/world.js';
import { openSettingsSection, reloadNewtab } from '../fixtures/bookmark-helpers.js';
import { patchWorkspace } from '../fixtures/seeding.js';
import { appShell } from '../fixtures/selectors.js';
import type { Page } from '@playwright/test';

const WORK_WS_ID = 'promo-work';

async function openLayout(page: Page): Promise<void> {
  await openSettingsSection(page, 'layout');
}


// ---------------------------------------------------------------------------
// Layout presets
// ---------------------------------------------------------------------------
test.describe('settings-layout: presets', () => {
  test('Balanced preset sets --tile-size=76px on documentElement', async ({ newtabPage }) => {
    // Compact first so Balanced is a real transition.
    await patchWorkspace(newtabPage, WORK_WS_ID, { layoutPreset: 'compact' });
    await reloadNewtab(newtabPage);

    await openLayout(newtabPage);
    await newtabPage.locator('.ff-card', { hasText: 'Balanced' }).click();
    await expect.poll(() =>
      newtabPage.evaluate(() =>
        document.documentElement.style.getPropertyValue('--tile-size'),
      ),
    ).toBe('76px');
  });

  test('Compact preset sets --tile-size=56px', async ({ newtabPage }) => {
    await openLayout(newtabPage);
    await newtabPage.locator('.ff-card', { hasText: 'Compact' }).click();
    await expect.poll(() =>
      newtabPage.evaluate(() =>
        document.documentElement.style.getPropertyValue('--tile-size'),
      ),
    ).toBe('56px');
  });

  test('Spacious preset sets --tile-size=92px', async ({ newtabPage }) => {
    await openLayout(newtabPage);
    await newtabPage.locator('.ff-card', { hasText: 'Spacious' }).click();
    await expect.poll(() =>
      newtabPage.evaluate(() =>
        document.documentElement.style.getPropertyValue('--tile-size'),
      ),
    ).toBe('92px');
  });

  test('Presentation preset sets --tile-size=116px', async ({ newtabPage }) => {
    await openLayout(newtabPage);
    await newtabPage.locator('.ff-card', { hasText: 'Presentation' }).click();
    await expect.poll(() =>
      newtabPage.evaluate(() =>
        document.documentElement.style.getPropertyValue('--tile-size'),
      ),
    ).toBe('116px');
  });

  test('layout preset persists after reload', async ({ newtabPage }) => {
    // Click Compact, confirm the CSS var changes (proves applyDensity ran
    // with the optimistic compact preset), then reload and verify it persists.
    //
    // The test is workspace-agnostic: if seeding leaves only one workspace (due
    // to sync-storage throttling) the activeWorkspace fallback (workspaces[0])
    // still provides a valid workspace for the UI interaction.
    await openLayout(newtabPage);

    // If no active workspace loaded (workspaces=[]) the CSS var stays empty.
    // Poll for any non-empty value first to confirm the page is ready.
    await expect.poll(() =>
      newtabPage.evaluate(() =>
        document.documentElement.style.getPropertyValue('--tile-size'),
      ),
    ).not.toBe('');

    await newtabPage.locator('.ff-card', { hasText: 'Compact' }).click();

    // CSS var set by applyDensity confirms the optimistic write fired.
    await expect.poll(() =>
      newtabPage.evaluate(() =>
        document.documentElement.style.getPropertyValue('--tile-size'),
      ),
    ).toBe('56px');

    // Poll until the service-worker has the compact preset committed to storage.
    // workspaces/get-all reads from SW cache (after onChanged clears the cache it
    // reads from sync). The patch response is only sent after writeOne() completes,
    // so once the active workspace shows compact in get-all the sync write is done.
    await expect.poll(() =>
      newtabPage.evaluate(async () => {
        const api = (globalThis as unknown as {
          browser?: { runtime: { sendMessage(m: unknown): Promise<unknown> } };
          chrome: { runtime: { sendMessage(m: unknown): Promise<unknown> } };
        }).browser ?? (globalThis as unknown as {
          chrome: { runtime: { sendMessage(m: unknown): Promise<unknown> } };
        }).chrome;
        const settingsRes = await api.runtime.sendMessage({ type: 'settings/get' }) as {
          settings: { activeWorkspaceId: string };
        };
        const wsRes = await api.runtime.sendMessage({ type: 'workspaces/get-all' }) as {
          workspaces: Array<{ id: string; layoutPreset: string }>;
        };
        const activeId = settingsRes.settings.activeWorkspaceId;
        const ws = wsRes.workspaces.find(w => w.id === activeId) ?? wsRes.workspaces[0];
        return ws?.layoutPreset;
      }),
    ).toBe('compact');

    await newtabPage.keyboard.press('Escape');
    await expect(newtabPage.locator('.ff-drawer')).toHaveCount(0);
    await reloadNewtab(newtabPage);

    await expect.poll(() =>
      newtabPage.evaluate(() =>
        document.documentElement.style.getPropertyValue('--tile-size'),
      ),
    ).toBe('56px');
  });
});

// ---------------------------------------------------------------------------
// Custom preset — exposes size / gap sliders
// ---------------------------------------------------------------------------
test.describe('settings-layout: custom preset', () => {
  test('Custom preset reveals icon-size, tile-width, column-gap and row-gap sliders', async ({ newtabPage }) => {
    await openLayout(newtabPage);
    // Custom is the full-width card at the bottom of the grid.
    await newtabPage.locator('.ff-card', { hasText: 'Custom' }).click();

    // The sliders only appear when preset === 'custom'.
    await expect(newtabPage.locator('.ff-row', { hasText: 'Icon size' })).toBeVisible();
    await expect(newtabPage.locator('.ff-row', { hasText: 'Tile width' })).toBeVisible();
    await expect(newtabPage.locator('.ff-row', { hasText: 'Column gap' })).toBeVisible();
    await expect(newtabPage.locator('.ff-row', { hasText: 'Row gap' })).toBeVisible();
  });

  test('custom icon-size slider previews --tile-size on documentElement', async ({ newtabPage }) => {
    await patchWorkspace(newtabPage, WORK_WS_ID, { layoutPreset: 'custom', bookmarkIconSize: 75 });
    await reloadNewtab(newtabPage);

    await openLayout(newtabPage);
    const slider = newtabPage.locator('.ff-row', { hasText: 'Icon size' }).locator('input[type="range"]');
    await slider.fill('60');
    await expect.poll(() =>
      newtabPage.evaluate(() =>
        document.documentElement.style.getPropertyValue('--tile-size'),
      ),
    ).toBe('60px');
  });
});

// ---------------------------------------------------------------------------
// Tile shape
// ---------------------------------------------------------------------------
test.describe('settings-layout: tile shape', () => {
  test('Squircle option sets data-tile-shape=squircle on the app shell', async ({ newtabPage }) => {
    // Start from circle so the click is a real change.
    await patchWorkspace(newtabPage, WORK_WS_ID, { tileShape: 'circle' });
    await reloadNewtab(newtabPage);

    await openLayout(newtabPage);
    await newtabPage.locator('.ff-row', { hasText: 'Tile shape' })
      .locator('.ff-segmented__option', { hasText: 'Squircle' }).click();
    await expect(appShell(newtabPage)).toHaveAttribute('data-tile-shape', 'squircle');
  });

  test('Rounded option sets data-tile-shape=rounded', async ({ newtabPage }) => {
    await openLayout(newtabPage);
    await newtabPage.locator('.ff-row', { hasText: 'Tile shape' })
      .locator('.ff-segmented__option', { hasText: 'Rounded' }).click();
    await expect(appShell(newtabPage)).toHaveAttribute('data-tile-shape', 'rounded');
  });

  test('Circle option sets data-tile-shape=circle', async ({ newtabPage }) => {
    await openLayout(newtabPage);
    await newtabPage.locator('.ff-row', { hasText: 'Tile shape' })
      .locator('.ff-segmented__option', { hasText: 'Circle' }).click();
    await expect(appShell(newtabPage)).toHaveAttribute('data-tile-shape', 'circle');
  });

  test('tile-shape persists after reload', async ({ newtabPage }) => {
    await openLayout(newtabPage);
    const circleOption = newtabPage.locator('.ff-row', { hasText: 'Tile shape' })
      .locator('.ff-segmented__option', { hasText: 'Circle' });
    await circleOption.click();
    // Wait for data-tile-shape to reflect the change on the app shell (optimistic).
    await expect(appShell(newtabPage)).toHaveAttribute('data-tile-shape', 'circle');
    // Also wait for the segmented option to be reconciled (data-active flips when
    // the reconciled workspace record comes back from the service worker), which
    // means the storage write has completed.
    await expect(circleOption).toHaveAttribute('data-active', 'true');

    await reloadNewtab(newtabPage);
    await expect(appShell(newtabPage)).toHaveAttribute('data-tile-shape', 'circle');
  });
});

// ---------------------------------------------------------------------------
// Show tile labels
// ---------------------------------------------------------------------------
test.describe('settings-layout: show tile labels', () => {
  test('toggling Show tile labels off sets data-labels=false and hides labels', async ({ newtabPage }) => {
    // Ensure labels start visible.
    await patchWorkspace(newtabPage, WORK_WS_ID, { showTileLabels: true });
    await reloadNewtab(newtabPage);

    await openLayout(newtabPage);
    await newtabPage.locator('.ff-row', { hasText: 'Show tile labels' }).locator('.ff-toggle').click();

    // App shell attribute flips.
    await expect(appShell(newtabPage)).toHaveAttribute('data-labels', 'false');

    // CSS rule: .ff-app[data-labels="false"] .ff-tile__label { display: none }
    // Verify at least one label is no longer visible.
    await expect(newtabPage.locator('.ff-tile__label').first()).toBeHidden();
  });

  test('toggling Show tile labels back on restores label visibility', async ({ newtabPage }) => {
    await patchWorkspace(newtabPage, WORK_WS_ID, { showTileLabels: false });
    await reloadNewtab(newtabPage);

    await openLayout(newtabPage);
    await newtabPage.locator('.ff-row', { hasText: 'Show tile labels' }).locator('.ff-toggle').click();

    await expect(appShell(newtabPage)).toHaveAttribute('data-labels', 'true');
    await expect(newtabPage.locator('.ff-tile__label').first()).toBeVisible();
  });
});
