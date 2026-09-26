/**
 * Evidence for: theme toggle keeps the shown mode; guard new-workspace and
 * Quick Add submits.
 *
 * Captures:
 *  - Quick Add rejecting the untouched default URL ("Enter a URL.").
 *  - The Light theme card still active after turning system mode off while
 *    the OS reports light — the mode shown to the user doesn't change.
 */
import { test, expect } from '../../fixtures/world.js';
import { openSettingsSection } from '../../fixtures/bookmark-helpers.js';
import { capture } from '../evidence.js';

test.describe('dialog and theme guards', () => {
  test('Quick Add rejects the untouched default URL', async ({ newtabPage }, testInfo) => {
    await newtabPage.getByRole('button', { name: 'Add', exact: true }).click();
    await newtabPage.locator('.ff-ctx').getByRole('menuitem', { name: /Add bookmark/i }).click();
    const dialog = newtabPage.locator('.ff-dialog');
    await dialog.getByRole('button', { name: /Add bookmark/i }).click();

    await expect(dialog.locator('.ff-status[data-kind="error"]')).toContainText('Enter a URL.');
    await capture(newtabPage, testInfo, 'quickadd-default-url-error');
  });

  test('Light card stays active after leaving system mode', async ({ newtabPage }, testInfo) => {
    await newtabPage.emulateMedia({ colorScheme: 'light' });
    await openSettingsSection(newtabPage, 'appearance');

    const toggleRow = newtabPage.locator('.ff-row', { hasText: 'Use system preference' });
    await toggleRow.locator('.ff-toggle').click();
    await expect.poll(() =>
      newtabPage.evaluate(() => document.documentElement.dataset.theme),
    ).toBe('light');

    await toggleRow.locator('.ff-toggle').click();
    await expect(newtabPage.locator('.ff-themecard--light')).toHaveAttribute('data-active', 'true');
    await capture(newtabPage, testInfo, 'light-card-active-after-system-off');
  });
});
