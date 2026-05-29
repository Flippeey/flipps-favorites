/**
 * Shared library for promo recording scripts.
 *
 * Selectors and message API match the React rewrite (post 2026-05):
 *   - App shell: `.ff-app`
 *   - Tiles: `.ff-tile[data-item-id][data-item-kind="bookmark"|"folder"]`
 *   - Search: `.ff-search input`, results `#ff-search-results .ff-results__item`
 *   - Settings: `getByRole('button', { name: 'Settings', exact: true })`
 *     drawer `.ff-drawer`, nav items `.ff-drawer__navitem`
 *   - Accent chips: `.ff-accentchip` (order: Blue, Teal, Green, Lime, Yellow,
 *     Orange[5], Red, Rose, Pink, Purple, Slate, Graphite)
 *   - Theme cards: `.ff-themecard--light` / `--dark`
 *   - Dock: `.ff-dock-wrap[data-mode="hover"|"always"]` + `.ff-dock__item`
 *   - Folder overlay: `.ff-folder-overlay` + `.ff-folder-overlay__crumb`
 *   - Page view: `.ff-page-view` + `.ff-crumb__here`
 *   - Sort: `.ff-sort .ff-pill` + `.ff-sort__panel` + `.ff-sort__option`
 *   - Context menu: `.ff-ctx`
 *   - Dialog: `.ff-dialog`, scrim `.ff-modal-scrim`
 *   - Onboarding: `.ff-onboard`, replay `.ff-onboarding-replay`
 *
 * Settings are updated via the message pipeline:
 *   chrome.runtime.sendMessage({ type: 'settings/patch', patch })
 */

import { chromium } from '@playwright/test';
import { mkdtemp, rm, mkdir, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = resolve(__dirname, '..', '..');
export const CHROME_EXT_PATH = join(ROOT_DIR, 'dist', 'chrome');
export const OUT_DIR = join(ROOT_DIR, 'promo');
export const VIDEO_DIR = join(OUT_DIR, 'videos');
export const SHOT_DIR = join(OUT_DIR, 'screenshots');
export const GIF_DIR = join(OUT_DIR, 'gifs');

export const VIEWPORT = { width: 1920, height: 1080 };

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Bookmark seed data ─────────────────────────────────────────────────────
// Single source of truth lives in src/shared/seed-data.ts (typed against the
// shared models). Re-exported here so existing promo scripts keep importing
// from lib.mjs. Node ≥22.18 strips the TS types on import.
import {
  DOCK_BOOKMARKS,
  PROMO_WORKSPACES,
} from '../../src/shared/seed-data.ts';

export { DOCK_BOOKMARKS, PROMO_WORKSPACES };


// ─── Launch + discovery ─────────────────────────────────────────────────────

export async function launchContext({ withVideo = false } = {}) {
  await mkdir(VIDEO_DIR, { recursive: true });
  await mkdir(SHOT_DIR, { recursive: true });
  const profileDir = await mkdtemp(join(tmpdir(), 'ff-promo-'));
  const launchOpts = {
    headless: false,
    args: [
      `--disable-extensions-except=${CHROME_EXT_PATH}`,
      `--load-extension=${CHROME_EXT_PATH}`,
      '--no-first-run',
      '--disable-default-apps',
      `--window-size=${VIEWPORT.width},${VIEWPORT.height + 40}`,
    ],
    viewport: VIEWPORT,
  };
  if (withVideo) {
    launchOpts.recordVideo = { dir: VIDEO_DIR, size: VIEWPORT };
  }
  const context = await chromium.launchPersistentContext(profileDir, launchOpts);
  return { context, profileDir };
}

export async function discoverOrigin(context) {
  const workers = context.serviceWorkers();
  const sw = workers.length > 0
    ? workers[0]
    : await context.waitForEvent('serviceworker', { timeout: 15_000 });
  const extId = new URL(sw.url()).hostname;
  return `chrome-extension://${extId}`;
}

// ─── Storage + settings ─────────────────────────────────────────────────────

/** Skip onboarding by writing the storage value directly. */
export async function skipOnboarding(page) {
  await page.evaluate(() => {
    const a = (globalThis.browser ?? globalThis.chrome);
    return a.storage.local.set({
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

/** Force the onboarding wizard to appear on next load. */
export async function resetOnboarding(page) {
  // The defaultOnboardingState fallback is `status: 'completed'`, so removing
  // the key alone won't show the wizard — must write a pending state explicitly.
  await page.evaluate(() => {
    const a = (globalThis.browser ?? globalThis.chrome);
    return a.storage.local.set({
      'onboarding-state': {
        version: 1,
        status: 'pending',
        updatedAt: Date.now(),
        completedAt: null,
        skippedAt: null,
      },
    });
  });
}

/** Patch settings via the runtime message pipeline (matches test fixtures). */
export async function patchSettings(page, patch) {
  await page.evaluate(async (p) => {
    const a = (globalThis.browser ?? globalThis.chrome);
    await a.runtime.sendMessage({ type: 'settings/patch', patch: p });
  }, patch);
}

/** Patch a workspace record via the runtime message pipeline. */
export async function patchWorkspace(page, id, patch) {
  await page.evaluate(async ({ id: wid, patch: p }) => {
    const a = (globalThis.browser ?? globalThis.chrome);
    await a.runtime.sendMessage({ type: 'workspaces/patch', id: wid, patch: p });
  }, { id, patch });
}

/** Create a workspace record via the runtime message pipeline. Returns the workspace. */
export async function createWorkspace(page, workspace) {
  return page.evaluate(async (ws) => {
    const a = (globalThis.browser ?? globalThis.chrome);
    const res = await a.runtime.sendMessage({ type: 'workspaces/create', workspace: ws });
    return res.workspace;
  }, workspace);
}

/** Get all workspaces via the runtime message pipeline. */
export async function getWorkspaces(page) {
  return page.evaluate(async () => {
    const a = (globalThis.browser ?? globalThis.chrome);
    const res = await a.runtime.sendMessage({ type: 'workspaces/get-all' });
    return res.workspaces;
  });
}

export async function clearAllBookmarks(page) {
  await page.evaluate(async () => {
    const a = (globalThis.browser ?? globalThis.chrome);
    async function emptyOf(parentId) {
      const kids = await a.bookmarks.getChildren(parentId);
      for (const k of kids) {
        await a.bookmarks.removeTree(k.id).catch(() => undefined);
      }
    }
    await emptyOf('1'); // Bookmarks bar
    await emptyOf('2'); // Other bookmarks
  });
}

// ─── Seeding ───────────────────────────────────────────────────────────────

/**
 * Seed the promo workspaces (one per PROMO_WORKSPACES persona).
 * Creates bookmark folders for each workspace under "Other bookmarks" (id "2"),
 * then creates workspace records pointing to each root folder.
 * Also creates the shared dock folder. Work is the active workspace.
 * Returns { workspaceIds: Record<personaName, id>, dockId }.
 */
export async function seedPromoWorkspaces(page) {
  // 1. Create bookmark folders for each workspace
  const folderIds = await page.evaluate(async (workspaces) => {
    const a = (globalThis.browser ?? globalThis.chrome);
    const ids = {};
    for (const ws of workspaces) {
      const root = await a.bookmarks.create({ parentId: '2', title: ws.name });
      ids[ws.name] = root.id;
      for (const bm of ws.rootBookmarks) {
        await a.bookmarks.create({ parentId: root.id, title: bm.title, url: bm.url });
      }
      for (const folder of ws.folders) {
        const f = await a.bookmarks.create({ parentId: root.id, title: folder.title });
        for (const bm of folder.bookmarks) {
          await a.bookmarks.create({ parentId: f.id, title: bm.title, url: bm.url });
        }
      }
    }
    return ids;
  }, PROMO_WORKSPACES);

  // 2. Create dock folder
  const dockId = await page.evaluate(async (dock) => {
    const a = (globalThis.browser ?? globalThis.chrome);
    const folder = await a.bookmarks.create({ parentId: '2', title: 'Dock' });
    for (const bm of dock) {
      await a.bookmarks.create({ parentId: folder.id, title: bm.title, url: bm.url });
    }
    return folder.id;
  }, DOCK_BOOKMARKS);

  // 3. Create workspace records via message pipeline
  const workspaceIds = {};
  for (const ws of PROMO_WORKSPACES) {
    const record = {
      id: `promo-${ws.name.toLowerCase()}`,
      name: ws.name,
      rootFolderId: folderIds[ws.name],
      themeMode: ws.themeMode,
      accentColor: ws.accentColor,
      backgroundMode: ws.backgroundMode,
      solidBackgroundColor: '',
      gradientStyle: ws.gradientStyle,
      gradientColorSource: ws.gradientColorSource,
      gradientCustomColor: ws.accentColor,
      gradientIntensity: ws.gradientIntensity,
      backgroundOpacity: 70,
      backgroundFitMode: 'cover',
      backgroundPositionMode: 'center',
      layoutPreset: 'balanced',
      favoritesColumnGap: 24,
      favoritesRowGap: 20,
      bookmarkTileWidth: 130,
      bookmarkIconSize: 75,
      tileShape: ws.tileShape,
      showTileLabels: true,
    };
    await createWorkspace(page, record);
    workspaceIds[ws.name] = record.id;
  }

  // 4. Activate Work workspace and configure dock
  await patchSettings(page, {
    activeWorkspaceId: workspaceIds.Work,
    workspaceOrder: PROMO_WORKSPACES.map((ws) => workspaceIds[ws.name]),
    dockFolderId: dockId,
    showDock: true,
  });

  return { workspaceIds, dockId };
}

// ─── Page helpers ───────────────────────────────────────────────────────────

export async function openNewtab(context, origin) {
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);
  await page.goto(`${origin}/newtab.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ff-app', { timeout: 15_000 });
  return page;
}

export async function reloadNewtab(page, settleMs = 1800) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ff-app', { timeout: 15_000 });
  await page.waitForTimeout(settleMs); // let icons resolve
}

// ─── Readiness + pacing (promo recording) ───────────────────────────────────

/**
 * Intentional, uniform pacing for marketing clips. Tune here, not per-scene.
 *   intro  — clean opening hold on the ready first frame
 *   beat   — between discrete interactions
 *   settle — let an animation/transition finish
 *   outro  — final hold on the payoff before the page closes
 */
export const HOLD = { intro: 900, beat: 650, settle: 1100, outro: 1300 };
export const hold = (page, ms) => page.waitForTimeout(ms);

/**
 * Block until the grid is fully painted: tiles mounted and every tile/dock
 * icon decoded (no placeholder→real pop-in on camera). Two rAFs flush layout.
 * Safe to call when no tiles exist (e.g. onboarding) — it just falls through.
 */
export async function waitForReady(page) {
  await page.waitForSelector('.ff-tile', { timeout: 8_000 }).catch(() => undefined);
  await page
    .waitForFunction(() => {
      const imgs = [...document.querySelectorAll('.ff-tile img, .ff-dock__item img')];
      return imgs.every((i) => i.complete && i.naturalWidth > 0);
    }, { timeout: 8_000 })
    .catch(() => undefined);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}

/**
 * Prime the IndexedDB icon cache for every workspace once, on a shared context,
 * so all later recordings serve icons from cache — instant and identical across
 * clips (kills the cold-cache icon inconsistency).
 */
export async function warmIcons(page, workspaceIds) {
  for (const id of Object.values(workspaceIds)) {
    await patchSettings(page, { activeWorkspaceId: id });
    await reloadNewtab(page, 1200);
    await waitForReady(page);
  }
}

// ─── Motion helpers ─────────────────────────────────────────────────────────

// ─── Cursor tracking ────────────────────────────────────────────────────────
// Track cursor position across calls so movements start from the last known
// position instead of always teleporting from screen center.
let cursorX = VIEWPORT.width / 2;
let cursorY = VIEWPORT.height / 2;

/** Reset tracking (call at start of each video after page load). */
export function resetCursor(x = VIEWPORT.width / 2, y = VIEWPORT.height / 2) {
  cursorX = x; cursorY = y;
}

/** Cubic ease-in-out — accelerates then decelerates, feels more intentional than quadratic. */
function cubicEase(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Move cursor from current tracked position to (toX, toY).
 * Adds a slight perpendicular wobble for a human-like arc (not a laser-straight line).
 * Step count is distance-based so actual timing is closer to durationMs regardless
 * of path length. CDP roundtrip ~25-35ms per waitForTimeout call; we budget for that.
 */
export async function moveTo(page, toX, toY, durationMs = 420) {
  const fromX = cursorX;
  const fromY = cursorY;
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.hypot(dx, dy);
  if (dist < 2) { cursorX = toX; cursorY = toY; return; }

  // ~8-20 steps: enough for visual smoothness, not so many that timing inflates.
  const steps = Math.max(8, Math.min(20, Math.round(dist / 35)));
  const msPerStep = Math.max(12, Math.round(durationMs / steps));

  // Perpendicular unit vector for the arc wobble.
  const px = -dy / dist;
  const py = dx / dist;
  const wobbleAmp = Math.min(dist * 0.045, 14); // caps at 14px — visible but subtle

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const e = cubicEase(t);
    const w = wobbleAmp * Math.sin(Math.PI * t); // bell curve: 0 at start/end, peak at mid
    await page.mouse.move(
      Math.round(fromX + dx * e + px * w),
      Math.round(fromY + dy * e + py * w),
    );
    if (i < steps) await page.waitForTimeout(msPerStep);
  }
  cursorX = toX;
  cursorY = toY;
}

/**
 * Move to approximately the center of box.
 * Slight random offset (±5px x, ±4px y) avoids perfect-center robot precision.
 * Starts from last known cursor position — no more teleporting from screen center.
 */
export async function moveToBox(page, box, durationMs = 420) {
  if (!box) return;
  const ox = (Math.random() - 0.5) * 10;
  const oy = (Math.random() - 0.5) * 8;
  await moveTo(page, box.x + box.width / 2 + ox, box.y + box.height / 2 + oy, durationMs);
}

/**
 * Explicit from→to move (legacy API, still used for drag operations where the
 * caller controls the exact drag origin). Syncs cursor tracking to fromX/fromY
 * first so moveTo continues from the right position.
 */
export async function smoothMove(page, fromX, fromY, toX, toY, durationMs = 500) {
  cursorX = fromX; cursorY = fromY;
  await moveTo(page, toX, toY, durationMs);
}

export async function typeSlowly(locator, text, perCharDelayMs = 90) {
  await locator.pressSequentially(text, { delay: perCharDelayMs });
}

// ─── Output helpers ─────────────────────────────────────────────────────────

export async function saveVideo(page, basename) {
  await page.close();
  const src = await page.video().path();
  // Windows holds a brief lock after close.
  await sleep(1500);
  const dest = join(VIDEO_DIR, `${basename}.webm`);
  // rename fails on Windows if dest exists — clear a prior run's clip first.
  await rm(dest, { force: true }).catch(() => undefined);
  await rename(src, dest);
  console.log(`  ✓ video: videos/${basename}.webm`);
}

