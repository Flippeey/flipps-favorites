import type { AppSettings, BookmarkNode, BookmarkUsageRecord } from '../../shared/messages';
import { collectFolderOptions, collectLinkOptions, collectVisibleBookmarks, getBreadcrumbs, getDefaultFolder, getDockFolder, getHostname, getLibraryFolders, type BookmarkActionTarget } from '../bookmarks/bookmark-navigation';
import type { AppState } from './app-state';

export interface DerivedTreeState {
  defaultFolder: BookmarkNode | null;
  currentFolder: BookmarkNode | null;
  allCurrentFolderChildren: BookmarkNode[];
  currentFolderChildren: BookmarkNode[];
  searchResults: BookmarkNode[];
  dockFolder: BookmarkNode | null;
  dockItems: BookmarkNode[];
  libraryFolders: BookmarkNode[];
  breadcrumbs: BookmarkNode[];
  folderOptions: Array<{ id: string; label: string }>;
  linkOptions: Array<{ url: string; label: string }>;
  visibleIconTargets: BookmarkActionTarget[];
}

export function syncDerivedTree(state: AppState): void {
  state.derivedTree = deriveTreeState(state.tree, state.settings, state.currentFolderId, state.searchQuery, state.bookmarkUsage);
}

export function deriveTreeState(
  tree: BookmarkNode[],
  settings: AppSettings,
  currentFolderId: string,
  searchQuery: string,
  bookmarkUsage: Record<string, BookmarkUsageRecord>,
): DerivedTreeState {
  const defaultFolder = getDefaultFolder(tree, settings.rootFolderId);
  const currentFolder = getFolderOrDefault(tree, currentFolderId, defaultFolder);
  const dockFolder = getDockFolder(tree, settings);
  const visibleIconTargets = collectUniqueVisibleIconTargets(tree, settings, currentFolder?.id ?? defaultFolder?.id ?? '');
  const allCurrentFolderChildren = currentFolder?.children ?? [];
  const searchResults = searchQuery.trim()
    ? applySearchView(tree, settings, searchQuery, bookmarkUsage)
    : [];
  const derived: DerivedTreeState = {
    defaultFolder,
    currentFolder,
    allCurrentFolderChildren,
    currentFolderChildren: searchQuery.trim()
      ? searchResults
      : applyCurrentFolderView(allCurrentFolderChildren, settings, bookmarkUsage),
    searchResults,
    dockFolder,
    dockItems: dockFolder?.children ?? [],
    libraryFolders: getLibraryFolders(tree),
    breadcrumbs: currentFolder ? getBreadcrumbs(tree, currentFolder.id) : [],
    folderOptions: collectFolderOptions(tree),
    linkOptions: collectLinkOptions(tree),
    visibleIconTargets,
  };
  return derived;
}

function applyCurrentFolderView(
  children: BookmarkNode[],
  settings: AppSettings,
  bookmarkUsage: Record<string, BookmarkUsageRecord>,
): BookmarkNode[] {
  const filtered = [...children];
  if (settings.bookmarkSortMode === 'manual') {
    return filtered;
  }

  return filtered.sort((left, right) => compareNodes(left, right, settings, bookmarkUsage));
}

function applySearchView(
  tree: BookmarkNode[],
  settings: AppSettings,
  searchQuery: string,
  bookmarkUsage: Record<string, BookmarkUsageRecord>,
): BookmarkNode[] {
  const query = searchQuery.trim().toLowerCase();
  if (!query) {
    return [];
  }

  const results = collectSearchMatches(tree, query);
  if (settings.bookmarkSortMode === 'manual') {
    return results;
  }

  return results.sort((left, right) => compareNodes(left, right, settings, bookmarkUsage));
}

function collectSearchMatches(tree: BookmarkNode[], query: string): BookmarkNode[] {
  const queue = [...tree];
  const results: BookmarkNode[] = [];

  while (queue.length) {
    const node = queue.shift();
    if (!node) {
      continue;
    }

    if (matchesSearchQuery(node, query)) {
      results.push(node);
    }

    queue.push(...(node.children ?? []));
  }

  return results;
}

function matchesSearchQuery(node: BookmarkNode, query: string): boolean {
  const title = (node.title || 'Untitled').toLowerCase();
  if (title.includes(query)) {
    return true;
  }

  if (!node.url) {
    return false;
  }

  return node.url.toLowerCase().includes(query) || getHostname(node.url).toLowerCase().includes(query);
}

function compareNodes(
  left: BookmarkNode,
  right: BookmarkNode,
  settings: AppSettings,
  bookmarkUsage: Record<string, BookmarkUsageRecord>,
): number {
  const direction = settings.bookmarkSortDirection === 'desc' ? -1 : 1;

  if (settings.bookmarkSortMode === 'name') {
    return direction * compareStrings(left.title || fallbackName(left), right.title || fallbackName(right));
  }

  if (settings.bookmarkSortMode === 'created') {
    const createdDelta = (left.dateAdded ?? 0) - (right.dateAdded ?? 0);
    return createdDelta === 0
      ? direction * compareStrings(left.title || fallbackName(left), right.title || fallbackName(right))
      : direction * createdDelta;
  }

  const leftUsedAt = bookmarkUsage[left.id]?.usedAt ?? 0;
  const rightUsedAt = bookmarkUsage[right.id]?.usedAt ?? 0;
  const usageDelta = leftUsedAt - rightUsedAt;
  return usageDelta === 0
    ? direction * compareStrings(left.title || fallbackName(left), right.title || fallbackName(right))
    : direction * usageDelta;
}

function fallbackName(node: BookmarkNode): string {
  return node.url ? getHostname(node.url) : 'Untitled';
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true });
}

function getFolderOrDefault(tree: BookmarkNode[], folderId: string, defaultFolder: BookmarkNode | null): BookmarkNode | null {
  if (!folderId) {
    return defaultFolder;
  }

  return collectFolderNode(tree, folderId) ?? defaultFolder;
}

function collectFolderNode(tree: BookmarkNode[], folderId: string): BookmarkNode | null {
  const queue = [...tree];
  while (queue.length) {
    const node = queue.shift();
    if (!node) {
      continue;
    }

    if (node.id === folderId && !node.url) {
      return node;
    }

    queue.push(...(node.children ?? []));
  }

  return null;
}

function collectUniqueVisibleIconTargets(tree: BookmarkNode[], settings: AppSettings, currentFolderId: string): BookmarkActionTarget[] {
  const directTargets = collectVisibleBookmarks(tree, currentFolderId, settings);
  const previewTargets = collectDockPreviewBookmarkTargets(tree, settings);
  const uniqueTargets = new Map<string, BookmarkActionTarget>();

  for (const target of [...directTargets, ...previewTargets]) {
    if (!target.url || uniqueTargets.has(target.url)) {
      continue;
    }

    uniqueTargets.set(target.url, target);
  }

  return Array.from(uniqueTargets.values());
}

function collectDockPreviewBookmarkTargets(tree: BookmarkNode[], settings: AppSettings): BookmarkActionTarget[] {
  const dockFolder = getDockFolder(tree, settings);
  if (!dockFolder) {
    return [];
  }

  const targets: BookmarkActionTarget[] = [];
  for (const item of dockFolder.children ?? []) {
    if (item.url) {
      continue;
    }

    for (const child of (item.children ?? []).slice(0, 6)) {
      if (!child.url) {
        continue;
      }

      targets.push({
        id: child.id,
        url: child.url,
        title: child.title || getHostname(child.url),
        parentId: child.parentId ?? '',
      });
    }
  }

  return targets;
}