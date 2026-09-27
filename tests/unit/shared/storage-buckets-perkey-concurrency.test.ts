import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// In-memory chrome.storage fake (mirrors storage-buckets-concurrency.test.ts,
// which covers createCachedRecordStore — this file covers
// createPerKeyRecordStore's writeOne/updateOne/deleteOne serialization). The
// shared/browser.ts shim reads globalThis.chrome at module-load time, so the
// fake must be installed BEFORE the module under test is dynamically imported.
//
// armSetGate(expectedArrivals) blocks every set() call until resolved, and
// exposes `reached`, a promise that resolves only once `expectedArrivals`
// set() calls have all hit the gate. Racing two operations and awaiting
// `reached` before releasing the gate guarantees BOTH have already done their
// read (and computed their write) off the same pre-write snapshot — a
// timing-guess (e.g. a bare setTimeout) can't guarantee that, since
// createPerKeyRecordStore's area-resolution adds a variable number of extra
// microtask ticks per call that a fixed delay can't be sized against.
// ─────────────────────────────────────────────────────────────────────────────

interface StorageAreaFake {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove?(keys: string | string[]): Promise<void>;
}

interface DeferredSet {
  resolve: () => void;
  reached: Promise<void>;
}

function createAreaFake(opts: {
  seed?: Record<string, unknown>;
  withRemove?: boolean;
} = {}): {
  api: StorageAreaFake;
  data: Record<string, unknown>;
  /** Delay every set() until the returned resolve() is called — used to force interleaving. */
  armSetGate: (expectedArrivals?: number) => DeferredSet;
} {
  const { seed = {}, withRemove = true } = opts;
  const data: Record<string, unknown> = { ...seed };
  let gate: Promise<void> | null = null;
  let onArrival: (() => void) | null = null;

  const api: StorageAreaFake = {
    async get(keys) {
      if (keys === null) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const key of list) if (key in data) out[key] = data[key];
      return out;
    },
    async set(items) {
      if (gate) {
        onArrival?.();
        await gate;
      }
      Object.assign(data, items);
    },
  };
  if (withRemove) {
    api.remove = async keys => {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) delete data[key];
    };
  }

  return {
    api,
    data,
    armSetGate(expectedArrivals = 1) {
      let resolveFn: () => void = () => undefined;
      let arrivals = 0;
      let resolveReached: () => void = () => undefined;
      const reached = new Promise<void>(resolve => { resolveReached = resolve; });
      gate = new Promise<void>(resolve => { resolveFn = resolve; });
      onArrival = () => {
        arrivals += 1;
        if (arrivals >= expectedArrivals) resolveReached();
      };
      return { resolve: resolveFn, reached };
    },
  };
}

function installChromeFake(opts: { withRemove?: boolean } = {}) {
  const local = createAreaFake({ withRemove: opts.withRemove });
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

// Reset the module registry before every import: shared/browser.ts's
// extensionApi binds to globalThis.chrome once, at first import, so reusing a
// cached module across tests would silently keep resolving to an earlier
// test's fake instead of the one just installed.
async function importBuckets(): Promise<typeof import('@/shared/storage-buckets')> {
  vi.resetModules();
  return import('@/shared/storage-buckets');
}

afterEach(() => {
  vi.resetModules();
  (globalThis as unknown as { chrome?: unknown }).chrome = undefined;
  (globalThis as unknown as { browser?: unknown }).browser = undefined;
});

interface Thing {
  a: number;
  b: number;
}

describe('createPerKeyRecordStore.updateOne concurrency', () => {
  beforeEach(() => {
    installChromeFake();
  });

  it('applies both patches when updateOne is called concurrently for the SAME id (different fields)', async () => {
    const mod = await importBuckets();
    const store = mod.createPerKeyRecordStore<Thing>({ keyPrefix: 'thing', area: 'local' });

    await store.writeOne('x', { a: 0, b: 0 });

    await Promise.all([
      store.updateOne('x', current => ({ ...(current as Thing), a: 1 })),
      store.updateOne('x', current => ({ ...(current as Thing), b: 2 })),
    ]);

    expect(await store.readOne('x')).toEqual({ a: 1, b: 2 });
  });

  // Deterministic version of the above. A correctly serialized store never
  // lets a second updateOne for the SAME id reach its own set() while the
  // first is still in flight — the second's run() isn't even invoked until
  // the first's queued promise settles. So instead of racing both to a gate
  // (which would deadlock a correct implementation: the second can never
  // arrive if it's queued behind the first, which is itself stuck on the same
  // gate), this proves the negative: arm the gate for TWO arrivals and assert
  // that never happens within a generous window — i.e. the second call is
  // never given a chance to read before the first has fully landed. This is
  // the test that goes red without the store's internal serialization: an
  // unserialized second updateOne starts immediately and independently
  // reaches its own set() call well within the window, so both arrivals land
  // — the exact lost-update race workspacePatchQueues used to guard against
  // from storage.ts (caller-side, with zero unit coverage).
  it('a second updateOne for the same id is never given a chance to race the first to a write', async () => {
    const local = installChromeFake().local;
    const mod = await importBuckets();
    const store = mod.createPerKeyRecordStore<Thing>({ keyPrefix: 'thing', area: 'local' });

    await store.writeOne('x', { a: 0, b: 0 });

    const gate = local.armSetGate(2);

    const firstUpdate = store.updateOne('x', current => ({ ...(current as Thing), a: 1 }));
    const secondUpdate = store.updateOne('x', current => ({ ...(current as Thing), b: 2 }));

    const bothArrived = gate.reached.then(() => true);
    const timedOut = new Promise<boolean>(resolve => setTimeout(() => resolve(false), 50));
    const raced = await Promise.race([bothArrived, timedOut]);
    expect(raced).toBe(false);

    gate.resolve();
    await Promise.all([firstUpdate, secondUpdate]);

    expect(await store.readOne('x')).toEqual({ a: 1, b: 2 });
  });

  it('concurrent updateOne calls for DIFFERENT ids both survive', async () => {
    const mod = await importBuckets();
    const store = mod.createPerKeyRecordStore<{ value: string }>({ keyPrefix: 'thing', area: 'local' });

    await store.writeOne('a', { value: '' });
    await store.writeOne('b', { value: '' });

    await Promise.all([
      store.updateOne('a', current => ({ ...(current as { value: string }), value: 'from-a' })),
      store.updateOne('b', current => ({ ...(current as { value: string }), value: 'from-b' })),
    ]);

    expect(await store.readOne('a')).toEqual({ value: 'from-a' });
    expect(await store.readOne('b')).toEqual({ value: 'from-b' });
  });

  it('a failed update rejects its own caller but does not poison the next queued write', async () => {
    const mod = await importBuckets();
    const store = mod.createPerKeyRecordStore<{ value: string }>({ keyPrefix: 'thing', area: 'local' });

    await store.writeOne('x', { value: 'initial' });

    const failing = store.updateOne('x', () => {
      throw new Error('boom');
    });
    const succeeding = store.updateOne('x', current => ({ ...(current as { value: string }), value: 'recovered' }));

    await expect(failing).rejects.toThrow('boom');
    await expect(succeeding).resolves.toEqual({ value: 'recovered' });
    expect(await store.readOne('x')).toEqual({ value: 'recovered' });
  });

  it('updateOne on a missing id passes current === null to the updater', async () => {
    const mod = await importBuckets();
    const store = mod.createPerKeyRecordStore<{ id: string }>({ keyPrefix: 'thing', area: 'local' });

    let observed: unknown = 'not-called';
    await store.updateOne('missing', current => {
      observed = current;
      return { id: 'missing' };
    });

    expect(observed).toBeNull();
  });
});

describe('createPerKeyRecordStore.deleteOne fallback path (no remove())', () => {
  it('a concurrent deleteOne fallback and updateOne on a different id both survive (no gate)', async () => {
    installChromeFake({ withRemove: false });
    const mod = await importBuckets();
    const store = mod.createPerKeyRecordStore<{ value: string }>({ keyPrefix: 'thing', area: 'local' });

    await store.writeOne('a', { value: 'to-delete' });
    await store.writeOne('b', { value: 'v0' });

    await Promise.all([
      store.deleteOne('a'),
      store.updateOne('b', current => ({ ...(current as { value: string }), value: 'v1' })),
    ]);

    expect(await store.readOne('b')).toEqual({ value: 'v1' });
  });

  // Deterministic version, same "prove the negative" shape as the updateOne
  // test above (racing both to a shared gate would deadlock a correctly
  // serialized store). The fallback deleteOne does read-all -> filter ->
  // set(next), a snapshot of every OTHER id's current value — including b's
  // PRE-update value. If the store let deleteOne's set() and a concurrent
  // updateOne's set() both be in flight at once, the delete's stale snapshot
  // could land after the update's fresh write and silently regress it. This
  // is the test that goes red without the store's internal serialization: an
  // unserialized deleteOne and updateOne both independently reach their own
  // set() well within the window.
  it('a deleteOne fallback and a concurrent update to a different id are never both in flight at once', async () => {
    const local = installChromeFake({ withRemove: false }).local;
    const mod = await importBuckets();
    const store = mod.createPerKeyRecordStore<{ value: string }>({ keyPrefix: 'thing', area: 'local' });

    await store.writeOne('a', { value: 'to-delete' });
    await store.writeOne('b', { value: 'v0' });

    const gate = local.armSetGate(2);

    const updating = store.updateOne('b', current => ({ ...(current as { value: string }), value: 'v1' }));
    const deleting = store.deleteOne('a');

    const bothArrived = gate.reached.then(() => true);
    const timedOut = new Promise<boolean>(resolve => setTimeout(() => resolve(false), 50));
    const raced = await Promise.race([bothArrived, timedOut]);
    expect(raced).toBe(false);

    gate.resolve();
    await Promise.all([updating, deleting]);

    expect(await store.readOne('b')).toEqual({ value: 'v1' });
  });
});
