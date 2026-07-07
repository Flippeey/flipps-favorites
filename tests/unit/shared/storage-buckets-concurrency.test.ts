import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// In-memory chrome.storage fake (mirrors storage-buckets-demotion.test.ts).
// The shared/browser.ts shim reads globalThis.chrome at module-load time, so the
// fake must be installed BEFORE the module under test is dynamically imported.
// ─────────────────────────────────────────────────────────────────────────────

interface StorageAreaFake {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

interface DeferredSet {
  resolve: () => void;
}

function createAreaFake(seed: Record<string, unknown> = {}): {
  api: StorageAreaFake;
  data: Record<string, unknown>;
  /** Delay every set() until the returned resolve() is called — used to force interleaving. */
  armSetGate: () => DeferredSet;
} {
  const data: Record<string, unknown> = { ...seed };
  let gate: Promise<void> | null = null;

  const api: StorageAreaFake = {
    async get(keys) {
      if (keys === null) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const key of list) if (key in data) out[key] = data[key];
      return out;
    },
    async set(items) {
      if (gate) await gate;
      Object.assign(data, items);
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) delete data[key];
    },
  };

  return {
    api,
    data,
    armSetGate() {
      let resolveFn: () => void = () => undefined;
      gate = new Promise<void>(resolve => { resolveFn = resolve; });
      return { resolve: resolveFn };
    },
  };
}

function installChromeFake() {
  const local = createAreaFake();
  const chromeFake = {
    runtime: { id: 'test-extension' },
    storage: {
      local: local.api,
      sync: undefined,
      onChanged: { addListener: () => undefined },
    },
  };
  (globalThis as unknown as { chrome?: unknown }).chrome = chromeFake;
  (globalThis as unknown as { browser?: unknown }).browser = undefined;
  return { local };
}

async function importBuckets(): Promise<typeof import('@/shared/storage-buckets')> {
  return import('@/shared/storage-buckets');
}

afterEach(() => {
  (globalThis as unknown as { chrome?: unknown }).chrome = undefined;
  (globalThis as unknown as { browser?: unknown }).browser = undefined;
});

describe('createCachedRecordStore concurrent writeOne/deleteOne', () => {
  beforeEach(() => {
    installChromeFake();
  });

  // WHY this matters: writeOne does readFresh -> spread -> write. Before the
  // per-store write-chaining fix (#41), two concurrent writeOne calls for
  // DIFFERENT keys both read the same pre-write map, so the second write's
  // `{ ...records, [key]: value }` spread silently drops the first write's key.
  // This backs bookmark usage (fires on every tile click) and icon overrides —
  // a dropped record here is a silent, hard-to-notice data loss bug, not a crash.
  it('persists both records when writeOne is called concurrently for different keys', async () => {
    const mod = await importBuckets();
    const store = mod.createCachedRecordStore<{ value: string }>({
      storageKey: 'concurrency-test',
      area: 'local',
    });

    // Fire both writes without awaiting the first — this is exactly the shape of
    // two overlapping message-handler invocations in the MV3 service worker.
    await Promise.all([
      store.writeOne('a', { value: '1' }),
      store.writeOne('b', { value: '2' }),
    ]);

    const all = await store.readAll();
    expect(all).toEqual({ a: { value: '1' }, b: { value: '2' } });
  });

  // Same failure mode, explicitly forced via a gated set() so the second write's
  // readFresh cannot possibly observe the first write's in-flight change unless
  // serialization makes it wait. This is the test that would fail deterministically
  // under the old last-write-wins implementation (not just "usually pass").
  it('serializes writeOne calls so a slow first write cannot be clobbered by a second', async () => {
    const local = installChromeFake().local;
    const mod = await importBuckets();
    const store = mod.createCachedRecordStore<{ value: string }>({
      storageKey: 'concurrency-test-gated',
      area: 'local',
    });

    const gate = local.armSetGate();

    const firstWrite = store.writeOne('a', { value: 'first' });
    // Give the first writeOne a chance to start (readFresh + reach the gated set()).
    await new Promise(resolve => setTimeout(resolve, 0));
    const secondWrite = store.writeOne('b', { value: 'second' });

    // Release the gate so both writes' underlying set() calls can proceed.
    gate.resolve();
    await Promise.all([firstWrite, secondWrite]);

    const all = await store.readAll();
    expect(all).toEqual({ a: { value: 'first' }, b: { value: 'second' } });
  });

  it('does not resurrect a deleted key when delete and write for different keys overlap', async () => {
    const mod = await importBuckets();
    const store = mod.createCachedRecordStore<{ value: string }>({
      storageKey: 'concurrency-test-delete',
      area: 'local',
    });

    await store.writeOne('a', { value: 'keep-deleting' });
    await store.writeOne('b', { value: 'unrelated' });

    await Promise.all([
      store.deleteOne('a'),
      store.writeOne('c', { value: 'new' }),
    ]);

    const all = await store.readAll();
    expect(all).toEqual({ b: { value: 'unrelated' }, c: { value: 'new' } });
  });
});
