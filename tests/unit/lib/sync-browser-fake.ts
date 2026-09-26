import type { FolderIconOverrideRecord, IconOverrideRecord } from '@/shared/models';

// In-memory stand-in for one browser profile: chrome.storage.local/sync with
// onChanged, the icon IndexedDB, and a write counter per area. Modules under
// test capture `extensionApi` at import time, so each browser gets its own
// module instances (vi.resetModules + dynamic import while its fake is
// installed); the vi.mock factories for icon-idb and messaging delegate to
// whichever browser is current.

type ChangeListener = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, areaName: string) => void;

// Bookkeeping keys that change on every sync by design.
const UNCOUNTED_KEYS = new Set(['sync-last-synced-at']);

export interface AreaFake {
  readonly name: 'local' | 'sync';
  readonly data: Map<string, unknown>;
  // When each key last changed (deletes included), in account-sync order.
  readonly changedAt: Map<string, number>;
  writes: number;
  readonly api: {
    get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
    remove(keys: string | string[]): Promise<void>;
  };
  // Applies a change made outside this browser's code (account sync).
  external(key: string, value: unknown, changedAt?: number): void;
  // onChanged listeners of every browser using this area.
  readonly listeners: ChangeListener[];
}

export interface FakeBrowser {
  readonly name: string;
  // Clock skew in ms, added to the shared test clock while this browser runs.
  offset: number;
  readonly local: AreaFake;
  readonly sync: AreaFake;
  readonly overrides: Map<string, IconOverrideRecord>;
  readonly folderIcons: Map<string, FolderIconOverrideRecord>;
  readonly pendingFolderIcons: Map<string, FolderIconOverrideRecord>;
  idbWrites: number;
  readonly chrome: unknown;
}

const clone = <T>(value: T): T => (value === undefined ? value : structuredClone(value));

let changeSequence = 0;

export function createArea(name: 'local' | 'sync'): AreaFake {
  const listeners: ChangeListener[] = [];
  const data = new Map<string, unknown>();
  const changedAt = new Map<string, number>();
  const notify = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>): void => {
    for (const listener of listeners) listener(changes, name);
  };
  const area: AreaFake = {
    name,
    data,
    changedAt,
    listeners,
    writes: 0,
    api: {
      async get(keys) {
        if (keys === null || keys === undefined) return Object.fromEntries([...data].map(([k, v]) => [k, clone(v)]));
        const defaults = typeof keys === 'object' && !Array.isArray(keys) ? keys : {};
        const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
        const out: Record<string, unknown> = {};
        for (const key of list) {
          if (data.has(key)) out[key] = clone(data.get(key));
          else if (key in defaults) out[key] = defaults[key];
        }
        return out;
      },
      async set(items) {
        const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
        for (const [key, value] of Object.entries(items)) {
          changes[key] = { oldValue: data.get(key), newValue: clone(value) };
          data.set(key, clone(value));
          changedAt.set(key, ++changeSequence);
        }
        if (Object.keys(items).some(key => !UNCOUNTED_KEYS.has(key))) area.writes += 1;
        notify(changes);
      },
      async remove(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        const changes: Record<string, { oldValue?: unknown }> = {};
        for (const key of list) {
          changes[key] = { oldValue: data.get(key) };
          data.delete(key);
          changedAt.set(key, ++changeSequence);
        }
        if (list.some(key => !UNCOUNTED_KEYS.has(key))) area.writes += 1;
        notify(changes);
      },
    },
    external(key, value, at = ++changeSequence) {
      const oldValue = data.get(key);
      changedAt.set(key, at);
      if (value === undefined) data.delete(key);
      else data.set(key, clone(value));
      notify({ [key]: { oldValue, newValue: clone(value) } });
    },
  };
  return area;
}

// Passing `sync` makes several profiles share one storage.sync area, the
// instant form of Chrome account sync.
export function createBrowser(name: string, offset = 0, sync: AreaFake = createArea('sync')): FakeBrowser {
  const local = createArea('local');
  return {
    name,
    offset,
    local,
    sync,
    overrides: new Map(),
    folderIcons: new Map(),
    pendingFolderIcons: new Map(),
    idbWrites: 0,
    chrome: {
      runtime: { id: `test-${name}` },
      storage: {
        local: local.api,
        sync: sync.api,
        onChanged: {
          addListener: (listener: ChangeListener) => {
            local.listeners.push(listener);
            sync.listeners.push(listener);
          },
        },
      },
    },
  };
}

export function totalWrites(browser: FakeBrowser): number {
  return browser.local.writes + browser.sync.writes + browser.idbWrites;
}

export function resetWrites(browser: FakeBrowser): void {
  browser.local.writes = 0;
  browser.sync.writes = 0;
  browser.idbWrites = 0;
}

// Chrome account sync between two profiles: per key, the later change
// (a removal included) wins and lands on both. Each differing key is
// delivered now or left for a later copy at random, so the extension sees
// partial, out-of-order arrivals.
export function accountSyncCopy(a: FakeBrowser, b: FakeBrowser, coin: () => boolean): void {
  const keys = new Set([...a.sync.changedAt.keys(), ...b.sync.changedAt.keys()]);
  for (const key of keys) {
    const va = a.sync.data.get(key);
    const vb = b.sync.data.get(key);
    if (JSON.stringify(va) === JSON.stringify(vb) || !coin()) continue;
    const ta = a.sync.changedAt.get(key) ?? -1;
    const tb = b.sync.changedAt.get(key) ?? -1;
    if (ta > tb) b.sync.external(key, va, ta);
    else a.sync.external(key, vb, tb);
  }
}

let current: FakeBrowser | null = null;

export function setCurrentBrowser(browser: FakeBrowser | null): void {
  current = browser;
  const globals = globalThis as unknown as { chrome?: unknown; browser?: unknown };
  globals.chrome = browser?.chrome;
  globals.browser = undefined;
}

export function currentBrowser(): FakeBrowser {
  if (!current) throw new Error('No fake browser is active');
  return current;
}

export const idbModule = {
  readCachedIcon: async () => null,
  writeCachedIcon: async () => undefined,
  deleteCachedIcon: async () => undefined,
  clearCachedIcons: async () => undefined,
  readAllCachedIcons: async () => ({}),
  evictExpiredCachedIcons: async () => 0,
  readIconOverride: async (key: string) => clone(currentBrowser().overrides.get(key)) ?? null,
  writeIconOverride: async (record: IconOverrideRecord) => {
    const b = currentBrowser();
    b.overrides.set(record.overrideKey, clone(record));
    b.idbWrites += 1;
  },
  deleteIconOverride: async (key: string) => {
    const b = currentBrowser();
    b.overrides.delete(key);
    b.idbWrites += 1;
  },
  clearIconOverrides: async () => {
    const b = currentBrowser();
    b.overrides.clear();
    b.idbWrites += 1;
  },
  readAllIconOverrides: async () => Object.fromEntries([...currentBrowser().overrides].map(([k, v]) => [k, clone(v)])),
  readFolderIconRecord: async (folderId: string) => clone(currentBrowser().folderIcons.get(folderId)) ?? null,
  writeFolderIconRecord: async (record: FolderIconOverrideRecord) => {
    const b = currentBrowser();
    b.folderIcons.set(record.folderId, clone(record));
    b.idbWrites += 1;
  },
  deleteFolderIconRecord: async (folderId: string) => {
    const b = currentBrowser();
    b.folderIcons.delete(folderId);
    b.idbWrites += 1;
  },
  readAllFolderIconRecords: async () => Object.fromEntries([...currentBrowser().folderIcons].map(([k, v]) => [k, clone(v)])),
  readAllPendingFolderIconRecords: async () => [...currentBrowser().pendingFolderIcons.values()].map(clone),
  writePendingFolderIconRecord: async (record: FolderIconOverrideRecord) => {
    const b = currentBrowser();
    b.pendingFolderIcons.set(record.syncId ?? '', clone(record));
    b.idbWrites += 1;
  },
  deletePendingFolderIconRecord: async (syncId: string) => {
    const b = currentBrowser();
    b.pendingFolderIcons.delete(syncId);
    b.idbWrites += 1;
  },
};

// Deterministic PRNG (mulberry32) so a failing seed replays exactly.
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
