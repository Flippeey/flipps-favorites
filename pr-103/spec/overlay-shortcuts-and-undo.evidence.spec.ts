/**
 * Evidence: workspace shortcuts stay off while the workspace settings drawer
 * is open, and middle-click on a bookmark inside a folder overlay opens a new
 * tab without closing the overlay.
 */
import { test } from '../../fixtures/world.js';
import { tileById } from '../../fixtures/selectors.js';
import { capture } from '../evidence.js';

test.describe('overlay shortcuts and overlay middle-click', () => {
  test('workspace settings drawer blocks Alt+Arrow / Alt+digit shortcuts', async ({ newtabPage }, testInfo) => {
    await newtabPage.getByRole('button', { name: 'Customize workspace' }).click();
    const drawer = newtabPage.locator('.ff-drawer[aria-label="Workspace settings"]');
    await drawer.waitFor({ state: 'visible' });
    await capture(newtabPage, testInfo, 'drawer-open-work-active');

    await newtabPage.keyboard.press('Alt+ArrowRight');
    await newtabPage.keyboard.press('Alt+2');
    // Settle window so a would-be (buggy) workspace switch would have time to
    // land before this capture, same reasoning as the regression test.
    await newtabPage.waitForTimeout(500);
    await capture(newtabPage, testInfo, 'drawer-open-after-shortcuts-work-still-active');
  });

  test('middle-click on a bookmark inside a folder overlay keeps the overlay open', async ({ newtabPage, world }, testInfo) => {
    const folderId = world.bookmarkIdByTitle('Project Apollo');
    await tileById(newtabPage, folderId).click();

    const overlay = newtabPage.locator('.ff-folder-overlay');
    await overlay.waitFor({ state: 'visible' });

    // Sprint Board lives inside Project Apollo (a nested bookmark), not the
    // root-level seed map, so locate it by its rendered title inside the
    // overlay rather than through bookmarkIdByTitle (root-level ids only).
    const tile = overlay.locator('.ff-tile', { hasText: 'Sprint Board' });
    await tile.waitFor();

    const [newPage] = await Promise.all([
      newtabPage.context().waitForEvent('page', { timeout: 10_000 }),
      tile.click({ button: 'middle' }),
    ]);
    await capture(newtabPage, testInfo, 'overlay-open-after-middle-click');
    await newPage.close();
  });
});
