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
  // Streaming trio at positions 0-2 so they form a contiguous group for the drag demo
  { title: 'Netflix',         url: 'https://www.netflix.com' },
  { title: 'YouTube',         url: 'https://www.youtube.com' },
  { title: 'Twitch',          url: 'https://www.twitch.tv' },
  { title: 'Gmail',           url: 'https://mail.google.com' },
  { title: 'GitHub',          url: 'https://github.com' },
  { title: 'Notion',          url: 'https://www.notion.so' },
  { title: 'Spotify',         url: 'https://open.spotify.com' },
  { title: 'Reddit',          url: 'https://www.reddit.com' },
  { title: 'Discord',         url: 'https://discord.com' },
  { title: 'Figma',           url: 'https://www.figma.com' },
  { title: 'Vercel',          url: 'https://vercel.com' },
  { title: 'Linear',          url: 'https://linear.app' },
  { title: 'Slack',           url: 'https://slack.com' },
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

// Default values matching defaultWorkspaceSettings in src/shared/storage.ts
const WORKSPACE_DEFAULTS = {
  backgroundMode: 'gradient',
  solidBackgroundColor: '',
  gradientStyle: 'top',
  gradientColorSource: 'accent',
  gradientCustomColor: '#3F72DC',
  gradientIntensity: 100,
  backgroundOpacity: 70,
  backgroundFitMode: 'cover',
  backgroundPositionMode: 'center',
  layoutPreset: 'balanced',
  favoritesColumns: 10,
  favoritesRows: 0,
  favoritesColumnGap: 24,
  favoritesRowGap: 20,
  bookmarkTileWidth: 130,
  bookmarkIconSize: 75,
  tileShape: 'squircle',
  showBookmarkIconBackground: false,
  showAccentBackground: true,
  showTileLabels: true,
};

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

/**
 * Seed workspace records in storage.
 * workspaces: [{ id, name, rootFolderId, accentColor, ...overrides }]
 * Replaces the entire workspaces store — use all desired workspaces in one call.
 */
async function seedWorkspaces(page, workspaces) {
  await page.evaluate(async ({ list, defaults }) => {
    const records = {};
    for (const w of list) {
      records[w.id] = { ...defaults, gradientCustomColor: w.accentColor, ...w };
    }
    try { await browser.storage.sync.set({ workspaces: records }); } catch {}
    await browser.storage.local.set({ workspaces: records });
    // Set active workspace on app-settings
    let current = {};
    try { const s = await browser.storage.sync.get('app-settings'); current = s['app-settings'] ?? {}; } catch {}
    const updated = { ...current, activeWorkspaceId: list[0].id };
    try { await browser.storage.sync.set({ 'app-settings': updated }); } catch {}
    await browser.storage.local.set({ 'app-settings': updated });
  }, { list: workspaces, defaults: WORKSPACE_DEFAULTS });
}

async function seedBookmarks(page, extFolderId) {
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

  return { folderIds };
}

async function loadPage(context, origin, settings) {
  const page = await context.newPage();
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(`${origin}/newtab.html`, { waitUntil: 'domcontentloaded' });
  if (settings) {
    await applySettings(page, settings);
    // Use goto instead of reload so the extension's hash from the first load doesn't persist
    await page.goto(`${origin}/newtab.html`, { waitUntil: 'domcontentloaded' });
  }
  await page.waitForSelector('.ff-app', { timeout: 15_000 });
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

/** Find a folder tile by its title text and return its center coordinates */
async function findFolderCenter(page, text) {
  return page.evaluate((searchText) => {
    const folders = Array.from(document.querySelectorAll('.ff-tile[data-item-kind="folder"]'));
    const folder = folders.find(el =>
      (el.textContent ?? '').includes(searchText) ||
      (el.getAttribute('title') ?? '').includes(searchText)
    );
    if (!folder) return null;
    const rect = folder.getBoundingClientRect();
    return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
  }, text);
}

/** Click a breadcrumb button by its text content and return its center */
async function clickBreadcrumb(page, text) {
  return page.evaluate((searchText) => {
    const crumbs = Array.from(document.querySelectorAll('.ff-crumb__btn'));
    const crumb = crumbs.find(el => (el.textContent ?? '').includes(searchText));
    if (!crumb) return null;
    const rect = crumb.getBoundingClientRect();
    crumb.click();
    return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
  }, text);
}

// ─── Video flows ──────────────────────────────────────────────────────────────

async function recordSearch(context, origin, baseSettings) {
  console.log('\n▶ Recording video 1: search…');
  const page = await loadPage(context, origin, {
    ...baseSettings,
    themeMode: 'dark',
    showSearchBar: true,
    searchBarPosition: 'center',
    searchScope: 'library',
  });

  // Establish scene — let viewer orient
  await page.waitForTimeout(2000);

  // Move cursor gently toward search bar
  const searchInput = page.locator('input[aria-label="Search bookmarks"]');
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
    showSearchBar: true,
    searchBarPosition: 'center',
  });

  await page.waitForTimeout(2000);

  // Find the Netflix tile by its title attribute
  const netflixTile = page.locator('.ff-tile[title="Netflix"]').first();
  const tileBox = await netflixTile.boundingBox();
  if (!tileBox) throw new Error('Netflix tile not found');

  // Move cursor to the tile naturally — start upper-center, closer to bookmark grid
  await smoothMove(page, 960, 320, tileBox.x + tileBox.width / 2, tileBox.y + tileBox.height / 2, 800);
  await page.waitForTimeout(500);

  // Right-click to open context menu
  await page.mouse.click(tileBox.x + tileBox.width / 2, tileBox.y + tileBox.height / 2, { button: 'right' });
  await page.waitForSelector('.ff-ctx', { timeout: 5000 });
  await page.waitForTimeout(700);

  // Move to Edit item and click
  const editBtn = page.locator('.ff-ctx__item', { hasText: 'Edit' });
  const editBox = await editBtn.boundingBox();
  await smoothMove(page, tileBox.x + tileBox.width / 2, tileBox.y + tileBox.height / 2, editBox.x + editBox.width / 2, editBox.y + editBox.height / 2, 400);
  await page.waitForTimeout(300);
  await editBtn.click();
  await page.waitForSelector('.ff-dialog', { timeout: 5000 });

  // Wait for icon search results grid to appear in DOM (state: attached — cells start display:none)
  await page.waitForSelector('div.ff-icongrid', { state: 'attached', timeout: 15_000 });
  // Wait up to 20s for at least one preview image to load and become visible
  const cellVisible = await page.waitForSelector('.ff-icongrid__cell', { state: 'visible', timeout: 20_000 }).catch(() => null);
  await page.waitForTimeout(800);

  const saveBtn = page.locator('.ff-dialog button.ff-btn', { hasText: 'Save bookmark' });

  if (cellVisible) {
    // Click the first visible icon result
    const firstResult = page.locator('.ff-icongrid__cell').first();
    const resultBox = await firstResult.boundingBox();
    await smoothMove(page, editBox.x + editBox.width / 2, editBox.y + editBox.height / 2, resultBox.x + resultBox.width / 2, resultBox.y + resultBox.height / 2, 800);
    await page.waitForTimeout(400);
    await firstResult.click();
    await page.waitForTimeout(1000);
    const saveBtnBox = await saveBtn.boundingBox();
    await smoothMove(page, resultBox.x + resultBox.width / 2, resultBox.y + resultBox.height / 2, saveBtnBox.x + saveBtnBox.width / 2, saveBtnBox.y + saveBtnBox.height / 2, 500);
  } else {
    console.warn('  ⚠ Icon previews did not load — saving without selecting an icon');
    const saveBtnBox = await saveBtn.boundingBox();
    await smoothMove(page, editBox.x + editBox.width / 2, editBox.y + editBox.height / 2, saveBtnBox.x + saveBtnBox.width / 2, saveBtnBox.y + saveBtnBox.height / 2, 500);
  }

  await page.waitForTimeout(400);
  await saveBtn.click();
  await page.waitForTimeout(2000);

  await saveVideo(page, '02-edit-icon.webm');
}

/**
 * Record video 3: workspace tabs UI demo.
 * Shows three workspaces (Work, Personal, Creative) in the tab bar at the top.
 * Clicking each tab switches to that workspace and applies its accent color.
 * workspaceDefs: [{ id, name, rootFolderId, accentColor }, ...]
 */
async function recordWorkspaces(context, origin, baseSettings, workspaceDefs) {
  console.log('\n▶ Recording video 3: workspaces…');

  const page = await loadPage(context, origin, {
    ...baseSettings,
    activeWorkspaceId: workspaceDefs[0].id,
    themeMode: 'dark',
    showDock: false,
    showSearchBar: false,
    rememberLastFolder: false,
  });

  // Wait for workspace tab bar to appear (only visible when path.length === 0)
  const tabBarPresent = await page.waitForSelector('.ff-ws-tabs', { timeout: 10_000 }).catch(() => null);
  if (!tabBarPresent) {
    console.warn('  ⚠ Workspace tab bar not found — check that multiple workspaces are seeded');
    await saveVideo(page, '03-workspaces.webm');
    return;
  }

  // Orient — viewer sees first workspace active (blue accent, Work bookmarks)
  await page.waitForTimeout(2000);

  // Cycle through workspaces 1→2→3→1 with smooth cursor movement between tabs
  let prevCx = 960;
  let prevCy = 60; // approximate tab bar vertical center

  for (const ws of workspaceDefs.slice(1)) {
    const tab = page.locator(`.ff-ws-tab[data-workspace-id="${ws.id}"]`);
    const tabBox = await tab.boundingBox();
    if (!tabBox) {
      console.warn(`  ⚠ Tab not found for workspace ${ws.id}`);
      continue;
    }
    const tabCx = tabBox.x + tabBox.width / 2;
    const tabCy = tabBox.y + tabBox.height / 2;
    await smoothMove(page, prevCx, prevCy, tabCx, tabCy, 600);
    await page.waitForTimeout(300);
    await tab.click();
    await page.waitForTimeout(1800); // Let accent color transition + grid re-render
    prevCx = tabCx;
    prevCy = tabCy;
  }

  // Click back to first workspace
  const firstTab = page.locator(`.ff-ws-tab[data-workspace-id="${workspaceDefs[0].id}"]`);
  const firstBox = await firstTab.boundingBox();
  if (firstBox) {
    const firstCx = firstBox.x + firstBox.width / 2;
    const firstCy = firstBox.y + firstBox.height / 2;
    await smoothMove(page, prevCx, prevCy, firstCx, firstCy, 600);
    await page.waitForTimeout(300);
    await firstTab.click();
    await page.waitForTimeout(1500);
  }

  await saveVideo(page, '03-workspaces.webm');
}

async function recordDragReorder(context, origin, baseSettings) {
  console.log('\n▶ Recording video 4: drag to reorder…');
  const page = await loadPage(context, origin, {
    ...baseSettings,
    themeMode: 'dark',
    showSearchBar: false,
  });

  await page.waitForTimeout(2000);

  // ── Phase 1: Single bookmark drag ─────────────────────────────────────────
  // Drag Notion (position 5) up to position 3 — shows single-item reorder.
  // Positions 0-2 (Netflix/YouTube/Twitch) are intentionally untouched.
  const itemPositions = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.ff-tile[data-item-kind="bookmark"]'));
    return items.slice(0, 8).map(el => {
      const rect = el.getBoundingClientRect();
      return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
    });
  });

  if (itemPositions.length < 6) {
    console.warn('  ⚠ Not enough items for drag demo');
    await saveVideo(page, '04-drag-reorder.webm');
    return;
  }

  const from = itemPositions[5];
  const to   = itemPositions[3];

  await smoothMove(page, 960, 540, from.cx, from.cy, 700);
  await page.waitForTimeout(400);
  await page.mouse.down();
  await page.waitForTimeout(200);
  await page.mouse.move(from.cx + 8, from.cy + 4);
  await page.waitForTimeout(100);
  await smoothMove(page, from.cx + 8, from.cy + 4, to.cx, to.cy, 1000);
  await page.waitForTimeout(600);
  await page.mouse.up();
  await page.waitForTimeout(1800);

  // ── Phase 2: Marquee-select Netflix + YouTube + Twitch → drag to Entertainment ──
  // Netflix, YouTube, Twitch are at positions 0, 1, 2 — always the first three tiles.
  // The .bookmark-canvas surface has 24px top padding before any tile, giving a guaranteed
  // empty area to start the marquee. Marquee does NOT call renderApp mid-drag, so
  // selection is stable and includes all three items exactly.
  const marqueeInfo = await page.evaluate(() => {
    const canvas = document.querySelector('.ff-canvas');
    const netflix = document.querySelector('.ff-tile[title="Netflix"]');
    const youtube = document.querySelector('.ff-tile[title="YouTube"]');
    const twitch  = document.querySelector('.ff-tile[title="Twitch"]');
    if (!canvas || !netflix || !youtube || !twitch) return null;

    const cr = canvas.getBoundingClientRect();
    const nr = netflix.getBoundingClientRect();
    const yr = youtube.getBoundingClientRect();
    const tr = twitch.getBoundingClientRect();

    return {
      // Top-left of canvas padding — guaranteed empty (no tile starts in the 24px top pad)
      startX: cr.left + 5,
      startY: cr.top + 12,
      // Just past Twitch's right edge and below all three tiles
      endX: tr.right + 5,
      endY: Math.max(nr.bottom, yr.bottom, tr.bottom) + 5,
      netflix: { cx: nr.left + nr.width / 2, cy: nr.top + nr.height / 2 },
    };
  });

  if (!marqueeInfo) {
    console.warn('  ⚠ Could not locate streaming tiles or canvas for marquee');
    await saveVideo(page, '04-drag-reorder.webm');
    return;
  }

  // Move cursor to marquee start (canvas top-left padding)
  await smoothMove(page, to.cx, to.cy, marqueeInfo.startX, marqueeInfo.startY, 700);
  await page.waitForTimeout(300);

  // Draw marquee over Netflix → YouTube → Twitch
  await page.mouse.down();
  await page.waitForTimeout(100);
  await smoothMove(page, marqueeInfo.startX, marqueeInfo.startY, marqueeInfo.endX, marqueeInfo.endY, 1000);
  await page.waitForTimeout(300);
  await page.mouse.up();
  // renderApp fires once here after marquee ends — selection [Netflix, YouTube, Twitch] committed
  await page.waitForTimeout(1200);

  // Find Entertainment folder
  let entertainCenter = await findFolderCenter(page, 'Entertainment');
  for (let i = 0; i < 3 && !entertainCenter; i++) {
    await page.evaluate(() => window.scrollBy(0, 200));
    await page.waitForTimeout(300);
    entertainCenter = await findFolderCenter(page, 'Entertainment');
  }

  if (!entertainCenter) {
    const debug = await page.evaluate(() => ({
      url: location.href,
      cards: Array.from(document.querySelectorAll('.ff-tile[data-item-kind="folder"]')).map(el => el.textContent?.trim().slice(0, 30)),
    }));
    console.warn('  ⚠ Entertainment folder not found. Debug:', JSON.stringify(debug));
    await saveVideo(page, '04-drag-reorder.webm');
    return;
  }

  // Drag from Netflix into Entertainment — all three selected items move together
  const ncx = marqueeInfo.netflix.cx;
  const ncy = marqueeInfo.netflix.cy;
  await smoothMove(page, marqueeInfo.endX, marqueeInfo.endY, ncx, ncy, 500);
  await page.waitForTimeout(200);
  await page.mouse.down();
  await page.waitForTimeout(200);
  await page.mouse.move(ncx + 8, ncy + 4);
  await page.waitForTimeout(100);
  await smoothMove(page, ncx + 8, ncy + 4, entertainCenter.cx, entertainCenter.cy, 1200);
  await page.waitForTimeout(600);
  await page.mouse.up();
  await page.waitForTimeout(2500);

  await saveVideo(page, '04-drag-reorder.webm');
}

async function recordColorThemes(context, origin, baseSettings) {
  console.log('\n▶ Recording video 5: color themes…');
  const page = await loadPage(context, origin, {
    ...baseSettings,
    themeMode: 'dark',
    showSearchBar: false,
  });

  await page.waitForTimeout(2000);

  // Open settings drawer — it opens on Workspace scope / Appearance section by default
  const settingsBtn = page.locator('button.ff-iconbtn[aria-label="Settings"]');
  const toggleBox = await settingsBtn.boundingBox();
  await smoothMove(page, 960, 540, toggleBox.x + toggleBox.width / 2, toggleBox.y + toggleBox.height / 2, 600);
  await page.waitForTimeout(400);
  await settingsBtn.click();
  await page.waitForSelector('.ff-drawer__scope-tabs', { timeout: 5000 });
  await page.waitForSelector('.ff-accents', { timeout: 5000 });
  await page.waitForTimeout(800);

  // Map accent hex values to aria-label names for the .ff-accentchip selector
  const darkAccentColors = [
    { label: 'Orange', value: '#F57C00' },
    { label: 'Teal',   value: '#23867B' },
    { label: 'Purple', value: '#7D60D8' },
    { label: 'Red',    value: '#C75252' },
    { label: 'Blue',   value: '#3F72DC' },
  ];

  let prevBox = toggleBox;
  for (const accent of darkAccentColors) {
    const swatch = page.locator(`.ff-accentchip[aria-label="${accent.label}"]`).first();
    const swatchBox = await swatch.boundingBox();
    await smoothMove(page, prevBox.x + prevBox.width / 2, prevBox.y + prevBox.height / 2, swatchBox.x + swatchBox.width / 2, swatchBox.y + swatchBox.height / 2, 350);
    await page.waitForTimeout(250);
    await swatch.click();
    await page.waitForTimeout(900);
    prevBox = swatchBox;
  }

  // Switch to light mode — the big reveal
  const lightModeCard = page.locator('.ff-themecard--light').first();
  const lightBox = await lightModeCard.boundingBox();
  await smoothMove(page, prevBox.x + prevBox.width / 2, prevBox.y + prevBox.height / 2, lightBox.x + lightBox.width / 2, lightBox.y + lightBox.height / 2, 500);
  await page.waitForTimeout(400);
  await lightModeCard.click();
  await page.waitForTimeout(1200);

  // Cycle a couple accent colors in light mode too
  const lightAccentColors = [
    { label: 'Orange', value: '#F57C00' },
    { label: 'Blue',   value: '#3F72DC' },
  ];
  for (const accent of lightAccentColors) {
    const swatch = page.locator(`.ff-accentchip[aria-label="${accent.label}"]`).first();
    const swatchBox = await swatch.boundingBox();
    await smoothMove(page, prevBox.x + prevBox.width / 2, prevBox.y + prevBox.height / 2, swatchBox.x + swatchBox.width / 2, swatchBox.y + swatchBox.height / 2, 350);
    await page.waitForTimeout(250);
    await swatch.click();
    await page.waitForTimeout(900);
    prevBox = swatchBox;
  }

  await saveVideo(page, '05-color-themes.webm');
}

async function recordLayoutSettings(context, origin, baseSettings) {
  console.log('\n▶ Recording video 6: layout settings…');
  const page = await loadPage(context, origin, {
    ...baseSettings,
    themeMode: 'dark',
    showSearchBar: false,
  });

  await page.waitForTimeout(2000);

  // Open settings drawer — opens on Workspace scope / Appearance by default
  const settingsBtn = page.locator('button.ff-iconbtn[aria-label="Settings"]');
  const toggleBox = await settingsBtn.boundingBox();
  await smoothMove(page, 960, 540, toggleBox.x + toggleBox.width / 2, toggleBox.y + toggleBox.height / 2, 600);
  await page.waitForTimeout(400);
  await settingsBtn.click();
  await page.waitForSelector('.ff-drawer__scope-tabs', { timeout: 5000 });
  await page.waitForTimeout(700);

  // Navigate to Layout section (Workspace scope, Layout nav item)
  const layoutBtn = page.locator('.ff-drawer__navitem', { hasText: 'Layout' });
  const layoutBtnBox = await layoutBtn.boundingBox();
  await smoothMove(page, toggleBox.x + toggleBox.width / 2, toggleBox.y + toggleBox.height / 2, layoutBtnBox.x + layoutBtnBox.width / 2, layoutBtnBox.y + layoutBtnBox.height / 2, 400);
  await page.waitForTimeout(300);
  await layoutBtn.click();
  await page.waitForTimeout(800);

  // Cycle through layout presets — buttons are .ff-card with label text inside
  const presets = [
    { id: 'compact',  label: 'Compact' },
    { id: 'spacious', label: 'Spacious' },
    { id: 'balanced', label: 'Balanced' },
  ];
  let prevBox = layoutBtnBox;
  for (const preset of presets) {
    const card = page.locator('button.ff-card', { hasText: preset.label });
    const cardBox = await card.boundingBox();
    await smoothMove(page, prevBox.x + prevBox.width / 2, prevBox.y + prevBox.height / 2, cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2, 450);
    await page.waitForTimeout(350);
    await card.click();
    await page.waitForTimeout(1100);
    prevBox = cardBox;
  }

  // Close drawer to reveal the final layout
  const closeBtn = page.locator('.ff-drawer button[aria-label="Close"]');
  const closeBox = await closeBtn.boundingBox();
  await smoothMove(page, prevBox.x + prevBox.width / 2, prevBox.y + prevBox.height / 2, closeBox.x + closeBox.width / 2, closeBox.y + closeBox.height / 2, 500);
  await page.waitForTimeout(400);
  await closeBtn.click();
  await page.waitForTimeout(2000);

  await saveVideo(page, '06-layout-settings.webm');
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

  // Bootstrap: seed bookmarks and workspace records on a throwaway page
  const setupPage = await context.newPage();
  await setupPage.setViewportSize({ width: WIDTH, height: HEIGHT });
  await setupPage.goto(`${origin}/newtab.html`);
  await setupPage.waitForSelector('.ff-app', { timeout: 15_000 });
  await skipOnboarding(setupPage);

  const rootFolderId = await setupPage.evaluate(async () => {
    const f = await browser.bookmarks.create({ parentId: '2', title: "Flipp's Favorites" });
    return f.id;
  });

  // Dock lives as a sibling of rootFolderId — not visible in the bookmark grid
  const dockFolderId = await setupPage.evaluate(async () => {
    const f = await browser.bookmarks.create({ parentId: '2', title: '📌 Dock' });
    return f.id;
  });
  for (const bm of DOCK_BOOKMARKS) {
    await setupPage.evaluate(async ({ parentId, title, url }) => {
      await browser.bookmarks.create({ parentId, title, url });
    }, { parentId: dockFolderId, title: bm.title, url: bm.url });
  }

  const { folderIds } = await seedBookmarks(setupPage, rootFolderId);
  console.log('Bookmarks seeded. rootFolderId:', rootFolderId);

  // Three workspace records — each points at a different category folder so switching
  // workspaces shows visibly different content AND different accent colors.
  const workspaceDefs = [
    { id: 'ws-work',     name: 'Work',     rootFolderId,                                  accentColor: '#3F72DC' },
    { id: 'ws-personal', name: 'Personal', rootFolderId: folderIds['🍳 Cooking'],         accentColor: '#23867B' },
    { id: 'ws-creative', name: 'Creative', rootFolderId: folderIds['🎬 Entertainment'],   accentColor: '#7D60D8' },
  ];
  await seedWorkspaces(setupPage, workspaceDefs);
  console.log('Workspaces seeded:', workspaceDefs.map(w => w.name).join(', '));

  const baseSettings = {
    activeWorkspaceId: workspaceDefs[0].id,
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
  await recordWorkspaces(context, origin, baseSettings, workspaceDefs);
  await recordDragReorder(context, origin, baseSettings);
  await recordColorThemes(context, origin, baseSettings);
  await recordLayoutSettings(context, origin, baseSettings);

  await context.close();

  // Clean up leftover video files (setup page + any orphans not renamed)
  const { readdir, unlink } = await import('node:fs/promises');
  const remaining = await readdir(outDir);
  const keepFiles = ['01-search.webm', '02-edit-icon.webm', '03-workspaces.webm', '04-drag-reorder.webm', '05-color-themes.webm', '06-layout-settings.webm'];
  for (const f of remaining) {
    if (f.endsWith('.webm') && !keepFiles.includes(f)) {
      await unlink(join(outDir, f)).catch(() => undefined);
    }
  }

  await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);

  console.log('\n✅ All videos saved to:', outDir);
  console.log('\nConvert to GIF with ffmpeg:');
  console.log('  ffmpeg -i promo-videos/01-search.webm -vf "fps=24,scale=1280:-1:flags=lanczos" promo-videos/01-search.gif');
  console.log('  ffmpeg -i promo-videos/03-workspaces.webm -vf "fps=24,scale=1280:-1:flags=lanczos" promo-videos/03-workspaces.gif');
  console.log('  ffmpeg -i promo-videos/04-drag-reorder.webm -vf "fps=24,scale=1280:-1:flags=lanczos" promo-videos/04-drag-reorder.gif');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
