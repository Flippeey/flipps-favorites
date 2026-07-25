/**
 * Evidence spec for folder count badge visibility feature.
 * Demonstrates the folderCountBadgeMode setting: 'always' (default) vs 'hover'.
 */
import { test } from '../../fixtures/world.js';
import { tileById } from '../../fixtures/bookmark-helpers.js';
import { capture, settle } from '../evidence.js';

test.describe('folder count badge visibility', () => {
  test('toggle badge visibility between always and hover modes', async ({ newtabPage, world }, testInfo) => {
    // The seeded Work workspace has a "Project Apollo" folder with 4 child bookmarks.
    // This demonstrates a folder with a visible count badge.
    const projectApolloFolderId = world.bookmarkIdByTitle('Project Apollo');
    const folderTile = tileById(newtabPage, projectApolloFolderId);

    // ─────────────────────────────────────────────────────────────────────────
    // 1. Capture default state: badge always visible
    // ─────────────────────────────────────────────────────────────────────────
    await folderTile.waitFor({ state: 'visible', timeout: 5_000 });
    // CI runs headed under xvfb, where the very first capture can be reached
    // before the compositor has produced a frame; Page.captureScreenshot then
    // fails outright. Focus the tab and wait for two painted frames so there is
    // something to capture.
    await newtabPage.bringToFront();
    await newtabPage.evaluate(
      () => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
    );
    await capture(newtabPage, testInfo, 'default-always-visible');

    // ─────────────────────────────────────────────────────────────────────────
    // 2. Open settings drawer to Navigation section and capture the control
    // ─────────────────────────────────────────────────────────────────────────
    // Import the openSettingsSection helper
    const openSettingsSection = async (page: typeof newtabPage, section: string) => {
      const settingsBtn = page.getByRole('button', { name: 'Settings', exact: true });
      if (await page.locator('.ff-drawer').count() === 0) {
        await settingsBtn.click();
        await page.waitForSelector('.ff-drawer', { timeout: 5_000 });
      }
      const label = section.charAt(0).toUpperCase() + section.slice(1);
      await page.locator('.ff-drawer__navitem').filter({ hasText: label }).click();
    };
    await openSettingsSection(newtabPage, 'navigation');

    // Wait for the Segmented control labeled "Folder count badge" to appear and settle
    const badgeRow = newtabPage.locator('.ff-row', { hasText: 'Folder count badge' });
    await badgeRow.waitFor({ state: 'visible', timeout: 5_000 });
    await settle(badgeRow);
    await capture(newtabPage, testInfo, 'setting-control');

    // ─────────────────────────────────────────────────────────────────────────
    // 3. Switch setting to "On hover" mode
    // ─────────────────────────────────────────────────────────────────────────
    const onHoverButton = badgeRow.locator('.ff-segmented__option', { hasText: 'On hover' });
    await onHoverButton.click();
    await newtabPage.waitForTimeout(200); // Let the setting propagate

    // Close the drawer to show the updated grid
    const drawer = newtabPage.locator('.ff-drawer');
    const drawerCloseBtn = drawer.locator('button[aria-label="Close"]');
    await drawerCloseBtn.click();
    await drawer.waitFor({ state: 'hidden', timeout: 5_000 });

    // ─────────────────────────────────────────────────────────────────────────
    // 4. Capture folder tile with badge HIDDEN (not hovering)
    // ─────────────────────────────────────────────────────────────────────────
    await folderTile.waitFor({ state: 'visible', timeout: 5_000 });
    // Move mouse away from the tile to ensure it's not in hover state
    await newtabPage.mouse.move(0, 0);
    await newtabPage.waitForTimeout(100);
    await capture(newtabPage, testInfo, 'hover-mode-badge-hidden');

    // ─────────────────────────────────────────────────────────────────────────
    // 5. Hover the folder tile to reveal the badge
    // ─────────────────────────────────────────────────────────────────────────
    const folderBoundingBox = await folderTile.boundingBox();
    if (!folderBoundingBox) {
      throw new Error('Could not get bounding box for folder tile');
    }
    const centerX = folderBoundingBox.x + folderBoundingBox.width / 2;
    const centerY = folderBoundingBox.y + folderBoundingBox.height / 2;
    await newtabPage.mouse.move(centerX, centerY);
    await newtabPage.waitForTimeout(150); // Let hover animation complete (--dur-fast = 140ms)
    await capture(newtabPage, testInfo, 'hover-mode-badge-revealed');
  });
});
