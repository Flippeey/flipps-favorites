import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// In-memory chrome.storage fake (mirrors storage-workspace-migration.test.ts).
// The shared/browser.ts shim reads globalThis.chrome at module-load time, so the
// fake must be installed BEFORE the module under test is dynamically imported.
// ─────────────────────────────────────────────────────────────────────────────

interface StorageAreaFake {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

function createAreaFake(seed: Record<string, unknown> = {}): { api: StorageAreaFake; data: Record<string, unknown> } {
  const data: Record<string, unknown> = { ...seed };
  const api: StorageAreaFake = {
    async get(keys) {
      if (keys === null) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const key of list) if (key in data) out[key] = data[key];
      return out;
    },
    async set(items) {
      Object.assign(data, items);
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) delete data[key];
    },
  };
  return { api, data };
}

function installChromeFake() {
  const local = createAreaFake();
  const sync = createAreaFake();
  const chromeFake = {
    runtime: { id: 'test-extension' },
    storage: {
      local: local.api,
      sync: sync.api,
      onChanged: { addListener: () => undefined },
    },
  };
  (globalThis as unknown as { chrome?: unknown }).chrome = chromeFake;
  (globalThis as unknown as { browser?: unknown }).browser = undefined;
  return { local, sync };
}

async function importBuckets(): Promise<typeof import('@/shared/storage-buckets')> {
  // Fresh module instance each import → fresh per-store closures, simulating a
  // service-worker restart (in-memory area resolution is reset).
  vi.resetModules();
  return import('@/shared/storage-buckets');
}

const deserialize = (v: unknown): Record<string, string> =>
  v && typeof v === 'object' ? (v as Record<string, string>) : {};

const makeStore = (mod: typeof import('@/shared/storage-buckets')) =>
  mod.createCachedValueStore<Record<string, string>>({
    storageKey: 'workspaces',
    area: 'sync-preferred',
    deserialize,
  });

afterEach(() => {
  vi.resetModules();
  (globalThis as unknown as { chrome?: unknown }).chrome = undefined;
  (globalThis as unknown as { browser?: unknown }).browser = undefined;
});

describe('createCachedValueStore sync→local demotion', () => {
  let fake: ReturnType<typeof installChromeFake>;

  beforeEach(() => {
    fake = installChromeFake();
  });

  it('writes to sync normally when sync accepts the value (no demotion marker)', async () => {
    const mod = await importBuckets();
    await makeStore(mod).write({ a: '1' });

    expect(fake.sync.data['workspaces']).toEqual({ a: '1' });
    expect(fake.local.data['workspaces::demoted-to-local']).toBeUndefined();
  });

  it('demotes to local AND persists a marker when sync rejects with a quota error', async () => {
    // Simulate sync exceeding its per-item 8 KB quota.
    fake.sync.api.set = async () => {
      throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
    };

    const mod = await importBuckets();
    const written = await makeStore(mod).write({ a: '1' });

    expect(written).toEqual({ a: '1' });
    // Value landed in local, not sync, and the demotion marker is persisted.
    expect(fake.local.data['workspaces']).toEqual({ a: '1' });
    expect(fake.local.data['workspaces::demoted-to-local']).toBe(true);
  });

  it('reads from local after a restart instead of regressing to stale sync (the past-12 bug)', async () => {
    fake.sync.api.set = async () => {
      throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
    };

    // First session: write overflows → demote to local + persist marker.
    const mod1 = await importBuckets();
    await makeStore(mod1).write({ a: '1', b: '2' });

    // Seed sync with a STALE pre-overflow copy. Without the persisted marker a
    // restart would resolve back to sync and read this, silently dropping the
    // workspace written after the overflow.
    fake.sync.data['workspaces'] = { a: '1' };

    // Restart: brand-new module instance + store, same persisted storage.
    const mod2 = await importBuckets();
    const read = await makeStore(mod2).readFresh();

    expect(read).toEqual({ a: '1', b: '2' });
  });
});
