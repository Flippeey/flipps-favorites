// Firefox launch helpers for the Puppeteer (WebDriver BiDi) smoke suite.
//
// Recipe:
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
import puppeteer, { type Browser as PuppeteerBrowser, type Page } from 'puppeteer';
import { Browser, computeExecutablePath } from '@puppeteer/browsers';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import firefoxBuild from './firefox-build.json' with { type: 'json' };
import { chromeExtPath } from '../fixtures/launch';

const rootDir = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const DIST_FIREFOX = resolve(rootDir, 'dist', 'firefox');

/** Fixed gecko id shipped by scripts/write-manifest.mjs for the Firefox build. */
export const GECKO_ID = 'com.flipps-favorites@flippflix.com';
/** Fixed UUID paired with GECKO_ID via the `extensions.webextensions.uuids` pref. */
export const FF_UUID = 'd0c70de1-32d3-4b62-a1c9-c07c98c86e64';
export const EXTENSION_ORIGIN = `moz-extension://${FF_UUID}`;
export const NEWTAB_URL = `${EXTENSION_ORIGIN}/newtab.html`;

/**
 * Firefox build id the suite launches, pinned independently of the
 * `puppeteer` package version. Current stable Firefox rejects WebDriver
 * BiDi navigation to moz-extension:// origins (browsingContext.navigate and
 * same-process location.href/window.open all fail), so the suite stays on
 * the last build where that navigation worked until upstream restores it.
 * Single source of truth: `tests/firefox-e2e/firefox-build.json`, read here
 * and by `scripts/install-pinned-firefox.mjs` (used by the npm script and by
 * CI provisioning) — change it in that one file, never inline elsewhere.
 */
export const PINNED_FIREFOX_BUILD_ID: string = firefoxBuild.buildId;

function firefoxCacheDir(): string {
  return process.env['PUPPETEER_CACHE_DIR'] ?? join(homedir(), '.cache', 'puppeteer');
}

/** The exact command that provisions `PINNED_FIREFOX_BUILD_ID` locally or in CI. */
export function firefoxInstallCommand(): string {
  return 'npm run test:firefox:e2e:install-browser';
}

/**
 * Resolve the pinned Firefox executable, independent of whatever build
 * `puppeteer` itself bundles. Throws with the install command rather than
 * silently falling back to puppeteer's default Firefox, which may be a
 * version the suite has not been validated against.
 */
export function resolvePinnedFirefoxExecutable(): string {
  const executablePath = computeExecutablePath({
    browser: Browser.FIREFOX,
    buildId: PINNED_FIREFOX_BUILD_ID,
    cacheDir: firefoxCacheDir(),
  });
  if (!existsSync(executablePath)) {
    throw new Error(
      `Pinned Firefox build ${PINNED_FIREFOX_BUILD_ID} not found at ${executablePath}. ` +
        `Run \`${firefoxInstallCommand()}\` before the Firefox E2E suite.`,
    );
  }
  return executablePath;
}

/** Assert the Firefox build exists, mirroring tests/global-setup.ts (build is never run implicitly). */
export function assertFirefoxBuildExists(): void {
  if (!existsSync(resolve(DIST_FIREFOX, 'manifest.json'))) {
    throw new Error(
      'dist/firefox/manifest.json not found. Run `npm run build:firefox` (or `npm run build`) before the Firefox E2E suite.',
    );
  }
}

export interface FirefoxSession {
  browser: PuppeteerBrowser;
  /** Open a fresh page navigated to the extension's newtab.html and ready (`.ff-app` mounted). */
  newtabPage(): Promise<Page>;
  close(): Promise<void>;
}

export interface LaunchOptions {
  /** Override headless mode. Defaults to true; the suite falls back to headed if headless misbehaves. */
  headless?: boolean;
  /** Extra Firefox prefs merged into the launch profile (e.g. to blackhole specific hosts for a hermetic test). */
  extraPrefsFirefox?: Record<string, string | number | boolean>;
  /** Accept self-signed certs session-wide (a local TLS stand-in for a real host). */
  acceptInsecureCerts?: boolean;
}

/**
 * Launch Firefox with the extension installed as a temporary addon at a
 * deterministic origin.
 */
export async function launchFirefoxWithExtension(opts: LaunchOptions = {}): Promise<FirefoxSession> {
  assertFirefoxBuildExists();

  const headless = opts.headless ?? true;
  const browser = await puppeteer.launch({
    browser: 'firefox',
    headless,
    executablePath: resolvePinnedFirefoxExecutable(),
    acceptInsecureCerts: opts.acceptInsecureCerts ?? false,
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

export type ChromeSession = FirefoxSession;

export interface ChromeLaunchOptions {
  /** Extra Chromium CLI args (e.g. routing a host to a local stub server). */
  extraArgs?: string[];
}

/**
 * Launch Chromium with the Chrome test build loaded, so a spec can drive a
 * Chrome and a Firefox extension side by side from one process. Uses
 * Playwright's Chromium: branded Chrome ignores unpacked-extension loading
 * flags, and CI already installs this binary for the Playwright suite.
 */
export async function launchChromeWithExtension(opts: ChromeLaunchOptions = {}): Promise<ChromeSession> {
  if (!existsSync(resolve(chromeExtPath, 'manifest.json'))) {
    throw new Error('dist/chrome-test/manifest.json not found. Run `npm run build:chrome:test` first.');
  }
  const browser = await puppeteer.launch({
    browser: 'chrome',
    executablePath: chromium.executablePath(),
    headless: true,
    pipe: true,
    enableExtensions: [chromeExtPath],
    args: ['--no-first-run', '--disable-default-apps', ...(opts.extraArgs ?? [])],
  });
  const worker = await browser.waitForTarget(
    (target) => target.type() === 'service_worker' && target.url().startsWith('chrome-extension://'),
    { timeout: 15_000 },
  );
  const newtabUrl = `chrome-extension://${new URL(worker.url()).hostname}/newtab.html`;

  const newtabPage = async (): Promise<Page> => {
    const page = await browser.newPage();
    await gotoAndWaitForApp(page, newtabUrl);
    return page;
  };

  return { browser, newtabPage, close: () => browser.close() };
}

/**
 * Navigate to a moz-extension:// URL and wait for the app shell to mount.
 * NEVER use `waitUntil: 'load'` or `'domcontentloaded'` here — both hang
 * indefinitely for moz-extension pages over BiDi.
 */
export async function gotoAndWaitForApp(page: Page, url: string): Promise<void> {
  // Empty array = wait for no lifecycle event ('fire and forget'). Neither
  // 'load' nor 'domcontentloaded' ever fire for moz-extension pages over
  // BiDi, so this is the type-safe equivalent of the no-op wait.
  await page.goto(url, { waitUntil: [], timeout: 15_000 });
  await page.waitForSelector('.ff-app', { timeout: 15_000 });
}

/** Reload the current page and wait for the app shell to remount. Same lifecycle caveat as gotoAndWaitForApp. */
export async function reloadAndWaitForApp(page: Page): Promise<void> {
  await page.reload({ waitUntil: [], timeout: 15_000 });
  await page.waitForSelector('.ff-app', { timeout: 15_000 });
}
