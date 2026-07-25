// Unit tests for AppSettings normalization (normalizeSettings, exercised
// indirectly via readSettings, which is the store's deserialize path).

import { afterEach, describe, expect, it, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Chrome storage fake — must be installed BEFORE the module under test imports.
// Mirrors the pattern in storage-onboarding-state.test.ts.
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
      for (const key of list) {
        if (key in data) out[key] = data[key];
      }
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

function installChromeFake(syncSeed: Record<string, unknown> = {}): void {
  const local = createAreaFake({});
  const sync = createAreaFake(syncSeed);
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

async function importStorage(): Promise<typeof import('@/shared/storage')> {
  vi.resetModules();
  return import('@/shared/storage');
}

afterEach(() => {
  vi.resetModules();
  (globalThis as unknown as { chrome?: unknown }).chrome = undefined;
  (globalThis as unknown as { browser?: unknown }).browser = undefined;
});

const SETTINGS_KEY = 'app-settings';

// ─────────────────────────────────────────────────────────────────────────────
// normalizeSettings — folderCountBadgeMode
// Exercised indirectly via readSettings, which runs the store's deserialize()
// -> normalizeSettings(). A stale stored blob (written before this field
// existed) must not break settings load, and must fall back to 'always' -- the
// badge-visible behaviour existing users already see, so upgrading never
// silently hides a badge nobody opted to hide.
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeSettings — folderCountBadgeMode', () => {
  it('keeps a valid "always" value as-is', async () => {
    installChromeFake({ [SETTINGS_KEY]: { folderCountBadgeMode: 'always' } });

    const storage = await importStorage();
    const settings = await storage.readSettings();

    expect(settings.folderCountBadgeMode).toBe('always');
  });

  it('keeps a valid "hover" value as-is', async () => {
    installChromeFake({ [SETTINGS_KEY]: { folderCountBadgeMode: 'hover' } });

    const storage = await importStorage();
    const settings = await storage.readSettings();

    expect(settings.folderCountBadgeMode).toBe('hover');
  });

  it('falls back to "always" for an invalid stored value', async () => {
    installChromeFake({ [SETTINGS_KEY]: { folderCountBadgeMode: 'sometimes' } });

    const storage = await importStorage();
    const settings = await storage.readSettings();

    expect(settings.folderCountBadgeMode).toBe('always');
  });

  it('defaults to "always" when the field is absent from a stale stored blob', async () => {
    // Simulates settings written by an older extension version, before this
    // field existed. Must not throw, and must preserve the always-visible
    // behaviour those existing users already had.
    installChromeFake({ [SETTINGS_KEY]: { showSearchBar: true } });

    const storage = await importStorage();
    const settings = await storage.readSettings();

    expect(settings.folderCountBadgeMode).toBe('always');
  });
});
