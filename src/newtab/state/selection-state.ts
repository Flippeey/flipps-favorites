import type { BookmarkNode } from '../../shared/messages';
import { markBookmarkUsed } from '../bookmarks/bookmark-usage';
import { getDefaultFolder, getFolderNode } from '../bookmarks/bookmark-navigation';
import { openBookmark } from '../helpers/bookmark-operations';
import { openFolderView } from '../helpers/folder-navigation';
import type { AppState, SelectionContextMenuState, SelectionScope, SelectionSurface } from './app-state';

export function clearSelection(state: AppState): void {
  state.selectedIds = [];
  state.selectionAnchorId = null;
  state.selectionScope = null;
}

export function normalizeSelection(state: AppState): void {
  if (!state.selectionScope) {
    clearSelection(state);
    return;
  }

  const visibleIds = new Set(getVisibleChildren(state, state.selectionScope).map(node => node.id));
  state.selectedIds = state.selectedIds.filter(id => visibleIds.has(id));
  if (state.selectionAnchorId && !visibleIds.has(state.selectionAnchorId)) {
    state.selectionAnchorId = state.selectedIds[0] ?? null;
  }

  if (!state.selectedIds.length) {
    state.selectionScope = null;
  }

  if (state.contextMenu?.kind === 'selection' && state.selectedIds.length < 2) {
    state.contextMenu = null;
  }
}

export function getFolderChildren(state: AppState, folderId: string): BookmarkNode[] {
  return getFolderNode(state.tree, folderId)?.children ?? [];
}

export function getCurrentFolderChildren(state: AppState): BookmarkNode[] {
  return state.derivedTree.currentFolderChildren;
}

export function getVisibleChildren(state: AppState, scope: SelectionScope): BookmarkNode[] {
  if (scope.surface === 'grid' && scope.folderId === state.currentFolderId) {
    return state.derivedTree.currentFolderChildren;
  }

  return getFolderChildren(state, scope.folderId);
}

export function isItemSelected(state: AppState, itemId: string, surface: SelectionSurface, folderId: string): boolean {
  const selectionScope = state.selectionScope;
  return selectionScope !== null
    && selectionScope.surface === surface
    && selectionScope.folderId === folderId
    && state.selectedIds.includes(itemId);
}

export function setSelection(state: AppState, ids: string[], scope: SelectionScope | null, anchorId: string | null = ids[0] ?? null): void {
  state.selectedIds = ids;
  state.selectionAnchorId = anchorId;
  state.selectionScope = ids.length && scope ? scope : null;
}

export function getOrderedSelectedIds(state: AppState, scope: SelectionScope | null = state.selectionScope): string[] {
  if (!scope) {
    return [];
  }

  const selectedSet = new Set(state.selectedIds);
  return getVisibleChildren(state, scope)
    .filter(node => selectedSet.has(node.id))
    .map(node => node.id);
}

export function getSelectedNodes(state: AppState, ids: string[] = getOrderedSelectedIds(state), scope: SelectionScope | null = state.selectionScope): BookmarkNode[] {
  if (!scope) {
    return [];
  }

  const idSet = new Set(ids);
  return getFolderChildren(state, scope.folderId).filter(node => idSet.has(node.id));
}

export function createSelectionContextMenuState(state: AppState, x: number, y: number, scope: SelectionScope | null = state.selectionScope): SelectionContextMenuState {
  const selectedNodes = getSelectedNodes(state, getOrderedSelectedIds(state, scope), scope);
  return {
    kind: 'selection',
    x,
    y,
    target: {
      ids: selectedNodes.map(node => node.id),
      bookmarkCount: selectedNodes.filter(node => Boolean(node.url)).length,
      folderCount: selectedNodes.filter(node => !node.url).length,
      scope,
    },
  };
}

export function openSelectionInNewTabs(state: AppState, ids: string[], scope: SelectionScope | null = state.selectionScope): void {
  for (const node of getSelectedNodes(state, ids, scope)) {
    markBookmarkUsed(state, node.id);
    if (node.url) {
      openBookmark(node.url, true);
      continue;
    }

    openFolderView(node.id, true);
  }
}

export function isSameScope(left: SelectionScope | null, right: SelectionScope | null): boolean {
  return Boolean(left && right && left.surface === right.surface && left.folderId === right.folderId);
}

export function isClipboardCutItem(state: AppState, itemId: string): boolean {
  return state.clipboard?.mode === 'cut' && state.clipboard.items.some(item => item.id === itemId);
}