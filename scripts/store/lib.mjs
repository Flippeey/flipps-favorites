/**
 * Shared constants + helpers for the store-listing scripts.
 */

import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const AMO_SLUG = 'flipps-favorites';
export const AMO_API = 'https://addons.mozilla.org/api/v5';
export const AMO_LOCALE = 'en-US';
export const CWS_EXTENSION_ID = 'gclilococnkibbgnpghoafiapkhgkgbh';
export const CWS_LISTING_URL = `https://chromewebstore.google.com/detail/flipps-favorites-new-tab/${CWS_EXTENSION_ID}`;
export const CWS_DASHBOARD_URL = 'https://chrome.google.com/webstore/devconsole/';

export async function readRepoFile(rel) {
  return readFile(join(ROOT, rel), 'utf8');
}

export async function readPreviewsConfig() {
  const raw = JSON.parse(await readRepoFile('store/previews.json'));
  if (!Array.isArray(raw.previews)) {
    throw new Error('store/previews.json: expected a top-level "previews" array');
  }
  return raw.previews;
}

/**
 * Print a colored word-diff between the live store text and the repo file,
 * via `git diff --no-index` (dependency-free, available everywhere the repo is).
 */
export async function printDiff(label, liveText, localPath) {
  const dir = await mkdtemp(join(tmpdir(), 'store-diff-'));
  const liveFile = join(dir, 'live.txt');
  await writeFile(liveFile, liveText.endsWith('\n') ? liveText : `${liveText}\n`);
  console.log(`\n── diff (live → repo): ${label}`);
  try {
    execFileSync(
      'git',
      ['diff', '--no-index', '--color', '--word-diff=color', liveFile, join(ROOT, localPath)],
      { stdio: 'inherit' },
    );
  } catch {
    // git diff exits 1 when files differ — that's the expected path here.
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
