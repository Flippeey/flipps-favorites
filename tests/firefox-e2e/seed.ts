// Ported seed helpers for the Puppeteer suite. Mechanical port of
// tests/fixtures/seeding.ts: Playwright's `page.evaluate(fn, arg)` and
// Puppeteer's `page.evaluate(fn, arg)` share the same signature, so the
// evaluate-callback bodies are copied verbatim. Kept as a separate copy
// per the Phase 1 plan (extraction into tests/shared/ deferred to Phase 3
// to avoid risking the Playwright suite's green state).
import type { Page } from 'puppeteer';
import type { AppSettings, WorkspaceRecord } from '../../src/shared/models';
// STORAGE_KEYS has no Playwright dependency — imported directly from the
// existing fixture rather than duplicated (plan: tests/fixtures/test-data.ts
// "import directly, no Playwright dependency in that file").
import { STORAGE_KEYS } from '../fixtures/test-data';

export type PromoPersona = 'Work' | 'Personal' | 'AI' | 'Design' | 'Gaming';

export interface SeededWorld {
  workspaces: WorkspaceRecord[];
  rootFolderId: string;
  bookmarkIdByTitle: (title: string) => string;
}

interface ExtBookmarkNode {
  id: string;
  title: string;
  url?: string;
  children?: ExtBookmarkNode[];
}
interface ExtApi {
  bookmarks: {
    create(b: { parentId: string; title: string; url?: string }): Promise<ExtBookmarkNode>;
    removeTree(id: string): Promise<void>;
    getChildren(id: string): Promise<ExtBookmarkNode[]>;
    getTree(): Promise<ExtBookmarkNode[]>;
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
 * Clear all extension state so a test starts from a known baseline: settings,
 * workspaces, onboarding, icon caches, and every per-workspace wallpaper key.
 * Also purges every child of every top-level bookmark root (bar/other/menu —
 * Chrome uses numeric ids ('1'/'2'), Firefox uses named ids like
 * 'toolbar_____'/'unfiled_____'; discover them from getTree() instead of
 * hardcoding platform-specific ids).
 */
export async function resetStorage(page: Page): Promise<void> {
  await page.evaluate(async (keys) => {
    const api = (globalThis as unknown as { browser?: ExtApi; chrome: ExtApi }).browser
      ?? (globalThis as unknown as { chrome: ExtApi }).chrome;
    const all = await api.storage.local.get();
    const wallpaperKeys = Object.keys(all).filter((k) => k.startsWith('app-wallpaper'));
    await api.storage.local.remove([...Object.values(keys), ...wallpaperKeys]);
    try {
      await api.storage.sync.remove([keys.appSettings, keys.workspaces]);
    } catch {
      await api.storage.local.remove([keys.appSettings, keys.workspaces]);
    }
    const tree = await api.bookmarks.getTree();
    const virtualRoot = tree[0];
    for (const topRoot of virtualRoot?.children ?? []) {
      const children = await api.bookmarks.getChildren(topRoot.id);
      for (const child of children) {
        await api.bookmarks.removeTree(child.id);
      }
    }
  }, STORAGE_KEYS);
}

/**
 * Resolve a stable "seed under here" folder id: prefer a folder titled
 * "Other Bookmarks" (Chrome) or "Other Bookmarks"/"Unfiled Bookmarks"
 * (Firefox uses id 'unfiled_____'); fall back to the second top-level root,
 * then the first. Mirrors the discovery the Phase 0 spike used for the
 * toolbar, generalized to the "other/unfiled" root the Playwright fixtures
 * seed under (parentId '2' on Chrome).
 */
async function resolveSeedRootId(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const api = (globalThis as unknown as { browser?: ExtApi; chrome: ExtApi }).browser
      ?? (globalThis as unknown as { chrome: ExtApi }).chrome;
    const tree = await api.bookmarks.getTree();
    const roots = tree[0]?.children ?? [];
    const byTitle = roots.find((n) => /other|unfiled/i.test(n.title));
    if (byTitle) return byTitle.id;
    return roots[1]?.id ?? roots[0]?.id ?? '2';
  });
}

/** Patch global app settings via the message pipeline. Caller must reload. */
export async function patchSettings(page: Page, patch: Partial<AppSettings>): Promise<void> {
  await page.evaluate(async (p) => {
    const api = (globalThis as unknown as { browser?: ExtApi; chrome: ExtApi }).browser
      ?? (globalThis as unknown as { chrome: ExtApi }).chrome;
    await api.runtime.sendMessage({ type: 'settings/patch', patch: p });
  }, patch);
}

/** Read the settings the background page currently holds (committed state). */
export async function getSettings(page: Page): Promise<AppSettings> {
  return page.evaluate(async () => {
    const api = (globalThis as unknown as { browser?: ExtApi; chrome: ExtApi }).browser
      ?? (globalThis as unknown as { chrome: ExtApi }).chrome;
    const res = (await api.runtime.sendMessage({ type: 'settings/get' })) as { settings: AppSettings };
    return res.settings;
  });
}

/**
 * Poll the background page's committed settings until `predicate` holds, so a
 * test can reload without racing the async `settings/patch` write (e.g.
 * handleSwitchWorkspace's optimistic UI update lands before the backend write
 * commits — see src/newtab/state/useWorkspaceActions.ts). Throws after ~4s if
 * the change never commits.
 */
export async function waitForSettings(
  page: Page,
  predicate: (settings: AppSettings) => boolean,
): Promise<void> {
  const deadline = Date.now() + 4_000;
  for (;;) {
    if (predicate(await getSettings(page))) return;
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for settings to commit');
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * Poll the background page's committed workspace records until `predicate`
 * holds for the record with `id`. The per-workspace counterpart to
 * waitForSettings (view/theme/sort fields live on WorkspaceRecord, not
 * AppSettings). Throws after ~4s if the change never commits.
 */
export async function waitForWorkspace(
  page: Page,
  id: string,
  predicate: (workspace: WorkspaceRecord) => boolean,
): Promise<void> {
  const deadline = Date.now() + 4_000;
  for (;;) {
    const record = (await getWorkspaces(page)).find((w) => w.id === id);
    if (record && predicate(record)) return;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for workspace "${id}" to commit`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
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

/** Read all workspace records the service worker (background page on FF) currently holds. */
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

/** Delete all workspace records via the message pipeline. */
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
 * Dismiss onboarding deterministically by writing the completed state directly
 * to storage (avoids the click -> animation -> async write chain), then reload
 * and clear any workspace side effects created before this call.
 */
export async function dismissOnboarding(page: Page): Promise<void> {
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
  await page.reload({ waitUntil: [] });
  await page.waitForSelector('.ff-app', { timeout: 15_000 });
  await clearWorkspaces(page);
}

export interface SeedMinimalOptions {
  folders?: number;
  bookmarksPerFolder?: number;
  rootBookmarks?: number;
}

const DEFAULT_WORKSPACE_SETTINGS: Omit<WorkspaceRecord, 'id' | 'name' | 'rootFolderId'> = {
  themeMode: 'system',
  accentColor: '#3F72DC',
  backgroundMode: 'gradient',
  solidBackgroundColor: '',
  gradientStyle: 'top',
  gradientColorSource: 'accent',
  gradientCustomColor: '#3F72DC',
  gradientIntensity: 100,
  backgroundOpacity: 70,
  backgroundFitMode: 'cover',
  backgroundPositionMode: 'center',
  layoutPreset: 'balanced',
  favoritesColumnGap: 24,
  favoritesRowGap: 20,
  bookmarkTileWidth: 130,
  bookmarkIconSize: 75,
  tileShape: 'squircle',
  showTileLabels: true,
  folderMode: 'grid',
  bookmarkSortMode: 'manual',
  bookmarkSortDirection: 'asc',
};

/**
 * A lean, deterministic single-workspace world: `rootBookmarks` top-level
 * bookmarks plus `folders` folders, each holding `bookmarksPerFolder`
 * bookmarks. Titles are predictable ("BM 01", "Folder 1").
 */
export async function seedMinimal(page: Page, opts: SeedMinimalOptions = {}): Promise<SeededWorld> {
  const folders = opts.folders ?? 0;
  const bookmarksPerFolder = opts.bookmarksPerFolder ?? 0;
  const rootBookmarks = opts.rootBookmarks ?? 6;
  const seedRootId = await resolveSeedRootId(page);

  const seed = await page.evaluate(async (data) => {
    const api = (globalThis as unknown as { browser?: ExtApi; chrome: ExtApi }).browser
      ?? (globalThis as unknown as { chrome: ExtApi }).chrome;
    const { defaults, counts, seedRootId: parentId } = data;
    const bookmarkIds: Record<string, string> = {};
    const root = await api.bookmarks.create({ parentId, title: 'Minimal' });

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
  }, { defaults: DEFAULT_WORKSPACE_SETTINGS, counts: { folders, bookmarksPerFolder, rootBookmarks }, seedRootId });

  const workspaces = await getWorkspaces(page);
  return {
    workspaces,
    rootFolderId: seed.rootId,
    bookmarkIdByTitle: (title: string): string => {
      const id = seed.bookmarkIds[title];
      if (!id) throw new Error(`No seeded bookmark titled "${title}" in the minimal world`);
      return id;
    },
  };
}

/** Create a single bookmark directly via the bookmarks API. Returns its id. */
export async function createBookmark(
  page: Page,
  parentId: string,
  title: string,
  url: string,
): Promise<string> {
  return page.evaluate(async (args) => {
    const api = (globalThis as unknown as { browser?: ExtApi; chrome: ExtApi }).browser
      ?? (globalThis as unknown as { chrome: ExtApi }).chrome;
    const bm = await api.bookmarks.create({ parentId: args.parentId, title: args.title, url: args.url });
    return bm.id;
  }, { parentId, title, url });
}
