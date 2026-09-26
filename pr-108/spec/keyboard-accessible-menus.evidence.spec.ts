/**
 * Evidence: keyboard-operable context menu and sort dropdown.
 */
import { test } from '../../fixtures/world.js';
import { openContextMenu } from '../../fixtures/bookmark-helpers.js';
import { tileById } from '../../fixtures/selectors.js';
import { capture } from '../evidence.js';

test.describe('evidence: keyboard-accessible menus', () => {
  test('context menu keyboard focus lands on the second item', async ({ newtabPage, world }, testInfo) => {
    const tile = tileById(newtabPage, world.bookmarkIdByTitle('GitHub'));
    const menu = await openContextMenu(newtabPage, tile);
    await menu.waitFor({ state: 'visible' });

    await newtabPage.keyboard.press('ArrowDown');
    await newtabPage.keyboard.press('ArrowDown');
    await menu.getByRole('menuitem').nth(1).waitFor({ state: 'visible' });
    await capture(newtabPage, testInfo, 'context-menu-second-item-focused');
  });

  test('sort dropdown keyboard-highlighted option', async ({ newtabPage }, testInfo) => {
    const trigger = newtabPage.locator('.ff-nav .ff-sort .ff-pill');
    await trigger.focus();
    await newtabPage.keyboard.press('ArrowDown');
    await newtabPage.keyboard.press('ArrowDown');
    const panel = newtabPage.locator('.ff-nav .ff-sort__panel');
    await panel.waitFor({ state: 'visible' });
    await capture(newtabPage, testInfo, 'sort-panel-highlighted-option');
  });
});
