import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Regression guard for #7 (settings sync): the sync master secret must NEVER
// appear in a workspace export/backup file, since exports are user-downloaded
// JSON and may be shared/uploaded elsewhere. buildWorkspaceExport() only reads
// settings/workspaces/iconOverrides/bookmarkUsage — it has no code path that
// touches the 'sync-secret' storage key — but this test proves it at the
// storage layer rather than relying on that staying true by convention.

vi.mock('@/shared/icon-idb', () => ({
  readAllIconOverrides: async () => ({}),
  clearCachedIcons: async () => undefined,
  clearIconOverrides: async () => undefined,
  deleteCachedIcon: async () => undefined,
  deleteIconOverride: async () => undefined,
  readAllCachedIcons: async () => ({}),
  readCachedIcon: async () => null,
  readIconOverride: async () => null,
  writeIconOverride: async () => undefined,
  writeCachedIcon: async () => undefined,
}));

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

function installChromeFake(syncSecretBase64: string): void {
  const local = createAreaFake();
  // Seed the sync secret directly under its real storage key, exactly as
  // sync-crypto.ts's getOrCreateSyncSecret() would persist it.
  const sync = createAreaFake({ 'sync-secret': syncSecretBase64 });
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
}

afterEach(() => {
  vi.resetModules();
  (globalThis as unknown as { chrome?: unknown }).chrome = undefined;
  (globalThis as unknown as { browser?: unknown }).browser = undefined;
});

describe('buildWorkspaceExport excludes the sync master secret', () => {
  beforeEach(() => {
    // A recognizable base64 secret value planted directly in sync storage.
    installChromeFake('c2VjcmV0LXNlY3JldC1zZWNyZXQtc2VjcmV0LTEyMzQ1Ng==');
  });

  it('does not include the sync-secret key or its value anywhere in the serialized export', async () => {
    vi.resetModules();
    const transferMod = await import('@/newtab/lib/workspace-transfer');

    const payload = await transferMod.buildWorkspaceExport();
    const serialized = JSON.stringify(payload);

    expect(serialized).not.toContain('sync-secret');
    expect(serialized).not.toContain('c2VjcmV0LXNlY3JldC1zZWNyZXQtc2VjcmV0LTEyMzQ1Ng==');
    expect(Object.keys(payload)).not.toContain('syncSecret');
  });
});
