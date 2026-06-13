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
      // Sync storage quota exceeded: demote permanently to local for this store
      // instance and retry. This covers the workspace store when 20 workspaces
      // exceed Chrome sync's per-item 8 KB limit.
      if (storageArea.name === 'sync' && /quota/i.test(detail)) {
        const localArea = getLocalArea();
        areaPromise = Promise.resolve(localArea);
        hasCache = false;
        loadPromise = null;
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
