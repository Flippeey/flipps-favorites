/**
 * Clock: show/hide toggle and 12h/24h format. Why it matters — the clock is an
 * opt-in hero element driven by AppSettings (showClock / clockHourFormat); the
 * toggle must mount/unmount it and the format must change what the user reads.
 */
import { test, expect } from '../fixtures/world.js';
import { openSettingsSection } from '../fixtures/bookmark-helpers.js';

test.describe('clock', () => {
  test('show-clock toggle mounts and unmounts the hero clock', async ({ newtabPage }) => {
    const clock = newtabPage.locator('.ff-hero__clock-time');
    await expect(clock).toHaveCount(0); // default: clock off

    await openSettingsSection(newtabPage, 'clock');
    const showRow = newtabPage.locator('.ff-row', { hasText: 'Show clock' });
    await showRow.locator('.ff-toggle').click();
    await expect(clock).toBeVisible();

    await showRow.locator('.ff-toggle').click();
    await expect(clock).toHaveCount(0);
  });

  test('hour-format switch changes 24h↔12h rendering', async ({ newtabPage }) => {
    await openSettingsSection(newtabPage, 'clock');
    await newtabPage.locator('.ff-row', { hasText: 'Show clock' }).locator('.ff-toggle').click();

    const clock = newtabPage.locator('.ff-hero__clock-time');
    await expect(clock).toBeVisible();

    const formatRow = newtabPage.locator('.ff-row', { hasText: 'Hour format' });
    await formatRow.locator('.ff-segmented__option', { hasText: '12 h' }).click();
    await expect(clock).toHaveText(/\b(AM|PM)\b/i);

    await formatRow.locator('.ff-segmented__option', { hasText: '24 h' }).click();
    await expect(clock).not.toHaveText(/\b(AM|PM)\b/i);
  });
});
