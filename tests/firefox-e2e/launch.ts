// Firefox launch helpers for the Puppeteer (WebDriver BiDi) smoke suite.
//
// Spike-proven recipe (see docs/plan/20260703-firefox-e2e/plan.md, Phase 0):
// - `installExtension(<dist/firefox dir>)` installs as a temporary addon;
//   the *returned* id is the gecko id, NOT the URL-usable UUID.
// - The UUID is deterministic because we set `extensions.webextensions.uuids`
//   (a JSON string mapping gecko id -> UUID) as a launch pref, before install.
// - `page.goto(url, { waitUntil: 'none' })` — 'load'/'domcontentloaded' hang
//   forever on moz-extension:// pages over BiDi. Fire-and-forget + manual
//   `waitForSelector('.ff-app')` is the only proven pattern. Same rule after
//   `page.reload()`.
// - `page.url()` reports `about:blank` even when the page is fully live —
//   never assert on it.
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const DIST_FIREFOX = resolve(rootDir, 'dist', 'firefox');

/** Fixed gecko id shipped by scripts/write-manifest.mjs for the Firefox build. */
export const GECKO_ID = 'com.flipps-favorites@flippflix.com';
/** Fixed UUID paired with GECKO_ID via the `extensions.webextensions.uuids` pref. */
export const FF_UUID = 'd0c70de1-32d3-4b62-a1c9-c07c98c86e64';
export const EXTENSION_ORIGIN = `moz-extension://${FF_UUID}`;
export const NEWTAB_URL = `${EXTENSION_ORIGIN}/newtab.html`;

/** Assert the Firefox build exists, mirroring tests/global-setup.ts (build is never run implicitly). */
export function assertFirefoxBuildExists(): void {
  if (!existsSync(resolve(DIST_FIREFOX, 'manifest.json'))) {
    throw new Error(
      'dist/firefox/manifest.json not found. Run `npm run build:firefox` (or `npm run build`) before the Firefox E2E suite.',
    );
  }
}

export interface FirefoxSession {
  browser: Browser;
  /** Open a fresh page navigated to the extension's newtab.html and ready (`.ff-app` mounted). */
  newtabPage(): Promise<Page>;
  close(): Promise<void>;
}

export interface LaunchOptions {
  /** Override headless mode. Defaults to true; the suite falls back to headed if headless misbehaves. */
  headless?: boolean;
  /** Extra Firefox prefs merged into the launch profile (e.g. to blackhole specific hosts for a hermetic test). */
  extraPrefsFirefox?: Record<string, string | number | boolean>;
}

/**
 * Launch Firefox with the extension installed as a temporary addon at a
 * deterministic origin, per the Phase 0 spike recipe.
 */
export async function launchFirefoxWithExtension(opts: LaunchOptions = {}): Promise<FirefoxSession> {
  assertFirefoxBuildExists();

  const headless = opts.headless ?? true;
  const browser = await puppeteer.launch({
    browser: 'firefox',
    headless,
    extraPrefsFirefox: {
      'extensions.webextensions.uuids': JSON.stringify({ [GECKO_ID]: FF_UUID }),
      ...opts.extraPrefsFirefox,
    },
  });

  await browser.installExtension(DIST_FIREFOX);

  const newtabPage = async (): Promise<Page> => {
    const page = await browser.newPage();
    await gotoAndWaitForApp(page, NEWTAB_URL);
    return page;
  };

  const close = async (): Promise<void> => {
    await browser.close();
  };

  return { browser, newtabPage, close };
}

/**
 * Navigate to a moz-extension:// URL and wait for the app shell to mount.
 * NEVER use `waitUntil: 'load'` or `'domcontentloaded'` here — both hang
 * indefinitely for moz-extension pages over BiDi (spike-confirmed).
 */
export async function gotoAndWaitForApp(page: Page, url: string): Promise<void> {
  // Empty array = wait for no lifecycle event ("fire and forget"). Same
  // runtime effect as the spike's 'none' string (neither 'load' nor
  // 'domcontentloaded' match anything internally), but empty array is the
  // type-safe way to express it — 'none' is not a valid PuppeteerLifeCycleEvent.
  await page.goto(url, { waitUntil: [], timeout: 15_000 });
  await page.waitForSelector('.ff-app', { timeout: 15_000 });
}

/** Reload the current page and wait for the app shell to remount. Same lifecycle caveat as gotoAndWaitForApp. */
export async function reloadAndWaitForApp(page: Page): Promise<void> {
  await page.reload({ waitUntil: [], timeout: 15_000 });
  await page.waitForSelector('.ff-app', { timeout: 15_000 });
}
