/**
 * Settings → Navigation (App Settings gear drawer).
 *
 * Why each test matters: the Navigation section controls how users move through
 * the extension. The gear drawer must open/close reliably, and every toggle
 * must write to AppSettings so the preference is reflected on reload.
 */
import { test, expect } from '../fixtures/world.js';
import { openSettingsSection, reloadNewtab } from '../fixtures/bookmark-helpers.js';
import { patchSettings, waitForSettings } from '../fixtures/seeding.js';
import type { Page } from '@playwright/test';

async function openNavigation(page: Page): Promise<void> {
  await openSettingsSection(page, 'navigation');
}

// ---------------------------------------------------------------------------
// Drawer open / close
// ---------------------------------------------------------------------------
test.describe('settings-nav: drawer lifecycle', () => {
  test('Settings gear opens the app settings drawer', async ({ newtabPage }) => {
    await newtabPage.getByRole('button', { name: 'Settings', exact: true }).click();
    const drawer = newtabPage.locator('.ff-drawer');
    await expect(drawer).toBeVisible();
  });

  test('Customize workspace button opens the workspace settings drawer', async ({ newtabPage }) => {
    await newtabPage.getByRole('button', { name: 'Customize workspace', exact: true }).click();
    const drawer = newtabPage.locator('.ff-drawer');
    await expect(drawer).toBeVisible();
    // Workspace drawer header shows the eyebrow "Workspace ·…".
    await expect(newtabPage.locator('.ff-dialog__eyebrow', { hasText: 'Workspace' })).toBeVisible();
  });

  test('drawer closes via the Close button', async ({ newtabPage }) => {
    await newtabPage.getByRole('button', { name: 'Settings', exact: true }).click();
    const drawer = newtabPage.locator('.ff-drawer');
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: 'Close' }).click();
    await expect(drawer).toHaveCount(0);
  });

  test('drawer closes via ESC key', async ({ newtabPage }) => {
    await newtabPage.getByRole('button', { name: 'Settings', exact: true }).click();
    const drawer = newtabPage.locator('.ff-drawer');
    await expect(drawer).toBeVisible();
    await newtabPage.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
  });

  test('drawer closes via scrim mousedown', async ({ newtabPage }) => {
    await newtabPage.getByRole('button', { name: 'Settings', exact: true }).click();
    const drawer = newtabPage.locator('.ff-drawer');
    await expect(drawer).toBeVisible();
    // The scrim handler fires on mousedown when the target IS the scrim element.
    await newtabPage.locator('.ff-modal-scrim').dispatchEvent('mousedown');
    await expect(drawer).toHaveCount(0);
  });
});

// View mode (Grid ↔ List) moved out of the app-settings Navigation drawer into
// the per-workspace Customize drawer (LayoutSection). Its coverage now lives in
// settings-layout.spec.ts, since folderMode is a WorkspaceRecord field.

// ---------------------------------------------------------------------------
// Folder open mode (Overlay ↔ Page)
// ---------------------------------------------------------------------------
test.describe('settings-nav: folder open mode', () => {
  test('switching to Page mode marks the Page option active', async ({ newtabPage }) => {
    await patchSettings(newtabPage, { folderOpenMode: 'overlay' });
    await reloadNewtab(newtabPage);

    await openNavigation(newtabPage);
    await newtabPage.locator('.ff-row', { hasText: 'Open folders as' })
      .locator('.ff-segmented__option', { hasText: 'Page' }).click();

    await expect(
      newtabPage.locator('.ff-row', { hasText: 'Open folders as' })
        .locator('.ff-segmented__option', { hasText: 'Page' }),
    ).toHaveAttribute('data-active', 'true');
  });

  test('switching back to Overlay marks the Overlay option active', async ({ newtabPage }) => {
    await patchSettings(newtabPage, { folderOpenMode: 'page' });
    await reloadNewtab(newtabPage);

    await openNavigation(newtabPage);
    await newtabPage.locator('.ff-row', { hasText: 'Open folders as' })
      .locator('.ff-segmented__option', { hasText: 'Overlay' }).click();

    await expect(
      newtabPage.locator('.ff-row', { hasText: 'Open folders as' })
        .locator('.ff-segmented__option', { hasText: 'Overlay' }),
    ).toHaveAttribute('data-active', 'true');
  });
});

// ---------------------------------------------------------------------------
// Toggles: Remember last + Show search bar
// ---------------------------------------------------------------------------
test.describe('settings-nav: toggles', () => {
  test('toggling Remember last workspace flips the toggle aria-checked state', async ({ newtabPage }) => {
    // First enable it so we have a known true baseline, then verify toggle off→on.
    // This avoids any ambiguity about the seeded starting value.
    await patchSettings(newtabPage, { rememberLastFolder: true });
    await reloadNewtab(newtabPage);

    await openNavigation(newtabPage);
    const row = newtabPage.locator('.ff-row', { hasText: 'Remember last workspace' });
    const toggle = row.locator('.ff-toggle');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  test('remember-last-workspace persists after reload', async ({ newtabPage }) => {
    await patchSettings(newtabPage, { rememberLastFolder: false });
    await reloadNewtab(newtabPage);

    await openNavigation(newtabPage);
    await newtabPage.locator('.ff-row', { hasText: 'Remember last workspace' }).locator('.ff-toggle').click();

    await newtabPage.keyboard.press('Escape');
    await expect(newtabPage.locator('.ff-drawer')).toHaveCount(0);
    await reloadNewtab(newtabPage);

    await openNavigation(newtabPage);
    await expect(
      newtabPage.locator('.ff-row', { hasText: 'Remember last workspace' }).locator('.ff-toggle'),
    ).toHaveAttribute('aria-checked', 'true');
  });

  test('toggling Show search bar flips the toggle aria-checked state', async ({ newtabPage }) => {
    await patchSettings(newtabPage, { showSearchBar: true });
    await reloadNewtab(newtabPage);

    await openNavigation(newtabPage);
    const row = newtabPage.locator('.ff-row', { hasText: 'Show search bar' });
    const toggle = row.locator('.ff-toggle');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  test('show-search-bar persists after reload', async ({ newtabPage }) => {
    await patchSettings(newtabPage, { showSearchBar: true });
    await reloadNewtab(newtabPage);

    await openNavigation(newtabPage);
    await newtabPage.locator('.ff-row', { hasText: 'Show search bar' }).locator('.ff-toggle').click();

    // Wait for the async settings write to commit before reloading.
    await waitForSettings(newtabPage, (s) => s.showSearchBar === false);
    await reloadNewtab(newtabPage);

    await openNavigation(newtabPage);
    await expect(
      newtabPage.locator('.ff-row', { hasText: 'Show search bar' }).locator('.ff-toggle'),
    ).toHaveAttribute('aria-checked', 'false');
  });
});
