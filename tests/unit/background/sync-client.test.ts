import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// sync-client.ts orchestrates fetch (via firefoxSafeFetchRequest) + sync-crypto
// (secret storage + encrypt/decrypt). Install an in-memory chrome.storage fake
// BEFORE dynamically importing, same pattern as sync-crypto.test.ts, and mock
// out firefoxSafeFetchRequest so no real network call happens (server doesn't
// exist yet per plan constraints).

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

const mockFetchRequest = vi.fn();

vi.mock('@/background/icons/platform', () => ({
  isFirefox: () => false,
  firefoxSafeFetchRequest: (...args: unknown[]) => mockFetchRequest(...args),
}));

async function importSyncClient(): Promise<typeof import('@/background/sync-client')> {
  vi.resetModules();
  return import('@/background/sync-client');
}

beforeEach(() => {
  mockFetchRequest.mockReset();
});

afterEach(() => {
  vi.resetModules();
  (globalThis as unknown as { chrome?: unknown }).chrome = undefined;
  (globalThis as unknown as { browser?: unknown }).browser = undefined;
});

describe('sync-client: syncPush', () => {
  beforeEach(() => {
    installChromeFake();
  });

  it('PUTs encrypted bytes with a Bearer authToken and octet-stream content type', async () => {
    mockFetchRequest.mockResolvedValue(new Response(new ArrayBuffer(0), { status: 200 }));
    const mod = await importSyncClient();

    await mod.syncPush({ hello: 'world' });

    expect(mockFetchRequest).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetchRequest.mock.calls[0] as [string, { method: string; headers: Record<string, string>; body: ArrayBuffer | Uint8Array }];
    expect(url).toContain('https://api.flippflix.com/sync');
    expect(init.method).toBe('PUT');
    expect(init.headers['Content-Type']).toBe('application/octet-stream');
    expect(init.headers.Authorization).toMatch(/^Bearer [0-9a-f]{64}$/);
  });

  it('throws a typed SyncFetchError with kind "payload-too-large" on HTTP 413', async () => {
    mockFetchRequest.mockResolvedValue(new Response(new ArrayBuffer(0), { status: 413 }));
    const mod = await importSyncClient();

    await expect(mod.syncPush({ a: 1 })).rejects.toMatchObject({ kind: 'payload-too-large' });
  });

  it('throws a typed SyncFetchError with kind "rate-limited" on HTTP 429', async () => {
    mockFetchRequest.mockResolvedValue(new Response(new ArrayBuffer(0), { status: 429 }));
    const mod = await importSyncClient();

    await expect(mod.syncPush({ a: 1 })).rejects.toMatchObject({ kind: 'rate-limited' });
  });

  it('throws a typed SyncFetchError with kind "http-status" on other non-2xx', async () => {
    mockFetchRequest.mockResolvedValue(new Response(new ArrayBuffer(0), { status: 500 }));
    const mod = await importSyncClient();

    await expect(mod.syncPush({ a: 1 })).rejects.toMatchObject({ kind: 'http-status', httpStatus: 500 });
  });

  it('throws a typed SyncFetchError with kind "network" when fetch rejects', async () => {
    mockFetchRequest.mockRejectedValue(new TypeError('Failed to fetch'));
    const mod = await importSyncClient();

    await expect(mod.syncPush({ a: 1 })).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('sync-client: syncPull', () => {
  beforeEach(() => {
    installChromeFake();
  });

  it('decrypts a 200 response and returns { found: true, payload }', async () => {
    const mod = await importSyncClient();
    const cryptoMod = await import('@/shared/sync-crypto');
    const secret = await cryptoMod.getOrCreateSyncSecret();
    const aesKey = await cryptoMod.deriveAesKey(secret);
    const original = { workspaces: [], schemaVersion: 3 };
    const ciphertext = await cryptoMod.encryptPayload(JSON.stringify(original), aesKey);

    mockFetchRequest.mockResolvedValue(new Response(ciphertext, { status: 200 }));

    const result = await mod.syncPull();

    expect(result).toEqual({ found: true, payload: original });
  });

  it('returns { found: false } on HTTP 404 instead of throwing', async () => {
    mockFetchRequest.mockResolvedValue(new Response(new ArrayBuffer(0), { status: 404 }));
    const mod = await importSyncClient();

    const result = await mod.syncPull();

    expect(result).toEqual({ found: false });
  });

  it('throws a typed SyncFetchError on non-2xx/404 status', async () => {
    mockFetchRequest.mockResolvedValue(new Response(new ArrayBuffer(0), { status: 500 }));
    const mod = await importSyncClient();

    await expect(mod.syncPull()).rejects.toMatchObject({ kind: 'http-status', httpStatus: 500 });
  });

  it('throws a typed SyncFetchError with kind "network" on fetch rejection', async () => {
    mockFetchRequest.mockRejectedValue(new TypeError('Failed to fetch'));
    const mod = await importSyncClient();

    await expect(mod.syncPull()).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('sync-client: pairing code + adopt', () => {
  beforeEach(() => {
    installChromeFake();
  });

  it('getSyncPairingCode returns a display-formatted code for the get-or-create secret', async () => {
    const mod = await importSyncClient();

    const code = await mod.getSyncPairingCode();

    expect(code).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{1,4})*$/);
  });

  it('getSyncPairingCode returns the SAME code on a second call (same underlying secret)', async () => {
    const mod = await importSyncClient();

    const first = await mod.getSyncPairingCode();
    const second = await mod.getSyncPairingCode();

    expect(second).toBe(first);
  });

  it('adoptSyncSecret replaces the stored secret so a later pairing code reflects it', async () => {
    const mod = await importSyncClient();
    const cryptoMod = await import('@/shared/sync-crypto');

    const foreignSecret = cryptoMod.generateSecret();
    const foreignCode = await cryptoMod.encodePairingCode(foreignSecret);

    await mod.adoptSyncSecret(foreignCode);

    const adoptedCode = await mod.getSyncPairingCode();
    expect(adoptedCode).toBe(foreignCode);
  });

  it('adoptSyncSecret rejects an invalid pairing code with a typed validation error', async () => {
    const mod = await importSyncClient();

    await expect(mod.adoptSyncSecret('garbage-not-a-code')).rejects.toMatchObject({ kind: 'validation' });
  });
});
