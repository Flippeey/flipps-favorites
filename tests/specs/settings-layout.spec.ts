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
import { patchWorkspace, waitForWorkspace, getWorkspaces } from '../fixtures/seeding.js';
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
    await newtabPage.locator('button.ff-card', { hasText: 'Balanced' }).click();
    await expect.poll(() =>
      newtabPage.evaluate(() =>
        document.documentElement.style.getPropertyValue('--tile-size'),
      ),
    ).toBe('76px');
  });

  test('Compact preset sets --tile-size=56px', async ({ newtabPage }) => {
    await openLayout(newtabPage);
    await newtabPage.locator('button.ff-card', { hasText: 'Compact' }).click();
    await expect.poll(() =>
      newtabPage.evaluate(() =>
        document.documentElement.style.getPropertyValue('--tile-size'),
      ),
    ).toBe('56px');
  });

  test('Spacious preset sets --tile-size=92px', async ({ newtabPage }) => {
    await openLayout(newtabPage);
    await newtabPage.locator('button.ff-card', { hasText: 'Spacious' }).click();
    await expect.poll(() =>
      newtabPage.evaluate(() =>
        document.documentElement.style.getPropertyValue('--tile-size'),
      ),
    ).toBe('92px');
  });

  test('Presentation preset sets --tile-size=116px', async ({ newtabPage }) => {
    await openLayout(newtabPage);
    await newtabPage.locator('button.ff-card', { hasText: 'Presentation' }).click();
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

    await newtabPage.locator('button.ff-card', { hasText: 'Compact' }).click();

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
    await newtabPage.locator('button.ff-card', { hasText: 'Custom' }).click();

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
// Tile shape is a trio of skeleton-preview cards (Squircle / Rounded / Circle),
// matching the View and Density cards. Each card carries data-active when its
// shape is selected. 'Squircle'/'Rounded'/'Circle' are unique among drawer cards.
const shapeCard = (page: Page, label: 'Squircle' | 'Rounded' | 'Circle') =>
  page.locator('.ff-drawer button.ff-card', { hasText: label });

test.describe('settings-layout: tile shape', () => {
  test('Squircle card sets data-tile-shape=squircle on the app shell', async ({ newtabPage }) => {
    // Start from circle so the click is a real change.
    await patchWorkspace(newtabPage, WORK_WS_ID, { tileShape: 'circle' });
    await reloadNewtab(newtabPage);

    await openLayout(newtabPage);
    await shapeCard(newtabPage, 'Squircle').click();
    await expect(appShell(newtabPage)).toHaveAttribute('data-tile-shape', 'squircle');
  });

  test('Rounded card sets data-tile-shape=rounded', async ({ newtabPage }) => {
    await openLayout(newtabPage);
    await shapeCard(newtabPage, 'Rounded').click();
    await expect(appShell(newtabPage)).toHaveAttribute('data-tile-shape', 'rounded');
  });

  test('Circle card sets data-tile-shape=circle', async ({ newtabPage }) => {
    await openLayout(newtabPage);
    await shapeCard(newtabPage, 'Circle').click();
    await expect(appShell(newtabPage)).toHaveAttribute('data-tile-shape', 'circle');
  });

  test('tile-shape persists after reload', async ({ newtabPage }) => {
    await openLayout(newtabPage);
    const circleCard = shapeCard(newtabPage, 'Circle');
    await circleCard.click();
    // app-shell attribute reflects the optimistic change immediately.
    await expect(appShell(newtabPage)).toHaveAttribute('data-tile-shape', 'circle');
    // data-active flips once the reconciled record returns — proves the write committed.
    await expect(circleCard).toHaveAttribute('data-active', 'true');

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

// ---------------------------------------------------------------------------
// View mode (Grid ↔ List)
//
// Relocated here from settings-nav.spec.ts: the View segmented control moved out
// of the app-settings Navigation drawer into this per-workspace Customize drawer
// because folderMode is now a WorkspaceRecord field, not an AppSettings field.
// WHY each test matters: the View control is the user's switch between the
// compact grid and the unfolded list layout; it must apply optimistically and
// survive a reload, scoped to the active workspace.
// ---------------------------------------------------------------------------
// View is a pair of skeleton-preview cards (Grid / List), matching the density
// presets. Each card carries data-active when its mode is selected. 'Grid'/'List'
// are unique among drawer cards (presets are Balanced/Compact/Spacious/etc.).
const viewCard = (page: Page, label: 'Grid' | 'List') =>
  page.locator('.ff-drawer button.ff-card', { hasText: label });

test.describe('settings-layout: view mode', () => {
  test('switching to List marks the List option active', async ({ newtabPage }) => {
    await patchWorkspace(newtabPage, WORK_WS_ID, { folderMode: 'grid' });
    await reloadNewtab(newtabPage);

    await openLayout(newtabPage);
    await viewCard(newtabPage, 'List').click();

    await expect(viewCard(newtabPage, 'List')).toHaveAttribute('data-active', 'true');
  });

  test('switching to Grid marks the Grid option active', async ({ newtabPage }) => {
    await patchWorkspace(newtabPage, WORK_WS_ID, { folderMode: 'list' });
    await reloadNewtab(newtabPage);

    await openLayout(newtabPage);
    await viewCard(newtabPage, 'Grid').click();

    await expect(viewCard(newtabPage, 'Grid')).toHaveAttribute('data-active', 'true');
  });

  test('view mode persists after reload', async ({ newtabPage }) => {
    await patchWorkspace(newtabPage, WORK_WS_ID, { folderMode: 'grid' });
    await reloadNewtab(newtabPage);

    await openLayout(newtabPage);
    await viewCard(newtabPage, 'List').click();

    // Wait for the per-workspace write to commit before reloading, then reload.
    await waitForWorkspace(newtabPage, WORK_WS_ID, (w) => w.folderMode === 'list');
    await reloadNewtab(newtabPage);

    await openLayout(newtabPage);
    await expect(viewCard(newtabPage, 'List')).toHaveAttribute('data-active', 'true');
  });
});

// ---------------------------------------------------------------------------
// Per-workspace view-mode isolation
//
// WHY this matters: the whole point of moving folderMode onto WorkspaceRecord is
// that each workspace remembers its OWN view. If two workspaces could not hold
// different view modes — or if a switch leaked one workspace's mode onto another,
// or a reload collapsed them back to a single global value — the migration would
// be pointless. This encodes that intent, not just DOM shape.
// ---------------------------------------------------------------------------
test.describe('settings-layout: per-workspace view isolation', () => {
  test('two workspaces hold different view modes and survive reload', async ({ newtabPage, world }) => {
    // Seed Work=list, Personal=grid directly on the records, then verify the UI
    // reflects each independently as the user switches between them and reloads.
    // Gate the reload on both writes committing so the page never reads a stale
    // (pre-patch) record — the per-workspace patch is async.
    await patchWorkspace(newtabPage, world.workspaceIds.Work, { folderMode: 'list' });
    await patchWorkspace(newtabPage, world.workspaceIds.Personal, { folderMode: 'grid' });
    await waitForWorkspace(newtabPage, world.workspaceIds.Work, (w) => w.folderMode === 'list');
    await waitForWorkspace(newtabPage, world.workspaceIds.Personal, (w) => w.folderMode === 'grid');
    await reloadNewtab(newtabPage);

    // Work (active) shows List.
    await openLayout(newtabPage);
    await expect(viewCard(newtabPage, 'List')).toHaveAttribute('data-active', 'true');
    await newtabPage.keyboard.press('Escape');
    await expect(newtabPage.locator('.ff-drawer')).toHaveCount(0);

    // Switch to Personal via its workspace tab — it shows Grid, not Work's List.
    await newtabPage.locator(`.ff-ws-tab[data-workspace-id="${world.workspaceIds.Personal}"]`).click();
    await openLayout(newtabPage);
    await expect(viewCard(newtabPage, 'Grid')).toHaveAttribute('data-active', 'true');
    await newtabPage.keyboard.press('Escape');
    await expect(newtabPage.locator('.ff-drawer')).toHaveCount(0);

    // The committed records stayed distinct — reload proves persistence, not a
    // transient in-memory split.
    await reloadNewtab(newtabPage);
    const records = await getWorkspaces(newtabPage);
    const work = records.find((w) => w.id === world.workspaceIds.Work);
    const personal = records.find((w) => w.id === world.workspaceIds.Personal);
    expect(work?.folderMode).toBe('list');
    expect(personal?.folderMode).toBe('grid');
  });
});

// ---------------------------------------------------------------------------
// Sort (per-workspace, beside View)
//
// WHY this matters: bookmarkSortMode/Direction became WorkspaceRecord fields in
// the per-workspace migration, but their only UI was the TopNav dropdown. A user
// configuring a workspace in the Customize drawer expects Sort to live next to
// View. This control writes the SAME per-workspace fields the toolbar dropdown
// does, so the two stay in sync; the value must persist per workspace.
// ---------------------------------------------------------------------------
const drawerSortPill = (page: Page) => page.locator('.ff-drawer .ff-sort .ff-pill');
const drawerSortOption = (page: Page, label: string) =>
  page.locator('.ff-drawer .ff-sort__panel .ff-sort__option', { hasText: label });

test.describe('settings-layout: sort', () => {
  test('choosing a sort option writes mode + direction to the active workspace', async ({ newtabPage }) => {
    await patchWorkspace(newtabPage, WORK_WS_ID, { bookmarkSortMode: 'manual', bookmarkSortDirection: 'asc' });
    await reloadNewtab(newtabPage);

    await openLayout(newtabPage);
    await drawerSortPill(newtabPage).click();
    await drawerSortOption(newtabPage, 'Name (A → Z)').click();

    // The per-workspace record carries the chosen mode + direction.
    await waitForWorkspace(
      newtabPage,
      WORK_WS_ID,
      (w) => w.bookmarkSortMode === 'name' && w.bookmarkSortDirection === 'asc',
    );
    // The pill reflects the new selection.
    await expect(drawerSortPill(newtabPage)).toContainText('Name (A → Z)');
  });

  test('sort selection persists after reload', async ({ newtabPage }) => {
    await patchWorkspace(newtabPage, WORK_WS_ID, { bookmarkSortMode: 'manual', bookmarkSortDirection: 'asc' });
    await reloadNewtab(newtabPage);

    await openLayout(newtabPage);
    await drawerSortPill(newtabPage).click();
    await drawerSortOption(newtabPage, 'Date added (newest)').click();
    await waitForWorkspace(
      newtabPage,
      WORK_WS_ID,
      (w) => w.bookmarkSortMode === 'created' && w.bookmarkSortDirection === 'desc',
    );

    await newtabPage.keyboard.press('Escape');
    await expect(newtabPage.locator('.ff-drawer')).toHaveCount(0);
    await reloadNewtab(newtabPage);

    await openLayout(newtabPage);
    await expect(drawerSortPill(newtabPage)).toContainText('Date added (newest)');
  });
});
