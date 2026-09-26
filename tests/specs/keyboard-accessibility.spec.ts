/**
 * Keyboard accessibility: the context menu, the sort/workspace dropdowns, and
 * the settings drawer controls must all be operable without a mouse.
 *
 * WHY each group matters:
 *  - Context menu: a menu that only responds to hover leaves keyboard/screen-
 *    reader users unable to open, edit, or delete a bookmark at all.
 *  - Dropdowns (sort, workspace jump): these are the only way to change sort
 *    order or jump to an overflowed workspace — without arrow-key support
 *    they are keyboard dead ends.
 *  - Settings controls: a Toggle/Segmented/Slider with no accessible name is
 *    unusable through a screen reader, which only announces "switch" or
 *    "slider" with nothing to say what it controls.
 */
import { test, expect } from '../fixtures/world.js';
import { createTestFolder, openContextMenu, openSettingsSection, patchSettings, patchWorkspace, removeBookmarkTree } from '../fixtures/bookmark-helpers.js';
import { createWorkspace } from '../fixtures/seeding.js';
import { tileById, workspaceTab } from '../fixtures/selectors.js';
import { DEFAULT_WORKSPACE_SETTINGS } from '../fixtures/test-data.js';
import type { WorkspaceRecord } from '@/shared/models';
import type { Page } from '@playwright/test';

function makeWorkspaceRecord(id: string, name: string, rootFolderId: string): WorkspaceRecord {
  return {
    ...DEFAULT_WORKSPACE_SETTINGS,
    id,
    name,
    rootFolderId,
    accentColor: '#888888',
    gradientCustomColor: '#888888',
  };
}

/** Seed extra workspaces past the 5 promo ones so the tab strip overflows and the jump-menu renders. */
async function seedExtraWorkspaces(page: Page, count: number): Promise<string[]> {
  const folderIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const idx = i + 6;
    const folderId = await createTestFolder(page, `KA Extra Folder ${idx}`);
    folderIds.push(folderId);
    await createWorkspace(page, makeWorkspaceRecord(`ka-extra-ws-${idx}`, `KA Extra ${idx}`, folderId));
  }
  return folderIds;
}

/** Close whatever settings drawer is open (if any) so a different drawer scope can be opened next. */
async function closeDrawerIfOpen(page: Page): Promise<void> {
  if (await page.locator('.ff-drawer').count() > 0) {
    await page.keyboard.press('Escape');
    await expect(page.locator('.ff-drawer')).toHaveCount(0, { timeout: 2_000 });
  }
}

test.describe('context menu keyboard navigation', () => {
  test('ArrowDown focuses the first enabled item, a second ArrowDown moves to the next, ArrowUp wraps to the last', async ({ newtabPage, world }) => {
    const tile = tileById(newtabPage, world.bookmarkIdByTitle('GitHub'));
    const menu = await openContextMenu(newtabPage, tile);
    const items = menu.getByRole('menuitem');

    // Unfixed code never moves DOM focus on ArrowDown — it only tracks a
    // `hovered` index in React state — so this fails on the pre-fix menu.
    await newtabPage.keyboard.press('ArrowDown');
    await expect(items.nth(0)).toBeFocused();

    await newtabPage.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
    await expect(items.nth(1)).toHaveText(/Open in new tab/);

    // ArrowUp from the second item goes back to the first, not further proof
    // needed here; wrap-around is exercised by re-opening and going straight up.
    await newtabPage.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    const menu2 = await openContextMenu(newtabPage, tile);
    const items2 = menu2.getByRole('menuitem');
    await newtabPage.keyboard.press('ArrowUp');
    await expect(items2.last()).toBeFocused();
    await expect(items2.last()).toHaveText(/Delete/);
  });

  test('Enter on a focused item activates it and closes the menu', async ({ newtabPage, world }) => {
    const tile = tileById(newtabPage, world.bookmarkIdByTitle('GitHub'));
    const menu = await openContextMenu(newtabPage, tile);

    await newtabPage.keyboard.press('ArrowDown'); // Open
    await newtabPage.keyboard.press('ArrowDown'); // Open in new tab
    const target = menu.getByRole('menuitem').nth(1);
    await expect(target).toHaveText(/Open in new tab/);
    // Unfixed code tracks 'hovered' in state only, never moving DOM focus,
    // so this fails on the pre-fix menu even though Enter still fires onClick.
    await expect(target).toBeFocused();

    const [newPage] = await Promise.all([
      newtabPage.context().waitForEvent('page', { timeout: 10_000 }),
      newtabPage.keyboard.press('Enter'),
    ]);
    await newPage.waitForLoadState('domcontentloaded');
    await expect(menu).toHaveCount(0);
    await newPage.close();
  });
});

test.describe('dropdown keyboard navigation', () => {
  test('TopNav sort dropdown opens on ArrowDown, moves with arrows, commits on Enter, and Escape cancels without a change', async ({ newtabPage }) => {
    const trigger = newtabPage.locator('.ff-nav .ff-sort .ff-pill');
    await trigger.focus();

    // Unfixed code has no onKeyDown on the trigger at all, so this never opens.
    await newtabPage.keyboard.press('ArrowDown');
    const panel = newtabPage.locator('.ff-nav .ff-sort__panel');
    await expect(panel).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-activedescendant', /.+/);
    // Screen readers ignore aria-activedescendant on a plain button, so the trigger
    // must be a combobox that points at the open listbox.
    await expect(trigger).toHaveAttribute('role', 'combobox');
    await expect(trigger).toHaveAttribute('aria-controls', String(await panel.getAttribute('id')));

    const initialId = await trigger.getAttribute('aria-activedescendant');
    await newtabPage.keyboard.press('ArrowDown');
    const movedId = await trigger.getAttribute('aria-activedescendant');
    expect(movedId).not.toBe(initialId);
    await expect(newtabPage.locator(`[id="${String(movedId)}"]`)).toHaveAttribute('data-highlighted', 'true');

    // Escape closes without applying the highlighted-but-uncommitted option.
    const labelBefore = await newtabPage.locator('.ff-nav .ff-sort__current').textContent();
    await newtabPage.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(newtabPage.locator('.ff-nav .ff-sort__current')).toHaveText(labelBefore ?? '');

    // Reopen and commit with Enter.
    await newtabPage.keyboard.press('ArrowDown');
    await expect(panel).toBeVisible();
    await newtabPage.keyboard.press('ArrowDown');
    const targetId = await trigger.getAttribute('aria-activedescendant');
    const targetLabel = await newtabPage.locator(`[id="${String(targetId)}"]`).textContent();
    await newtabPage.keyboard.press('Enter');
    await expect(panel).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(newtabPage.locator('.ff-nav .ff-sort__current')).toHaveText(targetLabel ?? '', { timeout: 2_000 });
  });

  test('Layout settings sort dropdown is keyboard-operable the same way', async ({ newtabPage }) => {
    await openSettingsSection(newtabPage, 'layout');
    const trigger = newtabPage.locator('.ff-drawer .ff-sort .ff-pill');
    await trigger.focus();

    await newtabPage.keyboard.press('ArrowDown');
    const panel = newtabPage.locator('.ff-drawer .ff-sort__panel');
    await expect(panel).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-activedescendant', /.+/);
    // Screen readers ignore aria-activedescendant on a plain button, so the trigger
    // must be a combobox that points at the open listbox.
    await expect(trigger).toHaveAttribute('role', 'combobox');
    await expect(trigger).toHaveAttribute('aria-controls', String(await panel.getAttribute('id')));

    await newtabPage.keyboard.press('ArrowDown');
    const targetId = await trigger.getAttribute('aria-activedescendant');
    const targetLabel = await newtabPage.locator(`[id="${String(targetId)}"]`).textContent();
    await newtabPage.keyboard.press('Enter');
    await expect(panel).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(newtabPage.locator('.ff-drawer .ff-sort__current')).toHaveText(targetLabel ?? '', { timeout: 2_000 });

    await newtabPage.keyboard.press('Escape');
  });

  test('TopNav workspace jump-menu opens on ArrowDown, moves with arrows, and Enter switches workspace', async ({ newtabPage, world }) => {
    // The jump-menu only renders once the tab strip overflows. Start (and end)
    // on the empty extra workspaces, not a promo persona — several promo
    // workspaces seed a real 'Linear' bookmark, and switching workspace can
    // shift DOM focus onto the newly-visible tile grid; keeping both the
    // source and target workspace free of real bookmarks keeps this test's
    // Enter keypress from ever reaching a live link.
    const folderIds = await seedExtraWorkspaces(newtabPage, 10);
    // Bookmark folders outlive the per-test storage reset, so remove them even when an assertion fails.
    try {
      const extraIds = Array.from({ length: 10 }, (_, i) => `ka-extra-ws-${String(i + 6)}`);
      // 'Remember last workspace' is off in the promo world, so main.tsx resets
      // activeWorkspaceId to workspaceOrder[0] on every boot — put both target
      // extras first in the order so that reset lands where this test expects.
      const order = [extraIds[0], extraIds[1], ...Object.values(world.workspaceIds), ...extraIds.slice(2)];
      await patchSettings(newtabPage, { workspaceOrder: order, activeWorkspaceId: extraIds[0] });
      await newtabPage.reload();
      await newtabPage.waitForSelector('.ff-app', { timeout: 15_000 });

      const trigger = newtabPage.locator('.ff-ws-dropdown .ff-pill');
      await expect(trigger).toBeVisible({ timeout: 5_000 });
      await trigger.focus();

      await newtabPage.keyboard.press('ArrowDown');
      const panel = newtabPage.locator('.ff-ws-dropdown__panel');
      await expect(panel).toBeVisible();
      await expect(trigger).toHaveAttribute('aria-activedescendant', /.+/);
      // Screen readers ignore aria-activedescendant on a plain button, so the trigger
      // must be a combobox that points at the open listbox.
      await expect(trigger).toHaveAttribute('role', 'combobox');
      await expect(trigger).toHaveAttribute('aria-controls', String(await panel.getAttribute('id')));

      await newtabPage.keyboard.press('ArrowDown');
      const activeOptionId = await trigger.getAttribute('aria-activedescendant');
      const activeOption = newtabPage.locator(`[id="${String(activeOptionId)}"]`);
      await expect(activeOption).toHaveAttribute('data-highlighted', 'true');
      const targetWorkspaceId = await activeOption.getAttribute('data-option-workspace-id');
      expect(targetWorkspaceId).toBe('ka-extra-ws-7');

      await newtabPage.keyboard.press('Enter');
      await expect(panel).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expect(workspaceTab(newtabPage, String(targetWorkspaceId))).toHaveClass(/is-active/, { timeout: 2_000 });
    } finally {
      for (const id of folderIds) {
        await removeBookmarkTree(newtabPage, id);
      }
    }
  });
});

test.describe('settings controls have accessible names', () => {
  test('Appearance section: every Toggle/Segmented/Slider resolves by role + name, with exactly one pressed Segmented option', async ({ newtabPage, world }) => {
    await openSettingsSection(newtabPage, 'appearance');
    const drawer = newtabPage.locator('.ff-drawer');

    // Unfixed code has no aria-labelledby on Toggle/Segmented/Slider, so
    // getByRole(..., { name }) finds nothing here.
    await expect(drawer.getByRole('switch', { name: 'Use system preference' })).toBeVisible();

    // The gradient background mode is Work's default, so its Intensity slider
    // is reachable without extra setup.
    await expect(drawer.getByRole('slider', { name: 'Intensity' })).toBeVisible();

    // Fit/Position/Opacity only render once a wallpaper is set — switch to
    // wallpaper mode and upload one via the same hidden file input a user drags
    // a file onto.
    await patchWorkspace(newtabPage, { backgroundMode: 'wallpaper' }, world.workspaceIds.Work);
    await newtabPage.reload();
    await newtabPage.waitForSelector('.ff-app', { timeout: 15_000 });
    await openSettingsSection(newtabPage, 'appearance');
    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    await drawer.locator('input[type="file"]').setInputFiles({ name: 'wallpaper.png', mimeType: 'image/png', buffer: pngBytes });

    const fit = drawer.getByRole('group', { name: 'Fit' });
    await expect(fit).toBeVisible({ timeout: 5_000 });
    await expect(fit.getByRole('button', { pressed: true })).toHaveCount(1);

    const position = drawer.getByRole('group', { name: 'Position' });
    await expect(position).toBeVisible();
    await expect(position.getByRole('button', { pressed: true })).toHaveCount(1);

    await expect(drawer.getByRole('slider', { name: 'Opacity' })).toBeVisible();
    await closeDrawerIfOpen(newtabPage);
  });

  test('Layout section: sliders and the show-tile-labels toggle resolve by role + name', async ({ newtabPage, world }) => {
    // The size sliders only render when the workspace uses the 'custom' layout
    // preset; the seeded Work workspace defaults to 'balanced'.
    await patchWorkspace(newtabPage, { layoutPreset: 'custom' }, world.workspaceIds.Work);
    await newtabPage.reload();
    await newtabPage.waitForSelector('.ff-app', { timeout: 15_000 });
    await openSettingsSection(newtabPage, 'layout');
    const drawer = newtabPage.locator('.ff-drawer');

    await expect(drawer.getByRole('slider', { name: 'Icon size' })).toBeVisible();
    await expect(drawer.getByRole('slider', { name: 'Tile width' })).toBeVisible();
    await expect(drawer.getByRole('slider', { name: 'Column gap' })).toBeVisible();
    await expect(drawer.getByRole('slider', { name: 'Row gap' })).toBeVisible();
    await expect(drawer.getByRole('switch', { name: 'Show tile labels' })).toBeVisible();
    await closeDrawerIfOpen(newtabPage);
  });

  test('Clock section: toggle and hour-format segmented resolve by role + name', async ({ newtabPage }) => {
    await closeDrawerIfOpen(newtabPage);
    await openSettingsSection(newtabPage, 'clock');
    const drawer = newtabPage.locator('.ff-drawer');

    await expect(drawer.getByRole('switch', { name: 'Show clock' })).toBeVisible();
    const hourFormat = drawer.getByRole('group', { name: 'Hour format' });
    await expect(hourFormat).toBeVisible();
    await expect(hourFormat.getByRole('button', { pressed: true })).toHaveCount(1);
    await closeDrawerIfOpen(newtabPage);
  });

  test('Dock section: visibility segmented resolves by role + name', async ({ newtabPage }) => {
    await closeDrawerIfOpen(newtabPage);
    await openSettingsSection(newtabPage, 'dock');
    const drawer = newtabPage.locator('.ff-drawer');

    const visibility = drawer.getByRole('group', { name: 'Visibility' });
    await expect(visibility).toBeVisible();
    await expect(visibility.getByRole('button', { pressed: true })).toHaveCount(1);
    await closeDrawerIfOpen(newtabPage);
  });

  test('Navigation section: every toggle and segmented resolves by role + name', async ({ newtabPage }) => {
    await closeDrawerIfOpen(newtabPage);
    await openSettingsSection(newtabPage, 'navigation');
    const drawer = newtabPage.locator('.ff-drawer');

    await expect(drawer.getByRole('switch', { name: 'Show search bar' })).toBeVisible();
    await expect(drawer.getByRole('switch', { name: 'Remember last workspace' })).toBeVisible();
    await expect(drawer.getByRole('switch', { name: 'Open bookmarks in new tab' })).toBeVisible();

    const openAs = drawer.getByRole('group', { name: 'Open folders as' });
    await expect(openAs).toBeVisible();
    await expect(openAs.getByRole('button', { pressed: true })).toHaveCount(1);

    const badge = drawer.getByRole('group', { name: 'Folder count badge' });
    await expect(badge).toBeVisible();
    await expect(badge.getByRole('button', { pressed: true })).toHaveCount(1);
    await closeDrawerIfOpen(newtabPage);
  });
});
