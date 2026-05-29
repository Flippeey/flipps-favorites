/**
 * Settings drawer: open/close, section navigation, theme + accent persistence,
 * dock visibility, layout preset.
 */
import { test, expect } from '../fixtures/extension-context.js';
import { ACCENT_PRESETS } from '../fixtures/test-data.js';
import {
  clearExtensionStorage,
  createTestFolder,
  openSettingsSection,
  patchSettings,
  patchWorkspace,
  reloadNewtab,
  removeBookmarkTree,
  setupDefaultWorkspace,
} from '../fixtures/bookmark-helpers.js';

let rootId: string;

test.beforeEach(async ({ newtabPage }) => {
  await clearExtensionStorage(newtabPage);
  rootId = await createTestFolder(newtabPage, 'Settings Root');
  await setupDefaultWorkspace(newtabPage, rootId);
  await reloadNewtab(newtabPage);
});

test.afterEach(async ({ newtabPage }) => {
  await removeBookmarkTree(newtabPage, rootId);
});

test('settings drawer opens, closes via button + ESC + scrim', async ({ newtabPage }) => {
  await newtabPage.getByRole('button', { name: 'Settings', exact: true }).click();
  const drawer = newtabPage.locator('.ff-drawer');
  await expect(drawer).toBeVisible();

  await drawer.getByRole('button', { name: 'Close' }).click();
  await expect(drawer).toHaveCount(0);

  // ESC closes
  await newtabPage.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(drawer).toBeVisible();
  await newtabPage.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);

  // Scrim mousedown closes (the scrim handler fires on mousedown when the
  // target is the scrim itself, not a child).
  await newtabPage.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(drawer).toBeVisible();
  await newtabPage.locator('.ff-modal-scrim').dispatchEvent('mousedown');
  await expect(drawer).toHaveCount(0);
});

test('drawer Appearance section reveals theme cards', async ({ newtabPage }) => {
  await openSettingsSection(newtabPage, 'appearance');
  await expect(newtabPage.locator('.ff-themecard--light')).toBeVisible();
  await expect(newtabPage.locator('.ff-themecard--dark')).toBeVisible();
});

test('switching to Light theme sets documentElement[data-theme]=light', async ({ newtabPage }) => {
  await openSettingsSection(newtabPage, 'appearance');
  await newtabPage.locator('.ff-themecard--light').click();
  await expect.poll(() =>
    newtabPage.evaluate(() => document.documentElement.dataset.theme),
  ).toBe('light');

  await newtabPage.locator('.ff-themecard--dark').click();
  await expect.poll(() =>
    newtabPage.evaluate(() => document.documentElement.dataset.theme),
  ).toBe('dark');
});

test('theme choice persists after reload', async ({ newtabPage }) => {
  await openSettingsSection(newtabPage, 'appearance');
  await newtabPage.locator('.ff-themecard--light').click();
  await reloadNewtab(newtabPage);
  await expect.poll(() =>
    newtabPage.evaluate(() => document.documentElement.dataset.theme),
  ).toBe('light');
});

test('accent chip applies --accent CSS variable on documentElement', async ({ newtabPage }) => {
  await openSettingsSection(newtabPage, 'appearance');
  // Pick the first accent chip (Blue).
  await newtabPage.locator('.ff-accentchip').first().click();
  const accent = await newtabPage.evaluate(() =>
    document.documentElement.style.getPropertyValue('--accent'),
  );
  expect(accent.toLowerCase()).toBe(ACCENT_PRESETS.blue.toLowerCase());
});

test('accent persists after reload', async ({ newtabPage }) => {
  await openSettingsSection(newtabPage, 'appearance');
  // Red is the 7th chip (index 6).
  const chips = newtabPage.locator('.ff-accentchip');
  await chips.nth(6).click();
  await reloadNewtab(newtabPage);
  const accent = await newtabPage.evaluate(() =>
    document.documentElement.style.getPropertyValue('--accent'),
  );
  expect(accent.toLowerCase()).toBe(ACCENT_PRESETS.red.toLowerCase());
});

test('dock visibility: hidden hides .ff-dock-wrap; hover sets data-mode=hover', async ({ newtabPage }) => {
  await patchSettings(newtabPage, { showDock: false });
  await reloadNewtab(newtabPage);
  await expect(newtabPage.locator('.ff-dock-wrap')).toHaveCount(0);

  await patchSettings(newtabPage, { showDock: true, autoHideDock: true });
  await reloadNewtab(newtabPage);
  await expect(newtabPage.locator('.ff-dock-wrap')).toHaveAttribute('data-mode', 'hover');

  await patchSettings(newtabPage, { showDock: true, autoHideDock: false });
  await reloadNewtab(newtabPage);
  await expect(newtabPage.locator('.ff-dock-wrap')).toHaveAttribute('data-mode', 'always');
});

test('layout preset persists after reload', async ({ newtabPage }) => {
  await patchWorkspace(newtabPage, { layoutPreset: 'compact' });
  await reloadNewtab(newtabPage);
  const tileSize = await newtabPage.evaluate(() =>
    document.documentElement.style.getPropertyValue('--tile-size'),
  );
  expect(tileSize.trim()).toBe('56px');
});
