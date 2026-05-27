import type { IconCacheRecord, IconOverrideRecord } from './messages';

const DB_NAME = 'ff-icons';
const DB_VERSION = 1;
const STORE_CACHE = 'cache';
const STORE_OVERRIDES = 'overrides';

let _db: IDBDatabase | null = null;

function getDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_CACHE)) {
        db.createObjectStore(STORE_CACHE, { keyPath: 'cacheKey' });
      }
      if (!db.objectStoreNames.contains(STORE_OVERRIDES)) {
        db.createObjectStore(STORE_OVERRIDES, { keyPath: 'bookmarkUrl' });
      }
    };
    req.onsuccess = () => {
      _db = req.result;
      _db.onclose = () => { _db = null; };
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('ff-icons IDB open blocked'));
  });
}

function idbGet<T>(storeName: string, key: string): Promise<T | undefined> {
  return getDB().then(db => new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  }));
}

function idbPut<T>(storeName: string, value: T): Promise<void> {
  return getDB().then(db => new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readwrite').objectStore(storeName).put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  }));
}

function idbDelete(storeName: string, key: string): Promise<void> {
  return getDB().then(db => new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readwrite').objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  }));
}

function idbClear(storeName: string): Promise<void> {
  return getDB().then(db => new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readwrite').objectStore(storeName).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  }));
}

function idbGetAll<T>(storeName: string): Promise<T[]> {
  return getDB().then(db => new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  }));
}

export async function readCachedIcon(cacheKey: string): Promise<IconCacheRecord | null> {
  return (await idbGet<IconCacheRecord>(STORE_CACHE, cacheKey)) ?? null;
}

export async function writeCachedIcon(record: IconCacheRecord): Promise<void> {
  await idbPut(STORE_CACHE, record);
}

export async function deleteCachedIcon(cacheKey: string): Promise<void> {
  await idbDelete(STORE_CACHE, cacheKey);
}

export async function clearCachedIcons(): Promise<void> {
  await idbClear(STORE_CACHE);
}

export async function readAllCachedIcons(): Promise<Record<string, IconCacheRecord>> {
  const all = await idbGetAll<IconCacheRecord>(STORE_CACHE);
  return Object.fromEntries(all.map(r => [r.cacheKey, r]));
}

export async function evictExpiredCachedIcons(): Promise<number> {
  const all = await idbGetAll<IconCacheRecord>(STORE_CACHE);
  const now = Date.now();
  let evicted = 0;
  for (const record of all) {
    if (typeof record.expiresAt === 'number' && record.expiresAt < now) {
      await idbDelete(STORE_CACHE, record.cacheKey);
      evicted++;
    }
  }
  return evicted;
}

export async function readIconOverride(bookmarkUrl: string): Promise<IconOverrideRecord | null> {
  return (await idbGet<IconOverrideRecord>(STORE_OVERRIDES, bookmarkUrl)) ?? null;
}

export async function writeIconOverride(record: IconOverrideRecord): Promise<void> {
  await idbPut(STORE_OVERRIDES, record);
}

export async function deleteIconOverride(bookmarkUrl: string): Promise<void> {
  await idbDelete(STORE_OVERRIDES, bookmarkUrl);
}

export async function clearIconOverrides(): Promise<void> {
  await idbClear(STORE_OVERRIDES);
}

export async function readAllIconOverrides(): Promise<Record<string, IconOverrideRecord>> {
  const all = await idbGetAll<IconOverrideRecord>(STORE_OVERRIDES);
  return Object.fromEntries(all.map(r => [r.bookmarkUrl, r]));
}
