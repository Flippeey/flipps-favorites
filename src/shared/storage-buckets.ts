import { extensionApi } from './browser';

export type StorageAreaPreference = 'local' | 'sync-preferred';
type ResolvedStorageAreaName = 'local' | 'sync';

interface StorageAreaApi {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove?: (keys: string | string[]) => Promise<void>;
}

interface ResolvedStorageArea {
  name: ResolvedStorageAreaName;
  api: StorageAreaApi;
}

export interface CachedValueStore<T> {
  read: () => Promise<T>;
  readFresh: () => Promise<T>;
  write: (value: T) => Promise<T>;
  clearCache: () => void;
}

export interface CachedRecordStore<T> {
  readAll: () => Promise<Record<string, T>>;
  readOne: (key: string) => Promise<T | null>;
  writeOne: (key: string, value: T) => Promise<void>;
  deleteOne: (key: string) => Promise<void>;
  clearAll: () => Promise<void>;
}

export function createCachedValueStore<T>(args: {
  storageKey: string;
  deserialize: (storedValue: unknown) => T;
  serialize?: (value: T) => unknown;
  area?: StorageAreaPreference;
  migrateFromLocal?: boolean;
}): CachedValueStore<T> {
  const {
    storageKey,
    deserialize,
    serialize = identity,
    area = 'local',
    migrateFromLocal = false,
  } = args;
  let hasCache = false;
  let cacheValue: T;
  let loadPromise: Promise<T> | null = null;
  let areaPromise: Promise<ResolvedStorageArea> | null = null;
  let listenerAttached = false;

  const getLocalArea = (): ResolvedStorageArea => ({
    name: 'local',
    api: extensionApi.storage.local as unknown as StorageAreaApi,
  });

  // Persisted marker (in local) recording that this store outgrew sync's
  // per-item quota and was demoted to local. Without it the demotion is only
  // in-memory: a service-worker restart re-resolves to sync and reads the stale
  // pre-overflow copy, silently dropping everything written after the overflow
  // (e.g. workspaces created past ~12).
  const demotedMarkerKey = `${storageKey}::demoted-to-local`;

  async function isDemotedToLocal(): Promise<boolean> {
    try {
      const stored = await getLocalArea().api.get(demotedMarkerKey);
      return stored[demotedMarkerKey] === true;
    } catch {
      return false;
    }
  }

  async function persistDemotion(): Promise<void> {
    try {
      await getLocalArea().api.set({ [demotedMarkerKey]: true });
    } catch {
      // Best effort: the in-memory demotion (areaPromise) still applies this session.
    }
  }

  function attachStorageChangeListener(areaName: ResolvedStorageAreaName): void {
    if (listenerAttached || !extensionApi.storage?.onChanged?.addListener) {
      return;
    }

    extensionApi.storage.onChanged.addListener((changes: Record<string, unknown>, changedArea: string) => {
      if (changedArea !== areaName || !(storageKey in changes)) {
        return;
      }

      hasCache = false;
      loadPromise = null;
    });

    listenerAttached = true;
  }

  async function resolveStorageArea(): Promise<ResolvedStorageArea> {
    if (!areaPromise) {
      areaPromise = (async () => {
        if (area !== 'sync-preferred') {
          return getLocalArea();
        }

        const syncArea = extensionApi.storage?.sync;
        if (!syncArea?.get || !syncArea?.set) {
          return getLocalArea();
        }

        // A prior write demoted this store to local (value outgrew sync's
        // per-item quota). Honor it permanently so reads don't regress to the
        // stale sync copy after a service-worker restart.
        if (await isDemotedToLocal()) {
          return getLocalArea();
        }

        try {
          await syncArea.get(null);
          return {
            name: 'sync',
            api: syncArea as unknown as StorageAreaApi,
          };
        } catch {
          return getLocalArea();
        }
      })();
    }

    const resolved = await areaPromise;
    attachStorageChangeListener(resolved.name);
    return resolved;
  }

  async function readStorageValue(storageArea: ResolvedStorageArea): Promise<unknown> {
    const stored = await storageArea.api.get(storageKey);
    return stored[storageKey];
  }

  async function writeStorageValue(storageArea: ResolvedStorageArea, value: unknown): Promise<void> {
    try {
      await storageArea.api.set({
        [storageKey]: value,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      // Sync storage quota exceeded: demote to local for this store and retry.
      // This covers the workspace store once enough workspaces exceed Chrome
      // sync's per-item 8 KB limit (~12 full records). Persist a marker so the
      // demotion survives service-worker restarts — otherwise the next read
      // resolves back to sync and drops everything written past the overflow.
      if (storageArea.name === 'sync' && /quota/i.test(detail)) {
        const localArea = getLocalArea();
        areaPromise = Promise.resolve(localArea);
        hasCache = false;
        loadPromise = null;
        await persistDemotion();
        await localArea.api.set({ [storageKey]: value });
        return;
      }
      throw new Error(`Failed to write ${storageArea.name} storage key "${storageKey}": ${detail}`);
    }
  }

  async function loadValue(forceRefresh: boolean): Promise<T> {
    if (!forceRefresh && hasCache) {
      return cacheValue;
    }

    const storageArea = await resolveStorageArea();
    let storedValue = await readStorageValue(storageArea);

    if (storedValue === undefined && migrateFromLocal && storageArea.name !== 'local') {
      const localValue = await readStorageValue(getLocalArea());
      if (localValue !== undefined) {
        await writeStorageValue(storageArea, localValue);
        storedValue = localValue;
      }
    }

    const value = deserialize(storedValue);
    cacheValue = value;
    hasCache = true;
    loadPromise = null;
    return value;
  }

  return {
    async read(): Promise<T> {
      if (hasCache) {
        return cacheValue;
      }

      if (!loadPromise) {
        loadPromise = loadValue(false).catch(error => {
          loadPromise = null;
          throw error;
        });
      }

      return loadPromise;
    },
    async readFresh(): Promise<T> {
      return loadValue(true);
    },
    async write(value: T): Promise<T> {
      const storageArea = await resolveStorageArea();
      await writeStorageValue(storageArea, serialize(value));

      cacheValue = value;
      hasCache = true;
      loadPromise = null;
      return value;
    },
    clearCache(): void {
      hasCache = false;
      loadPromise = null;
    },
  };
}

export function createCachedRecordStore<T>(args: {
  storageKey: string;
  area?: StorageAreaPreference;
  migrateFromLocal?: boolean;
  resolveConflict?: (current: T, incoming: T) => T;
  // Optional per-record normalizer applied on read. Storage values are untrusted
  // input (sync peers on older versions may write field-less records); a record
  // that fails narrowing returns null and is dropped from the map.
  deserializeRecord?: (value: unknown) => T | null;
}): CachedRecordStore<T> {
  const { storageKey, area, migrateFromLocal, resolveConflict, deserializeRecord } = args;
  const valueStore = createCachedValueStore<Record<string, T>>({
    storageKey,
    area,
    migrateFromLocal,
    deserialize(storedValue) {
      if (!storedValue || typeof storedValue !== 'object') {
        return {};
      }

      const rawMap = storedValue as Record<string, unknown>;
      if (!deserializeRecord) {
        return { ...(rawMap as Record<string, T>) };
      }

      const normalized: Record<string, T> = {};
      for (const [key, value] of Object.entries(rawMap)) {
        const record = deserializeRecord(value);
        if (record !== null) {
          normalized[key] = record;
        }
      }
      return normalized;
    },
    serialize(value) {
      return { ...value };
    },
  });

  return {
    async readAll(): Promise<Record<string, T>> {
      return { ...(await valueStore.read()) };
    },
    async readOne(key: string): Promise<T | null> {
      const records = await valueStore.read();
      return records[key] ?? null;
    },
    async writeOne(key: string, value: T): Promise<void> {
      const records = await valueStore.readFresh();
      const nextValue = key in records && resolveConflict
        ? resolveConflict(records[key] as T, value)
        : value;
      await valueStore.write({
        ...records,
        [key]: nextValue,
      });
    },
    async deleteOne(key: string): Promise<void> {
      const records = await valueStore.read();
      if (!(key in records)) {
        return;
      }

      const nextRecords = { ...records };
      delete nextRecords[key];
      await valueStore.write(nextRecords);
    },
    async clearAll(): Promise<void> {
      await valueStore.write({});
    },
  };
}

function identity<T>(value: T): T {
  return value;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-key record store
//
// Stores each record under its own chrome.storage key `<keyPrefix>:<id>` so
// Chrome sync's 8 KB-per-item limit applies per record rather than to the
// whole set. readAll enumerates by calling get(null) and filtering by prefix —
// acceptable for small sets (≤ 20 workspace items + small overhead).
// ─────────────────────────────────────────────────────────────────────────────

export interface PerKeyRecordStore<T> {
  readAll: () => Promise<Record<string, T>>;
  readOne: (id: string) => Promise<T | null>;
  writeOne: (id: string, value: T) => Promise<void>;
  deleteOne: (id: string) => Promise<void>;
  /** Remove every key with this prefix from storage (used during migration tests). */
  clearAll: () => Promise<void>;
}

export function createPerKeyRecordStore<T>(args: {
  keyPrefix: string;
  area?: StorageAreaPreference;
  deserializeRecord?: (value: unknown) => T | null;
}): PerKeyRecordStore<T> {
  const { keyPrefix, area = 'sync-preferred', deserializeRecord } = args;

  // One shared area resolver so all operations in a lifetime agree on the area.
  let areaPromise: Promise<ResolvedStorageArea> | null = null;

  const getLocalArea = (): ResolvedStorageArea => ({
    name: 'local',
    api: extensionApi.storage.local as unknown as StorageAreaApi,
  });

  async function resolveArea(): Promise<ResolvedStorageArea> {
    if (!areaPromise) {
      areaPromise = (async () => {
        if (area !== 'sync-preferred') {
          return getLocalArea();
        }
        const syncArea = extensionApi.storage?.sync;
        if (!syncArea?.get || !syncArea?.set) {
          return getLocalArea();
        }
        try {
          await (syncArea as unknown as StorageAreaApi).get(null);
          return { name: 'sync', api: syncArea as unknown as StorageAreaApi };
        } catch {
          return getLocalArea();
        }
      })();
    }
    return areaPromise;
  }

  function storageKey(id: string): string {
    return `${keyPrefix}:${id}`;
  }

  function parseId(key: string): string {
    return key.slice(keyPrefix.length + 1);
  }

  function deserialize(raw: unknown): T | null {
    if (deserializeRecord) return deserializeRecord(raw);
    return raw as T;
  }

  return {
    async readAll(): Promise<Record<string, T>> {
      const { api } = await resolveArea();
      const all = await api.get(null);
      const result: Record<string, T> = {};
      const prefix = keyPrefix + ':';
      for (const [key, raw] of Object.entries(all)) {
        if (!key.startsWith(prefix)) continue;
        const record = deserialize(raw);
        if (record !== null) {
          result[parseId(key)] = record;
        }
      }
      return result;
    },

    async readOne(id: string): Promise<T | null> {
      const { api } = await resolveArea();
      const stored = await api.get(storageKey(id));
      const raw = stored[storageKey(id)];
      if (raw === undefined) return null;
      return deserialize(raw);
    },

    async writeOne(id: string, value: T): Promise<void> {
      const { api } = await resolveArea();
      await api.set({ [storageKey(id)]: value });
    },

    async deleteOne(id: string): Promise<void> {
      const { api } = await resolveArea();
      if (api.remove) {
        await api.remove(storageKey(id));
      } else {
        // Fallback: read–modify–write (shouldn't be needed for standard areas).
        const all = await api.get(null);
        const next: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(all)) {
          if (key !== storageKey(id)) next[key] = val;
        }
        await api.set(next);
      }
    },

    async clearAll(): Promise<void> {
      const { api } = await resolveArea();
      const all = await api.get(null);
      const prefix = keyPrefix + ':';
      const keys = Object.keys(all).filter(k => k.startsWith(prefix));
      if (!keys.length) return;
      if (api.remove) {
        await api.remove(keys);
      } else {
        const next: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(all)) {
          if (!key.startsWith(prefix)) next[key] = val;
        }
        await api.set(next);
      }
    },
  };
}
