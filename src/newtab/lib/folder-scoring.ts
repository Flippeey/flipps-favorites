import type { BookmarkNode } from '@/shared/messages';
import { extractBrandInfo } from '@/shared/url-brand';
import { countDescendants, findNode, topLevelFolders } from './tree';

export interface FolderStats {
  totalBookmarks: number;
  totalFolders: number;
  directBookmarks: number;
  directFolders: number;
  substantialSubfolders: number;
  maxDepth: number;
  uniqueDomains: number;
  recentBookmarks: number;
  newestTimestamp: number;
}

export interface ScoreBreakdown {
  size: number;
  structure: number;
  recency: number;
  diversity: number;
}

export type FolderTier = 'preselect' | 'suggest' | 'none';

export interface ScoredFolder {
  id: string;
  title: string;
  depth: number;
  score: number;
  breakdown: ScoreBreakdown;
  stats: FolderStats;
  tier: FolderTier;
}

export interface ScanResult {
  preSelected: ScoredFolder[];
  suggested: ScoredFolder[];
  all: ScoredFolder[];
}

const MIN_BOOKMARKS_TO_SCORE = 5;
const PRESELECT_SCORE_THRESHOLD = 55;
const PRESELECT_MIN_BOOKMARKS = 12;
const MAX_PRESELECTIONS = 3;
const SUGGEST_SCORE_THRESHOLD = 35;
const RECENT_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

// Browser-managed container folders that should never be recommended as workspaces.
// Chrome: 1=Bookmarks bar, 2=Other bookmarks, 3=Mobile bookmarks
// Firefox: toolbar_____, menu________, unfiled_____, mobile______
export const SYSTEM_FOLDER_IDS = new Set([
  '1', '2', '3',
  'toolbar_____', 'menu________', 'unfiled_____', 'mobile______',
]);

function collectCandidates(tree: BookmarkNode[]): { folder: BookmarkNode; depth: number }[] {
  const result: { folder: BookmarkNode; depth: number }[] = [];
  for (const root of topLevelFolders(tree)) {
    if (!SYSTEM_FOLDER_IDS.has(root.id)) {
      result.push({ folder: root, depth: 0 });
    }
    if (root.children) {
      for (const child of root.children) {
        if (Array.isArray(child.children)) {
          result.push({ folder: child, depth: 1 });
        }
      }
    }
  }
  return result;
}

function gatherStats(folder: BookmarkNode): FolderStats {
  const domains = new Set<string>();
  const recentCutoff = Date.now() - RECENT_WINDOW_MS;
  let totalBookmarks = 0;
  let totalFolders = 0;
  let recentBookmarks = 0;
  let newestTimestamp = 0;
  let maxDepth = 0;

  const walk = (node: BookmarkNode, depth: number): void => {
    for (const child of node.children ?? []) {
      if (Array.isArray(child.children)) {
        totalFolders++;
        if (depth + 1 > maxDepth) maxDepth = depth + 1;
        walk(child, depth + 1);
      } else {
        totalBookmarks++;
        if (child.url) {
          const info = extractBrandInfo(child.url);
          if (info.brand) domains.add(info.brand);
        }
        const added = child.dateAdded ?? 0;
        if (added > recentCutoff) recentBookmarks++;
        if (added > newestTimestamp) newestTimestamp = added;
      }
    }
  };
  walk(folder, 0);

  let directBookmarks = 0;
  let directFolders = 0;
  let substantialSubfolders = 0;
  for (const child of folder.children ?? []) {
    if (Array.isArray(child.children)) {
      directFolders++;
      if (countDescendants(child).bookmarks >= 2) substantialSubfolders++;
    } else {
      directBookmarks++;
    }
  }

  return {
    totalBookmarks,
    totalFolders,
    directBookmarks,
    directFolders,
    substantialSubfolders,
    maxDepth,
    uniqueDomains: domains.size,
    recentBookmarks,
    newestTimestamp,
  };
}

function scoreSize(totalBookmarks: number): number {
  if (totalBookmarks >= 50) return 30;
  if (totalBookmarks >= 20) return 26;
  if (totalBookmarks >= 10) return 20;
  if (totalBookmarks >= 6) return 12;
  if (totalBookmarks >= 3) return 5;
  return 0;
}

function scoreStructure(stats: FolderStats): number {
  let pts = Math.min(stats.substantialSubfolders * 5, 15);
  if (stats.maxDepth >= 2) pts += 5;
  return Math.min(pts, 20);
}

function scoreRecency(stats: FolderStats): number {
  if (stats.totalBookmarks === 0) return 0;
  const ratio = stats.recentBookmarks / stats.totalBookmarks;
  if (ratio > 0.5) return 25;
  if (ratio > 0.3) return 18;
  if (ratio > 0.1) return 12;
  if (ratio > 0) return 5;
  return 0;
}

function scoreDiversity(uniqueDomains: number): number {
  if (uniqueDomains >= 10) return 25;
  if (uniqueDomains >= 6) return 20;
  if (uniqueDomains >= 3) return 12;
  if (uniqueDomains >= 2) return 5;
  return 0;
}

function scoreFolder(folder: BookmarkNode, depth: number): ScoredFolder {
  const stats = gatherStats(folder);
  const base = {
    id: folder.id,
    title: folder.title,
    depth,
    stats,
  };

  if (stats.totalBookmarks < MIN_BOOKMARKS_TO_SCORE) {
    return {
      ...base,
      score: 0,
      tier: 'none',
      breakdown: { size: 0, structure: 0, recency: 0, diversity: 0 },
    };
  }

  const breakdown: ScoreBreakdown = {
    size: scoreSize(stats.totalBookmarks),
    structure: scoreStructure(stats),
    recency: scoreRecency(stats),
    diversity: scoreDiversity(stats.uniqueDomains),
  };

  const score = breakdown.size + breakdown.structure + breakdown.recency + breakdown.diversity;

  return { ...base, score, breakdown, tier: 'none' };
}

function deduplicateParentChild(
  preSelected: ScoredFolder[],
  suggested: ScoredFolder[],
  tree: BookmarkNode[],
): void {
  const preSelectedIds = new Set(preSelected.map(f => f.id));
  for (let i = preSelected.length - 1; i >= 0; i--) {
    const folder = preSelected[i];
    const node = findNode(tree, folder.id);
    if (node?.parentId && preSelectedIds.has(node.parentId)) {
      folder.tier = 'suggest';
      const [demoted] = preSelected.splice(i, 1);
      preSelectedIds.delete(demoted.id);
      suggested.unshift(demoted);
    }
  }
}

export function scanFolders(tree: BookmarkNode[]): ScanResult {
  const candidates = collectCandidates(tree);
  const scored = candidates
    .map(c => scoreFolder(c.folder, c.depth))
    .filter(s => s.score > 0);

  scored.sort((a, b) => b.score - a.score);

  const preSelected: ScoredFolder[] = [];
  const suggested: ScoredFolder[] = [];

  for (const folder of scored) {
    if (
      folder.score >= PRESELECT_SCORE_THRESHOLD
      && folder.stats.totalBookmarks >= PRESELECT_MIN_BOOKMARKS
      && preSelected.length < MAX_PRESELECTIONS
    ) {
      folder.tier = 'preselect';
      preSelected.push(folder);
    } else if (folder.score >= SUGGEST_SCORE_THRESHOLD) {
      folder.tier = 'suggest';
      suggested.push(folder);
    }
  }

  deduplicateParentChild(preSelected, suggested, tree);

  return { preSelected, suggested, all: scored };
}

export function formatFolderStats(stats: FolderStats): string {
  const parts: string[] = [];
  parts.push(`${stats.totalBookmarks} bookmark${stats.totalBookmarks !== 1 ? 's' : ''}`);
  if (stats.totalFolders > 0) {
    parts.push(`${stats.totalFolders} folder${stats.totalFolders !== 1 ? 's' : ''}`);
  }
  if (stats.uniqueDomains > 1) {
    parts.push(`${stats.uniqueDomains} site${stats.uniqueDomains !== 1 ? 's' : ''}`);
  }
  return parts.join(' · ');
}
