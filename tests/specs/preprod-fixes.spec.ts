/**
 * Regression coverage for the pre-production fix batch. Each test pins a
 * user-visible behaviour that an audit flagged, so a future change that
 * reintroduces the bug fails here:
 *  - URL scheme validation no longer mangles non-http(s) input (NF1/L1)
 *  - an empty workspace shows guidance, not a blank canvas (H2)
 *  - deleting a single bookmark is reversible via an Undo toast (NF2/M2)
 *  - global search tags foreign-workspace hits and hides root folders (H1/NF4)
 *  - the `w` shortcut respects the workspace limit (NF3)
 *  - dialogs trap keyboard focus (M4)
 */
import { test, expect } from '../fixtures/world.js';
import type { Page } from '@playwright/test';
import { MAX_WORKSPACES } from '@/shared/constants.js';

const WS_DEFAULTS = {
  themeMode: 'system', accentColor: '#3F72DC', backgroundMode: 'gradient', solidBackgroundColor: '',
  gradientStyle: 'top', gradientColorSource: 'accent', gradientCustomColor: '#3F72DC', gradientIntensity: 100,
  backgroundOpacity: 70, backgroundFitMode: 'cover', backgroundPositionMode: 'center', layoutPreset: 'balanced',
  favoritesColumnGap: 24, favoritesRowGap: 20, bookmarkTileWidth: 130, bookmarkIconSize: 75,
  tileShape: 'squircle', showTileLabels: true,
} as const;

interface SeedWorkspace { id: string; name: string; bookmarks: { title: string; url: string }[] }

async function seed(page: Page, specs: SeedWorkspace[]): Promise<void> {
  await page.evaluate(async (args) => {
    const { specs, defaults } = args;
    const api = (globalThis as any).browser ?? (globalThis as any).chrome;
    await api.storage.local.set({ 'onboarding-state': { status: 'completed', updatedAt: 1 } });
    const order: string[] = [];
    for (const ws of specs) {
      const root = await api.bookmarks.create({ parentId: '2', title: ws.name });
      for (const b of ws.bookmarks) await api.bookmarks.create({ parentId: root.id, title: b.title, url: b.url });
      await api.runtime.sendMessage({ type: 'workspaces/create', workspace: { ...defaults, id: ws.id, name: ws.name, rootFolderId: root.id } });
      order.push(ws.id);
    }
    await api.runtime.sendMessage({ type: 'settings/patch', patch: { activeWorkspaceId: order[0], workspaceOrder: order, rememberLastFolder: false, showSearchBar: true } });
  }, { specs, defaults: WS_DEFAULTS });
}

async function reload(page: Page): Promise<void> {
  await page.reload();
  await page.waitForSelector('.ff-app', { timeout: 30_000 });
}

test.describe('preprod fixes', () => {
  test.slow();

  test('URL validation: scheme inputs are never mangled into junk https bookmarks', async ({ freshPage }) => {
    await seed(freshPage, [{ id: 'ws-fix', name: 'Fix', bookmarks: [{ title: 'Alpha', url: 'https://alpha.example' }] }]);
    await reload(freshPage);

    // Informational: which schemes Chrome's bookmarks API actually accepts.
    const accepted = await freshPage.evaluate(async () => {
      const api = (globalThis as any).browser ?? (globalThis as any).chrome;
      const out: Record<string, string> = {};
      for (const u of ['chrome://flags', 'edge://settings', 'about:blank', 'file:///etc/hosts']) {
        try {
          const b = await api.bookmarks.create({ parentId: '1', title: 'probe', url: u });
          out[u] = `ACCEPTED:${b.url}`;
          await api.bookmarks.remove(b.id);
        } catch (e) {
          out[u] = `REJECTED:${e instanceof Error ? e.message : String(e)}`;
        }
      }
      return out;
    });
    console.log('SCHEME-ACCEPT', JSON.stringify(accepted));

    const urlInput = freshPage.locator('input[type="url"].ff-input');
    const submitAdd = async (value: string) => {
      await freshPage.getByRole('button', { name: 'Add', exact: true }).click();
      await freshPage.locator('.ff-ctx[role="menu"]').waitFor({ timeout: 5_000 });
      await freshPage.getByRole('menuitem', { name: /Add bookmark/ }).click();
      await urlInput.waitFor({ timeout: 5_000 });
      await urlInput.fill(value);
      await freshPage.locator('.ff-dialog button[type="submit"]').click();
      // Wait for form processing: dialog closes if valid, stays open if invalid.
      // Wait for the dialog to either become hidden (valid) or remain visible (invalid).
      await Promise.race([
        freshPage.locator('.ff-dialog').waitFor({ state: 'hidden', timeout: 400 }).catch(() => {}),
        freshPage.waitForTimeout(400)
      ]);
      // If the dialog stayed open (rejected input), close it and wait for it to go.
      if (await urlInput.count() > 0) {
        await freshPage.keyboard.press('Escape');
        await urlInput.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {});
      }
    };
    const hasUrl = (needle: string) => freshPage.evaluate(async (n) => {
      const api = (globalThis as any).browser ?? (globalThis as any).chrome;
      const tree = await api.bookmarks.getTree();
      let ok = false;
      const walk = (nodes: any[]) => { for (const x of nodes) { if (typeof x.url === 'string' && x.url.startsWith(n)) ok = true; if (x.children) walk(x.children); } };
      walk(tree);
      return ok;
    }, needle);

    // chrome:// is allowed and stored verbatim — NOT coerced to https://chrome://…
    // (proves the add dialog persists a scheme'd URL un-mangled).
    await submitAdd('chrome://flags');
    expect(await hasUrl('chrome://flags')).toBe(true);
    expect(await hasUrl('https://chrome://flags')).toBe(false);

    // Disallowed schemes are rejected, never mangled into a junk https URL.
    await submitAdd('mailto:a@b.com');
    expect(await hasUrl('https://mailto:')).toBe(false);
    await submitAdd('ftp://x.com');
    expect(await hasUrl('https://ftp://')).toBe(false);
    // Bare-host coercion ("example.org" -> "https://example.org") is covered by
    // the unit matrix in tests/unit/lib/url-validation.test.ts.
  });

  test('empty workspace shows an empty-state with an Add button', async ({ freshPage }) => {
    await seed(freshPage, [{ id: 'ws-empty', name: 'Empty', bookmarks: [] }]);
    await reload(freshPage);
    // Wait for the empty state to appear after reload.
    await expect(freshPage.locator('.ff-empty')).toBeVisible();
    await expect(freshPage.locator('.ff-empty button', { hasText: 'Add bookmark' })).toBeVisible();
    expect(await freshPage.locator('[data-item-id]').count()).toBe(0);
  });

  test('single delete is reversible via an Undo toast', async ({ freshPage }) => {
    await seed(freshPage, [{ id: 'ws-del', name: 'Del', bookmarks: [
      { title: 'Alpha', url: 'https://alpha.example' },
      { title: 'Bravo', url: 'https://bravo.example' },
      { title: 'Charlie', url: 'https://charlie.example' },
    ] }]);
    await reload(freshPage);

    await freshPage.locator('.ff-tile[title="Charlie"]').click({ button: 'right' });
    await freshPage.locator('.ff-ctx[role="menu"]').waitFor({ timeout: 5_000 });
    await freshPage.getByRole('menuitem', { name: /^Delete/ }).click();

    const toast = freshPage.locator('.ff-toast');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('Deleted');
    expect(await freshPage.locator('.ff-tile[title="Charlie"]').count()).toBe(0);

    await freshPage.locator('.ff-toast__action', { hasText: 'Undo' }).click();
    await expect(freshPage.locator('.ff-tile[title="Charlie"]')).toBeVisible({ timeout: 8_000 });
  });

  test('search tags foreign-workspace results and hides workspace root folders', async ({ freshPage }) => {
    await seed(freshPage, [
      { id: 'ws-a', name: 'Work', bookmarks: [{ title: 'Repo One', url: 'https://github.com/acme/one' }] },
      { id: 'ws-b', name: 'Personal', bookmarks: [{ title: 'BankThing', url: 'https://bank.example' }] },
    ]);
    await reload(freshPage);
    const input = freshPage.locator('input[aria-label="Search bookmarks"]').first();

    // foreign result (in "Personal") carries the workspace tag — rendered as
    // a "· {workspaceName}" suffix on the result's path line.
    await input.click();
    await input.fill('bankthing');
    const foreign = freshPage.locator('.ff-results__item', { hasText: 'BankThing' });
    await expect(foreign).toBeVisible();
    await expect(foreign).toContainText('· Personal');

    // same-workspace result has no workspace tag (no "·" separator added)
    await input.fill('');
    await input.fill('repo one');
    const local = freshPage.locator('.ff-results__item', { hasText: 'Repo One' });
    await expect(local).toBeVisible();
    await expect(local).not.toContainText('·');

    // the workspace root folders are excluded from the index — searching a name
    // that only the root folder "Personal" matches yields no results.
    await input.fill('');
    await input.fill('Personal');
    // Wait for search results to update or confirm no results appear.
    // Use expect.poll to wait for the result count to settle.
    await expect(async () => {
      const count = await freshPage.locator('.ff-results__item').count();
      expect(count).toBe(0);
    }).toPass({ timeout: 300 });
  });

  test('`w` shortcut does nothing at the workspace limit', async ({ freshPage }) => {
    const specs = Array.from({ length: MAX_WORKSPACES }, (_, i) => ({ id: `ws-${i}`, name: `WS ${i}`, bookmarks: [{ title: `b${i}`, url: `https://w${i}.example` }] }));
    await seed(freshPage, specs);
    await reload(freshPage);
    expect(await freshPage.locator('[data-workspace-id]').count()).toBe(MAX_WORKSPACES);

    await freshPage.locator('main.ff-canvas').click({ position: { x: 6, y: 6 } });
    await freshPage.keyboard.press('w');
    // REVIEWED, INTENTIONAL exception to the no-blind-wait convention: this is an
    // absence assertion (the 'w' shortcut must NOT open "New workspace" at the cap),
    // so there is no positive event to poll/wait on instead — a fixed settle window
    // is the only way to give a would-be (buggy) dialog open time to happen before
    // asserting it didn't.
    await freshPage.waitForTimeout(400);
    expect(await freshPage.getByText('New workspace', { exact: false }).count()).toBe(0);
  });

  test('dialogs trap keyboard focus', async ({ freshPage }) => {
    await seed(freshPage, [{ id: 'ws-trap', name: 'Trap', bookmarks: [{ title: 'Alpha', url: 'https://alpha.example' }] }]);
    await reload(freshPage);

    await freshPage.getByRole('button', { name: 'Add', exact: true }).click();
    await freshPage.locator('.ff-ctx[role="menu"]').waitFor({ timeout: 5_000 });
    await freshPage.getByRole('menuitem', { name: /Add bookmark/ }).click();
    await freshPage.locator('.ff-dialog[role="dialog"]').waitFor({ timeout: 5_000 });

    for (let i = 0; i < 8; i++) await freshPage.keyboard.press('Tab');
    const inside = await freshPage.evaluate(() => {
      const dialog = document.querySelector('.ff-dialog[role="dialog"]');
      return !!dialog && dialog.contains(document.activeElement);
    });
    expect(inside).toBe(true);
  });
});
