/**
 * Task #34 — Icon visual consistency across workspace switches.
 *
 * WHY this test matters: after switching workspaces multiple times, stale
 * interaction state (drag-source attributes, selection styling) can leak
 * across workspace boundaries. When that happens, favicon images on
 * non-selected, non-dragging tiles render with reduced opacity or spurious
 * CSS filters (grayscale, desaturation), making perfectly healthy icons
 * look muted or broken.
 *
 * This spec complements drag-state-cleanup.spec.ts (bug #35) by focusing
 * on the favicon *image* elements specifically: it asserts that no
 * `.ff-favicon img` carries an unexpected `filter: grayscale()` or
 * reduced `opacity`, and that no non-selected tile retains
 * `data-drag-source="true"` after 3+ workspace round-trips.
 */
import { test, expect } from '../fixtures/world.js';
import { workspaceTab } from '../fixtures/selectors.js';

test('favicon images have no muted styling after multiple workspace switches', async ({
  newtabPage,
  world,
}) => {
  // Wait for the initial (Work) workspace to render tiles.
  await newtabPage.locator('.ff-canvas [data-item-id]').first().waitFor({ timeout: 10_000 });

  // Switch through all 5 personas (4 switches away from Work, then back) — 5
  // total switches, satisfying the "3+ times" acceptance criterion.
  const switchSequence: Array<'Personal' | 'AI' | 'Design' | 'Gaming' | 'Work'> = [
    'Personal',
    'AI',
    'Design',
    'Gaming',
    'Work',
  ];

  for (const persona of switchSequence) {
    const wsId = world.workspaceIds[persona];
    await workspaceTab(newtabPage, wsId).click();

    // Wait for the switch animation to complete (data-switching removed).
    await newtabPage.locator('.ff-app:not([data-switching])').waitFor({ timeout: 5_000 });
    // Wait for at least one tile to render in the new workspace.
    await newtabPage.locator('.ff-canvas [data-item-id]').first().waitFor({ timeout: 10_000 });

    // --- Invariant 1: no non-selected tile carries data-drag-source ---
    // A tile that is selected might legitimately carry transient interaction
    // attributes, but a tile that is NOT selected must never have
    // data-drag-source="true" — that would dim it to 0.35 opacity.
    const stuckNonSelectedDragSources = await newtabPage
      .locator('.ff-canvas [data-item-id]:not([data-selected="true"])[data-drag-source="true"]')
      .count();
    expect(
      stuckNonSelectedDragSources,
      `non-selected tile with data-drag-source after switching to ${persona}`,
    ).toBe(0);

    // --- Invariant 2: no favicon img has filter: grayscale() ---
    // The extension never intentionally applies grayscale to favicons. If
    // any computed filter contains "grayscale" it is a leaked artifact.
    const grayscaleIcons = await newtabPage.evaluate(() => {
      const imgs = document.querySelectorAll<HTMLElement>('.ff-canvas .ff-favicon img');
      let count = 0;
      for (const img of imgs) {
        const filter = getComputedStyle(img).filter;
        if (filter && filter.includes('grayscale')) count++;
      }
      return count;
    });
    expect(
      grayscaleIcons,
      `favicon images with grayscale filter after switching to ${persona}`,
    ).toBe(0);

    // --- Invariant 3: no favicon img has reduced opacity ---
    // Favicon images should render at full opacity. A value below 1 on the
    // img element itself (as opposed to the parent tile, which #35 covers)
    // indicates a leaked interaction style.
    const mutedFaviconImages = await newtabPage.evaluate(() => {
      const imgs = document.querySelectorAll<HTMLElement>('.ff-canvas .ff-favicon img');
      let count = 0;
      for (const img of imgs) {
        const opacity = parseFloat(getComputedStyle(img).opacity);
        if (opacity < 0.99) count++;
      }
      return count;
    });
    expect(
      mutedFaviconImages,
      `favicon images with reduced opacity after switching to ${persona}`,
    ).toBe(0);

    // --- Invariant 4: no non-selected tile has reduced computed opacity ---
    // Tiles that are not selected and not being dragged should render at
    // full opacity. This catches any path where the tile container itself
    // (not just the img) gets dimmed by a stale data attribute.
    const dimmedNonSelectedTiles = await newtabPage.evaluate(() => {
      const tiles = document.querySelectorAll<HTMLElement>(
        '.ff-canvas [data-item-id]:not([data-selected="true"])',
      );
      let count = 0;
      for (const tile of tiles) {
        const opacity = parseFloat(getComputedStyle(tile).opacity);
        if (opacity < 0.99) count++;
      }
      return count;
    });
    expect(
      dimmedNonSelectedTiles,
      `non-selected tiles with reduced opacity after switching to ${persona}`,
    ).toBe(0);
  }
});
