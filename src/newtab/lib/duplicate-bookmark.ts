// Pure helper for the QuickAdd duplicate hint (non-blocking). Reuses the same
// canonical-URL key the archetype classifier already computes in
// tree-profile.ts — no new dedupe machinery, just a lookup over the existing
// tree.

import type { BookmarkNode } from '@/shared/messages';
import { canonicalUrlForDedup } from './url';

export interface DuplicateBookmarkMatch {
  /** Title of the folder directly containing the matching bookmark. */
  folderTitle: string;
}

// Walks `tree` for the first bookmark whose canonical URL matches `url`.
// Returns the containing folder's title, or null when there's no match (or
// `url` doesn't canonicalize, e.g. it's incomplete/non-http(s)).
export function findDuplicateBookmark(tree: BookmarkNode[], url: string): DuplicateBookmarkMatch | null {
  const key = canonicalUrlForDedup(url);
  if (key === null) return null;

  function walk(node: BookmarkNode): DuplicateBookmarkMatch | null {
    for (const child of node.children ?? []) {
      if (Array.isArray(child.children)) {
        const found = walk(child);
        if (found) return found;
      } else if (child.url && canonicalUrlForDedup(child.url) === key) {
        return { folderTitle: node.title };
      }
    }
    return null;
  }

  for (const root of tree) {
    const found = walk(root);
    if (found) return found;
  }
  return null;
}
