// The shared fixture library for the Chrome UI suite. Provides a single
// extended `test`/`expect` plus a typed, pre-seeded `world` (the 5 promo
// personas). The browser context and seeded world are worker-scoped so a
// cluster of grouped tests reuse one browser; per-test isolation comes from
// resetting + reseeding storage between tests, not relaunching Chrome.
//
// Two axes of state:
//   world / newtabPage  — worker context, promo world seeded once per worker.
//   freshContext / freshPage — a throwaway function-scoped context with no
//                              seed, for fresh-install / onboarding / error flows.
import { test as base, expect } from '@playwright/test';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetStorage, seedPromoWorld } from './seeding.js';
import type { SeededWorld } from './seeding.js';

export type { SeededWorld, PromoPersona } from './seeding.js';

const rootDir = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const chromeExtPath = join(rootDir, 'dist', 'chrome');

async function launchChrome(): Promise<{ context: BrowserContext; profileDir: string }> {
  const profileDir = await mkdtemp(join(tmpdir(), 'cr-ext-'));
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${chromeExtPath}`,
      `--load-extension=${chromeExtPath}`,
      '--no-first-run',
      '--disable-default-apps',
    ],
  });
  return { context, profileDir };
}

async function originFrom(context: BrowserContext): Promise<string> {
  const workers = context.serviceWorkers();
  const sw =
    workers.length > 0
      ? workers[0]!
      : await context.waitForEvent('serviceworker', { timeout: 15_000 });
  return `chrome-extension://${new URL(sw.url()).hostname}`;
}

export interface WorldFixtures {
  /** Worker-scoped persistent context loading `dist/chrome`. */
  extensionContext: BrowserContext;
  /** Extension origin (`chrome-extension://<id>`) for the worker context. */
  extensionOrigin: string;
  /** Promo world seeded once per worker; per-test storage is reset + reseeded. */
  world: SeededWorld;
  /** Newtab page bound to the freshly reseeded promo world, one per test. */
  newtabPage: Page;
  /** Throwaway unseeded context for fresh-install / onboarding / error flows. */
  freshContext: BrowserContext;
  /** Newtab page in the unseeded `freshContext`. */
  freshPage: Page;
}

export const test = base.extend<
  Pick<WorldFixtures, 'world' | 'newtabPage' | 'freshContext' | 'freshPage'>,
  Pick<WorldFixtures, 'extensionContext' | 'extensionOrigin'>
>({
  extensionContext: [
    async ({}, use) => {
      const { context, profileDir } = await launchChrome();
      await use(context);
      await context.close();
      await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
    },
    { scope: 'worker' },
  ],

  extensionOrigin: [
    async ({ extensionContext }, use) => {
      await use(await originFrom(extensionContext));
    },
    { scope: 'worker' },
  ],

  // Reset + reseed the promo world before each test, on a page in the shared
  // worker context. Storage is the source of truth, so the next test starts
  // from a known baseline without relaunching the browser.
  world: async ({ extensionContext, extensionOrigin }, use) => {
    const page = await extensionContext.newPage();
    await page.goto(`${extensionOrigin}/newtab.html`);
    await page.waitForSelector('.ff-app', { timeout: 15_000 });
    await resetStorage(page);
    const seeded = await seedPromoWorld(page);
    await page.close();
    await use({ ...seeded, origin: extensionOrigin });
  },

  newtabPage: async ({ extensionContext, extensionOrigin, world }, use) => {
    void world; // ensure the world is seeded before the page loads
    const page = await extensionContext.newPage();
    await page.goto(`${extensionOrigin}/newtab.html`);
    await page.waitForSelector('.ff-app', { timeout: 15_000 });
    await use(page);
    await page.close();
  },

  freshContext: async ({}, use) => {
    const { context, profileDir } = await launchChrome();
    await use(context);
    await context.close();
    await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
  },

  freshPage: async ({ freshContext }, use) => {
    const origin = await originFrom(freshContext);
    const page = await freshContext.newPage();
    await page.goto(`${origin}/newtab.html`);
    await page.waitForSelector('.ff-app', { timeout: 15_000 });
    await use(page);
    await page.close();
  },
});

export { expect };
