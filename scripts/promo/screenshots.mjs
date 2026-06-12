/**
 * Promo screenshot pipeline — dual-mode (light + dark) at 1280x800 and 1920x1080.
 *
 *   node scripts/promo/screenshots.mjs
 *
 * Requires: `npm run build:chrome` first, then `npm run build:chrome` will place output at dist/chrome.
 *
 * Output:
 *   promo/screenshots/light/  — 12 scenes × 2 resolutions = 24 PNGs
 *   promo/screenshots/dark/   — 12 scenes × 2 resolutions = 24 PNGs
 *
 * The active workspace's themeMode is patched to 'light' or 'dark' for each
 * capture pass. Creative workspace (already light) is handled specially.
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  SHOT_DIR,
  VIEWPORT,
  clearAllBookmarks,
  discoverOrigin,
  launchContext,
  openNewtab,
  patchSettings,
  patchWorkspace,
  reloadNewtab,
  seedPromoWorkspaces,
  skipOnboarding,
  sleep,
  smoothMove,
} from './lib.mjs';

const RESOLUTIONS = [
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
];

// ─── Core capture helper ─────────────────────────────────────────────────────

async function capture(page, theme, name, resolution) {
  const dir = join(SHOT_DIR, theme);
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${name}-${resolution.width}x${resolution.height}.png`);
  await page.setViewportSize(resolution);
  await page.waitForTimeout(300);
  await page.screenshot({ path: file });
  console.log(`  ✓ ${theme}/${name}-${resolution.width}x${resolution.height}.png`);
}

/**
 * Capture a scene in both light and dark mode at all resolutions.
 * setupFn(page, theme) is called after theme is applied and before capture.
 */
async function captureScene(page, name, workspaceId, setupFn) {
  for (const theme of ['light', 'dark']) {
    // themeMode is read from the workspace record at load time, so a live patch
    // alone doesn't restyle the page — reload to actually apply the theme.
    await patchWorkspace(page, workspaceId, { themeMode: theme });
    await reloadNewtab(page, 1000);
    if (setupFn) await setupFn(page, theme);
    for (const res of RESOLUTIONS) {
      await capture(page, theme, name, res);
    }
    // Close any open UI between passes.
    // Onboarding modal doesn't close on Escape — click Skip if present.
    const onboardSkip = page.locator('.ff-onboard button:has-text("Skip")').first();
    if (await onboardSkip.count() > 0) {
      await onboardSkip.click();
      await page.waitForSelector('.ff-modal-scrim', { state: 'detached', timeout: 2000 }).catch(() => {});
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
}

// ─── Scene definitions ───────────────────────────────────────────────────────

async function scene01_hero(page, workspaceIds) {
  console.log('\n── Scene 01: hero');
  await patchSettings(page, { activeWorkspaceId: workspaceIds.Work });
  await reloadNewtab(page, 2000);
  await captureScene(page, '01-hero', workspaceIds.Work);
}

async function scene02_workspaces(page, workspaceIds) {
  console.log('\n── Scene 02: workspaces');
  await patchSettings(page, { activeWorkspaceId: workspaceIds.Work });
  await reloadNewtab(page, 1500);
  await captureScene(page, '02-workspaces', workspaceIds.Work);
}

async function scene03_folderOpen(page, workspaceIds) {
  console.log('\n── Scene 03: folder-open');
  await patchSettings(page, { activeWorkspaceId: workspaceIds.Personal, folderOpenMode: 'overlay' });
  await reloadNewtab(page, 1500);
  await captureScene(page, '03-folder-open', workspaceIds.Personal, async (p) => {
    // Open the "Travel" folder overlay (a real folder in the Personal workspace).
    const folderTile = p.locator('.ff-tile[data-item-kind="folder"]:has-text("Travel")').first();
    if (await folderTile.count() > 0) {
      await folderTile.click();
      await p.waitForSelector('.ff-folder-overlay', { timeout: 4000 }).catch(() => undefined);
      await p.waitForTimeout(500); // let overlay + icons settle
    }
  });
  // Ensure overlay closed after both passes
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

async function scene04_searchResults(page, workspaceIds) {
  console.log('\n── Scene 04: search-results');
  await patchSettings(page, { activeWorkspaceId: workspaceIds.Work });
  await reloadNewtab(page, 1500);
  await captureScene(page, '04-search-results', workspaceIds.Work, async (p) => {
    const searchInput = p.locator('.ff-search__input, .ff-search input').first();
    if (await searchInput.count() > 0) {
      await searchInput.click();
      await p.waitForTimeout(200);
      await searchInput.fill('spotify');
      await p.waitForTimeout(500);
    }
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

async function scene05_settingsAppearance(page, workspaceIds) {
  console.log('\n── Scene 05: settings-appearance');
  await patchSettings(page, { activeWorkspaceId: workspaceIds.Personal });
  await reloadNewtab(page, 1500);
  await captureScene(page, '05-settings-appearance', workspaceIds.Personal, async (p) => {
    const customizeBtn = p.locator('[aria-label="Customize workspace"]').first();
    if (await customizeBtn.count() > 0) {
      await customizeBtn.click();
      await p.waitForSelector('.ff-drawer', { timeout: 3000 });
      await p.waitForTimeout(400);
    }
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

async function scene06_settingsLayout(page, workspaceIds) {
  console.log('\n── Scene 06: settings-layout');
  await patchSettings(page, { activeWorkspaceId: workspaceIds.Work });
  await reloadNewtab(page, 1500);
  await captureScene(page, '06-settings-layout', workspaceIds.Work, async (p) => {
    const customizeBtn = p.locator('[aria-label="Customize workspace"]').first();
    if (await customizeBtn.count() > 0) {
      await customizeBtn.click();
      await p.waitForSelector('.ff-drawer', { timeout: 3000 });
      // Navigate to Layout section
      const layoutNav = p.locator('.ff-drawer__navitem:has-text("Layout")').first();
      if (await layoutNav.count() > 0) {
        await layoutNav.click();
        await p.waitForTimeout(300);
      }
    }
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

async function scene07_contextMenu(page, workspaceIds) {
  console.log('\n── Scene 07: context-menu');
  await patchSettings(page, { activeWorkspaceId: workspaceIds.Work });
  await reloadNewtab(page, 1500);
  await captureScene(page, '07-context-menu', workspaceIds.Work, async (p) => {
    // Right-click the first bookmark tile
    const tile = p.locator('.ff-tile[data-item-kind="bookmark"]').first();
    if (await tile.count() > 0) {
      await tile.click({ button: 'right' });
      await p.waitForSelector('.ff-ctx', { timeout: 2000 });
      await p.waitForTimeout(200);
    }
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

async function scene08_gradientAurora(page, workspaceIds) {
  console.log('\n── Scene 08: gradient-aurora');
  await patchSettings(page, { activeWorkspaceId: workspaceIds.Personal });
  await reloadNewtab(page, 1500);
  await captureScene(page, '08-gradient-aurora', workspaceIds.Personal);
}

async function scene09_gradientMesh(page, workspaceIds) {
  console.log('\n── Scene 09: gradient-mesh');
  await patchSettings(page, { activeWorkspaceId: workspaceIds.Personal });
  await reloadNewtab(page, 1000);
  // Apply mesh gradient + purple accent override for this scene
  await patchWorkspace(page, workspaceIds.Personal, { gradientStyle: 'mesh', accentColor: '#9333EA' });
  await page.waitForTimeout(500);
  await captureScene(page, '09-gradient-mesh', workspaceIds.Personal);
  // Restore Personal workspace settings
  await patchWorkspace(page, workspaceIds.Personal, { gradientStyle: 'aurora', accentColor: '#23867B' });
}

async function scene10_creativeWallpaper(page, workspaceIds) {
  console.log('\n── Scene 10: creative-wallpaper');
  await patchSettings(page, { activeWorkspaceId: workspaceIds.Creative });
  await reloadNewtab(page, 1500);
  // Creative is natively light — capture light first, then dark override
  for (const theme of ['light', 'dark']) {
    await patchWorkspace(page, workspaceIds.Creative, { themeMode: theme });
    await page.waitForTimeout(400);
    for (const res of RESOLUTIONS) {
      await capture(page, theme, '10-creative-wallpaper', res);
    }
  }
  // Restore Creative to light
  await patchWorkspace(page, workspaceIds.Creative, { themeMode: 'light' });
}

async function scene11_onboardingWelcome(page, workspaceIds) {
  console.log('\n── Scene 11: onboarding-welcome');
  await patchSettings(page, { activeWorkspaceId: workspaceIds.Work });
  await reloadNewtab(page, 1000);
  await captureScene(page, '11-onboarding-welcome', workspaceIds.Work, async (p) => {
    // Open onboarding via replay button if available, or trigger via storage
    const replayBtn = p.locator('.ff-onboarding-replay, [aria-label*="nboarding"]').first();
    if (await replayBtn.count() > 0) {
      await replayBtn.click();
      await p.waitForSelector('.ff-onboard', { timeout: 3000 });
      await p.waitForTimeout(400);
    }
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

async function scene12_onboardingWorkspaces(page, workspaceIds) {
  console.log('\n── Scene 12: onboarding-workspaces');
  await patchSettings(page, { activeWorkspaceId: workspaceIds.Work });
  await reloadNewtab(page, 1000);
  await captureScene(page, '12-onboarding-workspaces', workspaceIds.Work, async (p) => {
    const replayBtn = p.locator('.ff-onboarding-replay, [aria-label*="nboarding"]').first();
    if (await replayBtn.count() > 0) {
      await replayBtn.click();
      await p.waitForSelector('.ff-onboard', { timeout: 3000 });
      // Navigate to workspace step (step index 1 — one Next click from welcome)
      for (let i = 0; i < 1; i++) {
        const nextBtn = p.locator('.ff-onboard .ff-btn:has-text("Next")').first();
        if (await nextBtn.count() > 0) {
          await nextBtn.click();
          await p.waitForTimeout(400);
        }
      }
      // Select "Multiple workspaces"
      const multiWs = p.locator('.ff-card:has-text("Multiple workspaces")').first();
      if (await multiWs.count() > 0) {
        await multiWs.click();
        await p.waitForTimeout(400);
      }
    }
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

async function scene13_listHero(page, workspaceIds) {
  console.log('\n── Scene 13: list-hero');
  await patchSettings(page, { activeWorkspaceId: workspaceIds.Personal });
  await patchWorkspace(page, workspaceIds.Personal, { folderMode: 'list' });
  await reloadNewtab(page, 1500);
  await captureScene(page, '13-list-hero', workspaceIds.Personal);
  await patchWorkspace(page, workspaceIds.Personal, { folderMode: 'grid' });
}

async function scene14_listGaming(page, workspaceIds) {
  console.log('\n── Scene 14: list-gaming');
  // Gaming has few root bookmarks but many small folders — best showcase of
  // list view's grouped sections.
  await patchSettings(page, { activeWorkspaceId: workspaceIds.Gaming });
  await patchWorkspace(page, workspaceIds.Gaming, { folderMode: 'list' });
  await reloadNewtab(page, 1500);
  await captureScene(page, '14-list-gaming', workspaceIds.Gaming);
  await patchWorkspace(page, workspaceIds.Gaming, { folderMode: 'grid' });
}

async function scene15_listDesign(page, workspaceIds) {
  console.log('\n── Scene 15: list-design (light theme)');
  await patchSettings(page, { activeWorkspaceId: workspaceIds.Design });
  await patchWorkspace(page, workspaceIds.Design, { folderMode: 'list' });
  await reloadNewtab(page, 1500);
  await captureScene(page, '15-list-design', workspaceIds.Design);
  await patchWorkspace(page, workspaceIds.Design, { folderMode: 'grid' });
}

async function scene16_iconPicker(page, workspaceIds) {
  console.log('\n── Scene 16: icon-picker');
  await patchSettings(page, { activeWorkspaceId: workspaceIds.Work });
  await reloadNewtab(page, 1500);
  await captureScene(page, '16-icon-picker', workspaceIds.Work, async (p) => {
    // Right-click the first bookmark → Edit → icon search auto-runs for an
    // existing bookmark, so the result grid populates on its own.
    const tile = p.locator('.ff-tile[data-item-kind="bookmark"]').first();
    if (await tile.count() > 0) {
      await tile.click({ button: 'right' });
      await p.waitForSelector('.ff-ctx', { timeout: 2000 });
      const editItem = p.locator('.ff-ctx__item:has-text("Edit"), .ff-ctx [role="menuitem"]:has-text("Edit")').first();
      if (await editItem.count() > 0) {
        await editItem.click();
        await p.waitForSelector('.ff-dialog', { timeout: 3000 });
        // Wait for at least one validated (visible) icon result to render.
        await p.waitForSelector('.ff-icongrid__cell', { state: 'visible', timeout: 8000 }).catch(() => {});
        await p.waitForTimeout(2200); // let more previews validate + settle
      }
    }
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

// ─── Scene registry ────────────────────────────────────────────────────────────

const SCENES = [
  ['01-hero', scene01_hero],
  ['02-workspaces', scene02_workspaces],
  ['03-folder-open', scene03_folderOpen],
  ['04-search-results', scene04_searchResults],
  ['05-settings-appearance', scene05_settingsAppearance],
  ['06-settings-layout', scene06_settingsLayout],
  ['07-context-menu', scene07_contextMenu],
  ['08-gradient-aurora', scene08_gradientAurora],
  ['09-gradient-mesh', scene09_gradientMesh],
  ['10-creative-wallpaper', scene10_creativeWallpaper],
  ['11-onboarding-welcome', scene11_onboardingWelcome],
  ['12-onboarding-workspaces', scene12_onboardingWorkspaces],
  ['13-list-hero', scene13_listHero],
  ['14-list-gaming', scene14_listGaming],
  ['15-list-design', scene15_listDesign],
  ['16-icon-picker', scene16_iconPicker],
];

// ─── Main ────────────────────────────────────────────────────────────────────

export async function runScreenshots(only = null) {
  console.log('▶ Promo screenshots — light + dark, 1280x800 + 1920x1080');
  const filter = only ? (Array.isArray(only) ? only : [only]) : null;

  const { context, profileDir } = await launchContext();
  const origin = await discoverOrigin(context);
  const page = await openNewtab(context, origin);

  await skipOnboarding(page);
  await clearAllBookmarks(page);
  await reloadNewtab(page, 1000);

  console.log('\n● Seeding promo workspaces…');
  const { workspaceIds } = await seedPromoWorkspaces(page);
  await reloadNewtab(page, 2000);

  for (const [name, fn] of SCENES) {
    if (filter && !filter.some((f) => name.includes(f))) continue;
    await fn(page, workspaceIds);
  }

  await context.close();

  // Clean up profile
  const { rm } = await import('node:fs/promises');
  await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);

  console.log('\n✓ Screenshots complete.');
  console.log(`  light/: ${15 * RESOLUTIONS.length} PNGs`);
  console.log(`  dark/:  ${15 * RESOLUTIONS.length} PNGs`);
}

if (process.argv[1].endsWith('screenshots.mjs')) {
  const onlyArg = process.argv.slice(2).find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.split('=')[1].split(',').map((s) => s.trim()) : null;
  runScreenshots(only).catch((err) => { console.error(err); process.exit(1); });
}
