/**
 * Custom wallpaper: preview thumbnail, background rendering, and persistence
 * across reload â€” including images large enough that:
 *   - the data URL exceeds chrome.storage.sync's 8KB per-item quota
 *   - the inline CSS url(data:...) would exceed Chromium's silent inline-style
 *     size limit and never reach the DOM
 *
 * Three bugs this regresses against:
 *   1. WallpaperPicker preview used the `background` shorthand alongside the
 *      `backgroundImage` longhand, which silently cleared the image.
 *   2. Settings (including the wallpaper data URL) lived in chrome.storage.sync;
 *      real images blew the quota and writes were dropped.
 *   3. Inline `--wallpaper-url: url(data:...4MB...)` was silently dropped by
 *      Chromium, so the background never rendered for large images.
 */
import { test, expect } from '../fixtures/extension-context.js';
import {
  clearExtensionStorage,
  createTestFolder,
  openSettingsSection,
  reloadNewtab,
  removeBookmarkTree,
  setupDefaultWorkspace,
} from '../fixtures/bookmark-helpers.js';

// Wallpapers are stored per workspace in storage.local under this key
// (workspaceWallpaperKey('ws-default') in src/shared/storage.ts).
const WALLPAPER_KEY = 'app-wallpaper-ws-default';

let rootId: string;

test.beforeEach(async ({ newtabPage }) => {
  await clearExtensionStorage(newtabPage);
  rootId = await createTestFolder(newtabPage, 'Wallpaper Root');
  await setupDefaultWorkspace(newtabPage, rootId);
  // Also clear any wallpaper from a prior test run.
  await newtabPage.evaluate(async (key) => {
    const api = (globalThis as any).browser || (globalThis as any).chrome;
    await api.storage.local.remove(key);
  }, WALLPAPER_KEY);
  await reloadNewtab(newtabPage);
});

test.afterEach(async ({ newtabPage }) => {
  await removeBookmarkTree(newtabPage, rootId);
});

async function uploadWallpaperFromCanvas(page: import('@playwright/test').Page, size: number): Promise<number> {
  // Build a noisy PNG of the requested size in-page, then push it through the
  // hidden <input type=file> so the full UI flow exercises (FileReader â†’ patch
  // â†’ optimistic state â†’ SW write â†’ render).
  return page.evaluate((px) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = px;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(px, px);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = Math.random() * 255;
      img.data[i + 1] = Math.random() * 255;
      img.data[i + 2] = Math.random() * 255;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return new Promise<number>((resolve) => {
      canvas.toBlob((blob) => {
        const file = new File([blob!], 'wp.png', { type: 'image/png' });
        const dt = new DataTransfer();
        dt.items.add(file);
        const input = document.querySelector('input[type=file][accept="image/*"]') as HTMLInputElement;
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        resolve(file.size);
      }, 'image/png');
    });
  }, size);
}

test('uploading a large wallpaper renders the background, preview, and survives reload', async ({ newtabPage }) => {
  await openSettingsSection(newtabPage, 'appearance');

  // Switch background mode to "wallpaper". The cards are clickable divs, not
  // buttons, so locate by their label and click the parent card.
  await newtabPage.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('.ff-themecard__label'));
    const wallpaper = labels.find(el => /wallpaper/i.test(el.textContent ?? ''));
    (wallpaper?.parentElement as HTMLElement | undefined)?.click();
  });
  await expect(newtabPage.locator('.ff-row__label', { hasText: /no wallpaper selected/i })).toBeVisible();

  // 1000Ã—1000 noise PNG â†’ ~3-4MB data URL, well past both the sync quota and
  // the inline-style size limit.
  const fileSize = await uploadWallpaperFromCanvas(newtabPage, 1000);
  expect(fileSize).toBeGreaterThan(100_000);

  // Wait for the upload to settle into state (label flips, blob URL resolves,
  // CSS variable lands on the root element).
  await expect(newtabPage.locator('.ff-row__label', { hasText: /custom wallpaper/i })).toBeVisible();

  // The wallpaper paints on a dedicated .ff-bg-wallpaper layer (activated when
  // backgroundMode is "wallpaper"), not on .ff-app itself.
  await expect(newtabPage.locator('.ff-bg-wallpaper')).toHaveAttribute('data-active', 'true');
  await newtabPage.waitForFunction(() => {
    const el = document.querySelector('.ff-bg-wallpaper') as HTMLElement | null;
    return !!el && getComputedStyle(el).backgroundImage.startsWith('url(');
  }, undefined, { timeout: 5_000 });

  // Preview thumbnail renders the image via a blob URL.
  const previewBgImage = await newtabPage.evaluate(() => {
    const label = Array.from(document.querySelectorAll('.ff-row__label'))
      .find(el => /custom wallpaper/i.test(el.textContent ?? ''));
    const card = label?.closest('.ff-card') as HTMLElement | null;
    const previewDiv = card?.querySelector(':scope > div:first-child') as HTMLElement | null;
    return previewDiv ? getComputedStyle(previewDiv).backgroundImage : '';
  });
  expect(previewBgImage).toMatch(/^url\("?blob:/);

  // The wallpaper layer's background-image resolves to a blob URL (not "none").
  const layerBgImage = await newtabPage.evaluate(() => {
    const el = document.querySelector('.ff-bg-wallpaper') as HTMLElement;
    return getComputedStyle(el).backgroundImage;
  });
  expect(layerBgImage).toMatch(/^url\("?blob:/);

  // .ff-app advertises wallpaper mode via data-bg.
  await expect(newtabPage.locator('.ff-app')).toHaveAttribute('data-bg', 'wallpaper');

  // Storage placement: wallpaper lives in local under the per-workspace key;
  // synced settings stay small (no embedded multi-MB data URL).
  const storage = await newtabPage.evaluate(async (key) => {
    const api = (globalThis as any).browser || (globalThis as any).chrome;
    const sync = await api.storage.sync.get('app-settings');
    const local = await api.storage.local.get(key);
    return {
      syncLen: JSON.stringify(sync?.['app-settings'] ?? {}).length,
      localWallpaperLen: typeof local?.[key] === 'string' ? local[key].length : 0,
    };
  }, WALLPAPER_KEY);
  expect(storage.syncLen).toBeLessThan(5_000);
  expect(storage.localWallpaperLen).toBeGreaterThan(100_000);

  // Persistence: reload the new tab and the wallpaper still renders.
  await reloadNewtab(newtabPage);
  await newtabPage.waitForFunction(() => {
    const el = document.querySelector('.ff-bg-wallpaper') as HTMLElement | null;
    return !!el && getComputedStyle(el).backgroundImage.startsWith('url(');
  }, undefined, { timeout: 5_000 });

  const afterReload = await newtabPage.evaluate(() => {
    const app = document.querySelector('.ff-app') as HTMLElement;
    const layer = document.querySelector('.ff-bg-wallpaper') as HTMLElement;
    return {
      dataBg: app.getAttribute('data-bg'),
      backgroundImage: getComputedStyle(layer).backgroundImage,
    };
  });
  expect(afterReload.dataBg).toBe('wallpaper');
  expect(afterReload.backgroundImage).toMatch(/^url\("?blob:/);
});

test('clearing the wallpaper removes it from local storage and the background', async ({ newtabPage }) => {
  await openSettingsSection(newtabPage, 'appearance');
  await newtabPage.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('.ff-themecard__label'));
    const wallpaper = labels.find(el => /wallpaper/i.test(el.textContent ?? ''));
    (wallpaper?.parentElement as HTMLElement | undefined)?.click();
  });
  await uploadWallpaperFromCanvas(newtabPage, 500);
  // Wait until the upload settles â€” otherwise the trash button hasn't rendered.
  await expect(newtabPage.locator('.ff-row__label', { hasText: /custom wallpaper/i })).toBeVisible();

  // Trash button removes the wallpaper.
  await newtabPage.evaluate(() => {
    const label = Array.from(document.querySelectorAll('.ff-row__label'))
      .find(el => /custom wallpaper/i.test(el.textContent ?? ''));
    const card = label?.closest('.ff-card') as HTMLElement | null;
    // Last child is the trash button when a wallpaper is set.
    const buttons = card?.querySelectorAll('button.ff-btn') ?? [];
    (buttons[buttons.length - 1] as HTMLElement | undefined)?.click();
  });

  await expect(newtabPage.locator('.ff-row__label', { hasText: /no wallpaper selected/i })).toBeVisible();

  // Patch round-trips to the SW asynchronously; wait until the local store
  // actually reflects the clear before asserting.
  await newtabPage.waitForFunction(async (key) => {
    const api = (globalThis as any).browser || (globalThis as any).chrome;
    const got = await api.storage.local.get(key);
    return !got?.[key];
  }, WALLPAPER_KEY, { timeout: 5_000 });
});
