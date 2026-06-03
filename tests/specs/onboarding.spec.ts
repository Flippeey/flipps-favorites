/**
 * Onboarding wizard â€” replay button opens it; stepping through closes it
 * and applied choices persist.
 */
import { test, expect } from '../fixtures/extension-context.js';
import { ACCENT_PRESETS } from '../fixtures/test-data.js';
import {
  clearExtensionStorage,
  createTestFolder,
  reloadNewtab,
  removeBookmarkTree,
  setupDefaultWorkspace,
} from '../fixtures/bookmark-helpers.js';

let rootId: string;

test.beforeEach(async ({ newtabPage }) => {
  await clearExtensionStorage(newtabPage);
  rootId = await createTestFolder(newtabPage, 'Onboard Root');
  await setupDefaultWorkspace(newtabPage, rootId);
  await reloadNewtab(newtabPage);
});

test.afterEach(async ({ newtabPage }) => {
  await removeBookmarkTree(newtabPage, rootId);
});

test('replay button opens onboarding; Skip closes it', async ({ newtabPage }) => {
  await expect(newtabPage.locator('.ff-onboard')).toHaveCount(0);
  await newtabPage.getByRole('button', { name: 'Replay onboarding' }).click();
  await expect(newtabPage.locator('.ff-onboard')).toBeVisible();
  await newtabPage.getByRole('button', { name: 'Skip' }).click();
  await expect(newtabPage.locator('.ff-onboard')).toHaveCount(0);
});

test('workspace step requires at least one folder before advancing', async ({ newtabPage }) => {
  await newtabPage.getByRole('button', { name: 'Replay onboarding' }).click();
  const onboard = newtabPage.locator('.ff-onboard');
  await expect(onboard).toBeVisible();

  // Step 0 -> step 1 (workspace selection). A folder is seeded by default, so Next is enabled.
  await onboard.getByRole('button', { name: /Next/i }).click();
  const nextBtn = onboard.getByRole('button', { name: /Next/i });
  await expect(nextBtn).toBeEnabled();

  // Deselect the seeded folder -> nothing chosen -> Next is blocked (the validation rule).
  await onboard.getByRole('button', { name: /Onboard Root/ }).first().click();
  await expect(nextBtn).toBeDisabled();

  // Reselecting a folder re-enables advancing.
  await onboard.getByRole('button', { name: /Onboard Root/ }).first().click();
  await expect(nextBtn).toBeEnabled();
});

test('Next through all steps reaches "Get started" and chosen accent persists', async ({ newtabPage }) => {
  await newtabPage.getByRole('button', { name: 'Replay onboarding' }).click();
  const onboard = newtabPage.locator('.ff-onboard');
  await expect(onboard).toBeVisible();

  // Advance to the accent picker (step 3).
  await onboard.getByRole('button', { name: /Next/i }).click(); // -> workspace mode
  await onboard.getByRole('button', { name: /Next/i }).click(); // -> theme
  await onboard.getByRole('button', { name: /Next/i }).click(); // -> accent
  // Pick "Red" accent (preset chip with aria-label "Red").
  await onboard.getByRole('button', { name: 'Red', exact: true }).click();

  // Advance through remaining steps to the finish.
  await onboard.getByRole('button', { name: /Next/i }).click(); // -> theme cards
  await onboard.getByRole('button', { name: /Next/i }).click(); // -> tips

  await onboard.getByRole('button', { name: /Get started/i }).click();
  await expect(onboard).toHaveCount(0);

  const accent = await newtabPage.evaluate(() =>
    document.documentElement.style.getPropertyValue('--accent'),
  );
  expect(accent.toLowerCase()).toBe(ACCENT_PRESETS.red.toLowerCase());

  // Persists after reload (settings sync).
  await reloadNewtab(newtabPage);
  const afterReload = await newtabPage.evaluate(() =>
    document.documentElement.style.getPropertyValue('--accent'),
  );
  expect(afterReload.toLowerCase()).toBe(ACCENT_PRESETS.red.toLowerCase());
});
