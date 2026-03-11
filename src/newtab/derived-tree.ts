import type { AppSettings, BookmarkNode } from '../shared/messages';
import { collectFolderOptions, collectLinkOptions, collectVisibleBookmarks, getBreadcrumbs, getDefaultFolder, getDockFolder, getHostname, getLibraryFolders, type BookmarkActionTarget } from './bookmark-navigation';
import type { AppState } from './app-state';

export interface DerivedTreeState {
  defaultFolder: BookmarkNode | null;
  currentFolder: BookmarkNode | null;
  currentFolderChildren: BookmarkNode[];
  dockFolder: BookmarkNode | null;
  dockItems: BookmarkNode[];
  libraryFolders: BookmarkNode[];
  breadcrumbs: BookmarkNode[];
  folderOptions: Array<{ id: string; label: string }>;
  linkOptions: Array<{ url: string; label: string }>;
  visibleIconTargets: BookmarkActionTarget[];
}

const derivedTreeCache = new WeakMap<BookmarkNode[], Map<string, DerivedTreeState>>();

export function syncDerivedTree(state: AppState): void {
  state.derivedTree = deriveTreeState(state.tree, state.settings, state.currentFolderId);
}

export function deriveTreeState(tree: BookmarkNode[], settings: AppSettings, currentFolderId: string): DerivedTreeState {
  const cacheKey = [currentFolderId, settings.rootFolderId, settings.dockFolderId, settings.showDock ? '1' : '0'].join('|');
  const cached = derivedTreeCache.get(tree)?.get(cacheKey);
  if (cached) {
    return cached;
  }

  const defaultFolder = getDefaultFolder(tree, settings.rootFolderId);
  const currentFolder = getFolderOrDefault(tree, currentFolderId, defaultFolder);
  const dockFolder = getDockFolder(tree, settings);
  const visibleIconTargets = collectUniqueVisibleIconTargets(tree, settings, currentFolder?.id ?? defaultFolder?.id ?? '');
  const derived: DerivedTreeState = {
    defaultFolder,
    currentFolder,
    currentFolderChildren: currentFolder?.children ?? [],
    dockFolder,
    dockItems: dockFolder?.children ?? [],
    libraryFolders: getLibraryFolders(tree),
    breadcrumbs: currentFolder ? getBreadcrumbs(tree, currentFolder.id) : [],
    folderOptions: collectFolderOptions(tree),
    linkOptions: collectLinkOptions(tree),
    visibleIconTargets,
  };

  let treeCache = derivedTreeCache.get(tree);
  if (!treeCache) {
    treeCache = new Map<string, DerivedTreeState>();
    derivedTreeCache.set(tree, treeCache);
  }
  treeCache.set(cacheKey, derived);
  return derived;
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