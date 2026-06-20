/**
 * Bug #35 — Stale drag-source attributes after workspace switch.
 *
 * WHY this test matters: if data-drag-source="true" persists on tiles after
 * a workspace switch, those tiles render at 0.35 opacity (the drag-source
 * dimming rule in interactions.css), making favicons appear grayscale/muted
 * even though no drag is in progress. The fix ensures all drag-related DOM
 * state is cleared on switch.
 *
 * The test verifies the invariant: after switching workspaces, no tile in the
 * document may carry data-drag-source="true" and no tile may have an opacity
 * below 1 (unless it has an explicit CSS reason like dock hover state).
 */
import { test, expect } from '../fixtures/world.js';
import { workspaceTab } from '../fixtures/selectors.js';

test('no tiles have data-drag-source after workspace switches', async ({ newtabPage, world }) => {
  // Wait for tiles to render in the initial (Work) workspace.
  await newtabPage.locator('.ff-canvas [data-item-id]').first().waitFor({ timeout: 10_000 });

  // Switch to each workspace and back, checking the invariant after each switch.
  const personas: Array<'Personal' | 'AI' | 'Design' | 'Gaming' | 'Work'> = [
    'Personal', 'AI', 'Design', 'Gaming', 'Work',
  ];

  for (const persona of personas) {
    const wsId = world.workspaceIds[persona];
    const tab = workspaceTab(newtabPage, wsId);
    await tab.click();
    // Wait for the switch animation to settle (data-switching removed).
    await newtabPage.locator('.ff-app:not([data-switching])').waitFor({ timeout: 5_000 });
    // Wait for at least one tile to render in the new workspace.
    await newtabPage.locator('.ff-canvas [data-item-id]').first().waitFor({ timeout: 10_000 });

    // INVARIANT: no tile anywhere in the document should carry data-drag-source.
    const stuckDragSources = await newtabPage.locator('[data-drag-source="true"]').count();
    expect(stuckDragSources, `stuck data-drag-source after switching to ${persona}`).toBe(0);

    // INVARIANT: no visible tile should have reduced opacity (the muted symptom).
    // We check the computed opacity of all tiles in the canvas (not the dock,
    // whose hover-reveal uses opacity legitimately).
    const mutedTiles = await newtabPage.evaluate(() => {
      const tiles = document.querySelectorAll<HTMLElement>('.ff-canvas [data-item-id]');
      let count = 0;
      for (const tile of tiles) {
        const opacity = parseFloat(getComputedStyle(tile).opacity);
        if (opacity < 0.99) count++;
      }
      return count;
    });
    expect(mutedTiles, `muted tiles after switching to ${persona}`).toBe(0);
  }
});
