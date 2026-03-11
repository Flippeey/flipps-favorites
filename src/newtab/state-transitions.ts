import { sendRuntimeMessage } from '../shared/browser';
import { messageTypes, type BookmarkNode, type GetBookmarkTreeResponse } from '../shared/messages';
import { createClosedIconDialogState, type AppState, type BookmarkClipboardState } from './app-state';
import { syncDerivedTree } from './derived-tree';
import { findBookmarkActionTargetById, findNodeById, getFolderNode, resolveInitialFolderId } from './bookmark-navigation';
import { queueVisibleIconPreload } from './icon-runtime';
import { getFolderIdFromHash, getLastFolder, persistLastFolder, syncFolderHash } from './runtime-helpers';
import { clearSelection, normalizeSelection } from './selection-state';

export type RenderAppFn = (rootElement: HTMLDivElement, state: AppState) => void;

export function renderState(rootElement: HTMLDivElement, state: AppState, renderApp: RenderAppFn): void {
  renderApp(rootElement, state);
}

export function renderStateAndWarmIcons(rootElement: HTMLDivElement, state: AppState, renderApp: RenderAppFn): void {
  renderApp(rootElement, state);
  queueVisibleIconPreload(state);
}

export function navigateToFolder(state: AppState, folderId: string, mode: 'replace' | 'push' | 'none' = 'push'): boolean {
  if (!getFolderNode(state.tree, folderId)) {
    return false;
  }

  state.currentFolderId = folderId;
  clearSelection(state);
  state.contextMenu = null;
  if (mode !== 'none') {
    syncFolderHash(folderId, mode);
  }
  persistLastFolder(state.settings, folderId);
  syncDerivedTree(state);
  return true;
}

export function navigateToFolderAndRender(rootElement: HTMLDivElement, state: AppState, folderId: string, renderApp: RenderAppFn, mode: 'replace' | 'push' | 'none' = 'push'): boolean {
  if (!navigateToFolder(state, folderId, mode)) {
    return false;
  }

  renderStateAndWarmIcons(rootElement, state, renderApp);
  return true;
}

export async function refreshBookmarkTree(state: AppState): Promise<void> {
  const response = await sendRuntimeMessage<{ type: typeof messageTypes.getBookmarkTree }, GetBookmarkTreeResponse>({
    type: messageTypes.getBookmarkTree,
  });
  state.tree = response.tree;

  if (!getFolderNode(state.tree, state.currentFolderId)) {
    state.currentFolderId = resolveInitialFolderId(state.settings, state.tree, getLastFolder, getFolderIdFromHash);
  }

  syncDerivedTree(state);

  if (state.iconDialog.target) {
    const nextTarget = findBookmarkActionTargetById(state.tree, state.iconDialog.target.id);
    if (nextTarget) {
      state.iconDialog.target = nextTarget;
    } else {
      state.iconDialog = createClosedIconDialogState();
    }
  }

  state.clipboard = refreshFolderClipboard(state.tree, state.clipboard);
  normalizeSelection(state);
}

export async function refreshTreeAndRender(rootElement: HTMLDivElement, state: AppState, renderApp: RenderAppFn, options: { warmIcons?: boolean } = {}): Promise<void> {
  await refreshBookmarkTree(state);
  if (options.warmIcons) {
    renderStateAndWarmIcons(rootElement, state, renderApp);
    return;
  }

  renderState(rootElement, state, renderApp);
}

export function cloneBookmarkNode(node: BookmarkNode): BookmarkNode {
  return {
    id: node.id,
    parentId: node.parentId,
    title: node.title,
    url: node.url,
    children: node.children?.map(child => cloneBookmarkNode(child)),
  };
}

function refreshFolderClipboard(tree: BookmarkNode[], clipboard: BookmarkClipboardState | null): BookmarkClipboardState | null {
  if (!clipboard) {
    return null;
  }

  if (clipboard.mode === 'copy') {
    return clipboard;
  }

  const nextItems = clipboard.items
    .map(item => findNodeById(tree, item.id))
    .filter((node): node is BookmarkNode => Boolean(node))
    .map(node => cloneBookmarkNode(node));

  if (!nextItems.length) {
    return null;
  }

  return {
    mode: clipboard.mode,
    items: nextItems,
  };
}