import { sendRuntimeMessage } from '../shared/browser';
import { messageTypes, type AppSettings, type BookmarkNode, type GetIconResponse } from '../shared/messages';
import { collectVisibleBookmarks as collectVisibleBookmarkTargets, getDockFolder, getHostname, type BookmarkActionTarget } from './bookmark-navigation';
import type { AppState } from './app-state';
import { applyPendingIcon, applyResolvedIcon } from './icon-render';

let iconRenderGeneration = 0;

export function queueVisibleIconPreload(state: AppState): void {
  void preloadVisibleIcons(state);
}

export function hydrateBookmarkIcons(rootElement: HTMLDivElement, state: AppState): void {
  const currentGeneration = ++iconRenderGeneration;
  void hydrateVisibleBookmarkIcons(rootElement, state, currentGeneration);
}

async function preloadVisibleIcons(state: AppState): Promise<void> {
  const visibleBookmarks = collectVisibleBookmarks(state);
  const pendingBookmarks = visibleBookmarks.filter(bookmark => !state.resolvedIcons[bookmark.url]);
  if (!pendingBookmarks.length) {
    return;
  }

  await Promise.allSettled(pendingBookmarks.map(async bookmark => {
    const response = await sendRuntimeMessage<{
      type: typeof messageTypes.getIcon;
      bookmarkUrl: string;
      bookmarkTitle?: string;
    }, GetIconResponse>({
      type: messageTypes.getIcon,
      bookmarkUrl: bookmark.url,
      bookmarkTitle: bookmark.title,
    });

    state.resolvedIcons[bookmark.url] = response.icon;
  }));
}

function collectVisibleBookmarks(state: AppState): BookmarkActionTarget[] {
  const directTargets = collectVisibleBookmarkTargets(state.tree, state.currentFolderId, state.settings);
  const previewTargets = collectDockPreviewBookmarkTargets(state.tree, state.settings);
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

    for (const child of getDockPreviewItems(item)) {
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

function getDockPreviewItems(node: BookmarkNode): BookmarkNode[] {
  return (node.children ?? []).slice(0, 6);
}

async function hydrateVisibleBookmarkIcons(rootElement: HTMLDivElement, state: AppState, generation: number): Promise<void> {
  const iconElements = Array.from(rootElement.querySelectorAll<HTMLElement>('[data-bookmark-icon]'));
  await Promise.allSettled(iconElements.map(async element => {
    const bookmarkUrl = element.dataset.iconUrl;
    if (!bookmarkUrl) {
      return;
    }

    const existingIcon = state.resolvedIcons[bookmarkUrl];
    if (existingIcon) {
      applyResolvedIcon(element, existingIcon);
      return;
    }

    const bookmarkTitle = element.dataset.iconTitle;
    try {
      const response = await sendRuntimeMessage<{
        type: typeof messageTypes.getIcon;
        bookmarkUrl: string;
        bookmarkTitle?: string;
      }, GetIconResponse>({
        type: messageTypes.getIcon,
        bookmarkUrl,
        bookmarkTitle,
      });

      if (generation !== iconRenderGeneration || !element.isConnected) {
        return;
      }

      state.resolvedIcons[bookmarkUrl] = response.icon;
      applyResolvedIcon(element, response.icon);
    } catch {
      if (generation !== iconRenderGeneration || !element.isConnected) {
        return;
      }

      applyPendingIcon(element);
    }
  }));
}