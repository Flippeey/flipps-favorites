import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// sync-crypto.ts must not import extension APIs at module scope (would throw in
// Node/Vitest — see platform.ts precedent). It DOES need chrome.storage for the
// get-or-create secret persistence, so install an in-memory fake before import,
// mirroring storage-buckets-demotion.test.ts.

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

async function importSyncCrypto(): Promise<typeof import('@/shared/sync-crypto')> {
  const { vi } = await import('vitest');
  vi.resetModules();
  return import('@/shared/sync-crypto');
}

afterEach(async () => {
  const { vi } = await import('vitest');
  vi.resetModules();
  (globalThis as unknown as { chrome?: unknown }).chrome = undefined;
  (globalThis as unknown as { browser?: unknown }).browser = undefined;
});

describe('sync-crypto: AES-GCM encrypt/decrypt round-trip', () => {
  beforeEach(() => {
    installChromeFake();
  });

  it('decrypts to the original JSON payload', async () => {
    const mod = await importSyncCrypto();
    const secret = mod.generateSecret();
    const aesKey = await mod.deriveAesKey(secret);

    const original = JSON.stringify({ hello: 'world', n: 42 });
    const ciphertext = await mod.encryptPayload(original, aesKey);
    const decrypted = await mod.decryptPayload(ciphertext, aesKey);

    expect(decrypted).toBe(original);
  });

  it('produces a wire format of version byte + 12-byte IV + ciphertext', async () => {
    const mod = await importSyncCrypto();
    const secret = mod.generateSecret();
    const aesKey = await mod.deriveAesKey(secret);

    const ciphertext = await mod.encryptPayload('{}', aesKey);

    expect(ciphertext[0]).toBe(0x01);
    // total length = 1 (version) + 12 (iv) + ciphertext+tag length; must exceed 13.
    expect(ciphertext.byteLength).toBeGreaterThan(13);
  });

  it('throws on tampered ciphertext instead of returning corrupted data', async () => {
    const mod = await importSyncCrypto();
    const secret = mod.generateSecret();
    const aesKey = await mod.deriveAesKey(secret);

    const ciphertext = await mod.encryptPayload(JSON.stringify({ a: 1 }), aesKey);
    const tampered = new Uint8Array(ciphertext);
    tampered[tampered.length - 1] ^= 0xff;

    await expect(mod.decryptPayload(tampered, aesKey)).rejects.toThrow();
  });

  it('fails to decrypt with the wrong key (different secret)', async () => {
    const mod = await importSyncCrypto();
    const secretA = mod.generateSecret();
    const secretB = mod.generateSecret();
    const keyA = await mod.deriveAesKey(secretA);
    const keyB = await mod.deriveAesKey(secretB);

    const ciphertext = await mod.encryptPayload('{"x":1}', keyA);

    await expect(mod.decryptPayload(ciphertext, keyB)).rejects.toThrow();
  });
});

describe('sync-crypto: HKDF derivation determinism', () => {
  beforeEach(() => {
    installChromeFake();
  });

  it('derives the same authToken from the same secret', async () => {
    const mod = await importSyncCrypto();
    const secret = mod.generateSecret();

    const tokenA = await mod.deriveAuthToken(secret);
    const tokenB = await mod.deriveAuthToken(secret);

    expect(tokenA).toBe(tokenB);
  });

  it('derives a lowercase hex string of 64 chars (32 bytes) for authToken', async () => {
    const mod = await importSyncCrypto();
    const secret = mod.generateSecret();

    const token = await mod.deriveAuthToken(secret);

    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('derives different outputs for different secrets', async () => {
    const mod = await importSyncCrypto();
    const secretA = mod.generateSecret();
    const secretB = mod.generateSecret();

    const tokenA = await mod.deriveAuthToken(secretA);
    const tokenB = await mod.deriveAuthToken(secretB);

    expect(tokenA).not.toBe(tokenB);
  });

  it('derives different key material for different HKDF info strings (auth vs enc)', async () => {
    const mod = await importSyncCrypto();
    const secret = mod.generateSecret();

    const authToken = await mod.deriveAuthToken(secret);
    const aesKey = await mod.deriveAesKey(secret);
    const rawAesKeyBytes = await crypto.subtle.exportKey('raw', aesKey);
    const aesKeyHex = Buffer.from(rawAesKeyBytes).toString('hex');

    expect(authToken).not.toBe(aesKeyHex);
  });
});

describe('sync-crypto: get-or-create master secret', () => {
  beforeEach(() => {
    installChromeFake();
  });

  it('creates a new secret on first call', async () => {
    const mod = await importSyncCrypto();
    const secret = await mod.getOrCreateSyncSecret();

    expect(secret.byteLength).toBe(32);
  });

  it('returns the SAME secret on a second call (persisted, not regenerated)', async () => {
    const mod = await importSyncCrypto();
    const first = await mod.getOrCreateSyncSecret();
    const second = await mod.getOrCreateSyncSecret();

    expect(Buffer.from(second).toString('hex')).toBe(Buffer.from(first).toString('hex'));
  });

  it('persists the secret across a simulated service-worker restart (fresh module + same storage)', async () => {
    const fake = installChromeFake();
    const mod1 = await importSyncCrypto();
    const first = await mod1.getOrCreateSyncSecret();

    // Simulate SW restart: fresh module instance, but same underlying storage data.
    const { vi } = await import('vitest');
    vi.resetModules();
    (globalThis as unknown as { chrome?: unknown }).chrome = {
      runtime: { id: 'test-extension' },
      storage: {
        local: fake.local.api,
        sync: fake.sync.api,
        onChanged: { addListener: () => undefined },
      },
    };
    const mod2 = await import('@/shared/sync-crypto');
    const second = await mod2.getOrCreateSyncSecret();

    expect(Buffer.from(second).toString('hex')).toBe(Buffer.from(first).toString('hex'));
  });
});

describe('sync-crypto: pairing code encode/decode', () => {
  beforeEach(() => {
    installChromeFake();
  });

  it('round-trips a secret through encode -> decode', async () => {
    const mod = await importSyncCrypto();
    const secret = mod.generateSecret();

    const code = await mod.encodePairingCode(secret);
    const decoded = await mod.decodePairingCode(code);

    expect(Buffer.from(decoded).toString('hex')).toBe(Buffer.from(secret).toString('hex'));
  });

  it('formats the code as uppercase base32 grouped in blocks of 4 separated by dashes', async () => {
    const mod = await importSyncCrypto();
    const secret = mod.generateSecret();

    const code = await mod.encodePairingCode(secret);

    // 34 bytes (32 secret + 2 checksum) base32-encodes to 55 chars (no padding),
    // so the final block is a 3-char remainder — allow 1-4 chars in the last group.
    expect(code).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4})*(-[A-Z2-7]{1,4})?$/);
    expect(code.replace(/-/g, '')).toMatch(/^[A-Z2-7]+$/);
  });

  it('tolerates lowercase, dashes, and surrounding whitespace on decode', async () => {
    const mod = await importSyncCrypto();
    const secret = mod.generateSecret();
    const code = await mod.encodePairingCode(secret);

    const messy = `  ${code.toLowerCase().replace(/-/g, ' ')}  `;
    const decoded = await mod.decodePairingCode(messy);

    expect(Buffer.from(decoded).toString('hex')).toBe(Buffer.from(secret).toString('hex'));
  });

  it('rejects a code with a tampered checksum', async () => {
    const mod = await importSyncCrypto();
    const secret = mod.generateSecret();
    const code = await mod.encodePairingCode(secret);

    // Flip the last character to corrupt the checksum tail while keeping valid
    // base32 alphabet and length.
    const lastChar = code[code.length - 1];
    const replacement = lastChar === 'A' ? 'B' : 'A';
    const tampered = code.slice(0, -1) + replacement;

    await expect(mod.decodePairingCode(tampered)).rejects.toThrow(mod.SyncCryptoError);
  });

  it('rejects a code with the wrong length', async () => {
    const mod = await importSyncCrypto();
    const secret = mod.generateSecret();
    const code = await mod.encodePairingCode(secret);
    const truncated = code.slice(0, -8);

    await expect(mod.decodePairingCode(truncated)).rejects.toThrow(mod.SyncCryptoError);
  });

  it('rejects garbage input gracefully with a typed error', async () => {
    const mod = await importSyncCrypto();

    await expect(mod.decodePairingCode('not-a-real-code')).rejects.toThrow(mod.SyncCryptoError);
  });
});
