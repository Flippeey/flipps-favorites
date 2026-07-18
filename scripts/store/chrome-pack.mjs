/**
 * Chrome Web Store listing helper.
 *
 * The CWS API — including API v2 (2025) — exposes NO listing-metadata endpoints:
 * only package upload/publish/rollout. Descriptions, screenshots, and promo tiles
 * are dashboard-only. This script makes that manual step a diff-and-paste:
 *
 *   node scripts/store/chrome-pack.mjs
 *
 * Fetches the LIVE public listing, diffs it against the repo sources, and prints
 * exactly what to paste (plus where) when out of sync. No credentials involved.
 */

import {
  CWS_DASHBOARD_URL, CWS_LISTING_URL,
  printDiff, readRepoFile,
} from './lib.mjs';

// ─── Extraction ──────────────────────────────────────────────────────────────

function unescapeBlob(s) {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\u003c/gi, '<')
    .replace(/\\u003e/gi, '>')
    .replace(/\\u0026/gi, '&')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

/**
 * The long description lives in the page's serialized JS data as one long quoted
 * string full of \n escapes. Heuristic: longest such string that looks like our
 * listing copy. Brittle by nature — fails loud rather than guessing.
 */
function extractLongDescription(html) {
  let best = null;
  for (const m of html.matchAll(/"((?:[^"\\]|\\.){800,30000})"/g)) {
    const s = m[1];
    if ((s.match(/\\n/g) ?? []).length > 5 && /ookmark|orkspace/.test(s)) {
      if (!best || s.length > best.length) best = s;
    }
  }
  return best ? unescapeBlob(best).trim() : null;
}

// ─── Main ────────────────────────────────────────────────────────────────────

console.log('▶ Chrome Web Store listing check');

const localLong = (await readRepoFile('store/chrome/description.txt')).trimEnd();
const messages = JSON.parse(await readRepoFile('public/_locales/en/messages.json'));
const localShort = messages.extensionDescription?.message ?? '';

const res = await fetch(CWS_LISTING_URL, { headers: { 'Accept-Language': 'en' } });
if (!res.ok) {
  console.error(`✗ Could not fetch live listing (${res.status}): ${CWS_LISTING_URL}`);
  process.exit(1);
}
const html = await res.text();

const liveShort = unescapeBlob(html.match(/<meta property="og:description" content="([^"]*)"/)?.[1] ?? '');
const liveLong = extractLongDescription(html);

let actionNeeded = false;

if (liveShort === localShort) {
  console.log('  ✓ short description in sync (ships inside the package)');
} else {
  console.log(`  Δ short description differs — no dashboard action: it updates automatically on the next package upload.\n      live: ${liveShort}\n      repo: ${localShort}`);
}

if (liveLong === null) {
  console.error('  ✗ Could not extract the long description from the live page (Google may have changed the page format).');
  console.error('    Compare manually: store/chrome/description.txt vs the listing at');
  console.error(`    ${CWS_LISTING_URL}`);
  process.exit(1);
}

if (liveLong === localLong) {
  console.log('  ✓ long description in sync');
} else {
  actionNeeded = true;
  await printDiff('long description', liveLong, 'store/chrome/description.txt');
}

if (actionNeeded) {
  console.log(`
── Manual step (the CWS API cannot do this) ─────────────────────────
  1. Open ${CWS_DASHBOARD_URL}
  2. Item → Store listing → Description
  3. Replace the field with the full contents of store/chrome/description.txt
  4. Screenshots (if updating): use promo/screenshots/*/​*-1280x800.png — CWS
     accepts ONLY 1280x800 or 640x400. Promo tiles: promo/tiles/ (npm run promo:tiles).
  5. Save draft → Submit for review.
`);
  process.exit(2);
}
console.log('\n✓ Chrome listing matches the repo.');
