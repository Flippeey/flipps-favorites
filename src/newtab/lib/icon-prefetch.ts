import type { BookmarkNode } from '@/shared/messages';
import { isFaviconCached, prefetchFavicon } from './favicon-cache';

const CONCURRENCY = 4;
const prefetchedUrls = new Set<string>();

interface PrefetchItem {
  url: string;
  title: string;
}

function collectBookmarks(nodes: BookmarkNode[], out: PrefetchItem[]): void {
  for (const node of nodes) {
    if (node.url) {
      out.push({ url: node.url, title: node.title });
    }
    if (node.children) {
      collectBookmarks(node.children, out);
    }
  }
}

interface IdleDeadline {
  didTimeout: boolean;
  timeRemaining(): number;
}

type IdleHandle = number;
interface WindowWithIdle {
  requestIdleCallback?: (cb: (deadline: IdleDeadline) => void, opts?: { timeout?: number }) => IdleHandle;
}

function scheduleIdle(fn: () => void): void {
  const w = window as Window & WindowWithIdle;
  if (typeof w.requestIdleCallback === 'function') {
    w.requestIdleCallback(() => fn(), { timeout: 2000 });
  } else {
    setTimeout(fn, 300);
  }
}

function runPrefetchBatch(tree: BookmarkNode[]): void {
  const items: PrefetchItem[] = [];
  collectBookmarks(tree, items);
  const pending = items.filter(item => !prefetchedUrls.has(item.url) && !isFaviconCached(item.url));
  if (pending.length === 0) return;

  let cursor = 0;
  const worker = async () => {
    while (cursor < pending.length) {
      const idx = cursor++;
      const { url, title } = pending[idx];
      prefetchedUrls.add(url);
      await prefetchFavicon(url, title);
    }
  };
  for (let i = 0; i < CONCURRENCY; i += 1) {
    void worker();
  }
}

/**
 * Eager prefetch for bootstrap — fires immediately (no idle scheduling).
 * Call from main.tsx BEFORE createRoot().render() so icon fetches are
 * in-flight before <Favicon> components mount.
 */
export function prefetchAllIconsEager(tree: BookmarkNode[]): void {
  runPrefetchBatch(tree);
}

/**
 * Deferred prefetch for tree-change refreshes — schedules via
 * requestIdleCallback to avoid blocking user interaction.
 */
export function prefetchAllIcons(tree: BookmarkNode[]): void {
  scheduleIdle(() => runPrefetchBatch(tree));
}
