#!/usr/bin/env node
/**
 * Flipp's Favorites extension driver
 * Launches Chrome with the built extension, drives the newtab page via Playwright REPL.
 *
 * Assumes: npm run build:chrome:test was run first (dist/chrome-test populated)
 * Usage: node driver.mjs [--headed]
 * Then: launch → navigate → screenshot → click → eval → quit
 */

import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as readline from 'node:readline';
import * as fs from 'node:fs';

// driver.mjs lives at <root>/.claude/skills/run-flipps-favorites/driver.mjs
// fileURLToPath returns the FILE path, so go up 4: file → run-flipps-favorites → skills → .claude → <root>
const rootDir = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..');

// Change to root so node module resolution works for imports
process.chdir(rootDir);

// Import from @playwright/test (already installed as a dev dependency)
const { chromium } = await import('@playwright/test');

const chromeExtPath = join(rootDir, 'dist', 'chrome-test');
const skillDir = fileURLToPath(import.meta.url);
const SHOT_DIR = join(resolve(skillDir, '..'), 'screenshots');

// Ensure screenshots directory exists
fs.mkdirSync(SHOT_DIR, { recursive: true });

let context = null;
let newtabPage = null;
let extensionOrigin = null;
let profileDir = null;

// Batch mode's exit code: set by every failure path so `--run` surfaces a
// failing command as a non-zero process exit instead of a silent, ignorable
// log line.
let hadError = false;
function fail(...args) {
  hadError = true;
  console.log(...args);
}

// Lazily load the project's own seed helpers. We reuse the SAME seed data the
// promo scripts + Playwright fixtures use (single source of truth in
// src/shared/seed-data.ts) rather than duplicating it. Node ≥22.18 strips TS
// types on import, so importing the .ts files directly works.
let helpers = null;
async function loadHelpers() {
  if (helpers) return helpers;
  const { pathToFileURL } = await import('node:url');
  const lib = await import(pathToFileURL(join(rootDir, 'scripts', 'promo', 'lib.mjs')).href);
  const td = await import(pathToFileURL(join(rootDir, 'tests', 'fixtures', 'test-data.ts')).href);
  helpers = { lib, DEFAULT_WORKSPACE_SETTINGS: td.DEFAULT_WORKSPACE_SETTINGS };
  return helpers;
}

// Headless is the default (`--headless=new` avoids the MV3 service-worker
// registration timeout that Playwright's boolean `headless: true` hits).
// `--headed` is the only way to open a visible window.
const isHeaded = process.argv.includes('--headed');

const COMMANDS = {
  async launch() {
    if (context) return console.log('already launched');

    // Preflight: extension must be built. Fail loud with the real cause.
    const manifestPath = join(chromeExtPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      fail(`ERROR: no extension build at ${chromeExtPath}`);
      console.log('  manifest.json missing — run `npm run build:chrome:test` first.');
      return;
    }

    try {
      profileDir = await mkdtemp(join(tmpdir(), 'cr-ext-'));
      console.log('launching Chrome with extension...');
      context = await chromium.launchPersistentContext(profileDir, {
        // Headless mode is driven by the `--headless=new` arg below, not this
        // option: Playwright's own boolean headless mode never registers the
        // MV3 service worker, so this stays false either way.
        headless: false,
        args: [
          `--disable-extensions-except=${chromeExtPath}`,
          `--load-extension=${chromeExtPath}`,
          '--no-first-run',
          '--disable-default-apps',
          ...(isHeaded ? [] : ['--headless=new']),
        ],
      });

      // Derive extension ID from service worker URL
      const workers = context.serviceWorkers();
      const sw =
        workers.length > 0
          ? workers[0]
          : await context.waitForEvent('serviceworker', { timeout: 15_000 });
      const extId = new URL(sw.url()).hostname;
      extensionOrigin = `chrome-extension://${extId}`;
      console.log(`extension loaded: ${extensionOrigin}`);
    } catch (e) {
      fail('ERROR launching:', e.message);
      return;
    }
  },

  async navigate() {
    if (!context) return fail('ERROR: launch first');
    if (!extensionOrigin) return fail('ERROR: extension origin not set');

    try {
      if (newtabPage) await newtabPage.close();
      newtabPage = await context.newPage();
      const url = `${extensionOrigin}/newtab.html`;
      console.log(`navigating to ${url}...`);
      await newtabPage.goto(url);
      await newtabPage.waitForSelector('.ff-app', { timeout: 15_000 });
      console.log('newtab page loaded');
    } catch (e) {
      // Leave no half-opened page behind — later commands must hit the
      // "navigate first" guard rather than act on a blank/errored page.
      await newtabPage?.close().catch(() => {});
      newtabPage = null;
      fail('ERROR navigating:', e.message);
    }
  },

  // ── Seeding (starting-point bookmark data) ──────────────────────────────
  // Run AFTER navigate. Each seeder wipes existing bookmarks/onboarding,
  // installs its data, then reloads the newtab page so it's visible.

  // Rich 5-workspace world (Work/Personal/AI/Design/Gaming) + dock, from the
  // promo seed data. Best default for exercising a real, populated UI.
  async 'seed-promo'() {
    if (!newtabPage) return fail('ERROR: navigate first');
    try {
      const { lib } = await loadHelpers();
      await lib.skipOnboarding(newtabPage);
      await lib.clearAllBookmarks(newtabPage);
      await lib.seedPromoWorkspaces(newtabPage);
      await newtabPage.reload();
      await newtabPage.waitForSelector('.ff-app', { timeout: 15_000 });
      console.log('seeded promo world (Work active; Personal/AI/Design/Gaming) + dock');
    } catch (e) {
      fail('ERROR seeding promo:', e.message);
    }
  },

  // Lean single workspace: N flat bookmarks (default 6). Args: [count].
  // Predictable titles "BM 01"… for deterministic assertions.
  async 'seed-minimal'(arg) {
    if (!newtabPage) return fail('ERROR: navigate first');
    try {
      const count = parseInt(arg, 10) > 0 ? parseInt(arg, 10) : 6;
      const { lib, DEFAULT_WORKSPACE_SETTINGS } = await loadHelpers();
      await lib.skipOnboarding(newtabPage);
      await lib.clearAllBookmarks(newtabPage);
      await newtabPage.evaluate(async ({ n, defaults }) => {
        const a = globalThis.browser ?? globalThis.chrome;
        const root = await a.bookmarks.create({ parentId: '2', title: 'Minimal' });
        for (let i = 0; i < n; i++) {
          await a.bookmarks.create({
            parentId: root.id,
            title: `BM ${String(i + 1).padStart(2, '0')}`,
            url: `https://example.com/${i + 1}`,
          });
        }
        const record = { ...defaults, id: 'ws-minimal', name: 'Minimal', rootFolderId: root.id };
        await a.runtime.sendMessage({ type: 'workspaces/create', workspace: record });
        await a.runtime.sendMessage({
          type: 'settings/patch',
          patch: { activeWorkspaceId: 'ws-minimal', workspaceOrder: ['ws-minimal'], rememberLastFolder: false },
        });
      }, { n: count, defaults: DEFAULT_WORKSPACE_SETTINGS });
      await newtabPage.reload();
      await newtabPage.waitForSelector('.ff-app', { timeout: 15_000 });
      console.log(`seeded minimal world: ${count} bookmarks`);
    } catch (e) {
      fail('ERROR seeding minimal:', e.message);
    }
  },

  // Wipe all bookmarks + workspace records (back to empty).
  async clear() {
    if (!newtabPage) return fail('ERROR: navigate first');
    try {
      const { lib } = await loadHelpers();
      await lib.clearAllBookmarks(newtabPage);
      await newtabPage.evaluate(async () => {
        const a = globalThis.browser ?? globalThis.chrome;
        const res = await a.runtime.sendMessage({ type: 'workspaces/get-all' });
        for (const ws of res.workspaces) {
          await a.runtime.sendMessage({ type: 'workspaces/delete', id: ws.id });
        }
      });
      console.log('cleared all bookmarks + workspaces (reload to see)');
    } catch (e) {
      fail('ERROR clearing:', e.message);
    }
  },

  // Dismiss onboarding without seeding (writes completed state + reloads).
  async 'skip-onboarding'() {
    if (!newtabPage) return fail('ERROR: navigate first');
    try {
      const { lib } = await loadHelpers();
      await lib.skipOnboarding(newtabPage);
      await newtabPage.reload();
      await newtabPage.waitForSelector('.ff-app', { timeout: 15_000 });
      console.log('onboarding skipped');
    } catch (e) {
      fail('ERROR skipping onboarding:', e.message);
    }
  },

  async screenshot(name) {
    if (!newtabPage) return fail('ERROR: navigate first');

    try {
      const filename = (name || `ss-${Date.now()}`) + '.png';
      const filepath = join(SHOT_DIR, filename);
      await newtabPage.screenshot({ path: filepath });
      console.log(`screenshot: ${filepath}`);
    } catch (e) {
      fail('ERROR taking screenshot:', e.message);
    }
  },

  async click(selector) {
    if (!newtabPage) return fail('ERROR: navigate first');

    try {
      const result = await newtabPage.evaluate(sel => {
        const el = document.querySelector(sel);
        if (!el) return 'NOT_FOUND';
        el.click();
        return 'OK';
      }, selector);
      console.log(`click "${selector}" → ${result}`);
    } catch (e) {
      fail('ERROR clicking:', e.message);
    }
  },

  async 'click-text'(text) {
    if (!newtabPage) return fail('ERROR: navigate first');

    try {
      const result = await newtabPage.evaluate(t => {
        const els = [...document.querySelectorAll('button, a, [role="button"]')];
        const el = els.find(e => e.textContent?.trim() === t) ||
                   els.find(e => e.textContent?.includes(t));
        if (!el) return 'NOT_FOUND';
        el.click();
        return `OK: ${el.tagName}`;
      }, text);
      console.log(`click-text "${text}" → ${result}`);
    } catch (e) {
      fail('ERROR clicking text:', e.message);
    }
  },

  async fill(args) {
    if (!newtabPage) return fail('ERROR: navigate first');
    // Both dispatchers pass one space-joined argument string; the selector is its first word.
    const [selector, ...words] = args.split(' ');
    const text = words.join(' ');

    try {
      const loc = newtabPage.locator(selector).first();
      await loc.fill(text);
      console.log(`filled "${selector}" with "${text}"`);
    } catch (e) {
      fail('ERROR filling:', e.message);
    }
  },

  async type(text) {
    if (!newtabPage) return fail('ERROR: navigate first');

    try {
      await newtabPage.keyboard.type(text, { delay: 30 });
      console.log(`typed: ${text}`);
    } catch (e) {
      fail('ERROR typing:', e.message);
    }
  },

  async press(key) {
    if (!newtabPage) return fail('ERROR: navigate first');

    try {
      await newtabPage.keyboard.press(key);
      console.log(`pressed: ${key}`);
    } catch (e) {
      fail('ERROR pressing key:', e.message);
    }
  },

  async wait(selector) {
    if (!newtabPage) return fail('ERROR: navigate first');

    try {
      await newtabPage.waitForSelector(selector, { timeout: 10_000 });
      console.log(`found: ${selector}`);
    } catch (e) {
      console.log(`TIMEOUT: ${selector}`);
    }
  },

  async eval(expression) {
    if (!newtabPage) return fail('ERROR: navigate first');

    try {
      const result = await newtabPage.evaluate(expression);
      console.log(JSON.stringify(result));
    } catch (e) {
      fail('ERROR:', e.message);
    }
  },

  async text(selector) {
    if (!newtabPage) return fail('ERROR: navigate first');

    try {
      const text = await newtabPage.evaluate(sel => {
        const el = sel ? document.querySelector(sel) : document.body;
        return el?.innerText ?? '(null)';
      }, selector || null);
      console.log(text);
    } catch (e) {
      fail('ERROR:', e.message);
    }
  },

  async 'console-errors'() {
    if (!newtabPage) return fail('ERROR: navigate first');

    try {
      const errors = [];
      newtabPage.on('console', msg => {
        if (msg.type() === 'error') errors.push(msg.text());
      });
      // Give it a moment to collect errors, then report
      await new Promise(r => setTimeout(r, 1000));
      console.log(`console errors: ${errors.length}`);
      errors.forEach(e => console.log(`  ${e}`));
    } catch (e) {
      fail('ERROR:', e.message);
    }
  },

  async url() {
    if (!newtabPage) return fail('ERROR: navigate first');
    console.log(newtabPage.url());
  },

  async 'network-errors'() {
    if (!newtabPage) return fail('ERROR: navigate first');

    try {
      const failures = [];
      newtabPage.on('response', response => {
        if (response.status() >= 400) {
          failures.push(`${response.status()} ${response.url()}`);
        }
      });
      // Give it a moment, then report
      await new Promise(r => setTimeout(r, 1000));
      console.log(`network failures: ${failures.length}`);
      failures.forEach(f => console.log(`  ${f}`));
    } catch (e) {
      fail('ERROR:', e.message);
    }
  },

  async reload() {
    if (!newtabPage) return fail('ERROR: navigate first');

    try {
      await newtabPage.reload();
      console.log('page reloaded');
    } catch (e) {
      fail('ERROR reloading:', e.message);
    }
  },

  async quit() {
    if (newtabPage) await newtabPage.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (profileDir) await rm(profileDir, { recursive: true, force: true }).catch(() => {});
    console.log('quit');
    process.exit(hadError ? 1 : 0);
  },

  help() {
    console.log('Commands:');
    Object.keys(COMMANDS).forEach(cmd => {
      console.log(`  ${cmd}`);
    });
  },
};

// Batch / script mode (agent path): `node driver.mjs --run commands.txt`
// Executes each non-empty, non-`#` line sequentially (awaited — no REPL race), then quits.
const runIdx = process.argv.indexOf('--run');
if (runIdx !== -1) {
  const scriptPath = process.argv[runIdx + 1];
  if (!scriptPath || !fs.existsSync(scriptPath)) {
    fail(`ERROR: --run needs a readable command file (got: ${scriptPath})`);
    process.exit(1);
  }
  const lines = fs
    .readFileSync(scriptPath, 'utf8')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
  for (const line of lines) {
    const [cmd, ...rest] = line.split(/\s+/);
    const fn = COMMANDS[cmd];
    if (!fn) {
      fail(`unknown: "${cmd}"`);
      continue;
    }
    console.log(`> ${line}`);
    await fn(rest.join(' '));
  }
  await COMMANDS.quit();
}

// Create readline interface
// On Windows, process.stdin works directly; on Unix, /dev/stdin works better
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'driver> ',
});

rl.on('line', async line => {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  if (!cmd) return rl.prompt();

  const fn = COMMANDS[cmd];
  if (!fn) {
    console.log(`unknown: "${cmd}" — try: help`);
    return rl.prompt();
  }

  try {
    await fn(rest.join(' '));
  } catch (e) {
    console.log('ERROR:', e.message);
  }

  if (cmd === 'quit') {
    rl.close();
    process.exit(0);
  }
  rl.prompt();
});

rl.on('close', async () => {
  await COMMANDS.quit().catch(() => {});
  process.exit(0);
});

console.log('Flipp\'s Favorites extension driver');
console.log(`Screenshots → ${SHOT_DIR}`);
console.log('Type "help" for commands, "launch" to start');
rl.prompt();
