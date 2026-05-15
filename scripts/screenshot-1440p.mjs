/**
 * Captures a 1440p screenshot of the newtab page with bookmarks and dock visible.
 * Run with: node scripts/screenshot-1440p.mjs
 * Requires: npm run build:chrome first
 */
import { chromium } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync } from 'node:fs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chromeExtPath = join(rootDir, 'dist', 'chrome');
const screenshotsDir = join(rootDir, 'screenshots');
const outPath = join(screenshotsDir, 'bookmarks-with-dock-1440p.png');

if (!existsSync(join(chromeExtPath, 'manifest.json'))) {
  console.error('Chrome build not found. Run: npm run build:chrome');
  process.exit(1);
}

if (!existsSync(screenshotsDir)) {
  mkdirSync(screenshotsDir, { recursive: true });
}

const profileDir = await mkdtemp(join(tmpdir(), 'cr-screenshot-'));

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  args: [
    `--disable-extensions-except=${chromeExtPath}`,
    `--load-extension=${chromeExtPath}`,
    '--no-first-run',
    '--disable-default-apps',
  ],
});

try {
  // Discover extension ID from service worker.
  const workers = context.serviceWorkers();
  const sw = workers.length > 0
    ? workers[0]
    : await context.waitForEvent('serviceworker', { timeout: 15_000 });
  const extId = new URL(sw.url()).hostname;
  const origin = `chrome-extension://${extId}`;

  // First load: use extension context to write storage and create bookmarks.
  const page = await context.newPage();
  await page.goto(`${origin}/newtab.html`);
  await page.waitForSelector('.shell', { timeout: 15_000 });

  // Create the bookmark tree and get folder IDs.
  const { rootId, dockId } = await page.evaluate(async () => {
    // Dock folder lives outside root so it doesn't appear in the grid.
    const dock = await browser.bookmarks.create({ title: 'Quick Access' });
    await browser.bookmarks.create({ parentId: dock.id, title: 'Gmail', url: 'https://mail.google.com' });
    await browser.bookmarks.create({ parentId: dock.id, title: 'YouTube', url: 'https://www.youtube.com' });
    await browser.bookmarks.create({ parentId: dock.id, title: 'Spotify', url: 'https://open.spotify.com' });
    await browser.bookmarks.create({ parentId: dock.id, title: 'Netflix', url: 'https://www.netflix.com' });

    // Folders in the dock with bookmarks inside so they show a preview.
    const shoppingFolder = await browser.bookmarks.create({ parentId: dock.id, title: 'Shopping' });
    await browser.bookmarks.create({ parentId: shoppingFolder.id, title: 'Amazon', url: 'https://www.amazon.com' });
    await browser.bookmarks.create({ parentId: shoppingFolder.id, title: 'eBay', url: 'https://www.ebay.com' });
    await browser.bookmarks.create({ parentId: shoppingFolder.id, title: 'Etsy', url: 'https://www.etsy.com' });
    await browser.bookmarks.create({ parentId: shoppingFolder.id, title: 'ASOS', url: 'https://www.asos.com' });

    const travelFolder = await browser.bookmarks.create({ parentId: dock.id, title: 'Travel' });
    await browser.bookmarks.create({ parentId: travelFolder.id, title: 'Airbnb', url: 'https://www.airbnb.com' });
    await browser.bookmarks.create({ parentId: travelFolder.id, title: 'Tripadvisor', url: 'https://www.tripadvisor.com' });
    await browser.bookmarks.create({ parentId: travelFolder.id, title: 'Google Flights', url: 'https://www.google.com/travel/flights' });
    await browser.bookmarks.create({ parentId: travelFolder.id, title: 'Booking.com', url: 'https://www.booking.com' });

    const entFolder = await browser.bookmarks.create({ parentId: dock.id, title: 'Entertainment' });
    await browser.bookmarks.create({ parentId: entFolder.id, title: 'Netflix', url: 'https://www.netflix.com' });
    await browser.bookmarks.create({ parentId: entFolder.id, title: 'Disney+', url: 'https://www.disneyplus.com' });
    await browser.bookmarks.create({ parentId: entFolder.id, title: 'Twitch', url: 'https://www.twitch.tv' });
    await browser.bookmarks.create({ parentId: entFolder.id, title: 'Reddit', url: 'https://www.reddit.com' });

    const root = await browser.bookmarks.create({ title: 'My Bookmarks' });

    // Main grid — sites with reliable favicons.
    await browser.bookmarks.create({ parentId: root.id, title: 'Netflix', url: 'https://www.netflix.com' });
    await browser.bookmarks.create({ parentId: root.id, title: 'Amazon', url: 'https://www.amazon.com' });
    await browser.bookmarks.create({ parentId: root.id, title: 'Instagram', url: 'https://www.instagram.com' });
    await browser.bookmarks.create({ parentId: root.id, title: 'Reddit', url: 'https://www.reddit.com' });
    await browser.bookmarks.create({ parentId: root.id, title: 'Pinterest', url: 'https://www.pinterest.com' });
    await browser.bookmarks.create({ parentId: root.id, title: 'Airbnb', url: 'https://www.airbnb.com' });
    await browser.bookmarks.create({ parentId: root.id, title: 'LinkedIn', url: 'https://www.linkedin.com' });
    await browser.bookmarks.create({ parentId: root.id, title: 'CNN', url: 'https://www.cnn.com' });
    await browser.bookmarks.create({ parentId: root.id, title: 'Wikipedia', url: 'https://www.wikipedia.org' });
    await browser.bookmarks.create({ parentId: root.id, title: 'Etsy', url: 'https://www.etsy.com' });
    await browser.bookmarks.create({ parentId: root.id, title: 'Disney+', url: 'https://www.disneyplus.com' });
    await browser.bookmarks.create({ parentId: root.id, title: 'Duolingo', url: 'https://www.duolingo.com' });
    await browser.bookmarks.create({ parentId: root.id, title: 'Tripadvisor', url: 'https://www.tripadvisor.com' });
    await browser.bookmarks.create({ parentId: root.id, title: 'PayPal', url: 'https://www.paypal.com' });
    await browser.bookmarks.create({ parentId: root.id, title: 'Google Drive', url: 'https://drive.google.com' });
    await browser.bookmarks.create({ parentId: root.id, title: 'Snapchat', url: 'https://www.snapchat.com' });
    await browser.bookmarks.create({ parentId: root.id, title: 'Facebook', url: 'https://www.facebook.com' });
    await browser.bookmarks.create({ parentId: root.id, title: 'Google Calendar', url: 'https://calendar.google.com' });
    await browser.bookmarks.create({ parentId: root.id, title: 'WhatsApp', url: 'https://web.whatsapp.com' });
    await browser.bookmarks.create({ parentId: root.id, title: 'X', url: 'https://x.com' });
    await browser.bookmarks.create({ parentId: root.id, title: 'Google Maps', url: 'https://www.google.com/maps' });
    await browser.bookmarks.create({ parentId: root.id, title: 'Spotify', url: 'https://open.spotify.com' });
    await browser.bookmarks.create({ parentId: root.id, title: 'YouTube', url: 'https://www.youtube.com' });

    return { rootId: root.id, dockId: dock.id };
  });

  console.log(`Root folder: ${rootId}, Dock folder: ${dockId}`);

  // Write settings and onboarding directly to storage — bypasses the
  // settings/patch message to avoid any service-worker timing race.
  await page.evaluate(async ({ rootFolderId, dockFolderId }) => {
    const settings = {
      themeMode: 'dark',
      accentColor: '#3f72dc',
      customBackgroundImage: '',
      backgroundOpacity: 70,
      backgroundFitMode: 'cover',
      backgroundPositionMode: 'center',
      settingsSection: 'general',
      rootFolderId,
      rememberLastFolder: false,
      openLinksInNewTab: false,
      showDock: true,
      autoHideDock: false,
      dockFolderId,
      bookmarkSortMode: 'manual',
      bookmarkSortDirection: 'asc',
      searchScope: 'library',
      favoritesColumns: 10,
      favoritesRows: 0,
      favoritesColumnGap: 24,
      favoritesRowGap: 20,
      bookmarkTileWidth: 130,
      bookmarkIconSize: 75,
      showBookmarkIconBackground: false,
      showAccentBackground: true,
      layoutPreset: 'balanced',
      showClock: false,
      clockStyle: 'standard',
      clockPosition: 'bottom-right',
      clockSize: 'medium',
      clockHourFormat: '24',
      showSearchBar: false,
      searchBarPosition: 'center',
    };

    const onboarding = {
      version: 1,
      status: 'completed',
      updatedAt: Date.now(),
      completedAt: Date.now(),
      skippedAt: null,
    };

    // Write onboarding to local (that's where the store reads it from).
    await browser.storage.local.set({ 'onboarding-state': onboarding });

    // Write settings to both areas — app reads sync-preferred so whichever
    // area the store resolves to, the value is already there.
    await browser.storage.local.set({ 'app-settings': settings });
    try {
      await browser.storage.sync.set({ 'app-settings': settings });
    } catch (_) {
      // Sync quota exceeded or unavailable — local fallback is already set above.
    }
  }, { rootFolderId: rootId, dockFolderId: dockId });

  // Navigate fresh so the app boots with the storage values already in place.
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.goto(`${origin}/newtab.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.shell', { timeout: 15_000 });

  // Give icons a moment to resolve before capturing.
  await page.waitForTimeout(5_000);

  await page.screenshot({ path: outPath, fullPage: false });
  console.log(`Screenshot saved: ${outPath}`);
} finally {
  await context.close();
  await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
}
