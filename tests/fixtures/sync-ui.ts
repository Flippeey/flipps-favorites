// Harness-agnostic driver for the settings-sync UI (Settings > Backup > Sync).
//
// Everything runs through `page.evaluate`, which Playwright and Puppeteer
// share, so one set of steps drives Chrome under Playwright, and Chrome or
// Firefox under Puppeteer (where Firefox's moz-extension pages rule out
// Playwright locators). Each harness wraps its page once with a SyncPage
// adapter; the specs then read the same on every browser.
import type { AppSettings, WorkspaceRecord } from '@/shared/models';
import { DEFAULT_WORKSPACE_SETTINGS } from './test-data.js';

export interface SyncPage {
  evaluate<A, R>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
  /** Reload the newtab page and wait for the app shell to remount. */
  reload(): Promise<void>;
}

const UI_TIMEOUT_MS = 20_000;
const SEEN_TOAST_ATTR = 'data-sync-driver-seen';

interface WaitQuery {
  selector: string;
  /** Substring the element's text must contain. */
  text?: string;
  /** Click the element once it is present and enabled. */
  click?: boolean;
}

/**
 * Wait (inside the page) for an enabled element matching `query`, optionally
 * click it, and return its text. Polling in-page keeps one round trip per
 * step on both harnesses.
 */
export async function waitFor(page: SyncPage, query: WaitQuery, timeoutMs = UI_TIMEOUT_MS): Promise<string> {
  return page.evaluate(async (q) => {
    const deadline = Date.now() + q.timeoutMs;
    for (;;) {
      const match = Array.from(document.querySelectorAll<HTMLElement>(q.selector)).find(
        (el) => (q.text === undefined || (el.textContent ?? '').includes(q.text)) && !(el as HTMLButtonElement).disabled,
      );
      if (match) {
        if (q.click) match.click();
        return match.textContent ?? '';
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for ${q.selector}${q.text === undefined ? '' : ` containing "${q.text}"`}`);
      }
      await new Promise((resolveTick) => setTimeout(resolveTick, 50));
    }
  }, { ...query, timeoutMs });
}

/** Run `action` and return the text of the first toast that appears after it. */
export async function withNewToast(page: SyncPage, action: () => Promise<unknown>): Promise<string> {
  await page.evaluate((attr) => {
    document.querySelectorAll('.ff-toast').forEach((toast) => toast.setAttribute(attr, ''));
  }, SEEN_TOAST_ATTR);
  await action();
  return waitFor(page, { selector: `.ff-toast:not([${SEEN_TOAST_ATTR}]) .ff-toast__msg` });
}

export async function openSyncSettings(page: SyncPage): Promise<void> {
  await waitFor(page, { selector: '[aria-label="Settings"]', click: true });
  await waitFor(page, { selector: '.ff-drawer__navitem', text: 'Backup', click: true });
  await waitFor(page, { selector: '[data-testid="sync-now-button"]' });
}

/** Press Sync now and return the resulting toast text. */
export async function syncNow(page: SyncPage): Promise<string> {
  return withNewToast(page, () => waitFor(page, { selector: '[data-testid="sync-now-button"]', click: true }));
}

export async function lastSyncedCaption(page: SyncPage): Promise<string> {
  return waitFor(page, { selector: '[data-testid="last-synced-caption"]' });
}

export async function revealPairingCode(page: SyncPage): Promise<string> {
  const shown = await page.evaluate(
    () => document.querySelector('[data-testid="pairing-code-value"] code') !== null,
    undefined,
  );
  if (!shown) await waitFor(page, { selector: '[data-testid="reveal-pairing-code-button"]', click: true });
  return (await waitFor(page, { selector: '[data-testid="pairing-code-value"] code' })).trim();
}

/** Type a pairing code into "Link another browser" and submit it. */
export async function submitPairingCode(page: SyncPage, code: string): Promise<void> {
  await page.evaluate((value) => {
    const input = document.querySelector<HTMLInputElement>('[data-testid="link-pairing-code-input"]');
    if (!input) throw new Error('Pairing code input not found');
    // React tracks the value through the native setter; assigning .value directly is ignored.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, code);
  await waitFor(page, { selector: '[data-testid="link-browser-submit"]', click: true });
}

/** Text of the link preview's change summary. */
export async function linkPreviewSummary(page: SyncPage): Promise<string> {
  return waitFor(page, { selector: '[data-testid="link-preview-summary"]' });
}

/** Confirm the link preview dialog and return the resulting toast text. */
export async function confirmLink(page: SyncPage): Promise<string> {
  return withNewToast(page, () => waitFor(page, { selector: '[data-testid="link-preview-confirm"]', click: true }));
}

/** Inline validation error under the pairing code input. */
export async function linkError(page: SyncPage): Promise<string> {
  return waitFor(page, { selector: '.ff-status[data-kind="error"][role="alert"]' });
}

export async function isLinkPreviewOpen(page: SyncPage): Promise<boolean> {
  return page.evaluate(() => document.querySelector('[data-testid="link-preview-confirm"]') !== null, undefined);
}

export interface SyncProfileSeed {
  /** Workspace name; its bookmark folder gets the same title so another browser can re-match it. */
  workspaceName: string;
  bookmarks: { title: string; url: string }[];
  workspace?: Partial<Omit<WorkspaceRecord, 'id' | 'name' | 'rootFolderId'>>;
  /** Stored as this workspace's wallpaper (only exported when backgroundMode is 'wallpaper'). */
  wallpaperDataUrl?: string;
}

export interface SeededSyncProfile {
  workspaceId: string;
  folderId: string;
}

/**
 * Seed a fresh profile for sync: onboarding completed, one bookmark folder,
 * and one workspace on it, then reload so the app boots into that state.
 */
export async function seedSyncProfile(page: SyncPage, seed: SyncProfileSeed): Promise<SeededSyncProfile> {
  const workspaceId = `ws-${seed.workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const seeded = await page.evaluate(async (data) => {
    type Api = {
      bookmarks: {
        getTree(): Promise<{ id: string; title: string; children?: { id: string; title: string }[] }[]>;
        create(b: { parentId: string; title: string; url?: string }): Promise<{ id: string }>;
      };
      runtime: { sendMessage(message: unknown): Promise<unknown> };
      storage: { local: { set(items: Record<string, unknown>): Promise<void> } };
    };
    const api = (globalThis as unknown as { browser?: Api; chrome: Api }).browser
      ?? (globalThis as unknown as { chrome: Api }).chrome;
    const now = Date.now();
    await api.storage.local.set({
      'onboarding-state': {
        version: 2,
        status: 'completed',
        updatedAt: now,
        completedAt: now,
        skippedAt: now,
        recommendedArchetype: null,
        chosenArchetype: 'skipped',
      },
    });
    const roots = (await api.bookmarks.getTree())[0]?.children ?? [];
    const parent = roots.find((node) => /other|unfiled/i.test(node.title)) ?? roots[1] ?? roots[0];
    if (!parent) throw new Error('No bookmark root to seed under');
    const folder = await api.bookmarks.create({ parentId: parent.id, title: data.workspaceName });
    for (const bookmark of data.bookmarks) {
      await api.bookmarks.create({ parentId: folder.id, title: bookmark.title, url: bookmark.url });
    }
    await api.runtime.sendMessage({
      type: 'workspaces/create',
      workspace: { ...data.defaults, ...data.workspace, id: data.workspaceId, name: data.workspaceName, rootFolderId: folder.id },
    });
    if (data.wallpaperDataUrl) {
      await api.storage.local.set({ [`app-wallpaper-${data.workspaceId}`]: data.wallpaperDataUrl });
    }
    await api.runtime.sendMessage({
      type: 'settings/patch',
      patch: { activeWorkspaceId: data.workspaceId, workspaceOrder: [data.workspaceId], rememberLastFolder: false },
    });
    return { folderId: folder.id };
  }, {
    defaults: DEFAULT_WORKSPACE_SETTINGS,
    workspace: seed.workspace ?? {},
    workspaceId,
    workspaceName: seed.workspaceName,
    bookmarks: seed.bookmarks,
    wallpaperDataUrl: seed.wallpaperDataUrl ?? '',
  });
  await page.reload();
  return { workspaceId, folderId: seeded.folderId };
}

/** Workspace records the background currently holds. */
export async function readWorkspaces(page: SyncPage): Promise<WorkspaceRecord[]> {
  return page.evaluate(async () => {
    type Api = { runtime: { sendMessage(message: unknown): Promise<unknown> } };
    const api = (globalThis as unknown as { browser?: Api; chrome: Api }).browser
      ?? (globalThis as unknown as { chrome: Api }).chrome;
    const res = (await api.runtime.sendMessage({ type: 'workspaces/get-all' })) as { workspaces: WorkspaceRecord[] };
    return res.workspaces;
  }, undefined);
}

export async function readSettings(page: SyncPage): Promise<AppSettings> {
  return page.evaluate(async () => {
    type Api = { runtime: { sendMessage(message: unknown): Promise<unknown> } };
    const api = (globalThis as unknown as { browser?: Api; chrome: Api }).browser
      ?? (globalThis as unknown as { chrome: Api }).chrome;
    const res = (await api.runtime.sendMessage({ type: 'settings/get' })) as { settings: AppSettings };
    return res.settings;
  }, undefined);
}
