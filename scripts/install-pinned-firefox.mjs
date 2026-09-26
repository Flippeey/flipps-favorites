#!/usr/bin/env node
// Provisions the Firefox build the Puppeteer suite is pinned to. Reads the
// build id from the same file `tests/firefox-e2e/launch.ts` imports, so the
// id lives in exactly one place regardless of whether this runs locally or
// in CI.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Browser, install } from '@puppeteer/browsers';

const here = dirname(fileURLToPath(import.meta.url));
const buildIdPath = join(here, '..', 'tests', 'firefox-e2e', 'firefox-build.json');
const { buildId } = JSON.parse(readFileSync(buildIdPath, 'utf8'));

// Must match the cache dir `resolvePinnedFirefoxExecutable` in
// tests/firefox-e2e/launch.ts reads from — otherwise the browser installs
// somewhere the launch code never looks.
const cacheDir = process.env.PUPPETEER_CACHE_DIR ?? join(homedir(), '.cache', 'puppeteer');

try {
  const installedBrowser = await install({
    browser: Browser.FIREFOX,
    buildId,
    cacheDir,
    downloadProgressCallback: 'default',
  });
  console.log(`Installed Firefox ${buildId} at ${installedBrowser.executablePath}`);
} catch (error) {
  console.error(
    `Failed to install Firefox ${buildId} into ${cacheDir}: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
