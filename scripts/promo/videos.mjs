/**
 * Promo video pipeline — 6 dark-mode recordings at 1920×1080.
 *
 *   node scripts/promo/videos.mjs
 *   node scripts/promo/videos.mjs --only=workspace-switch,add-bookmark
 *   node scripts/promo/videos.mjs --list
 *
 * Requires: `npm run build:chrome` first.
 *
 * Output (promo/videos/):
 *   01-workspace-switch.webm   ~12s  — 3 workspaces: dark/blue → dark/teal → light/orange → dark/blue
 *   02-add-edit-bookmark.webm  ~16s  — add spotify.com then edit it
 *   03-onboarding.webm         ~18s  — onboarding wizard with folder-based workspace setup
 *   04-accent-theme.webm       ~14s  — rapid accent + theme + gradient cycling
 *   05-search.webm             ~10s  — instant search filtering
 *   06-drag-reorder.webm       ~12s  — single + multi-select drag into folder
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
  console.log('\n── Video 01: workspace-switch (~12s)');
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);
  page.on('console', () => {});

  await skipOnboarding(page);
  await clearAllBookmarks(page);
  const { context: _, page: _p, ...setup } = { workspaceIds: null };
  void _; void _p;

  await page.goto(`${origin}/newtab.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ff-app', { timeout: 15_000 });

  const { workspaceIds } = await seedPromoWorkspaces(page);
  await reloadNewtab(page, 2500);

  // Start on Work (dark, blue, top gradient)
  await patchSettings(page, { activeWorkspaceId: workspaceIds.Work });
  await page.waitForTimeout(2000);

  // Beat 2: switch to Personal (dark, teal, aurora)
  const personalTab = page.locator(`.ff-ws-tab[title="Personal"], .ff-ws-tab:has-text("Personal")`).first();
  const personalBox = await personalTab.boundingBox();
  await moveToBox(page, personalBox, 800);
  await page.mouse.click(personalBox.x + personalBox.width / 2, personalBox.y + personalBox.height / 2);
  await page.waitForTimeout(2200);

  // Beat 3: switch to Creative (light, orange, wallpaper)
  const creativeTab = page.locator(`.ff-ws-tab[title="Creative"], .ff-ws-tab:has-text("Creative")`).first();
  const creativeBox = await creativeTab.boundingBox();
  await moveToBox(page, creativeBox, 600);
  await page.mouse.click(creativeBox.x + creativeBox.width / 2, creativeBox.y + creativeBox.height / 2);
  await page.waitForTimeout(3000);

  // Beat 4: return to Work
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

  await skipOnboarding(page);
  await clearAllBookmarks(page);

  await page.goto(`${origin}/newtab.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ff-app', { timeout: 15_000 });

  const { workspaceIds } = await seedPromoWorkspaces(page);
  await reloadNewtab(page, 2000);

  // Use Personal workspace (more items = better context)
  await patchSettings(page, { activeWorkspaceId: workspaceIds.Personal });
  await page.waitForTimeout(1500);

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

async function recordOnboarding(context, origin) {
  console.log('\n── Video 03: onboarding (~18s)');
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);

  // For onboarding video: seed bookmark folders only (no workspaces),
  // then trigger fresh onboarding so the wizard shows folder recommendations.
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

  await reloadNewtab(page, 1500);

  // Wait for onboarding to appear
  await page.waitForSelector('.ff-onboard', { timeout: 8000 }).catch(() => undefined);

  // Beat 1: welcome — hold 2s
  await page.waitForTimeout(2000);

  // Beat 2: click Next to accent step
  const next = () => page.locator('.ff-onboard .ff-btn:has-text("Next")').first();
  await (await next().boundingBox()).then(async (box) => {
    if (box) {
      await moveToBox(page, box, 400);
      await next().click();
      await page.waitForTimeout(400);
    }
  }).catch(() => next().click().catch(() => undefined));
  await page.waitForTimeout(600);

  // Beat 2: pick blue accent
  const blueChip = page.locator('.ff-accentchip[aria-label="Blue"], .ff-accentchip').first();
  if (await blueChip.count() > 0) {
    await blueChip.click();
    await page.waitForTimeout(800);
  }
  await next().click().catch(() => undefined);
  await page.waitForTimeout(600);

  // Beat 3: layout — click Balanced, then Next
  const balanced = page.locator('.ff-card:has-text("Balanced"), [data-preset="balanced"]').first();
  if (await balanced.count() > 0) await balanced.click();
  await page.waitForTimeout(500);
  await next().click().catch(() => undefined);
  await page.waitForTimeout(600);

  // Beat 4: workspace step — select Multiple workspaces then pick all 3 folders
  const multiWs = page.locator('.ff-card:has-text("Multiple workspaces")').first();
  if (await multiWs.count() > 0) {
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
  // Hold on this state — the wow moment
  await page.waitForTimeout(2000);
  await next().click().catch(() => undefined);
  await page.waitForTimeout(600);

  // Beat 5: navigation preference — keep defaults, click Next
  await next().click().catch(() => undefined);
  await page.waitForTimeout(500);

  // Beat 6: finish screen — click Get started
  const finishBtn = page.locator('.ff-onboard .ff-btn:has-text("Get started"), .ff-onboard .ff-btn--accent').first();
  if (await finishBtn.count() > 0) {
    const finishBox = await finishBtn.boundingBox();
    await moveToBox(page, finishBox, 400);
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

  await skipOnboarding(page);
  await clearAllBookmarks(page);

  await page.goto(`${origin}/newtab.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ff-app', { timeout: 15_000 });

  const { workspaceIds } = await seedPromoWorkspaces(page);
  await reloadNewtab(page, 2000);

  // Open settings → Appearance
  const settingsBtn = page.getByRole('button', { name: 'Settings', exact: true });
  if (await settingsBtn.count() > 0) {
    const box = await settingsBtn.boundingBox();
    await moveToBox(page, box, 500);
    await settingsBtn.click();
    await page.waitForSelector('.ff-drawer', { timeout: 3000 });
    await page.waitForTimeout(600);
  }

  // Beat 2: cycle through accent chips
  const accentChips = page.locator('.ff-accentchip');
  const count = await accentChips.count();
  const indicesToCycle = [1, 2, 4, 5, 7]; // skip first (already active Blue), pick Teal, Green, Orange, Red, Purple
  for (const idx of indicesToCycle.slice(0, Math.min(5, count - 1))) {
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

  // Beat 4: cycle gradient styles
  const gradientBtns = page.locator('.ff-themegrid .ff-themecard');
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

  await skipOnboarding(page);
  await clearAllBookmarks(page);

  await page.goto(`${origin}/newtab.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ff-app', { timeout: 15_000 });

  const { workspaceIds } = await seedPromoWorkspaces(page);
  await reloadNewtab(page, 2000);

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

  await skipOnboarding(page);
  await clearAllBookmarks(page);

  await page.goto(`${origin}/newtab.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ff-app', { timeout: 15_000 });

  const { workspaceIds } = await seedPromoWorkspaces(page);
  await reloadNewtab(page, 2000);

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
      await page.waitForTimeout(300);
      await page.mouse.down();
      await page.waitForTimeout(400);
      await smoothMove(page, srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2,
        dstBox.x + dstBox.width / 2, dstBox.y + dstBox.height / 2, 1000);
      await page.waitForTimeout(400);
      await page.mouse.up();
      await page.waitForTimeout(1200);
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
        await page.waitForTimeout(400);
      }
    }
    await page.waitForTimeout(600);
  }

  // Beat 3: drag selection into a folder
  const folderTile = page.locator('.ff-tile[data-item-kind="folder"]').first();
  const selectedTile = tiles.nth(1);
  const selBox = await selectedTile.boundingBox().catch(() => null);
  const folderBox = await folderTile.boundingBox().catch(() => null);

  if (selBox && folderBox) {
    await page.mouse.move(selBox.x + selBox.width / 2, selBox.y + selBox.height / 2);
    await page.waitForTimeout(300);
    await page.mouse.down();
    await page.waitForTimeout(400);
    await smoothMove(page, selBox.x + selBox.width / 2, selBox.y + selBox.height / 2,
      folderBox.x + folderBox.width / 2, folderBox.y + folderBox.height / 2, 1200);
    await page.waitForTimeout(500);
    await page.mouse.up();
    await page.waitForTimeout(1500);
  }

  await saveVideo(page, '06-drag-reorder');
}

// ─── All scenarios map ────────────────────────────────────────────────────────

const VIDEOS = {
  'workspace-switch': recordWorkspaceSwitch,
  'add-bookmark':     recordAddEditBookmark,
  'onboarding':       recordOnboarding,
  'accent-theme':     recordAccentTheme,
  'search':           recordSearch,
  'drag-reorder':     recordDragReorder,
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

  const { rm } = await import('node:fs/promises');

  for (const key of keys) {
    const { context, profileDir } = await launchContext({ withVideo: true });
    const origin = await discoverOrigin(context);
    try {
      await VIDEOS[key](context, origin);
    } finally {
      await context.close().catch(() => undefined);
      await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
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
