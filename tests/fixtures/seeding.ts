// Typed seeding helpers for the Playwright suite. All state is created through
// the same message pipeline the app uses (settings/patch, workspaces/create…)
// so the service worker's stores stay the source of truth. Typed against the
// shared models — no `any` at the page.evaluate boundary.
import type { Page } from '@playwright/test';
import type { AppSettings, WorkspaceRecord } from '../../src/shared/models';
import { PROMO_WORKSPACES, DOCK_BOOKMARKS } from '../../src/shared/seed-data.js';
import { DEFAULT_WORKSPACE_SETTINGS, STORAGE_KEYS } from './test-data.js';

export type PromoPersona = 'Work' | 'Personal' | 'AI' | 'Design' | 'Gaming';

export interface SeededWorld {
  origin: string;
  /** All workspace records as the service worker reports them. */
  workspaces: WorkspaceRecord[];
  /** Persona name → workspace id (e.g. 'Work' → 'promo-work'). */
  workspaceIds: Record<PromoPersona, string>;
  /** Root bookmark folder id of the active (Work) workspace. */
  rootFolderId: string;
  /** Bookmark folder id backing the dock. */
  dockFolderId: string;
  /**
   * Stable id lookup for the active workspace's root-level bookmarks/folders,
   * keyed by title. Throws if the title was not seeded.
   */
  bookmarkIdByTitle: (title: string) => string;
}

// Minimal shape of the extension API surface used inside page.evaluate. Casting
// `globalThis` to this (via `unknown`) keeps the boundary typed without `any`.
interface ExtBookmarkNode {
  id: string;
  title: string;
  url?: string;
}
interface ExtApi {
  bookmarks: {
    create(b: { parentId: string; title: string; url?: string }): Promise<ExtBookmarkNode>;
    removeTree(id: string): Promise<void>;
    getChildren(id: string): Promise<ExtBookmarkNode[]>;
  };
  runtime: { sendMessage(message: unknown): Promise<unknown> };
  storage: {
    local: {
      set(items: Record<string, unknown>): Promise<void>;
      get(keys?: string | string[]): Promise<Record<string, unknown>>;
      remove(keys: string | string[]): Promise<void>;
    };
    sync: { remove(keys: string | string[]): Promise<void> };
  };
}

/**
 * Clear all extension state so a worker starts from a known baseline: settings,
 * workspaces, onboarding, icon caches, and every per-workspace wallpaper key
 * (`app-wallpaper-*`, which CachedValueStore never tracks).
 */
export async function resetStorage(page: Page): Promise<void> {
  // Delete every workspace record via the message pipeline first. Production
  // stores each WorkspaceRecord under its own per-item sync key
  // (`workspace:<id>`, see src/shared/storage.ts) rather than the legacy
  // aggregate `keys.workspaces` key cleared below — the sync.remove([...,
  // keys.workspaces]) call never touches those per-item keys, so ad-hoc
  // workspaces (e.g. seedMinimal's 'ws-minimal') would otherwise leak into
  // the next test in this worker-scoped context.
  await clearWorkspaces(page);
  await page.evaluate(async (keys) => {
    const api = (globalThis as unknown as { browser?: ExtApi; chrome: ExtApi }).browser
      ?? (globalThis as unknown as { chrome: ExtApi }).chrome;
    const all = await api.storage.local.get();
    const wallpaperKeys = Object.keys(all).filter((k) => k.startsWith('app-wallpaper'));
    await api.storage.local.remove([...Object.values(keys), ...wallpaperKeys]);
    try {
      await api.storage.sync.remove([keys.appSettings]);
    } catch {
      await api.storage.local.remove([keys.appSettings]);
    }
    // Purge the bookmark tree too. Seeders create folders under the bookmarks
    // bar ('1') and other-bookmarks ('2'); without this, every reseed stacks
    // duplicate folders in the same worker profile, making count/search
    // assertions accumulate across tests.
    for (const rootId of ['1', '2']) {
      const children = await api.bookmarks.getChildren(rootId);
      for (const child of children) {
        await api.bookmarks.removeTree(child.id);
      }
    }
  }, STORAGE_KEYS);
}

/** Patch global app settings via the message pipeline. Caller must reload. */
export async function patchSettings(page: Page, patch: Partial<AppSettings>): Promise<void> {
  await page.evaluate(async (p) => {
    const api = (globalThis as unknown as { browser?: ExtApi; chrome: ExtApi }).browser
      ?? (globalThis as unknown as { chrome: ExtApi }).chrome;
    await api.runtime.sendMessage({ type: 'settings/patch', patch: p });
  }, patch);
}

/** Patch a workspace record's visual/layout fields. Caller must reload. */
export async function patchWorkspace(
  page: Page,
  id: string,
  patch: Partial<WorkspaceRecord>,
): Promise<void> {
  await page.evaluate(async (args) => {
    const api = (globalThis as unknown as { browser?: ExtApi; chrome: ExtApi }).browser
      ?? (globalThis as unknown as { chrome: ExtApi }).chrome;
    await api.runtime.sendMessage({ type: 'workspaces/patch', id: args.id, patch: args.patch });
  }, { id, patch });
}

/** Create a workspace record via the message pipeline. */
export async function createWorkspace(page: Page, workspace: WorkspaceRecord): Promise<void> {
  await page.evaluate(async (ws) => {
    const api = (globalThis as unknown as { browser?: ExtApi; chrome: ExtApi }).browser
      ?? (globalThis as unknown as { chrome: ExtApi }).chrome;
    await api.runtime.sendMessage({ type: 'workspaces/create', workspace: ws });
  }, workspace);
}

/** Read the settings the service worker currently holds (committed state). */
export async function getSettings(page: Page): Promise<AppSettings> {
  return page.evaluate(async () => {
    const api = (globalThis as unknown as { browser?: ExtApi; chrome: ExtApi }).browser
      ?? (globalThis as unknown as { chrome: ExtApi }).chrome;
    const res = (await api.runtime.sendMessage({ type: 'settings/get' })) as {
      settings: AppSettings;
    };
    return res.settings;
  });
}

/**
 * Poll the service worker's committed settings until `predicate` holds, so a
 * test can reload without racing the async `settings/patch` write. Throws after
 * ~4s if the change never commits (fail loud rather than reload stale state).
 */
export async function waitForSettings(
  page: Page,
  predicate: (settings: AppSettings) => boolean,
): Promise<void> {
  const deadline = Date.now() + 4000;
  for (;;) {
    if (predicate(await getSettings(page))) return;
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for settings to commit');
    }
    await page.waitForTimeout(50);
  }
}

/**
 * Poll the service worker's committed workspace records until `predicate` holds
 * for the record with `id`, so a test can reload without racing the async
 * `workspaces/patch` write. The per-workspace counterpart to `waitForSettings`
 * (view/sort fields live on WorkspaceRecord, not AppSettings). Throws after ~4s
 * if the change never commits (fail loud rather than reload stale state).
 */
export async function waitForWorkspace(
  page: Page,
  id: string,
  predicate: (workspace: WorkspaceRecord) => boolean,
): Promise<void> {
  const deadline = Date.now() + 4000;
  for (;;) {
    const record = (await getWorkspaces(page)).find((w) => w.id === id);
    if (record && predicate(record)) return;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for workspace "${id}" to commit`);
    }
    await page.waitForTimeout(50);
  }
}

/** Read all workspace records the service worker currently holds. */
export async function getWorkspaces(page: Page): Promise<WorkspaceRecord[]> {
  return page.evaluate(async () => {
    const api = (globalThis as unknown as { browser?: ExtApi; chrome: ExtApi }).browser
      ?? (globalThis as unknown as { chrome: ExtApi }).chrome;
    const res = (await api.runtime.sendMessage({ type: 'workspaces/get-all' })) as {
      workspaces: WorkspaceRecord[];
    };
    return res.workspaces;
  });
}

/**
 * Delete all workspace records via the message pipeline so a test that needs
 * a clean workspace list (e.g. the MAX_WORKSPACES cap test, which dismisses
 * onboarding first and then seeds its own workspaces) can start from zero
 * without relaunching the browser or resetting all storage.
 */
export async function clearWorkspaces(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const api = (globalThis as unknown as { browser?: ExtApi; chrome: ExtApi }).browser
      ?? (globalThis as unknown as { chrome: ExtApi }).chrome;
    const res = (await api.runtime.sendMessage({ type: 'workspaces/get-all' })) as {
      workspaces: { id: string }[];
    };
    for (const ws of res.workspaces) {
      await api.runtime.sendMessage({ type: 'workspaces/delete', id: ws.id });
    }
  });
}

/**
 * Dismiss the onboarding dialog and clear any workspace side-effects it
 * creates. Use this in tests whose subject is NOT the onboarding Skip
 * behaviour itself — e.g. workspace-cap tests that must first get past
 * the dialog before seeding their own deterministic workspace set.
 *
 * WHY: clicking Skip on a fresh install creates a default "Favorites"
 * workspace (PR #29 feature — correct product behaviour). Tests that seed
 * their own workspaces afterward would otherwise find an extra workspace in
 * storage that inflates tab counts and breaks ordering assertions.
 *
 * IMPLEMENTATION: rather than clicking Skip (which triggers a 200 ms close
 * animation followed by an async markOnboardingCompleted storage write, both
 * of which are unreliable under concurrent 3-worker load), we write the
 * completed state directly to storage and reload. This is deterministic:
 * the next page boot reads 'completed' and never opens the dialog.
 * clearWorkspaces follows to ensure no leftover records exist from any prior
 * session (e.g. a Favorites workspace the component created before this
 * helper was invoked).
 */
export async function dismissOnboarding(page: Page): Promise<void> {
  // Close the dialog without relying on the async 200 ms animation chain:
  // write the completed onboarding state directly to storage so the next load
  // skips the dialog entirely. This avoids the click→animation→setTimeout→
  // markOnboardingCompleted→chrome.storage.local.set chain that is sensitive
  // to concurrent load under the 3-worker Playwright setup.
  await page.evaluate(async () => {
    const api = (globalThis as unknown as { browser?: ExtApi; chrome: ExtApi }).browser
      ?? (globalThis as unknown as { chrome: ExtApi }).chrome;
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
  });
  // Reload so the page boots with the committed completed state (avoids
  // any in-memory 'pending' snapshot the running page still holds).
  await page.reload();
  await page.waitForSelector('.ff-app', { timeout: 15_000 });
  // Delete any workspace records that may have been created before this
  // helper was called (e.g. from a prior Skip click in the same context).
  await clearWorkspaces(page);
}

/**
 * Seed the five promo-persona workspaces (Work active), each with its bookmark
 * folder, plus the shared dock folder. Does not reset storage — the caller
 * resets first. Returns everything but `origin`, which the fixture supplies.
 */
export async function seedPromoWorld(page: Page): Promise<Omit<SeededWorld, 'origin'>> {
  const seed = await page.evaluate(async (data) => {
    const api = (globalThis as unknown as { browser?: ExtApi; chrome: ExtApi }).browser
      ?? (globalThis as unknown as { chrome: ExtApi }).chrome;
    const { workspaces, defaults, dock } = data;
    const workspaceIds: Record<string, string> = {};
    const bookmarkIds: Record<string, string> = {};
    let activeRootId = '';

    for (let i = 0; i < workspaces.length; i++) {
      const ws = workspaces[i]!;
      const root = await api.bookmarks.create({ parentId: '2', title: ws.name });
      if (i === 0) activeRootId = root.id;
      for (const bm of ws.rootBookmarks) {
        const node = await api.bookmarks.create({ parentId: root.id, title: bm.title, url: bm.url });
        if (i === 0) bookmarkIds[bm.title] = node.id;
      }
      for (const folder of ws.folders) {
        const f = await api.bookmarks.create({ parentId: root.id, title: folder.title });
        if (i === 0) bookmarkIds[folder.title] = f.id;
        for (const bm of folder.bookmarks) {
          await api.bookmarks.create({ parentId: f.id, title: bm.title, url: bm.url });
        }
      }
      const id = `promo-${ws.name.toLowerCase()}`;
      workspaceIds[ws.name] = id;
      const record = {
        ...defaults,
        id,
        name: ws.name,
        rootFolderId: root.id,
        themeMode: ws.themeMode,
        accentColor: ws.accentColor,
        backgroundMode: ws.backgroundMode,
        gradientStyle: ws.gradientStyle,
        gradientColorSource: ws.gradientColorSource,
        gradientCustomColor: ws.accentColor,
        gradientIntensity: ws.gradientIntensity,
        tileShape: ws.tileShape,
      };
      await api.runtime.sendMessage({ type: 'workspaces/create', workspace: record });
    }

    const dockFolder = await api.bookmarks.create({ parentId: '2', title: 'Dock' });
    for (const bm of dock) {
      await api.bookmarks.create({ parentId: dockFolder.id, title: bm.title, url: bm.url });
    }

    const order = workspaces.map((w) => `promo-${w.name.toLowerCase()}`);
    await api.runtime.sendMessage({
      type: 'settings/patch',
      patch: {
        activeWorkspaceId: order[0],
        workspaceOrder: order,
        dockFolderId: dockFolder.id,
        showDock: true,
        rememberLastFolder: false,
      },
    });

    return { workspaceIds, bookmarkIds, dockFolderId: dockFolder.id, activeRootId };
  }, { workspaces: PROMO_WORKSPACES, defaults: DEFAULT_WORKSPACE_SETTINGS, dock: DOCK_BOOKMARKS });

  const workspaces = await getWorkspaces(page);
  const personas: PromoPersona[] = ['Work', 'Personal', 'AI', 'Design', 'Gaming'];
  const workspaceIds = Object.fromEntries(
    personas.map((p) => [p, seed.workspaceIds[p] ?? '']),
  ) as Record<PromoPersona, string>;

  return {
    workspaces,
    workspaceIds,
    rootFolderId: seed.activeRootId,
    dockFolderId: seed.dockFolderId,
    bookmarkIdByTitle: (title: string): string => {
      const id = seed.bookmarkIds[title];
      if (!id) throw new Error(`No seeded bookmark titled "${title}" in the active workspace`);
      return id;
    },
  };
}

export interface SeedMinimalOptions {
  folders?: number;
  bookmarksPerFolder?: number;
  rootBookmarks?: number;
}

/**
 * A lean, deterministic single-workspace world for sort/selection assertions:
 * `rootBookmarks` top-level bookmarks plus `folders` folders, each holding
 * `bookmarksPerFolder` bookmarks. Titles are predictable ("BM 01", "Folder 1").
 */
export async function seedMinimal(page: Page, opts: SeedMinimalOptions = {}): Promise<Omit<SeededWorld, 'origin'>> {
  const folders = opts.folders ?? 0;
  const bookmarksPerFolder = opts.bookmarksPerFolder ?? 0;
  const rootBookmarks = opts.rootBookmarks ?? 6;

  const seed = await page.evaluate(async (data) => {
    const api = (globalThis as unknown as { browser?: ExtApi; chrome: ExtApi }).browser
      ?? (globalThis as unknown as { chrome: ExtApi }).chrome;
    const { defaults, counts } = data;
    const bookmarkIds: Record<string, string> = {};
    const root = await api.bookmarks.create({ parentId: '2', title: 'Minimal' });

    for (let i = 0; i < counts.rootBookmarks; i++) {
      const title = `BM ${String(i + 1).padStart(2, '0')}`;
      const node = await api.bookmarks.create({
        parentId: root.id,
        title,
        url: `https://example.com/${i + 1}`,
      });
      bookmarkIds[title] = node.id;
    }
    for (let f = 0; f < counts.folders; f++) {
      const ftitle = `Folder ${f + 1}`;
      const folder = await api.bookmarks.create({ parentId: root.id, title: ftitle });
      bookmarkIds[ftitle] = folder.id;
      for (let b = 0; b < counts.bookmarksPerFolder; b++) {
        await api.bookmarks.create({
          parentId: folder.id,
          title: `${ftitle} BM ${b + 1}`,
          url: `https://example.com/f${f + 1}/${b + 1}`,
        });
      }
    }

    const id = 'ws-minimal';
    const record = { ...defaults, id, name: 'Minimal', rootFolderId: root.id };
    await api.runtime.sendMessage({ type: 'workspaces/create', workspace: record });
    await api.runtime.sendMessage({
      type: 'settings/patch',
      patch: { activeWorkspaceId: id, workspaceOrder: [id], rememberLastFolder: false },
    });

    return { rootId: root.id, bookmarkIds };
  }, { defaults: DEFAULT_WORKSPACE_SETTINGS, counts: { folders, bookmarksPerFolder, rootBookmarks } });

  const workspaces = await getWorkspaces(page);
  return {
    workspaces,
    workspaceIds: { Work: '', Personal: '', AI: '', Design: '', Gaming: '' },
    rootFolderId: seed.rootId,
    dockFolderId: '',
    bookmarkIdByTitle: (title: string): string => {
      const id = seed.bookmarkIds[title];
      if (!id) throw new Error(`No seeded bookmark titled "${title}" in the minimal world`);
      return id;
    },
  };
}
