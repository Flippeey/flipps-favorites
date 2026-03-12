import type { AppSettings, BookmarkNode } from '../../shared/messages';

const folderOptionsCache = new WeakMap<BookmarkNode[], Array<{ id: string; label: string }>>();
const linkOptionsCache = new WeakMap<BookmarkNode[], Array<{ url: string; label: string }>>();
const nodeIndexCache = new WeakMap<BookmarkNode[], Map<string, BookmarkNode>>();
const breadcrumbCache = new WeakMap<BookmarkNode[], Map<string, BookmarkNode[]>>();

export interface BookmarkActionTarget {
  id: string;
  url: string;
  title: string;
  parentId: string;
}

export function getHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Link';
  }
}

export function resolveInitialFolderId(settings: AppSettings, tree: BookmarkNode[], getLastFolder: () => string | null, getFolderIdFromHash: () => string | null): string {
  const hashFolderId = getFolderIdFromHash();
  if (hashFolderId && getFolderNode(tree, hashFolderId)) {
    return hashFolderId;
  }

  const lastFolderId = settings.rememberLastFolder ? getLastFolder() : null;
  if (lastFolderId && getFolderNode(tree, lastFolderId)) {
    return lastFolderId;
  }

  return getDefaultFolder(tree, settings.rootFolderId)?.id ?? '';
}

export function getDefaultFolder(tree: BookmarkNode[], preferredFolderId: string): BookmarkNode | null {
  if (preferredFolderId) {
    const preferred = getFolderNode(tree, preferredFolderId);
    if (preferred) {
      return preferred;
    }
  }

  return tree[0]?.children?.find(node => !node.url) ?? null;
}

export function getDockFolder(tree: BookmarkNode[], settings: AppSettings): BookmarkNode | null {
  if (!settings.showDock) {
    return null;
  }
  if (settings.dockFolderId) {
    const dockFolder = getFolderNode(tree, settings.dockFolderId);
    if (dockFolder) {
      return dockFolder;
    }
  }
  return getDefaultFolder(tree, settings.rootFolderId);
}

export function getFolderNode(tree: BookmarkNode[], folderId: string): BookmarkNode | null {
  const node = findNodeById(tree, folderId);
  return node && !node.url ? node : null;
}

export function getFolderChildIds(tree: BookmarkNode[], folderId: string): string[] {
  return getFolderNode(tree, folderId)?.children?.map(node => node.id) ?? [];
}

export function findNodeById(nodes: BookmarkNode[], targetId: string): BookmarkNode | null {
  return getNodeIndex(nodes).get(targetId) ?? null;
}

export function getBreadcrumbs(tree: BookmarkNode[], folderId: string): BookmarkNode[] {
  const cached = breadcrumbCache.get(tree)?.get(folderId);
  if (cached) {
    return cached;
  }

  const breadcrumbs = findPath(tree, folderId).filter(node => node.id !== tree[0]?.id);
  let treeCache = breadcrumbCache.get(tree);
  if (!treeCache) {
    treeCache = new Map<string, BookmarkNode[]>();
    breadcrumbCache.set(tree, treeCache);
  }
  treeCache.set(folderId, breadcrumbs);
  return breadcrumbs;
}

export function collectFolderOptions(tree: BookmarkNode[]): Array<{ id: string; label: string }> {
  const cached = folderOptionsCache.get(tree);
  if (cached) {
    return cached;
  }

  const options: Array<{ id: string; label: string }> = [];
  for (const child of tree[0]?.children ?? []) {
    if (!child.url) {
      collectFolderOptionsRecursive(child, '', options);
    }
  }
  folderOptionsCache.set(tree, options);
  return options;
}

export function collectLinkOptions(tree: BookmarkNode[]): Array<{ url: string; label: string }> {
  const cached = linkOptionsCache.get(tree);
  if (cached) {
    return cached;
  }

  const options: Array<{ url: string; label: string }> = [];
  for (const child of tree[0]?.children ?? []) {
    collectLinkOptionsRecursive(child, '', options);
  }
  linkOptionsCache.set(tree, options);
  return options;
}

export function resolveInitialIconToolTarget(tree: BookmarkNode[]): string {
  return collectLinkOptions(tree)[0]?.url ?? '';
}

export function resolveIconToolTarget(currentValue: string, iconOptions: Array<{ url: string; label: string }>): string {
  if (currentValue && iconOptions.some(option => option.url === currentValue)) {
    return currentValue;
  }
  return iconOptions[0]?.url ?? '';
}

export function getBookmarkActionTarget(element: HTMLElement): BookmarkActionTarget | null {
  const id = element.dataset.bookmarkId;
  const url = element.dataset.linkUrl;
  if (!id || !url) {
    return null;
  }

  return {
    id,
    url,
    title: element.dataset.bookmarkTitle || getHostname(url),
    parentId: element.dataset.parentId || '',
  };
}

export function getBookmarkLabelForUrl(tree: BookmarkNode[], bookmarkUrl: string): string {
  return collectLinkOptions(tree).find(option => option.url === bookmarkUrl)?.label ?? getHostname(bookmarkUrl);
}

export function findBookmarkActionTargetById(tree: BookmarkNode[], bookmarkId: string): BookmarkActionTarget | null {
  const node = findNodeById(tree, bookmarkId);
  if (!node?.url) {
    return null;
  }

  return {
    id: node.id,
    url: node.url,
    title: node.title || getHostname(node.url),
    parentId: node.parentId ?? '',
  };
}

export function getLibraryFolders(tree: BookmarkNode[]): BookmarkNode[] {
  return tree[0]?.children?.filter(node => !node.url) ?? [];
}

export function isFolderDescendantOf(tree: BookmarkNode[], folderId: string, ancestorId: string): boolean {
  return getBreadcrumbs(tree, folderId).some(node => node.id === ancestorId);
}

export function collectVisibleBookmarks(tree: BookmarkNode[], currentFolderId: string, settings: AppSettings): BookmarkActionTarget[] {
  const currentFolder = getFolderNode(tree, currentFolderId) ?? getDefaultFolder(tree, settings.rootFolderId);
  const dockFolder = getDockFolder(tree, settings);
  const candidates = [
    ...(currentFolder?.children ?? []),
    ...(dockFolder?.children ?? []),
  ];
  const uniqueBookmarks = new Map<string, BookmarkActionTarget>();

  for (const candidate of candidates) {
    if (!candidate.url || uniqueBookmarks.has(candidate.url)) {
      continue;
    }

    uniqueBookmarks.set(candidate.url, {
      id: candidate.id,
      url: candidate.url,
      title: candidate.title || getHostname(candidate.url),
      parentId: candidate.parentId ?? '',
    });
  }

  return Array.from(uniqueBookmarks.values());
}

function findPath(nodes: BookmarkNode[], targetId: string, trail: BookmarkNode[] = []): BookmarkNode[] {
  for (const node of nodes) {
    const nextTrail = [...trail, node];
    if (node.id === targetId) {
      return nextTrail;
    }
    const result = findPath(node.children ?? [], targetId, nextTrail);
    if (result.length) {
      return result;
    }
  }
  return [];
}

function collectLinkOptionsRecursive(node: BookmarkNode, prefix: string, options: Array<{ url: string; label: string }>): void {
  const nodeLabel = node.title || (node.url ? getHostname(node.url) : 'Untitled');
  const nextPrefix = prefix ? `${prefix} / ${nodeLabel}` : nodeLabel;

  if (node.url) {
    options.push({
      url: node.url,
      label: nextPrefix,
    });
    return;
  }

  for (const child of node.children ?? []) {
    collectLinkOptionsRecursive(child, nextPrefix, options);
  }
}

function collectFolderOptionsRecursive(node: BookmarkNode, prefix: string, options: Array<{ id: string; label: string }>): void {
  const label = prefix ? `${prefix} / ${node.title || 'Untitled'}` : (node.title || 'Untitled');
  options.push({ id: node.id, label });
  for (const child of node.children ?? []) {
    if (!child.url) {
      collectFolderOptionsRecursive(child, label, options);
    }
  }
}

function getNodeIndex(nodes: BookmarkNode[]): Map<string, BookmarkNode> {
  const cached = nodeIndexCache.get(nodes);
  if (cached) {
    return cached;
  }

  const index = new Map<string, BookmarkNode>();
  const stack = [...nodes];
  while (stack.length) {
    const node = stack.pop();
    if (!node) {
      continue;
    }

    index.set(node.id, node);
    const children = node.children ?? [];
    for (let indexPointer = children.length - 1; indexPointer >= 0; indexPointer -= 1) {
      stack.push(children[indexPointer]);
    }
  }

  nodeIndexCache.set(nodes, index);
  return index;
}