/**
 * Promo video pipeline — 7 dark-mode recordings at 1920×1080.
 *
 *   node scripts/promo/videos.mjs
 *   node scripts/promo/videos.mjs --only=workspace-switch,add-bookmark
 *   node scripts/promo/videos.mjs --list
 *
 * Requires: `npm run build:chrome` first.
 *
 * Output (promo/videos/):
 *   01-workspace-switch.webm   ~16s  — 4 workspaces cycling: blue → purple → orange → red → blue
 *   02-add-edit-bookmark.webm  ~16s  — add spotify.com then edit it
 *   03-onboarding.webm         ~20s  — onboarding wizard: workspace → theme → accent → browse mode → tips
 *   04-accent-theme.webm       ~14s  — rapid accent + theme + gradient cycling
 *   05-search.webm             ~10s  — instant search filtering
 *   06-drag-reorder.webm       ~12s  — single + multi-select drag into folder
 *   07-view-mode-switch.webm   ~10s  — one-click toggle: Grid → List → Grid
 */

import { join } from 'node:path';
import {
  VIDEO_DIR,
  VIEWPORT,
  clearAllBookmarks,
  discoverOrigin,
  launchContext,
  moveToBox,
  openNewtab,
  patchSettings,
  patchWorkspace,
  reloadNewtab,
  resetCursor,
  saveVideo,
  seedPromoWorkspaces,
  seedTree,
  skipOnboarding,
  sleep,
  smoothMove,
  typeSlowly,
} from './lib.mjs';

// ─── Video 1: Workspace switching ────────────────────────────────────────────

async function recordWorkspaceSwitch(context, origin) {
  console.log('\n── Video 01: workspace-switch (~16s)');
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);
  page.on('console', () => {});

  await page.goto(`${origin}/newtab.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ff-app', { timeout: 15_000 });
  await skipOnboarding(page);
  await clearAllBookmarks(page);

  const { workspaceIds } = await seedPromoWorkspaces(page);
  await reloadNewtab(page, 5000);

  // Start on Work (dark, blue, top gradient)
  await patchSettings(page, { activeWorkspaceId: workspaceIds.Work });
  await page.waitForTimeout(2000);
  resetCursor();

  // Beat 2: switch to AI (dark, purple, aurora gradient)
  const aiTab = page.locator(`.ff-ws-tab[title="AI"], .ff-ws-tab:has-text("AI")`).first();
  const aiBox = await aiTab.boundingBox();
  await moveToBox(page, aiBox, 800);
  await page.mouse.click(aiBox.x + aiBox.width / 2, aiBox.y + aiBox.height / 2);
  await page.waitForTimeout(2200);

  // Beat 3: switch to Design (light, orange, top gradient)
  const designTab = page.locator(`.ff-ws-tab[title="Design"], .ff-ws-tab:has-text("Design")`).first();
  const designBox = await designTab.boundingBox();
  await moveToBox(page, designBox, 600);
  await page.mouse.click(designBox.x + designBox.width / 2, designBox.y + designBox.height / 2);
  await page.waitForTimeout(2200);

  // Beat 4: switch to Gaming (dark, red, top gradient)
  const gamingTab = page.locator(`.ff-ws-tab[title="Gaming"], .ff-ws-tab:has-text("Gaming")`).first();
  const gamingBox = await gamingTab.boundingBox();
  await moveToBox(page, gamingBox, 600);
  await page.mouse.click(gamingBox.x + gamingBox.width / 2, gamingBox.y + gamingBox.height / 2);
  await page.waitForTimeout(3000);

  // Beat 5: return to Work
  const workTab = page.locator(`.ff-ws-tab[title="Work"], .ff-ws-tab:has-text("Work")`).first();
  const workBox = await workTab.boundingBox();
  await moveToBox(page, workBox, 600);
  await page.mouse.click(workBox.x + workBox.width / 2, workBox.y + workBox.height / 2);
  await page.waitForTimeout(1800);

  await saveVideo(page, '01-workspace-switch');
}

// ─── Video 2: Add + edit a bookmark ─────────────────────────────────────────

async function recordAddEditBookmark(context, origin) {
  console.log('\n── Video 02: add-edit-bookmark (~16s)');
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);

  await page.goto(`${origin}/newtab.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ff-app', { timeout: 15_000 });
  await skipOnboarding(page);
  await clearAllBookmarks(page);

  const { workspaceIds } = await seedPromoWorkspaces(page);
  await reloadNewtab(page, 4500);

  // Use Personal workspace (more items = better context)
  await patchSettings(page, { activeWorkspaceId: workspaceIds.Personal });
  await page.waitForTimeout(1500);
  resetCursor();

  // Beat 2: open quick-add — click + button in top nav
  const addBtn = page.locator('[aria-label="Add bookmark"], .ff-addmenu, button:has-text("+")').first();
  if (await addBtn.count() > 0) {
    const addBox = await addBtn.boundingBox();
    await moveToBox(page, addBox, 600);
    await page.mouse.click(addBox.x + addBox.width / 2, addBox.y + addBox.height / 2);
    await page.waitForTimeout(400);
    // If dropdown appears, pick "Add bookmark"
    const addBmItem = page.locator('.ff-sort__option:has-text("bookmark"), [role="menuitem"]:has-text("bookmark")').first();
    if (await addBmItem.count() > 0) {
      await addBmItem.click();
      await page.waitForTimeout(400);
    }
  }

  // Beat 3: type URL
  const urlInput = page.locator('.ff-dialog input[name="url"], .ff-dialog input[type="url"], .ff-dialog input').first();
  await page.waitForSelector('.ff-dialog', { timeout: 3000 }).catch(() => undefined);
  if (await urlInput.count() > 0) {
    await urlInput.click();
    await typeSlowly(urlInput, 'www.spotify.com');
    await page.waitForTimeout(1500); // let favicon fetch
  }

  // Beat 4: save
  const saveBtn = page.locator('.ff-dialog .ff-btn--accent, .ff-dialog button[type="submit"]').first();
  if (await saveBtn.count() > 0) {
    const saveBox = await saveBtn.boundingBox();
    await moveToBox(page, saveBox, 500);
    await saveBtn.click();
    await page.waitForTimeout(1200);
  }

  // Beat 5: right-click the new Spotify tile
  const spotifyTile = page.locator('.ff-tile:has-text("Spotify")').last();
  if (await spotifyTile.count() > 0) {
    const tileBox = await spotifyTile.boundingBox();
    await moveToBox(page, tileBox, 600);
    await page.mouse.click(tileBox.x + tileBox.width / 2, tileBox.y + tileBox.height / 2, { button: 'right' });
    await page.waitForSelector('.ff-ctx', { timeout: 2000 });
    await page.waitForTimeout(400);

    // Beat 5: click Edit
    const editItem = page.locator('.ff-ctx li:has-text("Edit"), .ff-ctx [data-action="edit"]').first();
    if (await editItem.count() > 0) {
      const editBox = await editItem.boundingBox();
      await moveToBox(page, editBox, 400);
      await editItem.click();
      await page.waitForSelector('.ff-dialog', { timeout: 2000 });
      await page.waitForTimeout(600);
    }

    // Beat 6: edit title
    const titleInput = page.locator('.ff-dialog input[name="title"], .ff-dialog input[placeholder*="itle"]').first();
    if (await titleInput.count() > 0) {
      const titleBox = await titleInput.boundingBox();
      await moveToBox(page, titleBox, 400);
      await titleInput.click({ clickCount: 3 });
      await page.waitForTimeout(200);
      await typeSlowly(titleInput, 'Spotify — Music');
      await page.waitForTimeout(800);
    }

    // Beat 7: save
    const saveEditBtn = page.locator('.ff-dialog .ff-btn--accent, .ff-dialog button[type="submit"]').first();
    if (await saveEditBtn.count() > 0) {
      const saveBtnBox = await saveEditBtn.boundingBox();
      await moveToBox(page, saveBtnBox, 400);
      await saveEditBtn.click();
      await page.waitForTimeout(1500);
    }
  }

  await saveVideo(page, '02-add-edit-bookmark');
}

// ─── Video 3: Onboarding flow ────────────────────────────────────────────────
// Step order: Welcome(0) → Workspace(1) → Theme(2) → Accent(3) → Browse mode(4) → Tips(5)

async function recordOnboarding(context, origin) {
  console.log('\n── Video 03: onboarding (~20s)');
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);

  // Seed bookmark folders, then trigger fresh onboarding so wizard shows recommendations.
  await page.goto(`${origin}/newtab.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ff-app', { timeout: 15_000 });
  await skipOnboarding(page);
  await clearAllBookmarks(page);

  // Seed 3 named folders that the onboarding wizard will suggest as workspaces
  await page.evaluate(async () => {
    const a = (globalThis.browser ?? globalThis.chrome);
    const workNames = ['Work', 'Personal', 'Creative'];
    const bms = {
      Work: [
        { title: 'GitHub', url: 'https://github.com' },
        { title: 'Linear', url: 'https://linear.app' },
        { title: 'Slack',  url: 'https://slack.com' },
      ],
      Personal: [
        { title: 'YouTube', url: 'https://www.youtube.com' },
        { title: 'Reddit',  url: 'https://www.reddit.com' },
        { title: 'Spotify', url: 'https://open.spotify.com' },
      ],
      Creative: [
        { title: 'Dribbble', url: 'https://dribbble.com' },
        { title: 'Figma',    url: 'https://figma.com' },
        { title: 'Unsplash', url: 'https://unsplash.com' },
      ],
    };
    for (const name of workNames) {
      const folder = await a.bookmarks.create({ parentId: '1', title: name });
      for (const bm of bms[name]) {
        await a.bookmarks.create({ parentId: folder.id, title: bm.title, url: bm.url });
      }
    }
  });

  // Trigger fresh onboarding
  await page.evaluate(async () => {
    const a = (globalThis.browser ?? globalThis.chrome);
    await a.storage.local.set({
      'onboarding-state': {
        version: 1,
        status: 'pending',
        updatedAt: Date.now(),
        completedAt: null,
        skippedAt: null,
      },
    });
  });

  await reloadNewtab(page, 4000);
  await page.waitForSelector('.ff-onboard', { timeout: 8000 }).catch(() => undefined);
  resetCursor();

  const next = () => page.locator('.ff-onboard .ff-btn:has-text("Next")').first();

  // Beat 1: welcome — hold 2s
  await page.waitForTimeout(2000);

  // Beat 2: workspace step — select Multiple workspaces, pick all 3 folders (wow moment)
  await next().click().catch(() => undefined);
  await page.waitForTimeout(600);

  const multiWs = page.locator('.ff-card:has-text("Multiple workspaces")').first();
  if (await multiWs.count() > 0) {
    const box = await multiWs.boundingBox();
    if (box) await moveToBox(page, box, 400);
    await multiWs.click();
    await page.waitForTimeout(800);
  }
  for (const name of ['Work', 'Personal', 'Creative']) {
    const folderCard = page.locator(`.ff-card:has-text("${name}")`).first();
    if (await folderCard.count() > 0) {
      await folderCard.click();
      await page.waitForTimeout(500);
    }
  }
  await page.waitForTimeout(2000); // hold — workspace preview wow moment

  // Beat 3: theme step — pick Dark
  await next().click().catch(() => undefined);
  await page.waitForTimeout(600);
  const darkCard = page.locator('.ff-onboard__body .ff-card:has-text("Dark")').first();
  if (await darkCard.count() > 0) {
    const box = await darkCard.boundingBox();
    if (box) await moveToBox(page, box, 400);
    await darkCard.click();
    await page.waitForTimeout(800);
  }

  // Beat 4: accent step — pick Blue
  await next().click().catch(() => undefined);
  await page.waitForTimeout(600);
  const blueChip = page.locator('.ff-accentchip[aria-label="Blue"], .ff-accentchip').first();
  if (await blueChip.count() > 0) {
    const box = await blueChip.boundingBox();
    if (box) await moveToBox(page, box, 400);
    await blueChip.click();
    await page.waitForTimeout(800);
  }

  // Beat 5: browse mode — click Grid, hold to show the choice
  await next().click().catch(() => undefined);
  await page.waitForTimeout(600);
  const gridCard = page.locator('.ff-onboard__body .ff-card:has-text("Grid")').first();
  if (await gridCard.count() > 0) {
    const box = await gridCard.boundingBox();
    if (box) await moveToBox(page, box, 400);
    await gridCard.click();
    await page.waitForTimeout(1200);
  }

  // Beat 6: tips carousel — advance through 2 tips
  await next().click().catch(() => undefined);
  await page.waitForTimeout(800);
  for (let i = 0; i < 2; i++) {
    const nextTip = page.locator('[aria-label="Next tip"]').first();
    if (await nextTip.count() > 0) {
      const box = await nextTip.boundingBox();
      if (box) await moveToBox(page, box, 300);
      await nextTip.click();
      await page.waitForTimeout(700);
    }
  }
  await page.waitForTimeout(600);

  // Beat 7: finish
  const finishBtn = page.locator('.ff-onboard .ff-btn:has-text("Get started")').first();
  if (await finishBtn.count() > 0) {
    const finishBox = await finishBtn.boundingBox();
    if (finishBox) await moveToBox(page, finishBox, 400);
    await finishBtn.click();
    await page.waitForTimeout(2000);
  }

  await saveVideo(page, '03-onboarding');
}

// ─── Video 4: Accent + theme cycling ─────────────────────────────────────────

async function recordAccentTheme(context, origin) {
  console.log('\n── Video 04: accent-theme (~14s)');
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);

  await page.goto(`${origin}/newtab.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ff-app', { timeout: 15_000 });
  await skipOnboarding(page);
  await clearAllBookmarks(page);

  const { workspaceIds } = await seedPromoWorkspaces(page);
  await reloadNewtab(page, 4500);
  resetCursor();

  // Beat 1: open Workspace > Appearance drawer (NOT app settings)
  const customizeBtn = page.locator('[aria-label="Customize workspace"]').first();
  if (await customizeBtn.count() > 0) {
    const box = await customizeBtn.boundingBox();
    await moveToBox(page, box, 500);
    await customizeBtn.click();
    await page.waitForSelector('.ff-drawer', { timeout: 3000 });
    await page.waitForTimeout(600);
  }

  // Beat 2: cycle through accent chips — Blue(0)→Teal(1)→Green(2)→Orange(5)→Purple(9)
  const accentChips = page.locator('.ff-accentchip');
  const indicesToCycle = [1, 2, 5, 9]; // already on Blue(0); Teal, Green, Orange, Purple
  for (const idx of indicesToCycle) {
    const chip = accentChips.nth(idx);
    if (await chip.count() > 0) {
      const box = await chip.boundingBox();
      await moveToBox(page, box, 300);
      await chip.click();
      await page.waitForTimeout(700);
    }
  }

  // Beat 3: switch to light theme
  const lightCard = page.locator('.ff-themecard--light').first();
  if (await lightCard.count() > 0) {
    const box = await lightCard.boundingBox();
    await moveToBox(page, box, 400);
    await lightCard.click();
    await page.waitForTimeout(1200);
  }

  // Beat 4: cycle gradient styles — target only the style grid inside .ff-bg-row
  // (distinct from the theme mode grid and background mode grid)
  const gradientBtns = page.locator('.ff-bg-row .ff-themegrid .ff-themecard');
  const gradCount = await gradientBtns.count();
  if (gradCount > 0) {
    for (let i = 0; i < Math.min(4, gradCount); i++) {
      const btn = gradientBtns.nth(i);
      const box = await btn.boundingBox();
      if (box) {
        await moveToBox(page, box, 300);
        await btn.click();
        await page.waitForTimeout(700);
      }
    }
  }

  // Beat 5: close settings, switch back to dark
  const darkCard = page.locator('.ff-themecard--dark').first();
  if (await darkCard.count() > 0) await darkCard.click();
  await page.waitForTimeout(400);

  const closeBtn = page.locator('.ff-drawer [aria-label="Close"], .ff-drawer__close').first();
  if (await closeBtn.count() > 0) {
    const box = await closeBtn.boundingBox();
    await moveToBox(page, box, 500);
    await closeBtn.click();
    await page.waitForTimeout(1800);
  } else {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1800);
  }

  await saveVideo(page, '04-accent-theme');
}

// ─── Video 5: Search ─────────────────────────────────────────────────────────

async function recordSearch(context, origin) {
  console.log('\n── Video 05: search (~10s)');
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);

  await page.goto(`${origin}/newtab.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ff-app', { timeout: 15_000 });
  await skipOnboarding(page);
  await clearAllBookmarks(page);

  const { workspaceIds } = await seedPromoWorkspaces(page);
  await reloadNewtab(page, 4500);

  resetCursor();

  // Beat 1: focus search bar
  const searchInput = page.locator('.ff-search__input, .ff-search input').first();
  if (await searchInput.count() > 0) {
    const box = await searchInput.boundingBox();
    await moveToBox(page, box, 600);
    await searchInput.click();
    await page.waitForTimeout(600);

    // Beat 2: type "gith" — character by character
    await typeSlowly(searchInput, 'gith');
    await page.waitForTimeout(1200);

    // Beat 3: clear, type "cook"
    await searchInput.fill('');
    await page.waitForTimeout(300);
    await typeSlowly(searchInput, 'cook');
    await page.waitForTimeout(1200);

    // Beat 4: escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
  }

  await saveVideo(page, '05-search');
}

// ─── Video 6: Drag and reorder ───────────────────────────────────────────────

async function recordDragReorder(context, origin) {
  console.log('\n── Video 06: drag-reorder (~12s)');
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);

  await page.goto(`${origin}/newtab.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ff-app', { timeout: 15_000 });
  await skipOnboarding(page);
  await clearAllBookmarks(page);

  const { workspaceIds } = await seedPromoWorkspaces(page);
  await reloadNewtab(page, 4500);

  resetCursor();

  // Beat 1: drag a single tile to a new position
  const tiles = page.locator('.ff-tile[data-item-kind="bookmark"]');
  const tileCount = await tiles.count();
  if (tileCount >= 2) {
    const src = tiles.nth(0);
    const dst = tiles.nth(3);
    const srcBox = await src.boundingBox();
    const dstBox = await dst.boundingBox();

    if (srcBox && dstBox) {
      await page.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2);
      await page.waitForTimeout(80);
      await page.mouse.down();
      await page.waitForTimeout(120);
      await smoothMove(page, srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2,
        dstBox.x + dstBox.width / 2, dstBox.y + dstBox.height / 2, 550);
      await page.waitForTimeout(200);
      await page.mouse.up();
      await page.waitForTimeout(1000);
    }
  }

  // Beat 2: multi-select 3 tiles (Cmd/Ctrl+click)
  const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';
  if (tileCount >= 4) {
    for (let i = 1; i <= 3; i++) {
      const tile = tiles.nth(i);
      const box = await tile.boundingBox();
      if (box) {
        await page.keyboard.down(modKey);
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.keyboard.up(modKey);
        await page.waitForTimeout(250);
      }
    }
    await page.waitForTimeout(500);
  }

  // Beat 3: drag selection into a folder
  const folderTile = page.locator('.ff-tile[data-item-kind="folder"]').first();
  const selectedTile = tiles.nth(1);
  const selBox = await selectedTile.boundingBox().catch(() => null);
  const folderBox = await folderTile.boundingBox().catch(() => null);

  if (selBox && folderBox) {
    await page.mouse.move(selBox.x + selBox.width / 2, selBox.y + selBox.height / 2);
    await page.waitForTimeout(80);
    await page.mouse.down();
    await page.waitForTimeout(120);
    await smoothMove(page, selBox.x + selBox.width / 2, selBox.y + selBox.height / 2,
      folderBox.x + folderBox.width / 2, folderBox.y + folderBox.height / 2, 650);
    await page.waitForTimeout(200);
    await page.mouse.up();
    await page.waitForTimeout(1500);

    // Beat 3b: open the folder to reveal the moved items
    const refreshedFolder = page.locator('.ff-tile[data-item-kind="folder"]').first();
    if (await refreshedFolder.count() > 0) {
      const fb = await refreshedFolder.boundingBox();
      if (fb) {
        await moveToBox(page, fb, 600);
        await refreshedFolder.click();
        await page.waitForTimeout(1500);
      }
    }
  }

  await saveVideo(page, '06-drag-reorder');
}

// ─── Video 7: View mode switching ────────────────────────────────────────────

async function recordViewModeSwitch(context, origin) {
  console.log('\n── Video 07: view-mode-switch (~10s)');
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);

  await page.goto(`${origin}/newtab.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ff-app', { timeout: 15_000 });
  await skipOnboarding(page);
  await clearAllBookmarks(page);

  const { workspaceIds } = await seedPromoWorkspaces(page);

  // Start on Personal workspace in Grid view, then reload to settle
  await patchSettings(page, { activeWorkspaceId: workspaceIds.Personal, folderMode: 'grid' });
  await reloadNewtab(page, 3000);
  resetCursor();

  // Beat 1: Grid view established — hold 2s
  await page.waitForTimeout(2000);

  // Beat 2: move to view toggle button (between + and sort), click → List view
  const gridToggle = page.locator('[aria-label="Switch to List view"]').first();
  if (await gridToggle.count() > 0) {
    const box = await gridToggle.boundingBox();
    await moveToBox(page, box, 800);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(1000); // hold — watch tiles unfold into sections
  }

  // Beat 3: scroll down to reveal depth of List view
  await page.evaluate(() => window.scrollBy({ top: 320, behavior: 'smooth' }));
  await page.waitForTimeout(2000); // hold showing multiple section headers + inline bookmarks

  // Beat 4: scroll back up, click toggle to return to Grid
  await page.evaluate(() => window.scrollBy({ top: -320, behavior: 'smooth' }));
  await page.waitForTimeout(400);

  const listToggle = page.locator('[aria-label="Switch to Grid view"]').first();
  if (await listToggle.count() > 0) {
    const box = await listToggle.boundingBox();
    await moveToBox(page, box, 600);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(1500); // hold — snap back to Grid is the payoff
  }

  await saveVideo(page, '07-view-mode-switch');
}

// ─── All scenarios map ────────────────────────────────────────────────────────

const VIDEOS = {
  'workspace-switch':  recordWorkspaceSwitch,
  'add-bookmark':      recordAddEditBookmark,
  'onboarding':        recordOnboarding,
  'accent-theme':      recordAccentTheme,
  'search':            recordSearch,
  'drag-reorder':      recordDragReorder,
  'view-mode-switch':  recordViewModeSwitch,
};

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runVideos(filter) {
  const keys = filter ? filter.split(',').map(s => s.trim()) : Object.keys(VIDEOS);
  const invalid = keys.filter(k => !VIDEOS[k]);
  if (invalid.length) {
    console.error(`Unknown video(s): ${invalid.join(', ')}`);
    console.error(`Available: ${Object.keys(VIDEOS).join(', ')}`);
    process.exit(1);
  }

  console.log(`▶ Promo videos (${keys.join(', ')})`);

  const { rm, readdir, unlink } = await import('node:fs/promises');

  for (const key of keys) {
    const { context, profileDir } = await launchContext({ withVideo: true });
    const origin = await discoverOrigin(context);
    // Track pages Chrome auto-opened on launch. We can't close them yet —
    // closing all tabs terminates Chrome and breaks context.newPage(). Instead
    // we close them after the video function has opened and finished its own
    // page, then scrub the UUID recording files they leave behind.
    const preExisting = [...context.pages()];
    try {
      await VIDEOS[key](context, origin);
    } finally {
      for (const p of preExisting) await p.close().catch(() => undefined);
      await context.close().catch(() => undefined);
      await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
      // Remove UUID-named .webm files left by the auto-opened tab recordings.
      const uuidRe = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.webm$/i;
      const files = await readdir(VIDEO_DIR).catch(() => []);
      await Promise.all(files.filter(f => uuidRe.test(f)).map(f => unlink(join(VIDEO_DIR, f)).catch(() => undefined)));
    }
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
  const onlyArg = args.find(a => a.startsWith('--only='));
  const filter = onlyArg ? onlyArg.split('=')[1] : null;
  runVideos(filter).catch((err) => { console.error(err); process.exit(1); });
}
