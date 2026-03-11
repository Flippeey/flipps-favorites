import { extensionApi } from './browser';

export interface CachedValueStore<T> {
  read: () => Promise<T>;
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
}): CachedValueStore<T> {
  const { storageKey, deserialize, serialize = identity } = args;
  let hasCache = false;
  let cacheValue: T;
  let loadPromise: Promise<T> | null = null;

  return {
    async read(): Promise<T> {
      if (hasCache) {
        return cacheValue;
      }

      if (!loadPromise) {
        loadPromise = (async () => {
          const stored = await extensionApi.storage.local.get(storageKey) as Record<string, unknown>;
          const value = deserialize(stored[storageKey]);
          cacheValue = value;
          hasCache = true;
          loadPromise = null;
          return value;
        })().catch(error => {
          loadPromise = null;
          throw error;
        });
      }

      return loadPromise;
    },
    async write(value: T): Promise<T> {
      await extensionApi.storage.local.set({
        [storageKey]: serialize(value),
      });

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

export function createCachedRecordStore<T>(storageKey: string): CachedRecordStore<T> {
  const valueStore = createCachedValueStore<Record<string, T>>({
    storageKey,
    deserialize(storedValue) {
      if (!storedValue || typeof storedValue !== 'object') {
        return {};
      }

      return { ...(storedValue as Record<string, T>) };
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
      const records = await valueStore.read();
      await valueStore.write({
        ...records,
        [key]: value,
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
