/**
 * Unified promo recorder for Flipp's Favorites.
 *
 *   node scripts/promo/record.mjs              # all 8 scenarios
 *   node scripts/promo/record.mjs --only=search,themes
 *   node scripts/promo/record.mjs --list
 *
 * Requires: `npm run build:chrome` first.
 *
 * Output:
 *   promo/videos/<scenario>.webm   (≤ 15s each by design; GIF script enforces cap)
 *   promo/screenshots/<scenario>/<n>-<name>.png   (3–5 per scenario)
 *
 * All scenarios use dark mode + orange accent except onboarding (which picks
 * orange during its own flow).
 */

import {
  ACCENT_ORANGE,
  VIDEO_DIR,
  VIEWPORT,
  cleanupProfile,
  discoverOrigin,
  launchContext,
  moveToBox,
  openNewtab,
  patchSettings,
  saveVideo,
  seedTree,
  shot,
  skipOnboarding,
  sleep,
  smoothMove,
  typeSlowly,
} from './lib.mjs';
import { readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const ALL_SCENARIOS = [
  '01-search',
  '02-onboarding',
  '03-view-modes',
  '04-themes',
  '05-dock-hover',
  '06-drag-select',
  '07-nested-folders',
  '08-sorting',
];

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = { only: null, list: false };
  for (const a of args) {
    if (a === '--list') flags.list = true;
    else if (a.startsWith('--only=')) {
      flags.only = a.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return flags;
}

function chooseScenarios(only) {
  if (!only) return ALL_SCENARIOS;
  return ALL_SCENARIOS.filter((s) => only.some((q) => s.includes(q.replace(/^\d+-/, ''))));
}

// ─── Common base settings ───────────────────────────────────────────────────

function baseSettings(rootFolderId, dockFolderId, overrides = {}) {
  return {
    rootFolderId,
    dockFolderId,
    themeMode: 'dark',
    accentColor: ACCENT_ORANGE,
    rememberLastFolder: false,
    showDock: true,
    autoHideDock: false,
    showClock: false,
    showSearchBar: true,
    searchBarPosition: 'center',
    searchScope: 'library',
    folderMode: 'tiles',
    folderOpenMode: 'overlay',
    tileShape: 'squircle',
    layoutPreset: 'balanced',
    bookmarkSortMode: 'manual',
    bookmarkSortDirection: 'asc',
    showTileLabels: true,
    backgroundMode: 'gradient',
    gradientStyle: 'top-bottom',
    ...overrides,
  };
}

/** Open a fresh newtab page in the recording context, apply settings, settle. */
async function scene(context, origin, settings) {
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);
  await page.goto(`${origin}/newtab.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ff-app', { timeout: 15_000 });

  await skipOnboarding(page);
  await patchSettings(page, settings);
  await page.goto(`${origin}/newtab.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ff-app', { timeout: 15_000 });
  await page.waitForTimeout(2200); // icon settle
  return page;
}

// ─── Scenario 1: Searching bookmarks ───────────────────────────────────────

async function recordSearch(context, origin, ids) {
  console.log('\n▶ 01-search');
  const page = await scene(
    context,
    origin,
    baseSettings(ids.rootId, ids.dockId, { showSearchBar: true, searchScope: 'library' }),
  );

  await shot(page, '01-search', '01-overview');

  const input = page.locator('.ff-search input');
  const box = await input.boundingBox();
  await smoothMove(page, VIEWPORT.width / 2, 540, box.x + box.width / 2, box.y + box.height / 2, 500);
  await input.click();
  await sleep(250);
  await shot(page, '01-search', '02-focused');

  await typeSlowly(input, 'youtube', 90);
  await sleep(900);
  await shot(page, '01-search', '03-results-youtube');

  // Clear, search again — show folder-path metadata in matches.
  await input.fill('');
  await sleep(250);
  await typeSlowly(input, 'react', 90);
  await sleep(900);
  await shot(page, '01-search', '04-results-react');

  await input.fill('');
  await sleep(250);
  await typeSlowly(input, 'spot', 90);
  await sleep(900);
  await shot(page, '01-search', '05-results-spot');

  await saveVideo(page, '01-search');
}

// ─── Scenario 2: Onboarding ────────────────────────────────────────────────

async function recordOnboarding(context, origin, ids) {
  console.log('\n▶ 02-onboarding');
  const page = await scene(
    context,
    origin,
    baseSettings(ids.rootId, ids.dockId, { accentColor: '#3F72DC' /* will switch to orange */ }),
  );

  // Trigger the wizard via the Replay button (App.tsx never auto-opens it).
  await page.getByRole('button', { name: 'Replay onboarding' }).click();
  await page.waitForSelector('.ff-onboard', { timeout: 8_000 });
  await sleep(1000);
  await shot(page, '02-onboarding', '01-welcome');

  // Step 0 → 1 (accent picker).
  await page.getByRole('button', { name: /Next/i }).click();
  await sleep(900);
  await shot(page, '02-onboarding', '02-accent-step');
  // Pick Orange.
  await page.locator('.ff-accentchip').filter({ hasText: /Orange/i }).click();
  await sleep(700);

  // Step 1 → 2 (layout).
  await page.getByRole('button', { name: /Next/i }).click();
  await sleep(700);
  await shot(page, '02-onboarding', '03-layout-step');

  // Step 2 → 3 (folder mode).
  await page.getByRole('button', { name: /Next/i }).click();
  await sleep(700);
  await shot(page, '02-onboarding', '04-folder-mode-step');

  // Step 3 → 4 (final).
  await page.getByRole('button', { name: /Next/i }).click();
  await sleep(700);
  await page.getByRole('button', { name: /Get started/i }).click();
  await page.waitForSelector('.ff-onboard', { state: 'detached', timeout: 5_000 });
  await sleep(900);
  await shot(page, '02-onboarding', '05-finished');

  await saveVideo(page, '02-onboarding');
}

// ─── Scenario 3: Section view vs Tile view ─────────────────────────────────

async function recordViewModes(context, origin, ids) {
  console.log('\n▶ 03-view-modes');
  const page = await scene(
    context,
    origin,
    baseSettings(ids.rootId, ids.dockId, { folderMode: 'tiles' }),
  );

  await shot(page, '03-view-modes', '01-tiles');
  await sleep(1500);

  // Open settings → Navigation → flip folderMode to Sections.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.waitForSelector('.ff-drawer', { timeout: 5_000 });
  await sleep(500);
  await page.locator('.ff-drawer__navitem').filter({ hasText: 'Navigation' }).click();
  await sleep(500);
  await shot(page, '03-view-modes', '02-nav-settings');

  // Click the Sections option in the segmented control.
  await page.locator('.ff-segmented__option', { hasText: 'Sections' }).first().click();
  await sleep(900);

  // Close drawer (Close button via aria-label).
  await page.locator('.ff-drawer').getByRole('button', { name: 'Close' }).click();
  await page.waitForSelector('.ff-drawer', { state: 'detached', timeout: 3_000 });
  await sleep(1200);
  await shot(page, '03-view-modes', '03-sections');

  // Scroll the canvas to reveal more sections.
  await page.evaluate(() => {
    const c = document.querySelector('.ff-canvas') ?? document.scrollingElement;
    c?.scrollBy({ top: 400, behavior: 'smooth' });
  });
  await sleep(1500);
  await shot(page, '03-view-modes', '04-sections-scrolled');

  await saveVideo(page, '03-view-modes');
}

// ─── Scenario 4: Theme options (dark + accent cycle) ───────────────────────

async function recordThemes(context, origin, ids) {
  console.log('\n▶ 04-themes');
  const page = await scene(
    context,
    origin,
    baseSettings(ids.rootId, ids.dockId, { accentColor: '#3F72DC' }),
  );

  await shot(page, '04-themes', '01-dark-blue');

  // Open Appearance section.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.waitForSelector('.ff-drawer', { timeout: 5_000 });
  await page.locator('.ff-drawer__navitem').filter({ hasText: 'Appearance' }).click();
  await sleep(700);
  await shot(page, '04-themes', '02-appearance-pane');

  // Cycle accents: Teal → Purple → Red → Orange (final).
  // ACCENT_PRESETS order: Blue Teal Green Lime Yellow Orange Red Rose Pink Purple Slate Graphite
  const accentSequence = [1 /*Teal*/, 9 /*Purple*/, 6 /*Red*/, 5 /*Orange*/];
  for (let i = 0; i < accentSequence.length; i++) {
    const idx = accentSequence[i];
    const chip = page.locator('.ff-accentchip').nth(idx);
    const box = await chip.boundingBox();
    if (box) await moveToBox(page, box, 350);
    await chip.click();
    await sleep(700);
    if (i === 1) await shot(page, '04-themes', '03-purple');
    if (i === 3) await shot(page, '04-themes', '04-orange-final');
  }

  // Brief flash of light mode then back to dark.
  await page.locator('.ff-themecard--light').click();
  await sleep(900);
  await shot(page, '04-themes', '05-light-orange');
  await page.locator('.ff-themecard--dark').click();
  await sleep(700);

  await saveVideo(page, '04-themes');
}

// ─── Scenario 5: Dock with hover (auto-hide) ───────────────────────────────

async function recordDockHover(context, origin, ids) {
  console.log('\n▶ 05-dock-hover');
  const page = await scene(
    context,
    origin,
    baseSettings(ids.rootId, ids.dockId, { showDock: true, autoHideDock: true }),
  );

  // Dock starts hidden — show empty stage.
  await page.mouse.move(VIEWPORT.width / 2, 200);
  await sleep(700);
  await shot(page, '05-dock-hover', '01-dock-hidden');

  // Move toward bottom to reveal dock.
  await smoothMove(page, VIEWPORT.width / 2, 200, VIEWPORT.width / 2, VIEWPORT.height - 30, 900);
  await sleep(700);
  await shot(page, '05-dock-hover', '02-dock-revealed');

  // Glide along the dock to highlight a couple icons.
  const items = page.locator('.ff-dock__item');
  const count = await items.count();
  if (count > 0) {
    const firstBox = await items.first().boundingBox();
    const lastBox  = await items.nth(Math.min(count - 1, 8)).boundingBox();
    if (firstBox && lastBox) {
      await smoothMove(page, firstBox.x, firstBox.y + firstBox.height / 2, lastBox.x + lastBox.width / 2, lastBox.y + lastBox.height / 2, 1600);
    }
    await sleep(500);
    await shot(page, '05-dock-hover', '03-hovering-items');
  }

  // Glide away — dock should retract.
  await smoothMove(page, VIEWPORT.width / 2, VIEWPORT.height - 30, VIEWPORT.width / 2, 240, 900);
  await sleep(900);
  await shot(page, '05-dock-hover', '04-dock-retracted');

  await saveVideo(page, '05-dock-hover');
}

// ─── Scenario 6: Drag + drop + multi-select ────────────────────────────────

async function recordDragSelect(context, origin, ids) {
  console.log('\n▶ 06-drag-select');
  const page = await scene(
    context,
    origin,
    baseSettings(ids.rootId, ids.dockId, { folderMode: 'tiles', showSearchBar: false }),
  );

  await shot(page, '06-drag-select', '01-grid');

  // Build a 3-tile marquee selection on consecutive bookmark tiles near the top-left.
  const info = await page.evaluate(() => {
    const canvas = document.querySelector('.ff-canvas');
    const tiles = Array.from(document.querySelectorAll('.ff-tile[data-item-kind="bookmark"]')).slice(0, 3);
    if (!canvas || tiles.length < 3) return null;
    const cr = canvas.getBoundingClientRect();
    const rects = tiles.map((t) => t.getBoundingClientRect());
    return {
      startX: cr.left + 4,
      startY: cr.top + 6,
      endX: Math.max(...rects.map((r) => r.right)) + 6,
      endY: Math.max(...rects.map((r) => r.bottom)) + 6,
      leadCenter: { x: rects[0].left + rects[0].width / 2, y: rects[0].top + rects[0].height / 2 },
    };
  });

  if (!info) {
    console.warn('  ⚠ Not enough tiles for marquee; saving partial video.');
    await saveVideo(page, '06-drag-select');
    return;
  }

  // Marquee.
  await smoothMove(page, VIEWPORT.width / 2, 540, info.startX, info.startY, 700);
  await page.mouse.down();
  await smoothMove(page, info.startX, info.startY, info.endX, info.endY, 900);
  await sleep(250);
  await page.mouse.up();
  await sleep(800);
  await shot(page, '06-drag-select', '02-marquee-selection');

  // Find a destination folder (Media).
  const folderCenter = await page.evaluate(() => {
    const folders = Array.from(document.querySelectorAll('.ff-tile[data-item-kind="folder"]'));
    const media = folders.find((el) => /Media/i.test(el.textContent ?? ''));
    if (!media) return null;
    const r = media.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });

  if (folderCenter) {
    // Drag from the lead selected tile to the folder.
    const { x: lx, y: ly } = info.leadCenter;
    await smoothMove(page, info.endX, info.endY, lx, ly, 400);
    await page.mouse.down();
    await page.mouse.move(lx + 8, ly + 4);
    await sleep(120);
    await smoothMove(page, lx + 8, ly + 4, folderCenter.x, folderCenter.y, 1300);
    await sleep(400);
    await shot(page, '06-drag-select', '03-dragging-onto-folder');
    await page.mouse.up();
    await sleep(1200);
    await shot(page, '06-drag-select', '04-after-drop');
  }

  await saveVideo(page, '06-drag-select');
}

// ─── Scenario 7: Folder overlay with deeply nested folders ─────────────────

async function recordNestedFolders(context, origin, ids) {
  console.log('\n▶ 07-nested-folders');
  const page = await scene(
    context,
    origin,
    baseSettings(ids.rootId, ids.dockId, { folderMode: 'tiles', folderOpenMode: 'overlay' }),
  );

  await shot(page, '07-nested-folders', '01-root');

  // Open Dev Tools.
  const devTools = page.locator('.ff-tile[data-item-kind="folder"]').filter({ hasText: 'Dev Tools' }).first();
  const dtBox = await devTools.boundingBox();
  if (dtBox) await moveToBox(page, dtBox, 600);
  await devTools.click();
  await page.waitForSelector('.ff-folder-overlay', { timeout: 5_000 });
  await sleep(1100);
  await shot(page, '07-nested-folders', '02-level-1-dev-tools');

  // Drill into Frameworks.
  const frameworks = page.locator('.ff-folder-overlay .ff-tile[data-item-kind="folder"]').filter({ hasText: 'Frameworks' }).first();
  await frameworks.click();
  await sleep(1200);
  await shot(page, '07-nested-folders', '03-level-2-frameworks');

  // Climb back to Dev Tools via breadcrumb.
  await page.locator('.ff-folder-overlay__crumb', { hasText: 'Dev Tools' }).first().click();
  await sleep(900);

  // Drill into Tools.
  await page.locator('.ff-folder-overlay .ff-tile[data-item-kind="folder"]').filter({ hasText: 'Tools' }).first().click();
  await sleep(1100);
  await shot(page, '07-nested-folders', '04-level-2-tools');

  // Back to root via overlay close.
  await page.getByRole('button', { name: 'Close overlay' }).click();
  await sleep(900);
  await shot(page, '07-nested-folders', '05-back-to-root');

  await saveVideo(page, '07-nested-folders');
}

// ─── Scenario 8: Sorting bookmarks/folders ─────────────────────────────────

async function recordSorting(context, origin, ids) {
  console.log('\n▶ 08-sorting');
  const page = await scene(
    context,
    origin,
    baseSettings(ids.rootId, ids.dockId, { folderMode: 'tiles', bookmarkSortMode: 'manual', showSearchBar: false }),
  );

  await shot(page, '08-sorting', '01-manual-order');

  // Open the sort pill.
  const sortPill = page.locator('.ff-sort .ff-pill').first();
  const pillBox = await sortPill.boundingBox();
  if (pillBox) await moveToBox(page, pillBox, 500);
  await sortPill.click();
  await page.waitForSelector('.ff-sort__panel', { timeout: 5_000 });
  await sleep(700);
  await shot(page, '08-sorting', '02-sort-panel');

  // Apply Name A→Z.
  await page.locator('.ff-sort__option', { hasText: /Name \(A → Z\)/i }).click();
  await sleep(1200);
  await shot(page, '08-sorting', '03-sorted-name-asc');

  // Open again, apply Most used.
  await sortPill.click();
  await page.waitForSelector('.ff-sort__panel', { timeout: 5_000 });
  await sleep(400);
  // 6 options: Manual, Name A→Z, Name Z→A, Most used, Recently used, Recently added.
  // Click whichever option text matches "used" first → "Most used".
  const mostUsed = page.locator('.ff-sort__option').filter({ hasText: /used/i }).first();
  await mostUsed.click();
  await sleep(1100);
  await shot(page, '08-sorting', '04-sorted-most-used');

  await saveVideo(page, '08-sorting');
}

// ─── Main ────────────────────────────────────────────────────────────────────

const RUNNERS = {
  '01-search':          recordSearch,
  '02-onboarding':      recordOnboarding,
  '03-view-modes':      recordViewModes,
  '04-themes':          recordThemes,
  '05-dock-hover':      recordDockHover,
  '06-drag-select':     recordDragSelect,
  '07-nested-folders':  recordNestedFolders,
  '08-sorting':         recordSorting,
};

async function main() {
  const { only, list } = parseArgs();
  if (list) {
    console.log('Available scenarios:');
    for (const s of ALL_SCENARIOS) console.log('  ' + s);
    return;
  }
  const scenarios = chooseScenarios(only);
  if (scenarios.length === 0) {
    console.error('No scenarios matched --only=', only);
    process.exit(1);
  }

  console.log(`Recording ${scenarios.length} scenario(s): ${scenarios.join(', ')}`);

  const { context, profileDir } = await launchContext({ withVideo: true });
  try {
    const origin = await discoverOrigin(context);
    console.log('Extension origin:', origin);

    // One-time setup: open a setup page, skip onboarding, seed tree.
    const setup = await openNewtab(context, origin);
    await skipOnboarding(setup);
    const ids = await seedTree(setup);
    console.log(`Seeded rootId=${ids.rootId} dockId=${ids.dockId}`);
    // Apply baseline so the setup page leaves nice defaults behind.
    await patchSettings(setup, baseSettings(ids.rootId, ids.dockId));
    await setup.close();

    for (const s of scenarios) {
      const runner = RUNNERS[s];
      try {
        await runner(context, origin, ids);
      } catch (err) {
        console.error(`  ✗ ${s} failed:`, err.message);
      }
    }

    console.log('\n✅ Done. Output:');
    console.log('   videos:      promo/videos/*.webm');
    console.log('   screenshots: promo/screenshots/<scenario>/*.png');
    console.log('\n   Convert to GIF: node scripts/promo/to-gif.mjs');
  } finally {
    // Discard any orphan setup-page video.
    const valid = new Set(scenarios.map((s) => `${s}.webm`));
    for (const f of await readdir(VIDEO_DIR).catch(() => [])) {
      if (f.endsWith('.webm') && !valid.has(f)) {
        await unlink(join(VIDEO_DIR, f)).catch(() => undefined);
      }
    }
    await context.close();
    await cleanupProfile(profileDir);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
