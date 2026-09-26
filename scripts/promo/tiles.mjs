/**
 * Chrome Web Store promo tiles — brand assets, not screenshots.
 *
 *   node scripts/promo/tiles.mjs [--shot=path/to/screenshot.png]
 *
 * Output (promo/tiles/):
 *   tile-small-440x280.png     — required "small promo tile" (branding only)
 *   tile-marquee-1400x560.png  — optional marquee (branding + screenshot card)
 *
 * The marquee needs a screenshot; default is the light-theme hero from the
 * screenshot pipeline (run `npm run promo:screenshots` first, or pass --shot=).
 * CWS requires these exact pixel sizes — viewports are set accordingly.
 */

import { chromium } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { OUT_DIR, ROOT_DIR, SHOT_DIR } from './lib.mjs';

const TILE_DIR = join(OUT_DIR, 'tiles');
const NAME = "Flipp's Favorites";
const TAGLINE = 'Your bookmarks, reimagined as a workspace.';

async function dataUri(path, mime = 'image/png') {
  return `data:${mime};base64,${(await readFile(path)).toString('base64')}`;
}

const baseCss = (scale) => `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; }
  body {
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    background:
      radial-gradient(120% 160% at 85% -20%, rgba(35, 134, 123, 0.55), transparent 55%),
      radial-gradient(110% 140% at -10% 110%, rgba(35, 134, 123, 0.35), transparent 50%),
      linear-gradient(135deg, #10201f 0%, #0c1514 55%, #101b23 100%);
    color: #f2f7f6;
    display: flex;
    align-items: center;
  }
  .brand { display: flex; flex-direction: column; gap: ${10 * scale}px; }
  .brand img { width: ${72 * scale}px; height: ${72 * scale}px; }
  .brand h1 { font-size: ${30 * scale}px; font-weight: 700; letter-spacing: -0.02em; }
  .brand p { font-size: ${15 * scale}px; color: rgba(242, 247, 246, 0.78); line-height: 1.35; }
`;

function smallTileHtml(iconUri) {
  return `<style>
    ${baseCss(1)}
    body { justify-content: center; text-align: center; }
    .brand { align-items: center; padding: 0 36px; }
  </style>
  <div class="brand">
    <img src="${iconUri}" alt="">
    <h1>${NAME}</h1>
    <p>${TAGLINE}</p>
  </div>`;
}

function marqueeHtml(iconUri, shotUri) {
  return `<style>
    ${baseCss(1.5)}
    body { justify-content: space-between; padding-left: 84px; }
    .brand { max-width: 480px; }
    .shot {
      align-self: flex-end;
      width: 720px;
      margin-bottom: -48px;
      margin-right: 48px;
      border-radius: 14px 14px 0 0;
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-bottom: none;
      overflow: hidden;
    }
    .shot img { display: block; width: 100%; }
  </style>
  <div class="brand">
    <img src="${iconUri}" alt="">
    <h1>${NAME}</h1>
    <p>${TAGLINE}</p>
  </div>
  <div class="shot"><img src="${shotUri}" alt=""></div>`;
}

export async function runTiles(shotPath = null) {
  console.log('▶ Promo tiles — 440x280 + 1400x560');
  await mkdir(TILE_DIR, { recursive: true });

  const iconUri = await dataUri(join(ROOT_DIR, 'public', 'icons', 'ff-icon-256.png'));
  const shot = shotPath
    ? resolve(ROOT_DIR, shotPath)
    : join(SHOT_DIR, 'light', '01-hero-1920x1080.png');
  const shotUri = await dataUri(shot).catch(() => null);

  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.setViewportSize({ width: 440, height: 280 });
  await page.setContent(smallTileHtml(iconUri));
  await page.screenshot({ path: join(TILE_DIR, 'tile-small-440x280.png') });
  console.log('  ✓ tile-small-440x280.png');

  if (shotUri) {
    await page.setViewportSize({ width: 1400, height: 560 });
    await page.setContent(marqueeHtml(iconUri, shotUri));
    await page.screenshot({ path: join(TILE_DIR, 'tile-marquee-1400x560.png') });
    console.log('  ✓ tile-marquee-1400x560.png');
  } else {
    console.error(`  ✗ marquee skipped — screenshot not found: ${shot}`);
    console.error('    Run `npm run promo:screenshots` first, or pass --shot=<path>.');
  }

  await browser.close();
  if (!shotUri) process.exit(1);
  console.log('\n✓ Tiles complete → promo/tiles/');
}

if (process.argv[1].endsWith('tiles.mjs')) {
  const shotArg = process.argv.slice(2).find((a) => a.startsWith('--shot='))?.split('=')[1] ?? null;
  runTiles(shotArg).catch((err) => { console.error(err); process.exit(1); });
}
