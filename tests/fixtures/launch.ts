// Single source of truth for launching the built extension under Playwright.
// Both the worker-scoped `world` fixtures and the function-scoped
// `extension-context` fixtures need to spin up a persistent browser context
// pointed at dist/chrome (or dist/firefox); this module is the only place
// that does it, so the launch args/flags never drift between the two.
import { chromium, firefox, type BrowserContext } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
// Chrome specs load the dedicated `chrome-test` build (npm run build:chrome:test),
// not the release dist/chrome — it's built with __FF_TEST_STORAGE_LOCAL__ true,
// forcing settings/workspaces onto chrome.storage.local so the async
// sync-preferred flush race can't cause "persists after reload" flakes (see
// playwright.config.ts + storage-buckets.ts). dist/chrome itself stays the
// unmodified release artifact.
export const chromeExtPath = join(rootDir, 'dist', 'chrome-test');
export const firefoxExtPath = join(rootDir, 'dist', 'firefox');

export interface LaunchedContext {
  context: BrowserContext;
  profileDir: string;
}

/**
 * Launch Chrome with the built extension loaded via a temp profile dir.
 *
 * Chrome's new headless mode (--headless=new) supports MV3 extensions,
 * unlike legacy headless. Set HEADED=1 to force a visible window for local
 * debugging. headless:false + the `--headless=new` arg drives Chrome's new
 * headless mode; passing headless:true instead makes Playwright inject
 * legacy `--headless`, under which the extension service worker never
 * registers (waitForEvent('serviceworker') times out).
 */
export async function launchChrome(): Promise<LaunchedContext> {
  const profileDir = await mkdtemp(join(tmpdir(), 'cr-ext-'));
  const headed = process.env.HEADED === '1';
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: [
      ...(headed ? [] : ['--headless=new']),
      `--disable-extensions-except=${chromeExtPath}`,
      `--load-extension=${chromeExtPath}`,
      '--no-first-run',
      '--disable-default-apps',
    ],
  });
  return { context, profileDir };
}

/** Launch Firefox with the built extension loaded via a temp profile dir. */
export async function launchFirefox(): Promise<LaunchedContext> {
  const profileDir = await mkdtemp(join(tmpdir(), 'ff-ext-'));
  const context = await firefox.launchPersistentContext(profileDir, { headless: false });
  return { context, profileDir };
}

/** Tear down a context launched by `launchChrome`/`launchFirefox`. */
export async function closeLaunched({ context, profileDir }: LaunchedContext): Promise<void> {
  await context.close();
  await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
}

/** Resolve the `chrome-extension://<id>` origin for a launched Chrome context. */
export async function originFrom(context: BrowserContext): Promise<string> {
  const workers = context.serviceWorkers();
  const sw =
    workers.length > 0
      ? workers[0]!
      : await context.waitForEvent('serviceworker', { timeout: 15_000 });
  return `chrome-extension://${new URL(sw.url()).hostname}`;
}
