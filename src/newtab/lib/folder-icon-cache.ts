// Per-tab in-memory cache for folder custom icons — mirrors favicon-cache.ts's
// pattern (cache + in-flight dedup + subscriber notification) but keyed by
// folder id instead of bookmark URL, and the "miss" value is `null` (no custom
// icon set — the default collage/glyph rendering applies), not a generated
// fallback image.
import { getFolderIcon } from './messaging';

export const folderIconCache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();
const subscribers = new Map<string, Set<() => void>>();

export function invalidateFolderIconCache(folderId: string): void {
  folderIconCache.delete(folderId);
  inflight.delete(folderId);
  const listeners = subscribers.get(folderId);
  if (listeners) {
    listeners.forEach(fn => fn());
  }
}

export function subscribeFolderIconCache(folderId: string, listener: () => void): () => void {
  let set = subscribers.get(folderId);
  if (!set) {
    set = new Set();
    subscribers.set(folderId, set);
  }
  set.add(listener);
  return () => {
    const current = subscribers.get(folderId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) subscribers.delete(folderId);
  };
}

export async function fetchFolderIcon(folderId: string): Promise<string | null> {
  if (folderIconCache.has(folderId)) return folderIconCache.get(folderId) ?? null;
  const pending = inflight.get(folderId);
  if (pending) return pending;
  const promise = (async () => {
    try {
      const record = await getFolderIcon(folderId);
      const dataUrl = record?.dataUrl ?? null;
      folderIconCache.set(folderId, dataUrl);
      return dataUrl;
    } finally {
      inflight.delete(folderId);
    }
  })();
  inflight.set(folderId, promise);
  return promise;
}
