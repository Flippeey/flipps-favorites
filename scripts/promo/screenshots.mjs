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
    await patchWorkspace(page, workspaceId, { themeMode: theme });
    await page.waitForTimeout(400);
    if (setupFn) await setupFn(page, theme);
    for (const res of RESOLUTIONS) {
      await capture(page, theme, name, res);
    }
    // Close any open UI (dialogs, drawers, overlays) between passes
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
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
  await patchSettings(page, { activeWorkspaceId: workspaceIds.Personal });
  await reloadNewtab(page, 1500);
  await captureScene(page, '03-folder-open', workspaceIds.Personal, async (p) => {
    // Open the "Cooking" folder overlay
    const cookingTile = p.locator('.ff-tile:has-text("Cooking")').first();
    if (await cookingTile.count() > 0) {
      await cookingTile.click();
      await p.waitForTimeout(400);
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
    const settingsBtn = p.getByRole('button', { name: 'Settings', exact: true });
    if (await settingsBtn.count() > 0) {
      await settingsBtn.click();
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
    const settingsBtn = p.getByRole('button', { name: 'Settings', exact: true });
    if (await settingsBtn.count() > 0) {
      await settingsBtn.click();
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
      // Navigate to workspace step (step 4)
      for (let i = 0; i < 3; i++) {
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

// ─── Main ────────────────────────────────────────────────────────────────────

export async function runScreenshots() {
  console.log('▶ Promo screenshots — light + dark, 1280x800 + 1920x1080');

  const { context, profileDir } = await launchContext();
  const origin = await discoverOrigin(context);
  const page = await openNewtab(context, origin);

  await skipOnboarding(page);
  await clearAllBookmarks(page);
  await reloadNewtab(page, 1000);

  console.log('\n● Seeding 3-workspace promo data…');
  const { workspaceIds } = await seedPromoWorkspaces(page);
  await reloadNewtab(page, 2000);

  await scene01_hero(page, workspaceIds);
  await scene02_workspaces(page, workspaceIds);
  await scene03_folderOpen(page, workspaceIds);
  await scene04_searchResults(page, workspaceIds);
  await scene05_settingsAppearance(page, workspaceIds);
  await scene06_settingsLayout(page, workspaceIds);
  await scene07_contextMenu(page, workspaceIds);
  await scene08_gradientAurora(page, workspaceIds);
  await scene09_gradientMesh(page, workspaceIds);
  await scene10_creativeWallpaper(page, workspaceIds);
  await scene11_onboardingWelcome(page, workspaceIds);
  await scene12_onboardingWorkspaces(page, workspaceIds);

  await context.close();

  // Clean up profile
  const { rm } = await import('node:fs/promises');
  await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);

  console.log('\n✓ Screenshots complete.');
  console.log(`  light/: ${12 * RESOLUTIONS.length} PNGs`);
  console.log(`  dark/:  ${12 * RESOLUTIONS.length} PNGs`);
}

if (process.argv[1].endsWith('screenshots.mjs')) {
  runScreenshots().catch((err) => { console.error(err); process.exit(1); });
}
