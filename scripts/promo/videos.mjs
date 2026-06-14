/**
 * Promo video pipeline — 7 dark/light recordings at 1920×1080.
 *
 *   node scripts/promo/videos.mjs
 *   node scripts/promo/videos.mjs --only=workspace-switch,add-bookmark
 *   node scripts/promo/videos.mjs --list
 *
 * Requires: `npm run build:chrome` first.
 *
 * Architecture (refactored): ONE persistent browser context for the whole run.
 * Bookmarks are seeded once and the icon cache is warmed once, on a shared
 * "control" page. Each clip then opens a cheap new page in that warm context,
 * so the first frame is already clean — dark app background (no white flash),
 * bookmarks present, icons served from cache (identical across every clip).
 * Mirrors the single-context pattern in tests/fixtures/extension-context.ts.
 *
 * Output (promo/videos/):
 *   01-workspace-switch.webm   — Work → AI → Design → Gaming → Work + dock peek
 *   02-add-edit-bookmark.webm  — edit a tile, search a new icon, apply it
 *   03-onboarding.webm         — welcome → Multiple workspaces → pick 2 → done
 *   04-accent-theme.webm       — 2 accents, light↔dark, one gradient
 *   05-search.webm             — query with folder-path label, then a multi-hit query
 *   06-drag-reorder.webm       — single drag, multi-select 3, drop into a folder, reveal
 *   07-view-mode-switch.webm   — grid → list (scroll) → grid
 */

import { join } from 'node:path';
import {
  HOLD,
  VIDEO_DIR,
  VIEWPORT,
  clearAllBookmarks,
  discoverOrigin,
  hold,
  launchContext,
  moveToBox,
  openNewtab,
  patchSettings,
  patchWorkspace,
  resetCursor,
  saveVideo,
  seedPromoWorkspaces,
  skipOnboarding,
  smoothMove,
  typeSlowly,
  waitForReady,
  warmIcons,
} from './lib.mjs';

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Open a fresh recording page in the (already warm) shared context. */
async function openRecordingPage(context, origin) {
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);
  await page.goto(`${origin}/newtab.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ff-app', { timeout: 15_000 });
  return page;
}

/** Click a workspace tab by name and let the switch settle. */
async function switchWorkspace(page, name, ms = 2200) {
  // TopNav renders title as "Switch to <name>" or "Switch to <name> (<shortcut>)".
  // Use prefix match (^=) so both forms match; text fallback covers overflow dropdown.
  const tab = page.locator(`.ff-ws-tab[title^="Switch to ${name}"], .ff-ws-tab:has-text("${name}")`).first();
  const box = await tab.boundingBox();
  if (!box) return;
  await moveToBox(page, box, 700);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await hold(page, ms);
}

// ─── Video 1: Workspace switching ────────────────────────────────────────────

async function recordWorkspaceSwitch(context, origin, workspaceIds, control) {
  console.log('\n── Video 01: workspace-switch');
  await patchSettings(control, { activeWorkspaceId: workspaceIds.Work });

  const page = await openRecordingPage(context, origin);
  await waitForReady(page);
  resetCursor();
  await hold(page, HOLD.intro); // clean opening frame: Work, blue, dock visible

  await switchWorkspace(page, 'AI', HOLD.settle + 1100);     // purple, aurora
  await switchWorkspace(page, 'Design', HOLD.settle + 1100); // orange, LIGHT — biggest visual jump
  await switchWorkspace(page, 'Gaming', HOLD.settle + 1300); // red

  // Peek the dock on Gaming to show each space keeps its own shortcuts.
  const dockItem = page.locator('.ff-dock__item').first();
  const db = await dockItem.boundingBox();
  if (db) {
    await moveToBox(page, db, 800);
    await hold(page, HOLD.beat);
  }

  await switchWorkspace(page, 'Work', HOLD.outro); // home again

  await saveVideo(page, '01-workspace-switch');
}

// ─── Video 2: Edit a bookmark + custom icon search ───────────────────────────

async function recordAddEditBookmark(context, origin, workspaceIds, control) {
  console.log('\n── Video 02: add-edit-bookmark (custom icon search)');
  await patchSettings(control, { activeWorkspaceId: workspaceIds.Work });

  const page = await openRecordingPage(context, origin);
  await waitForReady(page);
  resetCursor();
  await hold(page, HOLD.intro);

  // Right-click the GitHub tile → Edit.
  const tile = page.locator('.ff-tile[data-item-kind="bookmark"]:has-text("GitHub")').first();
  const tb = await tile.boundingBox();
  if (tb) {
    await moveToBox(page, tb, 700);
    await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2, { button: 'right' });
    await page.waitForSelector('.ff-ctx', { timeout: 2000 });
    await hold(page, HOLD.beat);

    const editItem = page.locator('.ff-ctx__item:has-text("Edit"), .ff-ctx [role="menuitem"]:has-text("Edit")').first();
    const eb = await editItem.boundingBox();
    if (eb) {
      await moveToBox(page, eb, 400);
      await editItem.click();
      await page.waitForSelector('.ff-dialog', { timeout: 3000 });
      // Icon search auto-runs for an existing bookmark; wait for results.
      await page.waitForSelector('.ff-icongrid__cell', { state: 'visible', timeout: 8000 }).catch(() => undefined);
      await hold(page, HOLD.settle); // let the grid fill — this is the highlight

      // Pick a distinctive icon candidate to show the swap.
      const candidate = page.locator('.ff-icongrid__cell:visible').nth(3);
      const cb = await candidate.boundingBox();
      if (cb) {
        await moveToBox(page, cb, 600);
        await candidate.click();
        await hold(page, HOLD.settle); // preview updates
      }

      // Save.
      const save = page.locator('.ff-dialog .ff-btn--accent, .ff-dialog button[type="submit"], .ff-dialog button:has-text("Save")').first();
      const sb = await save.boundingBox();
      if (sb) {
        await moveToBox(page, sb, 500);
        await save.click();
        await hold(page, HOLD.outro); // back on the grid with the new icon
      }
    }
  }

  await saveVideo(page, '02-add-edit-bookmark');
}

// ─── Video 3: Onboarding (tight cut) ─────────────────────────────────────────

async function recordOnboarding(context, origin, workspaceIds, control) {
  console.log('\n── Video 03: onboarding (tight)');
  await patchSettings(control, { activeWorkspaceId: workspaceIds.Work });
  // Trigger a fresh wizard for the recording page.
  await control.evaluate(async () => {
    const a = globalThis.browser ?? globalThis.chrome;
    await a.storage.local.set({
      'onboarding-state': { version: 2, status: 'pending', updatedAt: Date.now(), completedAt: null, skippedAt: null, recommendedArchetype: null, chosenArchetype: null },
    });
  });

  const page = await openRecordingPage(context, origin);
  await page.waitForSelector('.ff-onboard', { timeout: 8000 }).catch(() => undefined);
  resetCursor();
  await hold(page, HOLD.intro); // welcome

  const next = () => page.locator('.ff-onboard .ff-btn:has-text("Next")').first();

  // Welcome (step 0) → appearance (step 1).
  await next().click().catch(() => undefined);
  await hold(page, HOLD.beat);

  // Appearance (step 1) → workspace folder-picker (step 2).
  await next().click().catch(() => undefined);
  await hold(page, HOLD.beat);

  // The wow moment: pick two recommended workspace folders (Work, Personal).
  // RecommendedFolderCard renders as .ff-card; folder names match the seeded tree.
  for (const name of ['Work', 'Personal']) {
    const card = page.locator(`.ff-onboard .ff-card:has-text("${name}")`).first();
    if (await card.count()) {
      const mb = await card.boundingBox();
      if (mb) { await moveToBox(page, mb, 500); await card.click(); await hold(page, HOLD.beat); }
    }
  }
  await hold(page, HOLD.settle); // hold on the populated picker

  // Skip straight to finish — keep the web cut short.
  const finish = page.locator('.ff-onboard .ff-btn:has-text("Get started"), .ff-onboard .ff-btn:has-text("Finish")').first();
  for (let i = 0; i < 5 && !(await finish.count()); i++) {
    await next().click().catch(() => undefined);
    await hold(page, 350);
  }
  if (await finish.count()) {
    const fb = await finish.boundingBox();
    if (fb) await moveToBox(page, fb, 400);
    await finish.click();
    await page.waitForSelector('.ff-onboard', { state: 'detached', timeout: 5000 }).catch(() => undefined);
    await hold(page, HOLD.outro);
  }

  await saveVideo(page, '03-onboarding');

  // Reset so later clips don't show the wizard.
  await control.evaluate(async () => {
    const a = globalThis.browser ?? globalThis.chrome;
    await a.storage.local.set({
      'onboarding-state': { version: 2, status: 'completed', updatedAt: Date.now(), completedAt: Date.now(), skippedAt: null, recommendedArchetype: null, chosenArchetype: null },
    });
  });
}

// ─── Video 4: Accent + theme (simplified) ────────────────────────────────────

async function recordAccentTheme(context, origin, workspaceIds, control) {
  console.log('\n── Video 04: accent-theme (simplified)');
  await patchSettings(control, { activeWorkspaceId: workspaceIds.Work });

  const page = await openRecordingPage(context, origin);
  await waitForReady(page);
  resetCursor();
  await hold(page, HOLD.intro);

  // Open the Workspace appearance drawer.
  const customize = page.locator('[aria-label="Customize workspace"]').first();
  const cb = await customize.boundingBox();
  if (cb) {
    await moveToBox(page, cb, 600);
    await customize.click();
    await page.waitForSelector('.ff-drawer', { timeout: 3000 });
    await hold(page, HOLD.beat);
  }

  // Two accents only (Teal, Purple) — restrained, reads as "polished".
  const chips = page.locator('.ff-accentchip');
  for (const idx of [1 /* Teal */, 9 /* Purple */]) {
    const chip = chips.nth(idx);
    const b = await chip.boundingBox();
    if (b) { await moveToBox(page, b, 350); await chip.click(); await hold(page, HOLD.beat); }
  }

  // One light flip, then back to dark.
  const light = page.locator('.ff-themecard--light').first();
  if (await light.count()) {
    const b = await light.boundingBox();
    if (b) await moveToBox(page, b, 400);
    await light.click();
    await hold(page, HOLD.settle);
  }
  const dark = page.locator('.ff-themecard--dark').first();
  if (await dark.count()) { await dark.click(); await hold(page, HOLD.beat); }

  // One gradient style change for flavour.
  const grad = page.locator('.ff-bg-row .ff-themegrid .ff-themecard').nth(2);
  if (await grad.count()) {
    const b = await grad.boundingBox();
    if (b) { await moveToBox(page, b, 350); await grad.click(); await hold(page, HOLD.settle); }
  }

  // Close drawer to land on the restyled workspace.
  const close = page.locator('.ff-drawer [aria-label="Close"]').first();
  if (await close.count()) {
    const b = await close.boundingBox();
    if (b) await moveToBox(page, b, 500);
    await close.click();
  } else {
    await page.keyboard.press('Escape');
  }
  await hold(page, HOLD.outro);

  await saveVideo(page, '04-accent-theme');
}

// ─── Video 5: Search (with folder-path payoff) ───────────────────────────────

async function recordSearch(context, origin, workspaceIds, control) {
  console.log('\n── Video 05: search');
  await patchSettings(control, { activeWorkspaceId: workspaceIds.Work });

  const page = await openRecordingPage(context, origin);
  await waitForReady(page);
  resetCursor();
  await hold(page, HOLD.intro);

  const input = page.locator('.ff-search__input, .ff-search input').first();
  const b = await input.boundingBox();
  if (b) { await moveToBox(page, b, 600); await input.click(); await hold(page, HOLD.beat); }

  // Query 1: "react" → React.dev, nested in the Documentation folder.
  // The result row shows its folder path — proof of "know where it lives".
  await typeSlowly(input, 'react', 95);
  await hold(page, HOLD.settle + 400);

  // Query 2: "git" → GitHub (root) + Repository (Project Apollo) — multiple hits.
  await input.fill('');
  await hold(page, 300);
  await typeSlowly(input, 'git', 95);
  await hold(page, HOLD.settle + 400);

  await page.keyboard.press('Escape');
  await hold(page, HOLD.outro);

  await saveVideo(page, '05-search');
}

// ─── Video 6: Drag + reorder + multi-select into folder ──────────────────────

async function recordDragReorder(context, origin, workspaceIds, control) {
  console.log('\n── Video 06: drag-reorder');
  await patchSettings(control, { activeWorkspaceId: workspaceIds.Work });

  const page = await openRecordingPage(context, origin);
  await waitForReady(page);
  resetCursor();
  await hold(page, HOLD.intro);

  const tiles = page.locator('.ff-tile[data-item-kind="bookmark"]');
  const count = await tiles.count();

  // Beat 1: single-tile reorder.
  if (count >= 4) {
    const src = await tiles.nth(0).boundingBox();
    const dst = await tiles.nth(3).boundingBox();
    if (src && dst) {
      await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
      await page.mouse.down();
      await hold(page, 120);
      await smoothMove(page, src.x + src.width / 2, src.y + src.height / 2, dst.x + dst.width / 2, dst.y + dst.height / 2, 600);
      await hold(page, 200);
      await page.mouse.up();
      await hold(page, HOLD.beat);
    }
  }

  // Beat 2: multi-select 3 tiles (Ctrl/Cmd+click).
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  if (count >= 4) {
    for (let i = 1; i <= 3; i++) {
      const tb = await tiles.nth(i).boundingBox();
      if (tb) {
        await page.keyboard.down(mod);
        await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2);
        await page.keyboard.up(mod);
        await hold(page, 220);
      }
    }
    await hold(page, HOLD.beat);
  }

  // Beat 3: drag the selection into a folder, then open it (payoff).
  const folder = page.locator('.ff-tile[data-item-kind="folder"]').first();
  const selBox = await tiles.nth(1).boundingBox().catch(() => null);
  const folderBox = await folder.boundingBox().catch(() => null);
  if (selBox && folderBox) {
    await page.mouse.move(selBox.x + selBox.width / 2, selBox.y + selBox.height / 2);
    await page.mouse.down();
    await hold(page, 120);
    await smoothMove(page, selBox.x + selBox.width / 2, selBox.y + selBox.height / 2, folderBox.x + folderBox.width / 2, folderBox.y + folderBox.height / 2, 700);
    await hold(page, 200);
    await page.mouse.up();
    await hold(page, HOLD.settle);

    const refreshed = page.locator('.ff-tile[data-item-kind="folder"]').first();
    const rb = await refreshed.boundingBox().catch(() => null);
    if (rb) {
      await moveToBox(page, rb, 600);
      await refreshed.click();
      await hold(page, HOLD.outro);
    }
  }

  await saveVideo(page, '06-drag-reorder');
}

// ─── Video 7: View mode switching ────────────────────────────────────────────

async function recordViewModeSwitch(context, origin, workspaceIds, control) {
  console.log('\n── Video 07: view-mode-switch');
  await patchSettings(control, { activeWorkspaceId: workspaceIds.Personal });
  await patchWorkspace(control, workspaceIds.Personal, { folderMode: 'grid' });

  const page = await openRecordingPage(context, origin);
  await waitForReady(page);
  resetCursor();
  await hold(page, HOLD.intro); // grid established

  const toList = page.locator('[aria-label="Switch to List view"]').first();
  const tb = await toList.boundingBox();
  if (tb) {
    await moveToBox(page, tb, 800);
    await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2);
    await hold(page, HOLD.settle); // tiles unfold into list
  }

  // Scroll to reveal list density.
  await page.evaluate(() => window.scrollBy({ top: 320, behavior: 'smooth' }));
  await hold(page, HOLD.settle + 600);
  await page.evaluate(() => window.scrollBy({ top: -320, behavior: 'smooth' }));
  await hold(page, 400);

  const toGrid = page.locator('[aria-label="Switch to Grid view"]').first();
  const gb = await toGrid.boundingBox();
  if (gb) {
    await moveToBox(page, gb, 600);
    await page.mouse.click(gb.x + gb.width / 2, gb.y + gb.height / 2);
    await hold(page, HOLD.outro); // snap back to grid
  }

  await saveVideo(page, '07-view-mode-switch');
  await patchWorkspace(control, workspaceIds.Personal, { folderMode: 'grid' });
}

// ─── Scenario map ───────────────────────────────────────────────────────────

const VIDEOS = {
  'workspace-switch': recordWorkspaceSwitch,
  'add-bookmark':     recordAddEditBookmark,
  'onboarding':       recordOnboarding,
  'accent-theme':     recordAccentTheme,
  'search':           recordSearch,
  'drag-reorder':     recordDragReorder,
  'view-mode-switch': recordViewModeSwitch,
};

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runVideos(filter) {
  const keys = filter ? filter.split(',').map((s) => s.trim()) : Object.keys(VIDEOS);
  const invalid = keys.filter((k) => !VIDEOS[k]);
  if (invalid.length) {
    console.error(`Unknown video(s): ${invalid.join(', ')}`);
    console.error(`Available: ${Object.keys(VIDEOS).join(', ')}`);
    process.exit(1);
  }

  console.log(`▶ Promo videos (${keys.join(', ')})`);

  const { rm, readdir, unlink } = await import('node:fs/promises');

  // ── One context for the whole run: seed once, warm icons once. ──
  const { context, profileDir } = await launchContext({ withVideo: true });
  const origin = await discoverOrigin(context);

  const control = await openNewtab(context, origin);
  await skipOnboarding(control);
  await clearAllBookmarks(control);
  console.log('● Seeding promo workspaces…');
  const { workspaceIds } = await seedPromoWorkspaces(control);
  console.log('● Warming icon cache…');
  await warmIcons(control, workspaceIds);

  try {
    for (const key of keys) {
      await VIDEOS[key](context, origin, workspaceIds, control);
    }
  } finally {
    await control.close().catch(() => undefined);
    await context.close().catch(() => undefined);
    await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);

    // Keep only the named scene clips; scrub control/auto-tab recordings.
    const valid = new Set([
      '01-workspace-switch', '02-add-edit-bookmark', '03-onboarding',
      '04-accent-theme', '05-search', '06-drag-reorder', '07-view-mode-switch',
    ].map((n) => `${n}.webm`));
    const files = await readdir(VIDEO_DIR).catch(() => []);
    await Promise.all(
      files
        .filter((f) => f.endsWith('.webm') && !valid.has(f))
        .map((f) => unlink(join(VIDEO_DIR, f)).catch(() => undefined)),
    );
  }

  console.log('\n✓ Videos complete.');
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

if (process.argv[1].endsWith('videos.mjs')) {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    console.log('Available videos:', Object.keys(VIDEOS).join(', '));
    process.exit(0);
  }
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const filter = onlyArg ? onlyArg.split('=')[1] : null;
  runVideos(filter).catch((err) => { console.error(err); process.exit(1); });
}
