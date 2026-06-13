// Pure structural profiler over a set of selected workspace root folders.
// Performs a single O(n) walk and returns signals consumed by the persona
// classifier (Wave 6). All ratios are guarded against division-by-zero;
// an empty or tiny tree returns a zeroed profile with no NaN values.

import type { BookmarkNode } from '@/shared/messages';
import { extractBrandInfo } from '@/shared/url-brand';
import { SYSTEM_FOLDER_IDS } from './folder-scoring';
import { canonicalUrlForDedup } from './url';

// ---------------------------------------------------------------------------
// Constants — one-line rationale per threshold.
// ---------------------------------------------------------------------------

// A folder holding at least this share of total bookmarks is "giant".
// 0.40 means a single folder with 40%+ of all bookmarks dominates the tree.
export const GIANT_FOLDER_MIN = 0.40;

// Recency window: bookmarks added within 30 days count as recent.
// 30 days balances "just started using this" vs. "actively maintained".
const RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface TreeProfile {
  totalBookmarks: number;
  totalFolders: number;
  maxDepth: number;
  /** Bookmarks nested one+ levels below a selected root / total. */
  folderedRatio: number;
  /** Share of bookmarks in folders whose bookmark count >= GIANT_FOLDER_MIN * total. */
  giantFolderShare: number;
  /** Rate of duplicate canonical URLs (0 = all unique). */
  duplicateUrlRate: number;
  /** Unique brand domains / total bookmarks (capped at 1). */
  domainDiversity: number;
  /** Bookmarks with dateAdded within RECENT_WINDOW_MS / total; undefined = not recent. */
  recentAdditionRatio: number;
}

// ---------------------------------------------------------------------------
// Internal accumulator
// ---------------------------------------------------------------------------

interface WalkState {
  totalBookmarks: number;
  totalFolders: number;
  maxDepth: number;
  /** Bookmarks that are NOT direct children of a selected root. */
  nestedBookmarks: number;
  /** Per-folder bookmark subtree counts (folder id → subtree count), for giantFolderShare. */
  folderBookmarkCounts: Map<string, number>;
  /** Canonical URL → occurrence count, for duplicateUrlRate. */
  urlCounts: Map<string, number>;
  /** Unique brand domains seen. */
  domains: Set<string>;
  recentBookmarks: number;
}

function makeState(): WalkState {
  return {
    totalBookmarks: 0,
    totalFolders: 0,
    maxDepth: 0,
    nestedBookmarks: 0,
    folderBookmarkCounts: new Map(),
    urlCounts: new Map(),
    domains: new Set(),
    recentBookmarks: 0,
  };
}

// ---------------------------------------------------------------------------
// Walk logic
// ---------------------------------------------------------------------------

/**
 * Recursively walks `node`, accumulates signals into `state`, and returns the
 * total bookmark count for the entire subtree (direct + nested descendants).
 *
 * @param node         Folder being walked.
 * @param depth        Depth of `node`'s children relative to the selected root (0 = root children).
 * @param isRoot       True when `node` IS one of the caller-selected roots (transparent container).
 * @param recentCutoff Epoch ms; dateAdded at or below this is not recent.
 * @param state        Shared accumulator mutated in-place.
 */
function walkFolderWithCount(
  node: BookmarkNode,
  depth: number,
  isRoot: boolean,
  recentCutoff: number,
  state: WalkState,
): number {
  let subtreeBookmarks = 0;

  for (const child of node.children ?? []) {
    if (Array.isArray(child.children)) {
      // Exclude non-selected system containers encountered during the walk.
      // Even when isRoot=true (walking the selected root's direct children),
      // child folders are never selected roots — they are regular sub-folders
      // that happen to carry a system id and must be skipped.
      if (SYSTEM_FOLDER_IDS.has(child.id)) {
        continue;
      }

      state.totalFolders++;
      if (depth + 1 > state.maxDepth) state.maxDepth = depth + 1;

      const childSubtotal = walkFolderWithCount(child, depth + 1, false, recentCutoff, state);

      // Record per-folder subtree count only for non-root folders (the selected
      // root is a transparent container; its "share" is not meaningful).
      if (!isRoot) {
        state.folderBookmarkCounts.set(child.id, childSubtotal);
      }

      subtreeBookmarks += childSubtotal;
    } else {
      // Bookmark leaf.
      state.totalBookmarks++;
      subtreeBookmarks++;

      // folderedRatio: bookmark is "foldered" when its parent is not a selected root.
      if (!isRoot) {
        state.nestedBookmarks++;
      }

      if (child.url) {
        const key = canonicalUrlForDedup(child.url);
        if (key !== null) {
          state.urlCounts.set(key, (state.urlCounts.get(key) ?? 0) + 1);
        }
        // Domain diversity reuses the same brand-extraction approach as folder-scoring.ts.
        const info = extractBrandInfo(child.url);
        if (info.brand) state.domains.add(info.brand);
      }

      // Recency: undefined dateAdded counts as NOT recent (per spec).
      if (child.dateAdded !== undefined && child.dateAdded > recentCutoff) {
        state.recentBookmarks++;
      }
    }
  }

  return subtreeBookmarks;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Profiles the UNION of the given selected workspace roots in a single O(n) pass.
 *
 * Selected roots are transparent containers and are never excluded, even when
 * their id appears in SYSTEM_FOLDER_IDS (e.g. bookmarks bar '1' for Hoarders).
 * System ids encountered as non-root sub-folders during the walk are excluded.
 *
 * @param roots  Selected workspace root folders (caller owns which are selected).
 * @param now    Optional epoch ms for recency injection in tests.
 */
export function profileTree(roots: BookmarkNode[], now?: number): TreeProfile {
  const recentCutoff = (now ?? Date.now()) - RECENT_WINDOW_MS;
  const state = makeState();

  for (const root of roots) {
    if (!Array.isArray(root.children)) continue; // bookmark, not a folder
    walkFolderWithCount(root, 0, true, recentCutoff, state);
  }

  const total = state.totalBookmarks;

  // Guard: return a zeroed profile for empty / bookmark-free trees — no NaN.
  if (total === 0) {
    return {
      totalBookmarks: 0,
      totalFolders: state.totalFolders,
      maxDepth: state.maxDepth,
      folderedRatio: 0,
      giantFolderShare: 0,
      duplicateUrlRate: 0,
      domainDiversity: 0,
      recentAdditionRatio: 0,
    };
  }

  // folderedRatio: bookmarks nested one+ levels below a selected root / total.
  const folderedRatio = state.nestedBookmarks / total;

  // giantFolderShare: share of bookmarks residing in folders whose subtree
  // contains >= GIANT_FOLDER_MIN fraction of all bookmarks.
  const giantThreshold = GIANT_FOLDER_MIN * total;
  let giantBookmarks = 0;
  for (const count of state.folderBookmarkCounts.values()) {
    if (count >= giantThreshold) {
      giantBookmarks += count;
    }
  }
  const giantFolderShare = Math.min(giantBookmarks / total, 1);

  // duplicateUrlRate: extra copies of duplicated URLs / total.
  // Measures "wasted" bookmark slots — 0 means all URLs are unique.
  let duplicateCount = 0;
  for (const count of state.urlCounts.values()) {
    if (count > 1) duplicateCount += count - 1;
  }
  const duplicateUrlRate = duplicateCount / total;

  // domainDiversity: unique brand domains / total, capped at 1.
  const domainDiversity = Math.min(state.domains.size / total, 1);

  // recentAdditionRatio: recently-added bookmarks / total.
  const recentAdditionRatio = state.recentBookmarks / total;

  return {
    totalBookmarks: total,
    totalFolders: state.totalFolders,
    maxDepth: state.maxDepth,
    folderedRatio,
    giantFolderShare,
    duplicateUrlRate,
    domainDiversity,
    recentAdditionRatio,
  };
}
