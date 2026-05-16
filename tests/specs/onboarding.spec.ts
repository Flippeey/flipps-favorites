/**
 * Onboarding wizard — replay button opens it; stepping through closes it
 * and applied choices persist.
 */
import { test, expect } from '../fixtures/extension-context.js';
import { ACCENT_PRESETS } from '../fixtures/test-data.js';
import {
  clearExtensionStorage,
  createTestFolder,
  reloadNewtab,
  removeBookmarkTree,
  setRootFolderId,
} from '../fixtures/bookmark-helpers.js';

let rootId: string;

test.beforeEach(async ({ newtabPage }) => {
  await clearExtensionStorage(newtabPage);
  rootId = await createTestFolder(newtabPage, 'Onboard Root');
  await setRootFolderId(newtabPage, rootId);
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

test('Next through all steps reaches "Get started" and chosen accent persists', async ({ newtabPage }) => {
  await newtabPage.getByRole('button', { name: 'Replay onboarding' }).click();
  const onboard = newtabPage.locator('.ff-onboard');
  await expect(onboard).toBeVisible();

  // Step 0 → 1 (accent picker).
  await onboard.getByRole('button', { name: /Next/i }).click();
  // Pick "Red" accent (preset chip with aria-label "Red").
  await onboard.getByRole('button', { name: 'Red', exact: true }).click();

  // Advance through remaining steps.
  await onboard.getByRole('button', { name: /Next/i }).click(); // → layout
  await onboard.getByRole('button', { name: /Next/i }).click(); // → folder mode
  await onboard.getByRole('button', { name: /Next/i }).click(); // → final

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
