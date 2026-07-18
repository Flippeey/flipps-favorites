/**
 * Sync the AMO listing (summary, description, screenshot captions/images)
 * from the store/ source-of-truth files.
 *
 *   node scripts/store/amo-sync.mjs                              # dry-run diff — no credentials needed
 *   node scripts/store/amo-sync.mjs --apply                      # push summary/description/caption changes
 *   node scripts/store/amo-sync.mjs --apply --replace-previews   # ALSO delete + re-upload every preview image
 *
 * --apply needs AMO_JWT_ISSUER + AMO_JWT_SECRET (same credentials as publish.yml;
 * create at https://addons.mozilla.org/developers/addon/api/key/).
 *
 * Image files themselves can't be diffed against AMO (it re-encodes uploads), so
 * the dry run compares count + captions only; use --replace-previews after
 * regenerating screenshots.
 */

import { readFile } from 'node:fs/promises';
import { createHmac, randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import {
  AMO_API, AMO_LOCALE, AMO_SLUG, ROOT,
  printDiff, readPreviewsConfig, readRepoFile,
} from './lib.mjs';

const APPLY = process.argv.includes('--apply');
const REPLACE_PREVIEWS = process.argv.includes('--replace-previews');
const ADDON_URL = `${AMO_API}/addons/addon/${AMO_SLUG}/`;

// ─── Auth ────────────────────────────────────────────────────────────────────

function jwtToken() {
  const issuer = process.env.AMO_JWT_ISSUER;
  const secret = process.env.AMO_JWT_SECRET;
  if (!issuer || !secret) {
    console.error('✗ --apply needs AMO_JWT_ISSUER and AMO_JWT_SECRET in the environment.');
    process.exit(1);
  }
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: issuer, jti: randomUUID(), iat: now, exp: now + 300 })}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}

async function api(method, url, body, isForm = false) {
  const headers = { Authorization: `JWT ${jwtToken()}` };
  if (body && !isForm) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: isForm ? body : body && JSON.stringify(body) });
  if (!res.ok) {
    throw new Error(`${method} ${url} → ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  return res.status === 204 ? null : res.json();
}

// ─── Load both sides ─────────────────────────────────────────────────────────

console.log(`▶ AMO listing sync — ${AMO_SLUG} (${APPLY ? 'APPLY' : 'dry run'})`);

const local = {
  summary: (await readRepoFile('store/amo/summary.txt')).trimEnd(),
  description: (await readRepoFile('store/amo/description.html')).trimEnd(),
  previews: await readPreviewsConfig(),
};

const liveRes = await fetch(`${ADDON_URL}?lang=${AMO_LOCALE}`);
if (!liveRes.ok) {
  console.error(`✗ Could not fetch live listing (${liveRes.status}).`);
  process.exit(1);
}
const live = await liveRes.json();
const liveSummary = (live.summary?.[AMO_LOCALE] ?? live.summary ?? '').trimEnd();
const liveDescription = (live.description?.[AMO_LOCALE] ?? live.description ?? '').trimEnd();
const livePreviews = [...(live.previews ?? [])].sort((a, b) => a.position - b.position);

// ─── Diff ────────────────────────────────────────────────────────────────────

const patch = {};
if (liveSummary !== local.summary) {
  patch.summary = { [AMO_LOCALE]: local.summary };
  await printDiff('summary', liveSummary, 'store/amo/summary.txt');
} else console.log('  ✓ summary in sync');

if (liveDescription !== local.description) {
  patch.description = { [AMO_LOCALE]: local.description };
  await printDiff('description', liveDescription, 'store/amo/description.html');
} else console.log('  ✓ description in sync');

const captionChanges = [];
const pairCount = Math.min(livePreviews.length, local.previews.length);
for (let i = 0; i < pairCount; i++) {
  const liveCaption = (livePreviews[i].caption?.[AMO_LOCALE] ?? livePreviews[i].caption ?? '').trim();
  if (liveCaption !== local.previews[i].caption.trim()) {
    captionChanges.push({ id: livePreviews[i].id, position: i, caption: local.previews[i].caption.trim() });
    console.log(`  Δ preview ${i} caption:\n      live: ${liveCaption}\n      repo: ${local.previews[i].caption.trim()}`);
  }
}
if (!captionChanges.length && livePreviews.length === local.previews.length) {
  console.log(`  ✓ previews in sync (${livePreviews.length} captions match; images not compared)`);
} else if (livePreviews.length !== local.previews.length) {
  console.log(`  Δ preview count: live ${livePreviews.length} vs repo ${local.previews.length} — needs --replace-previews`);
}

const textChanges = Object.keys(patch).length > 0 || captionChanges.length > 0;
if (!textChanges && !REPLACE_PREVIEWS) {
  console.log('\n✓ Nothing to do.');
  process.exit(0);
}
if (!APPLY) {
  console.log('\nDry run — re-run with --apply to push the changes above.');
  process.exit(0);
}

// ─── Apply ───────────────────────────────────────────────────────────────────

if (Object.keys(patch).length) {
  await api('PATCH', ADDON_URL, patch);
  console.log(`  ✓ pushed ${Object.keys(patch).join(' + ')}`);
}

if (REPLACE_PREVIEWS) {
  const missing = [];
  for (const p of local.previews) {
    await readFile(join(ROOT, p.file)).catch(() => missing.push(p.file));
  }
  if (missing.length) {
    console.error(`✗ Missing preview images (run npm run promo:screenshots):\n  ${missing.join('\n  ')}`);
    process.exit(1);
  }
  for (const p of livePreviews) {
    await api('DELETE', `${ADDON_URL}previews/${p.id}/`);
  }
  console.log(`  ✓ deleted ${livePreviews.length} live previews`);
  for (const [i, p] of local.previews.entries()) {
    const form = new FormData();
    form.set('image', new Blob([await readFile(join(ROOT, p.file))], { type: 'image/png' }), basename(p.file));
    form.set('position', String(i));
    const created = await api('POST', `${ADDON_URL}previews/`, form, true);
    await api('PATCH', `${ADDON_URL}previews/${created.id}/`, { caption: { [AMO_LOCALE]: p.caption.trim() } });
    console.log(`  ✓ uploaded preview ${i}: ${basename(p.file)}`);
  }
} else {
  for (const c of captionChanges) {
    await api('PATCH', `${ADDON_URL}previews/${c.id}/`, { caption: { [AMO_LOCALE]: c.caption } });
    console.log(`  ✓ updated caption for preview ${c.position}`);
  }
}

// Verify: re-fetch and confirm the pushed fields round-trip.
const check = await (await fetch(`${ADDON_URL}?lang=${AMO_LOCALE}`)).json();
const okSummary = (check.summary?.[AMO_LOCALE] ?? '').trimEnd() === local.summary;
const okDesc = (check.description?.[AMO_LOCALE] ?? '').trimEnd() === local.description;
if (!okSummary || !okDesc) {
  console.error(`✗ Post-apply verification failed (summary ok: ${okSummary}, description ok: ${okDesc}).`);
  process.exit(1);
}
console.log('\n✓ Applied and verified against the live listing.');
