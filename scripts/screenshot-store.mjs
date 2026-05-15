/**
 * Generates 5 store listing screenshots at 1280x800 for the Chrome Web Store.
 * Run with: node scripts/screenshot-store.mjs
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

if (!existsSync(join(chromeExtPath, 'manifest.json'))) {
  console.error('Chrome build not found. Run: npm run build:chrome');
  process.exit(1);
}

if (!existsSync(screenshotsDir)) mkdirSync(screenshotsDir, { recursive: true });

const VIEWPORT = { width: 1280, height: 800 };
const ICON_SETTLE_MS = 5_000;

const profileDir = await mkdtemp(join(tmpdir(), 'cr-store-'));

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  args: [
    `--disable-extensions-except=${chromeExtPath}`,
    `--load-extension=${chromeExtPath}`,
    '--no-first-run',
    '--disable-default-apps',
  ],
});

function baseSettings(overrides = {}) {
  return {
    themeMode: 'dark',
    accentColor: '#3f72dc',
    customBackgroundImage: '',
    backgroundOpacity: 70,
    backgroundFitMode: 'cover',
    backgroundPositionMode: 'center',
    settingsSection: 'appearance',
    rootFolderId: '',
    rememberLastFolder: false,
    openLinksInNewTab: false,
    showDock: false,
    autoHideDock: false,
    dockFolderId: '',
    bookmarkSortMode: 'manual',
    bookmarkSortDirection: 'asc',
    searchScope: 'library',
    favoritesColumns: 8,
    favoritesRows: 0,
    favoritesColumnGap: 20,
    favoritesRowGap: 16,
    bookmarkTileWidth: 120,
    bookmarkIconSize: 70,
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
    ...overrides,
  };
}

try {
  // Discover extension ID from service worker.
  const workers = context.serviceWorkers();
  const sw = workers.length > 0
    ? workers[0]
    : await context.waitForEvent('serviceworker', { timeout: 15_000 });
  const extId = new URL(sw.url()).hostname;
  const origin = `chrome-extension://${extId}`;

  // Boot once to create the shared bookmark tree.
  const setupPage = await context.newPage();
  await setupPage.setViewportSize(VIEWPORT);
  await setupPage.goto(`${origin}/newtab.html`);
  await setupPage.waitForSelector('.shell', { timeout: 15_000 });

  const ids = await setupPage.evaluate(async () => {
    // Grid root — flat list of recognizable sites (shots 1, 2, 4).
    const gridRoot = await browser.bookmarks.create({ title: 'My Bookmarks' });
    for (const bm of [
      { title: 'YouTube',         url: 'https://www.youtube.com' },
      { title: 'Netflix',         url: 'https://www.netflix.com' },
      { title: 'Spotify',         url: 'https://open.spotify.com' },
      { title: 'Instagram',       url: 'https://www.instagram.com' },
      { title: 'Reddit',          url: 'https://www.reddit.com' },
      { title: 'Twitter / X',     url: 'https://x.com' },
      { title: 'LinkedIn',        url: 'https://www.linkedin.com' },
      { title: 'Amazon',          url: 'https://www.amazon.com' },
      { title: 'Google Drive',    url: 'https://drive.google.com' },
      { title: 'Gmail',           url: 'https://mail.google.com' },
      { title: 'Google Calendar', url: 'https://calendar.google.com' },
      { title: 'GitHub',          url: 'https://github.com' },
      { title: 'Pinterest',       url: 'https://www.pinterest.com' },
      { title: 'Wikipedia',       url: 'https://www.wikipedia.org' },
      { title: 'Twitch',          url: 'https://www.twitch.tv' },
      { title: 'Discord',         url: 'https://discord.com' },
      { title: 'Notion',          url: 'https://www.notion.so' },
      { title: 'Figma',           url: 'https://www.figma.com' },
      { title: 'Airbnb',          url: 'https://www.airbnb.com' },
      { title: 'PayPal',          url: 'https://www.paypal.com' },
      { title: 'Duolingo',        url: 'https://www.duolingo.com' },
      { title: 'WhatsApp',        url: 'https://web.whatsapp.com' },
      { title: 'Etsy',            url: 'https://www.etsy.com' },
      { title: 'Tripadvisor',     url: 'https://www.tripadvisor.com' },
    ]) {
      await browser.bookmarks.create({ parentId: gridRoot.id, ...bm });
    }

    // Dock root (shot 1).
    const dockRoot = await browser.bookmarks.create({ title: 'Quick Access' });
    for (const bm of [
      { title: 'Gmail',   url: 'https://mail.google.com' },
      { title: 'YouTube', url: 'https://www.youtube.com' },
      { title: 'Spotify', url: 'https://open.spotify.com' },
      { title: 'Discord', url: 'https://discord.com' },
      { title: 'GitHub',  url: 'https://github.com' },
    ]) {
      await browser.bookmarks.create({ parentId: dockRoot.id, ...bm });
    }

    // Mixed root — bookmarks + folders side by side (shot 3: drag into folder).
    const mixedRoot = await browser.bookmarks.create({ title: 'My Bookmarks' });
    const entertainmentFolder = await browser.bookmarks.create({ parentId: mixedRoot.id, title: 'Entertainment' });
    await browser.bookmarks.create({ parentId: entertainmentFolder.id, title: 'Netflix',  url: 'https://www.netflix.com' });
    await browser.bookmarks.create({ parentId: entertainmentFolder.id, title: 'YouTube',  url: 'https://www.youtube.com' });
    await browser.bookmarks.create({ parentId: entertainmentFolder.id, title: 'Twitch',   url: 'https://www.twitch.tv' });
    await browser.bookmarks.create({ parentId: entertainmentFolder.id, title: 'Spotify',  url: 'https://open.spotify.com' });
    const workFolder = await browser.bookmarks.create({ parentId: mixedRoot.id, title: 'Work' });
    await browser.bookmarks.create({ parentId: workFolder.id, title: 'GitHub',       url: 'https://github.com' });
    await browser.bookmarks.create({ parentId: workFolder.id, title: 'Notion',       url: 'https://www.notion.so' });
    await browser.bookmarks.create({ parentId: workFolder.id, title: 'Figma',        url: 'https://www.figma.com' });
    await browser.bookmarks.create({ parentId: workFolder.id, title: 'Google Drive', url: 'https://drive.google.com' });
    for (const bm of [
      { title: 'YouTube',      url: 'https://www.youtube.com' },
      { title: 'Netflix',      url: 'https://www.netflix.com' },
      { title: 'Spotify',      url: 'https://open.spotify.com' },
      { title: 'Instagram',    url: 'https://www.instagram.com' },
      { title: 'Reddit',       url: 'https://www.reddit.com' },
      { title: 'Twitter / X',  url: 'https://x.com' },
      { title: 'LinkedIn',     url: 'https://www.linkedin.com' },
      { title: 'Amazon',       url: 'https://www.amazon.com' },
      { title: 'Google Drive', url: 'https://drive.google.com' },
      { title: 'Gmail',        url: 'https://mail.google.com' },
      { title: 'GitHub',       url: 'https://github.com' },
      { title: 'Discord',      url: 'https://discord.com' },
      { title: 'Twitch',       url: 'https://www.twitch.tv' },
      { title: 'Notion',       url: 'https://www.notion.so' },
    ]) {
      await browser.bookmarks.create({ parentId: mixedRoot.id, ...bm });
    }

    return {
      gridRootId:   gridRoot.id,
      dockRootId:   dockRoot.id,
      mixedRootId:  mixedRoot.id,
      workFolderId: workFolder.id,
    };
  });

  await setupPage.close();

  // Opens a fresh newtab page with settings pre-written, waits for icons.
  async function loadScene(settings) {
    const page = await context.newPage();
    await page.setViewportSize(VIEWPORT);
    await page.goto(`${origin}/newtab.html`);
    await page.waitForSelector('.shell', { timeout: 15_000 });
    await page.evaluate(async (s) => {
      await browser.storage.local.set({
        'onboarding-state': {
          version: 1, status: 'completed',
          updatedAt: Date.now(), completedAt: Date.now(), skippedAt: null,
        },
        'app-settings': s,
      });
      try { await browser.storage.sync.set({ 'app-settings': s }); } catch (_) {}
    }, settings);
    await page.goto(`${origin}/newtab.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.shell', { timeout: 15_000 });
    await page.waitForTimeout(ICON_SETTLE_MS);
    return page;
  }

  async function capture(name, page) {
    const outPath = join(screenshotsDir, name);
    await page.screenshot({ path: outPath, fullPage: false });
    console.log(`  ✓ ${name}`);
    await page.close();
  }

  // ── Shot 1: Hero dark — full grid + dock ────────────────────────────────────
  console.log('Shot 1: Hero dark + dock...');
  {
    const page = await loadScene(baseSettings({
      themeMode: 'dark',
      accentColor: '#3f72dc',
      rootFolderId: ids.gridRootId,
      showDock: true,
      dockFolderId: ids.dockRootId,
    }));
    await capture('store-01-hero-dark.png', page);
  }

  // ── Shot 2: Edit bookmark dialog ────────────────────────────────────────────
  console.log('Shot 2: Edit bookmark dialog...');
  {
    const page = await loadScene(baseSettings({
      themeMode: 'dark',
      accentColor: '#3f72dc',
      rootFolderId: ids.gridRootId,
    }));
    // Right-click the GitHub tile to open the context menu.
    const githubTile = page.locator('button[data-grid-item-kind="bookmark"]', { hasText: 'GitHub' });
    await githubTile.click({ button: 'right' });
    await page.waitForSelector('.bookmark-context-menu', { timeout: 5_000 });
    // Click the Edit action in the context menu.
    await page.click('[data-context-action="edit"]');
    await page.waitForSelector('.bookmark-dialog', { timeout: 5_000 });
    await page.waitForTimeout(2_000); // wait for icon to resolve in dialog
    await capture('store-02-edit-dialog.png', page);
  }

  // ── Shot 3: Drag multi-select into folder ────────────────────────────────────
  console.log('Shot 3: Drag into folder...');
  {
    const page = await loadScene(baseSettings({
      themeMode: 'dark',
      accentColor: '#f59e0b',
      rootFolderId: ids.mixedRootId,
    }));
    // Fake the drag state via DOM — all drag visuals are CSS-attribute-driven.
    await page.evaluate((targetFolderId) => {
      const shell = document.querySelector('.shell');
      const tiles = Array.from(document.querySelectorAll('button[data-grid-item-kind="bookmark"]'));
      const folder = document.querySelector(`button[data-folder-id="${targetFolderId}"]`);

      if (!shell || tiles.length < 3 || !folder) return;

      // Activate drag mode on shell.
      shell.dataset.dragActive = 'true';
      shell.dataset.dragSurface = 'grid';

      // Mark 3 bookmark tiles as selected + drag sources.
      const dragTiles = tiles.slice(0, 3);
      dragTiles.forEach((tile, i) => {
        tile.setAttribute('data-drag-source', 'true');
        tile.setAttribute('data-selected', 'true');
        if (i === 0) {
          tile.setAttribute('data-drag-lead', 'true');
          tile.dataset.dragCount = '3';
        }
      });

      // Highlight the target folder as the drop destination.
      folder.setAttribute('data-drop-position', 'inside');
    }, ids.workFolderId);
    await page.waitForTimeout(200);
    await capture('store-03-drag-into-folder.png', page);
  }

  // ── Shot 4: Search in action ─────────────────────────────────────────────────
  console.log('Shot 4: Search...');
  {
    const page = await loadScene(baseSettings({
      themeMode: 'dark',
      accentColor: '#ec4899',
      rootFolderId: ids.gridRootId,
      showSearchBar: true,
      searchBarPosition: 'center',
    }));
    await page.click('.surface-search--hero input');
    await page.type('.surface-search--hero input', 'goo', { delay: 80 });
    await page.waitForTimeout(800);
    await capture('store-04-search.png', page);
  }

  // ── Shot 5: Settings drawer open on appearance ───────────────────────────────
  console.log('Shot 5: Settings drawer...');
  {
    const page = await loadScene(baseSettings({
      themeMode: 'dark',
      accentColor: '#a855f7',
      rootFolderId: ids.gridRootId,
      settingsSection: 'appearance',
    }));
    await page.click('.drawer-toggle');
    await page.waitForSelector('.settings-drawer[data-open="true"]', { timeout: 5_000 });
    await page.waitForTimeout(600);
    await capture('store-05-settings.png', page);
  }

  console.log('\nDone. 5 screenshots saved to screenshots/');

} finally {
  await context.close();
  await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
}
