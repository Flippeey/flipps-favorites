import type { FolderIconOverrideRecord, IconCacheRecord, IconOverrideRecord } from './messages';
import { getOverrideKeyForScope } from './icon-scope';

const DB_NAME = 'ff-icons';
// v2: overrides store re-keyed from bookmarkUrl to overrideKey so scoped
// (host/domain) records can coexist with exact-URL ones.
// v3: (historical) added optional `fit` field — now removed; ignored on read.
// v4: added folder-icons store (additive — existing stores are untouched, no
// record migration needed).
const DB_VERSION = 4;
const STORE_CACHE = 'cache';
const STORE_OVERRIDES = 'overrides';
const STORE_FOLDER_ICONS = 'folder-icons';

// Out-of-line key for the folder-icons store — the store has no keyPath, so
// callers pass this derived key explicitly to idbGet/idbPut/idbDelete.
function getFolderIconKey(folderId: string): string {
  return `folder:${folderId}`;
}

let _db: IDBDatabase | null = null;

function getDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = event.oldVersion;
      if (!db.objectStoreNames.contains(STORE_CACHE)) {
        db.createObjectStore(STORE_CACHE, { keyPath: 'cacheKey' });
      }
      if (!db.objectStoreNames.contains(STORE_FOLDER_ICONS)) {
        // Out-of-line keys (no keyPath): keys are derived via getFolderIconKey.
        db.createObjectStore(STORE_FOLDER_ICONS);
      }
      if (!db.objectStoreNames.contains(STORE_OVERRIDES)) {
        db.createObjectStore(STORE_OVERRIDES, { keyPath: 'overrideKey' });
      } else if (oldVersion < 2 && req.transaction) {
        // Re-key existing v1 records (keyPath bookmarkUrl) as exact-scope records.
        // All requests stay inside the versionchange transaction, which remains
        // alive while any of them are pending.
        const upgradeTx = req.transaction;
        const legacyStore = upgradeTx.objectStore(STORE_OVERRIDES);
        const readAll = legacyStore.getAll();
        readAll.onsuccess = () => {
          const legacyRecords = readAll.result as Array<Omit<IconOverrideRecord, 'scope'>>;
          db.deleteObjectStore(STORE_OVERRIDES);
          const nextStore = db.createObjectStore(STORE_OVERRIDES, { keyPath: 'overrideKey' });
          for (const legacy of legacyRecords) {
            const migrated: IconOverrideRecord = {
              ...legacy,
              scope: 'exact',
              overrideKey: getOverrideKeyForScope(legacy.bookmarkUrl, 'exact') ?? `exact:${legacy.bookmarkUrl}`,
            };
            nextStore.put(migrated);
          }
        };
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

function idbPut<T>(storeName: string, value: T, key?: IDBValidKey): Promise<void> {
  return getDB().then(db => new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readwrite').objectStore(storeName).put(value, key);
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

export async function readIconOverride(overrideKey: string): Promise<IconOverrideRecord | null> {
  return (await idbGet<IconOverrideRecord>(STORE_OVERRIDES, overrideKey)) ?? null;
}

export async function writeIconOverride(record: IconOverrideRecord): Promise<void> {
  await idbPut(STORE_OVERRIDES, record);
}

export async function deleteIconOverride(overrideKey: string): Promise<void> {
  await idbDelete(STORE_OVERRIDES, overrideKey);
}

export async function clearIconOverrides(): Promise<void> {
  await idbClear(STORE_OVERRIDES);
}

export async function readAllIconOverrides(): Promise<Record<string, IconOverrideRecord>> {
  const all = await idbGetAll<IconOverrideRecord>(STORE_OVERRIDES);
  return Object.fromEntries(all.map(r => [r.overrideKey, r]));
}

export async function readFolderIconRecord(folderId: string): Promise<FolderIconOverrideRecord | null> {
  return (await idbGet<FolderIconOverrideRecord>(STORE_FOLDER_ICONS, getFolderIconKey(folderId))) ?? null;
}

export async function writeFolderIconRecord(record: FolderIconOverrideRecord): Promise<void> {
  await idbPut(STORE_FOLDER_ICONS, record, getFolderIconKey(record.folderId));
}

export async function deleteFolderIconRecord(folderId: string): Promise<void> {
  await idbDelete(STORE_FOLDER_ICONS, getFolderIconKey(folderId));
}

export async function readAllFolderIconRecords(): Promise<Record<string, FolderIconOverrideRecord>> {
  const all = await idbGetAll<FolderIconOverrideRecord>(STORE_FOLDER_ICONS);
  return Object.fromEntries(all.map(r => [r.folderId, r]));
}
