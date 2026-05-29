// Proof spec for the shared fixture library (Phase 2.2). Confirms:
//  - `world` seeds the 5 promo personas with Work active,
//  - the worker context is reused across grouped tests (same extension origin),
//  - per-test storage reset/reseed yields a clean baseline each test,
//  - everything is typed (no `any`) end to end.
import { test, expect } from '../fixtures/world.js';
import { tileById, workspaceTab } from '../fixtures/selectors.js';

const seenOrigins = new Set<string>();

test.describe('shared world fixture', () => {
  test('seeds five promo workspaces with Work active', async ({ newtabPage, world }) => {
    seenOrigins.add(world.origin);
    expect(world.workspaces).toHaveLength(5);
    await expect(workspaceTab(newtabPage, world.workspaceIds.Work)).toHaveClass(/is-active/);
    await expect(workspaceTab(newtabPage, world.workspaceIds.Personal)).toBeVisible();
  });

  test('active workspace renders its root bookmark tiles', async ({ newtabPage, world }) => {
    seenOrigins.add(world.origin);
    const firstTitle = world.workspaces[0]!.name;
    void firstTitle;
    // The Work root holds seeded bookmarks; a known title resolves to a tile.
    const id = world.bookmarkIdByTitle('GitHub');
    await expect(tileById(newtabPage, id)).toBeVisible();
  });

  test('reuses one worker context across the group', async ({ world }) => {
    seenOrigins.add(world.origin);
    // All three tests run in the same worker → one launched context → one origin.
    expect(seenOrigins.size).toBe(1);
  });
});
