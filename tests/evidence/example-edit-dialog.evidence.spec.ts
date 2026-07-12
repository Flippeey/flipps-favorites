/**
 * Reference evidence spec (not tied to a specific PR's new functionality).
 * Demonstrates the shape a real evidence spec should take: drive the UI to a
 * demonstrative moment for a feature, then capture labeled screenshots. Real
 * evidence specs replace this file's flow with the PR's actual new/changed
 * behavior.
 */
import { test } from '../fixtures/world.js';
import { openContextMenu, clickMenuItem } from '../fixtures/bookmark-helpers.js';
import { tileById } from '../fixtures/selectors.js';
import { capture } from './evidence.js';

test.describe('example: edit dialog', () => {
  test('open the edit dialog and edit a bookmark name', async ({ newtabPage, world }, testInfo) => {
    const tile = tileById(newtabPage, world.bookmarkIdByTitle('GitHub'));
    const menu = await openContextMenu(newtabPage, tile);
    await clickMenuItem(menu, 'Edit');

    const dialog = newtabPage.locator('.ff-dialog[role="dialog"]');
    await dialog.waitFor({ state: 'visible' });
    await capture(newtabPage, testInfo, 'dialog-open');

    const nameInput = dialog.locator('.ff-field', { hasText: 'Name' }).locator('.ff-input');
    await nameInput.fill('GitHub (renamed for evidence)');
    await capture(newtabPage, testInfo, 'name-edited');
  });
});
