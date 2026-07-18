/**
 * Lint the store/ listing sources against hard store limits.
 *
 *   node scripts/store/lint.mjs
 *
 * Exits 1 on any violation. Missing preview image files are a warning only —
 * promo/ output is gitignored and regenerated on demand.
 */

import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, readRepoFile, readPreviewsConfig } from './lib.mjs';

// Hard limits: CWS manifest description 132 (rejected above), AMO summary 250,
// CWS detailed description 16k, AMO listing max 10 screenshots.
const MANIFEST_DESC_MAX = 132;
const AMO_SUMMARY_MAX = 250;
const CWS_DESC_MAX = 16000;
const AMO_PREVIEWS_MAX = 10;

// Tags AMO accepts in the description field; anything else is stripped or rejected.
const AMO_ALLOWED_TAGS = new Set([
  'a', 'abbr', 'acronym', 'b', 'blockquote', 'br', 'code', 'em', 'i', 'li', 'ol', 'strong', 'ul',
]);

let failures = 0;
const fail = (msg) => { failures += 1; console.error(`  ✗ ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);
const warn = (msg) => console.warn(`  ⚠ ${msg}`);

console.log('▶ store/ lint');

const messages = JSON.parse(await readRepoFile('public/_locales/en/messages.json'));
const manifestDesc = messages.extensionDescription?.message ?? '';
if (!manifestDesc) fail('extensionDescription missing from public/_locales/en/messages.json');
else if (manifestDesc.length > MANIFEST_DESC_MAX) {
  fail(`manifest description is ${manifestDesc.length} chars (max ${MANIFEST_DESC_MAX})`);
} else ok(`manifest description: ${manifestDesc.length}/${MANIFEST_DESC_MAX} chars`);

const summary = (await readRepoFile('store/firefox/summary.txt')).trimEnd();
if (!summary) fail('store/firefox/summary.txt is empty');
else if (summary.includes('\n')) fail('store/firefox/summary.txt must be a single line');
else if (summary.length > AMO_SUMMARY_MAX) {
  fail(`AMO summary is ${summary.length} chars (max ${AMO_SUMMARY_MAX})`);
} else ok(`AMO summary: ${summary.length}/${AMO_SUMMARY_MAX} chars`);

const amoDesc = (await readRepoFile('store/firefox/description.md')).trimEnd();
if (!amoDesc) fail('store/firefox/description.md is empty');
else {
  const badTags = [...amoDesc.matchAll(/<\s*\/?\s*([a-zA-Z0-9]+)/g)]
    .map((m) => m[1].toLowerCase())
    .filter((tag) => !AMO_ALLOWED_TAGS.has(tag));
  if (badTags.length) fail(`AMO description uses disallowed HTML tags: ${[...new Set(badTags)].join(', ')}`);
  else ok(`AMO description: ${amoDesc.length} chars, HTML tags all in AMO allowlist`);
}

const cwsDesc = (await readRepoFile('store/chrome/description.txt')).trimEnd();
if (!cwsDesc) fail('store/chrome/description.txt is empty');
else if (cwsDesc.length > CWS_DESC_MAX) {
  fail(`Chrome description is ${cwsDesc.length} chars (max ${CWS_DESC_MAX})`);
} else ok(`Chrome description: ${cwsDesc.length}/${CWS_DESC_MAX} chars`);

const previews = await readPreviewsConfig();
if (previews.length > AMO_PREVIEWS_MAX) {
  fail(`previews.json lists ${previews.length} previews (AMO max ${AMO_PREVIEWS_MAX})`);
}
for (const [i, p] of previews.entries()) {
  if (!p.file || !p.caption) { fail(`previews[${i}] needs both "file" and "caption"`); continue; }
  await access(join(ROOT, p.file)).catch(() =>
    warn(`previews[${i}] image not present locally (${p.file}) — run npm run promo:screenshots before --replace-previews`),
  );
}
if (previews.length && previews.every((p) => p.file && p.caption)) {
  ok(`previews.json: ${previews.length} previews, all with file + caption`);
}

if (failures) {
  console.error(`\n✗ ${failures} problem(s).`);
  process.exit(1);
}
console.log('\n✓ store/ sources pass lint.');
