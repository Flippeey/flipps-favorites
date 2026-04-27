/**
 * Promo video recording script for Flipp's Favorites Chrome Extension
 * Run from the project root: node scripts/record-promo-videos.mjs
 *
 * Records short demo videos (.webm) that can be converted to GIFs.
 * Requires: npm run build:chrome before running.
 *
 * Output: promo-videos/*.webm
 * Convert to GIF: ffmpeg -i input.webm -vf "fps=24,scale=1280:-1:flags=lanczos" output.gif
 */

import { chromium } from '@playwright/test';
import { mkdtemp, rm, mkdir, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const chromeExtPath = join(rootDir, 'dist', 'chrome');
const outDir = join(rootDir, 'promo-videos');

const WIDTH = 1920;
const HEIGHT = 1080;

// ─── Bookmark data (shared with take-promo-screenshots.mjs) ─────────────────

const DOCK_BOOKMARKS = [
  { title: 'Gmail',        url: 'https://mail.google.com' },
  { title: 'YouTube',      url: 'https://www.youtube.com' },
  { title: 'Google Maps',  url: 'https://maps.google.com' },
  { title: 'Calendar',     url: 'https://calendar.google.com' },
  { title: 'GitHub',       url: 'https://github.com' },
  { title: 'Spotify',      url: 'https://open.spotify.com' },
  { title: 'Netflix',      url: 'https://www.netflix.com' },
  { title: 'Reddit',       url: 'https://www.reddit.com' },
  { title: 'Notion',       url: 'https://www.notion.so' },
  { title: 'Discord',      url: 'https://discord.com' },
];

const ROOT_BOOKMARKS = [
  { title: 'Gmail',           url: 'https://mail.google.com' },
  { title: 'YouTube',         url: 'https://www.youtube.com' },
  { title: 'GitHub',          url: 'https://github.com' },
  { title: 'Notion',          url: 'https://www.notion.so' },
  { title: 'Spotify',         url: 'https://open.spotify.com' },
  { title: 'Netflix',         url: 'https://www.netflix.com' },
  { title: 'Reddit',          url: 'https://www.reddit.com' },
  { title: 'Discord',         url: 'https://discord.com' },
  { title: 'Figma',           url: 'https://www.figma.com' },
  { title: 'Vercel',          url: 'https://vercel.com' },
  { title: 'Linear',          url: 'https://linear.app' },
  { title: 'Slack',           url: 'https://slack.com' },
  { title: 'Twitch',          url: 'https://www.twitch.tv' },
  { title: 'Google Drive',    url: 'https://drive.google.com' },
  { title: 'Wikipedia',       url: 'https://www.wikipedia.org' },
  { title: 'Claude',          url: 'https://claude.ai' },
  { title: 'ChatGPT',         url: 'https://chat.openai.com' },
  { title: 'Hacker News',     url: 'https://news.ycombinator.com' },
  { title: 'Amazon',          url: 'https://www.amazon.com' },
  { title: 'LinkedIn',        url: 'https://www.linkedin.com' },
  { title: 'Stack Overflow',  url: 'https://stackoverflow.com' },
  { title: 'MDN Docs',        url: 'https://developer.mozilla.org' },
  { title: 'Pinterest',       url: 'https://www.pinterest.com' },
  { title: 'Duolingo',        url: 'https://www.duolingo.com' },
];

const FOLDERS = [
  {
    title: '💻 Tech',
    bookmarks: [
      { title: 'Hacker News',    url: 'https://news.ycombinator.com' },
      { title: 'GitHub',         url: 'https://github.com' },
      { title: 'Stack Overflow', url: 'https://stackoverflow.com' },
      { title: 'MDN Docs',       url: 'https://developer.mozilla.org' },
      { title: 'Vercel',         url: 'https://vercel.com' },
      { title: 'Cloudflare',     url: 'https://cloudflare.com' },
      { title: 'Dev.to',         url: 'https://dev.to' },
      { title: 'Claude',         url: 'https://claude.ai' },
    ],
  },
  {
    title: '🍳 Cooking',
    bookmarks: [
      { title: 'AllRecipes',     url: 'https://www.allrecipes.com' },
      { title: 'Serious Eats',   url: 'https://www.seriouseats.com' },
      { title: 'NYT Cooking',    url: 'https://cooking.nytimes.com' },
      { title: 'Epicurious',     url: 'https://www.epicurious.com' },
      { title: 'Food Network',   url: 'https://www.foodnetwork.com' },
      { title: 'Bon Appétit',    url: 'https://www.bonappetit.com' },
      { title: 'Tasty',          url: 'https://tasty.co' },
      { title: 'Yummly',         url: 'https://www.yummly.com' },
    ],
  },
  {
    title: '🏠 Smart Home',
    bookmarks: [
      { title: 'Home Assistant', url: 'https://www.home-assistant.io' },
      { title: 'SmartThings',    url: 'https://www.smartthings.com' },
      { title: 'Philips Hue',    url: 'https://www.philips-hue.com' },
      { title: 'IKEA Smart',     url: 'https://www.ikea.com/us/en/cat/smart-home-hs001/' },
      { title: 'iRobot',         url: 'https://www.irobot.com' },
      { title: 'Nest',           url: 'https://store.google.com/category/nest' },
      { title: 'Amazon Echo',    url: 'https://www.amazon.com/echo' },
      { title: 'Eve Systems',    url: 'https://www.evehome.com' },
    ],
  },
  {
    title: '🎬 Entertainment',
    bookmarks: [
      { title: 'Netflix',        url: 'https://www.netflix.com' },
      { title: 'YouTube',        url: 'https://www.youtube.com' },
      { title: 'Spotify',        url: 'https://open.spotify.com' },
      { title: 'Disney+',        url: 'https://www.disneyplus.com' },
      { title: 'Twitch',         url: 'https://www.twitch.tv' },
      { title: 'HBO Max',        url: 'https://www.max.com' },
      { title: 'IMDb',           url: 'https://www.imdb.com' },
      { title: 'Apple TV+',      url: 'https://tv.apple.com' },
    ],
  },
  {
    title: '🛍️ Shopping',
    bookmarks: [
      { title: 'Amazon',         url: 'https://www.amazon.com' },
      { title: 'Etsy',           url: 'https://www.etsy.com' },
      { title: 'eBay',           url: 'https://www.ebay.com' },
      { title: 'ASOS',           url: 'https://www.asos.com' },
      { title: 'Best Buy',       url: 'https://www.bestbuy.com' },
      { title: 'Wirecutter',     url: 'https://www.nytimes.com/wirecutter' },
    ],
  },
  {
    title: '📰 News',
    bookmarks: [
      { title: 'BBC News',       url: 'https://www.bbc.com/news' },
      { title: 'The Guardian',   url: 'https://www.theguardian.com' },
      { title: 'Reuters',        url: 'https://www.reuters.com' },
      { title: 'NPR',            url: 'https://www.npr.org' },
      { title: 'The Atlantic',   url: 'https://www.theatlantic.com' },
      { title: 'Wired',          url: 'https://www.wired.com' },
    ],
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function skipOnboarding(page) {
  await page.evaluate(() => {
    return browser.storage.local.set({
      'onboarding-state': {
        version: 1,
        status: 'completed',
        updatedAt: Date.now(),
        completedAt: Date.now(),
        skippedAt: null,
      },
    });
  });
}

async function applySettings(page, patch) {
  await page.evaluate(async (p) => {
    let current = {};
    try {
      const s = await browser.storage.sync.get('app-settings');
      if (s['app-settings'] && typeof s['app-settings'] === 'object') current = s['app-settings'];
    } catch {}
    if (!Object.keys(current).length) {
      try {
        const l = await browser.storage.local.get('app-settings');
        if (l['app-settings'] && typeof l['app-settings'] === 'object') current = l['app-settings'];
      } catch {}
    }
    const merged = { ...current, ...p };
    try { await browser.storage.sync.set({ 'app-settings': merged }); } catch {}
    await browser.storage.local.set({ 'app-settings': merged });
  }, patch);
}

async function seedBookmarks(page, extFolderId) {
  const dockFolderId = await page.evaluate(async ({ parentId }) => {
    const f = await browser.bookmarks.create({ parentId, title: '📌 Dock' });
    return f.id;
  }, { parentId: extFolderId });

  for (const bm of DOCK_BOOKMARKS) {
    await page.evaluate(async ({ parentId, title, url }) => {
      await browser.bookmarks.create({ parentId, title, url });
    }, { parentId: dockFolderId, title: bm.title, url: bm.url });
  }

  for (const bm of ROOT_BOOKMARKS) {
    await page.evaluate(async ({ parentId, title, url }) => {
      await browser.bookmarks.create({ parentId, title, url });
    }, { parentId: extFolderId, title: bm.title, url: bm.url });
  }

  const folderIds = {};
  for (const folder of FOLDERS) {
    const folderId = await page.evaluate(async ({ parentId, title }) => {
      const f = await browser.bookmarks.create({ parentId, title });
      return f.id;
    }, { parentId: extFolderId, title: folder.title });

    folderIds[folder.title] = folderId;

    for (const bm of folder.bookmarks) {
      await page.evaluate(async ({ parentId, title, url }) => {
        await browser.bookmarks.create({ parentId, title, url });
      }, { parentId: folderId, title: bm.title, url: bm.url });
    }
  }

  return { dockFolderId, folderIds };
}

async function loadPage(context, origin, settings) {
  const page = await context.newPage();
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(`${origin}/newtab.html`, { waitUntil: 'domcontentloaded' });
  if (settings) {
    await applySettings(page, settings);
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
  await page.waitForSelector('.shell', { timeout: 15_000 });
  await page.waitForTimeout(2000); // Let icons load
  return page;
}

/** Smooth mouse move between two points */
async function smoothMove(page, fromX, fromY, toX, toY, durationMs = 600) {
  const steps = Math.max(10, Math.round(durationMs / 16));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Ease in-out curve
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    await page.mouse.move(
      Math.round(fromX + (toX - fromX) * ease),
      Math.round(fromY + (toY - fromY) * ease),
    );
    await page.waitForTimeout(16);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Save video for a page after closing it */
async function saveVideo(page, filename) {
  await page.close();
  const videoPath = await page.video().path();
  // Windows keeps a brief write lock on the file after close — wait for release
  await sleep(1500);
  const dest = join(outDir, filename);
  await rename(videoPath, dest);
  console.log(`  ✓ Saved: ${filename}`);
}

// ─── Video flows ──────────────────────────────────────────────────────────────

async function recordSearch(context, origin, baseSettings) {
  console.log('\n▶ Recording video 1: search…');
  const page = await loadPage(context, origin, {
    ...baseSettings,
    themeMode: 'dark',
    accentColor: '#3F72DC',
    showSearchBar: true,
    searchBarPosition: 'center',
    searchScope: 'library',
  });

  // Establish scene — let viewer orient
  await page.waitForTimeout(2000);

  // Move cursor gently toward search bar
  const searchInput = page.locator('input[name="currentFolderSearch"]');
  const searchBox = await searchInput.boundingBox();
  await smoothMove(page, 960, 540, searchBox.x + searchBox.width / 2, searchBox.y + searchBox.height / 2, 700);
  await page.waitForTimeout(400);
  await searchInput.click();
  await page.waitForTimeout(500);

  // Type "google" — matches Gmail, Drive, Maps, Calendar (more results)
  await searchInput.pressSequentially('google', { delay: 110 });
  await page.waitForTimeout(1500);

  // Clear and try a folder search
  await searchInput.selectText();
  await page.waitForTimeout(300);
  await searchInput.pressSequentially('cook', { delay: 110 });
  await page.waitForTimeout(1500);

  // Clear and show "tech"
  await searchInput.selectText();
  await page.waitForTimeout(300);
  await searchInput.pressSequentially('tech', { delay: 110 });
  await page.waitForTimeout(1500);

  // Clear to restore
  await searchInput.selectText();
  await page.keyboard.press('Delete');
  await page.waitForTimeout(1000);

  await saveVideo(page, '01-search.webm');
}

async function recordEditIcon(context, origin, baseSettings) {
  console.log('\n▶ Recording video 2: edit bookmark icon…');
  const page = await loadPage(context, origin, {
    ...baseSettings,
    themeMode: 'dark',
    accentColor: '#3F72DC',
    showSearchBar: true,
    searchBarPosition: 'center',
  });

  await page.waitForTimeout(2000);

  // Find the Netflix tile
  const netflixTile = page.locator('[data-grid-item-id][data-bookmark-title="Netflix"]').first();
  const tileBox = await netflixTile.boundingBox();
  if (!tileBox) throw new Error('Netflix tile not found');

  // Move cursor to the tile naturally — start upper-center, closer to bookmark grid
  await smoothMove(page, 960, 320, tileBox.x + tileBox.width / 2, tileBox.y + tileBox.height / 2, 800);
  await page.waitForTimeout(500);

  // Right-click to open context menu
  await page.mouse.click(tileBox.x + tileBox.width / 2, tileBox.y + tileBox.height / 2, { button: 'right' });
  await page.waitForSelector('[data-context-action="edit"]', { timeout: 5000 });
  await page.waitForTimeout(700);

  // Move to Edit item and click
  const editBtn = page.locator('[data-context-action="edit"]');
  const editBox = await editBtn.boundingBox();
  await smoothMove(page, tileBox.x + tileBox.width / 2, tileBox.y + tileBox.height / 2, editBox.x + editBox.width / 2, editBox.y + editBox.height / 2, 400);
  await page.waitForTimeout(300);
  await editBtn.click();
  await page.waitForSelector('.bookmark-dialog', { timeout: 5000 });

  // Dialog auto-searches "Netflix logo" on open — wait naturally for results to load
  await page.waitForSelector('.icon-result-card', { timeout: 15_000 });
  await page.waitForTimeout(1200);

  // Click the first auto-loaded icon result
  const firstResult = page.locator('.icon-result-card').first();
  const resultBox = await firstResult.boundingBox();
  await smoothMove(page, editBox.x + editBox.width / 2, editBox.y + editBox.height / 2, resultBox.x + resultBox.width / 2, resultBox.y + resultBox.height / 2, 800);
  await page.waitForTimeout(400);
  await firstResult.click();
  await page.waitForTimeout(1000);

  // Save
  const saveBtn = page.locator('.bookmark-dialog-save-button');
  const saveBtnBox = await saveBtn.boundingBox();
  await smoothMove(page, resultBox.x + resultBox.width / 2, resultBox.y + resultBox.height / 2, saveBtnBox.x + saveBtnBox.width / 2, saveBtnBox.y + saveBtnBox.height / 2, 500);
  await page.waitForTimeout(400);
  await saveBtn.click();
  await page.waitForTimeout(2000);

  await saveVideo(page, '02-edit-icon.webm');
}

async function recordFolderAndDrag(context, origin, baseSettings) {
  console.log('\n▶ Recording video 3: create folder + marquee + drag…');
  const page = await loadPage(context, origin, {
    ...baseSettings,
    themeMode: 'dark',
    accentColor: '#F57C00',
    showSearchBar: true,
    searchBarPosition: 'center',
  });

  await page.waitForTimeout(2000);

  // ── Step 1: Right-click empty canvas background and create a folder ─────────

  // Scroll so the last grid row is visible — row 4 is below the fold with 30 items
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.bookmark-grid [data-grid-item-id]'));
    if (!items.length) return;
    items[items.length - 1].scrollIntoView({ behavior: 'instant', block: 'center' });
  });
  await page.waitForTimeout(500);

  // Find empty space to the right of the last item in the last row.
  // Grid has 8 columns; 30 items = 6 in final row, so columns 7–8 are empty.
  const emptyPoint = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.bookmark-grid [data-grid-item-id]'));
    const canvas = document.querySelector('.bookmark-canvas');
    if (!canvas) return { x: 900, y: 400 };
    const canvasRect = canvas.getBoundingClientRect();
    if (!items.length) return { x: canvasRect.left + canvasRect.width / 2, y: Math.max(canvasRect.top + 100, 100) };
    const last = items[items.length - 1];
    const lastRect = last.getBoundingClientRect();
    // Right of last item in same row — definitely no bookmark here
    const x = Math.min(lastRect.right + 100, canvasRect.right - 30);
    // Clamp y to visible viewport (above dock area)
    const y = Math.min(Math.max(lastRect.top + lastRect.height / 2, 80), window.innerHeight - 220);
    return { x, y };
  });

  const emptyX = emptyPoint.x;
  const emptyY = emptyPoint.y;

  await smoothMove(page, 960, 540, emptyX, emptyY, 700);
  await page.waitForTimeout(400);

  // Register dialog handler before triggering the prompt
  page.once('dialog', async dialog => {
    await dialog.accept('Dev Tools');
  });

  await page.mouse.click(emptyX, emptyY, { button: 'right' });
  await page.waitForSelector('[data-context-action="add-folder"]', { timeout: 5000 });
  await page.waitForTimeout(600);

  // Click Add Folder
  const addFolderBtn = page.locator('[data-context-action="add-folder"]');
  const addFolderBox = await addFolderBtn.boundingBox();
  await smoothMove(page, emptyX, emptyY, addFolderBox.x + addFolderBox.width / 2, addFolderBox.y + addFolderBox.height / 2, 400);
  await page.waitForTimeout(300);
  await addFolderBtn.click();

  // Wait for the new folder to appear in the grid
  await page.waitForTimeout(1500);

  // ── Step 2: Marquee-select several bookmarks ──────────────────────────────

  // Get positions of first several bookmark tiles (not folders)
  const itemPositions = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.bookmark-grid [data-grid-item-id][data-link-url]'));
    return items.slice(0, 6).map(el => {
      const rect = el.getBoundingClientRect();
      return {
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      };
    });
  });

  if (itemPositions.length < 3) {
    console.warn('  ⚠ Not enough bookmark items for marquee demo');
  } else {
    // Start marquee slightly above+left of first item, end below+right of 4th item
    const target = itemPositions[Math.min(3, itemPositions.length - 1)];
    const marqueeStartX = itemPositions[0].left - 20;
    const marqueeStartY = itemPositions[0].top - 20;
    const marqueeEndX = target.right + 20;
    const marqueeEndY = target.bottom + 20;

    // Move cursor to start position
    await smoothMove(page, emptyX, emptyY, marqueeStartX, marqueeStartY, 700);
    await page.waitForTimeout(400);

    // Begin marquee drag
    await page.mouse.down();
    await page.waitForTimeout(100);
    await smoothMove(page, marqueeStartX, marqueeStartY, marqueeEndX, marqueeEndY, 1000);
    await page.waitForTimeout(400);
    await page.mouse.up();
    await page.waitForTimeout(1200);

    // ── Step 3: Drag selected items into the new folder ─────────────────────

    // Find the "Dev Tools" folder we just created
    const newFolderBox = await page.evaluate(() => {
      const folders = Array.from(document.querySelectorAll('.bookmark-grid .folder-card[data-grid-item-id]'));
      const newFolder = folders.find(el => el.textContent?.includes('Dev Tools'));
      if (!newFolder) return null;
      const rect = newFolder.getBoundingClientRect();
      return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
    });

    if (!newFolderBox) {
      console.warn('  ⚠ Could not find "Dev Tools" folder — skipping drag step');
    } else {
      // Start drag from first selected item (center of selection)
      const dragStartX = itemPositions[1].cx;
      const dragStartY = itemPositions[1].cy;

      await smoothMove(page, marqueeEndX, marqueeEndY, dragStartX, dragStartY, 600);
      await page.waitForTimeout(400);

      await page.mouse.down();
      await page.waitForTimeout(200);
      // Move slightly to activate drag mode (needs > 6px)
      await page.mouse.move(dragStartX + 8, dragStartY + 4);
      await page.waitForTimeout(100);
      // Smooth move to the folder
      await smoothMove(page, dragStartX + 8, dragStartY + 4, newFolderBox.cx, newFolderBox.cy, 900);
      await page.waitForTimeout(600);
      await page.mouse.up();
      await page.waitForTimeout(1800);
    }
  }

  await saveVideo(page, '03-folder-and-drag.webm');
}

async function recordColorThemes(context, origin, baseSettings) {
  console.log('\n▶ Recording video 4: color themes…');
  const page = await loadPage(context, origin, {
    ...baseSettings,
    themeMode: 'dark',
    accentColor: '#3F72DC',
    showSearchBar: false,
  });

  await page.waitForTimeout(2000);

  // Open settings drawer
  const drawerToggle = page.locator('.drawer-toggle').first();
  const toggleBox = await drawerToggle.boundingBox();
  await smoothMove(page, 960, 540, toggleBox.x + toggleBox.width / 2, toggleBox.y + toggleBox.height / 2, 600);
  await page.waitForTimeout(400);
  await drawerToggle.click();
  await page.waitForSelector('[data-section="appearance"]', { timeout: 5000 });
  await page.waitForTimeout(800);

  // Navigate to appearance section
  const appearanceBtn = page.locator('[data-section="appearance"]');
  const appearanceBox = await appearanceBtn.boundingBox();
  await smoothMove(page, toggleBox.x, toggleBox.y, appearanceBox.x + appearanceBox.width / 2, appearanceBox.y + appearanceBox.height / 2, 400);
  await page.waitForTimeout(300);
  await appearanceBtn.click();
  await page.waitForTimeout(800);

  // Cycle through accent colors in dark mode
  const darkAccentColors = ['#F57C00', '#23867B', '#7D60D8', '#C75252', '#3F72DC'];
  let prevBox = appearanceBox;
  for (const color of darkAccentColors) {
    const swatch = page.locator(`[data-accent-option="${color}"]`);
    const swatchBox = await swatch.boundingBox();
    await smoothMove(page, prevBox.x, prevBox.y, swatchBox.x + swatchBox.width / 2, swatchBox.y + swatchBox.height / 2, 350);
    await page.waitForTimeout(250);
    await swatch.click();
    await page.waitForTimeout(900);
    prevBox = swatchBox;
  }

  // Switch to light mode — the big reveal
  const lightModeCard = page.locator('[data-theme-mode-option="light"]');
  const lightBox = await lightModeCard.boundingBox();
  await smoothMove(page, prevBox.x, prevBox.y, lightBox.x + lightBox.width / 2, lightBox.y + lightBox.height / 2, 500);
  await page.waitForTimeout(400);
  await lightModeCard.click();
  await page.waitForTimeout(1200);

  // Cycle a couple accent colors in light mode too
  const lightAccentColors = ['#F57C00', '#3F72DC'];
  for (const color of lightAccentColors) {
    const swatch = page.locator(`[data-accent-option="${color}"]`);
    const swatchBox = await swatch.boundingBox();
    await smoothMove(page, prevBox.x, prevBox.y, swatchBox.x + swatchBox.width / 2, swatchBox.y + swatchBox.height / 2, 350);
    await page.waitForTimeout(250);
    await swatch.click();
    await page.waitForTimeout(900);
    prevBox = swatchBox;
  }

  await saveVideo(page, '04-color-themes.webm');
}


async function recordLayoutSettings(context, origin, baseSettings) {
  console.log('\n▶ Recording video 5: layout settings…');
  const page = await loadPage(context, origin, {
    ...baseSettings,
    themeMode: 'dark',
    accentColor: '#3F72DC',
    showSearchBar: false,
  });

  await page.waitForTimeout(2000);

  // Open settings drawer
  const drawerToggle = page.locator('.drawer-toggle').first();
  const toggleBox = await drawerToggle.boundingBox();
  await smoothMove(page, 960, 540, toggleBox.x + toggleBox.width / 2, toggleBox.y + toggleBox.height / 2, 600);
  await page.waitForTimeout(400);
  await drawerToggle.click();
  await page.waitForSelector('[data-section="general"]', { timeout: 5000 });
  await page.waitForTimeout(700);

  // Click General section
  const generalBtn = page.locator('[data-section="general"]');
  const generalBox = await generalBtn.boundingBox();
  await smoothMove(page, toggleBox.x, toggleBox.y, generalBox.x + generalBox.width / 2, generalBox.y + generalBox.height / 2, 400);
  await page.waitForTimeout(300);
  await generalBtn.click();
  await page.waitForTimeout(700);

  // Click Layout tab
  const layoutTab = page.locator('[data-general-subpage="layout"]');
  const layoutTabBox = await layoutTab.boundingBox();
  await smoothMove(page, generalBox.x, generalBox.y, layoutTabBox.x + layoutTabBox.width / 2, layoutTabBox.y + layoutTabBox.height / 2, 400);
  await page.waitForTimeout(300);
  await layoutTab.click();
  await page.waitForTimeout(800);

  // Cycle through layout presets
  const presets = ['compact', 'spacious', 'balanced'];
  let prevBox = layoutTabBox;
  for (const preset of presets) {
    const card = page.locator(`[data-layout-preset-option="${preset}"]`);
    const cardBox = await card.boundingBox();
    await smoothMove(page, prevBox.x, prevBox.y, cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2, 450);
    await page.waitForTimeout(350);
    await card.click();
    await page.waitForTimeout(1100);
    prevBox = cardBox;
  }

  // Close drawer to reveal the final layout
  const closeBtn = page.locator('.drawer-close');
  const closeBox = await closeBtn.boundingBox();
  await smoothMove(page, prevBox.x, prevBox.y, closeBox.x + closeBox.width / 2, closeBox.y + closeBox.height / 2, 500);
  await page.waitForTimeout(400);
  await closeBtn.click();
  await page.waitForTimeout(2000);

  await saveVideo(page, '05-layout-settings.webm');
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  await mkdir(outDir, { recursive: true });
  console.log('Output dir:', outDir);

  const profileDir = await mkdtemp(join(tmpdir(), 'ff-promo-video-'));
  console.log('Profile dir:', profileDir);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${chromeExtPath}`,
      `--load-extension=${chromeExtPath}`,
      '--no-first-run',
      '--disable-default-apps',
      '--window-size=1920,1120',
    ],
    viewport: { width: WIDTH, height: HEIGHT },
    recordVideo: {
      dir: outDir,
      size: { width: WIDTH, height: HEIGHT },
    },
  });

  // Discover extension origin
  const workers = context.serviceWorkers();
  const sw = workers.length > 0
    ? workers[0]
    : await context.waitForEvent('serviceworker', { timeout: 15_000 });
  const extId = new URL(sw.url()).hostname;
  const origin = `chrome-extension://${extId}`;
  console.log('Extension ID:', extId);

  // Bootstrap: seed bookmarks and base settings on a throwaway page
  const setupPage = await context.newPage();
  await setupPage.setViewportSize({ width: WIDTH, height: HEIGHT });
  await setupPage.goto(`${origin}/newtab.html`);
  await setupPage.waitForSelector('.shell', { timeout: 15_000 });
  await skipOnboarding(setupPage);

  const rootFolderId = await setupPage.evaluate(async () => {
    const f = await browser.bookmarks.create({ parentId: '2', title: "Flipp's Favorites" });
    return f.id;
  });

  const { dockFolderId } = await seedBookmarks(setupPage, rootFolderId);
  console.log('Bookmarks seeded. rootFolderId:', rootFolderId);

  const baseSettings = {
    rootFolderId,
    rememberLastFolder: false,
    showDock: true,
    dockFolderId,
    showClock: false,
    autoHideDock: false,
  };

  await applySettings(setupPage, baseSettings);

  // Close setup page (its video is discarded automatically via cleanup)
  await setupPage.close();

  // Record each video flow
  await recordSearch(context, origin, baseSettings);
  await recordEditIcon(context, origin, baseSettings);
  await recordFolderAndDrag(context, origin, baseSettings);
  await recordColorThemes(context, origin, baseSettings);
  await recordLayoutSettings(context, origin, baseSettings);

  await context.close();

  // Clean up leftover video files (setup page + any orphans not renamed)
  const { readdir, unlink } = await import('node:fs/promises');
  const remaining = await readdir(outDir);
  for (const f of remaining) {
    if (f.endsWith('.webm') && !['01-search.webm', '02-edit-icon.webm', '03-folder-and-drag.webm', '04-color-themes.webm', '05-layout-settings.webm'].includes(f)) {
      await unlink(join(outDir, f)).catch(() => undefined);
    }
  }

  await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);

  console.log('\n✅ All videos saved to:', outDir);
  console.log('\nConvert to GIF with ffmpeg:');
  console.log('  ffmpeg -i promo-videos/01-search.webm -vf "fps=24,scale=1280:-1:flags=lanczos" promo-videos/01-search.gif');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
