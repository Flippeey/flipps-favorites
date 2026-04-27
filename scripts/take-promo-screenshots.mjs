/**
 * Promo screenshot script for Flipp's Favorites Chrome Extension
 * Run from the project root: node scripts/take-promo-screenshots.mjs
 *
 * Captures 1280×800 screenshots suitable for the Chrome Web Store.
 * Requires: npm run build:chrome before running.
 */

import { chromium } from '@playwright/test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const chromeExtPath = join(rootDir, 'dist', 'chrome');
const outDir = join(rootDir, 'promo-screenshots');

const WIDTH = 1280;
const HEIGHT = 800;

// ─── Bookmark data ──────────────────────────────────────────────────────────

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

// Individual bookmarks added directly to the root folder alongside category folders.
// Together they fill the main dashboard with multiple rows of tiles.
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
      { title: 'SmartThings',   url: 'https://www.smartthings.com' },
      { title: 'Philips Hue',   url: 'https://www.philips-hue.com' },
      { title: 'IKEA Smart',    url: 'https://www.ikea.com/us/en/cat/smart-home-hs001/' },
      { title: 'iRobot',        url: 'https://www.irobot.com' },
      { title: 'Nest',          url: 'https://store.google.com/category/nest' },
      { title: 'Amazon Echo',   url: 'https://www.amazon.com/echo' },
      { title: 'Eve Systems',   url: 'https://www.evehome.com' },
    ],
  },
  {
    title: '🎬 Entertainment',
    bookmarks: [
      { title: 'Netflix',       url: 'https://www.netflix.com' },
      { title: 'YouTube',       url: 'https://www.youtube.com' },
      { title: 'Spotify',       url: 'https://open.spotify.com' },
      { title: 'Disney+',       url: 'https://www.disneyplus.com' },
      { title: 'Twitch',        url: 'https://www.twitch.tv' },
      { title: 'HBO Max',       url: 'https://www.max.com' },
      { title: 'IMDb',          url: 'https://www.imdb.com' },
      { title: 'Apple TV+',     url: 'https://tv.apple.com' },
    ],
  },
  {
    title: '🛍️ Shopping',
    bookmarks: [
      { title: 'Amazon',        url: 'https://www.amazon.com' },
      { title: 'Etsy',          url: 'https://www.etsy.com' },
      { title: 'eBay',          url: 'https://www.ebay.com' },
      { title: 'ASOS',          url: 'https://www.asos.com' },
      { title: 'Best Buy',      url: 'https://www.bestbuy.com' },
      { title: 'Wirecutter',    url: 'https://www.nytimes.com/wirecutter' },
    ],
  },
  {
    title: '📰 News',
    bookmarks: [
      { title: 'BBC News',      url: 'https://www.bbc.com/news' },
      { title: 'The Guardian',  url: 'https://www.theguardian.com' },
      { title: 'Reuters',       url: 'https://www.reuters.com' },
      { title: 'NPR',           url: 'https://www.npr.org' },
      { title: 'The Atlantic',  url: 'https://www.theatlantic.com' },
      { title: 'Wired',         url: 'https://www.wired.com' },
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
    // Read current settings from whichever area has them
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
    // Write to both areas so the extension finds it regardless of resolved area
    try { await browser.storage.sync.set({ 'app-settings': merged }); } catch {}
    await browser.storage.local.set({ 'app-settings': merged });
  }, patch);
}

async function reloadAndWait(page, extraMs = 3000) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.shell', { timeout: 15_000 });
  await page.waitForTimeout(extraMs);
}

// Full page navigation to a folder via URL hash — reliable across reloads
async function navigateToFolder(page, folderId, origin, extraMs = 3000) {
  await page.goto(`${origin}/newtab.html#${folderId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.shell', { timeout: 15_000 });
  await page.waitForTimeout(extraMs);
}

async function seedBookmarks(page, extFolderId) {
  // Dock folder (drives the dock bar)
  const dockFolderId = await page.evaluate(async ({ parentId }) => {
    const f = await browser.bookmarks.create({ parentId, title: '📌 Dock' });
    return f.id;
  }, { parentId: extFolderId });

  for (const bm of DOCK_BOOKMARKS) {
    await page.evaluate(async ({ parentId, title, url }) => {
      await browser.bookmarks.create({ parentId, title, url });
    }, { parentId: dockFolderId, title: bm.title, url: bm.url });
  }

  // Individual bookmarks added directly to the root folder so they fill the main grid
  for (const bm of ROOT_BOOKMARKS) {
    await page.evaluate(async ({ parentId, title, url }) => {
      await browser.bookmarks.create({ parentId, title, url });
    }, { parentId: extFolderId, title: bm.title, url: bm.url });
  }

  // Category subfolders
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

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  await mkdir(outDir, { recursive: true });
  console.log('Output dir:', outDir);

  const profileDir = await mkdtemp(join(tmpdir(), 'ff-promo-'));

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${chromeExtPath}`,
      `--load-extension=${chromeExtPath}`,
      '--no-first-run',
      '--disable-default-apps',
      '--window-size=1280,860',
    ],
    viewport: { width: WIDTH, height: HEIGHT },
  });

  // Discover extension origin
  const workers = context.serviceWorkers();
  const sw = workers.length > 0
    ? workers[0]
    : await context.waitForEvent('serviceworker', { timeout: 15_000 });
  const extId = new URL(sw.url()).hostname;
  const origin = `chrome-extension://${extId}`;
  console.log('Extension ID:', extId);

  // Open newtab page
  const page = await context.newPage();
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(`${origin}/newtab.html`);
  await page.waitForSelector('.shell', { timeout: 15_000 });

  // Bootstrap: skip onboarding
  await skipOnboarding(page);

  // Create root folder for promo content (direct child of Other Bookmarks)
  const rootFolderId = await page.evaluate(async () => {
    const f = await browser.bookmarks.create({ parentId: '2', title: "Flipp's Favorites" });
    return f.id;
  });

  const { dockFolderId, folderIds } = await seedBookmarks(page, rootFolderId);

  console.log('rootFolderId:', rootFolderId, '  dockFolderId:', dockFolderId);

  // Verify bookmarks were actually created
  const bookmarkCheck = await page.evaluate(async (id) => {
    const children = await browser.bookmarks.getChildren(id);
    return children.map(c => ({ id: c.id, title: c.title, url: c.url ?? null }));
  }, rootFolderId);
  console.log('Root folder children count:', bookmarkCheck.length, '  first few:', bookmarkCheck.slice(0, 3).map(b => b.title));

  // Common settings: root = the promo folder (has both individual bookmarks and subfolders)
  await applySettings(page, {
    rootFolderId,
    rememberLastFolder: false,
    showDock: true,
    dockFolderId,
    showClock: false,
    autoHideDock: false
  });

  // Verify storage was written
  const storageCheck = await page.evaluate(async () => {
    const sync = await browser.storage.sync.get('app-settings');
    const local = await browser.storage.local.get('app-settings');
    return { sync: sync['app-settings'], local: local['app-settings'] };
  });
  console.log('Storage after applySettings:');
  console.log('  sync rootFolderId:', storageCheck.sync?.rootFolderId);
  console.log('  local rootFolderId:', storageCheck.local?.rootFolderId);

  // ── Screenshot 1: Light, blue — main dashboard (many tiles) ─────────────
  console.log('Taking screenshot 1: light-main…');
  await applySettings(page, { themeMode: 'light', accentColor: '#3F72DC' });
  await reloadAndWait(page);

  // Post-reload diagnostics
  const postReload = await page.evaluate(async () => {
    const sync = await browser.storage.sync.get('app-settings');
    const local = await browser.storage.local.get(['app-settings', 'onboarding-state']);
    const rootId = sync['app-settings']?.rootFolderId;
    let children = [];
    try { children = await browser.bookmarks.getChildren(rootId); } catch(e) { children = [String(e)]; }
    const bodyText = document.body?.innerText?.slice(0, 300);
    return {
      syncRootId: sync['app-settings']?.rootFolderId,
      localRootId: local['app-settings']?.rootFolderId,
      onboardingStatus: local['onboarding-state']?.status,
      childCount: children.length,
      bodySnippet: bodyText,
    };
  });
  console.log('POST-RELOAD:', JSON.stringify(postReload));

  await page.screenshot({ path: join(outDir, '01-light-main.png') });
  console.log('  ✓ 01-light-main.png');

  // ── Screenshot 2: Light, blue — Tech folder ───────────────────────────────
  console.log('Taking screenshot 2: light-tech-folder…');
  await navigateToFolder(page, folderIds['💻 Tech'], origin);
  await page.screenshot({ path: join(outDir, '02-light-tech-folder.png') });
  console.log('  ✓ 02-light-tech-folder.png');

  // ── Screenshot 3: Dark, teal — main dashboard ─────────────────────────────
  console.log('Taking screenshot 3: dark-teal-main…');
  await applySettings(page, { themeMode: 'dark', accentColor: '#23867B', rememberLastFolder: false });
  await reloadAndWait(page);
  await page.screenshot({ path: join(outDir, '03-dark-teal-main.png') });
  console.log('  ✓ 03-dark-teal-main.png');

  // ── Screenshot 4: Dark, orange — Cooking folder ───────────────────────────
  console.log('Taking screenshot 4: dark-orange-cooking…');
  await applySettings(page, { accentColor: '#F57C00', rememberLastFolder: false });
  await navigateToFolder(page, folderIds['🍳 Cooking'], origin);
  await page.screenshot({ path: join(outDir, '04-dark-orange-cooking.png') });
  console.log('  ✓ 04-dark-orange-cooking.png');

  // ── Screenshot 5: Light — search in action ────────────────────────────────
  console.log('Taking screenshot 5: light-search…');
  await applySettings(page, { themeMode: 'light', accentColor: '#3F72DC', rememberLastFolder: false });
  await reloadAndWait(page);
  const searchInput = page.locator('input[type="search"], input[placeholder*="search" i], .search-input, [role="search"] input').first();
  await searchInput.click();
  // "n" matches Notion, Netflix, Hacker News, NPR, Pinterest, Duolingo, etc.
  await searchInput.pressSequentially('n', { delay: 80 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(outDir, '05-light-search.png') });
  console.log('  ✓ 05-light-search.png');

  // ── Screenshot 6: Dark, purple — Smart Home folder ────────────────────────
  console.log('Taking screenshot 6: dark-purple-smarthome…');
  await applySettings(page, { themeMode: 'dark', accentColor: '#7D60D8', rememberLastFolder: false });
  await navigateToFolder(page, folderIds['🏠 Smart Home'], origin);
  await page.screenshot({ path: join(outDir, '06-dark-purple-smarthome.png') });
  console.log('  ✓ 06-dark-purple-smarthome.png');

  console.log('\n✅ All screenshots saved to:', outDir);
  await context.close();
  await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
