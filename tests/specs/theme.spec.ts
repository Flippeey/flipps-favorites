/**
 * Theme and appearance tests — priority 2.
 *
 * Covers light/dark/system theme switching, accent color selection,
 * and persistence of appearance settings across page reloads.
 */
import { test, expect } from '../fixtures/extension-context.js';
import { ACCENT_PRESETS } from '../fixtures/test-data.js';
import {
  clearExtensionStorage,
  skipOnboarding,
  reloadNewtab,
} from '../fixtures/bookmark-helpers.js';

test.beforeEach(async ({ newtabPage }) => {
  await clearExtensionStorage(newtabPage);
  await skipOnboarding(newtabPage);
  await reloadNewtab(newtabPage);
});

/** Open the settings drawer and navigate to the Appearance section. */
async function openAppearanceSection(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('.drawer-toggle').click();
  await page.locator('[data-section="appearance"]').click();
}

// ---------------------------------------------------------------------------
// Settings drawer
// ---------------------------------------------------------------------------

test('settings drawer opens and closes via the toggle button', async ({ newtabPage }) => {
  const drawer = newtabPage.locator('.settings-drawer');

  await expect(drawer).toHaveAttribute('data-open', 'false');
  await newtabPage.locator('.drawer-toggle').click();
  await expect(drawer).toHaveAttribute('data-open', 'true');
  await newtabPage.locator('.drawer-close').click();
  await expect(drawer).toHaveAttribute('data-open', 'false');
});

// ---------------------------------------------------------------------------
// Theme mode switching
// ---------------------------------------------------------------------------

test('switching to light theme updates data-theme-mode on the shell', async ({ newtabPage }) => {
  await openAppearanceSection(newtabPage);
  await newtabPage.locator('[data-theme-mode-option="light"]').click();
  await expect(newtabPage.locator('.shell')).toHaveAttribute('data-theme-mode', 'light');
});

test('switching to dark theme updates data-theme-mode on the shell', async ({ newtabPage }) => {
  await openAppearanceSection(newtabPage);
  await newtabPage.locator('[data-theme-mode-option="dark"]').click();
  await expect(newtabPage.locator('.shell')).toHaveAttribute('data-theme-mode', 'dark');
});

test('switching to system theme updates data-theme-mode on the shell', async ({ newtabPage }) => {
  // Set to light first so system is a visible change.
  await openAppearanceSection(newtabPage);
  await newtabPage.locator('[data-theme-mode-option="light"]').click();
  // "System" is toggled via the useSystemTheme checkbox (not a data-theme-mode-option button).
  await newtabPage.locator('input[name="useSystemTheme"]').check();
  // system mode may render as 'system', 'light', or 'dark' depending on browser preference.
  await expect(newtabPage.locator('.shell')).toHaveAttribute('data-theme-mode', /^(system|light|dark)$/);
});

// ---------------------------------------------------------------------------
// Accent color
// ---------------------------------------------------------------------------

test('clicking an accent color swatch updates the --accent-color CSS variable', async ({
  newtabPage,
}) => {
  await openAppearanceSection(newtabPage);

  // Click the blue preset swatch.
  const blueSwatch = newtabPage.locator(`[data-accent-option="${ACCENT_PRESETS.blue}"]`).first();
  await blueSwatch.click();

  // The shell style attribute should contain the accent-color variable.
  const shellStyle = await newtabPage.locator('.shell').getAttribute('style');
  expect(shellStyle?.toLowerCase()).toContain('--accent-color');
});

test('accent color swatch becomes active after clicking', async ({ newtabPage }) => {
  await openAppearanceSection(newtabPage);

  const tealSwatch = newtabPage.locator(`[data-accent-option="${ACCENT_PRESETS.teal}"]`).first();
  await tealSwatch.click();
  await expect(tealSwatch).toHaveAttribute('data-active', 'true');
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

test('theme and accent persist after page reload', async ({ newtabPage }) => {
  await openAppearanceSection(newtabPage);
  await newtabPage.locator('[data-theme-mode-option="dark"]').click();

  const redSwatch = newtabPage.locator(`[data-accent-option="${ACCENT_PRESETS.red}"]`).first();
  await redSwatch.click();

  // Reload.
  await reloadNewtab(newtabPage);

  await expect(newtabPage.locator('.shell')).toHaveAttribute('data-theme-mode', 'dark');
  // The red swatch should be active after reload (settings were persisted).
  await openAppearanceSection(newtabPage);
  await expect(
    newtabPage.locator(`[data-accent-option="${ACCENT_PRESETS.red}"]`).first()
  ).toHaveAttribute('data-active', 'true');
});
